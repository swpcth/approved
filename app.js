/**
 * ==============================================================
 *  ระบบตรวจสอบหน่วยคะแนนการศึกษาต่อเนื่อง — Frontend (GitHub Pages) [ฉบับปรับปรุง]
 * ==============================================================
 *  ดึงข้อมูลจาก Google Apps Script Web App (JSON API) ผ่าน fetch()
 *
 *  ปีที่จัด: ไม่ต้องแก้โค้ดทุกปีอีกต่อไป
 *   - รายชื่อปีมาจากชีตจริงผ่าน ?action=years (เพิ่มชีตปีใหม่ในสเปรดชีต = ตัวเลือกขึ้นเอง)
 *   - ปีเริ่มต้น = ปี พ.ศ. ปัจจุบัน ถ้ามีชีตของปีนั้น ไม่งั้นใช้ปีล่าสุดที่มีข้อมูล
 *   - ถ้าเรียก API ปีไม่ได้ จะสร้างรายการสำรองจากปีปัจจุบันย้อนไปถึง FALLBACK_OLDEST_YEAR อัตโนมัติ
 * ==============================================================
 */
'use strict';

// ==========================================
// CONFIG — แก้ที่เดียวตรงนี้
// ==========================================
const CONFIG = {
  // URL ของ Web App ที่ deploy จาก Google Apps Script (ลงท้ายด้วย /exec)
  API_BASE_URL: "https://script.google.com/macros/s/AKfycbzdyvOUsVK-S4XIz0QOk8WMC-K9K0hoRJy9oE5vZtBZqP6RQyLvFudpEwsdq6Qt2up8/exec",
  // URL ของผู้ช่วย AI (โหลดเมื่อกดเปิดแชทครั้งแรกเท่านั้น)
  CHAT_URL: "https://script.google.com/macros/s/AKfycbwBuYpJZUv2USdBcNYzY0eZ2SQxgu9Kl2SEfWoLrwuZCo5D_UoBtPJvjn5770fo9wld6Q/exec",

  REQUEST_TIMEOUT_MS: 30000,   // รอ API สูงสุดกี่มิลลิวินาที
  RETRY_ON_NETWORK_ERROR: 1,   // ลองใหม่อัตโนมัติกี่ครั้งเมื่อเครือข่ายล้มเหลว
  PAGE_SIZE: 100,              // แสดงทีละกี่แถว (กดปุ่ม "แสดงเพิ่ม" เพื่อดูต่อ)
  SEARCH_DEBOUNCE_MS: 200,
  FRESH_MS: 60 * 1000,         // ข้อมูลในเครื่องใหม่กว่านี้ ไม่ต้องดึงซ้ำเบื้องหลัง
  YEARS_TTL_MS: 24 * 60 * 60 * 1000,
  NAMELIST_PREFETCH_MS: 1500,  // ดึงรายชื่อผู้เข้าอบรมรอไว้หลังโหลดแท็บแรกเสร็จ (สลับแท็บแล้วเห็นทันที)

  // ใช้เฉพาะตอนเรียก ?action=years ไม่สำเร็จ และไม่มีรายการเก่าในเครื่อง
  FALLBACK_OLDEST_YEAR: 2564,
  FALLBACK_SPECIAL_SHEETS: ['2559-2563', 'SWPC before 65'],

  // ชื่อที่แสดงของชีตพิเศษ (ถ้าไม่ระบุ จะแสดงชื่อชีตตามจริง)
  YEAR_LABELS: { 'SWPC before 65': 'จัดโดยสภาฯ ก่อน 65' },
};

const MSG_NOT_FOUND = 'ไม่พบข้อมูลที่ค้นหา ลองเปลี่ยนคำค้นหาหรือปีที่จัดดูครับ';
const MSG_YEAR_SHEET_MISSING = 'ไม่พบข้อมูลปีงบประมาณที่เลือก';

