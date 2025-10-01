// ==UserScript==
// @name         Expo2025 来場予約
// @namespace    http://tampermonkey.net/
// @version      2.9
// @author       You
// @match        https://ticket.expo2025.or.jp/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://github.com/expo2025-auto/expo2025-tm-autobooker/raw/refs/heads/main/expo2025-reserver.user.js
// @downloadURL  https://github.com/expo2025-auto/expo2025-tm-autobooker/raw/refs/heads/main/expo2025-reserver.user.js
// @supportURL   https://github.com/expo2025-auto/expo2025-tm-autobooker/issues
// ==/UserScript==

/* ========= ユーティリティ ========= */
const CONF_KEY='nr_conf_v1',STATE_KEY='nr_state_v1';
function Lget(k){try{return JSON.parse(localStorage.getItem(k)||'{}')}catch{return{}}}
function Lset(k,v){localStorage.setItem(k,JSON.stringify(v))}
function Sget(k){try{return JSON.parse(sessionStorage.getItem(k)||'{}')}catch{return{}}}
function Sset(k,v){sessionStorage.setItem(k,JSON.stringify(v))}
const Q=(s,r=document)=>r.querySelector(s);
const A=(s,r=document)=>Array.from(r.querySelectorAll(s));
const D=e=>!e||e.disabled||(e.getAttribute('aria-disabled')||'').toLowerCase()==='true'||/\bdisabled\b/i.test(e.className||'')||e.getAttribute('data-disabled')==='true'||(()=>{try{return getComputedStyle(e).pointerEvents==='none'}catch{return!1}})();
function vis(el){if(!el)return false;const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none')return false;let p=el;while(p){const cs2=p instanceof Element?getComputedStyle(p):null;if(cs2&&(cs2.display==='none'||cs2.visibility==='hidden'))return false;if(p.getAttribute&&(p.getAttribute('hidden')!==null||p.getAttribute('aria-hidden')==='true'))return false;p=p.parentElement}return true}
function KC(el){if(!el||D(el))return false;try{el.focus?.({preventScroll:true})}catch{};el.click?.();return true}
function waitUntil(checkFn,{timeout=8000,interval=80,attrs,root=document.body}={}){const t0=Date.now();return new Promise(resolve=>{let done=false;const finish=v=>{if(!done){done=true;try{mo.disconnect()}catch{};clearInterval(iv);resolve(v)}};const tick=()=>{const v=checkFn();if(v)return finish(v);if(Date.now()-t0>timeout)return finish(null)};const mo=new MutationObserver(tick);mo.observe(root,{subtree:true,childList:true,attributes:Boolean(attrs),attributeFilter:attrs||undefined});const iv=setInterval(tick,interval);tick()})}

// 安全リロード
function safeReload(){
  try{
    console.log('[NR] reload at', new Date().toLocaleTimeString());
    location.reload();
  }catch(e){
    try{
      const u=new URL(location.href);
      u.searchParams.set('r', Date.now().toString());
      location.assign(u.toString());
    }catch{
      location.href = location.href + (location.href.includes('?')?'&':'?') + 'r=' + Date.now();
    }
  }
}

/* ========= 設定/状態 ========= */
const TIME_CHOICES=[
  {key:'09',hour:9,label:'9時'},
  {key:'10',hour:10,label:'10時'},
  {key:'11',hour:11,label:'11時'},
  {key:'12',hour:12,label:'12時'},
  {key:'17',hour:17,label:'17時'}
];
const DEFAULT_TIME_KEYS=TIME_CHOICES.map(t=>t.key);
const TIME_KEY_ORDER=TIME_CHOICES.reduce((acc,opt,idx)=>{acc[opt.key]=idx;return acc;},{});
function normalizeTimeKeys(list){
  if(!Array.isArray(list))return DEFAULT_TIME_KEYS.slice();
  const filtered=list.filter(k=>Object.prototype.hasOwnProperty.call(TIME_KEY_ORDER,k));
  const unique=[];
  for(const key of filtered){if(!unique.includes(key))unique.push(key);} // preserve order of first appearance
  unique.sort((a,b)=>TIME_KEY_ORDER[a]-TIME_KEY_ORDER[b]);
  return unique;
}
function getActiveTimeKeys(){
  const keys=normalizeTimeKeys(conf.times);
  return keys;
}
function includesAllTimeKeys(keys){
  if(keys.length!==DEFAULT_TIME_KEYS.length)return false;
  return DEFAULT_TIME_KEYS.every(k=>keys.includes(k));
}
function parseTimeLikeString(str){
  if(!str)return null;
  const normalized=String(str).replace(/[\s\u3000]+/g,'').toLowerCase();
  if(!normalized)return null;
  const colon=normalized.match(/(午前|午後)?([01]?\d|2[0-3])[：:](\d{2})/);
  if(colon){
    let hour=parseInt(colon[2],10);
    const minute=parseInt(colon[3],10);
    const period=colon[1]||'';
    if(period.includes('午前')&&hour===12)hour=0;
    if(period.includes('午後')&&hour<12)hour+=12;
    if(/pm/.test(normalized)&&hour<12)hour+=12;
    if(/am/.test(normalized)&&hour===12)hour=0;
    return{hour,minute};
  }
  const hm=normalized.match(/(午前|午後)?(\d{1,2})時(\d{1,2})?分?/);
  if(hm){
    let hour=parseInt(hm[2],10);
    const minute=hm[3]?parseInt(hm[3],10):0;
    const period=hm[1]||'';
    if(period.includes('午前')&&hour===12)hour=0;
    if(period.includes('午後')&&hour<12)hour+=12;
    if(/pm/.test(normalized)&&hour<12)hour+=12;
    if(/am/.test(normalized)&&hour===12)hour=0;
    return{hour,minute};
  }
  return null;
}
function extractSlotTime(el){
  if(!el)return null;
  const tryMatch=val=>{const res=parseTimeLikeString(val);return res?res:null;};
  const timeEl=el.querySelector?.('time[datetime]');
  if(timeEl){
    const dt=timeEl.getAttribute('datetime')||'';
    const m=dt.match(/T(\d{2}):(\d{2})/);
    if(m){
      return{hour:Number(m[1]),minute:Number(m[2])};
    }
  }
  const dataTime=el.getAttribute?.('data-time');
  if(dataTime){
    const hit=tryMatch(dataTime);
    if(hit)return hit;
  }
  if(el.dataset){
    for(const key of ['time','startTime','start']){
      if(el.dataset[key]){
        const hit=tryMatch(el.dataset[key]);
        if(hit)return hit;
      }
    }
  }
  let combined='';
  if(el.getAttribute){
    const aria=el.getAttribute('aria-label');
    if(aria)combined+=' '+aria;
    const labelled=el.getAttribute('aria-labelledby');
    if(labelled){
      labelled.split(/\s+/).forEach(id=>{
        const node=document.getElementById(id.trim());
        if(node)combined+=' '+(node.textContent||'');
      });
    }
    const described=el.getAttribute('aria-describedby');
    if(described){
      described.split(/\s+/).forEach(id=>{
        const node=document.getElementById(id.trim());
        if(node)combined+=' '+(node.textContent||'');
      });
    }
  }
  combined+=' '+(el.textContent||'');
  const hit=tryMatch(combined);
  if(hit)return hit;
  return null;
}

let conf=Object.assign({dates:[],times:DEFAULT_TIME_KEYS.slice()},Lget(CONF_KEY));
conf.times=normalizeTimeKeys(conf.times);
Lset(CONF_KEY,conf);
let stateRaw=Sget(STATE_KEY);
if(typeof stateRaw!=='object'||!stateRaw){stateRaw={}};
let state=Object.assign({r:false,keepAlive:false,switchEnabled:false,switchTime:'',switchNextAt:0},stateRaw);
if(typeof state.r!=='boolean')state.r=false;
if(typeof state.keepAlive!=='boolean')state.keepAlive=false;
if(typeof state.switchEnabled!=='boolean')state.switchEnabled=false;
if(typeof state.switchTime!=='string')state.switchTime='';
if(typeof state.switchNextAt!=='number'||!Number.isFinite(state.switchNextAt))state.switchNextAt=0;
if(state.keepAlive&&state.r)state.r=false;
Sset(STATE_KEY,state);
function saveState(){Sset(STATE_KEY,state)}
;(function migrateOld(){
  try{
    const old=Lget(CONF_KEY);
    if(Array.isArray(old.dates)&&old.dates.length){
      conf.dates=Array.from(new Set(old.dates)).sort();
      Lset(CONF_KEY,conf);
    }
    if('r' in old){
      delete old.r;
      localStorage.setItem(CONF_KEY,JSON.stringify(old));
    }
  }catch{}
})();

let ui=null;
let AutoToggleEl=null,KeepAliveToggleEl=null,SwitchCheckEl=null,SwitchTimeInputEl=null;
const KEEP_ALIVE_INTERVAL_MS=5*60*1000;
let KeepAliveTimer=null;
let KeepAliveNextAt=null;
let keepAliveSwitching=false;
function setUIStatus(msg){try{if(ui&&typeof ui.setStatus==='function')ui.setStatus(msg)}catch{}}
function keepAliveRemainingSeconds(){
  if(!state.keepAlive||KeepAliveNextAt===null)return null;
  const diff=Math.floor((KeepAliveNextAt-Date.now())/1000);
  return diff>=0?diff:0;
}
function keepAliveStatusText(){
  if(!state.keepAlive)return 'ログイン維持リロード待機中';
  const parts=[];
  if(state.switchEnabled)parts.push('切替待ち');
  const remain=keepAliveRemainingSeconds();
  if(remain!==null)parts.push(`残り${remain}秒`);
  return `ログイン維持リロード待機中${parts.length?`（${parts.join('・')}）`:''}`;
}
function clearKeepAliveTimer(){
  if(KeepAliveTimer){clearTimeout(KeepAliveTimer);KeepAliveTimer=null;}
  KeepAliveNextAt=null;
}
function scheduleKeepAliveReload(){
  clearKeepAliveTimer();
  if(!state.keepAlive)return;
  KeepAliveNextAt=Date.now()+KEEP_ALIVE_INTERVAL_MS;
  if(ui&&typeof ui.updateKeepAliveCountdown==='function')ui.updateKeepAliveCountdown();
  KeepAliveTimer=setTimeout(()=>{if(!state.keepAlive)return;KeepAliveNextAt=null;setUIStatus('ログイン維持リロード実行');safeReload()},KEEP_ALIVE_INTERVAL_MS);
}
function updateKeepAliveCountdownDisplay(){
  if(!state.keepAlive||KeepAliveNextAt===null)return;
  if(ui&&typeof ui.updateKeepAliveCountdown==='function'){
    ui.updateKeepAliveCountdown();
  }else{
    setUIStatus(keepAliveStatusText());
  }
}
function triggerSwitchToBooking(){
  if(keepAliveSwitching)return;
  keepAliveSwitching=true;
  setUIStatus('指定時刻になりました。予約モードに切替中...');
  let updated=false;
  if(SwitchCheckEl){
    if(SwitchCheckEl.checked){
      SwitchCheckEl.checked=false;
      SwitchCheckEl.dispatchEvent(new Event('change',{bubbles:true}));
      updated=true;
    }
  }
  if(!updated&&state.switchEnabled){state.switchEnabled=false;state.switchNextAt=0;saveState()}
  if(KeepAliveToggleEl){
    if(KeepAliveToggleEl.checked){
      KeepAliveToggleEl.checked=false;
      KeepAliveToggleEl.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  if(state.keepAlive){
    state.keepAlive=false;
    saveState();
    clearKeepAliveTimer();
  }
  if(conf.dates.length===0){
    setUIStatus('日付を追加してください');
    if(AutoToggleEl)AutoToggleEl.checked=false;
    state.r=false;
    saveState();
    keepAliveSwitching=false;
    return;
  }
  if(AutoToggleEl){
    AutoToggleEl.checked=true;
    AutoToggleEl.dispatchEvent(new Event('change',{bubbles:true}));
  }else{
    state.r=true;
    saveState();
    runCycle();
  }
  keepAliveSwitching=false;
}
function computeNextSwitchAt(base,hh,mm){
  const ref=base instanceof Date?base:serverNow();
  const target=new Date(ref.getTime());
  target.setHours(hh,mm,0,0);
  if(target.getTime()<=ref.getTime())target.setDate(target.getDate()+1);
  return target.getTime();
}
function parseSwitchTimeString(str){
  if(typeof str!=='string'||!str)return null;
  const m=str.match(/^(\d{1,2}):(\d{2})$/);
  if(!m)return null;
  const hh=Number(m[1]);
  const mm=Number(m[2]);
  if(Number.isNaN(hh)||Number.isNaN(mm))return null;
  return {hh,mm};
}
function checkAutoSwitch(now){
  if(!state.keepAlive||!state.switchEnabled||keepAliveSwitching)return;
  const parsed=parseSwitchTimeString(state.switchTime);
  if(!parsed)return;
  const base=now instanceof Date?now:serverNow();
  const nowMs=base.getTime();
  if(!Number.isFinite(state.switchNextAt)||state.switchNextAt<=0){
    state.switchNextAt=computeNextSwitchAt(base,parsed.hh,parsed.mm);
    saveState();
  }
  if(!Number.isFinite(state.switchNextAt)||state.switchNextAt<=0)return;
  const targetMs=state.switchNextAt;
  if(nowMs>=targetMs){
    const drift=nowMs-targetMs;
    if(drift<=KEEP_ALIVE_INTERVAL_MS){
      triggerSwitchToBooking();
      return;
    }
    const recalculated=computeNextSwitchAt(base,parsed.hh,parsed.mm);
    if(recalculated!==state.switchNextAt){
      state.switchNextAt=recalculated;
      saveState();
    }
  }
}

/* ========= セレクタ ========= */
const SEL_SUCC='h2#reservation_modal_title',SEL_FAIL='h2#reservation_fail_modal_title';

/* ========= 失敗トースト → 強制リロード（最大3回） ========= */
const FAIL_KEY='nr_fail_r';
function getFail(){return +(sessionStorage.getItem(FAIL_KEY)||'0')}
function setFail(n){sessionStorage.setItem(FAIL_KEY,n)}
function resetFail(){setFail(0)}
let __reloading=false,__reloadStamp=0;
function robustReload(){
  if(__reloading)return;
  const n=getFail(); if(n>=3)return;
  setFail(n+1);
  __reloading=true; __reloadStamp=Date.now();
  try{window.stop()}catch{}
  try{safeReload()}catch{}
  setTimeout(()=>{try{location.replace(location.href)}catch{}},120);
  setTimeout(()=>{try{const u=new URL(location.href);u.searchParams.set('r',Date.now());location.assign(u.toString())}catch{}},240);
  setTimeout(()=>{try{history.go(0)}catch{}},360);
  setTimeout(()=>{try{location.href=location.href}catch{}},480);
  setTimeout(()=>{if(Date.now()-__reloadStamp>1900){__reloading=false}},2000);
}
function isShown(el){if(!el)return false;const r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;const cs=getComputedStyle(el);return cs.visibility!=='hidden'&&cs.display!=='none'}
function hasFailToast(){
  const t=Q('#reservation_fail_modal_title'); if(t&&isShown(t))return true;
  const c=Q('.ReactModal__Content[aria-labelledby="reservation_fail_modal_title"]'); if(c&&isShown(c))return true;
  const m=Q('.style_modal__ZpsOM'); if(m&&isShown(m)&&m.querySelector('#reservation_fail_modal_title'))return true;
  const wrap=Q('body>div.style_buy-modal__1JZtS'); if(wrap&&isShown(wrap)&&wrap.querySelector('#reservation_fail_modal_title'))return true;
  return false;
}
;(function armFastFailReload(){
  let armed=false;
  const kick=()=>{if(armed)return;armed=true;setTimeout(()=>{if(hasFailToast())robustReload()},500)};
  const mo=new MutationObserver(muts=>{
    for(const m of muts){
      if(m.type==='childList'){
        for(const n of m.addedNodes){
          if(n.nodeType===1&&(n.querySelector?.('#reservation_fail_modal_title')||n.matches?.('#reservation_fail_modal_title,.style_modal__ZpsOM,.ReactModal__Content'))) return kick();
        }
      }else if(m.type==='attributes'){
        const el=m.target;
        if(el.id==='reservation_fail_modal_title'||el.classList?.contains('ReactModal__Content')||el.classList?.contains('style_modal__ZpsOM')) return kick();
      }
    }
  });
  mo.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','aria-hidden','aria-modal']});
  if(hasFailToast()) kick();
})();

/* ========= カレンダー/日付/スロット ========= */
/* --- 置き換え①：getCalendarRoot + 安定化待ちつき waitCalendarReady --- */
function getCalendarRoot(){
  const selectors=[
    '#__next > div > div > main > div > div[class^="style_main__calendar__"]',
    '#__next main div[class^="style_main__calendar__"]',
    'div[class^="style_main__calendar__"]'
  ];
  for(const sel of selectors){
    const el=document.querySelector(sel);
    if(el) return el;
  }
  return document.body;
}
async function waitCalendarReady(timeout=5000){
  const root = getCalendarRoot();
  const ok = await waitUntil(
    () => document.querySelector('.style_selector_item__9RWJw time[datetime]') ||
          document.querySelector('.style_header__KIQKN') || null,
    { timeout, attrs:['class','style','aria-hidden','aria-pressed'], root }
  );
  if(!ok) return false;
  // 短い静穏（描画の揺れ止め）
  return await new Promise(res=>{
    let idleTimer=null, done=false;
    const finish=()=>{ if(!done){ done=true; try{mo.disconnect()}catch{}; res(true); } };
    const mo = new MutationObserver(()=>{
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, 140);
    });
    mo.observe(root, {subtree:true, childList:true, attributes:true});
    idleTimer = setTimeout(finish, 160);
    setTimeout(()=>{ if(!done){ try{mo.disconnect()}catch{}; res(true); } }, timeout);
  });
}

function fmtDate(d,pat){const y=d.getFullYear(),m=('0'+(d.getMonth()+1)).slice(-2),mm=(d.getMonth()+1)+'',dd=('0'+d.getDate()).slice(-2),d1=d.getDate()+'';return pat.replace('YYYY',y).replace('MM',m).replace('M',mm).replace('DD',dd).replace('D',d1)}
function isoOf(d){return fmtDate(d,'YYYY-MM-DD')}
function isOtherMonthCell(cell){
  if(!cell||typeof cell.closest!=='function')return false;
  const td=cell.closest('td');
  if(td&&td.getAttribute('data-other-month')==='true')return true;
  const time=cell.querySelector?.('time');
  const al=(time?.getAttribute('aria-label')||'').replace(/\s+/g,'');
  if(al.includes('表示月の日付ではありません'))return true;
  return false;
}
function parseYearMonthKey(text){
  if(!text)return null;
  const m=String(text).match(/(\d{4})年\s*(\d{1,2})月/);
  if(!m)return null;
  const y=m[1];
  const mm=('0'+m[2]).slice(-2);
  return `${y}-${mm}`;
}
function getVisibleYearMonthKey(){
  const spans=A('.style_year_month__iqQQH');
  for(const span of spans){
    if(vis(span)){const k=parseYearMonthKey(span.textContent);if(k)return k;}
  }
  for(const span of spans){
    const k=parseYearMonthKey(span.textContent);if(k)return k;
  }
  return null;
}
function isoToYearMonthKey(iso){
  const m=String(iso||'').match(/^(\d{4})-(\d{2})/);
  if(!m)return null;
  return `${m[1]}-${m[2]}`;
}
function getCellByISO(iso){
  const t=A(`.style_selector_item__9RWJw time[datetime="${iso}"]`).find(vis);
  if(!t)return null;
  const cell=t.closest('.style_selector_item__9RWJw');
  if(!cell)return null;
  if(isOtherMonthCell(cell))return null;
  return cell;
}
function cellIsSelected(cell){return !!cell&&cell.getAttribute('aria-pressed')==='true'}
function selectedDateISO(){const sel=A('.style_selector_item__9RWJw[aria-pressed="true"] time[datetime]').find(Boolean);return sel?.getAttribute('datetime')||null}
function isDateCellEnabled(cell){
  if(!cell||!vis(cell))return false;
  if(cell.classList.contains('style_selector_item_disabled__iSIA2'))return false;
  const tb=(cell.getAttribute('tabindex')||'').trim(); if(tb==='-1')return false;
  const a=(cell.getAttribute('aria-disabled')||'').toLowerCase(); if(a==='true')return false;
  const ng=cell.querySelector('img[src*="calendar_ng.svg"], img[alt*="満員"]'); if(ng)return false;
  return true;
}
async function ensureDate(iso,timeout=8000){
  if(!iso)return false;
  const already=selectedDateISO();
  if(already===iso){const c=getCellByISO(iso);return cellIsSelected(c)}
  let cell=getCellByISO(iso);
  if(!cell||!isDateCellEnabled(cell)) return false;
  try{cell.scrollIntoView({block:'center',behavior:'instant'})}catch{}
  const promise=waitUntil(()=>{const c=getCellByISO(iso);return(c&&cellIsSelected(c))?c:null},{timeout,attrs:['aria-pressed','class']});
  [cell,cell.querySelector('time'),cell.querySelector('div')].filter(Boolean).forEach(t=>KC(t));
  const ok=await promise; if(ok)return true;
  cell=getCellByISO(iso);
  if(cell&&isDateCellEnabled(cell)){
    KC(cell);KC(cell.querySelector('time'));KC(cell.querySelector('div'));
    const ok2=await waitUntil(()=>{const c=getCellByISO(iso);return(c&&cellIsSelected(c))?c:null},{timeout:2000,attrs:['aria-pressed','class']});
    return !!ok2;
  }
  return false;
}
function firstEnabledSlot(allowedKeys){
  const active=Array.isArray(allowedKeys)?normalizeTimeKeys(allowedKeys):[];
  if(active.length===0)return null;
  const allowAny=includesAllTimeKeys(active);
  const all=[...A('div[role=button].style_main__button__Z4RWX'),...A('button.style_main__button__Z4RWX'),...A('[role=button].style_main__button__Z4RWX')];
  const available=all.filter(el=>vis(el)&&!el.hasAttribute('data-disabled')&&(el.getAttribute('aria-disabled')||'').toLowerCase()!=='true');
  if(!available.length)return null;
  const enriched=available.map(el=>({el,time:extractSlotTime(el)}));
  for(const key of active){
    const choice=TIME_CHOICES.find(opt=>opt.key===key);
    if(!choice)continue;
    const matches=enriched.filter(item=>item.time&&typeof item.time.hour==='number'&&item.time.hour===choice.hour);
    if(matches.length){
      matches.sort((a,b)=>{
        const am=typeof a.time.minute==='number'?a.time.minute:0;
        const bm=typeof b.time.minute==='number'?b.time.minute:0;
        if(am!==bm)return am-bm;
        return available.indexOf(a.el)-available.indexOf(b.el);
      });
      return matches[0].el;
    }
  }
  if(allowAny)return available[0]||null;
  return null;
}
async function waitFirstEnabledSlot(allowedKeys,timeout=6000){
  const getter=()=>firstEnabledSlot(allowedKeys);
  const got=getter(); if(got) return got;
  return await waitUntil(getter,{timeout,interval:60,attrs:['class','disabled','aria-disabled','data-disabled']});
}
function slotElementRoot(el){
  if(!el)return null;
  if(el.matches?.('button, [role="button"]'))return el;
  return el.closest?.('button, [role="button"]')||el;
}
function slotElementSelected(el){
  const root=slotElementRoot(el);
  if(!root)return false;
  const ariaPressed=root.getAttribute?.('aria-pressed');
  if(ariaPressed&&ariaPressed.toLowerCase()==='true')return true;
  if(root.matches?.('[aria-pressed="true"]'))return true;
  const dataSelected=root.getAttribute?.('data-selected');
  if(dataSelected&&dataSelected.toLowerCase()==='true')return true;
  const className=(root.getAttribute?.('class')||root.className||'');
  if(/\bselected\b/i.test(className))return true;
  const pressedDesc=root.querySelector?.('[aria-pressed="true"],[data-selected="true"]');
  if(pressedDesc)return true;
  return false;
}
function slotElementKey(el){
  const root=slotElementRoot(el)||el;
  const time=extractSlotTime(root);
  if(!time)return null;
  const choice=TIME_CHOICES.find(opt=>opt.hour===time.hour);
  return choice?choice.key:null;
}
function collectSlotElements(){
  const lists=[
    A('div[role=button].style_main__button__Z4RWX'),
    A('button.style_main__button__Z4RWX'),
    A('[role=button].style_main__button__Z4RWX')
  ];
  const merged=[];
  for(const arr of lists){
    for(const el of arr){
      if(!merged.includes(el))merged.push(el);
    }
  }
  return merged;
}
function getSelectedSlotKey(){
  const slots=collectSlotElements();
  for(const el of slots){
    if(slotElementSelected(el)){
      const key=slotElementKey(el);
      if(key)return key;
    }
  }
  return null;
}
async function ensureSlotSelectionByKey(targetKey,{timeout=1800,retries=2}={}){
  if(!targetKey)return false;
  for(let attempt=0;attempt<=retries;attempt++){
    const current=getSelectedSlotKey();
    if(current===targetKey)return true;
    const slot=firstEnabledSlot([targetKey]);
    if(!slot){
      const waited=await waitFirstEnabledSlot([targetKey],timeout);
      if(!waited)return false;
      KC(waited);
    }else{
      KC(slot);
    }
    const ok=await waitUntil(()=>getSelectedSlotKey()===targetKey?true:null,{
      timeout:timeout+attempt*200,
      interval:80,
      attrs:['aria-pressed','class','data-selected']
    });
    if(ok)return true;
  }
  return getSelectedSlotKey()===targetKey;
}
async function ensurePreferredSlotSelection({targetKey,allowedKeys,timeout=1800,retries=2}={}){
  const normalized=normalizeTimeKeys(Array.isArray(allowedKeys)?allowedKeys:[]);
  const key=targetKey||normalized[0];
  if(!key){
    if(!normalized.length)return true;
    const current=getSelectedSlotKey();
    return normalized.includes(current||'');
  }
  return await ensureSlotSelectionByKey(key,{timeout,retries});
}
function isEnabled(el){
  if(!el||!vis(el))return false;
  if(el.disabled)return false;
  const a=(el.getAttribute('aria-disabled')||'').toLowerCase(); if(a==='true')return false;
  return !D(el);
}
async function waitEnabled(selOrEl,timeout=10000){
  const resEl=()=>typeof selOrEl==='string'?Q(selOrEl):selOrEl;
  const now=resEl(); if(now&&isEnabled(now))return now;
  return await waitUntil(()=>{const e=resEl();return(e&&isEnabled(e))?e:null},{timeout,interval:80,attrs:['class','disabled','aria-disabled','data-disabled']});
}
const TYPE_SELECTION_HEADING_SELECTOR='h1.h-type2 span[data-message-code="SW_GP_DL_007_0120"], h1.h-type2 span';
function isTypeSelectionPage(){
  const heading=Q(TYPE_SELECTION_HEADING_SELECTOR);
  if(!heading)return false;
  const text=(heading.textContent||'').replace(/\s+/g,'');
  const h1=heading.closest('h1')||heading;
  if(!vis(h1))return false;
  return text.includes('種類・枚数を選択');
}
async function waitTypeSelectionPage(timeout=8000){
  if(isTypeSelectionPage())return true;
  const hit=await waitUntil(()=>isTypeSelectionPage()?true:null,{timeout,interval:80,attrs:['data-message-code','class','style','aria-hidden']});
  return !!hit;
}
async function flowConfirm(targetISO,{targetTimeKey,allowedTimeKeys}={}){
  if(selectedDateISO()!==targetISO)return 'none';
  if(targetTimeKey||Array.isArray(allowedTimeKeys)&&allowedTimeKeys.length){
    const normalized=Array.isArray(allowedTimeKeys)?normalizeTimeKeys(allowedTimeKeys):[];
    const ensured=await ensurePreferredSlotSelection({
      targetKey:targetTimeKey,
      allowedKeys:normalized,
      timeout:2200,
      retries:3
    });
    if(!ensured)return 'none';
    if(selectedDateISO()!==targetISO)return 'none';
  }
  const host='#__next > div > div > main > div > div.style_main__add_cart_button__DCOw8';
  const confirmBtnSelectors=[
    host+' .basic-btn.type2.style_full__ptzZq',
    'button.basic-btn.type2.style_full__ptzZq',
    '#__next main div[class*="style_main__next_button__"] button.basic-btn.type2',
    'div[class*="style_main__next_button__"] button.basic-btn.type2',
    '#__next main button[class*="style_main__add_cart_button__"]',
    '#__next main button[class*="style_main__next_button__"]',
    '#__next main button[class*="style_next_button__"]'
  ];
  const changeBtnSelectors=[
    'div[role="status"] button.style_next_button__N_pbs',
    'div[role="status"] button[data-message-code="SW_GP_DL_117_0413"]',
    'div[role="status"] button',
    'div[class*="toast"] button.style_next_button__N_pbs',
    'div[class*="toast"] button',
    'button.style_next_button__N_pbs',
    'button[data-message-code="SW_GP_DL_117_0413"]'
  ];
  const confirmTextHints=['来場日時を設定する','来場日時を設定','日時を設定','日時設定'];
  const setDateTextHints=['来場日時を設定する','来場日時を設定'];
  const changeTextHints=['来場日時を変更する','来場日時を変更'];
  const normalizedTextOf=el=>{
    const values=[];
    if(el.textContent)values.push(el.textContent);
    if(el.innerText&&el.innerText!==el.textContent)values.push(el.innerText);
    if(el.getAttribute){
      values.push(el.getAttribute('aria-label')||'');
      values.push(el.getAttribute('title')||'');
    }
    const normalized=values
      .filter(Boolean)
      .map(v=>String(v).replace(/\s+/g,''))
      .join('');
    return normalized;
  };
  const matchesHints=(el,hints)=>{
    const normalized=normalizedTextOf(el);
    if(!normalized)return false;
    return hints.some(h=>normalized.includes(h));
  };
  const matchesConfirmText=el=>matchesHints(el,confirmTextHints);
  const matchesSetDateText=el=>matchesHints(el,setDateTextHints);
  const matchesChangeText=el=>matchesHints(el,changeTextHints);
  const findChangeBtn=(exclude=new Set())=>{
    for(const sel of changeBtnSelectors){
      const candidates=A(sel);
      if(!candidates.length)continue;
      for(const el of candidates){
        if(exclude.has(el))continue;
        if(!isEnabled(el)||!vis(el))continue;
        if(matchesChangeText(el))return el;
      }
    }
    const candidates=A('button, [role="button"], a');
    for(const el of candidates){
      if(exclude.has(el))continue;
      if(!isEnabled(el)||!vis(el))continue;
      if(matchesChangeText(el))return el;
    }
    return null;
  };
  const findConfirmBtn=(exclude=new Set())=>{
    for(const sel of confirmBtnSelectors){
      const candidates=A(sel);
      if(!candidates.length)continue;
      for(const el of candidates){
        if(exclude.has(el))continue;
        if(isEnabled(el)&&vis(el))return el;
      }
    }
    const candidates=A('button, [role="button"], a');
    for(const el of candidates){
      if(exclude.has(el))continue;
      if(!isEnabled(el)||!vis(el))continue;
      if(matchesConfirmText(el))return el;
    }
    return null;
  };
  const clickedButtons=new Set();
  let b=findConfirmBtn(clickedButtons);
  if(!b){
    b=await waitUntil(()=>findConfirmBtn(clickedButtons),{timeout:12000,interval:80,attrs:['class','disabled','aria-disabled','data-disabled','aria-hidden']});
  }
  if(!b||selectedDateISO()!==targetISO)return 'none';
  const triggeredSetDate=matchesSetDateText(b);
  KC(b);
  clickedButtons.add(b);
  if(triggeredSetDate){
    const changeBtnImmediate=findChangeBtn(clickedButtons);
    let changeBtn=changeBtnImmediate;
    if(!changeBtn){
      changeBtn=await waitUntil(()=>findChangeBtn(clickedButtons),{
        timeout:5000,
        interval:80,
        attrs:['class','style','aria-hidden','data-disabled','data-message-code']
      });
    }
    if(changeBtn){
      KC(changeBtn);
      clickedButtons.add(changeBtn);
    }
  }
  if(selectedDateISO()!==targetISO)return 'none';
  const nextBtn=await waitUntil(()=>findConfirmBtn(clickedButtons),{timeout:8000,interval:80,attrs:['class','disabled','aria-disabled','data-disabled','aria-hidden']});
  if(nextBtn){
    KC(nextBtn);
    clickedButtons.add(nextBtn);
  }
  if(await waitTypeSelectionPage(4000))return 'typeSelect';
  return 'clicked';
}
async function waitOutcome(timeout=12000){
  const result=await waitUntil(()=>{
    if(isTypeSelectionPage())return'typeSelect';
    if(Q(SEL_SUCC)&&isShown(Q(SEL_SUCC)))return'ok';
    if(Q(SEL_FAIL)&&isShown(Q(SEL_FAIL)))return'ng';
    return null;
  },{timeout,interval:80,attrs:['class','style','aria-hidden','data-message-code']});
  return result||'none';
}

/* ========= 次月ページめくり（JSパス固定 + ハードクリック） ========= */
const NEXT_MONTH_PATH = '#__next main div[class^="style_main__calendar__"] button[class*="stepper_button__"]:last-of-type';

/* --- 置き換え②：ハードクリック（B方式寄り） --- */
async function hardClick(el, tries=3, wait=140){
  if(!el) return false;
  try{ el.scrollIntoView({block:'center',behavior:'instant'}) }catch{}
  try{ el.focus?.({preventScroll:true}) }catch{}
  const rect = el.getBoundingClientRect();
  const cx = Math.max(0, Math.floor(rect.left + rect.width/2));
  const cy = Math.max(0, Math.floor(rect.top + rect.height/2));
  const fire = (type,target)=>{ try{
    const ev = new MouseEvent(type,{bubbles:true,clientX:cx,clientY:cy});
    target.dispatchEvent(ev);
  }catch{} };
  for(let i=0;i<tries;i++){
    const tgt = document.elementFromPoint(cx,cy) || el;
    fire('mouseover',tgt);
    fire('mousedown',tgt);
    try{ tgt.click?.() }catch{}
    fire('mouseup',tgt);
    const img = el.querySelector?.('img');
    if(img){
      try{ img.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:cx,clientY:cy})) }catch{}
      try{ img.click?.() }catch{}
      try{ img.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:cx,clientY:cy})) }catch{}
    }
    await new Promise(r=>setTimeout(r,wait));
  }
  return true;
}

