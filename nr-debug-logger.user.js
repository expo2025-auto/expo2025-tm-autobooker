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
  const LOG_PREFIX = '[NRDBG]';
  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const state = {
    logs: loadStoredLogs(),
  };

  function loadStoredLogs() {
    try {
      const stored = win.localStorage?.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn(LOG_PREFIX, 'Failed to load stored logs', err);
      return [];
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
    const entry = {
      at: new Date().toISOString(),
      href: win.location?.href || '',
      visibility: document.visibilityState,
      readyState: document.readyState,
      event,
      detail,
    };
    state.logs.push(entry);
    if (state.logs.length > MAX_LOGS * 2) {
      state.logs = state.logs.slice(-MAX_LOGS);
    }
    persistLogs();
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
  hookFunction(win.location, 'replace', 'location.replace');
  hookFunction(win.location, 'assign', 'location.assign');
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
