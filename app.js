/**
 * ==============================================================
 *  ระบบตรวจสอบหน่วยคะแนนการศึกษาต่อเนื่อง — Frontend (GitHub Pages)
 * ==============================================================
 *  ไฟล์นี้ดึงข้อมูลจาก Google Apps Script Web App (JSON API) ผ่าน fetch()
 *  แทนการใช้ google.script.run แบบเดิม (ซึ่งใช้ได้เฉพาะตอนรันบน Apps Script เท่านั้น)
 * ==============================================================
 */

// ⚠️ ต้องแก้ตรงนี้: ใส่ URL ของ Web App ที่ deploy จาก Google Apps Script (ลงท้ายด้วย /exec)
// วิธีหา: เปิดโปรเจกต์ Apps Script > Deploy > New deployment > Web app > คัดลอก URL
const API_BASE_URL = "https://script.google.com/macros/s/AKfycbzdyvOUsVK-S4XIz0QOk8WMC-K9K0hoRJy9oE5vZtBZqP6RQyLvFudpEwsdq6Qt2up8/exec";

// --- Global Variables ---
let allCreditsData = [];
let allNameListData = [];
let isNameListLoaded = false;

// ข้อมูลชุดล่าสุดที่แสดงอยู่บนจอ (หลังกรอง/จัดเรียงแล้ว) ใช้สำหรับปุ่ม Export CSV
let currentCreditsView = [];
let currentNameListView = [];

let sortState = {
    credits: { column: null, dir: 'asc' }, // dir: 'asc' (ก-ฮ) หรือ 'desc' (ฮ-ก)
    namelist: { column: null, dir: 'asc' }
};

// --- ป้องกัน XSS: escape ข้อความดิบก่อนแทรกลง innerHTML เสมอ ---
function esc(value) {
  const div = document.createElement('div');
  div.innerText = (value ?? '').toString();
  return div.innerHTML;
}

// --- เรียก API กลาง: คืนค่าเป็น Promise<{status, data|message}> เสมอ ---
async function callApi(action, params) {
  if (!API_BASE_URL || API_BASE_URL.includes('XXXXXXXX')) {
    document.getElementById('api-config-warning').classList.remove('hidden');
    return { status: 'error', message: 'ยังไม่ได้ตั้งค่า API_BASE_URL ในไฟล์ app.js' };
  }

  const url = new URL(API_BASE_URL);
  url.searchParams.set('action', action);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return { status: 'error', message: `เซิร์ฟเวอร์ตอบกลับผิดพลาด (HTTP ${res.status})` };
    }
    return await res.json();
  } catch (err) {
    return { status: 'error', message: 'เชื่อมต่อ API ไม่สำเร็จ: ' + err.toString() };
  }
}

// --- SORTING LOGIC (ฟังก์ชันจัดเรียง) ---
function sortTable(tableType, colIndex) {
    const data = tableType === 'credits' ? allCreditsData : allNameListData;
    const current = sortState[tableType];

    if (current.column === colIndex) {
        current.dir = current.dir === 'asc' ? 'desc' : 'asc';
    } else {
        current.column = colIndex;
        current.dir = 'asc';
    }

    data.sort((a, b) => {
        const valA = (a[colIndex] || "").toString();
        const valB = (b[colIndex] || "").toString();
        if (current.dir === 'asc') {
            return valA.localeCompare(valB, 'th');
        } else {
            return valB.localeCompare(valA, 'th');
        }
    });

    updateSortIcons(tableType, colIndex, current.dir);

    if (tableType === 'credits') {
        filterCreditsLocal();
    } else {
        filterNameListLocal();
    }
}

function updateSortIcons(tableType, colIndex, dir) {
    const allIcons = document.querySelectorAll(`[id^="sort-${tableType}-"]`);
    allIcons.forEach(icon => {
        icon.className = "fas fa-sort ml-1 opacity-50 text-xs";
    });

    const targetIcon = document.getElementById(`sort-${tableType}-${colIndex}`);
    if (targetIcon) {
        targetIcon.className = dir === 'asc'
            ? "fas fa-sort-up ml-1 opacity-100 text-sm text-yellow-300"
            : "fas fa-sort-down ml-1 opacity-100 text-sm text-yellow-300";
    }
}

