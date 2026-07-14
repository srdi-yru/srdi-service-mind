/* ============================================================
   SRDI-Service Mind — app.js  (WP2 Frontend สาธารณะ)
   หน้าเว็บ decoupled: เรียก GAS Web App ด้วย fetch (text/plain) ตาม API_CONTRACT
   หน้าในเฟสนี้: home (หน้าหลัก) · form (wizard 3 สเต็ป + OTP) · track (ติดตาม/แก้ไข/ประเมิน)
   หน้าเจ้าหน้าที่ (login/admin/assignee) = WP3
   ============================================================ */

/* ★★★★★  จุดที่ต้องกรอกเอง (1 จุดเดียว)  ★★★★★
   วาง /exec URL ที่ได้จากการ Deploy backend (Apps Script) แทนข้อความ placeholder ด้านล่าง
   ตัวอย่าง: const API_URL = 'https://script.google.com/macros/s/AKfycb..../exec';
*/
const API_URL = 'https://script.google.com/macros/s/AKfycbyr_uhx0TrSeVd5fR3M_TVJbE_yiVg5xKq9GCG0m-H4BDKr5TxhBUQzGreNoZPNGV_m/exec';

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
  $('tabs').innerHTML =
    TABS.map(x => `<button class="tab ${S.screen === x.id ? 'active' : ''} ${x.cta ? 'cta' : ''}" data-scr="${x.id}" ${S.screen === x.id ? 'aria-current="page"' : ''}>${x.t}</button>`).join('')
    + `<button class="tab mode" id="mBtn" data-mode aria-label="สลับโหมดสว่าง/มืด">${S.theme === 'light' ? '🌙' : '☀️'}</button>`;
  $('who').innerHTML = `<span class="rolepill">ผู้แจ้ง</span> ไม่ต้องเข้าสู่ระบบ — ส่งคำขอและติดตามได้เลย`;
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
  S.screen = ['home','form','track','staff'].includes(t) ? t : 'home';
  render();
}
function render(){
  buildBars();
  const st = $('stage');
  if(S.screen === 'home')       st.innerHTML = homeV();
  else if(S.screen === 'form')  st.innerHTML = formV();
  else if(S.screen === 'track') st.innerHTML = trackV();
  else if(S.screen === 'staff') st.innerHTML = staffV();
  else                          st.innerHTML = homeV();
  window.scrollTo(0, 0);
  if(S.screen === 'home')  homeAfter();
  if(S.screen === 'form')  formAfter();
  if(S.screen === 'track') trackAfter();
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
   5) หน้า STAFF (placeholder — ทำจริงใน WP3)
   ============================================================ */
function staffV(){
  return `<div style="max-width:460px;margin:26px auto"><div class="panel statecard" style="padding:34px 26px">
    <div class="ico">🔑</div><h3>ส่วนเจ้าหน้าที่</h3>
    <p>ระบบเข้าสู่ระบบเจ้าหน้าที่ (คิวรับเรื่อง · มอบหมายงาน · แดชบอร์ด) กำลังพัฒนาในเฟสถัดไป (WP3)</p>
    <button class="btn ghost" data-scr="home">← กลับหน้าหลัก</button>
  </div></div>`;
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
}
boot();   // index.html โหลด app.js แบบ defer → DOM พร้อมแล้ว เรียก boot ได้เลย

