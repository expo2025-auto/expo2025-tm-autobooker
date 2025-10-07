// ==UserScript==
// @name         β　Expo2025 予約変更
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  現在の予約時刻より早い空き枠を自動選択し、確認モーダルまで進めて変更を完了します。失敗トースト検出時は同分内4回までリトライ。
// @downloadURL  https://github.com/expo2025-auto/expo2025-tm-autobooker/raw/refs/heads/main/v2-reservation-chenge-earlier.js
// @updateURL    https://github.com/expo2025-auto/expo2025-tm-autobooker/raw/refs/heads/main/v2-reservation-chenge-earlier.js
// @author       you
// @match        https://ticket.expo2025.or.jp/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      ticket.expo2025.or.jp
// ==/UserScript==

(function () {
  'use strict';
// ===== Inject page-context guard at document-start (persist across pages) =====
(function __nr_installTopGuardPage(){
  try{
    function __nr_page_guard(){
      try{
        var ts = sessionStorage.getItem('__nr_blockTopUntil_ts');
        window.__nr_blockTopUntil = ts ? (+ts) : 0;
      }catch(e){
        window.__nr_blockTopUntil = 0;
      }

      var H = history;

      function isTop(u){
        try{
          var p = new URL(String(u || ''), location.href).pathname;
          return p === '/'; // '/?x' '/#y' もトップ扱い
        }catch(_){
          var s = String(u || '');
          if (s === '/' || s === location.origin + '/' || s === location.origin) return true;
          return /^https?:\/\/ticket\.expo2025\.or\.jp(?:\/(?:[?#].*)?)?$/.test(s);
        }
      }

      function makeGuardedPush(orig){
        var fn = function(state, title, url){
          if ((window.__nr_blockTopUntil||0) > Date.now() && isTop(url)){
            try{ console.warn('[NR] blocked pushState(\"/\") during reload window'); }catch(_){}
            return;
          }
          return orig.apply(this, arguments);
        };
        try{ Object.defineProperty(fn, '__nrGuarded', { value: true, configurable: false }); }catch(_){ fn.__nrGuarded = true; }
        return fn;
      }

      function makeGuardedReplace(orig){
        var fn = function(state, title, url){
          if ((window.__nr_blockTopUntil||0) > Date.now() && isTop(url)){
            try{ console.warn('[NR] blocked replaceState(\"/\") during reload window'); }catch(_){}
            return;
          }
          return orig.apply(this, arguments);
        };
        try{ Object.defineProperty(fn, '__nrGuarded', { value: true, configurable: false }); }catch(_){ fn.__nrGuarded = true; }
        return fn;
      }

      function lockProp(obj, key, value){
        try{ Object.defineProperty(obj, key, { value: value, writable:false, configurable:false }); }
        catch(_){ try{ obj[key] = value; }catch(__){} }
      }

      function applyGuard(lock){
        var currentPush = H.pushState.bind(H);
        var currentReplace = H.replaceState.bind(H);
        var guardedPush = makeGuardedPush(currentPush);
        var guardedReplace = makeGuardedReplace(currentReplace);
        H.pushState = guardedPush;
        H.replaceState = guardedReplace;
        if (lock){
          lockProp(H, 'pushState', guardedPush);
          lockProp(H, 'replaceState', guardedReplace);
        }
      }

      var watchTimer = null;
      function startWatch(durationMs){
        var stopAt = Date.now() + (durationMs||15000);
        if (watchTimer) clearInterval(watchTimer);
        watchTimer = setInterval(function(){
          var needReapply = !H.pushState.__nrGuarded || !H.replaceState.__nrGuarded;
          var guardActive = (window.__nr_blockTopUntil||0) > Date.now();
          if (needReapply){ applyGuard(true); return; }
          if (!guardActive && Date.now() > stopAt){ clearInterval(watchTimer); watchTimer = null; }
        }, 60);
      }

      applyGuard(true);
      startWatch(15000);

      // リロード窓をページ間で共有
      window.__nr_armTopGuard = function(ms){
        var until = Date.now() + (ms || 10000);
        window.__nr_blockTopUntil = until;
        try{ sessionStorage.setItem('__nr_blockTopUntil_ts', String(until)); }catch(_){}
      };
      // 監視を延長（他スクリプトの再上書きを即復旧）
      window.__nr_reinforceHistoryGuard = function(ms){
        try{ applyGuard(true); }catch(_){}
        startWatch(ms||10000);
      };
    }

    // 文字列化せずに toString() で安全注入（エスケープ事故を防ぐ）
    var s = document.createElement('script');
    s.textContent = '(' + __nr_page_guard.toString() + ')();';
    (document.documentElement || document.head || document.body).appendChild(s);
    s.parentNode && s.parentNode.removeChild(s);
  }catch(e){}
})();
// ===== End inject =====

  /***** 調整ポイント（サイト改修時はここを直す） *****/
  const SELECTORS = {
    timeButton: 'td button, td [role="button"], [data-time-slot] button, [data-time-slot] [role="button"], div[role="button"][class*="style_main__button__"], button[class*="style_main__button__"], div[role="button"][aria-pressed]',
    activeButton: [
      '[aria-pressed="true"]',
      '[aria-selected="true"]',
      '[aria-current]:not([aria-current="false"])',
      '[aria-checked="true"]',
      '[data-current="true"]',
      '[data-active="true"]',
      '[data-selected="true"]',
      '[data-is-current="true"]',
      '[data-is-active="true"]',
      '[data-is-selected="true"]',
    ].join(', '),
    timePattern: /([01]?\d|2[0-3]):[0-5]\d/,
    setVisitButtonText: /来場日時を設定する/,
    confirmButtonText: /来場日時を変更する/,
    confirmToastButton: [
      'button.style_next_button__N_pbs',
      '.style_next_button__N_pbs[role="button"]',
    ],
    successToast: /来場日時が設定されました/,
    failureToast: /定員を超えたため、ご希望の時間帯は選択できませんでした/,
  };
// ===== iOS top-guard window setter (userscript side) =====
function armTopGuard(ms = 100000){
  var until = Date.now() + ms;
  try { window.__nr_blockTopUntil = until; } catch(_){}
  try { sessionStorage.setItem('__nr_blockTopUntil_ts', String(until)); } catch(_){}
  try {
    if (typeof window.__nr_reinforceHistoryGuard === 'function') {
      window.__nr_reinforceHistoryGuard(ms);
    }
  } catch(_){}
}

  // 予約操作のタイムアウト/待機
  const ACTION_TIMEOUT_MS = 10_000;
  const RECENT_CHECK_THRESHOLD_MS = 10_000;
  const DOM_POLL_INTERVAL_MS = 150;

  // リロード許可ウィンドウ（サーバー時刻）

  const WINDOW_START = 13; // >= 13s
  const WINDOW_END = 23; // < 24s


  // 予約失敗時の復旧リロード 最大回数（秒に関係なく実施）
  const MAX_ATTEMPTS_PER_MINUTE = 3;
  const MAX_RELOADS_PER_MINUTE = 4;
  const ATTEMPT_STORAGE_KEY = 'expo_adv_attempt_info_v3';
  const RELOAD_STORAGE_KEY = 'expo_adv_reload_info_v1';

  // トグル保存キー
  const ENABLE_KEY = 'expo_adv_enable_v2';
  const DATE_PREFERENCE_KEY = 'expo_adv_target_date_pref_v1';
  const TARGET_TIME_PREFERENCE_KEY = 'expo_adv_target_time_pref_v1';
  const TARGET_TIME_OPTIONS = [
    { minutes: 9 * 60, label: '9時' },
    { minutes: 10 * 60, label: '10時' },
  ];
  const PREFERRED_SLOT_MINUTES = [9 * 60, 10 * 60, 11 * 60, 12 * 60];
  let enabledFallback = false;

  const STATUS_LABELS = {
    idle: '待機中',
    running: '実行中',
    done: '完了',
  };
  let currentStatus = 'idle';
  let statusIndicator;
  let currentSlotIndicator;
  let currentSlotDisplay = { label: '', estimated: false, text: '未取得' };
  let nextUpdateIndicator;
  let nextUpdateTimerId = null;
  let reloadsThisMinute = 0;
  let sameDayPreference = true;
  let targetDatePreference = '';
  let targetTimePreferences = {};
  let sameDayCheckboxControl = null;
  let dateInputControl = null;
  let timeCheckboxControls = new Map();
  let lastTargetDateLogKey = '';
  let lastTargetDateLogTime = 0;

  initializeDatePreferenceState();
  initializeTimePreferenceState();

  function setStatus(state) {
    currentStatus = state;
    if (statusIndicator) {
      const label = STATUS_LABELS[state] || state;
      statusIndicator.textContent = label;
      statusIndicator.dataset.status = state;
    }
    updateNextUpdateDisplay();
  }

  function setCurrentSlotDisplay(label, options = {}) {
    const normalized = label ? String(label).trim() : '';
    const estimated = !!options.estimated;
    const fallback = options.fallback || '未取得';
    let text;
    if (normalized) {
      text = estimated ? `${normalized}（推定）` : normalized;
    } else {
      text = fallback;
    }
    currentSlotDisplay = { label: normalized, estimated, text };
    if (currentSlotIndicator) {
      currentSlotIndicator.textContent = text;
      if (estimated) {
        currentSlotIndicator.dataset.estimated = '1';
      } else {
        delete currentSlotIndicator.dataset.estimated;
      }
    }
  }

  function formatRemaining(ms) {
    const clamped = Math.max(0, ms);
    if (clamped >= 10_000) {
      const seconds = Math.floor(clamped / 1000);
      return `${seconds}秒`;
    }
    return `${(clamped / 1000).toFixed(1)}秒`;
  }

  function zeroPad(num, width = 2) {
    return String(num).padStart(width, '0');
  }

  function normalizeDateValue(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const iso = raw.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/);
    if (iso) {
      const y = parseInt(iso[1], 10);
      const m = parseInt(iso[2], 10);
      const d = parseInt(iso[3], 10);
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        return `${zeroPad(y, 4)}-${zeroPad(m)}-${zeroPad(d)}`;
      }
    }
    const compact = raw.match(/(\d{4})(\d{2})(\d{2})/);
    if (compact) {
      const y = parseInt(compact[1], 10);
      const m = parseInt(compact[2], 10);
      const d = parseInt(compact[3], 10);
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        return `${zeroPad(y, 4)}-${zeroPad(m)}-${zeroPad(d)}`;
      }
    }
    const jp = raw.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
    if (jp) {
      const y = parseInt(jp[1], 10);
      const m = parseInt(jp[2], 10);
      const d = parseInt(jp[3], 10);
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        return `${zeroPad(y, 4)}-${zeroPad(m)}-${zeroPad(d)}`;
      }
    }
    const jpNoYear = raw.match(/(\d{1,2})月\s*(\d{1,2})日/);
    if (jpNoYear) {
      const now = new Date();
      const y = now.getFullYear();
      const m = parseInt(jpNoYear[1], 10);
      const d = parseInt(jpNoYear[2], 10);
      if (Number.isFinite(m) && Number.isFinite(d)) {
        return `${zeroPad(y, 4)}-${zeroPad(m)}-${zeroPad(d)}`;
      }
    }
    return '';
  }

  function loadDatePreferences() {
    try {
      const stored = sessionStorage.getItem(DATE_PREFERENCE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  }

  function loadTimePreferences() {
    try {
      const stored = sessionStorage.getItem(TARGET_TIME_PREFERENCE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return {};
      const normalized = {};
      for (const option of TARGET_TIME_OPTIONS) {
        const key = String(option.minutes);
        normalized[key] = !!parsed[key];
      }
      return normalized;
    } catch {
      return {};
    }
  }

  function saveDatePreferences() {
    const payload = {
      sameDay: sameDayPreference,
      targetDate: targetDatePreference,
    };
    try {
      sessionStorage.setItem(DATE_PREFERENCE_KEY, JSON.stringify(payload));
    } catch {
      // storage unavailable
    }
  }

  function saveTimePreferences() {
    const payload = {};
    for (const option of TARGET_TIME_OPTIONS) {
      const key = String(option.minutes);
      payload[key] = !!targetTimePreferences[key];
    }
    try {
      sessionStorage.setItem(TARGET_TIME_PREFERENCE_KEY, JSON.stringify(payload));
    } catch {
      // storage unavailable
    }
  }

  function initializeDatePreferenceState() {
    const stored = loadDatePreferences();
    const normalized = normalizeDateValue(stored.targetDate);
    if (stored.sameDay === false && normalized) {
      sameDayPreference = false;
      targetDatePreference = normalized;
    } else {
      sameDayPreference = true;
      targetDatePreference = '';
    }
  }

  function initializeTimePreferenceState() {
    targetTimePreferences = loadTimePreferences();
    updateTimeControlState();
  }

  function updateDateControlState() {
    if (sameDayCheckboxControl) {
      sameDayCheckboxControl.checked = sameDayPreference;
    }
    if (dateInputControl) {
      dateInputControl.disabled = sameDayPreference;
      dateInputControl.value = targetDatePreference;
    }
  }

  function updateTimeControlState() {
    if (!timeCheckboxControls || timeCheckboxControls.size === 0) return;
    for (const option of TARGET_TIME_OPTIONS) {
      const checkbox = timeCheckboxControls.get(option.minutes);
      if (checkbox) {
        checkbox.checked = !!targetTimePreferences[String(option.minutes)];
      }
    }
  }

  function setSameDayPreference(next) {
    const normalized = !!next;
    if (normalized) {
      sameDayPreference = true;
      targetDatePreference = '';
    } else {
      sameDayPreference = false;
    }
    saveDatePreferences();
    updateDateControlState();
  }

  function setTargetDatePreference(value) {
    const normalized = normalizeDateValue(value);
    targetDatePreference = normalized;
    if (normalized) {
      sameDayPreference = false;
    } else {
      sameDayPreference = true;
    }
    saveDatePreferences();
    updateDateControlState();
  }

  function isSameDayPreference() {
    return sameDayPreference;
  }

  function getTargetDatePreference() {
    return targetDatePreference;
  }

  function setTimePreference(minutes, enabled) {
    const key = String(minutes);
    const next = !!enabled;
    if (targetTimePreferences[key] === next) return;
    targetTimePreferences[key] = next;
    saveTimePreferences();
    updateTimeControlState();
  }

  function getPreferredTargetMinutes() {
    const result = [];
    for (const option of TARGET_TIME_OPTIONS) {
      if (targetTimePreferences[String(option.minutes)]) {
        result.push(option.minutes);
      }
    }
    return result;
  }

  function describePreferredTimes(minutesList) {
    if (!minutesList || !minutesList.length) return '';
    const labels = TARGET_TIME_OPTIONS
      .filter((option) => minutesList.includes(option.minutes))
      .map((option) => option.label);
    return labels.join('、');
  }

  function logTargetDateMessage(key, message, intervalMs = 5000) {
    const now = Date.now();
    if (key !== lastTargetDateLogKey || now - lastTargetDateLogTime > intervalMs) {
      log(message);
      lastTargetDateLogKey = key;
      lastTargetDateLogTime = now;
    }
  }

  function getSyncedNowMs() {
    if (hasServerTime) {
      return Date.now() + serverTimeOffsetMs;
    }
    return Date.now();
  }

  function getNextUpdateRemainingMs() {
    const nowMs = getSyncedNowMs();
    const msIntoMinute = ((nowMs % 60_000) + 60_000) % 60_000;
    const windowStartMs = WINDOW_START * 1000;
    const windowEndMs = WINDOW_END * 1000;
    if (reloadsThisMinute >= MAX_RELOADS_PER_MINUTE) {
      if (msIntoMinute < windowStartMs) {
        return windowStartMs - msIntoMinute;
      }
      return 60_000 - msIntoMinute + windowStartMs;
    }
    if (msIntoMinute >= windowStartMs && msIntoMinute < windowEndMs) {
      return 0;
    }
    if (msIntoMinute < windowStartMs) {
      return windowStartMs - msIntoMinute;
    }
    return 60_000 - msIntoMinute + windowStartMs;
  }

  function updateNextUpdateDisplay() {
    if (!nextUpdateIndicator) return;
    let text = '---';
    if (!isEnabled()) {
      text = '停止中';
    } else if (currentStatus === 'done') {
      text = '完了';
    } else if (currentStatus === 'running') {
      text = '実行中';
    } else if (attemptBlockedUntil > Date.now()) {
      text = formatRemaining(attemptBlockedUntil - Date.now());
    } else {
      const remainingMs = Math.max(0, getNextUpdateRemainingMs());
      text = formatRemaining(remainingMs);
    }
    nextUpdateIndicator.textContent = text;
  }

  const SLOT_SCOPE_SELECTORS = [
    '[role="tabpanel"]',
    '[data-date]',
    '[data-day]',
    '[data-tab-id]',
    '[data-date-value]',
    'tbody',
    'table',
  ];
  const SLOT_SCOPE_ATTRIBUTE_KEYS = ['data-date-value', 'data-date', 'data-day', 'data-tab-id'];

  let lastLoggedCurrentSlotSignature = null;
  let lastLoggedUsedStoredForCurrent = false;
  let lastKnownCurrentSlot = null;
  let lastActiveDetectionFailureLogTime = 0;
  let lastSuccessfulCheckTime = 0;
  let lastReloadDeferLogBucket = null;
  let checkCompletedThisLoad = false;

  const ACTIVE_TEXT_PATTERNS = [
    /現在.*予約/,
    /予約.*中/,
    /予約.*済/,
    /ご予約中/,
    /ご予約済/,
    /選択.*中/,
    /選択.*済/,
    /reserved/i,
    /currentreservation/i,
    /yourreservation/i,
    /booked/i,
  ];

  const ACTIVE_KEYWORD_REGEXPS = [
    /(?:^|[^a-z0-9])current(?:[^a-z0-9]|$)/i,
    /(?:^|[^a-z0-9])selected(?:[^a-z0-9]|$)/i,
    /(?:^|[^a-z0-9])active(?:[^a-z0-9]|$)/i,
    /(?:^|[^a-z0-9])checked(?:[^a-z0-9]|$)/i,
    /(?:^|[^a-z0-9])chosen(?:[^a-z0-9]|$)/i,
    /(?:^|[^a-z0-9])reserved(?:[^a-z0-9]|$)/i,
    /(?:^|[^a-z0-9])booked(?:[^a-z0-9]|$)/i,
    /(?:^|[^a-z0-9])mine(?:[^a-z0-9]|$)/i,
    /(?:^|[^a-z0-9])own(?:[^a-z0-9]|$)/i,
  ];

  function textMatchesActive(text) {
    if (!text) return false;
    const normalized = String(text).replace(/\s+/g, '');
    if (!normalized) return false;
    return ACTIVE_TEXT_PATTERNS.some((re) => re.test(normalized));
  }

  function containsActiveKeyword(str) {
    if (!str) return false;
    const lower = String(str).toLowerCase();
    if (lower.includes('inactive')) return false;
    return ACTIVE_KEYWORD_REGEXPS.some((re) => re.test(lower));
  }

  function collectActiveHintsFromSelf(el) {
    const hints = [];
    if (!el) return hints;
    try {
      if (SELECTORS.activeButton && el.matches(SELECTORS.activeButton)) {
        hints.push('selector-match');
      }
    } catch (e) {
      // invalid selector situations are ignored
    }
    const ariaAttrs = ['aria-pressed', 'aria-selected', 'aria-current', 'aria-checked'];
    for (const name of ariaAttrs) {
      const value = el.getAttribute(name);
      if (value && value !== 'false') {
        hints.push(`${name}=${value}`);
      }
    }
    const dataset = el.dataset || {};
    for (const [key, value] of Object.entries(dataset)) {
      const valStr = value == null ? '' : String(value);
      if (containsActiveKeyword(key) || containsActiveKeyword(valStr) || (valStr === '1' && containsActiveKeyword(key))) {
        hints.push(`data-${key}=${valStr}`);
      } else if (textMatchesActive(valStr)) {
        hints.push(`data-${key}~text`);
      }
    }
    const attributes = Array.from(el.attributes || []);
    for (const attr of attributes) {
      const name = attr.name;
      if (!name || name.startsWith('data-') || name.startsWith('aria-') || name === 'class') continue;
      const value = attr.value;
      if (containsActiveKeyword(name) || containsActiveKeyword(value)) {
        hints.push(`${name}=${value}`);
      } else if (textMatchesActive(value)) {
        hints.push(`${name}~text`);
      }
    }
    const classes = el.classList ? Array.from(el.classList) : (typeof el.className === 'string' ? el.className.split(/\s+/) : []);
    for (const cls of classes) {
      if (!cls) continue;
      if (containsActiveKeyword(cls)) {
        hints.push(`class:${cls}`);
      } else if (textMatchesActive(cls)) {
        hints.push(`class~text:${cls}`);
      }
    }
    const labelText = [el.getAttribute('aria-label'), el.getAttribute('title')].filter(Boolean).join(' ').trim();
    if (labelText && textMatchesActive(labelText)) {
      hints.push(`label:${labelText}`);
    }
    const elementText = (el.innerText || el.textContent || '').trim();
    if (elementText && textMatchesActive(elementText)) {
      hints.push(`text:${elementText}`);
    }
    const altNodes = el.querySelectorAll ? el.querySelectorAll('[alt]') : [];
    for (const node of altNodes) {
      const alt = node.getAttribute('alt') || '';
      if (alt && textMatchesActive(alt)) {
        hints.push(`alt:${alt}`);
        break;
      }
    }
    return hints;
  }

  function collectActiveHints(el) {
    const hints = collectActiveHintsFromSelf(el);
    let depth = 0;
    let parent = el ? el.parentElement : null;
    while (parent && depth < 4) {
      const parentHints = collectActiveHintsFromSelf(parent);
      if (parentHints.length) {
        for (const hint of parentHints) {
          hints.push(`ancestor${depth + 1}:${hint}`);
        }
        break;
      }
      const parentText = (parent.innerText || parent.textContent || '').trim();
      if (parentText && textMatchesActive(parentText)) {
        hints.push(`ancestor${depth + 1}-text:${parentText}`);
        break;
      }
      parent = parent.parentElement;
      depth += 1;
    }
    return hints;
  }

  function scoreActiveHints(hints) {
    if (!hints || !hints.length) return 0;
    let score = 0;
    for (const rawHint of hints) {
      let hint = rawHint;
      if (rawHint.startsWith('ancestor')) {
        score += 15;
        const idx = rawHint.indexOf(':');
        hint = idx >= 0 ? rawHint.slice(idx + 1) : rawHint;
      }
      if (hint === 'selector-match') {
        score += 100;
      } else if (/aria-pressed/.test(hint)) {
        score += 90;
      } else if (/aria-selected/.test(hint)) {
        score += 85;
      } else if (/aria-current/.test(hint)) {
        score += 80;
      } else if (/aria-checked/.test(hint)) {
        score += 75;
      } else if (/data-/.test(hint)) {
        score += 60;
      } else if (/class/.test(hint)) {
        score += 45;
      } else if (/label/.test(hint) || /text/.test(hint) || /alt/.test(hint)) {
        score += 40;
      } else {
        score += 10;
      }
    }
    return score;
  }

  function normalizeLabel(str) {
    return (str || '').replace(/\s+/g, '').trim();
  }

  function findEntryByStoredSignature(entries, stored) {
    if (!stored) return null;
    const scored = [];
    for (const entry of entries) {
      const info = entry.info;
      let score = 0;
      if (stored.scopeSignature && stored.scopeSignature === (entry.scopeSignature || '')) {
        score += 8;
      }
      if (stored.minutes != null && info && info.minutes === stored.minutes) {
        score += 4;
      }
      if (stored.label && info && normalizeLabel(info.label) === normalizeLabel(stored.label)) {
        score += 2;
      }
      if (stored.text && normalizeLabel(entry.text) === normalizeLabel(stored.text)) {
        score += 1;
      }
      if (!score) continue;
      scored.push({ entry, score });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const runnerUp = scored[1];
    const threshold = stored.scopeSignature ? 8 : (stored.minutes != null ? 4 : 2);
    if (top.score < threshold) return null;
    if (runnerUp && runnerUp.score === top.score) return null;
    return top.entry;
  }

  /***** 便利ユーティリティ *****/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function collectSlotButtons(root = document) {
    const nodes = $$(SELECTORS.timeButton, root);
    if (!nodes.length) return [];
    const seen = new Set();
    const buttons = [];
    for (const node of nodes) {
      const btn = node.closest('button, [role="button"]');
      if (!btn || seen.has(btn)) continue;
      seen.add(btn);
      buttons.push(btn);
    }
    return buttons;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(...args) {
    console.log('[ExpoAdvance]', ...args);
  }

  // :matches() 疑似を簡易サポート（innerTextでフィルタ）
  function isElementVisible(el) {
    if (!el) return false;
    if (el.hasAttribute('hidden')) return false;
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return !!(rect.width && rect.height);
  }

  function isElementEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.hasAttribute('disabled')) return false;
    if (el.dataset && el.dataset.disabled === 'true') return false;
    return true;
  }

  function triggerButtonClick(button) {
    if (!button) return;
    try {
      if (typeof button.focus === 'function') {
        button.focus({ preventScroll: true });
      }
    } catch {
      // ignore focus issues
    }
    if (typeof button.click === 'function') {
      button.click();
    }
    const events = [
      { type: 'pointerdown', init: { bubbles: true, cancelable: true, pointerType: 'mouse' }, pointer: true },
      { type: 'mousedown', init: { bubbles: true, cancelable: true } },
      { type: 'pointerup', init: { bubbles: true, cancelable: true, pointerType: 'mouse' }, pointer: true },
      { type: 'mouseup', init: { bubbles: true, cancelable: true } },
      { type: 'click', init: { bubbles: true, cancelable: true } },
    ];
    for (const evt of events) {
      if (evt.pointer) {
        if (typeof PointerEvent === 'function') {
          button.dispatchEvent(new PointerEvent(evt.type, evt.init));
        }
        continue;
      }
      button.dispatchEvent(new MouseEvent(evt.type, evt.init));
    }
  }

  function findButtonByText(patterns, options = {}) {
    const { requireVisible = false, requireEnabled = false } = options;
    const pats = Array.isArray(patterns) ? patterns : [patterns];
    const buttons = $$('button, [role="button"]');
    for (const b of buttons) {
      if (requireVisible && !isElementVisible(b)) continue;
      if (requireEnabled && !isElementEnabled(b)) continue;
      const t = (b.innerText || b.textContent || '').trim();
      if (pats.some(p => (p instanceof RegExp ? p.test(t) : t.includes(p)))) return b;
    }
    return null;
  }

  function loadAttemptInfo() {
    try {
      return JSON.parse(sessionStorage.getItem(ATTEMPT_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveAttemptInfo(info) {
    try {
      sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(info));
    } catch {
      // storage full or unavailable
    }
  }

  function loadReloadInfo() {
    try {
      return JSON.parse(sessionStorage.getItem(RELOAD_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function saveReloadInfo(info) {
    try {
      sessionStorage.setItem(RELOAD_STORAGE_KEY, JSON.stringify(info));
    } catch {
      // storage full or unavailable
    }
  }

  function resetReloadInfo(bucket) {
    const info = { bucket, count: 0, loggedMinute: null };
    saveReloadInfo(info);
    return info;
  }

  async function registerAttempt() {
    const now = await getServerDate();
    const nowMs = now.getTime();
    const bucket = Math.floor(nowMs / 60_000);
    const info = loadAttemptInfo();
    if (info.minute !== bucket) {
      info.minute = bucket;
      info.count = 0;
      info.logged = false;
    }
    const count = info.count || 0;
    if (count >= MAX_ATTEMPTS_PER_MINUTE) {
      const nextMinuteMs = (bucket + 1) * 60_000;
      const waitMs = Math.max(0, nextMinuteMs - nowMs);
      attemptBlockedUntil = Date.now() + waitMs;
      updateNextUpdateDisplay();
      if (!info.logged) {
        log(`この分の予約変更試行上限(${MAX_ATTEMPTS_PER_MINUTE}回)に到達。${Math.ceil(waitMs / 1000)}秒待機します。`);
        info.logged = true;
      }
      saveAttemptInfo(info);
      return { allowed: false, now, waitMs };
    }
    info.count = count + 1;
    info.logged = false;
    saveAttemptInfo(info);
    attemptBlockedUntil = 0;
    updateNextUpdateDisplay();
    log(`予約変更試行 ${info.count}/${MAX_ATTEMPTS_PER_MINUTE}（この分）`);
    return { allowed: true, now };
  }

  function resetAttemptInfo(message = '') {
    try {
      sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
    } catch {
      // storage unavailable
    }
    attemptBlockedUntil = 0;
    updateNextUpdateDisplay();
    if (message) {
      log(message);
    }
  }

  /***** サーバー時刻取得（Dateヘッダ） *****/
  let serverTimeOffsetMs = 0;
  let hasServerTime = false;
  let serverTimeInitFailed = false;
  let serverTimeInitPromise = null;

  async function fetchServerDate() {
    // 同一オリジン HEAD をまず試す
    try {
      const res = await fetch(location.origin + '/', { method: 'HEAD', cache: 'no-store' });
      const d = res.headers.get('Date');
      if (d) return new Date(d);
    } catch (e) {
      // 続行して GM_xmlhttpRequest にフォールバック
    }
    // フォールバック：GM_xmlhttpRequest
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        return reject(new Error('No GM_xmlhttpRequest available'));
      }
      GM_xmlhttpRequest({
        method: 'HEAD',
        url: location.origin + '/',
        headers: { 'Cache-Control': 'no-store' },
        onload: (res) => {
          const m = /^date:\s*(.+)$/im.exec(res.responseHeaders || '');
          if (m && m[1]) {
            resolve(new Date(m[1]));
          } else {
            reject(new Error('No Date header'));
          }
        },
        onerror: (err) => reject(err),
      });
    });
  }

  async function getServerDate() {
    if (!hasServerTime && !serverTimeInitFailed) {
      if (!serverTimeInitPromise) {
        serverTimeInitPromise = (async () => {
          const serverDate = await fetchServerDate();
          serverTimeOffsetMs = serverDate.getTime() - Date.now();
          hasServerTime = true;
          return new Date(Date.now() + serverTimeOffsetMs);
        })()
          .catch((err) => {
            serverTimeInitFailed = true;
            throw err;
          })
          .finally(() => {
            serverTimeInitPromise = null;
          });
      }
      try {
        return await serverTimeInitPromise;
      } catch (e) {
        // 端末時刻にフォールバック
      }
    }
    if (hasServerTime) {
      return new Date(Date.now() + serverTimeOffsetMs);
    }
    return new Date();
  }

  /***** リロード制御（サーバー時刻ベース） *****/
  let ticking = false;
  let pendingReload = false;
  let attemptBlockedUntil = 0;
  let reloadInfo = loadReloadInfo();

  // 予約変更フロー：直前枠が空いていたら実行
  function extractFirstTimeText(source) {
    if (!source) return '';
    const match = String(source).match(SELECTORS.timePattern);
    return match ? match[0] : '';
  }

  function extractSlotInfo(el) {
    if (!el) return null;
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const attrSources = [
      text,
      el.getAttribute('data-time-slot') || '',
      el.getAttribute('data-time') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
    ];
    let html = '';
    try {
      html = (el.outerHTML || '').replace(/\s+/g, ' ');
    } catch (e) {
      html = '';
    }
    attrSources.push(html);

    let match = null;
    let matchSource = '';
    for (const src of attrSources) {
      if (!src) continue;
      const found = src.match(SELECTORS.timePattern);
      if (found) {
        match = found;
        matchSource = src;
        break;
      }
    }
    if (!match) return null;
    const [h, m] = match[0].split(':').map(n => parseInt(n, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return {
      text: text || matchSource || match[0],
      label: match[0],
      minutes: h * 60 + m,
    };
  }

  function isSelectableSlot(el, precomputedActiveHints = null) {
    if (!el) return false;
    const activeHints = precomputedActiveHints == null ? collectActiveHints(el) : precomputedActiveHints;
    if (activeHints.length) return false;
    if (el.getAttribute('aria-pressed') === 'true') return false;
    if (el.getAttribute('data-disabled') === 'true') return false;
    const ariaDisabled = el.getAttribute('aria-disabled');
    if (ariaDisabled && ariaDisabled !== 'false') return false;
    if (el.classList.contains('is-disabled')) return false;
    const td = el.closest('td');
    if (td && td.getAttribute('data-gray-out') === 'true') return false;
    const statusImg = el.querySelector('img[alt]');
    if (statusImg) {
      const alt = statusImg.getAttribute('alt') || '';
      if (/予約不可|満員/.test(alt)) return false;
    }
    return true;
  }

  async function waitForButtonByText(pattern, options = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < ACTION_TIMEOUT_MS) {
      const btn = findButtonByText(pattern, options);
      if (btn) return btn;
      await sleep(DOM_POLL_INTERVAL_MS);
    }
    return null;
  }

  async function waitForConfirmButton() {
    const t0 = Date.now();
    while (Date.now() - t0 < ACTION_TIMEOUT_MS) {
      for (const sel of SELECTORS.confirmToastButton) {
        const btn = document.querySelector(sel);
        if (btn && isElementVisible(btn)) return btn;
      }
      const fallback = findButtonByText(SELECTORS.confirmButtonText, { requireVisible: true });
      if (fallback) return fallback;
      await sleep(DOM_POLL_INTERVAL_MS);
    }
    return null;
  }

  async function waitForToastResult() {
    const t0 = Date.now();
    while (Date.now() - t0 < ACTION_TIMEOUT_MS) {
      const bodyText = document.body.innerText || '';
      if (SELECTORS.successToast.test(bodyText)) return 'success';
      if (SELECTORS.failureToast.test(bodyText)) return 'failure';
      await sleep(DOM_POLL_INTERVAL_MS);
    }
    return null;
  }

  function scheduleReload(reason = '', delay = 600) {
    if (pendingReload) return;
    pendingReload = true;
    if (reason) log(`リロード予約: ${reason}`);
    setTimeout(() => reloadPage(reason || '自動リロード'), delay);
  }

  function scopeButtonsToCurrentDay(allButtons, currentButton) {
    if (!currentButton) return allButtons;
    for (const sel of SLOT_SCOPE_SELECTORS) {
      const scopeEl = currentButton.closest(sel);
      if (!scopeEl) continue;
      const scoped = allButtons.filter(btn => scopeEl.contains(btn));
      if (scoped.length) return scoped;
    }
    return allButtons;
  }

  function getSlotScopeSignature(button) {
    if (!button) return '';
    for (const attr of SLOT_SCOPE_ATTRIBUTE_KEYS) {
      const scopeEl = button.closest(`[${attr}]`);
      if (scopeEl) {
        const value = scopeEl.getAttribute(attr);
        if (value) return `${attr}:${value}`;
      }
    }
    return '';
  }

  function describeSlotScope(button) {
    if (!button) return '';
    for (const attr of SLOT_SCOPE_ATTRIBUTE_KEYS) {
      const scopeEl = button.closest(`[${attr}]`);
      if (scopeEl) {
        const value = scopeEl.getAttribute(attr);
        if (value) return value;
      }
    }
    const table = button.closest('table');
    if (table) {
      const caption = table.querySelector('caption');
      if (caption && caption.textContent) {
        const text = caption.textContent.trim();
        if (text) return text;
      }
      const th = table.querySelector('thead th');
      if (th && th.textContent) {
        const text = th.textContent.trim();
        if (text) return text;
      }
    }
    return '';
  }

  const SLOT_DATE_ATTRIBUTE_KEYS = [
    'data-date-value',
    'data-date',
    'data-day',
    'data-day-value',
    'data-target-date',
    'data-current-date',
    'data-selected-date',
  ];

  function getSlotDateKey(button) {
    if (!button) return '';
    const candidates = [];
    let current = button;
    let depth = 0;
    while (current && depth < 6) {
      for (const attr of SLOT_DATE_ATTRIBUTE_KEYS) {
        if (current.hasAttribute && current.hasAttribute(attr)) {
          const value = current.getAttribute(attr);
          if (value) {
            candidates.push(value);
          }
        }
      }
      current = current.parentElement;
      depth += 1;
    }
    for (const candidate of candidates) {
      const normalized = normalizeDateValue(candidate);
      if (normalized) return normalized;
    }
    const scopeLabel = describeSlotScope(button);
    const normalizedScope = normalizeDateValue(scopeLabel);
    if (normalizedScope) return normalizedScope;
    const ariaLabel = button.getAttribute ? button.getAttribute('aria-label') : '';
    const normalizedAria = normalizeDateValue(ariaLabel);
    if (normalizedAria) return normalizedAria;
    return '';
  }

  function getSlotPriority(minutes) {
    if (!Number.isFinite(minutes)) return Number.POSITIVE_INFINITY;
    const idx = PREFERRED_SLOT_MINUTES.indexOf(minutes);
    if (idx >= 0) return idx;
    return PREFERRED_SLOT_MINUTES.length + (10_000 - minutes);
  }

  async function tryReservationChangeOnPrevSlot() {
    let confirmedCurrentSlot = false;
    const buttons = collectSlotButtons();
    if (!buttons.length) {
      log('時間選択ボタンが見つかりませんでした');
      return { status: 'pending', checked: false };
    }

    const entries = buttons.map((btn) => {
      const info = extractSlotInfo(btn);
      const hints = collectActiveHints(btn);
      const text = (btn.innerText || btn.textContent || '').trim();
      const scopeSignature = getSlotScopeSignature(btn);
      const dateKey = getSlotDateKey(btn);
      const activeScore = scoreActiveHints(hints);
      return {
        el: btn,
        info,
        hints,
        text,
        scopeSignature,
        activeScore,
        selectable: false,
        dateKey,
      };
    });

    const entryByElement = new Map();
    for (const entry of entries) {
      entry.selectable = isSelectableSlot(entry.el, entry.hints);
      entryByElement.set(entry.el, entry);
    }

    const activeEntries = entries
      .filter((entry) => entry.activeScore > 0)
      .sort((a, b) => b.activeScore - a.activeScore);

    let currentEntry = null;
    if (activeEntries.length) {
      const top = activeEntries[0];
      const runnerUp = activeEntries[1];
      if (
        top.activeScore >= 30 &&
        (!runnerUp || top.activeScore > runnerUp.activeScore || top.activeScore >= 90)
      ) {
        currentEntry = top;
      }
    }

    let usedStoredCurrent = false;
    if ((!currentEntry || !currentEntry.info) && lastKnownCurrentSlot) {
      const storedEntry = findEntryByStoredSignature(entries, lastKnownCurrentSlot);
      if (storedEntry) {
        currentEntry = storedEntry;
        usedStoredCurrent = true;
      }
    }

    if (!currentEntry) {
      if (lastKnownCurrentSlot && lastKnownCurrentSlot.displayLabel) {
        setCurrentSlotDisplay(lastKnownCurrentSlot.displayLabel, { estimated: true });
      } else {
        setCurrentSlotDisplay('', { fallback: '未検出' });
      }
      const now = Date.now();
      if (now - lastActiveDetectionFailureLogTime > 25_000) {
        lastActiveDetectionFailureLogTime = now;
        log('現在の予約枠を特定できませんでした');
        const debugSummary = entries
          .slice()
          .sort((a, b) => b.activeScore - a.activeScore)
          .slice(0, 6)
          .map((entry) => {
            const label = entry.info?.label || '?';
            const hintSummary = entry.hints.slice(0, 3).join('|') || 'no-hints';
            const scorePart = entry.activeScore ? `:${entry.activeScore}` : '';
            return `${label}${scorePart}:${hintSummary}`;
          })
          .join(' / ');
        if (debugSummary) {
          log(`候補情報: ${debugSummary}`);
        }
      }
      return { status: 'pending', checked: false };
    }
    lastActiveDetectionFailureLogTime = 0;

    let currentInfo = currentEntry.info;
    if (!currentInfo || Number.isNaN(currentInfo.minutes)) {
      if (lastKnownCurrentSlot && lastKnownCurrentSlot.minutes != null) {
        currentInfo = {
          text: lastKnownCurrentSlot.text || lastKnownCurrentSlot.label || '',
          label: lastKnownCurrentSlot.label || '',
          minutes: lastKnownCurrentSlot.minutes,
        };
        usedStoredCurrent = true;
      } else {
        let snippet = '';
        try {
          snippet = (currentEntry.el.outerHTML || '').replace(/\s+/g, ' ').trim();
        } catch (e) {
          snippet = '';
        }
        if (snippet.length > 180) {
          snippet = snippet.slice(0, 177) + '…';
        }
        const messages = ['現在の予約時間を取得できませんでした'];
        if (snippet) {
          messages.push(`要素抜粋: ${snippet}`);
        }
        log(...messages);
        return { status: 'error', checked: false };
      }
    }

    const scopeSignature = currentEntry.scopeSignature || getSlotScopeSignature(currentEntry.el);
    const scopeLabel = describeSlotScope(currentEntry.el);
    const buttonText = currentEntry.text;
    const displayCandidates = [
      currentInfo.label,
      extractFirstTimeText(buttonText),
      lastKnownCurrentSlot && lastKnownCurrentSlot.displayLabel,
    ].filter(Boolean);
    const currentDisplayLabel = displayCandidates.length ? displayCandidates[0] : '';
    setCurrentSlotDisplay(currentDisplayLabel, { estimated: usedStoredCurrent });
    const currentSignature = `${scopeSignature}|${currentDisplayLabel}`;
    const shouldLogCurrentSlot =
      lastLoggedCurrentSlotSignature !== currentSignature ||
      (usedStoredCurrent && !lastLoggedUsedStoredForCurrent) ||
      (!usedStoredCurrent && lastLoggedUsedStoredForCurrent);
    if (shouldLogCurrentSlot) {
      lastLoggedCurrentSlotSignature = currentSignature;
      lastLoggedUsedStoredForCurrent = usedStoredCurrent;
      const suffix = usedStoredCurrent ? '［保存情報から推定］' : '';
      log(`現在の予約枠: ${currentDisplayLabel}${suffix}`);
    } else {
      lastLoggedUsedStoredForCurrent = usedStoredCurrent;
    }

    if (currentInfo && Number.isFinite(currentInfo.minutes)) {
      lastKnownCurrentSlot = {
        scopeSignature: scopeSignature || '',
        scopeLabel,
        label: currentInfo.label || currentDisplayLabel,
        displayLabel: currentDisplayLabel,
        minutes: currentInfo.minutes,
        text: buttonText || '',
      };
    }

    confirmedCurrentSlot = true;
    lastSuccessfulCheckTime = Date.now();

    let candidates = [];
    let targetDateKeyForLog = '';

    if (isSameDayPreference()) {
      const candidateButtons = scopeButtonsToCurrentDay(buttons, currentEntry.el);
      candidates = candidateButtons
        .map((btn) => entryByElement.get(btn))
        .filter((entry) => {
          if (!entry || !entry.info || !entry.selectable) return false;
          return entry.info.minutes < currentInfo.minutes;
        });
      if (!candidates.length) {
        log('現在の予約時間より前で選択可能な枠はありません');
        return { status: 'no-slot', checked: true };
      }
    } else {
      const targetDateKey = getTargetDatePreference();
      if (!targetDateKey) {
        logTargetDateMessage('missing-date', '操作対象日を指定してください（「同日」チェックが外れています）。');
        return { status: 'pending', checked: false };
      }
      targetDateKeyForLog = targetDateKey;
      candidates = entries.filter((entry) => {
        if (!entry || !entry.info || !entry.selectable) return false;
        if (entry.dateKey !== targetDateKey) return false;
        return entry.info.minutes < currentInfo.minutes;
      });
      if (!candidates.length) {
        logTargetDateMessage(
          `no-slot-${targetDateKey}`,
          `対象日 ${targetDateKey} に現在の予約より早い空き枠は見つかりませんでした`,
        );
        return { status: 'no-slot', checked: true };
      }
    }

    const preferredMinutes = getPreferredTargetMinutes();
    if (preferredMinutes.length) {
      const preferredSet = new Set(preferredMinutes);
      const filtered = candidates.filter((entry) => entry.info && preferredSet.has(entry.info.minutes));
      if (!filtered.length) {
        log(`指定した時間帯（${describePreferredTimes(preferredMinutes)}）に空き枠がありませんでした`);
        return { status: 'no-slot', checked: true };
      }
      candidates = filtered;
    }

    candidates.sort((a, b) => {
      const priorityDiff = getSlotPriority(a.info.minutes) - getSlotPriority(b.info.minutes);
      if (priorityDiff !== 0) return priorityDiff;
      return b.info.minutes - a.info.minutes;
    });

    const target = candidates[0];

    const attempt = await registerAttempt();
    if (!attempt.allowed) {
      return { status: 'limit', checked: true };
    }

    const targetDateSuffix = targetDateKeyForLog ? ` / 対象日: ${targetDateKeyForLog}` : '';
    log(`前倒し候補を選択: ${target.info.label} (${target.info.text})${targetDateSuffix}`);
    target.el.click();

    const setBtn = await waitForButtonByText(SELECTORS.setVisitButtonText, {
      requireVisible: true,
      requireEnabled: true,
    });
    if (!setBtn) {
      log('「来場日時を設定する」ボタンが見つかりませんでした');
      return { status: 'error', checked: confirmedCurrentSlot };
    }
    triggerButtonClick(setBtn);
    log('「来場日時を設定する」を押下');

    const confirmBtn = await waitForConfirmButton();
    if (!confirmBtn) {
      log('確認モーダルの「来場日時を変更する」ボタンが見つかりませんでした');
      return { status: 'error', checked: confirmedCurrentSlot };
    }
    confirmBtn.click();
    log('「来場日時を変更する」を押下');

    const result = await waitForToastResult();
    if (result === 'success') {
      log('来場日時の変更に成功しました。スクリプトを停止します。');
      setStatus('done');
      setEnabled(false);
      return { status: 'success', checked: confirmedCurrentSlot };
    }
    if (result === 'failure') {
      log('定員オーバーのトーストを検出しました');
      scheduleReload('変更失敗トースト');
      return { status: 'failure', checked: confirmedCurrentSlot };
    }

    log('変更結果のトーストが確認できませんでした');
    return { status: 'error', checked: confirmedCurrentSlot };
  }

  function reloadPage(reason = '') {
    if (reason) log('リロード:', reason);
    location.reload();
  }
// ===== wrap reloadPage to arm the guard automatically =====
(function __nr_wrapReloadPage(){
  try{
    if (typeof reloadPage === 'function' && !reloadPage.__nrWrapped){
      var orig = reloadPage;
      var wrapped = function(reason){
        try { armTopGuard(100000); } catch(_){}
        return orig.apply(this, arguments);
      };
      try { Object.defineProperty(wrapped, '__nrWrapped', { value: true }); } catch(_){ wrapped.__nrWrapped = true; }
      reloadPage = wrapped;
    }
  }catch(e){}
})();

  async function tick() {
    if (ticking || pendingReload) return;
    ticking = true;
    setStatus('running');
    try {
      let result = { status: 'skipped', checked: checkCompletedThisLoad };
      if (!checkCompletedThisLoad && Date.now() >= attemptBlockedUntil) {
        try {
          result = await tryReservationChangeOnPrevSlot();
        } catch (e) {
          log('予約変更処理で例外:', e.message || e);
          scheduleReload('例外発生');
          return;
        }
        if (result.checked) {
          checkCompletedThisLoad = true;
        }
        if (pendingReload) return;
        if (result.status === 'success' || result.status === 'failure') {
          return;
        }
      }

      const now = await getServerDate();
      const nowMs = now.getTime();
      const sec = now.getSeconds();
      const bucket = Math.floor(nowMs / 60_000);

      const hadBucket = typeof reloadInfo.bucket === 'number';
      if (reloadInfo.bucket !== bucket) {
        reloadInfo = resetReloadInfo(bucket);
        reloadsThisMinute = 0;
        resetAttemptInfo(hadBucket ? '分が変わったため、予約変更試行回数の記録をリセットしました' : '');
      } else {
        reloadsThisMinute = reloadInfo.count || 0;
        if (!('loggedMinute' in reloadInfo)) {
          reloadInfo.loggedMinute = null;
        }
      }

      if (reloadInfo.loggedMinute !== bucket) {
        log(`分が変わりました → ${now.toLocaleTimeString()} / この分のリロード残り: ${Math.max(0, MAX_RELOADS_PER_MINUTE - reloadsThisMinute)}`);
        reloadInfo.loggedMinute = bucket;
        saveReloadInfo(reloadInfo);
      }

      const inWindow = sec >= WINDOW_START && sec < WINDOW_END;
      const hasRecentCheck =
        lastSuccessfulCheckTime > 0 &&
        (checkCompletedThisLoad || Date.now() - lastSuccessfulCheckTime <= RECENT_CHECK_THRESHOLD_MS);
      if (inWindow && reloadsThisMinute < MAX_RELOADS_PER_MINUTE) {
        if (!hasRecentCheck) {
          if (lastReloadDeferLogBucket !== bucket) {
            log('現在の予約枠の確認待ちのためリロードを一時停止します');
            lastReloadDeferLogBucket = bucket;
          }
          return;
        }
        lastReloadDeferLogBucket = null;
        reloadsThisMinute++;
        reloadInfo.count = reloadsThisMinute;
        saveReloadInfo(reloadInfo);
        pendingReload = true;
        reloadPage(`サーバー時刻 ${sec}s（分内 ${reloadsThisMinute}/${MAX_RELOADS_PER_MINUTE}）`);
        return;
      }
      if (!inWindow) {
        lastReloadDeferLogBucket = null;
      }

      if (result.status === 'limit') {
        // ログは registerAttempt 内で出力済み。上限解除まで待機。
      }
    } finally {
      if (currentStatus !== 'done') {
        setStatus('idle');
      }
      ticking = false;
    }
  }

 /***** UI：トグル＆ステータス表示 *****/
function isEnabled() {
  try {
    const v = sessionStorage.getItem(ENABLE_KEY);
    if (v === null) return enabledFallback;
    enabledFallback = v === '1';
    return enabledFallback;
  } catch {
    return enabledFallback;
  }
}
function setEnabled(flag) {
  enabledFallback = flag;
  try {
    sessionStorage.setItem(ENABLE_KEY, flag ? '1' : '0');
  } catch {
    // storage unavailable
  }
  updateNextUpdateDisplay();
}

function ensureToggle() {
  const existingWrap = $('#expo-adv-toggle');
  if (existingWrap) {
    statusIndicator = existingWrap.querySelector('#expo-adv-status-value');
    if (statusIndicator) {
      setStatus(currentStatus);
    }
    currentSlotIndicator = existingWrap.querySelector('#expo-adv-current-slot-value');
    if (currentSlotIndicator) {
      currentSlotIndicator.textContent = currentSlotDisplay.text;
      if (currentSlotDisplay.estimated) {
        currentSlotIndicator.dataset.estimated = '1';
      } else {
        delete currentSlotIndicator.dataset.estimated;
      }
    }
    nextUpdateIndicator = existingWrap.querySelector('#expo-adv-next-update-value');
    if (nextUpdateIndicator) {
      updateNextUpdateDisplay();
    }
    sameDayCheckboxControl = existingWrap.querySelector('#expo-adv-same-day');
    dateInputControl = existingWrap.querySelector('#expo-adv-date-input');
    timeCheckboxControls = new Map();
    for (const option of TARGET_TIME_OPTIONS) {
      const checkbox = existingWrap.querySelector(`#expo-adv-time-${option.minutes}`);
      if (checkbox) {
        timeCheckboxControls.set(option.minutes, checkbox);
      }
    }
    updateDateControlState();
    updateTimeControlState();
    return;
  }
  const wrap = document.createElement('div');
  wrap.id = 'expo-adv-toggle';
  Object.assign(wrap.style, {
    position: 'fixed', top: '10px', left: '10px', zIndex: 999999,
    display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap',
    background: '#fff', border: '1px solid #999', borderRadius: '10px',
    padding: '6px 8px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', fontSize: '12px'
  });

  const btn = document.createElement('button');
  Object.assign(btn.style, { padding: '4px 8px', cursor: 'pointer' });
  function updateToggleLabel() {
    btn.textContent = isEnabled() ? '自動繰り上げ変更：ON' : '自動繰り上げ変更：OFF';
  }
  updateToggleLabel();
  btn.onclick = () => {
    const next = !isEnabled();
    setEnabled(next);
    updateToggleLabel();
    if (next) {
      setStatus('idle');
    } else if (currentStatus !== 'done') {
      setStatus('idle');
    }
    updateNextUpdateDisplay();
  };

  const statusWrap = document.createElement('span');
  statusWrap.id = 'expo-adv-status';
  Object.assign(statusWrap.style, { display: 'flex', alignItems: 'center', gap: '4px' });

  const statusLabel = document.createElement('span');
  statusLabel.textContent = '状態:';

  const statusValue = document.createElement('span');
  statusValue.id = 'expo-adv-status-value';
  Object.assign(statusValue.style, { fontWeight: 'bold' });
  statusIndicator = statusValue;
  setStatus(currentStatus);

  statusWrap.append(statusLabel, statusValue);

  const currentSlotWrap = document.createElement('span');
  currentSlotWrap.id = 'expo-adv-current-slot';
  Object.assign(currentSlotWrap.style, { display: 'flex', alignItems: 'center', gap: '4px' });

  const currentSlotLabel = document.createElement('span');
  currentSlotLabel.textContent = '現在の予約:';

  const currentSlotValue = document.createElement('span');
  currentSlotValue.id = 'expo-adv-current-slot-value';
  Object.assign(currentSlotValue.style, { fontWeight: 'bold' });
  currentSlotIndicator = currentSlotValue;
  currentSlotIndicator.textContent = currentSlotDisplay.text;
  if (currentSlotDisplay.estimated) {
    currentSlotIndicator.dataset.estimated = '1';
  }

  currentSlotWrap.append(currentSlotLabel, currentSlotValue);

  const nextUpdateWrap = document.createElement('span');
  nextUpdateWrap.id = 'expo-adv-next-update';
  Object.assign(nextUpdateWrap.style, { display: 'flex', alignItems: 'center', gap: '4px' });

  const nextUpdateLabel = document.createElement('span');
  nextUpdateLabel.textContent = '次の更新:';

  const nextUpdateValue = document.createElement('span');
  nextUpdateValue.id = 'expo-adv-next-update-value';
  Object.assign(nextUpdateValue.style, { fontWeight: 'bold' });
  nextUpdateIndicator = nextUpdateValue;
  updateNextUpdateDisplay();

  nextUpdateWrap.append(nextUpdateLabel, nextUpdateValue);

  const dateControlWrap = document.createElement('span');
  dateControlWrap.id = 'expo-adv-date-control';
  Object.assign(dateControlWrap.style, { display: 'flex', alignItems: 'center', gap: '4px' });

  const dateControlLabel = document.createElement('span');
  dateControlLabel.textContent = '変更希望日:';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.id = 'expo-adv-date-input';
  Object.assign(dateInput.style, { padding: '2px 4px' });

  const sameDayLabel = document.createElement('label');
  sameDayLabel.htmlFor = 'expo-adv-same-day';
  Object.assign(sameDayLabel.style, { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' });

  const sameDayCheckbox = document.createElement('input');
  sameDayCheckbox.type = 'checkbox';
  sameDayCheckbox.id = 'expo-adv-same-day';

  sameDayLabel.append(sameDayCheckbox, document.createTextNode('同じ日'));

  dateControlWrap.append(dateControlLabel, dateInput, sameDayLabel);

  sameDayCheckbox.addEventListener('change', () => {
    setSameDayPreference(sameDayCheckbox.checked);
  });
  dateInput.addEventListener('change', () => {
    setTargetDatePreference(dateInput.value);
  });

  sameDayCheckboxControl = sameDayCheckbox;
  dateInputControl = dateInput;
  updateDateControlState();

  const timeControlWrap = document.createElement('span');
  timeControlWrap.id = 'expo-adv-time-control';
  Object.assign(timeControlWrap.style, { display: 'flex', alignItems: 'center', gap: '4px' });

  const timeControlLabel = document.createElement('span');
  timeControlLabel.textContent = '希望時間:';

  const timeOptionsContainer = document.createElement('span');
  Object.assign(timeOptionsContainer.style, { display: 'flex', alignItems: 'center', gap: '6px' });

  timeCheckboxControls = new Map();
  for (const option of TARGET_TIME_OPTIONS) {
    const label = document.createElement('label');
    label.htmlFor = `expo-adv-time-${option.minutes}`;
    Object.assign(label.style, { display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `expo-adv-time-${option.minutes}`;

    checkbox.addEventListener('change', () => {
      setTimePreference(option.minutes, checkbox.checked);
    });

    label.append(checkbox, document.createTextNode(option.label));
    timeOptionsContainer.append(label);
    timeCheckboxControls.set(option.minutes, checkbox);
  }

  timeControlWrap.append(timeControlLabel, timeOptionsContainer);
  updateTimeControlState();

  wrap.append(btn, statusWrap, currentSlotWrap, dateControlWrap, timeControlWrap, nextUpdateWrap);
  document.documentElement.appendChild(wrap);

  if (!nextUpdateTimerId) {
    nextUpdateTimerId = window.setInterval(updateNextUpdateDisplay, 200);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureToggle);
} else {
  ensureToggle();
}
  // ===== main loop (起動) =====
(async function startLoop(){
  try { await getServerDate(); } catch(_) { /* サーバ時刻取得に失敗しても続行 */ }
  // 即時1回目（ページロード直後の状態も確認）
  try { await tick(); } catch(e){ console.warn('[ExpoAdvance] tick error (first)', e); }
  // 以後200msピッチで実行（ON/OFFは isEnabled でゲート）
  setInterval(async () => {
    if (!isEnabled()) return;
    try { await tick(); } catch(e){ console.warn('[ExpoAdvance] tick error', e); }
  }, 200);
})();

})();