// --- Tab Switching Script (จัดการเฉพาะสีและเงา) ---
function updateTabVisuals(activeId) {
   const tabCredits = document.getElementById('tab-credits');
   const tabNamelist = document.getElementById('tab-namelist');

   const activeStyle = ['bg-c-navy', 'border-c-main', 'text-white', 'shadow-xl', 'scale-[1.02]', 'ring-2', 'ring-offset-2', 'ring-c-navy', 'z-10'];
   const inactiveStyle = ['bg-white', 'border-gray-200', 'text-gray-400', 'hover:bg-white', 'hover:border-c-sky/50', 'hover:text-c-navy', 'hover:shadow-md'];

   tabCredits.classList.remove(...activeStyle, ...inactiveStyle);
   tabNamelist.classList.remove(...activeStyle, ...inactiveStyle);

   const iconCredits = tabCredits.querySelector('div:first-child');
   const textCreditsH3 = tabCredits.querySelector('h3');
   const textCreditsP = tabCredits.querySelector('p');

   const iconNamelist = tabNamelist.querySelector('div:first-child');
   const textNamelistH3 = tabNamelist.querySelector('h3');
   const textNamelistP = tabNamelist.querySelector('p');

   if (activeId === 'tab-credits') {
      tabCredits.classList.add(...activeStyle);
      tabCredits.setAttribute('aria-selected', 'true');
      iconCredits.className = "w-16 h-16 rounded-full flex items-center justify-center text-3xl transition-colors shadow-inner mb-1 bg-white/20 text-white";
      textCreditsH3.className = "text-lg md:text-xl font-bold leading-tight mb-2 text-white";
      textCreditsP.className = "text-sm font-light opacity-90 text-gray-200";

      tabNamelist.classList.add(...inactiveStyle);
      tabNamelist.setAttribute('aria-selected', 'false');
      iconNamelist.className = "w-16 h-16 rounded-full flex items-center justify-center text-3xl transition-colors shadow-inner mb-1 bg-gray-100 text-gray-400 group-hover:text-c-navy group-hover:bg-c-navy/10";
      textNamelistH3.className = "text-lg md:text-xl font-bold leading-tight mb-2 text-c-black group-hover:text-c-navy";
      textNamelistP.className = "text-sm font-light opacity-90 text-gray-500 group-hover:text-c-navy/70";

   } else {
      tabNamelist.classList.add(...activeStyle);
      tabNamelist.setAttribute('aria-selected', 'true');
      iconNamelist.className = "w-16 h-16 rounded-full flex items-center justify-center text-3xl transition-colors shadow-inner mb-1 bg-white/20 text-white";
      textNamelistH3.className = "text-lg md:text-xl font-bold leading-tight mb-2 text-white";
      textNamelistP.className = "text-sm font-light opacity-90 text-gray-200";

      tabCredits.classList.add(...inactiveStyle);
      tabCredits.setAttribute('aria-selected', 'false');
      iconCredits.className = "w-16 h-16 rounded-full flex items-center justify-center text-3xl transition-colors shadow-inner mb-1 bg-gray-100 text-gray-400 group-hover:text-c-navy group-hover:bg-c-navy/10";
      textCreditsH3.className = "text-lg md:text-xl font-bold leading-tight mb-2 text-c-black group-hover:text-c-navy";
      textCreditsP.className = "text-sm font-light opacity-90 text-gray-500 group-hover:text-c-navy/70";
   }
}

window.onload = function() {
    const currentYear = new Date().getFullYear() + 543;
    const yearSelect = document.getElementById('year-select');

    const optionExists = Array.from(yearSelect.options).some(opt => opt.value == currentYear.toString());
    if (optionExists) {
        yearSelect.value = currentYear.toString();
    }

    const defaultYear = yearSelect.value;
    fetchCreditsData(defaultYear);

    refreshYearDropdowns(currentYear);
};

