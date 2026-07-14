/* ============================================================
   SRDI-Service Mind — app.js  (WP2 Frontend สาธารณะ)
   หน้าเว็บ decoupled: เรียก GAS Web App ด้วย fetch (text/plain) ตาม API_CONTRACT
   หน้าในเฟสนี้: home (หน้าหลัก) · form (wizard 3 สเต็ป + OTP) · track (ติดตาม/แก้ไข/ประเมิน)
   หน้าเจ้าหน้าที่ (login/admin/assignee) = WP3
   ============================================================ */

/* ★★★★★  จุดที่ต้องกรอกเอง (1 จุดเดียว)  ★★★★★
   วาง /exec URL ที่ได้จากการ Deploy backend (Apps Script) แทนข้อความ placeholder ด้านล่าง
   ตัวอย่าง: const API_URL = 'https://script.google.com/macros/s/AKfycbwPaN1CtgAOKD4tK6WPPT8dAhTdbtorUYIC8D5Ws3ZaLlTPjiSbkqaxMrDgPkWI_zpIuQ/exec';
*/
const API_URL = 'PASTE_WEBAPP_EXEC_URL_HERE';

/* --- ค่าคงที่ระบบ --- */
const API_PLACEHOLDER = 'PASTE_WEBAPP_EXEC_URL_HERE';
const API_TIMEOUT_MS = 30000;               // หมดเวลาเชื่อมต่อ 30 วินาที (ตรงกับ mockup)
const TABS = [
  { id:'home',  t:'หน้าหลัก' },
  { id:'form',  t:'📝 ยื่นคำขอ', cta:1 },
  { id:'track', t:'🔎 ติดตาม' }
];

/* --- ตัวแปรสถานะรวม --- */
let S = { screen:'home', theme:'light' };
let CFG = null;          // config จาก backend (ชื่อระบบ/ประเภท/ป้ายสถานะ/เพดานไฟล์ ...)
let REQUESTERS = [];     // [{name,email,department}] สำหรับ autofill (SM-D20)
let TYPES = {};          // {"ประเภท":["ย่อย",...]} (SM-D24 config-driven — ไม่ hardcode)

/* ============================================================
   1) ตัวช่วยเรียก API  (สัญญา API_CONTRACT §0 — text/plain เท่านั้น)
   ============================================================ */
async function api(action, params){
  if(API_URL === API_PLACEHOLDER){
    throw { error:'NO_API_URL', msg:'ยังไม่ได้ตั้งค่า API_URL — ผู้ดูแลต้องวาง /exec URL ในไฟล์ app.js ก่อน' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), API_TIMEOUT_MS);
  let res;
  try{
    res = await fetch(API_URL, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=utf-8' },   // ★ text/plain เท่านั้น เลี่ยง CORS preflight
      body: JSON.stringify(Object.assign({ action }, params || {})),
      signal: ctrl.signal
    });
  }catch(e){
    clearTimeout(timer);
    const aborted = e && e.name === 'AbortError';
    throw { error: aborted ? 'TIMEOUT' : 'NETWORK',
            msg: aborted ? 'หมดเวลาเชื่อมต่อ (30 วินาที) — กรุณาลองใหม่'
                         : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ตแล้วลองใหม่' };
  }
  clearTimeout(timer);
  let json;
  try{ json = JSON.parse(await res.text()); }
  catch(e){ throw { error:'BAD_RESPONSE', msg:'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — โปรดแจ้งผู้ดูแลระบบ' }; }
  if(!json || json.ok !== true){
    throw { error:(json && json.error) || 'ERR', msg:(json && json.msg) || 'เกิดข้อผิดพลาด — กรุณาลองใหม่' };
  }
  return json.data;
}

/* ============================================================
   2) ตัวช่วยทั่วไป
   ============================================================ */
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function qsp(){ return new URLSearchParams(location.search); }

