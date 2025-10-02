// ==UserScript==
// @name         Simple Clock with Server Sync
// @namespace    https://example.com/
// @version      1.0.2
// @description  Display a digital clock that synchronizes with the server time at the start of every minute and highlights the 11s→23s booking window.
// @match        *://*/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || 'dev';
  const CLOCK_ID = 'simple-clock';
  const CLOCK_TIME_CLASS = 'simple-clock__time';
  const CLOCK_VERSION_CLASS = 'simple-clock__version';
  const SYNC_ENDPOINT = window.location.origin;
  let clockElement = null;
  let timeDisplay = null;
  let versionDisplay = null;

  let offset = 0;
  let syncTimeoutId = null;
  let tickIntervalId = null;

  const pad = (value) => String(value).padStart(2, '0');

  const render = () => {
    const now = new Date(Date.now() + offset);
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    ensureClockElement();
    if (timeDisplay) {
      timeDisplay.textContent = `${hours}:${minutes}:${seconds}`;
    }
  };

  const scheduleNextSync = () => {
    if (syncTimeoutId !== null) {
      clearTimeout(syncTimeoutId);
    }

    const now = new Date(Date.now() + offset);
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    const safeDelay = Math.max(msUntilNextMinute, 1000);
    syncTimeoutId = setTimeout(syncWithServer, safeDelay);
  };

  const syncWithServer = async () => {
    try {
      const response = await fetch(SYNC_ENDPOINT, {
        method: 'HEAD',
        cache: 'no-store'
      });
      const dateHeader = response.headers.get('Date');
      if (dateHeader) {
        const serverTime = new Date(dateHeader).getTime();
        if (!Number.isNaN(serverTime)) {
          offset = serverTime - Date.now();
        }
      }
    } catch (error) {
      console.error('Failed to sync with server time:', error);
    } finally {
      scheduleNextSync();
    }
  };

  const startClock = () => {
    if (tickIntervalId === null) {
      tickIntervalId = setInterval(render, 1000);
    }
    ensureClockElement();
    render();
  };

  const ensureClockElement = () => {
    if (clockElement && document.body.contains(clockElement)) {
      ensureClockStructure(clockElement);
      return clockElement;
    }

    const existing = document.getElementById(CLOCK_ID);
    if (existing && document.body.contains(existing)) {
      clockElement = existing;
      applyClockStyles(clockElement);
      ensureClockStructure(clockElement);
      return clockElement;
    }

    const el = document.createElement('div');
    el.id = CLOCK_ID;
    applyClockStyles(el);
    document.body.appendChild(el);
    clockElement = el;
    ensureClockStructure(el);
    return clockElement;
  };

  function applyClockStyles(el) {
    el.style.position = 'fixed';
    el.style.left = '1rem';
    el.style.top = '50%';
    el.style.transform = 'translateY(-50%)';
    el.style.fontFamily = 'monospace';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.alignItems = 'flex-start';
    el.style.gap = '0.25rem';
    el.style.textAlign = 'left';
    el.style.padding = '0.5rem 1rem';
    el.style.background = 'rgba(0, 0, 0, 0.65)';
    el.style.color = '#fff';
    el.style.borderRadius = '0.5rem';
    el.style.boxShadow = '0 0.25rem 0.5rem rgba(0, 0, 0, 0.25)';
    el.style.zIndex = '2147483647';
    el.style.pointerEvents = 'none';
    el.style.userSelect = 'none';
  }

  function applyTimeStyles(el) {
    el.style.fontSize = '2rem';
    el.style.letterSpacing = '0.1em';
    el.style.lineHeight = '1';
  }

  function applyVersionStyles(el) {
    el.style.fontSize = '0.75rem';
    el.style.opacity = '0.8';
    el.style.letterSpacing = '0.05em';
  }

  function ensureClockStructure(el) {
    if (!el) {
      return;
    }
    timeDisplay = el.querySelector(`.${CLOCK_TIME_CLASS}`);
    if (!timeDisplay) {
      timeDisplay = document.createElement('div');
      timeDisplay.className = CLOCK_TIME_CLASS;
      applyTimeStyles(timeDisplay);
      el.appendChild(timeDisplay);
    } else {
      applyTimeStyles(timeDisplay);
    }

    versionDisplay = el.querySelector(`.${CLOCK_VERSION_CLASS}`);
    if (!versionDisplay) {
      versionDisplay = document.createElement('div');
      versionDisplay.className = CLOCK_VERSION_CLASS;
      applyVersionStyles(versionDisplay);
      el.appendChild(versionDisplay);
    } else {
      applyVersionStyles(versionDisplay);
    }

    versionDisplay.textContent = `v${SCRIPT_VERSION}`;
  }

  const init = () => {
    ensureClockElement();
    startClock();
    syncWithServer();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