/* --- 置き換え③：findNextBtn（スマホ版と同等のボタン探索） --- */
function findNextBtn(){
  const byPath = document.querySelector(NEXT_MONTH_PATH);
  if(byPath && isEnabled(byPath)) return byPath;

  const root = getCalendarRoot();
  let scope = root;
  if(root && root.querySelector){
    const inner = root.querySelector('[class^="style_main__calendar__"]');
    if(inner && inner!==root) scope = inner;
  }
  const seen = new Set();
  const list = [];
  const push = el => { if(el && !seen.has(el)){ seen.add(el); list.push(el); } };

  push(byPath);

  const headerSelectors = [
    '.style_header__KIQKN',
    '.style_header__',
    '.style_header',
    'header',
    '[class*="header"]'
  ];
  for(const sel of headerSelectors){
    const header = scope && scope.querySelector ? scope.querySelector(sel) : null;
    if(header){
      Array.from(header.querySelectorAll('button')).forEach(push);
      if(list.length) break;
    }
  }

  if(scope && scope.querySelectorAll){
    Array.from(scope.querySelectorAll('button.style_stepper_button__N7zDX, button[class*="stepper"]')).forEach(push);
  }

  const rectLeft = el => {
    try{
      const rect = el.getBoundingClientRect();
      return isFinite(rect.left) ? rect.left : -Infinity;
    }catch{
      return -Infinity;
    }
  };
  const pickRightMost = arr => {
    if(!arr.length) return null;
    const sorted = arr.slice().sort((a,b)=>rectLeft(a)-rectLeft(b));
    return sorted[sorted.length-1];
  };

  const enabled = list.filter(isEnabled);
  const headerBtn = pickRightMost(enabled);
  if(headerBtn) return headerBtn;

  const hasNextHint = el => {
    const texts = [];
    const add = v => { if(v) texts.push(String(v)); };
    add(el.textContent||'');
    if(el.getAttribute){
      add(el.getAttribute('aria-label'));
      add(el.getAttribute('title'));
    }
    const labelledby = el.getAttribute ? el.getAttribute('aria-labelledby') : null;
    if(labelledby){
      labelledby.split(/\s+/).forEach(id=>{
        const labelEl = document.getElementById(id.trim());
        if(labelEl) add(labelEl.textContent||'');
      });
    }
    const describedby = el.getAttribute ? el.getAttribute('aria-describedby') : null;
    if(describedby){
      describedby.split(/\s+/).forEach(id=>{
        const descEl = document.getElementById(id.trim());
        if(descEl) add(descEl.textContent||'');
      });
    }
    if(el.querySelectorAll){
      Array.from(el.querySelectorAll('img[alt]')).forEach(img=>add(img.getAttribute('alt')));
    }
    const joined = texts.join(' ').toLowerCase();
    const compact = joined.replace(/\s+/g,'');
    const hints=['next','翌','次','来月','らいげつ','か月先','ヶ月先','ｶ月先','先に進む','月先に進む'];
    if(hints.some(h=>compact.includes(h))) return true;
    return false;
  };

  const hintCandidates = (scope && scope.querySelectorAll)
    ? Array.from(scope.querySelectorAll('button, [role="button"]')).filter(el=>isEnabled(el)&&hasNextHint(el))
    : [];
  const hinted = pickRightMost(hintCandidates);
  if(hinted) return hinted;

  return byPath || null;
}