/* วันที่ ISO → ไทย (พ.ศ.) */
const TH_MONTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function fmtDate(iso, withTime){
  if(!iso) return '—';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return esc(iso);
  let s = d.getDate() + ' ' + TH_MONTH[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  if(withTime) s += ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  return s;
}
function fmtBytes(n){
  if(n == null || isNaN(n)) return '';
  if(n < 1024) return n + ' B';
  if(n < 1048576) return (n/1024).toFixed(0) + ' KB';
  return (n/1048576).toFixed(1) + ' MB';
}
/* ปีงบประมาณไทย (ต.ค.–ก.ย.) จากวันปัจจุบัน — เป็นป้ายแสดงผล ไม่ใช่ข้อมูล backend */
function thaiFiscalYear(){
  const d = new Date();
  let be = d.getFullYear() + 543;
  if(d.getMonth() >= 9) be += 1;   // ต.ค.เป็นต้นไป = ปีงบถัดไป
  return be;
}

/* ป้ายสถานะ/ความด่วน — ดึงจาก config (SM-D24 ไม่ hardcode ข้อความ) */
const STATUS_CLASS = { NEW:'b-new', RETURNED_INTAKE:'b-return', ASSIGNED:'b-assigned', PROGRESS:'b-progress', REVISION:'b-revision', CLOSED:'b-closed', CANCELLED:'b-cancel' };
function statusLabel(code){ return (CFG && CFG.status_labels && CFG.status_labels[code]) || code || ''; }
function badge(code){ return `<span class="badge ${STATUS_CLASS[code] || 'b-new'}">${esc(statusLabel(code))}</span>`; }
const PRI_CLASS = { red:'pri-red', yellow:'pri-yellow', green:'pri-green', none:'pri-none' };
function priLabel(p){ return (CFG && CFG.priority_labels && CFG.priority_labels[p]) || ''; }
function pdot(p){ return `<span class="pri ${PRI_CLASS[p] || 'pri-none'}" title="${esc(priLabel(p))}"></span>`; }

/* toast + modal */
function toast(m){ const d = document.createElement('div'); d.className='toast'; d.textContent = m; document.body.appendChild(d); setTimeout(()=>d.remove(), 2800); }
function openM(html){ $('modal').innerHTML = html; $('ov').classList.add('show'); }
function closeM(){ $('ov').classList.remove('show'); $('modal').innerHTML = ''; }

/* แบนเนอร์ระดับหน้า */
function showBanner(msg, isErr){ const b = $('appBanner'); b.textContent = msg; b.className = 'app-banner' + (isErr ? ' err' : ''); b.style.display = ''; }
function hideBanner(){ $('appBanner').style.display = 'none'; }

/* state cards ใช้ซ้ำ */
function loadingCard(text){ return `<div class="panel"><div class="skel" style="height:52px;margin-bottom:10px"></div><div class="skel" style="height:52px;margin-bottom:10px"></div><p class="statecard" style="padding:10px"><span class="dots">${esc(text||'กำลังโหลดข้อมูล')}</span></p></div>`; }
function errorCard(msg, retryFn){ return `<div class="panel statecard"><div class="ico">⚠️</div><h3 style="color:var(--red)">โหลดข้อมูลไม่สำเร็จ</h3><p>${esc(msg||'การเชื่อมต่อขัดข้อง')}</p>${retryFn?`<button class="btn primary" onclick="${retryFn}">↻ ลองใหม่</button>`:''}</div>`; }

/* ============================================================
   3) ธีม (โหมดมืด) + แถบเมนู + router
   ============================================================ */
function setTheme(t){
  S.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  try{ localStorage.setItem('sm_theme', t); }catch(e){}
  const b = $('mBtn'); if(b) b.textContent = (t === 'light' ? '🌙' : '☀️');
}
function initTheme(){
  let t = null;
  try{ t = localStorage.getItem('sm_theme'); }catch(e){}
  if(t !== 'light' && t !== 'dark'){
    t = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  setTheme(t);
}
function buildBars(){
  let tabs = TABS.slice();
  if(AUTH.user){
    if(isIntake()) tabs.push({ id:'admin', t:'📊 จัดการงาน' });
    tabs.push({ id:'assignee', t:'🗂️ งานของฉัน' });
  }
  $('tabs').innerHTML =
    tabs.map(x => `<button class="tab ${S.screen === x.id ? 'active' : ''} ${x.cta ? 'cta' : ''}" data-scr="${x.id}" ${S.screen === x.id ? 'aria-current="page"' : ''}>${x.t}</button>`).join('')
    + `<button class="tab mode" id="mBtn" data-mode aria-label="สลับโหมดสว่าง/มืด">${S.theme === 'light' ? '🌙' : '☀️'}</button>`;
  const sl = $('staffLink');
  if(AUTH.user){
    $('who').innerHTML = `<span class="rolepill">${esc(roleLabel(AUTH.user.role))}</span> <b>${esc(AUTH.user.name || '')}</b> · เข้าสู่ระบบแล้ว`;
    if(sl){ sl.textContent = 'ออกจากระบบ'; sl.removeAttribute('data-scr'); sl.setAttribute('data-act','logout'); }
  }else{
    $('who').innerHTML = `<span class="rolepill">ผู้แจ้ง</span> ไม่ต้องเข้าสู่ระบบ — ส่งคำขอและติดตามได้เลย`;
    if(sl){ sl.textContent = '🔑 เจ้าหน้าที่'; sl.setAttribute('data-scr','staff'); sl.removeAttribute('data-act'); }
  }
  if(CFG){
    if(CFG.system_title) $('brandTitle').textContent = CFG.system_title;
    if(CFG.subtitle) $('brandSub').textContent = CFG.subtitle;
  }
}
/* ไปหน้า screen + อัปเดต URL (?tab=...) โดยไม่รีโหลด — ลิงก์อีเมล/back button ใช้ได้ */
function go(screen, extra){
  S.screen = screen;
  const p = new URLSearchParams();
  p.set('tab', screen);
  if(extra){ Object.keys(extra).forEach(k => { if(extra[k] != null && extra[k] !== '') p.set(k, extra[k]); }); }
  history.pushState({ screen }, '', location.pathname + '?' + p.toString());
  render();
}
function renderFromUrl(){
  const t = qsp().get('tab') || 'home';
  S.screen = ['home','form','track','staff','login','admin','assignee'].includes(t) ? t : 'home';
  render();
}
function render(){
  // จัดการหน้าเจ้าหน้าที่ (WP3): alias 'staff' + guard สิทธิ์
  if(S.screen === 'staff') S.screen = AUTH.user ? staffHome() : 'login';
  if((S.screen === 'admin' || S.screen === 'assignee') && !AUTH.user) S.screen = 'login';
  if(S.screen === 'admin' && AUTH.user && !isIntake()) S.screen = 'assignee';
  buildBars();
  const st = $('stage');
  if(S.screen === 'home')          st.innerHTML = homeV();
  else if(S.screen === 'form')     st.innerHTML = formV();
  else if(S.screen === 'track')    st.innerHTML = trackV();
  else if(S.screen === 'login')    st.innerHTML = loginV();
  else if(S.screen === 'admin')    st.innerHTML = adminV();
  else if(S.screen === 'assignee') st.innerHTML = assigneeV();
  else                             st.innerHTML = homeV();
  window.scrollTo(0, 0);
  if(S.screen === 'home')     homeAfter();
  if(S.screen === 'form')     formAfter();
  if(S.screen === 'track')    trackAfter();
  if(S.screen === 'login')    loginAfter();
  if(S.screen === 'admin')    adminAfter();
  if(S.screen === 'assignee') assigneeAfter();
}

/* ============================================================
   4) หน้า HOME (hero + snapshot + stat) — SM-D31
      hero + การ์ดข้อมูล = static ใช้ได้เสมอ
      snapshot/stat = เรียก optional action `publicStats` (มี→แสดงจริง · ไม่มี→ซ่อน graceful)
   ============================================================ */
function homeV(){
  return `
  <div class="hero">
    <div>
      <span class="fy-badge">ปีงบประมาณ ${thaiFiscalYear()} · เปิดรับคำขอ</span>
      <h1>ยื่นคำขอ ติดตาม <em>งานบริหารทั่วไป</em> ในที่เดียว โปร่งใส ตรวจสอบได้</h1>
      <p class="sub">ยื่นคำขอให้ทีมงานบริหารทั่วไปช่วยจัดทำหนังสือราชการและงานบริการอื่น ๆ แนบไฟล์ประกอบ ยืนยันตัวตนด้วย OTP และติดตามทุกสถานะจนปิดงาน</p>
      <div class="btns"><button class="btn primary big" data-scr="form">📝 ยื่นคำขอรับบริการ</button><button class="btn ghost big" data-scr="track">🔎 ติดตามสถานะ</button></div>
      <p class="help" style="margin-top:14px">อิงมาตรฐาน ITIL 4 · ISO 10002 · WCAG 2.2</p>
    </div>
    <div id="homeSnap">${homeGuideCard()}</div>
  </div>
  <div class="grid g4" id="homeStats"></div>
  <div class="grid g3" style="margin-top:20px">
    <div class="panel lift"><h3 style="font-size:15px">📄 ระบบนี้ช่วยอะไร</h3><p style="font-size:13px;color:var(--ink2);margin:8px 0 0">ยื่นคำขอให้งานบริหารทั่วไปช่วยดำเนินการ เช่น จัดทำหนังสือราชการ (บันทึกข้อความ คำสั่ง หนังสือเชิญ) และงานบริการอื่น ๆ ไม่จำกัดเฉพาะหนังสือราชการ</p></div>
    <div class="panel lift"><h3 style="font-size:15px">🔒 ยืนยันตัวตนด้วย OTP</h3><p style="font-size:13px;color:var(--ink2);margin:8px 0 0">เมื่อกดส่งคำขอ ระบบส่งรหัส OTP ไปยังอีเมลของท่าน เพื่อยืนยันว่าเป็นผู้ยื่นตัวจริง (กันการแอบอ้างส่งแทน)</p></div>
    <div class="panel lift"><h3 style="font-size:15px">📎 แนบไฟล์ประกอบได้</h3><p style="font-size:13px;color:var(--ink2);margin:8px 0 0">แนบไฟล์ PDF, Word, Excel หรือรูปภาพประกอบคำขอได้ และติดตามไฟล์ทุกเวอร์ชันในหน้าติดตามสถานะ</p></div>
  </div>`;
}
/* การ์ดคู่มือ 3 ขั้นตอน (แสดงในช่อง snapshot เมื่อยังไม่มีสถิติสาธารณะ) */
function homeGuideCard(){
  return `<div class="panel snap">
    <div class="head"><h3>📌 เริ่มต้นใช้งาน</h3><span>ผู้แจ้ง</span></div>
    <div class="kv">
      <div class="row"><span class="lg"><b style="color:var(--green)">1</b> กรอกคำขอ + แนบไฟล์</span></div>
      <div class="row"><span class="lg"><b style="color:var(--green)">2</b> ยืนยันด้วยรหัส OTP ทางอีเมล</span></div>
      <div class="row"><span class="lg"><b style="color:var(--green)">3</b> รับเลขคำขอ + ติดตามสถานะ</span></div>
    </div>
    <div style="margin-top:12px"><button class="btn primary" style="width:100%" data-scr="form">📝 เริ่มยื่นคำขอ</button></div>
  </div>`;
}
async function homeAfter(){
  const snap = $('homeSnap'), stats = $('homeStats');
  if(!snap) return;
  if(API_URL === API_PLACEHOLDER) return;             // ยังไม่ต่อ backend → คงการ์ดคู่มือไว้
  let d = null;
  try{ d = await api('publicStats'); }                 // action เสริม (อาจยังไม่มีใน backend)
  catch(e){ d = null; }                                // ไม่มี/ผิดพลาด → degrade เงียบ ๆ (คงการ์ดคู่มือ)
  if(!d || !$('homeSnap')) return;
  // มีสถิติสาธารณะจริง → แสดง donut + สรุป + stat cards
  const total = d.total || 0, open = d.open != null ? d.open : (d.open_total || 0);
  const closed = d.closed != null ? d.closed : (total - open);
  const rate = d.closed_rate != null ? Math.round(d.closed_rate) : (total ? Math.round(closed*100/total) : 0);
  const bs = d.by_status || {};
  const sat = d.satisfaction || {};
  $('homeSnap').innerHTML = `<div class="panel snap">
    <div class="head"><h3>📌 ภาพรวมบริการ</h3><span>ปีงบ ${esc(d.fiscal_year || thaiFiscalYear())}</span></div>
    <div class="snaptop">
      <div class="donut" style="background:conic-gradient(var(--green) 0 ${rate}%,var(--heat-empty) ${rate}% 100%)"><div class="in"><b>${rate}%</b><span>ปิดงาน</span></div></div>
      <div class="kv" style="flex:1">
        <div class="row"><span class="lg"><span class="pri pri-none"></span>รอคัดกรอง</span><b>${(bs.NEW||0)+(bs.RETURNED_INTAKE||0)}</b></div>
        <div class="row"><span class="lg"><span class="pri pri-yellow"></span>กำลังดำเนินการ</span><b>${(bs.PROGRESS||0)+(bs.ASSIGNED||0)+(bs.REVISION||0)}</b></div>
        <div class="row"><span class="lg"><span class="pri pri-green"></span>ปิดงานแล้ว</span><b>${bs.CLOSED != null ? bs.CLOSED : closed}</b></div>
      </div>
    </div>
  </div>`;
  if(stats && $('homeStats')){
    const satTxt = (sat.avg != null && sat.count) ? `<b>${Number(sat.avg).toFixed(1)}</b><span style="font-size:14px;color:var(--ink3)">/5</span>` : '—';
    $('homeStats').innerHTML = `
      <div class="panel stat lift"><div class="num">${total}</div><div class="lbl">คำขอทั้งหมด (ปีงบนี้)</div><span class="chip c-green" style="margin-top:8px">บริการทั่วไป</span></div>
      <div class="panel stat lift"><div class="num"><b>${open}</b></div><div class="lbl">รอดำเนินการ</div><span class="chip c-amber" style="margin-top:8px">ในคิว</span></div>
      <div class="panel stat lift"><div class="num">${closed}</div><div class="lbl">ปิดงานแล้ว</div><span class="chip c-blue" style="margin-top:8px">${rate}%</span></div>
      <div class="panel stat lift"><div class="num">${satTxt}</div><div class="lbl">ความพึงพอใจ</div><span class="chip c-green" style="margin-top:8px">ISO 10002</span></div>`;
  }
}

/* ============================================================
   5) โมดูลฝั่งเจ้าหน้าที่ (WP3): auth + login + admin + assignee
   ============================================================ */
let AUTH = { token:null, user:null };
let STAFF_LIST = [];                 // cache สำหรับ dropdown มอบหมาย
let LOGIN = { step:1, email:'', resendLeft:0, timer:null };
let ADMIN = { queue:[], dash:null, workload:[] };
let MYT = { rows:[] };

function roleLabel(r){ return r==='admin'?'ผู้ดูแลระบบ':r==='moderator'?'ผู้กลั่นกรอง':r==='assignee'?'ผู้รับผิดชอบ':(r||''); }
function isIntake(){ return !!(AUTH.user && (AUTH.user.role==='admin' || AUTH.user.role==='moderator')); }
function staffHome(){ return isIntake() ? 'admin' : 'assignee'; }

/* เรียก API แบบแนบ token + จับ session หมดอายุ */
async function apiA(action, params){
  try{ return await api(action, Object.assign({ token: AUTH.token }, params || {})); }
  catch(err){
    if(err && (err.error==='SESSION_EXPIRED' || err.error==='SESSION_INVALID')){ doLogout(true); throw { error:err.error, msg:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' }; }
    throw err;
  }
}
async function restoreSession(){
  if(API_URL === API_PLACEHOLDER) return;
  let tk = null; try{ tk = sessionStorage.getItem('sm_token'); }catch(e){}
  if(!tk) return;
  AUTH.token = tk;
  try{ const d = await api('checkSession', { token: tk }); AUTH.user = d.user; buildBars(); if(['login','staff','home'].includes(S.screen)) go(staffHome()); }
  catch(e){ AUTH.token=null; AUTH.user=null; try{ sessionStorage.removeItem('sm_token'); }catch(_){} }
}
function doLogout(silent){
  const tk = AUTH.token;
  AUTH.token=null; AUTH.user=null; STAFF_LIST=[];
  try{ sessionStorage.removeItem('sm_token'); }catch(e){}
  if(tk) api('logout', { token: tk }).catch(()=>{});
  if(!silent) toast('ออกจากระบบแล้ว');
  go('home');
}

/* ---------- LOGIN (OTP เจ้าหน้าที่) ---------- */
function loginV(){
  const s2 = LOGIN.step === 2;
  return `<div style="max-width:420px;margin:26px auto"><div class="panel" style="padding:28px 24px">
    <div class="statecard" style="padding:0 0 10px"><div class="ico">🔑</div><h3>เข้าสู่ระบบเจ้าหน้าที่</h3><p>ยืนยันตัวตนด้วยรหัส OTP ทางอีเมล</p></div>
    <div class="field"><label class="fl" for="lgEmail">อีเมลเจ้าหน้าที่</label><input type="email" id="lgEmail" value="${esc(LOGIN.email)}" placeholder="you@yru.ac.th" ${s2?'disabled':''}></div>
    ${s2 ? `<div class="field" style="margin-bottom:6px"><label class="fl">รหัส OTP (6 หลัก)</label><div class="otp-row" id="otpRow">${[0,1,2,3,4,5].map(i=>`<input maxlength="1" inputmode="numeric" autocomplete="one-time-code" aria-label="รหัสหลักที่ ${i+1}" data-i="${i}">`).join('')}</div></div>
      <div class="help" style="text-align:center">ไม่ได้รับรหัส? <a href="#" id="resendLink" onclick="return loginResend()">ส่งใหม่</a></div>`:''}
    <div class="msg err" id="lgErr" style="display:none"></div>
    ${s2
      ? `<div style="display:flex;gap:8px;margin-top:10px"><button class="btn ghost" onclick="loginBack()">← แก้อีเมล</button><button class="btn primary" style="flex:1" id="lgVerBtn" onclick="loginVerify()">ยืนยันเข้าสู่ระบบ</button></div>`
      : `<button class="btn primary" style="width:100%" id="lgReqBtn" onclick="loginRequest()">ขอรหัส OTP</button>`}
    <p class="help" style="margin-top:14px;text-align:center">ผู้แจ้งไม่ต้องเข้าสู่ระบบ · <a href="#" data-scr="home">กลับหน้าหลัก</a></p>
  </div></div>`;
}
function loginAfter(){ if(LOGIN.step === 2){ wireOtp(); startLoginResend(); } }
function loginErr(msg){ const e=$('lgErr'); if(e){ e.style.display=''; e.textContent=msg; } }
async function loginRequest(){
  const em = $('lgEmail') ? $('lgEmail').value.trim() : '';
  if(!em || em.indexOf('@') < 1){ loginErr('กรุณากรอกอีเมลให้ถูกต้อง'); return; }
  const b=$('lgReqBtn'); b.disabled=true; b.innerHTML='<span class="spin"></span>กำลังส่ง...';
  try{ await api('requestOtp', { email: em }); LOGIN.email = em; LOGIN.step = 2; render(); }
  catch(err){ b.disabled=false; b.textContent='ขอรหัส OTP'; loginErr(err.msg || 'ขอรหัสไม่สำเร็จ (อีเมลนี้อาจไม่ใช่เจ้าหน้าที่)'); }
}
async function loginVerify(){
  const otp = gatherOtp();
  if(otp.length < 6){ loginErr('กรุณากรอกรหัส OTP ให้ครบ 6 หลัก'); return; }
  const b=$('lgVerBtn'); b.disabled=true; b.innerHTML='<span class="spin"></span>กำลังตรวจสอบ...';
  try{
    const d = await api('verifyOtp', { email: LOGIN.email, otp });
    AUTH.token = d.token; AUTH.user = d.user;
    try{ sessionStorage.setItem('sm_token', d.token); }catch(e){}
    stopLoginResend(); LOGIN = { step:1, email:'', resendLeft:0, timer:null };
    toast('เข้าสู่ระบบสำเร็จ'); go(staffHome());
  }catch(err){ b.disabled=false; b.textContent='ยืนยันเข้าสู่ระบบ'; loginErr(err.msg || 'รหัส OTP ไม่ถูกต้อง'); }
}
function loginBack(){ stopLoginResend(); LOGIN.step = 1; render(); }
function startLoginResend(){ stopLoginResend(); LOGIN.resendLeft=60; updLoginResend(); LOGIN.timer=setInterval(()=>{ LOGIN.resendLeft--; if(LOGIN.resendLeft<=0) stopLoginResend(); updLoginResend(); },1000); }
function stopLoginResend(){ if(LOGIN.timer){ clearInterval(LOGIN.timer); LOGIN.timer=null; } }
function updLoginResend(){ const a=$('resendLink'); if(!a) return; if(LOGIN.resendLeft>0){ a.textContent=`ส่งใหม่ (0:${String(LOGIN.resendLeft).padStart(2,'0')})`; a.style.opacity='.5'; a.style.pointerEvents='none'; } else { a.textContent='ส่งรหัสใหม่'; a.style.opacity='1'; a.style.pointerEvents='auto'; } }
async function loginResend(){ if(LOGIN.resendLeft>0) return false; try{ await api('requestOtp',{email:LOGIN.email}); toast('ส่งรหัสใหม่แล้ว'); startLoginResend(); }catch(err){ toast(err.msg||'ส่งใหม่ไม่สำเร็จ'); } return false; }

/* ---------- ADMIN (คิว + แดชบอร์ด + ภาระงาน) ---------- */
function statSkel(n){ let s=''; for(let i=0;i<n;i++) s+='<div class="panel"><div class="skel" style="height:56px"></div></div>'; return s; }
function adminV(){
  return `<div class="sec-head"><h2>คิวรับเรื่อง &amp; <b>แดชบอร์ด</b></h2><span class="rt" id="admUpd">กำลังโหลด…</span></div>
    <div class="grid g4" id="admStats" style="margin-bottom:16px">${statSkel(4)}</div>
    <div class="hero" style="grid-template-columns:1.4fr 1fr;align-items:start;margin-bottom:0">
      <div id="admQueue">${loadingCard('กำลังโหลดคิว')}</div>
      <div id="admSide"></div>
    </div>`;
}
async function adminAfter(){
  try{
    const [q, dash, wl] = await Promise.all([ apiA('queue',{page:1,page_size:50}), apiA('dashboard'), apiA('workload') ]);
    ADMIN.queue = q.rows||[]; ADMIN.dash = dash; ADMIN.workload = wl||[];
    if(!$('admStats')) return;
    renderAdminStats(dash); renderAdminQueue(ADMIN.queue); renderAdminSide(dash, ADMIN.workload);
    if($('admUpd')) $('admUpd').textContent = 'อัปเดต ' + fmtDate(new Date().toISOString(), true);
    drawTypeChart(dash);
  }catch(err){ if($('admQueue')) $('admQueue').innerHTML = errorCard(err.msg, "go('admin')"); }
}
function renderAdminStats(d){
  const bs=(d&&d.by_status)||{};
  const nNew=(bs.NEW||0), nRet=(bs.RETURNED_INTAKE||0), nProg=(bs.PROGRESS||0)+(bs.ASSIGNED||0)+(bs.REVISION||0), nCl=(bs.CLOSED||0);
  const ov=(d&&d.sla&&d.sla.overdue)||0;
  if(!$('admStats')) return;
  $('admStats').innerHTML=`
   <div class="panel stat lift"><div class="num">${nNew}</div><div class="lbl">🆕 รอคัดกรอง</div><span class="chip c-amber" style="margin-top:8px">ต้องจัดการ</span></div>
   <div class="panel stat lift"><div class="num">${nProg}</div><div class="lbl">⚙️ กำลังดำเนินการ</div><span class="chip c-blue" style="margin-top:8px">ในมือทีม</span></div>
   <div class="panel stat lift"><div class="num">${nRet}</div><div class="lbl">↩️ ส่งกลับให้แก้</div><span class="chip c-red" style="margin-top:8px">รอผู้แจ้ง</span></div>
   <div class="panel stat lift"><div class="num">${nCl}</div><div class="lbl">✅ ปิดงานแล้ว</div><span class="chip ${ov?'c-red':'c-green'}" style="margin-top:8px">${ov?('⏰ เกินกำหนด '+ov):'สะสม'}</span></div>`;
}
function priBorder(p){ return p==='red'?'var(--heat-bad)':p==='yellow'?'var(--heat-warn)':p==='green'?'var(--heat-ok)':'var(--line)'; }
function renderAdminQueue(rows){
  const el=$('admQueue'); if(!el) return;
  const head=`<div class="sec-head" style="margin-bottom:10px"><h2 style="font-size:16px">🆕 คิวรับเรื่อง</h2><span class="rt">เรียงตามความด่วน → อายุงาน</span></div>`;
  if(!rows.length){ el.innerHTML=`<div class="panel">${head}<div class="statecard" style="padding:30px"><div class="ico">📭</div><h3>คิวว่าง</h3><p>ยังไม่มีคำขอใหม่รอคัดกรอง</p></div></div>`; return; }
  el.innerHTML=`<div class="panel">${head}
    ${rows.map(t=>`<div class="panel task lift" style="margin-bottom:9px;border-left:5px solid ${priBorder(t.priority)}"><div>
      <div class="nm">${pdot(t.priority)} ${esc(t.ticket_no)} — ${esc(t.subject||'')}</div>
      <div class="mt">${esc(t.requester_name||'')} · ${esc(t.type||'')}${t.subtype?' › '+esc(t.subtype):''}</div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn primary sm" onclick="openTicket('${esc(t.ticket_no)}')">คัดกรอง / มอบหมาย</button><button class="btn warn sm" onclick="openReturn('${esc(t.ticket_no)}','intake')">↩️ ตีกลับ</button></div>
    </div><div class="side">${badge(t.status)}<span class="chip ${t.status==='RETURNED_INTAKE'?'c-red':'c-amber'}">⏱ ${t.deadline?fmtDate(t.deadline):'-'}</span></div></div>`).join('')}
    <div style="margin-top:8px"><button class="btn ghost sm" onclick="doExportCsv()">⬇️ ส่งออก CSV</button></div>
  </div>`;
}
function renderAdminSide(d, wl){
  const el=$('admSide'); if(!el) return;
  const maxOpen=Math.max(1, ...(wl.length?wl.map(w=>w.open||0):[1]));
  const sat=(d&&d.satisfaction)||{};
  el.innerHTML=`<div class="panel"><h3 style="font-size:15px">👥 ภาระงานเจ้าหน้าที่</h3>
    ${wl.length?wl.map(w=>`<div class="wl"><span class="nm">${esc(w.name||w.email||'')}</span><span class="pbar" style="flex:1"><i style="width:${Math.round((w.open||0)*100/maxOpen)}%"></i></span><span class="cnt">${w.open||0}</span></div>`).join(''):'<p class="help">ยังไม่มีข้อมูลภาระงาน</p>'}
  </div>
  <div class="panel" style="margin-top:14px"><h3 style="font-size:15px">📈 งานตามประเภท</h3><canvas id="admChart" height="150"></canvas>
    <div class="grid g2" style="gap:8px;margin-top:10px"><div class="panel stat" style="padding:12px"><div class="num" style="font-size:19px">${sat.avg!=null&&sat.count?Number(sat.avg).toFixed(1)+'/5':'—'}</div><div class="lbl">ความพึงพอใจ (ISO 10002)</div></div><div class="panel stat" style="padding:12px"><div class="num" style="font-size:19px">${(d&&d.open_total)||0}</div><div class="lbl">งานที่เปิดอยู่</div></div></div>
  </div>`;
}
function drawTypeChart(d){
  const el=$('admChart'); if(!el || !window.Chart) return;
  const bt=(d&&d.by_type)||{}; const labels=Object.keys(bt); const data=labels.map(k=>bt[k]);
  const cs=getComputedStyle(document.documentElement);
  try{ new Chart(el,{type:'bar',data:{labels:labels.length?labels:['—'],datasets:[{data:data.length?data:[0],backgroundColor:(cs.getPropertyValue('--green2').trim()||'#2e9e6b'),borderRadius:6}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}}}}}); }catch(e){}
}
async function doExportCsv(){
  try{
    const d=await apiA('exportCsv');
    const bin=atob(d.base64||''); const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const blob=new Blob([bytes],{type:d.mime||'text/csv'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=d.filename||'tickets.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(err){ toast(err.msg||'ส่งออก CSV ไม่สำเร็จ'); }
}

/* ---------- ASSIGNEE (งานของฉัน) ---------- */
function assigneeV(){
  return `<div class="sec-head"><h2>งาน<b>ของฉัน</b></h2><span class="rt" id="mytRt">กำลังโหลด…</span></div><div id="mytList">${loadingCard('กำลังโหลดงานของฉัน')}</div>`;
}
async function assigneeAfter(){
  try{
    const r = await apiA('myTickets', { page:1, page_size:100 });
    MYT.rows = r.rows||[];
    if(!$('mytList')) return;
    renderMyTickets(MYT.rows);
    if($('mytRt')) $('mytRt').textContent = `${esc(AUTH.user?AUTH.user.name:'')} · ${MYT.rows.length} งานที่กำลังดูแล`;
  }catch(err){ if($('mytList')) $('mytList').innerHTML = errorCard(err.msg, "go('assignee')"); }
}
function renderMyTickets(rows){
  const el=$('mytList'); if(!el) return;
  if(!rows.length){ el.innerHTML=`<div class="panel statecard"><div class="ico">🎉</div><h3>ไม่มีงานค้าง</h3><p>เยี่ยมมาก! งานของคุณเคลียร์หมดแล้ว</p></div>`; return; }
  el.innerHTML=rows.map(t=>{
    const overdue = t.sla && t.sla.state==='overdue';
    return `<div class="panel allrow lift" onclick="openTicket('${esc(t.ticket_no)}')">
      <span>${pdot(t.priority)}</span>
      <div><div class="nm" style="font-weight:600;font-size:13.5px">${esc(t.ticket_no)} — ${esc(t.subject||'')}</div><div class="mt" style="color:var(--ink3);font-size:12px">${esc(t.type||'')}${t.subtype?' › '+esc(t.subtype):''} · ${esc(t.requester_name||'')}</div></div>
      <div style="text-align:right">${badge(t.status)}<div class="mt" style="color:var(--ink3);font-size:12px;margin-top:4px">⏱ ${t.deadline?fmtDate(t.deadline):'-'}${overdue?' · <span style="color:var(--red);font-weight:700">เลยกำหนด</span>':''}</div></div>
    </div>`;
  }).join('');
}

/* ---------- รายละเอียด ticket + การกระทำ ---------- */
async function openTicket(no){
  openM(`<div class="mh"><h3>${esc(no)}</h3><button class="mx" onclick="closeM()">✕</button></div><div class="mb">${loadingCard('กำลังโหลดรายละเอียด')}</div>`);
  try{
    const d = await apiA('ticketDetail', { ticket_no: no });
    if(isIntake() && !STAFF_LIST.length){ try{ STAFF_LIST = await apiA('listStaff') || []; }catch(e){} }
    renderTicketModal(d);
  }catch(err){ openM(`<div class="mh"><h3>${esc(no)}</h3><button class="mx" onclick="closeM()">✕</button></div><div class="mb"><div class="msg err">${esc(err.msg||'โหลดรายละเอียดไม่สำเร็จ')}</div></div>`); }
}
function refreshStaff(){ if(S.screen==='admin') adminAfter(); else if(S.screen==='assignee') assigneeAfter(); }
function renderTicketModal(d){
  const t=d.ticket||{}; const st=t.status; const open=!['CLOSED','CANCELLED'].includes(st);
  const assignees=(STAFF_LIST||[]).filter(s=>s.active!==false);
  let assignBlock='';
  if(isIntake() && open){
    assignBlock=`<div style="border-top:1px solid var(--line);padding-top:12px;margin-top:12px">
      <label class="fl">ระดับความด่วน (Impact × Urgency — ITIL)</label>
      <div class="segbtns" id="mPri">${['red','yellow','green'].map(p=>`<span class="sb ${t.priority===p?'on':''}" data-p="${p}" onclick="this.parentNode.querySelectorAll('.sb').forEach(x=>x.classList.remove('on'));this.classList.add('on')">${esc(priLabel(p)||p)}</span>`).join('')}</div>
      <div class="field" style="margin-top:12px"><label class="fl" for="mAssignee">มอบหมายให้</label><select id="mAssignee"><option value="">— เลือกเจ้าหน้าที่ —</option>${assignees.map(s=>`<option value="${esc(s.email)}" ${t.assignee_email===s.email?'selected':''}>${esc(s.name||s.email)}${s.role?' ('+esc(roleLabel(s.role))+')':''}</option>`).join('')}</select></div>
      <div class="msg err" id="aErr" style="display:none"></div>
      <button class="btn primary sm" id="aBtn" onclick="doAssign('${esc(t.ticket_no)}')">✔️ มอบหมาย / ปรับความด่วน</button>
    </div>`;
  }
  let btns=[];
  if(st==='ASSIGNED') btns.push(`<button class="btn ghost sm" onclick="doStart('${esc(t.ticket_no)}')">▶️ เริ่มงาน</button>`);
  if(st==='PROGRESS') btns.push(`<button class="btn ghost sm" onclick="openReturn('${esc(t.ticket_no)}','revision')">↩️ ส่งกลับให้ตรวจ</button>`);
  if(st==='PROGRESS'||st==='REVISION') btns.push(`<button class="btn primary sm" onclick="openClose('${esc(t.ticket_no)}')">✅ ปิดงาน</button>`);
  if(isIntake() && (st==='NEW'||st==='RETURNED_INTAKE')) btns.push(`<button class="btn warn sm" onclick="openReturn('${esc(t.ticket_no)}','intake')">↩️ ตีกลับให้แก้</button>`);
  if(isIntake() && open) btns.push(`<button class="btn warn sm" onclick="openReturn('${esc(t.ticket_no)}','cancel')">✖️ ยกเลิก</button>`);
  const body=`<div class="mh">${pdot(t.priority)}<h3>${esc(t.ticket_no)}</h3>${badge(st)}<button class="mx" onclick="closeM()">✕</button></div>
   <div class="mb"><p style="font-weight:600;font-size:15px">${esc(t.subject||'')}</p>
   <div class="kv2"><b>ผู้แจ้ง</b><span>${esc(t.requester_name||'')}${t.requester_email?' · '+esc(t.requester_email):''}</span><b>ประเภท</b><span>${esc(t.type||'')}${t.subtype?' › '+esc(t.subtype):''}</span><b>ยื่นเมื่อ</b><span>${fmtDate(t.created_at,true)}</span><b>กำหนดส่ง</b><span>${t.deadline?fmtDate(t.deadline):'—'}</span><b>ผู้รับผิดชอบ</b><span>${esc(t.assignee_name||'— ยังไม่มอบหมาย —')}</span>${t.sla&&t.sla.label?`<b>SLA</b><span>${esc(t.sla.label)}</span>`:''}</div>
   ${t.note?`<div class="msg info" style="white-space:pre-wrap">📝 ${esc(t.note)}</div>`:''}
   ${t.last_return_reason&&(st==='RETURNED_INTAKE'||st==='REVISION')?`<div class="msg warn">📌 ${esc(t.last_return_reason)}</div>`:''}
   ${assignBlock}
   ${btns.length?`<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px">${btns.join('')}</div>`:''}
   <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:10px"><label class="fl" for="cmtText">เพิ่มความเห็น (บันทึกภายในทีม)</label><textarea id="cmtText" placeholder="บันทึกภายใน ไม่แสดงแก่ผู้แจ้ง"></textarea><button class="btn ghost sm" id="cmtBtn" style="margin-top:6px" onclick="doComment('${esc(t.ticket_no)}')">💬 บันทึกความเห็น</button></div>
   <h4 style="margin:14px 0 8px;font-size:15px">ประวัติการดำเนินการ</h4>${timelineHtml(d.timeline||[])}
   ${attachHtml(d.attachments||[])}
   </div>`;
  openM(body);
}
async function doAssign(no){
  const sel=$('mAssignee'); const email=sel?sel.value:'';
  const e=$('aErr'); if(e) e.style.display='none';
  if(!email){ if(e){ e.style.display=''; e.textContent='กรุณาเลือกเจ้าหน้าที่'; } return; }
  const pr=document.querySelector('#mPri .sb.on'); const priority=pr?pr.dataset.p:undefined;
  const b=$('aBtn'); b.disabled=true; b.innerHTML='<span class="spin"></span>กำลังบันทึก...';
  try{ await apiA('assign',{ ticket_no:no, assignee_email:email, priority }); closeM(); toast('มอบหมายงานแล้ว'); refreshStaff(); }
  catch(err){ b.disabled=false; b.textContent='✔️ มอบหมาย / ปรับความด่วน'; if(e){ e.style.display=''; e.textContent=err.msg||'มอบหมายไม่สำเร็จ'; } }
}
async function doStart(no){ try{ await apiA('start',{ticket_no:no}); toast('เริ่มดำเนินการแล้ว'); openTicket(no); refreshStaff(); }catch(err){ toast(err.msg||'ไม่สำเร็จ'); } }
async function doComment(no){
  const t=$('cmtText')?$('cmtText').value.trim():''; if(!t){ toast('กรุณาพิมพ์ความเห็นก่อน'); return; }
  const b=$('cmtBtn'); b.disabled=true; b.innerHTML='<span class="spin"></span>...';
  try{ await apiA('addComment',{ticket_no:no,text:t}); toast('บันทึกความเห็นแล้ว'); openTicket(no); }
  catch(err){ b.disabled=false; b.textContent='💬 บันทึกความเห็น'; toast(err.msg||'ไม่สำเร็จ'); }
}
function openReturn(no, stage){
  const titles={ intake:'↩️ ตีกลับให้แก้ไข (ชั้นคัดกรอง)', revision:'↩️ ส่งกลับให้ตรวจ/แก้ร่าง', cancel:'✖️ ยกเลิกคำขอ' };
  const desc={ intake:'ส่งกลับให้ <b>ผู้แจ้ง</b> แก้/เพิ่มข้อมูลก่อนรับเข้าดำเนินการ', revision:'ส่งร่างกลับให้ <b>ผู้แจ้ง</b> ตรวจ/แก้ไข (วนได้หลายรอบ)', cancel:'ยกเลิกคำขอนี้ (ระบบบันทึกเหตุผลไว้)' };
  const isC=stage==='cancel';
  openM(`<div class="mh"><h3>${titles[stage]}</h3><button class="mx" onclick="closeM()">✕</button></div>
   <div class="mb"><div class="msg ${stage==='revision'?'info':'warn'}">${esc(no)} — ${desc[stage]}</div>
   <div class="field"><label class="fl" for="rReason">${isC?'เหตุผลการยกเลิก':'เหตุผล / สิ่งที่ต้องแก้'} <span class="req">*</span></label><textarea id="rReason" placeholder="ระบุรายละเอียด เช่น กรุณาแนบไฟล์รายชื่อให้ครบ / ตรวจยอดเงินอีกครั้ง"></textarea></div>
   <div class="msg err" id="rErr" style="display:none"></div>
   <div class="help">ระบบส่งอีเมลแจ้งผู้แจ้ง + ลิงก์แก้ไข และบันทึกประวัติ (ไม่ต้องเปิดเรื่องใหม่)</div>
   <div style="margin-top:12px"><button class="btn ${isC?'warn':'primary'}" id="rBtn" onclick="doReturn('${esc(no)}','${stage}')">ยืนยัน</button></div></div>`);
}
async function doReturn(no, stage){
  const reason=$('rReason')?$('rReason').value.trim():'';
  const e=$('rErr'); if(e) e.style.display='none';
  if(!reason){ if(e){ e.style.display=''; e.textContent='กรุณาระบุเหตุผล'; } return; }
  const map={ intake:['returnIntake',{ticket_no:no,reason}], revision:['returnRevision',{ticket_no:no,reason}], cancel:['cancel',{ticket_no:no,reason}] };
  const b=$('rBtn'); b.disabled=true; b.innerHTML='<span class="spin"></span>กำลังส่ง...';
  try{ await apiA(map[stage][0], map[stage][1]); closeM(); toast('ดำเนินการเรียบร้อยแล้ว'); refreshStaff(); }
  catch(err){ b.disabled=false; b.textContent='ยืนยัน'; if(e){ e.style.display=''; e.textContent=err.msg||'ไม่สำเร็จ'; } }
}
function openClose(no){
  openM(`<div class="mh"><h3>✅ ปิดงาน</h3><button class="mx" onclick="closeM()">✕</button></div>
   <div class="mb"><div class="msg ok">${esc(no)} — สรุปผลการดำเนินงานก่อนปิด (ระบบส่งอีเมลเชิญประเมินให้ผู้แจ้ง)</div>
   <div class="field"><label class="fl" for="cNote">สรุปการปิดงาน <span class="req">*</span></label><textarea id="cNote" placeholder="เช่น จัดทำหนังสือเสร็จ ส่งไฟล์ให้ผู้แจ้งแล้ว"></textarea></div>
   <div class="msg err" id="cErr" style="display:none"></div>
   <button class="btn primary" id="cBtn" onclick="doClose('${esc(no)}')">ยืนยันปิดงาน</button></div>`);
}
async function doClose(no){
  const note=$('cNote')?$('cNote').value.trim():'';
  const e=$('cErr'); if(e) e.style.display='none';
  if(!note){ if(e){ e.style.display=''; e.textContent='กรุณากรอกสรุปการปิดงาน'; } return; }
  const b=$('cBtn'); b.disabled=true; b.innerHTML='<span class="spin"></span>กำลังปิดงาน...';
  try{ await apiA('close',{ticket_no:no,closing_note:note}); closeM(); toast('ปิดงานเรียบร้อยแล้ว'); refreshStaff(); }
  catch(err){ b.disabled=false; b.textContent='ยืนยันปิดงาน'; if(e){ e.style.display=''; e.textContent=err.msg||'ปิดงานไม่สำเร็จ'; } }
}

/* ============================================================
   6) หน้า FORM — wizard 3 สเต็ป (F1 + SM-D20/D21/D23)
      สเต็ป 1 กรอก → สเต็ป 2 OTP → สเต็ป 3 สำเร็จ
   ============================================================ */
let FORM = newForm();
function newForm(){
  return { step:1, files:[], fields:{}, otpEmail:'', submitting:false, result:null, resendLeft:0, timer:null };
}
function todayStr(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function formV(){
  const st = FORM.step;
  return `<div class="sec-head"><h2>ยื่นคำขอ<b>รับบริการ</b></h2><span class="rt">งานบริหารทั่วไป · รับทุกประเภทบริการ ไม่จำกัดเฉพาะหนังสือราชการ</span></div>
  <div class="grid g2"><div class="panel">
    <div class="steps">
      <div class="s ${st>1?'done':'on'}">1 · กรอกคำขอ</div>
      <div class="s ${st===2?'on':(st>2?'done':'')}">2 · ยืนยัน OTP</div>
      <div class="s ${st>=3?'on':''}">3 · สำเร็จ</div>
    </div>
    <div id="stepBox">${st===1?formStep1():st===2?formStep2():formStep3()}</div>
  </div>
  <div>
    <div class="panel"><h3 style="font-size:15px">📄 ระบบนี้ช่วยอะไร</h3><p style="font-size:13px;color:var(--ink2);margin:8px 0 0">ยื่นคำขอให้งานบริหารทั่วไปช่วยดำเนินการ เช่น จัดทำหนังสือราชการ (บันทึกข้อความ คำสั่ง หนังสือเชิญ) และงานบริการอื่น ๆ พร้อมแนบไฟล์และติดตามสถานะได้</p></div>
    <div class="panel" style="margin-top:14px"><h3 style="font-size:15px">🔒 ยืนยันตัวตนด้วย OTP</h3><p style="font-size:13px;color:var(--ink2);margin:8px 0 0">เมื่อกดส่ง ระบบส่งรหัส OTP ไปยังอีเมลของผู้แจ้งที่เลือก เพื่อยืนยันว่าเป็นผู้ยื่นตัวจริง (กันการแอบอ้าง)</p></div>
  </div></div>`;
}

function formStep1(){
  const f = FORM.fields;
  const typeKeys = Object.keys(TYPES);
  const typeOpts = typeKeys.length
    ? typeKeys.map(t=>`<option value="${esc(t)}" ${f.type===t?'selected':''}>${esc(t)}</option>`).join('')
    : '<option value="">— ยังไม่ได้โหลดประเภท —</option>';
  return `
  <div class="field"><label class="fl" for="fReq">ผู้แจ้ง <span class="req">*</span></label>
    <select id="fReq" onchange="fillReq()"><option value="">— เลือกชื่อของท่าน —</option>${
      REQUESTERS.map((r,i)=>`<option value="${i}" ${String(f.reqIdx)===String(i)?'selected':''}>${esc(r.name)}${r.department?' · '+esc(r.department):''}</option>`).join('')
    }</select>
    <div class="autobox" id="autobox" style="display:none"></div>
    <div class="help">เลือกชื่อ แล้วระบบดึงอีเมล/หน่วยงานให้อัตโนมัติ · หากไม่พบชื่อ โปรดแจ้งผู้ดูแลเพิ่มในระบบ</div>
    <div class="err-tx" id="eReq" style="display:none"></div></div>
  <div class="field"><label class="fl" for="fSubject">เรื่อง <span class="req">*</span></label><input type="text" id="fSubject" maxlength="200" value="${esc(f.subject||'')}" placeholder="เช่น จัดทำบันทึกข้อความขอ..."><div class="err-tx" id="eSubject" style="display:none"></div></div>
  <div class="grid g2" style="gap:12px">
    <div class="field" style="margin:0"><label class="fl" for="fType">ประเภทงาน <span class="req">*</span></label><select id="fType" onchange="fillSub()">${typeOpts}</select></div>
    <div class="field" style="margin:0"><label class="fl" for="fSub">ประเภทย่อย</label><select id="fSub" onchange="toggleOther()"></select></div>
  </div>
  <div class="field" id="typeOtherWrap" style="display:none"><label class="fl" for="fTypeOther">ระบุประเภทงาน <span class="req">*</span></label><input type="text" id="fTypeOther" maxlength="120" value="${esc(f.type_other||'')}" placeholder="โปรดระบุประเภทงานที่ต้องการ"></div>
  <div class="field" id="subOtherWrap" style="display:none"><label class="fl" for="fSubOther">ระบุรายละเอียดเพิ่มเติม <span class="req">*</span></label><input type="text" id="fSubOther" maxlength="120" value="${esc(f.subtype_other||'')}" placeholder="โปรดระบุประเภทย่อย/รายละเอียดของบริการ"></div>
  <div class="field"><label class="fl" for="fDeadline">กำหนดส่ง (Deadline) <span class="req">*</span></label><input type="date" id="fDeadline" min="${todayStr()}" value="${esc(f.deadline||'')}">
    <div class="segbtns"><span class="sb" tabindex="0" role="button" onclick="setQuickDeadline(0)">⚡ วันนี้</span><span class="sb" tabindex="0" role="button" onclick="setQuickDeadline(1)">พรุ่งนี้</span><span class="sb" tabindex="0" role="button" onclick="setQuickDeadline(3)">ภายใน 3 วัน</span><span class="sb" tabindex="0" role="button" onclick="setQuickDeadline(7)">ภายใน 7 วัน</span></div>
    <div class="help">กันการตั้งวันย้อนหลัง — เลือกวันนี้หรืออนาคตเท่านั้น</div>
    <div class="err-tx" id="eDeadline" style="display:none"></div></div>
  <div class="field"><label class="fl" for="fNote">รายละเอียด / เนื้อหา</label><textarea id="fNote" maxlength="4000" placeholder="ระบุรายละเอียด หรือแนบไฟล์ประกอบด้านล่าง">${esc(f.note||'')}</textarea></div>
  <div class="field"><label class="fl">เอกสารแนบ</label>
    <div class="upzone" id="upzone" tabindex="0" role="button" aria-label="เลือกไฟล์แนบ">📎 ลากไฟล์มาวาง หรือคลิกเพื่อเลือก<div class="help" id="upHint" style="margin-top:4px">${esc(uploadHint())}</div></div>
    <input type="file" id="fFile" multiple style="display:none" onchange="onPickFiles(this)">
    <div id="fileList"></div>
    <div class="err-tx" id="eFile" style="display:none"></div></div>
  <div class="msg err" id="formErr" style="display:none"></div>
  <div style="margin-top:8px"><button class="btn primary big" id="btnStep1" onclick="formSubmitStep1()">ส่งคำขอ →</button></div>`;
}

function uploadHint(){
  const mb = (CFG && CFG.max_upload_mb) ? CFG.max_upload_mb : 10;
  return 'PDF, Word, Excel, รูปภาพ · ไม่เกิน ' + mb + ' MB/ไฟล์';
}

function formStep2(){
  const em = FORM.otpEmail || (FORM.fields && FORM.fields.requester_email) || '';
  return `
  <div class="statecard" style="padding:20px 10px"><div class="ico">📧</div><h3>ยืนยันการส่งด้วย OTP</h3>
  <p>ระบบส่งรหัส 6 หลักไปที่ <b style="color:var(--green)">${esc(maskEmailC(em))}</b><br>กรอกรหัสเพื่อยืนยันว่าเป็นผู้ยื่นตัวจริง</p>
  <div class="otp-row" id="otpRow">${[0,1,2,3,4,5].map(i=>`<input maxlength="1" inputmode="numeric" autocomplete="one-time-code" aria-label="รหัสหลักที่ ${i+1}" data-i="${i}">`).join('')}</div>
  <div class="help">ไม่ได้รับรหัส? <a href="#" id="resendLink" onclick="return formResendOtp()">ส่งใหม่อีกครั้ง</a></div>
  <div class="msg err" id="otpErr" style="display:none;text-align:left"></div>
  <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
    <button class="btn ghost" onclick="formBackTo1()">← กลับไปแก้</button>
    <button class="btn primary" id="btnConfirm" onclick="formConfirmOtp()">ยืนยันส่งคำขอ</button>
  </div></div>`;
}

function formStep3(){
  const r = FORM.result || {};
  const failed = (r.attachments_failed && r.attachments_failed.length)
    ? `<div class="msg warn" style="text-align:left">⚠️ มีไฟล์แนบบางไฟล์อัปโหลดไม่สำเร็จ: ${r.attachments_failed.map(x=>esc(x.name||'')+' ('+esc(x.error||'')+')').join(', ')} — ท่านสามารถแนบใหม่ในหน้าติดตาม</div>` : '';
  return `
  <div class="statecard"><div class="ok-ring">✓</div><h3 style="color:var(--green)">ส่งคำขอเรียบร้อยแล้ว</h3><p>เลขที่คำขอของท่านคือ</p><div class="bignum">${esc(r.ticket_no||'—')}</div>
  <p>ระบบส่งอีเมลยืนยันพร้อมลิงก์ติดตามให้แล้ว เจ้าหน้าที่จะพิจารณาโดยเร็ว</p>${failed}
  <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn primary" onclick="goTrackFromResult()">🔎 ติดตามสถานะ</button><button class="btn ghost" onclick="formReset()">ส่งคำขอใหม่</button></div></div>`;
}

/* ปิดบังอีเมลบางส่วนฝั่ง client (กันแสดงเต็มบนจอ) */
function maskEmailC(e){
  e = String(e||''); const at = e.indexOf('@'); if(at<1) return e;
  const u = e.slice(0,at), d = e.slice(at);
  return (u.length<=2 ? u[0]+'*' : u.slice(0,2)+'*'.repeat(Math.min(4,u.length-2))) + d;
}

/* ---- หลัง render form: เติม dropdown/ค่า/ลากวาง/OTP ---- */
function formAfter(){
  if(FORM.step === 1){
    const t = FORM.fields.type || Object.keys(TYPES)[0] || '';
    if($('fType') && t) $('fType').value = t;
    fillSub(true);                 // เติมประเภทย่อยตามประเภท + คงค่าเดิม
    if(FORM.fields.reqIdx != null && $('fReq')){ $('fReq').value = FORM.fields.reqIdx; fillReq(); }
    renderFileList();
    wireDropzone();
  }else if(FORM.step === 2){
    wireOtp();
    startResendTimer();
  }
}

function fillReq(){
  const sel = $('fReq'); if(!sel) return;
  const i = sel.value; const box = $('autobox');
  if(i === '' || !REQUESTERS[i]){ box.style.display='none'; FORM.fields.reqIdx=null; FORM.fields.requester_email=''; FORM.fields.requester_name=''; FORM.fields.department=''; return; }
  const r = REQUESTERS[i];
  FORM.fields.reqIdx = i;
  FORM.fields.requester_email = r.email || '';
  FORM.fields.requester_name = r.name || '';
  FORM.fields.department = r.department || '';
  box.style.display='block';
  box.innerHTML = r.email
    ? `✉️ <b>${esc(r.email)}</b> · 🏢 ${esc(r.department||'-')}`
    : `⚠️ <b style="color:var(--red)">ไม่มีอีเมลในระบบ</b> — ส่ง OTP ไม่ได้ โปรดแจ้งผู้ดูแลเพิ่มอีเมล`;
}
function fillSub(keep){
  const t = $('fType') ? $('fType').value : '';
  const sub = $('fSub'); if(!sub) return;
  const list = TYPES[t] || [];
  sub.innerHTML = '<option value="">— ไม่ระบุ —</option>' + list.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  if(keep && FORM.fields.subtype){ sub.value = FORM.fields.subtype; }
  toggleOther();
}
function toggleOther(){
  const t = $('fType') ? $('fType').value : '';
  const s = $('fSub') ? $('fSub').value : '';
  const typeOther = t.indexOf('อื่น') > -1;
  const subOther = s.indexOf('อื่น') > -1;
  if($('typeOtherWrap')) $('typeOtherWrap').style.display = typeOther ? 'block' : 'none';
  if($('subOtherWrap'))  $('subOtherWrap').style.display  = subOther ? 'block' : 'none';
}
function setQuickDeadline(days){
  const d = new Date(); d.setDate(d.getDate() + days);
  const v = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  if($('fDeadline')) $('fDeadline').value = v;
}

/* ---- ไฟล์แนบ ---- */
function wireDropzone(){
  const z = $('upzone'), inp = $('fFile'); if(!z || !inp) return;
  z.onclick = ()=> inp.click();
  z.onkeydown = e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); inp.click(); } };
  z.ondragover = e=>{ e.preventDefault(); z.classList.add('drag'); };
  z.ondragleave = ()=> z.classList.remove('drag');
  z.ondrop = e=>{ e.preventDefault(); z.classList.remove('drag'); if(e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); };
}
function onPickFiles(inp){ if(inp.files) addFiles(inp.files); inp.value=''; }
function addFiles(fileList){
  const maxMb = (CFG && CFG.max_upload_mb) ? Number(CFG.max_upload_mb) : 10;
  const allowed = (CFG && CFG.allowed_mime && CFG.allowed_mime.length) ? CFG.allowed_mime : null;
  const errBox = $('eFile'); let errs = [];
  Array.prototype.forEach.call(fileList, file=>{
    if(file.size > maxMb*1048576){ errs.push(`${file.name}: ใหญ่เกิน ${maxMb} MB`); return; }
    if(allowed && file.type && allowed.indexOf(file.type) === -1){ errs.push(`${file.name}: ชนิดไฟล์ไม่รองรับ`); return; }
    const reader = new FileReader();
    reader.onload = ()=>{ FORM.files.push({ name:file.name, mime:file.type||'application/octet-stream', base64:reader.result, size:file.size }); renderFileList(); };
    reader.onerror = ()=>{ errs.push(`${file.name}: อ่านไฟล์ไม่สำเร็จ`); showFileErr(errs); };
    reader.readAsDataURL(file);
  });
  showFileErr(errs);
}
function showFileErr(errs){ const b=$('eFile'); if(!b) return; if(errs && errs.length){ b.style.display=''; b.textContent = errs.join(' · '); } else { b.style.display='none'; b.textContent=''; } }
function removeFile(i){ FORM.files.splice(i,1); renderFileList(); }
function renderFileList(){
  const el = $('fileList'); if(!el) return;
  el.innerHTML = FORM.files.map((f,i)=>`<div class="fileitem">📄 <span class="fn">${esc(f.name)}</span> <span style="color:var(--ink3)">${fmtBytes(f.size)}</span><button class="x" type="button" aria-label="ลบไฟล์" onclick="removeFile(${i})">✕</button></div>`).join('');
}

/* ---- ตรวจ + ขอ OTP (สเต็ป 1 → 2) ---- */
function readStep1(){
  const f = FORM.fields;
  f.subject = $('fSubject') ? $('fSubject').value.trim() : (f.subject||'');
  f.type = $('fType') ? $('fType').value : (f.type||'');
  f.subtype = $('fSub') ? $('fSub').value : '';
  f.type_other = $('fTypeOther') ? $('fTypeOther').value.trim() : '';
  f.subtype_other = $('fSubOther') ? $('fSubOther').value.trim() : '';
  f.deadline = $('fDeadline') ? $('fDeadline').value : (f.deadline||'');
  f.note = $('fNote') ? $('fNote').value.trim() : '';
}
function fieldErr(id, msg){ const e=$(id); if(e){ e.style.display=''; e.textContent=msg; } }
function clearFieldErr(id){ const e=$(id); if(e){ e.style.display='none'; e.textContent=''; } }
function validateStep1(){
  ['eReq','eSubject','eDeadline'].forEach(clearFieldErr);
  const f = FORM.fields; let ok = true, first = null;
  if(!f.requester_email){ fieldErr('eReq','กรุณาเลือกผู้แจ้งที่มีอีเมลในระบบ'); ok=false; first=first||'fReq'; }
  if(!f.subject){ fieldErr('eSubject','กรุณากรอกเรื่อง'); ok=false; first=first||'fSubject'; }
  if(!f.deadline){ fieldErr('eDeadline','กรุณาเลือกวันกำหนดส่ง'); ok=false; first=first||'fDeadline'; }
  else if(f.deadline < todayStr()){ fieldErr('eDeadline','กำหนดส่งต้องไม่เป็นวันที่ย้อนหลัง'); ok=false; first=first||'fDeadline'; }
  if(f.type && f.type.indexOf('อื่น')>-1 && !f.type_other){ fieldErr('formErr','กรุณาระบุประเภทงาน (อื่น ๆ)'); ok=false; first=first||'fTypeOther'; }
  if(f.subtype && f.subtype.indexOf('อื่น')>-1 && !f.subtype_other){ fieldErr('formErr','กรุณาระบุรายละเอียดประเภทย่อย (อื่น ๆ)'); ok=false; first=first||'fSubOther'; }
  if(first && $(first)) $(first).focus();
  return ok;
}
async function formSubmitStep1(){
  clearFieldErr('formErr');
  readStep1();
  if(!validateStep1()) return;
  const btn = $('btnStep1');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังส่งรหัส OTP...';
  try{
    await api('requestRequesterOtp', { email: FORM.fields.requester_email });
    FORM.otpEmail = FORM.fields.requester_email;
    FORM.step = 2;
    render();
  }catch(err){
    btn.disabled = false; btn.textContent = 'ส่งคำขอ →';
    fieldErr('formErr', err.msg || 'ขอรหัส OTP ไม่สำเร็จ');
  }
}
function formBackTo1(){ stopResendTimer(); FORM.step = 1; render(); }

/* ---- OTP UX ---- */
function wireOtp(){
  const inputs = Array.prototype.slice.call(document.querySelectorAll('#otpRow input'));
  inputs.forEach((el, idx)=>{
    el.addEventListener('input', ()=>{ el.value = el.value.replace(/\D/g,'').slice(0,1); if(el.value && inputs[idx+1]) inputs[idx+1].focus(); });
    el.addEventListener('keydown', e=>{ if(e.key==='Backspace' && !el.value && inputs[idx-1]) inputs[idx-1].focus(); });
    el.addEventListener('paste', e=>{
      e.preventDefault();
      const t = (e.clipboardData.getData('text')||'').replace(/\D/g,'').slice(0,6);
      inputs.forEach((x,j)=> x.value = t[j] || '');
      (inputs[Math.min(t.length,5)]||inputs[5]).focus();
    });
  });
  if(inputs[0]) inputs[0].focus();
}
function gatherOtp(){ return Array.prototype.map.call(document.querySelectorAll('#otpRow input'), el=>el.value).join(''); }
function startResendTimer(){
  stopResendTimer();
  FORM.resendLeft = 60;
  updateResendLink();
  FORM.timer = setInterval(()=>{ FORM.resendLeft--; if(FORM.resendLeft<=0) stopResendTimer(); updateResendLink(); }, 1000);
}
function stopResendTimer(){ if(FORM.timer){ clearInterval(FORM.timer); FORM.timer=null; } }
function updateResendLink(){
  const a = $('resendLink'); if(!a) return;
  if(FORM.resendLeft > 0){ a.textContent = `ส่งใหม่อีกครั้ง (0:${String(FORM.resendLeft).padStart(2,'0')})`; a.style.opacity='.5'; a.style.pointerEvents='none'; }
  else{ a.textContent = 'ส่งรหัสใหม่'; a.style.opacity='1'; a.style.pointerEvents='auto'; }
}
async function formResendOtp(){
  if(FORM.resendLeft > 0) return false;
  try{ await api('requestRequesterOtp', { email: FORM.otpEmail }); toast('ส่งรหัส OTP ใหม่แล้ว'); startResendTimer(); }
  catch(err){ toast(err.msg || 'ส่งรหัสใหม่ไม่สำเร็จ'); }
  return false;
}

/* ---- ยืนยัน OTP + ส่งคำขอจริง (สเต็ป 2 → 3) ---- */
async function formConfirmOtp(){
  const otp = gatherOtp();
  const errBox = $('otpErr');
  errBox.style.display='none';
  if(otp.length < 6){ errBox.style.display=''; errBox.textContent='กรุณากรอกรหัส OTP ให้ครบ 6 หลัก'; return; }
  const btn = $('btnConfirm');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังส่งคำขอ...';
  const f = FORM.fields;
  const payload = {
    requester_email: f.requester_email, requester_name: f.requester_name, department: f.department,
    subject: f.subject, type: f.type, subtype: f.subtype || '',
    note: f.note || '', deadline: f.deadline || '', otp: otp,
    type_other: f.type_other || '', subtype_other: f.subtype_other || '',
    attachments: FORM.files.map(x=>({ name:x.name, mime:x.mime, base64:x.base64 }))
  };
  try{
    const data = await api('submitTicket', payload);
    FORM.result = data;
    stopResendTimer();
    FORM.step = 3;
    render();
  }catch(err){
    btn.disabled = false; btn.textContent = 'ยืนยันส่งคำขอ';
    errBox.style.display=''; errBox.textContent = err.msg || 'ส่งคำขอไม่สำเร็จ';
  }
}
function goTrackFromResult(){
  const r = FORM.result || {};
  go('track', { ticket: r.ticket_no || '', em: FORM.fields.requester_email || '' });
}
function formReset(){ stopResendTimer(); FORM = newForm(); render(); }

/* ============================================================
   7) หน้า TRACK — ติดตาม/แก้ไข/ประเมิน (F4/F5/F6)
   ============================================================ */
let TRACK = { ticket:'', em:'', data:null, files:[], autoSurvey:false };
let surveyRating = 0;
const TL_DOT = { create:'g', return_intake:'rd', resubmit:'gn', assign:'bl', reassign:'bl', priority:'am', start:'am', return_revision:'pu', comment:'g', attach:'g', close:'gn', cancel:'rd', satisfaction:'gn' };

function trackV(){
  return `<div class="sec-head"><h2>ติดตาม<b>สถานะคำขอ</b></h2><span class="rt">กรอกเลขที่คำขอและอีเมลที่ใช้ยื่น</span></div>
  <div class="panel"><div class="grid g2" style="gap:12px">
    <div class="field" style="margin:0"><label class="fl" for="tkNo">เลขที่คำขอ</label><input type="text" id="tkNo" value="${esc(TRACK.ticket||'')}" placeholder="SV-YYYY-XXXX"></div>
    <div class="field" style="margin:0"><label class="fl" for="tkEmail">อีเมลผู้แจ้ง</label><input type="email" id="tkEmail" value="${esc(TRACK.em||'')}" placeholder="you@yru.ac.th"></div>
  </div>
  <div style="margin-top:12px"><button class="btn primary" onclick="doTrack()">🔎 ค้นหา</button> <button class="btn ghost" onclick="openM(recoverModal())">📧 ลืมเลขคำขอ</button></div></div>
  <div id="trackResult"></div>`;
}
function trackAfter(){
  const p = qsp();
  const urlTicket = p.get('ticket'), urlEm = p.get('em'), survey = p.get('survey');
  if(urlTicket && $('tkNo')) $('tkNo').value = urlTicket;
  if(urlEm && $('tkEmail')) $('tkEmail').value = urlEm;
  if(urlTicket && urlEm){ TRACK.autoSurvey = (survey === '1'); doTrack(); }
}
async function doTrack(){
  const no = $('tkNo') ? $('tkNo').value.trim() : '';
  const em = $('tkEmail') ? $('tkEmail').value.trim() : '';
  const box = $('trackResult'); if(!box) return;
  if(!no || !em){ box.innerHTML = `<div class="msg warn" style="margin-top:14px">กรุณากรอกเลขที่คำขอและอีเมลผู้แจ้ง</div>`; return; }
  TRACK.ticket = no; TRACK.em = em; TRACK.files = [];
  box.innerHTML = loadingCard('กำลังค้นหาคำขอ');
  try{
    const d = await api('track', { ticket_no: no, email: em });
    TRACK.data = d;
    renderTrackResult(d);
    if(TRACK.autoSurvey && d.can_rate){ TRACK.autoSurvey = false; openSurvey(); }
  }catch(err){
    box.innerHTML = `<div class="panel statecard" style="margin-top:14px"><div class="ico">🔍</div><h3>ไม่พบคำขอ</h3><p>${esc(err.msg || 'ไม่พบข้อมูล — ตรวจเลขที่คำขอและอีเมลอีกครั้ง')}</p></div>`;
  }
}
function renderTrackResult(d){
  const box = $('trackResult'); if(!box) return;
  const t = d.ticket || {}; const st = t.status;
  let action = '';
  if(st === 'RETURNED_INTAKE') action = resubIntakeBox(t);
  else if(st === 'REVISION') action = resubRevisionBox(t);
  else if(st === 'CLOSED') action = closedBox(t, d.can_rate);
  box.innerHTML = `<div class="panel" style="margin-top:14px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3>${esc(t.ticket_no||'')}</h3>${badge(st)}${t.priority_label?`<span class="chip c-green">${esc(t.priority_label)}</span>`:''}${t.deadline?`<span style="margin-left:auto" class="chip c-amber">⏱ ครบกำหนด ${fmtDate(t.deadline)}</span>`:''}</div>
    <p style="font-weight:600;margin:8px 0">${esc(t.subject||'')}</p>
    <div class="kv2"><b>ผู้แจ้ง</b><span>${esc(t.requester_name||'-')}${t.requester_email_masked?' · '+esc(t.requester_email_masked):''}</span><b>ประเภท</b><span>${esc(t.type||'-')}${t.subtype?' › '+esc(t.subtype):''}</span><b>ผู้รับผิดชอบ</b><span>${esc(t.assignee_name||'— ยังไม่มอบหมาย —')}</span><b>ยื่นเมื่อ</b><span>${fmtDate(t.created_at,true)}</span></div>
    ${action}
    <h4 style="margin:14px 0 8px;font-size:15px">ประวัติการดำเนินการ</h4>
    ${timelineHtml(d.timeline||[])}
    ${attachHtml(d.attachments||[])}
  </div>`;
}
function timelineHtml(tl){
  if(!tl.length) return `<p class="help">ยังไม่มีประวัติการดำเนินการ</p>`;
  return `<ul class="tl">${tl.map(x=>`<li><span class="d ${TL_DOT[x.action]||'g'}"></span><div class="tt">${esc(x.action_label||x.action||'')}</div><div class="tm">${fmtDate(x.timestamp,true)}${x.by_name?' · '+esc(x.by_name):''}${x.note?' · '+esc(x.note):''}</div></li>`).join('')}</ul>`;
}
function attachHtml(as){
  if(!as.length) return '';
  return `<h4 style="margin:14px 0 6px;font-size:15px">📎 เอกสารแนบ (${as.length})</h4>` +
    as.map(a=>`<a class="fileitem dl" href="${esc(a.drive_url||'#')}" target="_blank" rel="noopener">📄 <span class="fn">${esc(a.file_name||'ไฟล์')}</span> <span style="color:var(--ink3)">${a.size_bytes?fmtBytes(a.size_bytes):''}${a.stage?' · '+esc(a.stage):''}</span></a>`).join('');
}
function closedBox(t, canRate){
  return `${t.closing_note?`<div class="msg ok">✅ <b>สรุปการปิดงาน:</b> ${esc(t.closing_note)}</div>`:'<div class="msg ok">✅ คำขอนี้ปิดงานเรียบร้อยแล้ว</div>'}${canRate?`<div style="margin-top:10px"><button class="btn primary sm" onclick="openSurvey()">⭐ ประเมินความพึงพอใจ</button></div>`:''}`;
}

/* ---- กล่องแก้ไขเมื่อถูกตีกลับคัดกรอง (RETURNED_INTAKE → resubmitTicket) ---- */
function resubIntakeBox(t){
  return `<div class="msg warn">📌 <b>ถูกส่งกลับให้แก้ไข (ชั้นคัดกรอง):</b> ${esc(t.last_return_reason||'-')}</div>
  <div class="panel" style="background:var(--panel2)">
    <div class="field"><label class="fl" for="rsSubject">เรื่อง</label><input type="text" id="rsSubject" value="${esc(t.subject||'')}" maxlength="200"></div>
    <div class="field"><label class="fl" for="rsDeadline">กำหนดส่ง</label><input type="date" id="rsDeadline" min="${todayStr()}" value="${t.deadline?isoToDateInput(t.deadline):''}"></div>
    <div class="field"><label class="fl" for="rsNote">รายละเอียดที่แก้ไข/เพิ่มเติม</label><textarea id="rsNote" maxlength="4000" placeholder="ระบุสิ่งที่แก้ไขตามที่เจ้าหน้าที่แจ้ง"></textarea></div>
    <div class="field"><label class="fl">แนบไฟล์เพิ่ม/แก้ไข</label><div class="upzone" tabindex="0" role="button" onclick="document.getElementById('rsFile').click()">📎 คลิกเพื่อเลือกไฟล์<div class="help">${esc(uploadHint())}</div></div><input type="file" id="rsFile" multiple style="display:none" onchange="onPickTrackFiles(this)"><div id="resubFileList"></div><div class="err-tx" id="eResubFile" style="display:none"></div></div>
    <div class="msg err" id="rsErr" style="display:none"></div>
    <button class="btn primary" id="rsBtn" onclick="doResubmitIntake()">✏️ แก้ไขและส่งกลับ</button>
  </div>`;
}
/* ---- กล่องตอบกลับการตรวจร่าง (REVISION → resubmitRevision) ---- */
function resubRevisionBox(t){
  return `<div class="msg info">📌 <b>ส่งกลับให้ตรวจ/แก้ร่าง:</b> ${esc(t.last_return_reason||'-')}${t.revision_count?` · รอบที่ ${esc(t.revision_count)}`:''}</div>
  <div class="panel" style="background:var(--panel2)">
    <div class="field"><label class="fl" for="rvNote">ตอบกลับ/ยืนยัน <span class="req">*</span></label><textarea id="rvNote" maxlength="4000" placeholder="เช่น ตรวจแล้วถูกต้อง / แก้ไขตามที่แจ้งแล้ว"></textarea></div>
    <div class="field"><label class="fl">แนบไฟล์ (ถ้ามี)</label><div class="upzone" tabindex="0" role="button" onclick="document.getElementById('rvFile').click()">📎 คลิกเพื่อเลือกไฟล์<div class="help">${esc(uploadHint())}</div></div><input type="file" id="rvFile" multiple style="display:none" onchange="onPickTrackFiles(this)"><div id="resubFileList"></div><div class="err-tx" id="eResubFile" style="display:none"></div></div>
    <div class="msg err" id="rvErr" style="display:none"></div>
    <button class="btn primary" id="rvBtn" onclick="doResubmitRevision()">↩️ ยืนยันและส่งกลับ</button>
  </div>`;
}
function isoToDateInput(iso){ const d = new Date(iso); if(isNaN(d.getTime())) return ''; return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

/* ---- ไฟล์แนบสำหรับหน้า track (แยกจาก FORM.files) ---- */
function onPickTrackFiles(inp){ if(inp.files) addTrackFiles(inp.files); inp.value=''; }
function addTrackFiles(fileList){
  const maxMb = (CFG && CFG.max_upload_mb) ? Number(CFG.max_upload_mb) : 10;
  const allowed = (CFG && CFG.allowed_mime && CFG.allowed_mime.length) ? CFG.allowed_mime : null;
  let errs = [];
  Array.prototype.forEach.call(fileList, file=>{
    if(file.size > maxMb*1048576){ errs.push(`${file.name}: ใหญ่เกิน ${maxMb} MB`); return; }
    if(allowed && file.type && allowed.indexOf(file.type) === -1){ errs.push(`${file.name}: ชนิดไฟล์ไม่รองรับ`); return; }
    const reader = new FileReader();
    reader.onload = ()=>{ TRACK.files.push({ name:file.name, mime:file.type||'application/octet-stream', base64:reader.result, size:file.size }); renderTrackFileList(); };
    reader.onerror = ()=>{ const b=$('eResubFile'); if(b){ b.style.display=''; b.textContent = file.name+': อ่านไฟล์ไม่สำเร็จ'; } };
    reader.readAsDataURL(file);
  });
  const b = $('eResubFile'); if(b){ if(errs.length){ b.style.display=''; b.textContent = errs.join(' · '); } else { b.style.display='none'; b.textContent=''; } }
}
function removeTrackFile(i){ TRACK.files.splice(i,1); renderTrackFileList(); }
function renderTrackFileList(){
  const el = $('resubFileList'); if(!el) return;
  el.innerHTML = TRACK.files.map((f,i)=>`<div class="fileitem">📄 <span class="fn">${esc(f.name)}</span> <span style="color:var(--ink3)">${fmtBytes(f.size)}</span><button class="x" type="button" aria-label="ลบไฟล์" onclick="removeTrackFile(${i})">✕</button></div>`).join('');
}
async function doResubmitIntake(){
  const btn = $('rsBtn'), errB = $('rsErr'); errB.style.display='none';
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังส่ง...';
  try{
    await api('resubmitTicket', {
      ticket_no: TRACK.ticket, email: TRACK.em,
      subject: $('rsSubject') ? $('rsSubject').value.trim() : undefined,
      deadline: $('rsDeadline') ? $('rsDeadline').value : undefined,
      note: $('rsNote') ? $('rsNote').value.trim() : '',
      attachments: TRACK.files.map(x=>({ name:x.name, mime:x.mime, base64:x.base64 }))
    });
    toast('ส่งคำขอที่แก้ไขกลับเรียบร้อยแล้ว'); TRACK.files = []; doTrack();
  }catch(err){ btn.disabled=false; btn.textContent='✏️ แก้ไขและส่งกลับ'; errB.style.display=''; errB.textContent = err.msg || 'ส่งกลับไม่สำเร็จ'; }
}
async function doResubmitRevision(){
  const note = $('rvNote') ? $('rvNote').value.trim() : '';
  const errB = $('rvErr'); errB.style.display='none';
  if(!note){ errB.style.display=''; errB.textContent='กรุณากรอกข้อความตอบกลับ'; return; }
  const btn = $('rvBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังส่ง...';
  try{
    await api('resubmitRevision', { ticket_no: TRACK.ticket, email: TRACK.em, note: note, attachments: TRACK.files.map(x=>({ name:x.name, mime:x.mime, base64:x.base64 })) });
    toast('ส่งกลับให้เจ้าหน้าที่เรียบร้อยแล้ว'); TRACK.files = []; doTrack();
  }catch(err){ btn.disabled=false; btn.textContent='↩️ ยืนยันและส่งกลับ'; errB.style.display=''; errB.textContent = err.msg || 'ส่งกลับไม่สำเร็จ'; }
}

/* ---- แบบประเมินความพึงพอใจ (ISO 10002) ---- */
function openSurvey(){ surveyRating = 0; openM(surveyModal()); }
function surveyModal(){
  const t = (TRACK.data && TRACK.data.ticket) || {};
  return `<div class="mh"><h3>⭐ ประเมินความพึงพอใจ</h3><button class="mx" onclick="closeM()" aria-label="ปิด">✕</button></div>
  <div class="mb"><p>${esc(t.ticket_no||'')} · ความพึงพอใจต่อการให้บริการ (ISO 10002)</p>
  <div class="stars" id="stars">${[1,2,3,4,5].map(i=>`<span role="button" tabindex="0" aria-label="${i} ดาว" onclick="setStar(${i})">★</span>`).join('')}</div>
  <div class="field" style="margin-top:10px"><label class="fl" for="svComment">ความคิดเห็นเพิ่มเติม</label><textarea id="svComment" maxlength="1000" placeholder="เช่น ดำเนินการรวดเร็วทันใจ"></textarea></div>
  <div class="msg err" id="svErr" style="display:none"></div>
  <button class="btn primary" id="svBtn" onclick="submitSurvey()">ส่งคะแนน</button></div>`;
}
function setStar(n){ surveyRating = n; document.querySelectorAll('#stars span').forEach((s,i)=> s.style.color = i < n ? '#f0a92a' : ''); }
async function submitSurvey(){
  const errB = $('svErr'); errB.style.display='none';
  if(!surveyRating){ errB.style.display=''; errB.textContent='กรุณาเลือกคะแนนดาว'; return; }
  const btn = $('svBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังส่ง...';
  try{
    await api('submitSatisfaction', { ticket_no: TRACK.ticket, email: TRACK.em, rating: surveyRating, comment: ($('svComment') ? $('svComment').value.trim() : '') });
    closeM(); toast('ขอบคุณสำหรับการประเมิน'); doTrack();
  }catch(err){ btn.disabled=false; btn.textContent='ส่งคะแนน'; errB.style.display=''; errB.textContent = err.msg || 'ส่งคะแนนไม่สำเร็จ'; }
}

/* ---- กู้เลขคำขอทางอีเมล (F6) ---- */
function recoverModal(){
  return `<div class="mh"><h3>📧 กู้เลขที่คำขอ</h3><button class="mx" onclick="closeM()" aria-label="ปิด">✕</button></div>
  <div class="mb"><p>กรอกอีเมลที่ใช้ยื่นคำขอ ระบบจะส่งรายการคำขอทั้งหมดไปทางอีเมล (หากพบข้อมูล)</p>
  <div class="field"><label class="fl" for="rcEmail">อีเมล</label><input type="email" id="rcEmail" placeholder="you@yru.ac.th"></div>
  <div class="msg err" id="rcErr" style="display:none"></div>
  <button class="btn primary" id="rcBtn" onclick="submitRecover()">ส่งให้ทางอีเมล</button></div>`;
}
async function submitRecover(){
  const em = $('rcEmail') ? $('rcEmail').value.trim() : '';
  const errB = $('rcErr'); errB.style.display='none';
  if(!em || em.indexOf('@') < 1){ errB.style.display=''; errB.textContent='กรุณากรอกอีเมลให้ถูกต้อง'; return; }
  const btn = $('rcBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>กำลังส่ง...';
  try{ const d = await api('recover', { email: em }); closeM(); toast((d && d.message) ? d.message : 'ส่งรายการคำขอไปยังอีเมลแล้ว (หากมี)'); }
  catch(err){ btn.disabled=false; btn.textContent='ส่งให้ทางอีเมล'; errB.style.display=''; errB.textContent = err.msg || 'ส่งไม่สำเร็จ'; }
}

/* ============================================================
   8) โหลด config + boot
   ============================================================ */
async function loadConfig(){
  if(API_URL === API_PLACEHOLDER) return;
  try{
    const [cfg, reqs, types] = await Promise.all([ api('config'), api('requesters'), api('ticketTypes') ]);
    CFG = cfg || {};
    REQUESTERS = Array.isArray(reqs) ? reqs : [];
    TYPES = (types && Object.keys(types).length) ? types : (CFG.types || {});
    if(CFG.system_title) document.title = CFG.system_title + ' — ระบบรับบริการงานบริหารทั่วไป';
    hideBanner();
    render();   // เติมส่วน config-driven (ชื่อระบบ/ประเภท/ผู้แจ้ง/สถิติ)
  }catch(err){
    showBanner('เชื่อมต่อระบบไม่ได้: ' + (err.msg || 'เกิดข้อผิดพลาด') + ' — บางฟังก์ชันจะใช้ไม่ได้จนกว่าจะเชื่อมต่อสำเร็จ', true);
  }
}
function boot(){
  initTheme();
  // ปิด modal ด้วยคลิกพื้นหลัง/Esc
  $('ov').addEventListener('click', e=>{ if(e.target.id === 'ov') closeM(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeM(); });
  // เมนู/ปุ่มนำทาง (delegation)
  document.addEventListener('click', e=>{
    const act = e.target.closest('[data-act="logout"]');
    if(act){ e.preventDefault(); doLogout(); return; }
    const nav = e.target.closest('[data-scr]');
    if(nav){ e.preventDefault(); const scr = nav.dataset.scr; if(scr === 'form' && FORM.step === 3) FORM = newForm(); go(scr); return; }
    const mode = e.target.closest('[data-mode]');
    if(mode){ setTheme(S.theme === 'light' ? 'dark' : 'light'); return; }
  });
  window.addEventListener('popstate', renderFromUrl);
  if(API_URL === API_PLACEHOLDER){
    showBanner('⚠️ ยังไม่ได้ตั้งค่า API_URL — ผู้ดูแลต้องวาง /exec URL ในไฟล์ app.js ก่อน (ดูขั้นตอนใน README_Phase2_WP2.md)');
  }
  renderFromUrl();   // แสดง shell ทันที (หน้า home เปิดดูได้แม้ backend ยังไม่ deploy)
  loadConfig();      // แล้วโหลด config/requesters/types (async — ไม่บล็อกการแสดงผล)
  restoreSession();  // กู้ session เจ้าหน้าที่ถ้ามี token เดิม (async)
}
boot();   // index.html โหลด app.js แบบ defer → DOM พร้อมแล้ว เรียก boot ได้เลย

