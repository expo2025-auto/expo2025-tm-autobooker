// ==UserScript==
// @name         Expo2025 NR Debug Logger
// @namespace    https://github.com/
// @version      0.2.0
// @description  Collects detailed runtime logs to help diagnose unexpected reloads and navigation in Expo2025 NR scripts.
// @match        https://reserve.expo2025.or.jp/*
// @match        https://reserve-visitor.expo2025.or.jp/*
// @match        https://ticket.expo2025.or.jp/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @updateURL    https://github.com/expo2025-auto/expo2025-tm-autobooker/raw/refs/heads/main/nr-debug-logger.user.js
// @downloadURL  https://github.com/expo2025-auto/expo2025-tm-autobooker/raw/refs/heads/main/nr-debug-logger.user.js
// @supportURL   https://github.com/expo2025-auto/expo2025-tm-autobooker/issues
// ==/UserScript==

(function() {
  'use strict';

  const STORAGE_KEY = '__nr_debug_logs_v1__';
  const MAX_LOGS = 600;
  const RETAIN_PRE_MS = 30 * 1000;
  const RETAIN_POST_MS = 10 * 1000;
  const LOG_PREFIX = '[NRDBG]';
  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const UI_CONTAINER_ID = 'nrdbg-panel';
  const UI_TOGGLE_ID = 'nrdbg-toggle';
  const UI_UPDATE_DEBOUNCE = 250;

  const RETENTION_KEY = '__nr_debug_retention_v1__';
  const TOP_PAGE_PATTERNS = [
    /^https:\/\/reserve\.expo2025\.or\.jp\/?(?:[?#]|$)/i,
    /^https:\/\/reserve-visitor\.expo2025\.or\.jp\/?(?:[?#]|$)/i,
    /^https:\/\/ticket\.expo2025\.or\.jp\/?(?:[?#]|$)/i,
  ];

  const state = {
    logs: loadStoredLogs(),
    retention: loadRetentionState(),
    loggingDisabled: false,
  };

  const uiState = {
    initialized: false,
    container: null,
    toggle: null,
    pendingUpdate: null,
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
    scheduleUIRefresh();
    return entry;
  }

  function getLogsAsText(logs = state.logs) {
    return logs.map((entry, idx) => {
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
      scheduleUIRefresh();
    },
    dumpToConsole() {
      console.group(`${LOG_PREFIX} Dump (${state.logs.length})`);
      state.logs.forEach((entry, idx) => {
        console.log(`#${idx + 1}`, entry.at, entry.event, entry.detail);
      });
      console.groupEnd();
    },
    copyToClipboard() {
      const text = getLogsAsText();
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
    saveToFile(filename) {
      const text = getLogsAsText();
      const defaultName = filename || `nr-debug-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      try {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = defaultName;
        const host = document.body || document.documentElement;
        host.appendChild(link);
        link.click();
        requestAnimationFrame(() => {
          host.removeChild(link);
          URL.revokeObjectURL(url);
        });
        console.info(LOG_PREFIX, 'Saved logs to file', defaultName);
      } catch (err) {
        console.warn(LOG_PREFIX, 'Failed to save logs', err);
      }
    },
    getText() {
      return getLogsAsText();
    },
  };

  win.NR_DEBUG_LOGGER = logger;

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('NR Debug: Open panel', () => {
      ensureUI();
      openUIPanel();
    });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUI, { once: true });
  } else {
    ensureUI();
  }

  function ensureUI() {
    if (uiState.initialized) {
      scheduleUIRefresh();
      return;
    }
    uiState.initialized = true;

    injectUIStyles();

    uiState.toggle = document.createElement('button');
    uiState.toggle.id = UI_TOGGLE_ID;
    uiState.toggle.type = 'button';
    uiState.toggle.textContent = 'NR Debug';
    uiState.toggle.title = 'Open NR Debug Logger panel';
    uiState.toggle.addEventListener('click', () => {
      ensureUIContainer();
      toggleUIPanel();
    });
    const toggleHost = document.body || document.documentElement;
    toggleHost.appendChild(uiState.toggle);

    scheduleUIRefresh();
  }

  function ensureUIContainer() {
    if (uiState.container) return;
    const container = document.createElement('div');
    container.id = UI_CONTAINER_ID;
    container.innerHTML = `
      <div class="nrdbg-panel-header">
        <span class="nrdbg-panel-title">NR Debug Logger</span>
        <button type="button" class="nrdbg-close" data-action="close" title="Close">×</button>
      </div>
      <div class="nrdbg-panel-body">
        <div class="nrdbg-summary">
          <div><span class="nrdbg-label">Stored logs:</span> <span data-field="count">0</span></div>
          <div><span class="nrdbg-label">Last event:</span> <span data-field="last"></span></div>
          <div><span class="nrdbg-label">Logging window:</span> <span data-field="window"></span></div>
          <div><span class="nrdbg-label">Status:</span> <span data-field="status"></span></div>
        </div>
        <textarea class="nrdbg-preview" data-field="preview" readonly></textarea>
        <div class="nrdbg-actions">
          <button type="button" data-action="refresh">Refresh</button>
          <button type="button" data-action="copy">Copy</button>
          <button type="button" data-action="save">Save</button>
          <button type="button" data-action="clear">Clear</button>
        </div>
      </div>
    `;

    container.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.getAttribute('data-action');
      if (action === 'close') {
        closeUIPanel();
      } else if (action === 'refresh') {
        updateUIPanel();
      } else if (action === 'copy') {
        logger.copyToClipboard();
      } else if (action === 'save') {
        logger.saveToFile();
      } else if (action === 'clear') {
        logger.clear();
      }
    });

    const host = document.body || document.documentElement;
    host.appendChild(container);
    uiState.container = container;
    updateUIPanel();
  }

  function injectUIStyles() {
    if (document.getElementById('nrdbg-styles')) return;
    const style = document.createElement('style');
    style.id = 'nrdbg-styles';
    style.textContent = `
      #${UI_TOGGLE_ID} {
        position: fixed;
        bottom: 1rem;
        right: 1rem;
        z-index: 2147483646;
        background: rgba(34, 34, 34, 0.85);
        color: #fff;
        border: none;
        border-radius: 999px;
        padding: 0.5rem 1rem;
        font-size: 12px;
        font-family: system-ui, sans-serif;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      }
      #${UI_TOGGLE_ID}:hover {
        background: rgba(20, 20, 20, 0.95);
      }
      #${UI_TOGGLE_ID}.nrdbg-active {
        background: rgba(0, 132, 255, 0.85);
      }
      #${UI_CONTAINER_ID} {
        position: fixed;
        bottom: 4rem;
        right: 1rem;
        width: min(420px, calc(100vw - 2rem));
        max-height: min(70vh, 500px);
        display: none;
        flex-direction: column;
        background: rgba(15, 15, 15, 0.95);
        color: #f3f3f3;
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
        font-family: system-ui, sans-serif;
        z-index: 2147483647;
        overflow: hidden;
        backdrop-filter: blur(6px);
      }
      #${UI_CONTAINER_ID}.nrdbg-open {
        display: flex;
      }
      #${UI_CONTAINER_ID} .nrdbg-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0.75rem;
        background: rgba(255, 255, 255, 0.05);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      #${UI_CONTAINER_ID} .nrdbg-panel-title {
        font-weight: 600;
        font-size: 14px;
      }
      #${UI_CONTAINER_ID} .nrdbg-close {
        background: transparent;
        color: inherit;
        border: none;
        font-size: 18px;
        cursor: pointer;
        padding: 0.25rem 0.5rem;
      }
      #${UI_CONTAINER_ID} .nrdbg-panel-body {
        padding: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      #${UI_CONTAINER_ID} .nrdbg-summary {
        font-size: 12px;
        display: grid;
        gap: 0.25rem;
      }
      #${UI_CONTAINER_ID} .nrdbg-label {
        opacity: 0.7;
        margin-right: 0.25rem;
      }
      #${UI_CONTAINER_ID} .nrdbg-preview {
        width: 100%;
        min-height: 160px;
        resize: vertical;
        background: rgba(0, 0, 0, 0.45);
        color: inherit;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 0.5rem;
        font-family: ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 11px;
        line-height: 1.4;
      }
      #${UI_CONTAINER_ID} .nrdbg-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      #${UI_CONTAINER_ID} .nrdbg-actions button {
        flex: 1;
        min-width: 80px;
        background: rgba(255, 255, 255, 0.12);
        color: inherit;
        border: none;
        border-radius: 6px;
        padding: 0.45rem 0.5rem;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s ease;
      }
      #${UI_CONTAINER_ID} .nrdbg-actions button:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      @media (max-width: 480px) {
        #${UI_TOGGLE_ID} {
          bottom: 0.75rem;
          right: 0.75rem;
        }
        #${UI_CONTAINER_ID} {
          right: 0.5rem;
          left: 0.5rem;
          width: auto;
        }
      }
    `;
    const styleHost = document.head || document.documentElement;
    styleHost.appendChild(style);
  }

  function updateUIPanel() {
    if (!uiState.container) return;
    const countField = uiState.container.querySelector('[data-field="count"]');
    const lastField = uiState.container.querySelector('[data-field="last"]');
    const windowField = uiState.container.querySelector('[data-field="window"]');
    const statusField = uiState.container.querySelector('[data-field="status"]');
    const previewField = uiState.container.querySelector('[data-field="preview"]');

    const logs = state.logs.slice();
    countField.textContent = String(logs.length);

    if (logs.length > 0) {
      const last = logs[logs.length - 1];
      lastField.textContent = `${last.at} (${last.event})`;
    } else {
      lastField.textContent = 'No logs captured yet';
    }

    if (state.retention) {
      const start = new Date(state.retention.windowStart).toISOString();
      const end = new Date(state.retention.windowEnd).toISOString();
      windowField.textContent = `${start} → ${end}`;
    } else {
      windowField.textContent = `Rolling ${Math.round(RETAIN_PRE_MS / 1000)}s window before top-level navigation`;
    }

    statusField.textContent = state.loggingDisabled
      ? 'Logging paused (window elapsed)'
      : 'Logging active';

    const previewLogs = logs.slice(-50);
    previewField.value = getLogsAsText(previewLogs);
  }

  function toggleUIPanel() {
    if (!uiState.container) {
      ensureUIContainer();
    }
    if (!uiState.container) return;
    const isOpen = uiState.container.classList.toggle('nrdbg-open');
    uiState.toggle?.classList.toggle('nrdbg-active', isOpen);
    if (isOpen) {
      updateUIPanel();
    }
  }

  function openUIPanel() {
    ensureUIContainer();
    if (!uiState.container) return;
    uiState.container.classList.add('nrdbg-open');
    uiState.toggle?.classList.add('nrdbg-active');
    updateUIPanel();
  }

  function closeUIPanel() {
    if (!uiState.container) return;
    uiState.container.classList.remove('nrdbg-open');
    uiState.toggle?.classList.remove('nrdbg-active');
  }

  function scheduleUIRefresh() {
    if (!uiState.initialized) return;
    if (uiState.pendingUpdate) {
      clearTimeout(uiState.pendingUpdate);
    }
    uiState.pendingUpdate = setTimeout(() => {
      uiState.pendingUpdate = null;
      updateUIPanel();
    }, UI_UPDATE_DEBOUNCE);
  }

})();