async function refreshYearDropdowns(currentYear) {
  const response = await callApi('years');
  if (response.status !== 'success' || !response.data || response.data.length === 0) return;

  const years = response.data;
  const yearSelect = document.getElementById('year-select');
  const namelistSelect = document.getElementById('year-filter-namelist');
  const prevCreditsValue = yearSelect.value;
  const prevNamelistValue = namelistSelect.value;

  yearSelect.innerHTML = '<option value="">ทั้งหมด</option>' +
    years.map(y => `<option value="${esc(y)}">${esc(y)}</option>`).join('');

  const numericYears = years.filter(y => /^\d{4}$/.test(y));
  namelistSelect.innerHTML = '<option value="">ทั้งหมด</option>' +
    numericYears.map(y => `<option value="${esc(y)}">${esc(y)}</option>`).join('');

  if (Array.from(yearSelect.options).some(o => o.value === prevCreditsValue)) {
    yearSelect.value = prevCreditsValue;
  } else if (Array.from(yearSelect.options).some(o => o.value === currentYear.toString())) {
    yearSelect.value = currentYear.toString();
  }
  if (Array.from(namelistSelect.options).some(o => o.value === prevNamelistValue)) {
    namelistSelect.value = prevNamelistValue;
  }
}

function switchTab(tabName) {
  const creditsSec = document.getElementById('section-credits');
  const namelistSec = document.getElementById('section-namelist');

  if (tabName === 'searchCredits') {
    creditsSec.classList.remove('hidden');
    namelistSec.classList.add('hidden');
    updateTabVisuals('tab-credits');
  } else {
    creditsSec.classList.add('hidden');
    namelistSec.classList.remove('hidden');
    updateTabVisuals('tab-namelist');

    if (!isNameListLoaded) {
      fetchNameListData();
    }
  }
}

function clearKeyword(tableType) {
  const input = document.getElementById(`keyword-${tableType}`);
  input.value = '';
  input.focus();
  if (tableType === 'credits') {
    filterCreditsLocal();
  } else {
    filterNameListLocal();
  }
}

function toggleClearButton(tableType) {
  const input = document.getElementById(`keyword-${tableType}`);
  const clearBtn = document.getElementById(`clear-${tableType}-keyword`);
  clearBtn.classList.toggle('hidden', input.value.length === 0);
}

// --- Skeleton loading: แสดงแถบโครงร่างขณะรอข้อมูลจาก API ---
function showSkeleton(tableType, colCount) {
  const tbody = document.getElementById(`tbody-${tableType}`);
  const cards = document.getElementById(`cards-${tableType}`);
  const countLabel = document.getElementById(`${tableType}-count`);
  countLabel.textContent = 'กำลังโหลด...';

  let rowsHtml = '';
  for (let i = 0; i < 5; i++) {
    rowsHtml += '<tr>' + Array.from({length: colCount}).map(() =>
      `<td class="table-cell"><div class="skeleton-block h-4 w-full"></div></td>`
    ).join('') + '</tr>';
  }
  tbody.innerHTML = rowsHtml;

  let cardsHtml = '';
  for (let i = 0; i < 3; i++) {
    cardsHtml += `
      <div class="card-item">
        <div class="skeleton-block h-4 w-3/4 mb-2"></div>
        <div class="skeleton-block h-3 w-1/2"></div>
      </div>`;
  }
  cards.innerHTML = cardsHtml;
}