/* --- 置き換え④：描画監視→押す→10月セル/更新待ち→小安定 --- */
async function showMonthForISO(iso){
  if(!/-10-/.test(iso)) return true;
  await waitCalendarReady(5000);
  if(getCellByISO(iso)) return true;

  const targetKey = isoToYearMonthKey(iso);

  // 最大3ラウンド試行（毎回ボタンを取り直し）
  for(let round=0; round<3; round++){
    const btn=findNextBtn();
    if(!btn) break;

    const clickable=isEnabled(btn)?btn:await waitEnabled(btn,2000);
    if(!clickable) continue;

    try{ clickable.scrollIntoView({block:'center',behavior:'instant'}); }catch{}
    const beforeKey=getVisibleYearMonthKey();

    await hardClick(clickable,3,140);

    const root=getCalendarRoot();
    await waitUntil(()=>{
      if(getCellByISO(iso)) return true;
      const nowKey=getVisibleYearMonthKey();
      if(beforeKey&&nowKey&&nowKey!==beforeKey) return true;
      if(targetKey&&nowKey===targetKey) return true;
      return null;
    },{timeout:900+round*500,attrs:['class','style','aria-hidden','aria-pressed'],root});

    if(getCellByISO(iso)){
      await new Promise(r=>setTimeout(r,140));
      return true;
    }

    if(targetKey&&getVisibleYearMonthKey()===targetKey){
      await new Promise(r=>setTimeout(r,140));
      const hit=getCellByISO(iso);
      if(hit) return true;
    }
  }
  return !!getCellByISO(iso);
}

