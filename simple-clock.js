// ==UserScript==
// @name         Simple Clock with Server Sync
// @namespace    https://example.com/
// @version      1.0.1
// @description  Display a digital clock that synchronizes with the server time at the start of every minute.
// @match        *://*/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  const CLOCK_ID = 'simple-clock';
  const SYNC_ENDPOINT = window.location.origin;
  let clockElement = null;

  let offset = 0;
  let syncTimeoutId = null;
  let tickIntervalId = null;

  const pad = (value) => String(value).padStart(2, '0');

  const render = () => {
    const now = new Date(Date.now() + offset);
    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    ensureClockElement().textContent = `${hours}:${minutes}:${seconds}`;
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
    if (clockElement) {
      return clockElement;
    }

    const existing = document.getElementById(CLOCK_ID);
    if (existing) {
      clockElement = existing;
      return clockElement;
    }

    const el = document.createElement('div');
    el.id = CLOCK_ID;
    el.style.fontFamily = 'monospace';
    el.style.fontSize = '2rem';
    el.style.letterSpacing = '0.1em';
    el.style.textAlign = 'center';
    el.style.margin = '1rem';
    document.body.appendChild(el);
    clockElement = el;
    return clockElement;
  };

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