// --- CSV Export ---
function exportToCSV(tableType) {
  const data = tableType === 'credits' ? currentCreditsView : currentNameListView;
  if (!data || data.length === 0) {
    Swal.fire({ icon: 'info', title: 'ไม่มีข้อมูล', text: 'ยังไม่มีผลการค้นหาให้ดาวน์โหลด' });
    return;
  }

  const headers = tableType === 'credits'
    ? ['ชื่อหน่วยงาน', 'ชื่อโครงการ', 'วันที่จัด', 'คะแนน(ผู้เข้าอบรม) หมวด1', 'คะแนน(ผู้เข้าอบรม) หมวด2', 'วิทยากร/ผู้จัด', 'คะแนน(วิทยากร) หมวด1', 'คะแนน(วิทยากร) หมวด2', 'หมายเหตุ']
    : ['ปีที่จัด', 'ชื่อกิจกรรม/โครงการ', 'สถานะ/ลิงก์ไฟล์'];

  const csvRows = data.map(row => {
    const cells = tableType === 'credits'
      ? [row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]]
      : [row[0], row[2], row[5] || row[3] || ''];
    return cells.map(csvCell).join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(csvCell).join(','), ...csvRows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const fileName = (tableType === 'credits' ? 'หน่วยคะแนน_' : 'รายชื่อผู้เข้าอบรม_') +
    new Date().toISOString().slice(0, 10) + '.csv';

  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function csvCell(value) {
  const text = (value ?? '').toString().replace(/"/g, '""');
  return `"${text}"`;
}

// ==========================================
// LOGIC TAB 1: Credits
// ==========================================
async function fetchCreditsData(year) {
  allCreditsData = [];
  showSkeleton('credits', 7);

  const response = await callApi('credits', { year: year || '', keyword: '' });

  if (response.status === 'success') {
    allCreditsData = response.data;
    filterCreditsLocal();
  } else {
    showError(response.message);
    document.getElementById('credits-count').textContent = 'เกิดข้อผิดพลาด';
  }
}

function filterCreditsLocal() {
  toggleClearButton('credits');
  const keyword = document.getElementById('keyword-credits').value.toLowerCase();
  let filtered = allCreditsData;

  if (keyword) {
    filtered = allCreditsData.filter(row => {
        const org = (row[1] || "").toString().toLowerCase();
        const proj = (row[2] || "").toString().toLowerCase();
        return org.includes(keyword) || proj.includes(keyword);
    });
  }
  currentCreditsView = filtered;
  renderCreditsTable(filtered);
}

const formatMultiLine = (text, isScore = false) => {
   if (!text || text === '-') return isScore ? '' : '-';
   const lines = text.toString().split('\n');
   if (lines.length === 1) return esc(text);

   let html = '<ul class="list-none space-y-1">';
   lines.forEach(line => {
      if (line.trim() !== '') {
         if (isScore) {
           html += `<li class="h-6 flex items-center justify-center">${esc(line)}</li>`;
         } else {
           html += `<li class="flex items-start"><span class="mr-1.5 mt-1.5 w-1 h-1 rounded-full bg-c-navy shrink-0"></span><span>${esc(line)}</span></li>`;
         }
      }
   });
   html += '</ul>';
   return html;
};

// สร้างข้อมูล HTML ของแต่ละแถวครั้งเดียว แล้วใช้ร่วมกันทั้งมุมมองตารางและมุมมองการ์ด
function buildCreditsRowData(row) {
  const createScoreBadge = (value, type) => {
     if (!value || value === '-') return '';
     let bgClass = type === 1 ? 'bg-c-navy/10 text-c-navy border-c-navy/30 ring-1 ring-c-navy/10' : 'bg-c-red/10 text-c-red border-c-red/30 ring-1 ring-c-red/10';
     const label = `หมวด ${type}`;
     const formattedValue = formatMultiLine(value, true);

     return `
       <div class="flex flex-col items-center justify-center p-1.5 mb-1.5 rounded border ${bgClass} w-full shadow-sm min-h-[50px]">
         <span class="text-[9px] font-bold uppercase tracking-wider opacity-80 leading-none mb-1">${label}</span>
         <div class="font-bold text-sm leading-snug w-full text-center">${formattedValue}</div>
       </div>`;
  };

  const orgName = esc(row[1]);
  const projectName = esc(row[2]);
  const displayDate = formatMultiLine(row[3]);
  const participantScoreHtml = (!row[4] && !row[5]) ? '<div class="text-center text-gray-300">-</div>' : createScoreBadge(row[4], 1) + createScoreBadge(row[5], 2);

  const rawSpeakerName = row[6] || '';
  const speakerNameHtml = rawSpeakerName ? `<div class="font-bold text-c-black text-xs">${formatMultiLine(rawSpeakerName)}</div>` : '<div class="text-center text-gray-300">-</div>';

  const speakerScoreHtml = (!row[7] && !row[8]) ? '<div class="text-center text-gray-300">-</div>' : createScoreBadge(row[7], 1) + createScoreBadge(row[8], 2);

  let remarksRaw = row[9] || '-';
  let remarksHtml;
  if (remarksRaw.includes('เรียบร้อย') || remarksRaw.includes('นำเข้าแล้ว')) {
      remarksHtml = `<div class="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 px-2.5 py-1.5 rounded text-xs font-bold text-center border border-emerald-300 shadow-sm w-full justify-center"><i class="fas fa-check-circle"></i> ${esc(remarksRaw)}</div>`;
  } else if (remarksRaw.includes('อยู่ระหว่าง') || remarksRaw.includes('รอ') || remarksRaw.includes('กำลัง')) {
      remarksHtml = `<div class="inline-flex items-center gap-1.5 bg-amber-100 text-amber-800 px-2.5 py-1.5 rounded text-xs font-bold text-center border border-amber-300 shadow-sm w-full justify-center"><i class="fas fa-clock"></i> ${esc(remarksRaw)}</div>`;
  } else if (remarksRaw === '-') {
      remarksHtml = '<span class="text-gray-300">-</span>';
  } else {
      remarksHtml = `<span class="text-xs text-c-black">${formatMultiLine(remarksRaw)}</span>`;
  }

  return { orgName, projectName, displayDate, participantScoreHtml, speakerNameHtml, speakerScoreHtml, remarksHtml };
}

function renderCreditsTable(data) {
  const tbody = document.getElementById('tbody-credits');
  const cards = document.getElementById('cards-credits');
  const countLabel = document.getElementById('credits-count');
  tbody.innerHTML = '';
  cards.innerHTML = '';
  countLabel.textContent = `${data.length} รายการ`;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-12 text-gray-400 bg-gray-50 border-b border-gray-300">ไม่พบข้อมูลที่ค้นหา ลองเปลี่ยนคำค้นหาหรือปีที่จัดดูครับ</td></tr>`;
    cards.innerHTML = `<div class="text-center py-12 text-gray-400">ไม่พบข้อมูลที่ค้นหา ลองเปลี่ยนคำค้นหาหรือปีที่จัดดูครับ</div>`;
    return;
  }

  const rowsHtml = [];
  const cardsHtml = [];

  data.forEach((row) => {
    const d = buildCreditsRowData(row);

    rowsHtml.push(`
      <tr class="table-row">
        <td class="table-cell font-semibold text-c-black">${d.orgName}</td>
        <td class="table-cell font-medium text-c-navy">${d.projectName}</td>
        <td class="table-cell text-center text-xs text-gray-600 font-medium">${d.displayDate}</td>
        <td class="table-cell">${d.participantScoreHtml}</td>
        <td class="table-cell">${d.speakerNameHtml}</td>
        <td class="table-cell">${d.speakerScoreHtml}</td>
        <td class="table-cell">${d.remarksHtml}</td>
      </tr>`);

    cardsHtml.push(`
      <div class="card-item">
        <div class="text-xs font-bold text-c-navy/60 uppercase mb-1">${d.orgName}</div>
        <div class="font-bold text-c-navy mb-2">${d.projectName}</div>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <div>
            <div class="card-label">วันที่จัด</div>
            <div class="text-xs text-gray-700">${d.displayDate}</div>
          </div>
          <div>
            <div class="card-label">หมายเหตุ</div>
            <div>${d.remarksHtml}</div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <div class="card-label">คะแนน (ผู้เข้าอบรม)</div>
            ${d.participantScoreHtml}
          </div>
          <div>
            <div class="card-label">วิทยากร/ผู้จัด</div>
            ${d.speakerNameHtml}
            <div class="mt-1">${d.speakerScoreHtml}</div>
          </div>
        </div>
      </div>`);
  });

  tbody.innerHTML = rowsHtml.join('');
  cards.innerHTML = cardsHtml.join('');
}

// ==========================================
// LOGIC TAB 2: Name List
// ==========================================
async function fetchNameListData() {
  showSkeleton('namelist', 3);

  const response = await callApi('namelist', { keyword: '' });

  if (response.status === 'success') {
    allNameListData = response.data;
    allNameListData.reverse();
    isNameListLoaded = true;
    filterNameListLocal();
  } else {
    showError(response.message);
  }
}

function filterNameListLocal() {
  toggleClearButton('namelist');
  const keyword = document.getElementById('keyword-namelist').value.toLowerCase();
  const yearFilter = document.getElementById('year-filter-namelist').value;

  let filtered = allNameListData;
  if (yearFilter) {
     filtered = filtered.filter(row => row[0].toString() === yearFilter);
  }
  if (keyword) {
    filtered = filtered.filter(row => {
      const name = row[2].toString().toLowerCase();
      return name.includes(keyword);
    });
  }
  currentNameListView = filtered;
  renderNameTable(filtered);
}

function buildNameListRowData(row) {
  const textInColD = (row[3] || '').trim();
  const urlInColD = row[5];

  let statusActionHtml = '<span class="text-gray-300">-</span>';

  if (urlInColD || (textInColD.toLowerCase().startsWith('http') && textInColD.length > 10)) {
     const finalUrl = urlInColD || textInColD;
     statusActionHtml = `
       <a href="${esc(finalUrl)}" target="_blank" rel="noopener" class="inline-flex items-center px-4 py-2 bg-c-navy hover:bg-c-sky text-white text-xs font-bold rounded shadow-sm transition hover:-translate-y-0.5 w-full justify-center border border-c-black/20">
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

function renderNameTable(data) {
  const tbody = document.getElementById('tbody-namelist');
  const cards = document.getElementById('cards-namelist');
  const countLabel = document.getElementById('namelist-count');
  tbody.innerHTML = '';
  cards.innerHTML = '';
  countLabel.textContent = `แสดง ${data.length} รายการ`;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center py-12 text-gray-400 bg-gray-50 border-b border-gray-300">ไม่พบข้อมูลที่ค้นหา ลองเปลี่ยนคำค้นหาหรือปีที่จัดดูครับ</td></tr>`;
    cards.innerHTML = `<div class="text-center py-12 text-gray-400">ไม่พบข้อมูลที่ค้นหา ลองเปลี่ยนคำค้นหาหรือปีที่จัดดูครับ</div>`;
    return;
  }

  const rowsHtml = [];
  const cardsHtml = [];

  data.forEach((row) => {
    const d = buildNameListRowData(row);

    rowsHtml.push(`
      <tr class="table-row">
        <td class="table-cell text-center font-bold text-gray-600 bg-gray-50 align-middle">${d.year}</td>
        <td class="table-cell font-medium text-c-black align-middle py-4">${d.activity}</td>
        <td class="table-cell text-center align-middle">${d.statusActionHtml}</td>
      </tr>`);

    cardsHtml.push(`
      <div class="card-item">
        <div class="flex justify-between items-start gap-2 mb-2">
          <div class="font-bold text-c-black">${d.activity}</div>
          <span class="shrink-0 text-xs font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded">${d.year}</span>
        </div>
        <div>${d.statusActionHtml}</div>
      </div>`);
  });

  tbody.innerHTML = rowsHtml.join('');
  cards.innerHTML = cardsHtml.join('');
}

function showError(err) {
  Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: (err && err.message) ? err.message : (err ? err.toString() : 'ไม่ทราบสาเหตุ') });
}

// --- ปุ่มเปิด-ปิดแชท ---
function toggleChat() {
  const chat = document.getElementById("aiChatFrame");
  const btn = document.getElementById("aiChatBtn");

  if (chat.style.display === "none" || chat.style.display === "") {
    chat.style.display = "block";
    btn.innerHTML = "❌ ปิดหน้าต่างแชท";
    btn.style.background = "#E61C2A";
  } else {
    chat.style.display = "none";
    btn.innerHTML = "💬 คุยกับผู้ช่วยสภาฯ AI";
    btn.style.background = "#1C3868";
  }
}
