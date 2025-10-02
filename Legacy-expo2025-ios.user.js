(function(){'use strict';

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
function KC(el){
  if(!el||D(el))return false;
  try{el.focus?.({preventScroll:true})}catch{};
  const ua=(navigator.userAgent||'').toLowerCase();
  const needTouch=/iphone|ipad|ipod/.test(ua);
  if(needTouch){
    try{el.dispatchEvent(new Event('touchstart',{bubbles:true,cancelable:true}))}catch{};
    try{el.dispatchEvent(new Event('touchend',{bubbles:true,cancelable:true}))}catch{};
  }
  el.click?.();
  return true;
}
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
  for(const key of filtered){if(!unique.includes(key))unique.push(key);}
  unique.sort((a,b)=>TIME_KEY_ORDER[a]-TIME_KEY_ORDER[b]);
  return unique;
}
function getActiveTimeKeys(){return normalizeTimeKeys(conf.times);}
function includesAllTimeKeys(keys){if(!Array.isArray(keys))return false;return keys.length===DEFAULT_TIME_KEYS.length&&DEFAULT_TIME_KEYS.every(k=>keys.includes(k));}
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
let state=Sget(STATE_KEY);
if(typeof state.r!=='boolean'){state={r:false};Sset(STATE_KEY,state)}
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
function collectSlotElements(){
  const lists=[
    A('div[role=button].style_main__button__Z4RWX'),
    A('button.style_main__button__Z4RWX'),
    A('[role=button].style_main__button__Z4RWX')
  ];
  const merged=[];
  for(const arr of lists){
    for(const el of arr){
      const root=slotElementRoot(el)||el;
      if(!merged.includes(root))merged.push(root);
    }
  }
  return merged;
}
function firstEnabledSlot(allowedKeys){
  const active=Array.isArray(allowedKeys)?normalizeTimeKeys(allowedKeys):[];
  const allowAny=!active.length||includesAllTimeKeys(active);
  const all=collectSlotElements();
  const available=all.filter(el=>isEnabled(el));
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
  if(el.matches?.('button,[role="button"]'))return el;
  return el.closest?.('button,[role="button"]')||el;
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
async function flowConfirm(targetISO){
  if(selectedDateISO()!==targetISO)return false;
  const clickedButtons=new Set();
  const host='#__next > div > div > main > div > div.style_main__add_cart_button__DCOw8';
  const primarySel=host+' .basic-btn.type2.style_full__ptzZq';
  let b=await waitEnabled(primarySel,12000)||await waitEnabled('button.basic-btn.type2.style_full__ptzZq',12000);
  if(!b||selectedDateISO()!==targetISO)return false;
  const normalizedTextOf=el=>{
    if(!el)return'';
    const values=[];
    if(el.textContent)values.push(el.textContent);
    if(el.innerText&&el.innerText!==el.textContent)values.push(el.innerText);
    if(el.getAttribute){
      values.push(el.getAttribute('aria-label')||'');
      values.push(el.getAttribute('title')||'');
    }
    return values.filter(Boolean).map(v=>String(v).replace(/\s+/g,'')).join('');
  };
  const matchesHints=(el,hints)=>{
    if(!Array.isArray(hints)||!hints.length)return false;
    const normalized=normalizedTextOf(el);
    if(!normalized)return false;
    return hints.some(h=>normalized.includes(h));
  };
  const setDateTextHints=['来場日時を設定する','来場日時を設定'];
  const changeTextHints=['来場日時を変更する','来場日時を変更'];
  const matchesSetDateText=el=>matchesHints(el,setDateTextHints);
  const matchesChangeText=el=>matchesHints(el,changeTextHints);
  const changeBtnSelectors=[
    'div[role="status"] button.style_next_button__N_pbs',
    'div[role="status"] button[data-message-code="SW_GP_DL_117_0413"]',
    'div[role="status"] button',
    'div.style_main__button__fac_Z button.style_next_button__N_pbs',
    'div.style_main__button__fac_Z button',
    'div[class*="toast"] button.style_next_button__N_pbs',
    'div[class*="toast"] button',
    'button.style_next_button__N_pbs',
    'button[data-message-code="SW_GP_DL_117_0413"]'
  ];
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
    return null;
  };
  KC(b);
  clickedButtons.add(b);
  if(selectedDateISO()!==targetISO)return false;
  if(matchesSetDateText(b)){
    let changeBtn=findChangeBtn(clickedButtons);
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
  if(selectedDateISO()!==targetISO)return false;
  const confirmSelList=['button.style_next_button__N_pbs','button:has(span.btn-text), a:has(span.btn-text)'];
  for(const sel of confirmSelList){
    const existing=typeof sel==='string'?Q(sel):sel;
    if(existing&&clickedButtons.has(existing))continue;
    const c=await waitEnabled(sel,8000);
    if(!c||clickedButtons.has(c))continue;
    KC(c);
    clickedButtons.add(c);
    break;
  }
  return true;
}
async function waitOutcome(timeout=12000){
  const ok=await waitUntil(()=>Q(SEL_SUCC)||Q(SEL_FAIL)||null,{timeout,interval:80,attrs:['class','style']});
  if(!ok)return'none';
  return Q(SEL_SUCC)?'ok':(Q(SEL_FAIL)?'ng':'none');
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
  const cy = Math.max(0, Math.floor(rect.top  + rect.height/2));
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
  if(!/-10-/.test(iso)) return true;      // 10月以外は不要
  await waitCalendarReady(5000);           // まず描画待ち
  if(getCellByISO(iso)) return true;      // 既に選択対象が表示済み

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
  if(!activeTimes.length)return 'none';
  const slot=await waitFirstEnabledSlot(activeTimes,6000);
  if(!slot) return 'none';

  KC(slot);
  const slotTime=extractSlotTime(slotElementRoot(slot)||slot);
  const slotKey=(()=>{if(slotTime){const choice=TIME_CHOICES.find(opt=>opt.hour===slotTime.hour);return choice?choice.key:null;}return null;})();
  if(slotKey&&activeTimes.length&&!activeTimes.includes(slotKey))return 'none';
  if(selectedDateISO()!==iso) return 'none';

  await flowConfirm(iso);
  const o=await waitOutcome(12000);
  if(o==='ok') return 'ok';
  return 'none';
}

/* ========= サーバ時刻＆タイミング ========= */
let serverOffset=0;
async function syncServer(){try{const res=await fetch(location.origin+'/',{method:'HEAD',cache:'no-store'});const dh=res.headers.get('date');if(dh){const sv=new Date(dh).getTime();serverOffset=sv-Date.now()}}catch{}}
function serverNow(){return new Date(Date.now()+serverOffset)}
function secondsInMinute(){const n=serverNow();return n.getSeconds()+n.getMilliseconds()/1000}
function delayUntilNextMinute_15s(){const n=serverNow(),nx=new Date(n.getTime());nx.setSeconds(15,0);if(n.getSeconds()>15||(n.getSeconds()===15&&n.getMilliseconds()>0))nx.setMinutes(nx.getMinutes()+1);return nx.getTime()-n.getTime()}
function scheduleRetryOrNextMinute(){
  const sec=secondsInMinute();
  if(sec<25){
    if(state.r){
      ui.setStatus('即再読込（<25s）');
      safeReload();
    }
  }else{
    const d=delayUntilNextMinute_15s();
    ui.setStatus('次: →15s (+'+(Math.round(d/100)/10)+'s)');
    clearTimeout(Tm);
    Tm=setTimeout(()=>{if(state.r){resetFail();safeReload()}},d);
  }
}

/* ========= UI ========= */
let Tm=null,Clk=null;
const ui=(()=>{
  const w=document.createElement('div');
  Object.assign(w.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:999999,background:'rgba(255,255,255,.95)',padding:'10px 12px',borderRadius:'12px',boxShadow:'0 2px 10px rgba(0,0,0,.2)',fontFamily:'-apple-system,system-ui,Segoe UI,Roboto,sans-serif',width:'320px'});
  const row=m=>{
    const d=document.createElement('div');
    Object.assign(d.style,{display:'flex',gap:'8px',alignItems:'center',marginBottom:(m??8)+'px'});
    return d;
  };
  const rTop=row();
  const title=document.createElement('div');
  title.textContent='自動新規予約';
  title.style.fontWeight='bold';
  const tg=document.createElement('input');
  tg.type='checkbox';
  tg.checked=!!state.r;
  rTop.appendChild(title);
  rTop.appendChild(tg);
  const rTime=row(6);
  const labT=document.createElement('label');
  labT.textContent='SERVER';
  labT.style.width='58px';
  labT.style.fontSize='12px';
  const tm=document.createElement('div');
  tm.style.fontFamily='ui-monospace,Menlo,monospace';
  tm.style.fontSize='12px';
  tm.textContent='--:--:--';
  rTime.appendChild(labT);
  rTime.appendChild(tm);
  const rTimePref=row();
  const labTimePref=document.createElement('label');
  labTimePref.textContent='時間帯';
  labTimePref.style.width='58px';
  labTimePref.style.fontSize='12px';
  const timeBox=document.createElement('div');
  Object.assign(timeBox.style,{display:'flex',flexDirection:'column',gap:'4px',flex:'1'});
  const timeWrap=document.createElement('div');
  Object.assign(timeWrap.style,{display:'flex',flexWrap:'wrap',gap:'6px'});
  const timeStatus=document.createElement('div');
  Object.assign(timeStatus.style,{fontSize:'11px',lineHeight:'1.4',color:'#333'});
  TIME_CHOICES.forEach(opt=>{
    const lbl=document.createElement('label');
    Object.assign(lbl.style,{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px'});
    const cb=document.createElement('input');
    cb.type='checkbox';
    cb.value=opt.key;
    cb.checked=conf.times.includes(opt.key);
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
      if(state.r&&!getActiveTimeKeys().length){
        tg.checked=false;
        tg.dispatchEvent(new Event('change',{bubbles:true}));
      }
    });
    lbl.appendChild(cb);
    const span=document.createElement('span');
    span.textContent=opt.label;
    lbl.appendChild(span);
    timeWrap.appendChild(lbl);
  });
  timeBox.appendChild(timeWrap);
  timeBox.appendChild(timeStatus);
  rTimePref.appendChild(labTimePref);
  rTimePref.appendChild(timeBox);
  const rDates=row();
  const labD=document.createElement('label');
  labD.textContent='対象日';
  labD.style.width='58px';
  labD.style.fontSize='12px';
  const addWrap=document.createElement('div');
  Object.assign(addWrap.style,{display:'flex',gap:'6px',flex:'1'});
  const din=document.createElement('input');
  din.type='date';
  din.style.flex='1';
  const add=document.createElement('button');
  add.textContent='追加';
  Object.assign(add.style,{padding:'4px 8px'});
  addWrap.appendChild(din);
  addWrap.appendChild(add);
  rDates.appendChild(labD);
  rDates.appendChild(addWrap);
  const chips=document.createElement('div');
  Object.assign(chips.style,{display:'flex',flexWrap:'wrap',gap:'6px',maxHeight:'120px',overflow:'auto',marginBottom:'6px'});
  const stat=document.createElement('div');
  stat.style.fontSize='12px';
  stat.textContent=state.r?'稼働中':'停止中';
  w.appendChild(rTop);
  w.appendChild(rTime);
  w.appendChild(rTimePref);
  w.appendChild(rDates);
  w.appendChild(chips);
  w.appendChild(stat);
  document.body.appendChild(w);
  function setClock(s){tm.textContent=s;}
  function fmtClock(d){
    const pad=n=>('0'+n).slice(-2);
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
  }
  function updateTimeSelectionStatus(){
    const active=getActiveTimeKeys();
    if(!active.length){
      timeStatus.textContent='※時間帯を選択してください';
      timeStatus.style.color='#d33';
      return;
    }
    const labels=active.map(key=>{
      const opt=TIME_CHOICES.find(o=>o.key===key);
      return opt?opt.label:key;
    });
    if(includesAllTimeKeys(active)){
      timeStatus.textContent='全ての時間帯を監視します';
    }else{
      timeStatus.textContent='監視中: '+labels.join('・');
    }
    timeStatus.style.color='#333';
  }
  function renderChips(){
    chips.innerHTML='';
    conf.dates.forEach((ds,i)=>{
      const b=document.createElement('span');
      Object.assign(b.style,{background:'#eee',borderRadius:'999px',padding:'2px 8px',fontSize:'12px'});
      b.textContent=ds;
      const x=document.createElement('button');
      x.textContent='×';
      Object.assign(x.style,{marginLeft:'6px',border:'none',background:'transparent',cursor:'pointer'});
      x.onclick=()=>{
        conf.dates.splice(i,1);
        Lset(CONF_KEY,conf);
        renderChips();
      };
      const wrap=document.createElement('span');
      wrap.appendChild(b);
      wrap.appendChild(x);
      chips.appendChild(wrap);
    });
  }
  renderChips();
  updateTimeSelectionStatus();
  add.onclick=()=>{
    if(!din.value)return;
    const v=din.value;
    if(!conf.dates.includes(v))conf.dates.push(v);
    conf.dates.sort();
    Lset(CONF_KEY,conf);
    renderChips();
  };
  tg.addEventListener('change',()=>{
    if(tg.checked){
      if(conf.dates.length===0){
        stat.textContent='日付を追加してください';
        tg.checked=false;
        return;
      }
      const activeTimeKeys=getActiveTimeKeys();
      if(activeTimeKeys.length===0){
        stat.textContent='時間帯を選択してください';
        tg.checked=false;
        updateTimeSelectionStatus();
        return;
      }
      state.r=true;
      Sset(STATE_KEY,state);
      stat.textContent='稼働中';
      runCycle();
    }else{
      state.r=false;
      Sset(STATE_KEY,state);
      stat.textContent='停止中';
      clearTimeout(Tm);
    }
  });
  function setStatus(x){stat.textContent=x;}
  function uncheck(){
    try{
      tg.checked=false;
      tg.dispatchEvent(new Event('input',{bubbles:true}));
      tg.dispatchEvent(new Event('change',{bubbles:true}));
    }catch{}
    stat.textContent='停止中';
  }
  (async()=>{
    await syncServer();
    if(Clk)clearInterval(Clk);
    Clk=setInterval(()=>{setClock(fmtClock(serverNow()));},250);
  })().catch(()=>{});
  return{setStatus,uncheck};
})();

/* ========= メイン ========= */
function stopOK(){try{clearTimeout(Tm)}catch{}state.r=false;Sset(STATE_KEY,state);ui.uncheck()}

async function runCycle(){
  if(Q(SEL_SUCC)){resetFail();stopOK();return}
  if(Q(SEL_FAIL)){return}
  if(!state.r)return;
  if(!getActiveTimeKeys().length){ui.setStatus('時間帯を選択してください');stopOK();return}

  await syncServer().catch(()=>{});
  const sec=secondsInMinute();
  if(sec<15){
    const d=delayUntilNextMinute_15s();
    ui.setStatus('待機: →15s (+'+(Math.round(d/100)/10)+'s)');
    clearTimeout(Tm);
    Tm=setTimeout(()=>{if(state.r){resetFail();safeReload()}},d);
    return;
  }

  if(sec>=25){
    const d=delayUntilNextMinute_15s();
    ui.setStatus('枠外: →15s (+'+(Math.round(d/100)/10)+'s)');
    clearTimeout(Tm);
    Tm=setTimeout(()=>{if(state.r){resetFail();safeReload()}},d);
    return;
  }

  const calOK=await waitCalendarReady(5000);
  if(!calOK){ui.setStatus('カレンダー未描画 → 即再読込');return scheduleRetryOrNextMinute()}

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
    ui.setStatus('選択不可（9月→10月確認済）: 即再読込');
    return scheduleRetryOrNextMinute();
  }

  // 予約試行
  for(const ds of conf.dates){
    const d=new Date(ds+'T00:00:00');
    const r=await tryOnceForDate(d);
    if(r==='ok'){ui.setStatus('予約完了');stopOK();return}
    if(r==='ng'){ui.setStatus('押し負け→継続');break}
  }

  const d=delayUntilNextMinute_15s();
  ui.setStatus('次: →15s (+'+(Math.round(d/100)/10)+'s)');
  clearTimeout(Tm);
  Tm=setTimeout(()=>{if(state.r){resetFail();safeReload()}},d);
}

if(state.r)runCycle();

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

})();
