// ==UserScript==
// @name         Expo2025 NR Debug Logger
// @namespace    https://github.com/
// @version      0.1.0
// @description  Collects detailed runtime logs to help diagnose unexpected reloads and navigation in Expo2025 NR scripts.
// @match        https://reserve.expo2025.or.jp/*
// @match        https://reserve-visitor.expo2025.or.jp/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
  'use strict';

  const STORAGE_KEY = '__nr_debug_logs_v1__';
  const MAX_LOGS = 600;
  const RETAIN_PRE_MS = 30 * 1000;
  const RETAIN_POST_MS = 10 * 1000;
  const LOG_PREFIX = '[NRDBG]';
  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const RETENTION_KEY = '__nr_debug_retention_v1__';
  const TOP_PAGE_PATTERNS = [
    /^https:\/\/reserve\.expo2025\.or\.jp\/?(?:[?#]|$)/i,
    /^https:\/\/reserve-visitor\.expo2025\.or\.jp\/?(?:[?#]|$)/i,
  ];

  const state = {
    logs: loadStoredLogs(),
    retention: loadRetentionState(),
    loggingDisabled: false,
  };

  function loadStoredLogs() {
    try {
      const stored = win.localStorage?.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(normalizeLogEntry)
        .filter(Boolean);
    } catch (err) {
      console.warn(LOG_PREFIX, 'Failed to load stored logs', err);
      return [];
    }
  }

  function normalizeLogEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const normalized = Object.assign({}, entry);
    if (typeof normalized.ts !== 'number') {
      const parsed = Date.parse(normalized.at || '');
      normalized.ts = Number.isFinite(parsed) ? parsed : Date.now();
    }
    if (typeof normalized.at !== 'string') {
      normalized.at = new Date(normalized.ts).toISOString();
    }
    return normalized;
  }

  function loadRetentionState() {
    try {
      const stored = win.localStorage?.getItem(RETENTION_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return null;
      const windowStart = Number(parsed.windowStart);
      const windowEnd = Number(parsed.windowEnd);
      const detectedAt = Number(parsed.detectedAt);
      if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return null;
      return {
        windowStart,
        windowEnd,
        detectedAt: Number.isFinite(detectedAt) ? detectedAt : null,
      };
    } catch (err) {
      console.warn(LOG_PREFIX, 'Failed to load retention state', err);
      return null;
    }
  }

  function saveRetentionState() {
    try {
      if (!state.retention) {
        win.localStorage?.removeItem(RETENTION_KEY);
      } else {
        win.localStorage?.setItem(RETENTION_KEY, JSON.stringify(state.retention));
      }
    } catch (err) {
      console.warn(LOG_PREFIX, 'Failed to persist retention state', err);
    }
  }

  function persistLogs() {
    try {
      const keep = state.logs.slice(-MAX_LOGS);
      win.localStorage?.setItem(STORAGE_KEY, JSON.stringify(keep));
    } catch (err) {
      console.warn(LOG_PREFIX, 'Failed to persist logs', err);
    }
  }

  function getEntryTime(entry) {
    if (!entry) return Date.now();
    if (typeof entry.ts === 'number') return entry.ts;
    const parsed = Date.parse(entry.at || '');
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function applyRetentionPolicy() {
    const now = Date.now();
    if (!state.retention) {
      const cutoff = now - RETAIN_PRE_MS;
      state.logs = state.logs.filter(entry => getEntryTime(entry) >= cutoff);
      return;
    }

    const { windowStart, windowEnd } = state.retention;
    state.logs = state.logs.filter(entry => {
      const ts = getEntryTime(entry);
      return ts >= windowStart && ts <= windowEnd;
    });

    if (now > windowEnd) {
      state.loggingDisabled = true;
    }
  }

  function shouldStoreEntry(entry) {
    if (!state.retention) return true;
    const ts = getEntryTime(entry);
    return ts >= state.retention.windowStart && ts <= state.retention.windowEnd;
  }

  function isTopPageUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    let candidate = url;
    try {
      candidate = new URL(url, win.location?.href || undefined).href;
    } catch {}
    return TOP_PAGE_PATTERNS.some(pattern => pattern.test(candidate));
  }

  function extractCandidateUrls(detail) {
    const urls = [];
    if (!detail || typeof detail !== 'object') return urls;
    if (typeof detail.url === 'string') urls.push(detail.url);
    if (Array.isArray(detail.args)) {
      detail.args.forEach(value => {
        if (typeof value === 'string') urls.push(value);
      });
    }
    if (typeof detail.href === 'string') urls.push(detail.href);
    return urls;
  }

  function markTopNavigation(timestamp) {
    state.retention = {
      detectedAt: timestamp,
      windowStart: timestamp - RETAIN_PRE_MS,
      windowEnd: timestamp + RETAIN_POST_MS,
    };
    state.loggingDisabled = false;
    saveRetentionState();
    applyRetentionPolicy();
    persistLogs();
  }

  function maybeHandleTopNavigation(event, detail, timestamp) {
    if (!event) return;
    const candidates = extractCandidateUrls(detail);
    if (candidates.some(isTopPageUrl)) {
      markTopNavigation(timestamp);
    }
  }

  function safeSerialize(value) {
    if (value === undefined) return 'undefined';
    if (value === null) return null;
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return value;
    if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: String(value.stack || ''),
      };
    }
    if (value instanceof Node) {
      try {
        const desc = value.nodeType === Node.ELEMENT_NODE
          ? value.tagName.toLowerCase() + (value.id ? `#${value.id}` : '')
          : value.nodeName;
        return `[Node ${desc}]`;
      } catch {
        return '[Node]';
      }
    }
    if (Array.isArray(value)) {
      return value.map(safeSerialize);
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }

  function captureStack(skip = 0) {
    const err = new Error('stack');
    if (!err.stack) return undefined;
    const lines = String(err.stack).split('\n');
    return lines.slice(1 + skip).join('\n');
  }

  function addLog(event, detail = {}) {
    const now = Date.now();
    const entry = {
      at: new Date(now).toISOString(),
      ts: now,
      href: win.location?.href || '',
      visibility: document.visibilityState,
      readyState: document.readyState,
      event,
      detail,
    };
    maybeHandleTopNavigation(event, detail, now);
    if (!state.loggingDisabled && shouldStoreEntry(entry)) {
      state.logs.push(entry);
      if (state.logs.length > MAX_LOGS * 2) {
        state.logs = state.logs.slice(-MAX_LOGS);
      }
      applyRetentionPolicy();
      persistLogs();
    }
    console.info(LOG_PREFIX, event, detail);
    return entry;
  }

  const logger = {
    add: addLog,
    getAll() {
      return state.logs.slice();
    },
    clear() {
      state.logs = [];
      state.retention = null;
      state.loggingDisabled = false;
      saveRetentionState();
      persistLogs();
      console.info(LOG_PREFIX, 'Cleared logs');
    },
    dumpToConsole() {
      console.group(`${LOG_PREFIX} Dump (${state.logs.length})`);
      state.logs.forEach((entry, idx) => {
        console.log(`#${idx + 1}`, entry.at, entry.event, entry.detail);
      });
      console.groupEnd();
    },
    copyToClipboard() {
      const text = state.logs.map((entry, idx) => {
        return [
          `#${idx + 1}`,
          `time=${entry.at}`,
          `event=${entry.event}`,
          `href=${entry.href}`,
          `visibility=${entry.visibility}`,
          `readyState=${entry.readyState}`,
          `detail=${JSON.stringify(entry.detail)}`,
        ].join(' ');
      }).join('\n');
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, { type: 'text', mimetype: 'text/plain' });
        console.info(LOG_PREFIX, 'Copied logs to clipboard');
      } else if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          console.info(LOG_PREFIX, 'Copied logs to clipboard');
        }, err => {
          console.warn(LOG_PREFIX, 'Failed to copy logs', err);
        });
      } else {
        console.warn(LOG_PREFIX, 'Clipboard API not available');
      }
    },
  };

  win.NR_DEBUG_LOGGER = logger;

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('NR Debug: Dump logs', () => logger.dumpToConsole());
    GM_registerMenuCommand('NR Debug: Copy logs', () => logger.copyToClipboard());
    GM_registerMenuCommand('NR Debug: Clear logs', () => logger.clear());
  }

  applyRetentionPolicy();

  if (!state.retention && isTopPageUrl(win.location?.href || '')) {
    markTopNavigation(Date.now());
  } else {
    persistLogs();
  }

  addLog('logger:init', {
    userAgent: navigator.userAgent,
    referrer: document.referrer,
    viewport: { width: win.innerWidth, height: win.innerHeight },
  });

  function hookFunction(target, key, label, { includeStack = true, detailBuilder } = {}) {
    if (!target) return;
    const original = target[key];
    if (typeof original !== 'function') return;
    try {
      const wrapped = function wrappedFunction(...args) {
        let detail = { args: safeSerialize(args) };
        if (detailBuilder) {
          try {
            detail = Object.assign(detail, detailBuilder(args));
          } catch (err) {
            detail.detailBuilderError = safeSerialize(err);
          }
        }
        if (includeStack) {
          detail.stack = captureStack(1);
        }
        addLog(label, detail);
        return original.apply(this, args);
      };
      try {
        Object.defineProperty(wrapped, 'name', { value: `${label.replace(/[^a-z0-9_$]+/gi, '_')}_wrapped` });
      } catch {}
      Object.defineProperty(target, key, {
        value: wrapped,
        configurable: true,
        writable: true,
      });
      addLog('hook:success', { target: label });
    } catch (err) {
      addLog('hook:failure', { target: label, error: safeSerialize(err) });
    }
  }

  function monitorEvent(target, type, options) {
    const listener = event => {
      const detail = {
        type,
        target: safeSerialize(event.target),
        visibility: document.visibilityState,
      };
      for (const key of ['reason', 'persisted', 'type']) {
        if (key in event) detail[key] = safeSerialize(event[key]);
      }
      if (event instanceof ErrorEvent) {
        detail.message = event.message;
        detail.filename = event.filename;
        detail.lineno = event.lineno;
        detail.colno = event.colno;
        detail.error = safeSerialize(event.error);
      }
      if (event instanceof PromiseRejectionEvent) {
        detail.reason = safeSerialize(event.reason);
      }
      addLog(`event:${type}`, detail);
    };
    target.addEventListener(type, listener, options);
  }

  // Hook navigation-related APIs
  hookFunction(win.location, 'reload', 'location.reload');
  hookFunction(win.location, 'replace', 'location.replace', {
    detailBuilder(args) {
      const url = args && args.length > 0 ? args[0] : undefined;
      return { url: typeof url === 'string' ? url : undefined };
    },
  });
  hookFunction(win.location, 'assign', 'location.assign', {
    detailBuilder(args) {
      const url = args && args.length > 0 ? args[0] : undefined;
      return { url: typeof url === 'string' ? url : undefined };
    },
  });
  hookFunction(win.history, 'pushState', 'history.pushState', {
    detailBuilder(args) {
      return { url: safeSerialize(args[2]), state: safeSerialize(args[0]) };
    },
  });
  hookFunction(win.history, 'replaceState', 'history.replaceState', {
    detailBuilder(args) {
      return { url: safeSerialize(args[2]), state: safeSerialize(args[0]) };
    },
  });
  hookFunction(win, 'open', 'window.open');
  hookFunction(win, 'stop', 'window.stop');

  // Hook timers to understand reload scheduling
  hookFunction(win, 'setTimeout', 'setTimeout', {
    includeStack: true,
    detailBuilder(args) {
      return { delay: args[1], callback: safeSerialize(args[0]) };
    },
  });
  hookFunction(win, 'clearTimeout', 'clearTimeout', { includeStack: false });

  // Hook fetch and XHR
  if (typeof win.fetch === 'function') {
    const originalFetch = win.fetch.bind(win);
    win.fetch = function nrFetchWrapper(...args) {
      const [input, init] = args;
      const requestInfo = {
        input: safeSerialize(input),
        method: safeSerialize(init?.method || 'GET'),
        credentials: init?.credentials || undefined,
        cache: init?.cache || undefined,
      };
      addLog('fetch:request', requestInfo);
      return originalFetch(...args)
        .then(response => {
          try {
            addLog('fetch:response', {
              url: response.url,
              status: response.status,
              redirected: response.redirected,
              type: response.type,
            });
          } catch (err) {
            addLog('fetch:response-error', safeSerialize(err));
          }
          return response;
        })
        .catch(err => {
          addLog('fetch:error', safeSerialize(err));
          throw err;
        });
    };
    addLog('hook:success', { target: 'fetch' });
  }

  if (win.XMLHttpRequest) {
    const originalOpen = win.XMLHttpRequest.prototype.open;
    const originalSend = win.XMLHttpRequest.prototype.send;
    win.XMLHttpRequest.prototype.open = function nrXHROpen(method, url, async, user, password) {
      this.__nr_log = { method, url, async: async !== false, user: user || null };
      return originalOpen.apply(this, arguments);
    };
    win.XMLHttpRequest.prototype.send = function nrXHRSend(body) {
      const context = this.__nr_log || {};
      addLog('xhr:send', {
        method: context.method,
        url: context.url,
        async: context.async,
        hasBody: body != null,
      });
      this.addEventListener('load', () => {
        addLog('xhr:load', {
          method: context.method,
          url: context.url,
          status: this.status,
          readyState: this.readyState,
        });
      });
      this.addEventListener('error', () => {
        addLog('xhr:error', {
          method: context.method,
          url: context.url,
        });
      });
      this.addEventListener('abort', () => {
        addLog('xhr:abort', {
          method: context.method,
          url: context.url,
        });
      });
      return originalSend.apply(this, arguments);
    };
    addLog('hook:success', { target: 'XMLHttpRequest' });
  }

  // Monitor common lifecycle events
  ['visibilitychange', 'readystatechange', 'DOMContentLoaded'].forEach(type => monitorEvent(document, type));
  [
    'pagehide',
    'pageshow',
    'load',
    'beforeunload',
    'unload',
    'freeze',
    'resume',
    'focus',
    'blur',
    'popstate',
    'hashchange',
  ].forEach(type => monitorEvent(win, type));

  // Add window-specific events
  monitorEvent(win, 'error');
  monitorEvent(win, 'unhandledrejection');

  // Mutation observer to capture major DOM resets
  try {
    const observer = new MutationObserver(mutations => {
      const body = document.body;
      if (!body) return;
      const significant = mutations.some(mutation => {
        if (mutation.type === 'childList' && mutation.target === body && mutation.addedNodes.length > 0) {
          return true;
        }
        if (mutation.type === 'attributes' && mutation.target === body && mutation.attributeName === 'class') {
          return true;
        }
        return false;
      });
      if (significant) {
        addLog('mutation:body-change', {
          childNodes: body.childNodes.length,
          textLength: (body.textContent || '').length,
        });
      }
    });
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    addLog('observer:body-change:armed');
  } catch (err) {
    addLog('observer:body-change:error', { error: safeSerialize(err) });
  }

  // Monitor console logs for NR reload markers
  if (console && typeof console.log === 'function') {
    const originalLog = console.log.bind(console);
    console.log = function nrConsoleLogWrapper(...args) {
      try {
        if (args.some(arg => typeof arg === 'string' && /\[NR\]\s*reload/i.test(arg))) {
          addLog('console:nr-reload', { args: safeSerialize(args), stack: captureStack(1) });
        }
      } catch (err) {
        addLog('console:hook-error', { error: safeSerialize(err) });
      }
      return originalLog(...args);
    };
    addLog('hook:success', { target: 'console.log' });
  }

  // Provide keyboard shortcut to dump logs (Alt+Shift+D)
  win.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && (event.key === 'D' || event.key === 'd')) {
      logger.dumpToConsole();
    }
  }, true);

})();