/* ========= 1日分の試行 ========= */
async function tryOnceForDate(d){
  const iso=isoOf(d);
  const calOK=await waitCalendarReady(5000);
  if(!calOK) return 'none';

  // まず今の月を見て、なければ10月指定時のみページ送り
  if(!getCellByISO(iso)){
    const shown = await showMonthForISO(iso);
    if(!shown) return 'none';
  }

  const selOK=await ensureDate(iso,8000);
  if(!selOK) return 'notSelectable';

  const activeTimes=getActiveTimeKeys();
  if(!activeTimes.length) return 'none';
  const slot=await waitFirstEnabledSlot(activeTimes,6000);
  if(!slot) return 'none';

  KC(slot);
  const slotKey=slotElementKey(slot);
  const slotEnsured=await ensurePreferredSlotSelection({
    targetKey:slotKey,
    allowedKeys:activeTimes,
    timeout:2000,
    retries:3
  });
  if(!slotEnsured) return 'none';
  if(selectedDateISO()!==iso) return 'none';

  const confirmResult=await flowConfirm(iso,{targetTimeKey:slotKey,allowedTimeKeys:activeTimes});
  if(confirmResult==='typeSelect') return 'typeSelect';
  if(confirmResult!=='clicked') return 'none';
  const o=await waitOutcome(12000);
  if(o==='typeSelect') return 'typeSelect';
  if(o==='ok') return 'ok';
  if(o==='ng') return 'ng';
  return 'none';
}