// ==========================================
// Helpers
// ==========================================
const $ = (id) => document.getElementById(id);

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// escape สำหรับเนื้อหา HTML (ขึ้นบรรทัดใหม่ในเซลล์ -> <br> เหมือนพฤติกรรมเดิม)
function esc(value) {
  return (value ?? '').toString().replace(/[&<>"']/g, (c) => ESC_MAP[c]).replace(/\r?\n/g, '<br>');
}

// escape สำหรับค่าในแอตทริบิวต์ (href, value, aria-label)
function escAttr(value) {
  return (value ?? '').toString().replace(/[&<>"']/g, (c) => ESC_MAP[c]).replace(/\s+/g, ' ');
}

// อนุญาตเฉพาะลิงก์ http/https — กัน javascript: และ scheme อื่น
function safeUrl(value) {
  const s = (value || '').toString().trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch (e) {
    return '';
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// เก็บข้อมูลชั่วคราวในเครื่องผู้ใช้ (ใช้ไม่ได้/เต็ม = ข้ามไปเงียบๆ ไม่กระทบการทำงาน)
function makeStore(getStorage) {
  return {
    get(key) {
      try {
        const raw = getStorage().getItem('swpc:' + key);
        if (!raw) return null;
        const o = JSON.parse(raw);
        return { data: o.d, age: Date.now() - o.t };
      } catch (e) { return null; }
    },
    set(key, data) {
      try { getStorage().setItem('swpc:' + key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) { /* เต็ม/ถูกบล็อก */ }
    },
  };
}
const sessionCache = makeStore(() => window.sessionStorage);
const localCache = makeStore(() => window.localStorage);

// ==========================================
// State
// ==========================================
const state = {
  credits: { all: [], view: [], sort: { col: null, dir: null }, shown: CONFIG.PAGE_SIZE, reqId: 0, abort: null, year: '', loaded: false },
  namelist: { all: [], view: [], sort: { col: null, dir: null }, shown: CONFIG.PAGE_SIZE, reqId: 0, abort: null, loaded: false, loading: false },
};

// โครงการที่เลือกไว้พิมพ์เอกสารรับรอง (key = เนื้อหาแถว) เลือกค้างไว้ได้แม้ค้นหา/เรียงใหม่
const selectedCreditRows = new Map();

let userChangedYear = false;
let yearsPending = true;
let deferredCreditsError = null;
const isDesktop = window.matchMedia('(min-width: 768px)');

// ==========================================
// ปีที่จัด (อัตโนมัติ)
// ==========================================
const currentBuddhistYear = () => new Date().getFullYear() + 543;
const isNumericYear = (y) => /^\d{4}$/.test(y);
const yearLabel = (y) => CONFIG.YEAR_LABELS[y] || y;

function buildFallbackYears() {
  const years = [];
  for (let y = currentBuddhistYear(); y >= CONFIG.FALLBACK_OLDEST_YEAR; y--) years.push(String(y));
  return years.concat(CONFIG.FALLBACK_SPECIAL_SHEETS);
}

// ปี พ.ศ. ปัจจุบันถ้ามีในรายการ ไม่งั้นปีล่าสุดที่มี ไม่งั้น "ทั้งหมด"
function pickDefaultYear(years) {
  const now = String(currentBuddhistYear());
  if (years.includes(now)) return now;
  return years.find(isNumericYear) || '';
}

function populateYearSelects(years) {
  const creditsSelect = $('year-select');
  const namelistSelect = $('year-filter-namelist');
  const prevCredits = creditsSelect.value;
  const prevNamelist = namelistSelect.value;

  creditsSelect.innerHTML = '<option value="">ทั้งหมด</option>' +
    years.map((y) => `<option value="${escAttr(y)}">${esc(yearLabel(y))}</option>`).join('');
  namelistSelect.innerHTML = '<option value="">ทั้งหมด</option>' +
    years.filter(isNumericYear).map((y) => `<option value="${escAttr(y)}">${esc(y)}</option>`).join('');

  if (years.includes(prevCredits)) creditsSelect.value = prevCredits;
  if (years.includes(prevNamelist)) namelistSelect.value = prevNamelist;
}

async function loadYears() {
  const res = await callApi('years');
  yearsPending = false;

  if (res.status !== 'success' || !Array.isArray(res.data) || res.data.length === 0) {
    // ใช้รายการเดิม (จากเครื่อง/สำรอง) ต่อไป และแสดง error ที่รออยู่ (ถ้ามี)
    flushDeferredCreditsError();
    return;
  }

  const years = res.data.map(String);
  localCache.set('years', years);

  const select = $('year-select');
  const prevValue = select.value;
  populateYearSelects(years);
  const desired = pickDefaultYear(years);

  if (!userChangedYear) {
    // ผู้ใช้ยังไม่ได้เลือกปีเอง: ถ้าปีที่แสดงอยู่ไม่ตรงกับปีเริ่มต้นที่ถูกต้อง (เช่น ขึ้นปีใหม่ หรือรายการในเครื่องเก่า) สลับให้เอง
    if (desired !== state.credits.year) {
      select.value = desired;
      deferredCreditsError = null;
      fetchCreditsData(desired, { resetSelection: true });
      return;
    }
  } else if (prevValue !== '' && !years.includes(prevValue)) {
    // ผู้ใช้เลือกปีที่ไม่มีชีตอยู่จริง -> กลับไปปีเริ่มต้น ("ทั้งหมด" = ค่าว่าง ถือว่าถูกต้องเสมอ)
    select.value = desired;
    deferredCreditsError = null;
    fetchCreditsData(desired, { resetSelection: true });
    return;
  }
  flushDeferredCreditsError();
}

function flushDeferredCreditsError() {
  if (deferredCreditsError) {
    const fn = deferredCreditsError;
    deferredCreditsError = null;
    fn();
  }
}

// ==========================================
// เรียก API (timeout + ยกเลิกได้ + ลองใหม่เมื่อเครือข่ายล้มเหลว)
// คืนค่า Promise<{status, data|message}> เสมอ — status 'aborted' = ถูกยกเลิกโดยโค้ด
// ==========================================
async function callApi(action, params, signal) {
  if (!CONFIG.API_BASE_URL || CONFIG.API_BASE_URL.includes('XXXXXXXX')) {
    $('api-config-warning').classList.remove('hidden');
    return { status: 'error', message: 'ยังไม่ได้ตั้งค่า API_BASE_URL ในไฟล์ app.js' };
  }

  const url = new URL(CONFIG.API_BASE_URL);
  url.searchParams.set('action', action);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  let lastError = null;
  for (let attempt = 0; attempt <= CONFIG.RETRY_ON_NETWORK_ERROR; attempt++) {
    if (signal && signal.aborted) return { status: 'aborted' };
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    try {
      const res = await fetch(url.toString(), { signal: ctrl.signal });
      if (!res.ok) {
        return { status: 'error', message: `เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status})` };
      }
      return await res.json();
    } catch (err) {
      if (signal && signal.aborted) return { status: 'aborted' };
      lastError = ctrl.signal.aborted
        ? 'หมดเวลารอการตอบกลับจากเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง'
        : 'เชื่อมต่อ API ไม่สำเร็จ: ' + err.toString();
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 'error', message: lastError };
}

// ==========================================
// เอกสารรับรองหน่วยคะแนน (เลือกโครงการ -> พิมพ์)
// ==========================================
function rowKey(row) {
  return row.join('␟');
}

function toggleCreditSelection(checkboxEl, idx) {
  const row = state.credits.view[idx];
  if (!row) return;
  const key = rowKey(row);
  if (checkboxEl.checked) selectedCreditRows.set(key, row);
  else selectedCreditRows.delete(key);
  updateSelectionBar();
}

function toggleSelectAllVisible(checkboxEl) {
  state.credits.view.forEach((row) => {
    const key = rowKey(row);
    if (checkboxEl.checked) selectedCreditRows.set(key, row);
    else selectedCreditRows.delete(key);
  });
  renderCredits();
  updateSelectionBar();
}

function clearCertSelection() {
  selectedCreditRows.clear();
  renderCredits();
  updateSelectionBar();
}

function updateSelectionBar() {
  const view = state.credits.view;
  $('cert-selected-count').textContent = selectedCreditRows.size;
  $('cert-selection-bar').classList.toggle('hidden', selectedCreditRows.size === 0);

  const selectAllBox = $('select-all-credits');
  if (selectAllBox) {
    const visibleSelected = view.filter((row) => selectedCreditRows.has(rowKey(row))).length;
    selectAllBox.checked = view.length > 0 && visibleSelected === view.length;
  }
}

function firstLine(text) {
  return (text || '-').toString().split('\n')[0].trim() || '-';
}

let certReturnFocusEl = null;

function openCertificateModal() {
  if (selectedCreditRows.size === 0) return;

  const rows = Array.from(selectedCreditRows.values());
  $('cert-table-rows').innerHTML = rows.map((row, i) => {
    const activityType = (row[10] || '').toString().trim();
    const activityTypeLine = (activityType && activityType !== '-')
      ? `<br><span class="text-[10px] text-c-sky font-semibold">ประเภทกิจกรรม: ${esc(activityType)}</span>` : '';
    return `
    <tr>
      <td>${i + 1}</td>
      <td class="text-left">${esc(row[1])}</td>
      <td class="text-left">${esc(row[2])}${activityTypeLine}</td>
      <td class="text-left">${esc(firstLine(row[3]))}</td>
      <td>${esc(row[4] || '-')}</td>
      <td>${esc(row[5] || '-')}</td>
      <td class="text-left">${esc(row[6] || '-')}</td>
      <td>${esc(row[7] || '-')}</td>
      <td>${esc(row[8] || '-')}</td>
    </tr>`;
  }).join('');

  $('cert-print-date').textContent = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });

  certReturnFocusEl = document.activeElement;
  $('certificate-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onCertKeydown);
  $('cert-close-x').focus();
}

function closeCertificateModal() {
  $('certificate-modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onCertKeydown);
  if (certReturnFocusEl && typeof certReturnFocusEl.focus === 'function') certReturnFocusEl.focus();
}

// Esc = ปิด, Tab = วนอยู่ภายในหน้าต่าง
function onCertKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeCertificateModal(); return; }
  if (e.key !== 'Tab') return;
  const focusables = Array.from($('certificate-modal').querySelectorAll('button, a[href], input, select, textarea'))
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ==========================================
// เรียงลำดับ (คลิก 1 = ก-ฮ, 2 = ฮ-ก, 3 = กลับลำดับเดิม)
// ==========================================
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_ABBR = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];
const thaiOnly = (s) => s.replace(/[^ก-๙]/g, '');

function thaiMonthNumber(text) {
  const t = thaiOnly(text);
  if (!t) return NaN;
  let i = TH_MONTHS_ABBR.indexOf(t);
  if (i === -1) i = TH_MONTHS.map(thaiOnly).indexOf(t);
  return i === -1 ? NaN : i + 1;
}

// แปลงข้อความวันที่ (บรรทัดแรก) เป็นตัวเลขสำหรับเรียง เช่น "12-14 ม.ค. 69", "12/01/2569" -> 25690112
// อ่านไม่ออกคืน null (จะไปเทียบเป็นข้อความแทน)
function dateSortKey(text) {
  const first = (text || '').toString().split('\n')[0].trim();
  let d, mo, y;
  let m = first.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2,4})/);
  if (m) {
    d = +m[1]; mo = +m[2]; y = +m[3];
  } else {
    m = first.match(/(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*([^\d\s]+)\s*(\d{2,4})/);
    if (!m) return null;
    d = +m[1]; mo = thaiMonthNumber(m[2]); y = +m[3];
  }
  if (!(mo >= 1 && mo <= 12)) return null;
  if (y < 100) y += 2500;          // 69 -> 2569
  else if (y < 2400) y += 543;     // ค.ศ. -> พ.ศ.
  if (y < 2500 || y > 2700) return null;
  return y * 10000 + mo * 100 + d;
}

function compareRows(type, col) {
  const isDate = type === 'credits' && col === 3;
  return (a, b) => {
    const va = (a[col] || '').toString();
    const vb = (b[col] || '').toString();
    if (isDate) {
      const ka = dateSortKey(va) ?? 0;
      const kb = dateSortKey(vb) ?? 0;
      if (ka !== kb) return ka - kb;
    }
    return va.localeCompare(vb, 'th');
  };
}

function sortTable(type, col) {
  const s = state[type].sort;
  if (s.col !== col) { s.col = col; s.dir = 'asc'; }
  else if (s.dir === 'asc') { s.dir = 'desc'; }
  else { s.col = null; s.dir = null; }
  state[type].shown = CONFIG.PAGE_SIZE;
  applyFilter(type);
}

function updateSortIcons(type) {
  const { col, dir } = state[type].sort;
  document.querySelectorAll(`[id^="sort-${type}-"]`).forEach((icon) => {
    icon.className = 'fas fa-sort ml-1 opacity-50 text-xs';
    const th = icon.closest('th');
    if (th) th.setAttribute('aria-sort', 'none');
  });
  if (col === null) return;
  const target = $(`sort-${type}-${col}`);
  if (!target) return;
  target.className = (dir === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down') + ' ml-1 opacity-100 text-sm text-yellow-300';
  const th = target.closest('th');
  if (th) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
}

// ==========================================
// Tabs
// ==========================================
const TAB_IDS = { credits: 'tab-credits', namelist: 'tab-namelist' };

function switchTab(name, { focus = false } = {}) {
  Object.entries(TAB_IDS).forEach(([key, id]) => {
    const active = key === name;
    const tab = $(id);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
    $('section-' + key).classList.toggle('hidden', !active);
  });
  if (focus) $(TAB_IDS[name]).focus();

  if (name === 'namelist' && !state.namelist.loaded && !state.namelist.loading) {
    fetchNameListData();
  }
}

function onTabKeydown(e) {
  const order = Object.keys(TAB_IDS);
  const current = order.findIndex((k) => $(TAB_IDS[k]) === e.currentTarget);
  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = order[(current + 1) % order.length];
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = order[(current - 1 + order.length) % order.length];
  else if (e.key === 'Home') next = order[0];
  else if (e.key === 'End') next = order[order.length - 1];
  if (next) { e.preventDefault(); switchTab(next, { focus: true }); }
}

// ==========================================
// ค้นหา / ล้างคำค้น
// ==========================================
function clearKeyword(type) {
  const input = $(`keyword-${type}`);
  input.value = '';
  input.focus();
  state[type].shown = CONFIG.PAGE_SIZE;
  applyFilter(type);
}

function toggleClearButton(type) {
  $(`clear-${type}-keyword`).classList.toggle('hidden', $(`keyword-${type}`).value.length === 0);
}

// กรอง -> เรียง -> แสดงผล (ใช้ร่วมกันทั้งสองแท็บ)
function applyFilter(type) {
  toggleClearButton(type);
  const st = state[type];
  const keyword = $(`keyword-${type}`).value.toLowerCase();
  let rows = st.all;

  if (type === 'credits') {
    if (keyword) {
      rows = rows.filter((row) =>
        (row[1] || '').toString().toLowerCase().includes(keyword) ||
        (row[2] || '').toString().toLowerCase().includes(keyword));
    }
  } else {
    const yearFilter = $('year-filter-namelist').value;
    if (yearFilter) rows = rows.filter((row) => (row[0] || '').toString() === yearFilter);
    if (keyword) rows = rows.filter((row) => (row[2] || '').toString().toLowerCase().includes(keyword));
  }

  if (st.sort.col !== null && st.sort.dir) {
    const cmp = compareRows(type, st.sort.col);
    rows = rows.slice().sort(st.sort.dir === 'asc' ? cmp : (a, b) => cmp(b, a));
  }

  st.view = rows;
  updateSortIcons(type);
  if (type === 'credits') renderCredits(); else renderNameList();
}

const onSearchInput = {
  credits: debounce(() => { state.credits.shown = CONFIG.PAGE_SIZE; applyFilter('credits'); }, CONFIG.SEARCH_DEBOUNCE_MS),
  namelist: debounce(() => { state.namelist.shown = CONFIG.PAGE_SIZE; applyFilter('namelist'); }, CONFIG.SEARCH_DEBOUNCE_MS),
};

// ==========================================
// สถานะโหลด / ผิดพลาด
// ==========================================
function showSkeleton(type, colCount) {
  $(`${type}-count`).textContent = 'กำลังโหลด...';
  $(`result-area-${type}`).setAttribute('aria-busy', 'true');
  hideMore(type);

  let rowsHtml = '';
  for (let i = 0; i < 5; i++) {
    rowsHtml += '<tr>' + Array.from({ length: colCount }).map(() =>
      '<td class="table-cell"><div class="skeleton-block h-4 w-full"></div></td>').join('') + '</tr>';
  }
  $(`tbody-${type}`).innerHTML = rowsHtml;

  let cardsHtml = '';
  for (let i = 0; i < 3; i++) {
    cardsHtml += `<div class="card-item"><div class="skeleton-block h-4 w-3/4 mb-2"></div><div class="skeleton-block h-3 w-1/2"></div></div>`;
  }
  $(`cards-${type}`).innerHTML = cardsHtml;
}

function showTableError(type, message, colCount) {
  $(`${type}-count`).textContent = 'เกิดข้อผิดพลาด';
  $(`result-area-${type}`).setAttribute('aria-busy', 'false');
  hideMore(type);
  const body = `
    <div class="text-center py-12 px-4" role="alert">
      <p class="text-c-red font-semibold mb-1"><i class="fas fa-triangle-exclamation mr-1"></i> เกิดข้อผิดพลาด</p>
      <p class="text-gray-500 text-sm mb-4">${esc(message || 'ไม่ทราบสาเหตุ')}</p>
      <button type="button" class="retry-btn" data-retry="${type}"><i class="fas fa-rotate-right"></i> ลองอีกครั้ง</button>
    </div>`;
  $(`tbody-${type}`).innerHTML = `<tr><td colspan="${colCount}" class="bg-gray-50 border-b border-gray-300">${body}</td></tr>`;
  $(`cards-${type}`).innerHTML = body;
}

function showMore(type, remaining) {
  $(`more-${type}`).classList.remove('hidden');
  $(`more-${type}-btn`).innerHTML = `<i class="fas fa-angles-down"></i> แสดงเพิ่ม (เหลืออีก ${remaining} รายการ)`;
}
function hideMore(type) {
  $(`more-${type}`).classList.add('hidden');
}

// ==========================================
// CSV Export
// ==========================================
function csvCell(value) {
  let text = (value ?? '').toString();
  // กัน CSV injection (Excel ตีความเซลล์ที่ขึ้นต้นด้วย = + - @ เป็นสูตร) ยกเว้นค่า "-" เดี่ยวๆ
  if (/^[=+\-@\t\r]/.test(text) && text !== '-') text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function localDateStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function notify(icon, title, text) {
  if (window.Swal) Swal.fire({ icon, title, text });
  else alert(title + '\n' + text);
}

function exportToCSV(type) {
  const data = state[type].view;
  if (!data || data.length === 0) {
    notify('info', 'ไม่มีข้อมูล', 'ยังไม่มีผลการค้นหาให้ดาวน์โหลด');
    return;
  }

  const headers = type === 'credits'
    ? ['ชื่อหน่วยงาน', 'ชื่อโครงการ', 'วันที่จัด', 'คะแนน(ผู้เข้าอบรม) หมวด1', 'คะแนน(ผู้เข้าอบรม) หมวด2', 'วิทยากร/ผู้จัด', 'คะแนน(วิทยากร) หมวด1', 'คะแนน(วิทยากร) หมวด2', 'หมายเหตุ', 'ประเภทกิจกรรม']
    : ['ปีที่จัด', 'ชื่อกิจกรรม/โครงการ', 'สถานะ/ลิงก์ไฟล์'];

  const csvRows = data.map((row) => {
    const cells = type === 'credits'
      ? [row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10]]
      : [row[0], row[2], row[5] || row[3] || ''];
    return cells.map(csvCell).join(',');
  });

  const csvContent = '﻿' + [headers.map(csvCell).join(','), ...csvRows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = (type === 'credits' ? 'หน่วยคะแนน_' : 'รายชื่อผู้เข้าอบรม_') + localDateStamp() + '.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ==========================================
// TAB 1: หน่วยคะแนน
// ==========================================
async function fetchCreditsData(year, { resetSelection = false } = {}) {
  const st = state.credits;
  if (st.abort) st.abort.abort();             // ยกเลิกคำขอเก่าที่ยังค้างอยู่ กันคำตอบเก่าทับของใหม่
  const ctrl = new AbortController();
  st.abort = ctrl;
  const reqId = ++st.reqId;
  const yearChanged = st.year !== (year || '');
  st.year = year || '';

  if (resetSelection) { selectedCreditRows.clear(); updateSelectionBar(); }
  if (yearChanged || resetSelection) st.shown = CONFIG.PAGE_SIZE;

  const cacheKey = 'credits:' + (year || 'ALL');
  const cached = sessionCache.get(cacheKey);
  if (cached && Array.isArray(cached.data)) {
    // แสดงข้อมูลเก่าในเครื่องทันที แล้วค่อยอัปเดตเมื่อได้ข้อมูลใหม่
    st.all = cached.data;
    st.loaded = true;
    applyFilter('credits');
    $('result-area-credits').setAttribute('aria-busy', 'false');
    if (cached.age < CONFIG.FRESH_MS) return;
  } else {
    st.all = [];
    st.loaded = false;
    state.credits.view = [];
    updateSelectionBar();
    showSkeleton('credits', 8);
  }

  const res = await callApi('credits', { year: year || '', keyword: '' }, ctrl.signal);
  if (reqId !== st.reqId || res.status === 'aborted') return;

  if (res.status === 'success' && Array.isArray(res.data)) {
    sessionCache.set(cacheKey, res.data);
    if (!cached || JSON.stringify(res.data) !== JSON.stringify(st.all)) {
      st.all = res.data;
      st.loaded = true;
      applyFilter('credits');
    }
    $('result-area-credits').setAttribute('aria-busy', 'false');
    scheduleNameListPrefetch();
  } else if (!cached) {
    const show = () => showTableError('credits', res.message, 8);
    // ปีที่เดาไว้อาจยังไม่มีชีต (เช่น ขึ้นปีใหม่) ให้รอผล ?action=years ก่อนว่าจะสลับปีให้เองหรือไม่
    if (yearsPending && res.message === MSG_YEAR_SHEET_MISSING) deferredCreditsError = show;
    else show();
  }
  // ถ้ามีข้อมูลในเครื่องแสดงอยู่แล้วและดึงใหม่ไม่สำเร็จ: ใช้ข้อมูลเดิมต่อไปเงียบๆ
}

const formatMultiLine = (text, isScore = false) => {
  if (!text || text === '-') return isScore ? '' : '-';
  const lines = text.toString().split('\n');
  if (lines.length === 1) return esc(text);

  let html = '<ul class="list-none space-y-1">';
  lines.forEach((line) => {
    if (line.trim() !== '') {
      if (isScore) {
        html += `<li class="h-6 flex items-center justify-center">${esc(line)}</li>`;
      } else {
        html += `<li class="flex items-start"><span class="mr-1.5 mt-1.5 w-1 h-1 rounded-full bg-c-navy shrink-0"></span><span>${esc(line)}</span></li>`;
      }
    }
  });
  return html + '</ul>';
};

function buildCreditsRowData(row) {
  const createScoreBadge = (value, type) => {
    if (!value || value === '-') return '';
    const bgClass = type === 1
      ? 'bg-c-navy/10 text-c-navy border-c-navy/30 ring-1 ring-c-navy/10'
      : 'bg-c-red/10 text-c-red border-c-red/30 ring-1 ring-c-red/10';
    return `
       <div class="flex flex-col items-center justify-center p-1.5 mb-1.5 rounded border ${bgClass} w-full shadow-sm min-h-[50px]">
         <span class="text-[9px] font-bold uppercase tracking-wider opacity-80 leading-none mb-1">หมวด ${type}</span>
         <div class="font-bold text-sm leading-snug w-full text-center">${formatMultiLine(value, true)}</div>
       </div>`;
  };

  const activityType = (row[10] || '').toString().trim();
  const activityTypeHtml = (activityType && activityType !== '-')
    ? `<span class="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-c-sky/10 text-c-sky border border-c-sky/30 align-middle">ประเภทกิจกรรม: ${esc(activityType)}</span>`
    : '';
  const dash = '<div class="text-center text-gray-300">-</div>';
  const rawSpeakerName = row[6] || '';

  return {
    orgName: esc(row[1]),
    projectName: esc(row[2]),
    projectLabel: escAttr(row[2]),
    activityTypeHtml,
    displayDate: formatMultiLine(row[3]),
    participantScoreHtml: (!row[4] && !row[5]) ? dash : createScoreBadge(row[4], 1) + createScoreBadge(row[5], 2),
    speakerNameHtml: rawSpeakerName ? `<div class="font-bold text-c-black text-xs">${formatMultiLine(rawSpeakerName)}</div>` : dash,
    speakerScoreHtml: (!row[7] && !row[8]) ? dash : createScoreBadge(row[7], 1) + createScoreBadge(row[8], 2),
    remarksHtml: buildRemarksBadge(row[9] || '-'),
  };
}

function buildRemarksBadge(remarksRaw) {
  const badge = (icon, colorClasses) =>
    `<div class="inline-flex items-center gap-1.5 ${colorClasses} px-2.5 py-1.5 rounded text-xs font-bold text-center shadow-sm w-full justify-center"><i class="fas ${icon}"></i> ${esc(remarksRaw)}</div>`;

  if (remarksRaw === '-' || remarksRaw.trim() === '') return '<span class="text-gray-300">-</span>';
  if (remarksRaw.includes('เรียบร้อย') || remarksRaw.includes('นำเข้า')) {
    return badge('fa-check-circle', 'bg-emerald-100 text-emerald-800 border border-emerald-300');
  }
  if (remarksRaw.includes('อยู่ระหว่าง') || remarksRaw.includes('รอ') || remarksRaw.includes('กำลัง')) {
    return badge('fa-clock', 'bg-amber-100 text-amber-800 border border-amber-300');
  }
  if (remarksRaw.includes('ประกาศ')) {
    return badge('fa-bullhorn', 'bg-sky-100 text-c-sky border border-sky-300');
  }
  return `<span class="text-xs text-c-black">${formatMultiLine(remarksRaw)}</span>`;
}

// แสดงเฉพาะมุมมองที่ใช้อยู่ (ตาราง/การ์ด) และแบ่งหน้าทีละ PAGE_SIZE แถว
function renderCredits() {
  const st = state.credits;
  const data = st.view;
  const tbody = $('tbody-credits');
  const cards = $('cards-credits');
  tbody.innerHTML = '';
  cards.innerHTML = '';
  $('credits-count').textContent = `${data.length} รายการ`;
  $('result-area-credits').setAttribute('aria-busy', 'false');

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-12 text-gray-400 bg-gray-50 border-b border-gray-300">${MSG_NOT_FOUND}</td></tr>`;
    cards.innerHTML = `<div class="text-center py-12 text-gray-400">${MSG_NOT_FOUND}</div>`;
    hideMore('credits');
    updateSelectionBar();
    return;
  }

  const slice = data.slice(0, st.shown);
  const html = [];

  slice.forEach((row, i) => {
    const d = buildCreditsRowData(row);
    const checked = selectedCreditRows.has(rowKey(row)) ? 'checked' : '';
    const box = (extra) => `<input type="checkbox" class="w-4 h-4 cursor-pointer ${extra}" data-credit-idx="${i}" ${checked} title="เลือกไว้พิมพ์เอกสารรับรอง" aria-label="เลือกโครงการ ${d.projectLabel} ไว้พิมพ์เอกสารรับรอง">`;

    if (isDesktop.matches) {
      html.push(`
      <tr class="table-row">
        <td class="table-cell text-center align-middle">${box('align-middle')}</td>
        <td class="table-cell font-semibold text-c-black">${d.orgName}</td>
        <td class="table-cell font-medium text-c-navy">${d.projectName}${d.activityTypeHtml ? '<br>' + d.activityTypeHtml : ''}</td>
        <td class="table-cell text-center text-xs text-gray-600 font-medium">${d.displayDate}</td>
        <td class="table-cell">${d.participantScoreHtml}</td>
        <td class="table-cell">${d.speakerNameHtml}</td>
        <td class="table-cell">${d.speakerScoreHtml}</td>
        <td class="table-cell">${d.remarksHtml}</td>
      </tr>`);
    } else {
      html.push(`
      <div class="card-item">
        <div class="flex items-start justify-between gap-2 mb-1">
          <div class="text-xs font-bold text-c-navy/60 uppercase">${d.orgName}</div>
          ${box('shrink-0 mt-0.5')}
        </div>
        <div class="font-bold text-c-navy mb-2">${d.projectName}${d.activityTypeHtml ? '<br>' + d.activityTypeHtml : ''}</div>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <div><div class="card-label">วันที่จัด</div><div class="text-xs text-gray-700">${d.displayDate}</div></div>
          <div><div class="card-label">หมายเหตุ</div><div>${d.remarksHtml}</div></div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div><div class="card-label">คะแนน (ผู้เข้าอบรม)</div>${d.participantScoreHtml}</div>
          <div>
            <div class="card-label">วิทยากร/ผู้จัด</div>
            ${d.speakerNameHtml}
            <div class="mt-1">${d.speakerScoreHtml}</div>
          </div>
        </div>
      </div>`);
    }
  });

  (isDesktop.matches ? tbody : cards).innerHTML = html.join('');
  if (data.length > slice.length) showMore('credits', data.length - slice.length); else hideMore('credits');
  updateSelectionBar();
}

// ==========================================
// TAB 2: รายชื่อผู้เข้าอบรม
// ==========================================
let namelistPrefetchTimer = null;
function scheduleNameListPrefetch() {
  if (namelistPrefetchTimer || state.namelist.loaded || state.namelist.loading) return;
  namelistPrefetchTimer = setTimeout(() => {
    if (!state.namelist.loaded && !state.namelist.loading) fetchNameListData();
  }, CONFIG.NAMELIST_PREFETCH_MS);
}

async function fetchNameListData() {
  const st = state.namelist;
  if (st.loading) return;
  st.loading = true;

  const cached = sessionCache.get('namelist');
  if (cached && Array.isArray(cached.data)) {
    st.all = cached.data.slice().reverse();     // ใหม่สุดขึ้นก่อน (เหมือนเดิม)
    st.loaded = true;
    applyFilter('namelist');
    if (cached.age < CONFIG.FRESH_MS) { st.loading = false; return; }
  } else {
    showSkeleton('namelist', 3);
  }

  const res = await callApi('namelist', { keyword: '' });
  st.loading = false;

  if (res.status === 'success' && Array.isArray(res.data)) {
    sessionCache.set('namelist', res.data);
    if (!cached || JSON.stringify(res.data) !== JSON.stringify(cached.data)) {
      st.all = res.data.slice().reverse();
      st.loaded = true;
      applyFilter('namelist');
    }
    $('result-area-namelist').setAttribute('aria-busy', 'false');
  } else if (!cached) {
    showTableError('namelist', res.message, 3);
  }
}

function buildNameListRowData(row) {
  const textInColD = (row[3] || '').toString().trim();
  const urlInColD = safeUrl(row[5]) || safeUrl(textInColD);

  let statusActionHtml = '<span class="text-gray-300">-</span>';

  if (urlInColD) {
    statusActionHtml = `
       <a href="${escAttr(urlInColD)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-4 py-2 bg-c-navy hover:bg-c-sky text-white text-xs font-bold rounded shadow-sm transition hover:-translate-y-0.5 w-full justify-center border border-c-black/20">
         <i class="fas fa-cloud-download-alt mr-2"></i> ดาวน์โหลด
       </a>`;
  } else if (textInColD.includes('นำเข้า') || textInColD.includes('เรียบร้อย')) {
    statusActionHtml = `
       <div class="inline-flex items-center justify-center px-3 py-1.5 rounded text-xs font-bold bg-green-100 text-green-800 border border-green-300 w-full">
         <i class="fas fa-check-circle mr-1.5"></i> ${esc(textInColD)}
       </div>`;
  } else if (textInColD !== '' && textInColD !== '-') {
    statusActionHtml = `<span class="text-gray-500 text-xs font-medium">${esc(textInColD)}</span>`;
  }

  return { year: esc(row[0]), activity: esc(row[2]), statusActionHtml };
}

function renderNameList() {
  const st = state.namelist;
  const data = st.view;
  const tbody = $('tbody-namelist');
  const cards = $('cards-namelist');
  tbody.innerHTML = '';
  cards.innerHTML = '';
  $('namelist-count').textContent = `แสดง ${data.length} รายการ`;
  $('result-area-namelist').setAttribute('aria-busy', 'false');

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center py-12 text-gray-400 bg-gray-50 border-b border-gray-300">${MSG_NOT_FOUND}</td></tr>`;
    cards.innerHTML = `<div class="text-center py-12 text-gray-400">${MSG_NOT_FOUND}</div>`;
    hideMore('namelist');
    return;
  }

  const slice = data.slice(0, st.shown);
  const html = slice.map((row) => {
    const d = buildNameListRowData(row);
    if (isDesktop.matches) {
      return `
      <tr class="table-row">
        <td class="table-cell text-center font-bold text-gray-600 bg-gray-50 align-middle">${d.year}</td>
        <td class="table-cell font-medium text-c-black align-middle py-4">${d.activity}</td>
        <td class="table-cell text-center align-middle">${d.statusActionHtml}</td>
      </tr>`;
    }
    return `
      <div class="card-item">
        <div class="flex justify-between items-start gap-2 mb-2">
          <div class="font-bold text-c-black">${d.activity}</div>
          <span class="shrink-0 text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded">${d.year}</span>
        </div>
        <div>${d.statusActionHtml}</div>
      </div>`;
  });

  (isDesktop.matches ? tbody : cards).innerHTML = html.join('');
  if (data.length > slice.length) showMore('namelist', data.length - slice.length); else hideMore('namelist');
}

// ==========================================
// แชท AI (โหลด iframe เมื่อเปิดครั้งแรกเท่านั้น)
// ==========================================
function toggleChat() {
  const chat = $('aiChatFrame');
  const btn = $('aiChatBtn');
  const opening = !chat.classList.contains('open');

  if (opening && !chat.getAttribute('src')) chat.setAttribute('src', CONFIG.CHAT_URL);
  chat.classList.toggle('open', opening);
  btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  btn.textContent = opening ? '❌ ปิดหน้าต่างแชท' : '💬 คุยกับผู้ช่วยสภาฯ AI';
}

// โลโก้บางโฮสต์อาจโหลดไม่ขึ้น: แสดงไอคอนแทนที่ alt text
function handleLogoError(imgEl) {
  const fallback = document.createElement('div');
  fallback.className = 'h-20 w-20 rounded-full bg-c-navy flex items-center justify-center text-white shadow-sm';
  fallback.innerHTML = '<i class="fas fa-landmark text-3xl"></i>';
  fallback.title = 'ตราสัญลักษณ์สภาวิชาชีพสังคมสงเคราะห์';
  imgEl.replaceWith(fallback);
}

// ==========================================
// ผูก Event ทั้งหมดที่เดียว (ไม่มี inline onclick ใน HTML)
// ==========================================
function wireEvents() {
  const logo = $('council-logo');
  if (logo) {
    logo.addEventListener('error', () => handleLogoError(logo), { once: true });
    if (logo.complete && logo.naturalWidth === 0) handleLogoError(logo);
  }

  // Tabs
  Object.entries(TAB_IDS).forEach(([key, id]) => {
    $(id).addEventListener('click', () => switchTab(key));
    $(id).addEventListener('keydown', onTabKeydown);
  });

  // ตัวกรอง
  $('year-select').addEventListener('change', (e) => {
    userChangedYear = true;
    fetchCreditsData(e.target.value, { resetSelection: true });
  });
  $('year-filter-namelist').addEventListener('change', () => { state.namelist.shown = CONFIG.PAGE_SIZE; applyFilter('namelist'); });

  ['credits', 'namelist'].forEach((type) => {
    $(`keyword-${type}`).addEventListener('input', () => { toggleClearButton(type); onSearchInput[type](); });
    $(`clear-${type}-keyword`).addEventListener('click', () => clearKeyword(type));
    $(`more-${type}-btn`).addEventListener('click', () => {
      state[type].shown += CONFIG.PAGE_SIZE;
      if (type === 'credits') renderCredits(); else renderNameList();
    });
    document.querySelector(`[data-export="${type}"]`).addEventListener('click', () => exportToCSV(type));
  });

  // เรียงลำดับ (หัวตารางเป็นปุ่ม)
  document.querySelectorAll('[data-sort-table]').forEach((btn) => {
    btn.addEventListener('click', () => sortTable(btn.dataset.sortTable, Number(btn.dataset.sortCol)));
  });

  // เลือกโครงการ (event delegation) + ปุ่มลองใหม่
  ['tbody-credits', 'cards-credits'].forEach((id) => {
    $(id).addEventListener('change', (e) => {
      const box = e.target.closest('input[data-credit-idx]');
      if (box) toggleCreditSelection(box, Number(box.dataset.creditIdx));
    });
  });
  document.addEventListener('click', (e) => {
    const retry = e.target.closest('[data-retry]');
    if (!retry) return;
    if (retry.dataset.retry === 'credits') fetchCreditsData(state.credits.year);
    else { state.namelist.loading = false; fetchNameListData(); }
  });
  $('select-all-credits').addEventListener('change', (e) => toggleSelectAllVisible(e.target));
  $('cert-clear-btn').addEventListener('click', clearCertSelection);
  $('cert-open-btn').addEventListener('click', openCertificateModal);

  // Modal เอกสารรับรอง
  document.querySelectorAll('[data-close-cert]').forEach((el) => el.addEventListener('click', closeCertificateModal));
  $('cert-print-btn').addEventListener('click', () => window.print());
  $('certificate-modal').addEventListener('mousedown', (e) => { if (e.target.id === 'certificate-modal') closeCertificateModal(); });

  // แชท
  $('aiChatBtn').addEventListener('click', toggleChat);

  // สลับตาราง <-> การ์ดเมื่อขนาดจอเปลี่ยน
  const onViewportChange = () => {
    if (state.credits.loaded) renderCredits();
    if (state.namelist.loaded) renderNameList();
  };
  if (isDesktop.addEventListener) isDesktop.addEventListener('change', onViewportChange);
  else isDesktop.addListener(onViewportChange);
}

// ==========================================
// เริ่มต้นระบบ
// ==========================================
function init() {
  wireEvents();

  // 1) แสดงรายการปีทันทีจากรายการล่าสุดที่จำไว้ในเครื่อง (ไม่มีก็สร้างจากปีปัจจุบัน) ไม่ต้องรอเครือข่าย
  const cachedYears = localCache.get('years');
  const initialYears = (cachedYears && Array.isArray(cachedYears.data) && cachedYears.data.length)
    ? cachedYears.data
    : buildFallbackYears();
  populateYearSelects(initialYears);
  const firstYear = pickDefaultYear(initialYears);
  $('year-select').value = firstYear;

  // 2) ดึงข้อมูลโครงการ และรายชื่อปีจริงจากชีต พร้อมกัน
  fetchCreditsData(firstYear);
  loadYears();
}

init();