/* ========= サーバ時刻＆タイミング ========= */
let serverOffset=0;
async function syncServer(){try{const res=await fetch(location.origin+'/',{method:'HEAD',cache:'no-store'});const dh=res.headers.get('date');if(dh){const sv=new Date(dh).getTime();serverOffset=sv-Date.now()}}catch{}}
function serverNow(){return new Date(Date.now()+serverOffset)}
function secondsInMinute(){const n=serverNow();return n.getSeconds()+n.getMilliseconds()/1000}
function delayUntilNextMinute_43s(){const n=serverNow(),nx=new Date(n.getTime());nx.setSeconds(43,0);if(n.getSeconds()>43||(n.getSeconds()===43&&n.getMilliseconds()>0))nx.setMinutes(nx.getMinutes()+1);return nx.getTime()-n.getTime()}
function scheduleRetryOrNextMinute(){
  const sec=secondsInMinute();
  if(sec<53){
    if(state.r){
      ui.setStatus('再試行中');
      safeReload();
    }
  }else{
    const d=delayUntilNextMinute_43s();
    ui.setStatus('待機中');
    clearTimeout(Tm);
    Tm=setTimeout(()=>{if(state.r){resetFail();safeReload()}},d);
  }
}

/* ========= UI ========= */
let Tm=null,Clk=null;
ui=(()=>{const w=document.createElement('div');
Object.assign(w.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:999999,background:'rgba(255,255,255,.95)',padding:'10px 12px',borderRadius:'12px',boxShadow:'0 2px 10px rgba(0,0,0,.2)',fontFamily:'-apple-system,system-ui,Segoe UI,Roboto,sans-serif',width:'320px'});
const row=m=>{const d=document.createElement('div');Object.assign(d.style,{display:'flex',gap:'8px',alignItems:'center',marginBottom:(m??8)+'px'});return d};
const rTop=row();
const title=document.createElement('div');title.textContent='自動新規予約・変更';title.style.fontWeight='bold';
const tg=document.createElement('input');tg.type='checkbox';tg.checked=!!state.r;
rTop.appendChild(title);rTop.appendChild(tg);
const keepRow=row();
const keepLabelBox=document.createElement('label');Object.assign(keepLabelBox.style,{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',flex:'1'});
const keepText=document.createElement('span');keepText.textContent='ログイン維持用リロードON・OFF';
const keepToggle=document.createElement('input');keepToggle.type='checkbox';keepToggle.checked=!!state.keepAlive;
keepLabelBox.appendChild(keepText);keepLabelBox.appendChild(keepToggle);
keepRow.appendChild(keepLabelBox);
const switchRow=row();
const switchLabel=document.createElement('label');switchLabel.textContent='切替時刻';switchLabel.style.width='58px';switchLabel.style.fontSize='12px';
const switchWrap=document.createElement('div');Object.assign(switchWrap.style,{display:'flex',gap:'6px',flex:'1',alignItems:'center'});
const timeInput=document.createElement('input');timeInput.type='time';timeInput.step='60';timeInput.style.flex='1';timeInput.value=state.switchTime||'';
const switchLabelBox=document.createElement('label');Object.assign(switchLabelBox.style,{display:'flex',alignItems:'center',gap:'4px'});
const switchText=document.createElement('span');switchText.textContent='指定時間で予約開始';switchText.style.fontSize='12px';
const switchCheck=document.createElement('input');switchCheck.type='checkbox';switchCheck.checked=!!state.switchEnabled;
switchLabelBox.appendChild(switchText);switchLabelBox.appendChild(switchCheck);
switchWrap.appendChild(timeInput);switchWrap.appendChild(switchLabelBox);
switchRow.appendChild(switchLabel);switchRow.appendChild(switchWrap);
  const rTime=row(6);
  const labT=document.createElement('label');labT.textContent='現在時刻';labT.style.width='58px';labT.style.fontSize='12px';
  const tm=document.createElement('div');tm.style.fontFamily='ui-monospace,Menlo,monospace';tm.style.fontSize='12px';tm.textContent='---- --:--:--';
  rTime.appendChild(labT);rTime.appendChild(tm);
  const rTimePref=row();
  const labTimePref=document.createElement('label');labTimePref.textContent='時間帯';labTimePref.style.width='58px';labTimePref.style.fontSize='12px';
  const timeWrap=document.createElement('div');Object.assign(timeWrap.style,{display:'flex',flexWrap:'wrap',gap:'8px',flex:'1'});
  const updateTimeSelectionStatus=()=>{
    const active=getActiveTimeKeys();
    if(!active.length){
      if(state.r){
        stopOK('時間帯を選択してください');
      }else if(!state.keepAlive){
        stat.textContent='時間帯を選択してください';
        lastStatusText=stat.textContent;
      }
    }else if(!state.r&&!state.keepAlive&&lastStatusText==='時間帯を選択してください'){
      stat.textContent='停止中';
      lastStatusText=stat.textContent;
    }
  };
  TIME_CHOICES.forEach(opt=>{
    const lbl=document.createElement('label');Object.assign(lbl.style,{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px'});
    const cb=document.createElement('input');cb.type='checkbox';cb.value=opt.key;cb.checked=conf.times.includes(opt.key);
    cb.addEventListener('change',()=>{
      const idx=conf.times.indexOf(opt.key);
      if(cb.checked){
        if(idx===-1)conf.times.push(opt.key);
      }else{
        if(idx!==-1)conf.times.splice(idx,1);
      }
      conf.times=normalizeTimeKeys(conf.times);
      Lset(CONF_KEY,conf);
      updateTimeSelectionStatus();
    });
    lbl.appendChild(cb);
    const span=document.createElement('span');span.textContent=opt.label;lbl.appendChild(span);
    timeWrap.appendChild(lbl);
  });
  rTimePref.appendChild(labTimePref);rTimePref.appendChild(timeWrap);
  const rDates=row();
  const labD=document.createElement('label');labD.textContent='対象日';labD.style.width='58px';labD.style.fontSize='12px';
const addWrap=document.createElement('div');Object.assign(addWrap.style,{display:'flex',gap:'6px',flex:'1'});
const din=document.createElement('input');din.type='date';din.style.flex='1';
const add=document.createElement('button');add.textContent='追加';Object.assign(add.style,{padding:'4px 8px'});
addWrap.appendChild(din);addWrap.appendChild(add);
rDates.appendChild(labD);rDates.appendChild(addWrap);
const chips=document.createElement('div');Object.assign(chips.style,{display:'flex',flexWrap:'wrap',gap:'6px',maxHeight:'120px',overflow:'auto',marginBottom:'6px'});
const stat=document.createElement('div');stat.style.fontSize='12px';stat.textContent=state.keepAlive?keepAliveStatusText():(state.r?'稼働中':'停止中');
let lastStatusText=stat.textContent;
  w.appendChild(rTop);w.appendChild(keepRow);w.appendChild(switchRow);w.appendChild(rTime);w.appendChild(rTimePref);w.appendChild(rDates);w.appendChild(chips);w.appendChild(stat);
document.body.appendChild(w);
AutoToggleEl=tg;KeepAliveToggleEl=keepToggle;SwitchCheckEl=switchCheck;SwitchTimeInputEl=timeInput;
function setClock(s){tm.textContent=s}
function fmtClock(d){const pad=n=>('0'+n).slice(-2);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())}
function renderChips(){chips.innerHTML='';conf.dates.forEach((ds,i)=>{const b=document.createElement('span');Object.assign(b.style,{background:'#eee',borderRadius:'999px',padding:'2px 8px',fontSize:'12px'});b.textContent=ds;const x=document.createElement('button');x.textContent='×';Object.assign(x.style,{marginLeft:'6px',border:'none',background:'transparent',cursor:'pointer'});x.onclick=()=>{conf.dates.splice(i,1);Lset(CONF_KEY,conf);renderChips()};const wrap=document.createElement('span');wrap.appendChild(b);wrap.appendChild(x);chips.appendChild(wrap)})}
renderChips();
add.onclick=()=>{if(!din.value)return;const v=din.value;if(!conf.dates.includes(v))conf.dates.push(v);conf.dates.sort();Lset(CONF_KEY,conf);renderChips()};
  tg.addEventListener('change',()=>{if(tg.checked){if(conf.dates.length===0){stat.textContent='日付を追加してください';tg.checked=false;return}const activeTimeKeys=getActiveTimeKeys();if(activeTimeKeys.length===0){stat.textContent='時間帯を選択してください';lastStatusText=stat.textContent;tg.checked=false;return}if(state.keepAlive&&keepToggle.checked){keepToggle.checked=false;keepToggle.dispatchEvent(new Event('change',{bubbles:true}))}state.r=true;saveState();stat.textContent='稼働中';runCycle()}else{state.r=false;saveState();stat.textContent=state.keepAlive?keepAliveStatusText():'停止中';clearTimeout(Tm)}});
  keepToggle.addEventListener('change',()=>{if(keepToggle.checked){state.keepAlive=true;state.r=false;saveState();clearTimeout(Tm);if(tg.checked){tg.checked=false;tg.dispatchEvent(new Event('change',{bubbles:true}))}stat.textContent=keepAliveStatusText();lastStatusText=stat.textContent;scheduleKeepAliveReload();try{checkAutoSwitch(serverNow())}catch{}}else{state.keepAlive=false;if(state.switchEnabled){state.switchEnabled=false;if(state.switchNextAt!==0)state.switchNextAt=0;if(switchCheck.checked)switchCheck.checked=false;}else if(state.switchNextAt!==0){state.switchNextAt=0;}saveState();clearKeepAliveTimer();stat.textContent=state.r?'稼働中':'停止中';lastStatusText=stat.textContent;}});
  switchCheck.addEventListener('change',()=>{if(switchCheck.checked){if(!timeInput.value){stat.textContent='切替時刻を入力してください';lastStatusText=stat.textContent;switchCheck.checked=false;return}state.switchEnabled=true;state.switchTime=timeInput.value;const parsed=parseSwitchTimeString(state.switchTime);if(parsed){state.switchNextAt=computeNextSwitchAt(serverNow(),parsed.hh,parsed.mm);}else{state.switchNextAt=0;}saveState();if(state.keepAlive){stat.textContent=keepAliveStatusText();lastStatusText=stat.textContent;scheduleKeepAliveReload();try{checkAutoSwitch(serverNow())}catch{}}}else{let changed=false;if(state.switchEnabled){state.switchEnabled=false;changed=true;}if(state.switchNextAt!==0){state.switchNextAt=0;changed=true;}if(changed)saveState();if(state.keepAlive){stat.textContent=keepAliveStatusText();lastStatusText=stat.textContent;}}});
  timeInput.addEventListener('change',()=>{const v=timeInput.value||'';state.switchTime=v;if(!v&&state.switchEnabled){state.switchEnabled=false;state.switchNextAt=0;saveState();if(switchCheck.checked){switchCheck.checked=false;switchCheck.dispatchEvent(new Event('change',{bubbles:true}));return}}else{if(state.switchEnabled&&v){const parsed=parseSwitchTimeString(v);if(parsed){state.switchNextAt=computeNextSwitchAt(serverNow(),parsed.hh,parsed.mm);}else{state.switchNextAt=0;}}else if(!state.switchEnabled&&state.switchNextAt!==0){state.switchNextAt=0;}saveState()}if(state.keepAlive){stat.textContent=keepAliveStatusText();lastStatusText=stat.textContent;try{checkAutoSwitch(serverNow())}catch{}}});
function setStatus(x){if(lastStatusText!==x){lastStatusText=x;stat.textContent=x;}}
function updateKeepAliveCountdown(){if(!state.keepAlive)return;const msg=keepAliveStatusText();if(lastStatusText!==msg){lastStatusText=msg;stat.textContent=msg;}}
function uncheck(){try{tg.checked=false;tg.dispatchEvent(new Event('input',{bubbles:true}));tg.dispatchEvent(new Event('change',{bubbles:true}))}catch{}const txt=state.keepAlive?keepAliveStatusText():'停止中';stat.textContent=txt;lastStatusText=txt}
(async()=>{await syncServer();if(Clk)clearInterval(Clk);Clk=setInterval(()=>{const now=serverNow();setClock(fmtClock(now));if(state.keepAlive)updateKeepAliveCountdownDisplay();checkAutoSwitch(now)},250);checkAutoSwitch(serverNow())})().catch(()=>{});
  if(!conf.times.length&&!state.keepAlive&&lastStatusText!=='時間帯を選択してください'){updateTimeSelectionStatus();}
  return{setStatus,uncheck,updateKeepAliveCountdown}})();



if(state.keepAlive){
  setUIStatus(keepAliveStatusText());
  scheduleKeepAliveReload();
  try{checkAutoSwitch(serverNow())}catch{}
}

/* ========= メイン ========= */
function stopOK(msg){try{clearTimeout(Tm)}catch{}state.r=false;saveState();ui.uncheck();if(msg){setTimeout(()=>{try{ui.setStatus(msg)}catch{}},0)}}

async function runCycle(){
  if(isTypeSelectionPage()){resetFail();ui.setStatus('券種選択ページに移動しました');return}
  if(Q(SEL_SUCC)){resetFail();stopOK();return}
  if(Q(SEL_FAIL)){return}
  if(!state.r)return;
  if(state.keepAlive){ui.setStatus(keepAliveStatusText());return;}

  const activeTimes=getActiveTimeKeys();
  if(!activeTimes.length){
    ui.setStatus('時間帯を選択してください');
    stopOK('時間帯を選択してください');
    return;
  }

  await syncServer().catch(()=>{});
  const sec=secondsInMinute();
  if(sec<43){
    const d=delayUntilNextMinute_43s();
    ui.setStatus('待機中');
    clearTimeout(Tm);
    Tm=setTimeout(()=>{if(state.r){resetFail();safeReload()}},d);
    return;
  }

  if(sec>=53){
    const d=delayUntilNextMinute_43s();
    ui.setStatus('再試行中');
    clearTimeout(Tm);
    Tm=setTimeout(()=>{if(state.r){resetFail();safeReload()}},d);
    return;
  }

  ui.setStatus('空き枠探索中');

  const calOK=await waitCalendarReady(5000);
  if(!calOK){ui.setStatus('再試行中');return scheduleRetryOrNextMinute()}

  // まず今見えている月で選択可否
  let anySelectable=false;
  for(const ds of conf.dates){
    const cell=getCellByISO(ds);
    if(cell&&isDateCellEnabled(cell)){anySelectable=true;break}
  }

  // 見えている月で不可なら、10月が対象に含まれる場合のみ次月へ送って再判定
  if(!anySelectable){
    const octoberList = conf.dates.filter(v=>/-10-/.test(v));
    if(octoberList.length){
      await showMonthForISO(octoberList[0]); // ★ここで必ずページめくり試行
      anySelectable=false;
      for(const ds of conf.dates){
        const cell=getCellByISO(ds);
        if(cell&&isDateCellEnabled(cell)){anySelectable=true;break}
      }
    }
  }

  if(!anySelectable){
    ui.setStatus('再試行中');
    return scheduleRetryOrNextMinute();
  }

  // 予約試行
  for(const ds of conf.dates){
    ui.setStatus('予約試行中');
    const d=new Date(ds+'T00:00:00');
    const r=await tryOnceForDate(d);
    if(r==='ok'){ui.setStatus('予約完了');stopOK();return}
    if(r==='typeSelect'){resetFail();ui.setStatus('券種選択ページに移動しました');return}
    if(r==='ng'){ui.setStatus('再試行中');break}
  }

  const d=delayUntilNextMinute_43s();
  ui.setStatus('待機中');
  clearTimeout(Tm);
  Tm=setTimeout(()=>{if(state.r){resetFail();safeReload()}},d);
}

if(state.r&&!state.keepAlive)runCycle();

/* ========= トレース（reloadは上書きしない） ========= */
(()=>{ if(window.__nrTrace) return; window.__nrTrace=1;
  const iso = window.__nrISO;
  const log=(...a)=>console.log('[NR]',...a);
  const tgtSel = iso ? `.style_selector_item__9RWJw time[datetime="${iso}"]` : null;

  document.addEventListener('click',e=>{
    const b=e.target.closest('button,a');
    if(!b) return;
    const txt=(b.innerText||'').trim().slice(0,20);
    const al=(b.getAttribute('aria-label')||'').toLowerCase();
    if(/次|翌|next|forward/i.test(txt) || /次|翌|next/i.test(al) || b.matches('.style_stepper_button__N7zDX')){
      log('month-next click detected:', txt||al||b.className);
      window.__nrT0 = performance.now();
    }
  }, true);

  const root = document.querySelector('.style_main__calendar__HRSsz') || document.body;
  const seen = {tgt:false};
  const mo = new MutationObserver(()=>{
    if(tgtSel && !seen.tgt){
      const el = document.querySelector(tgtSel);
      if(el && el.offsetParent !== null){
        seen.tgt = true;
        const dt = (performance.now() - (window.__nrT0||performance.now())).toFixed(0);
        log('target cell visible:', iso, `(+${dt}ms from last next-click)`);
      }
    }
  });
  mo.observe(root, {subtree:true, childList:true, attributes:true, attributeFilter:['class','style','aria-pressed','aria-hidden']});
  log('trace armed for', iso || '(no iso set)');
})();
