// ==========================================
//  scripts.js — Stock Manager v3
//  Frontend Logic — GitHub Pages Version
// ==========================================

// ── GAS URL — ใส่ URL ของ GAS Web App ที่นี่ ───────────────────
var GAS_URL = 'https://script.google.com/macros/s/AKfycbydi-JmXVn6_wTlsa1i8AK5he8qxW_Q4z54fOYXytLYsAoZt8Qnd4KHW3nUFJScJMDf/exec';
var ZXING_SCRIPT_URL = 'https://unpkg.com/@zxing/library@latest/umd/index.min.js';
var ZXING_SCRIPT_ID  = 'zxing-library-script';
var APP_CACHE_KEY    = 'stock-manager-v3-cache-v2';
var APP_CACHE_TTL_MS = 5 * 60 * 1000;

// ── callGAS: แทน google.script.run ─────────────────────────────
function callGAS(action, params) {
  var body = Object.assign({ action: action }, params || {});
  
  // สำหรับการดึงข้อมูล (GET) ให้ใช้ JSONP เพื่อเลี่ยง CORS
  if (action === 'getAllSheetData') {
    return new Promise(function(resolve, reject) {
      var callbackName = 'jsonp_cb_' + Math.round(100000 * Math.random());
      var script = document.createElement('script');
      window[callbackName] = function(data) {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(JSON.stringify(data));
      };
      
      script.src = GAS_URL + '?action=' + action + '&callback=' + callbackName + '&_t=' + new Date().getTime();
      script.onerror = function() {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('JSONP load error (ตรวจสอบการ Deploy GAS เป็น "Anyone")'));
      };
      document.head.appendChild(script);
    });
  }

  // สำหรับการบันทึกข้อมูล (POST) ใช้ fetch (no-cors)
  return fetch(GAS_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  }).then(function() {
    // no-cors ไม่เห็น response — สมมติว่าสำเร็จถ้าไม่ error
    return JSON.stringify({ success: true });
  });
}

// ── Constants ───────────────────────────────────────────────────
var AGING_TAB    = 'Aging';
var OVERVIEW_TAB = '__OVERVIEW__';
var CHUNK_SIZE   = 15;

// ── State ────────────────────────────────────────────────────────
var state = {
  allData:     {},
  current:     AGING_TAB,
  subTab:      'All',
  search:      '',
  reorderMode: false,
  sheetNames:  []
};
var _dataRequestId    = 0;
var _zxingLoadPromise = null;

// ── Lot Sort ─────────────────────────────────────────────────────
function parseDateStr(s) {
  if (!s) return 0;
  var p = s.split('/');
  if (p.length !== 3) return 0;
  var y = parseInt(p[2], 10); if (y < 100) y += 2000;
  return new Date(y, parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime();
}

function sortLots(lots) {
  var hasVal = lots.filter(function(v) { return v !== ''; });
  var empty  = lots.filter(function(v) { return v === ''; });
  hasVal.sort(function(a, b) { return parseDateStr(a) - parseDateStr(b); });
  return hasVal.concat(empty);
}

// ── Search ───────────────────────────────────────────────────────
function toggleClearBtn(val) {
  var btn = document.getElementById('clearSearchBtn');
  if (btn) btn.classList.toggle('hidden', !val);
}

function clearSearch() {
  var inp = document.getElementById('search-input');
  if (inp) inp.value = '';
  toggleClearBtn('');
  state.search = '';
  renderList();
}

function readAppCache() {
  try {
    var raw = window.localStorage ? localStorage.getItem(APP_CACHE_KEY) : '';
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !parsed.data || !Array.isArray(parsed.sheetNames)) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function writeAppCache(data, sheetNames) {
  try {
    if (!window.localStorage) return;
    localStorage.setItem(APP_CACHE_KEY, JSON.stringify({
      cachedAt: Date.now(),
      data: data || {},
      sheetNames: sheetNames || []
    }));
  } catch (err) {}
}

function applyDataSnapshot(data, sheetNames) {
  state.allData = data || {};
  state.sheetNames = Array.isArray(sheetNames) ? sheetNames : [];
  if (state.subTab !== 'All' && state.subTab !== 'Favorite' && state.sheetNames.indexOf(state.subTab) === -1) {
    state.subTab = 'All';
  }
  renderSubTabs();
  populateSheetSelect();
  renderList();
}

function hydrateFromCache() {
  var cache = readAppCache();
  if (!cache) return false;
  applyDataSnapshot(cache.data, cache.sheetNames);
  var age = Date.now() - Number(cache.cachedAt || 0);
  var statsEl = document.getElementById('stats-text');
  if (statsEl && age > APP_CACHE_TTL_MS) {
    statsEl.textContent = statsEl.textContent + ' • กำลังอัปเดต';
  }
  return true;
}

// ── Render ───────────────────────────────────────────────────────
var _renderChunkTimer = null;

function renderList() {
  if (_renderChunkTimer) clearTimeout(_renderChunkTimer);
  var list      = document.getElementById('product-list');
  var emptyEl   = document.getElementById('empty-state');
  var statsEl   = document.getElementById('stats-text');
  var products  = getFiltered();

  list.innerHTML = '';
  if (emptyEl) { emptyEl.classList.add('hidden'); emptyEl.classList.remove('flex'); }

  if (!products.length) {
    if (emptyEl) { emptyEl.classList.remove('hidden'); emptyEl.classList.add('flex'); }
    if (statsEl) statsEl.textContent = 'ไม่พบสินค้า';
    return;
  }

  if (statsEl) statsEl.textContent = products.length + ' รายการ';

  var idx = 0;
  function renderChunk() {
    var frag = document.createDocumentFragment();
    var end  = Math.min(idx + CHUNK_SIZE, products.length);
    for (; idx < end; idx++) {
      var el = document.createElement('div');
      if (state.current === OVERVIEW_TAB) {
        el.innerHTML = buildOverviewCard(products[idx]);
      } else {
        el.innerHTML = buildCard(products[idx]);
      }
      applySelects(el);
      frag.appendChild(el.firstElementChild);
    }
    list.appendChild(frag);
    if (idx < products.length) {
      _renderChunkTimer = setTimeout(renderChunk, 16);
    }
  }
  renderChunk();
}

// ── Overview Card ────────────────────────────────────────────────
function buildOverviewCard(p) {
  var name = String(p.name || '');
  var bc   = String(p.barcode || '');
  var sz   = String(p.size || '');
  var sn   = p.sheetName || '';
  var u    = uid(sn, p.rowIndex);
  var lots = [p.lot1, p.lot2, p.lot3, p.lot4].filter(Boolean);
  var lotsHtml = lots.length
    ? lots.map(function(l) { return '<span class="font-mono text-[11px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">' + ea(l) + '</span>'; }).join('')
    : '<span class="text-[11px] text-slate-300 font-medium">ยังไม่มี Lot</span>';

  return '<div class="bg-white rounded-3xl border border-slate-200/60 shadow-sm overflow-hidden p-4 space-y-2">' +
    '<div class="flex items-center justify-between gap-2">' +
      '<div class="flex-1 min-w-0">' +
        '<p class="font-black text-slate-800 text-sm leading-tight truncate">' + ea(name) + '</p>' +
        '<div class="flex flex-wrap items-center gap-1.5 mt-1">' +
          '<span class="font-mono text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">' + ea(bc || 'NO SKU') + '</span>' +
          (sz ? '<span class="text-[11px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">' + ea(sz) + '</span>' : '') +
          '<span class="text-[11px] font-bold text-slate-300 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">' + ea(sn) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="text-right flex-shrink-0">' +
        '<p class="text-xs text-slate-400 font-medium">OH</p>' +
        '<p class="font-black text-blue-600 text-lg" id="ovoh_' + u + '">' + ea(p.oh || '0') + '</p>' +
        '<p class="text-[9px] text-slate-300 font-medium" id="ovohtime_' + u + '">' + ea(p.ohTime || '') + '</p>' +
      '</div>' +
    '</div>' +
    '<div class="flex flex-wrap gap-1">' + lotsHtml + '</div>' +
    '<div class="flex items-center justify-between">' +
      '<span class="timestamp-label">' + (p.ohTime  ? 'OH Update: '  + p.ohTime  : '') + '</span>' +
      '<span class="timestamp-label">' + (p.lotTime ? 'Lot Update: ' + p.lotTime : '') + '</span>' +
    '</div>' +
  '</div>';
}

// ── Product Card ─────────────────────────────────────────────────
function buildCard(p) {
  var name = String(p.name || '');
  var bc   = String(p.barcode || '');
  var sz   = String(p.size || '');
  var sn   = p.sheetName || state.current;
  var u    = uid(sn, p.rowIndex);
  var hasBc = bc.length >= 8;

  var lv = [p.lot1, p.lot2, p.lot3, p.lot4];
  var lotPickerHtml = '';
  for (var n = 1; n <= 4; n++) {
    lotPickerHtml += '<div class="space-y-1.5">' +
      '<label class="text-[10px] font-black text-slate-400 uppercase px-1">Lot ' + n + '</label>' +
      buildLotPicker(u, n, lv[n-1] || '') +
    '</div>';
  }

  var isFav   = p.fav === true;
  var favBtn  = buildStarBtn(u, sn, p.rowIndex, isFav);
  var actionBtns = '';

  if (state.reorderMode && state.current === AGING_TAB && state.subTab === 'All') {
    actionBtns =
      '<button onclick="' + bh('moveProduct',[u,-1]) + '" class="w-10 h-10 flex items-center justify-center rounded-2xl bg-blue-100 text-blue-700 active:scale-90 transition-all"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7"/></svg></button>' +
      '<button onclick="' + bh('moveProduct',[u,1])  + '" class="w-10 h-10 flex items-center justify-center rounded-2xl bg-blue-100 text-blue-700 active:scale-90 transition-all"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/></svg></button>';
  } else {
    var gearBtn = '<button onclick="' + bh('toggleEdit',[u]) + '" class="icon-btn w-10 h-10 flex items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-all duration-200 active:scale-90" id="gear_' + u + '">' +
      '<svg class="w-5 h-5 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>' +
    '</button>';
    var barcodeBtn = '<button onclick="' + bh('openBc',[name,bc]) + '" ' + (hasBc ? '' : 'disabled') + ' class="w-10 h-10 flex items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-all duration-200 active:scale-90 ' + (hasBc ? 'hover:bg-slate-50 hover:text-blue-600' : 'opacity-30 cursor-not-allowed') + '">' +
      '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg>' +
    '</button>';
    actionBtns = gearBtn + barcodeBtn;
  }

  return '<div class="bg-white rounded-3xl border border-slate-200/60 shadow-sm overflow-hidden">' +
    '<div class="p-6 space-y-4">' +
      '<div class="flex justify-between items-start gap-4">' +
        '<div class="flex-1 min-w-0">' +
          '<h3 class="text-lg font-black text-slate-800 leading-tight" id="title_' + u + '">' + (name || '-') + '</h3>' +
          '<div class="flex flex-wrap items-center gap-2 mt-2">' +
            '<span class="font-mono text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100" id="skudisplay_' + u + '">' + (bc || 'NO SKU') + '</span>' +
            (sz ? '<span class="text-[11px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">' + sz + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="flex gap-2">' + favBtn + actionBtns + '</div>' +
      '</div>' +

      '<div id="edit_' + u + '" class="hidden space-y-4 pt-4 border-t border-slate-100">' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<div class="space-y-1.5">' +
            '<label class="text-[10px] font-black text-slate-400 uppercase px-1">SKU / Barcode</label>' +
            '<input class="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm outline-none focus:bg-white focus:border-blue-500" id="sku_' + u + '" value="' + ea(bc) + '" placeholder="กรอก SKU"/>' +
          '</div>' +
          '<div class="space-y-1.5">' +
            '<label class="text-[10px] font-black text-slate-400 uppercase px-1">ชื่อสินค้า</label>' +
            '<input class="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm outline-none focus:bg-white focus:border-blue-500" id="name_' + u + '" value="' + ea(name) + '" placeholder="กรอกชื่อสินค้า"/>' +
          '</div>' +
        '</div>' +
        '<div class="flex gap-3">' +
          '<button class="px-4 py-3 rounded-2xl bg-rose-50 text-rose-600 text-sm font-bold active:scale-95 transition-all flex-1" onclick="' + bh('cancelEdit',[u,bc,name]) + '">ยกเลิก</button>' +
          '<button class="px-4 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all flex-[2]" id="editbtn_' + u + '" onclick="' + bh('saveProduct',[sn,p.rowIndex,u]) + '">บันทึกข้อมูลสินค้า</button>' +
        '</div>' +
      '</div>' +

      '<div class="space-y-6">' +
        '<div class="bg-blue-50/50 p-5 rounded-[24px] border border-blue-100/50 space-y-3">' +
          '<div class="flex items-center justify-between">' +
            '<label class="text-[10px] font-black text-blue-600 uppercase tracking-widest px-1">สต็อกปัจจุบัน (OH)</label>' +
            '<span class="timestamp-label" id="ohtime_' + u + '">' + (p.ohTime ? 'อัปเดต: ' + p.ohTime : '') + '</span>' +
          '</div>' +
          '<div class="flex gap-3">' +
            '<input type="number" inputmode="numeric" class="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm outline-none focus:border-blue-500 font-black text-lg text-blue-700" id="oh_' + u + '" value="' + ea(p.oh) + '"/>' +
            '<button class="px-6 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all" id="ohbtn_' + u + '" onclick="' + bh('saveOh',[sn,p.rowIndex,u]) + '">บันทึก OH</button>' +
          '</div>' +
        '</div>' +

        '<div class="space-y-4">' +
          '<div class="flex items-center justify-between">' +
            '<label class="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">จัดการ Lot สินค้า</label>' +
            '<span class="timestamp-label" id="lottime_' + u + '">' + (p.lotTime ? 'อัปเดต: ' + p.lotTime : '') + '</span>' +
          '</div>' +
          '<div class="grid grid-cols-1 gap-3">' + lotPickerHtml + '</div>' +
          '<div class="flex gap-3 pt-2">' +
            '<button class="px-4 py-3 rounded-2xl bg-rose-50 text-rose-600 text-sm font-bold active:scale-95 transition-all flex-1" id="clearbtn_' + u + '" onclick="' + bh('clearLot',[sn,p.rowIndex,u]) + '">ล้าง Lot</button>' +
            '<button class="px-4 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all flex-[2]" id="savebtn_' + u + '" onclick="' + bh('saveLot',[sn,p.rowIndex,u]) + '">บันทึก Lot</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ── Toast ─────────────────────────────────────────────────────────
var _toastTimer = null;
function showToast(msg, isError) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] px-6 py-3.5 rounded-2xl text-white text-sm font-bold shadow-2xl transition-all duration-500 opacity-100 translate-y-0 ' + (isError ? 'bg-rose-600' : 'bg-slate-900');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() {
    el.classList.replace('opacity-100', 'opacity-0');
    el.classList.replace('translate-y-0', 'translate-y-10');
  }, 3000);
}

// ── Tab Logic ────────────────────────────────────────────────────
function switchTab(name, btn) {
  state.current = name;
  state.search  = '';
  document.getElementById('search-input').value = '';
  toggleClearBtn('');
  updatePlaceholder();
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var subContainer = document.getElementById('subtabs-container');
  if (name === AGING_TAB) {
    subContainer.classList.remove('hidden'); subContainer.classList.add('flex');
    var targetSub = Array.from(subContainer.querySelectorAll('.subtab-btn')).find(function(b) { return b.textContent.trim() === state.subTab; });
    if (targetSub) switchSubTab(state.subTab, targetSub);
    else { var firstSub = subContainer.querySelector('.subtab-btn'); if (firstSub) switchSubTab(firstSub.textContent.trim(), firstSub); }
  } else {
    subContainer.classList.remove('flex'); subContainer.classList.add('hidden');
    renderList();
  }
  if (name === OVERVIEW_TAB) {
    state.reorderMode = false;
    var reorderBtn = document.getElementById('reorder-btn');
    if (reorderBtn) { reorderBtn.classList.replace('bg-blue-600','bg-slate-100'); reorderBtn.classList.replace('text-white','text-slate-500'); }
  }
  document.getElementById('scroll-container').scrollTop = 0;
}

function switchSubTab(name, btn) {
  state.subTab = name;
  document.querySelectorAll('.subtab-btn').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  var reorderBtn = document.getElementById('reorder-btn');
  if (reorderBtn) {
    if (name === 'All') reorderBtn.classList.remove('hidden');
    else { reorderBtn.classList.add('hidden'); state.reorderMode = false; reorderBtn.classList.replace('bg-blue-600','bg-slate-100'); reorderBtn.classList.replace('text-white','text-slate-500'); }
  }
  document.getElementById('scroll-container').scrollTop = 0;
  renderList();
}

function syncActiveSubTab() {
  var container = document.getElementById('subtabs-container');
  if (!container) return;
  container.querySelectorAll('.subtab-btn').forEach(function(b) { b.classList.toggle('active', b.textContent.trim() === state.subTab); });
}

var _searchTimer = null;
function onSearch() {
  var val = document.getElementById('search-input').value;
  if (_searchTimer) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() { state.search = val; renderList(); }, 200);
}

function updatePlaceholder() {
  var el = document.getElementById('search-input');
  if (!el) return;
  el.placeholder = state.current === OVERVIEW_TAB ? 'ค้นหาทุกสินค้า...' : 'ค้นหาใน ' + state.subTab + '...';
}

// ── Data Helpers ─────────────────────────────────────────────────
function getCurrentProducts() {
  var mainSheets = state.sheetNames.length ? state.sheetNames : ['Oishi', 'Est', 'F&N'];
  if (state.current === AGING_TAB) {
    if (state.subTab === 'Favorite') {
      var outFav = [];
      for (var i = 0; i < mainSheets.length; i++) {
        var rows = state.allData[mainSheets[i]] || [];
        for (var j = 0; j < rows.length; j++) { var p = rows[j]; if (!p.sheetName) p.sheetName = mainSheets[i]; if (p.fav === true) outFav.push(p); }
      }
      outFav.sort(function(a, b) { return (b.favTime || 0) - (a.favTime || 0); });
      return outFav;
    }
    return state.allData[state.subTab] || [];
  }
  var out = [];
  for (var i = 0; i < mainSheets.length; i++) {
    var sn = mainSheets[i];
    var rows = state.allData[sn] || [];
    for (var j = 0; j < rows.length; j++) { var p = rows[j]; if (!p.sheetName) p.sheetName = sn; out.push(p); }
  }
  return out;
}

function norm(v) { return String(v || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function matches(p, q) {
  var n = norm(q); if (!n) return true;
  var terms = n.split(' ');
  var hay = norm((p.sheetName||'') + ' ' + (p.name||'') + ' ' + (p.barcode||'') + ' ' + (p.size||'') + ' ' + (p.lot1||'') + ' ' + (p.lot2||'') + ' ' + (p.lot3||'') + ' ' + (p.lot4||'') + ' ' + (p.oh||''));
  return terms.every(function(term) { return hay.indexOf(term) !== -1; });
}
function getFiltered() {
  var products = getCurrentProducts();
  if (!norm(state.search)) return products;
  return products.filter(function(p) { return matches(p, state.search); });
}

// ── Utils ─────────────────────────────────────────────────────────
function pad2(v) { return String(v).padStart(2, '0'); }
function ea(v)   { return String(v || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function ja(v)   { if (typeof v === 'boolean') return String(v); return typeof v === 'number' ? String(v) : JSON.stringify(String(v == null ? '' : v)); }
function bh(name, args) { return ea(name + '(' + args.map(ja).join(',') + ')'); }
function uid(sn, ri) { return String(sn || '').replace(/[^a-zA-Z0-9]/g, function(c) { return '_' + c.charCodeAt(0).toString(16); }) + '_' + ri; }

function buildStarBtn(u, sn, ri, isFav) {
  var borderCls  = isFav ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white';
  var onclick    = bh('handleFavoriteClick', [sn, ri, isFav ? true : false, u]);
  var svgContent = isFav
    ? '<path d="M5 3h14a1 1 0 0 1 1 1v17l-7-3.5L6 21V4a1 1 0 0 1 1-1z" fill="#f59e0b" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M5 3h14a1 1 0 0 1 1 1v17l-7-3.5L6 21V4a1 1 0 0 1 1-1z" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  return '<button id="starbtn_' + u + '" onclick="' + onclick + '" class="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-2xl border ' + borderCls + ' transition-all duration-200 active:scale-90" aria-label="Favorite"><svg class="w-5 h-5" viewBox="0 0 24 24">' + svgContent + '</svg></button>';
}

// ── Lot Picker ────────────────────────────────────────────────────
var _dayOpts = null, _monthOpts = null, _yearOpts = null, _yearBase = 0;
function getDayOpts()   { if (_dayOpts) return _dayOpts; var h = '<option value="">วว</option>'; for (var i=1;i<=31;i++){var v=pad2(i);h+='<option value="'+v+'">'+v+'</option>';}return (_dayOpts=h); }
function getMonthOpts() { if (_monthOpts) return _monthOpts; var h = '<option value="">ดด</option>'; for (var i=1;i<=12;i++){var v=pad2(i);h+='<option value="'+v+'">'+v+'</option>';}return (_monthOpts=h); }
function getYearOpts()  { var now=new Date().getFullYear(); if (_yearOpts&&_yearBase===now) return _yearOpts; _yearBase=now; var h='<option value="">ค.ศ.</option>'; for(var y=now-2;y<=now+5;y++) h+='<option value="'+y+'">'+y+'</option>'; return (_yearOpts=h); }

function parseLot(v) {
  var t = String(v || '').trim(); if (!t) return null;
  var m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { var y=parseInt(m[3],10); if(m[3].length===2)y+=2000; if(y>2400)y-=543; return {day:pad2(m[1]),month:pad2(m[2]),year:String(y)}; }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return {day:pad2(m[3]),month:pad2(m[2]),year:m[1]};
  return null;
}

function buildLotPicker(u, n, val) {
  var p = parseLot(val) || {};
  var id = 'lot_' + u + '_' + n;
  return '<div class="space-y-1" id="' + id + '">' +
    '<div class="flex gap-1">' +
      '<select class="lot-select flex-1 min-w-0 px-1 py-2.5 text-sm font-semibold bg-white rounded-xl border border-slate-200 outline-none text-center" id="' + id + '_d" data-v="' + ea(p.day||'') + '">' + getDayOpts() + '</select>' +
      '<select class="lot-select flex-1 min-w-0 px-1 py-2.5 text-sm font-semibold bg-white rounded-xl border border-slate-200 outline-none text-center" id="' + id + '_m" data-v="' + ea(p.month||'') + '">' + getMonthOpts() + '</select>' +
      '<select class="lot-select flex-[1.4] min-w-0 px-1 py-2.5 text-sm font-semibold bg-white rounded-xl border border-slate-200 outline-none text-center" id="' + id + '_y" data-v="' + ea(p.year||'') + '">' + getYearOpts() + '</select>' +
    '</div>' +
  '</div>';
}

function applySelects(root) {
  var scope = root || document;
  var sels = scope.querySelectorAll('.lot-select[data-v]');
  for (var i = 0; i < sels.length; i++) {
    var sel = sels[i];
    sel.value = sel.getAttribute('data-v') || '';
    sel.removeAttribute('data-v');
  }
}

function readLot(u, n) {
  var id = 'lot_' + u + '_' + n;
  var d = document.getElementById(id+'_d').value;
  var m = document.getElementById(id+'_m').value;
  var y = document.getElementById(id+'_y').value;
  if (!d && !m && !y) return '';
  if (!d || !m || !y) return null;
  return d + '/' + m + '/' + pad2(parseInt(y, 10) % 100);
}

function setAllLots(u, lots) {
  for (var i = 1; i <= 4; i++) {
    var p = parseLot(lots[i-1] || '') || {};
    var id = 'lot_' + u + '_' + i;
    document.getElementById(id+'_d').value = p.day   || '';
    document.getElementById(id+'_m').value = p.month || '';
    document.getElementById(id+'_y').value = p.year  || '';
  }
}

// ── State Sync ───────────────────────────────────────────────────
function getRow(sn, ri) { var rows = state.allData[sn] || []; for (var i=0;i<rows.length;i++){if(rows[i].rowIndex===ri)return rows[i];}return null; }

function syncData(p, oldB, oldN) {
  var b = oldB || p.barcode, n = oldN || p.name;
  var names = Object.keys(state.allData);
  for (var i=0;i<names.length;i++){ var sn=names[i]; var rows=state.allData[sn]; for(var j=0;j<rows.length;j++){var r=rows[j]; if(r===p)continue; if(r.barcode===b&&r.name===n){Object.assign(r,{barcode:p.barcode,name:p.name,oh:p.oh,lot1:p.lot1,lot2:p.lot2,lot3:p.lot3,lot4:p.lot4,ohTime:p.ohTime,lotTime:p.lotTime});}}}
}

function updLots(sn,ri,lots,lotTime){var r=getRow(sn,ri);if(r){Object.assign(r,{lot1:lots[0]||'',lot2:lots[1]||'',lot3:lots[2]||'',lot4:lots[3]||'',lotTime:lotTime||''});syncData(r);}}
function updOh(sn,ri,oh,ohTime){var r=getRow(sn,ri);if(r){r.oh=oh||'';r.ohTime=ohTime||'';syncData(r);}}
function updProd(sn,ri,sku,name){var r=getRow(sn,ri);if(r){var ob=r.barcode,on=r.name;Object.assign(r,{barcode:sku||'',name:name||''});syncData(r,ob,on);}}
function patchOh(u,oh,ohTime){var el=document.getElementById('ovoh_'+u);if(el)el.textContent=oh||'0';var tel=document.getElementById('ohtime_'+u);if(tel)tel.textContent=ohTime?'อัปเดต: '+ohTime:'';var ovtel=document.getElementById('ovohtime_'+u);if(ovtel)ovtel.textContent=ohTime||'';}
function patchLotTime(u,lotTime){var tel=document.getElementById('lottime_'+u);if(tel)tel.textContent=lotTime?'อัปเดต: '+lotTime:'';}
function patchProd(u,sku,name){var t=document.getElementById('title_'+u);if(t)t.textContent=name||'-';var s=document.getElementById('skudisplay_'+u);if(s)s.textContent=sku||'NO SKU';}

// ── Actions ───────────────────────────────────────────────────────
function toggleEdit(u) {
  var panel = document.getElementById('edit_' + u);
  var gear  = document.getElementById('gear_' + u);
  if (!panel) return;
  var isOpening = panel.classList.contains('hidden');
  document.querySelectorAll('[id^="edit_"]').forEach(function(p) { p.classList.add('hidden'); });
  document.querySelectorAll('.icon-btn').forEach(function(g)  { g.classList.remove('active'); });
  if (isOpening) { panel.classList.remove('hidden'); gear.classList.add('active'); var ni=document.getElementById('name_'+u);if(ni)ni.focus(); }
}

function cancelEdit(u, sku, name) {
  var si = document.getElementById('sku_'  + u); if (si) si.value = sku  || '';
  var ni = document.getElementById('name_' + u); if (ni) ni.value = name || '';
  toggleEdit(u);
}

function saveProduct(sn, ri, u) {
  var btn  = document.getElementById('editbtn_' + u);
  var sku  = document.getElementById('sku_'  + u).value.trim();
  var name = document.getElementById('name_' + u).value.trim();
  if (!name) { showToast('กรุณากรอกชื่อสินค้า', true); return; }

  var r = getRow(sn, ri);
  var prevSku = r ? r.barcode : '', prevName = r ? r.name : '';
  updProd(sn, ri, sku, name); patchProd(u, sku, name);
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';

  callGAS('saveProductData', { sheet: sn, row: ri, sku: sku, name: name })
    .then(function(raw) {
      var res = JSON.parse(raw);
      btn.disabled = false;
      if (res.success) { showToast('บันทึกสำเร็จ ✓'); setTimeout(function() { toggleEdit(u); btn.textContent = 'บันทึกข้อมูลสินค้า'; }, 500); }
      else { updProd(sn,ri,prevSku,prevName); patchProd(u,prevSku,prevName); showToast('ผิดพลาด: '+res.error,true); }
    })
    .catch(function(err) { updProd(sn,ri,prevSku,prevName); patchProd(u,prevSku,prevName); btn.disabled=false; btn.textContent='บันทึกข้อมูลสินค้า'; showToast('ผิดพลาด: '+(err.message||'Unknown'),true); });
}

function saveLot(sn, ri, u) {
  var btn = document.getElementById('savebtn_' + u);
  var lots = [];
  for (var i = 1; i <= 4; i++) { var v = readLot(u, i); if (v === null) { showToast('Lot '+i+' ไม่ถูกต้อง', true); return; } lots.push(v); }
  lots = sortLots(lots);
  var r = getRow(sn, ri);
  var prevLots = r ? [r.lot1,r.lot2,r.lot3,r.lot4] : ['','','',''];
  var prevTime = r ? r.lotTime : '';
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';

  callGAS('saveLotData', { sheet: sn, row: ri, l1: lots[0], l2: lots[1], l3: lots[2], l4: lots[3] })
    .then(function(raw) {
      var res = JSON.parse(raw);
      btn.disabled = false; btn.textContent = 'บันทึก Lot';
      if (res.success) { updLots(sn,ri,lots,res.lotTime); patchLotTime(u,res.lotTime); showToast('บันทึก Lot สำเร็จ ✓'); renderList(); }
      else { updLots(sn,ri,prevLots,prevTime); showToast('ผิดพลาด: '+res.error,true); }
    })
    .catch(function(err) { updLots(sn,ri,prevLots,prevTime); btn.disabled=false; btn.textContent='บันทึก Lot'; showToast('ผิดพลาด: '+(err.message||'Unknown'),true); });
}

function saveOh(sn, ri, u) {
  var btn = document.getElementById('ohbtn_' + u);
  var oh  = document.getElementById('oh_'    + u).value.trim();
  if (oh !== '' && parseFloat(oh) < 0) { showToast('ห้ามติดลบ', true); return; }
  var r = getRow(sn, ri);
  var prevOh = r ? r.oh : '', prevTime = r ? r.ohTime : '';
  btn.disabled = true; btn.textContent = '...';

  callGAS('saveOhData', { sheet: sn, row: ri, oh: oh })
    .then(function(raw) {
      var res = JSON.parse(raw);
      btn.disabled = false; btn.textContent = 'บันทึก';
      if (res.success) { updOh(sn,ri,oh,res.ohTime); patchOh(u,oh,res.ohTime); showToast('บันทึก OH สำเร็จ ✓'); }
      else { updOh(sn,ri,prevOh,prevTime); patchOh(u,prevOh,prevTime); showToast('ผิดพลาด: '+res.error,true); }
    })
    .catch(function(err) { updOh(sn,ri,prevOh,prevTime); patchOh(u,prevOh,prevTime); btn.disabled=false; btn.textContent='บันทึก'; showToast('ผิดพลาด: '+(err.message||'Unknown'),true); });
}

function clearLot(sn, ri, u) {
  if (!confirm('ยืนยันล้างข้อมูล Lot ทั้งหมด?')) return;
  var btn = document.getElementById('clearbtn_' + u);
  var r = getRow(sn, ri);
  var prevLots = r ? [r.lot1,r.lot2,r.lot3,r.lot4] : ['','','',''];
  var prevTime = r ? r.lotTime : '';
  var empty = ['','','',''];
  btn.disabled = true; btn.textContent = '...';

  callGAS('clearLotData', { sheet: sn, row: ri })
    .then(function(raw) {
      var res = JSON.parse(raw);
      btn.disabled = false; btn.textContent = 'ล้าง Lot';
      if (res.success) { setAllLots(u,empty); updLots(sn,ri,empty,res.lotTime); patchLotTime(u,res.lotTime); showToast('ล้างข้อมูลสำเร็จ ✓'); renderList(); }
      else { setAllLots(u,prevLots); updLots(sn,ri,prevLots,prevTime); showToast('ผิดพลาด: '+res.error,true); }
    })
    .catch(function(err) { setAllLots(u,prevLots); updLots(sn,ri,prevLots,prevTime); btn.disabled=false; btn.textContent='ล้าง Lot'; showToast('ผิดพลาด: '+(err.message||'Unknown'),true); });
}

// ── Favorite ─────────────────────────────────────────────────────
function handleFavoriteClick(sn, ri, currentFav, u) {
  var r = getRow(sn, ri); if (!r) return;
  var newFav = !currentFav;
  r.fav = newFav;
  var btn = document.getElementById('starbtn_' + u);
  if (btn) {
    btn.className = 'w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-2xl border transition-all duration-200 active:scale-90 ' + (newFav ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white');
    btn.innerHTML = '<svg class="w-5 h-5" viewBox="0 0 24 24">' + (newFav ? '<path d="M5 3h14a1 1 0 0 1 1 1v17l-7-3.5L6 21V4a1 1 0 0 1 1-1z" fill="#f59e0b" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M5 3h14a1 1 0 0 1 1 1v17l-7-3.5L6 21V4a1 1 0 0 1 1-1z" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>') + '</svg>';
  }
  callGAS('toggleFavorite', { sheet: sn, row: ri, currentStatus: currentFav })
    .then(function(raw) {
      var res = JSON.parse(raw);
      if (!res.success) { r.fav = currentFav; if (btn) btn.innerHTML = buildStarBtn(u,sn,ri,currentFav); showToast('ผิดพลาด: '+res.error,true); }
      else if (res.favTime) r.favTime = res.favTime;
    })
    .catch(function() { r.fav = currentFav; showToast('เกิดข้อผิดพลาด', true); });
}

// ── Barcode Modal ────────────────────────────────────────────────
function openBc(name, bc) {
  if (!bc) return;
  document.getElementById('modal-title').textContent  = name;
  document.getElementById('modal-bc-num').textContent = bc;
  var img = document.getElementById('modal-bc-img');
  var ld  = document.getElementById('modal-loading');
  img.classList.add('hidden'); ld.classList.remove('hidden');
  var url = 'https://bwipjs-api.metafloor.com/?bcid=code128&text=' + encodeURIComponent(bc) + '&scale=5&height=18&includetext&guardwhitespace';
  img.src = url;
  document.getElementById('modal-dl-btn').href     = url;
  document.getElementById('modal-dl-btn').download = 'barcode_' + bc + '.png';
  document.getElementById('bc-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function onBarcodeLoaded() { document.getElementById('modal-loading').classList.add('hidden'); document.getElementById('modal-bc-img').classList.remove('hidden'); }
function onBarcodeError()  { document.getElementById('modal-loading').textContent = 'โหลดไม่สำเร็จ'; }
function closeBarcodeModal() { document.getElementById('bc-modal').classList.add('hidden'); document.body.style.overflow = ''; }
function closeModal(e) { if (e.target.id === 'bc-modal') closeBarcodeModal(); }

// ── Add Product Modal ─────────────────────────────────────────────
function openAddProductModal() {
  document.getElementById('add-sku').value = '';
  document.getElementById('add-name').value = '';
  document.getElementById('add-size').value = '';
  document.getElementById('add-new-sheet').value = '';
  populateSheetSelect();
  document.getElementById('add-sheet').value = state.sheetNames[0] || '__NEW__';
  document.getElementById('add-product-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  onSheetSelectChange();
}
function closeAddProductModal(e) {
  if (e && e.target && e.target.id !== 'add-product-modal') return;
  document.getElementById('add-product-modal').classList.add('hidden');
  document.body.style.overflow = '';
}
function onSheetSelectChange() {
  var sel = document.getElementById('add-sheet');
  var box = document.getElementById('new-sheet-box');
  var input = document.getElementById('add-new-sheet');
  if (!sel || !box) return;
  box.style.display = sel.value === '__NEW__' ? 'block' : 'none';
  if (sel.value === '__NEW__' && input) input.focus();
}
function submitAddProduct() {
  var sku = document.getElementById('add-sku').value.trim();
  var name = document.getElementById('add-name').value.trim();
  var size = document.getElementById('add-size').value.trim();
  var sheet = document.getElementById('add-sheet').value;
  var btn = document.getElementById('submit-add-btn');
  var isNewSheet = sheet === '__NEW__';
  if (isNewSheet) { sheet = document.getElementById('add-new-sheet').value.trim(); if (!sheet) { showToast('กรุณากรอกชื่อหมวดหมู่ใหม่', true); return; } }
  if (!sku)  { showToast('กรุณากรอกรหัสสินค้า', true); return; }
  if (!name) { showToast('กรุณากรอกชื่อสินค้า', true); return; }
  btn.disabled = true; btn.textContent = 'กำลังเพิ่ม...';

  callGAS('addProduct', { sheet: sheet, sku: sku, name: name, size: size })
    .then(function(raw) {
      var res = JSON.parse(raw);
      btn.disabled = false; btn.textContent = 'เพิ่มสินค้า';
      if (res.success) {
        closeAddProductModal();
        showToast('เพิ่มสินค้าสำเร็จ ✓');
        if (isNewSheet) { state.current = AGING_TAB; state.subTab = sheet; document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active');}); var ut=document.getElementById('tab-update');if(ut)ut.classList.add('active'); var sc=document.getElementById('subtabs-container');if(sc){sc.classList.remove('hidden');sc.classList.add('flex');} }
        loadAllData();
      } else { showToast('ผิดพลาด: ' + res.error, true); }
    })
    .catch(function(err) { btn.disabled=false; btn.textContent='เพิ่มสินค้า'; showToast('ผิดพลาด: '+(err.message||'Unknown'),true); });
}

// ── Reorder ───────────────────────────────────────────────────────
function toggleReorderMode() {
  state.reorderMode = !state.reorderMode;
  var btn = document.getElementById('reorder-btn');
  if (state.reorderMode) { btn.classList.replace('bg-slate-100','bg-blue-600'); btn.classList.replace('text-slate-500','text-white'); }
  else                   { btn.classList.replace('bg-blue-600','bg-slate-100'); btn.classList.replace('text-white','text-slate-500'); }
  renderList();
}
function moveProduct(u, dir) {
  if (!state.reorderMode || state.subTab !== 'All') return;
  var allItems = state.allData['All'] || [];
  var idx = -1;
  for (var i=0;i<allItems.length;i++){if(uid(allItems[i].sheetName,allItems[i].rowIndex)===u){idx=i;break;}}
  if (idx===-1) return;
  var targetIdx = idx + dir;
  if (targetIdx<0||targetIdx>=allItems.length) return;
  var itemA=allItems[idx], itemB=allItems[targetIdx];
  var skuA=itemA.barcode, skuB=itemB.barcode;
  allItems[idx]=itemB; allItems[targetIdx]=itemA;
  renderList();

  callGAS('reorderProduct', { skuA: skuA, skuB: skuB })
    .then(function(raw) {
      var res = JSON.parse(raw);
      if (!res.success) { var temp=allItems[idx];allItems[idx]=allItems[targetIdx];allItems[targetIdx]=temp; renderList(); showToast('สลับลำดับผิดพลาด: '+res.error,true); }
    })
    .catch(function(err) { var temp=allItems[idx];allItems[idx]=allItems[targetIdx];allItems[targetIdx]=temp; renderList(); showToast('ผิดพลาด: '+(err.message||'Unknown'),true); });
}

// ── Initialize / Load ─────────────────────────────────────────────
function renderSubTabs() {
  var el = document.getElementById('sheet-subtabs');
  if (!el) return;
  el.innerHTML = (state.sheetNames || []).map(function(name) {
    var activeCls = name === state.subTab ? ' active' : '';
    return '<button class="subtab-btn' + activeCls + ' px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-500 active:scale-95 transition-all" onclick="' + ea('switchSubTab(' + ja(name) + ',this)') + '">' + ea(name) + '</button>';
  }).join('');
  syncActiveSubTab();
}

function populateSheetSelect() {
  var sel = document.getElementById('add-sheet');
  if (!sel) return;
  sel.innerHTML = (state.sheetNames || []).map(function(name) {
    return '<option value="' + ea(name) + '">' + ea(name) + '</option>';
  }).join('') + '<option value="__NEW__">+ เพิ่มหมวดหมู่ใหม่...</option>';
}

function loadAllData(options) {
  options = options || {};
  var requestId = ++_dataRequestId;
  var usedCache = false;

  if (options.useCache === true) {
    usedCache = hydrateFromCache();
  }
  if (!usedCache) {
    showSkeletons();
  }

  callGAS('getAllSheetData', {})
    .then(function(raw) {
      if (requestId !== _dataRequestId) return;
      if (!raw) {
        showError('Error: ได้รับข้อมูลว่างจาก Server');
        return;
      }
      try {
        var res = JSON.parse(raw);
        if (res.success) {
          applyDataSnapshot(res.data, res.sheetNames);
          writeAppCache(res.data, res.sheetNames);
        } else {
          showError('Error: ' + res.error);
        }
      } catch (e) {
        showError('Parse Error: ' + e.message + ' (ดูรายละเอียดใน Console F12)');
      }
    })
    .catch(function(err) {
      if (requestId !== _dataRequestId) return;
      if (!usedCache) {
        showError('ไม่สามารถเชื่อมต่อ GAS ได้: ' + (err.message || 'Unknown'));
      } else {
        var statsEl = document.getElementById('stats-text');
        if (statsEl) statsEl.textContent = statsEl.textContent.replace(' • กำลังอัปเดต', '') + ' • ใช้ข้อมูลแคช';
      }
    });
}

function showSkeletons() {
  var list = document.getElementById('product-list');
  var h = '';
  for (var i = 0; i < 6; i++) {
    h += '<div class="bg-white rounded-3xl border border-slate-200/60 p-6 space-y-4">' +
      '<div class="flex justify-between"><div class="space-y-2 flex-1"><div class="h-4 w-1/4 bg-slate-100 rounded-lg shimmer"></div><div class="h-6 w-3/4 bg-slate-100 rounded-lg shimmer"></div></div><div class="w-10 h-10 bg-slate-100 rounded-2xl shimmer"></div></div>' +
      '<div class="grid grid-cols-2 gap-3"><div class="h-16 bg-slate-100 rounded-2xl shimmer"></div><div class="h-16 bg-slate-100 rounded-2xl shimmer"></div></div>' +
    '</div>';
  }
  list.innerHTML = h;
  document.getElementById('stats-text').textContent = 'กำลังเตรียมข้อมูล...';
}

function showError(msg) {
  document.getElementById('product-list').innerHTML =
    '<div class="col-span-full bg-rose-50 border border-rose-100 p-8 rounded-[32px] text-center space-y-4">' +
      '<div class="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mx-auto"><svg class="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg></div>' +
      '<p class="font-bold text-rose-600">' + ea(msg) + '</p>' +
      '<button onclick="loadAllData()" class="px-6 py-2 bg-rose-600 text-white rounded-xl font-bold text-sm">ลองใหม่อีกครั้ง</button>' +
    '</div>';
}

// ── Pull to Refresh ───────────────────────────────────────────────
function initPullToRefresh() {
  var sc = document.getElementById('scroll-container');
  var bar = document.getElementById('ptr-bar');
  var startY = 0, diff = 0, pulling = false;
  sc.addEventListener('touchstart', function(e) { if (sc.scrollTop === 0) { startY = e.touches[0].clientY; pulling = true; } }, { passive: true });
  sc.addEventListener('touchmove',  function(e) { if (!pulling) return; diff = Math.min(100, (e.touches[0].clientY - startY) * 0.4); if (diff > 0) bar.style.height = diff + 'px'; }, { passive: true });
  sc.addEventListener('touchend',   function()  { if (diff > 60) { bar.style.height = '50px'; loadAllData(); setTimeout(function(){bar.style.height='0';},1000); } else bar.style.height='0'; pulling=false; diff=0; });
}

// ==========================================
//  BARCODE SCANNER — ฟังก์ชันสแกนกล้อง
// ==========================================
var _scannerStream  = null;
var _codeReader     = null;
var _scannerForAdd  = false;
var _lastScannedSku = '';
var _scannerSessionId = 0;

function ensureScannerLibrary() {
  if (typeof ZXing !== 'undefined') return Promise.resolve();
  if (_zxingLoadPromise) return _zxingLoadPromise;

  _zxingLoadPromise = new Promise(function(resolve, reject) {
    var script = document.getElementById(ZXING_SCRIPT_ID);

    function onLoad() {
      if (typeof ZXing !== 'undefined') {
        resolve();
      } else {
        _zxingLoadPromise = null;
        reject(new Error('Scanner library พร้อมใช้งานไม่สำเร็จ'));
      }
    }

    function onError() {
      _zxingLoadPromise = null;
      reject(new Error('โหลด Scanner library ไม่สำเร็จ'));
    }

    if (!script) {
      script = document.createElement('script');
      script.id = ZXING_SCRIPT_ID;
      script.src = ZXING_SCRIPT_URL;
      script.async = true;
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
      document.head.appendChild(script);
      return;
    }

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    setTimeout(function() {
      if (typeof ZXing !== 'undefined') resolve();
    }, 0);
  });

  return _zxingLoadPromise;
}

function warmScannerLibrary() {
  var schedule = window.requestIdleCallback || function(cb) { return setTimeout(cb, 1500); };
  schedule(function() {
    ensureScannerLibrary().catch(function() {});
  });
}

function openScannerModal() {
  _scannerForAdd  = false;
  _lastScannedSku = '';
  document.getElementById('scanner-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  startScanner();
}

function openScannerForAddProduct() {
  _scannerForAdd  = true;
  _lastScannedSku = '';
  document.getElementById('scanner-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  startScanner();
}

function startScanner() {
  var sessionId = ++_scannerSessionId;
  var statusEl   = document.getElementById('scanner-status');
  var resultBox  = document.getElementById('scanner-result-box');
  var actionsEl  = document.getElementById('scanner-actions');
  var closeBtnEl = document.getElementById('scanner-close-btn');

  if (resultBox)  resultBox.classList.add('hidden');
  if (actionsEl)  actionsEl.classList.add('hidden');
  if (statusEl)   statusEl.textContent = 'กำลังโหลดตัวสแกน...';
  if (closeBtnEl) closeBtnEl.classList.remove('hidden');

  ensureScannerLibrary()
    .then(function() {
      if (sessionId !== _scannerSessionId) return;
      if (document.getElementById('scanner-modal').classList.contains('hidden')) return;
      if (statusEl) statusEl.textContent = 'กำลังเปิดกล้อง...';
      if (_codeReader) { try { _codeReader.reset(); } catch (err) {} }

      // ── ขอกล้องพร้อมตั้งค่า focusMode + zoom ──────────────────
      var videoEl = document.getElementById('scanner-video');
      var constraints = {
        video: {
          facingMode: 'environment',
          width:  { ideal: 1280 },
          height: { ideal: 720  },
          focusMode: 'continuous',        // โฟกัสอัตโนมัติ
          advanced: [{ focusMode: 'continuous' }]
        }
      };

      navigator.mediaDevices.getUserMedia(constraints)
        .then(function(stream) {
          if (sessionId !== _scannerSessionId) { stream.getTracks().forEach(function(t){t.stop();}); return; }
          _scannerStream = stream;
          videoEl.srcObject = stream;

          // ── ลอง enable continuous autofocus ผ่าน ImageCapture API ──
          var track = stream.getVideoTracks()[0];
          if (track && track.applyConstraints) {
            track.applyConstraints({
              advanced: [{ focusMode: 'continuous' }]
            }).catch(function(){});
          }

          if (statusEl) statusEl.textContent = 'จ่อกล้องไปที่บาร์โค้ด...';

          _codeReader = new ZXing.BrowserMultiFormatReader();

          // ── hints: อ่านเฉพาะ format ที่สินค้าใช้จริง ──────────────
          var hints = new Map();
          var formats = [
            ZXing.BarcodeFormat.EAN_13,
            ZXing.BarcodeFormat.EAN_8,
            ZXing.BarcodeFormat.CODE_128,
            ZXing.BarcodeFormat.CODE_39,
            ZXing.BarcodeFormat.UPC_A,
            ZXing.BarcodeFormat.UPC_E,
            ZXing.BarcodeFormat.ITF
          ];
          hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
          hints.set(ZXing.DecodeHintType.TRY_HARDER, false);

          _codeReader = new ZXing.BrowserMultiFormatReader(hints);

          _codeReader.decodeFromStream(stream, videoEl, function(result, err) {
            if (sessionId !== _scannerSessionId) return;

            if (result) {
              var raw = result.getText();
              var sku = extractScannerSku(raw);

              if (!sku) return;

              _lastScannedSku = sku;
              if (_codeReader) _codeReader.reset();
              if (statusEl) statusEl.textContent = '';
              if (resultBox) resultBox.classList.remove('hidden');

              document.getElementById('scanner-result-text').textContent = sku;
              var productName = findProductBySku(sku);
              var nameEl = document.getElementById('scanner-product-name');
              if (nameEl) nameEl.textContent = productName || 'ไม่พบสินค้าในระบบ';

              if (actionsEl) actionsEl.classList.remove('hidden');
              if (closeBtnEl) closeBtnEl.classList.add('hidden');


            } else if (err && !(err instanceof ZXing.NotFoundException)) {
              if (statusEl) statusEl.textContent = 'เปิดกล้องไม่ได้: ' + err.message;
            }
          });
        })
        .catch(function(err) {
          if (sessionId !== _scannerSessionId) return;
          if (statusEl) statusEl.textContent = 'ไม่ได้รับอนุญาตใช้กล้อง: ' + err.message;
        });
    })
    .catch(function(err) {
      if (sessionId !== _scannerSessionId) return;
      if (statusEl) statusEl.textContent = err.message || 'โหลด Scanner ไม่สำเร็จ';
    });
}

function normalizeScannerDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function addScannerCandidate(candidates, byDigits, value, score, source, index) {
  var digits = normalizeScannerDigits(value);
  if (!/^\d{8,14}$/.test(digits)) return;

  var existing = byDigits[digits];
  if (existing) {
    if (score > existing.score) {
      existing.score = score;
      existing.source = source;
      existing.index = typeof index === 'number' ? index : existing.index;
    }
    return;
  }

  var candidate = {
    sku: digits,
    digits: digits,
    score: score,
    source: source || '',
    index: typeof index === 'number' ? index : 999
  };
  candidates.push(candidate);
  byDigits[digits] = candidate;
}

function buildScannerCandidates(rawText) {
  var text = String(rawText || '').trim();
  var digits = normalizeScannerDigits(text);
  var candidates = [];
  var byDigits = {};

  if (!text && !digits) return candidates;

  if (/^\d{8,14}$/.test(text)) {
    addScannerCandidate(candidates, byDigits, text, 260 + text.length + (isValidEAN13(text) ? 80 : 0), 'raw', 0);
  } else if (/^\d{8,14}$/.test(digits)) {
    addScannerCandidate(candidates, byDigits, digits, 230 + digits.length + (isValidEAN13(digits) ? 80 : 0), 'digits', 0);
  }

  var slashParts = text.split('/');
  if (slashParts.length >= 3) {
    addScannerCandidate(candidates, byDigits, slashParts[1], 360, 'slash-middle', 1);
  }

  var tokens = text.split(/\D+/);
  for (var ti = 0; ti < tokens.length; ti++) {
    if (!tokens[ti]) continue;
    addScannerCandidate(candidates, byDigits, tokens[ti], 190 + tokens[ti].length, 'token', ti);
  }

  if (digits.length > 14 && digits.indexOf('8880') === 0) {
    for (var pl = 14; pl >= 8; pl--) {
      if (digits.length < 4 + pl) continue;
      var prefixed = digits.substr(4, pl);
      var prefixScore = 155 + pl + (digits.length - 4 - pl <= 4 ? 20 : 0);
      if (pl === 13 && isValidEAN13(prefixed)) prefixScore += 90;
      if (pl === 14) prefixScore += 65;
      addScannerCandidate(candidates, byDigits, prefixed, prefixScore, 'price-prefix-8880', 4);
    }
  }

  if (digits.length > 13) {
    for (var ei = 0; ei <= digits.length - 13; ei++) {
      var ean = digits.substr(ei, 13);
      if (!isValidEAN13(ean)) continue;
      var eanScore = 125 + (ean.indexOf('885') === 0 ? 10 : 0);
      if (digits.indexOf('8880') === 0 && ei === 4) eanScore += 90;
      addScannerCandidate(candidates, byDigits, ean, eanScore, 'ean13-window', ei);
    }
  }

  candidates.sort(function(a, b) {
    return (b.score - a.score) || (b.digits.length - a.digits.length) || (a.index - b.index);
  });
  return candidates;
}

function getKnownScannerSkus() {
  var known = [];
  var seen = {};
  var names = Object.keys(state.allData || {});

  for (var i = 0; i < names.length; i++) {
    var rows = state.allData[names[i]] || [];
    for (var j = 0; j < rows.length; j++) {
      var sku = String(rows[j].barcode || '').trim();
      var digits = normalizeScannerDigits(sku);
      if (!/^\d{8,14}$/.test(digits) || seen[digits]) continue;
      seen[digits] = true;
      known.push({ sku: sku || digits, digits: digits, name: rows[j].name || '' });
    }
  }

  return known;
}

function findKnownScannerMatch(rawText, candidates) {
  var text = String(rawText || '').trim();
  var rawDigits = normalizeScannerDigits(text);
  // ✅ เพิ่มบรรทัดนี้ — strip leading digit ถ้าเป็น ITF-14
  var strippedDigits = rawDigits.length === 14 ? rawDigits.substr(1) : rawDigits;
  var known = getKnownScannerSkus();
  var best = null;
  var candidateScoreByDigits = {};
  var tokenMap = {};
  var tokens = text.split(/\D+/);

  for (var ci = 0; ci < candidates.length; ci++) {
    candidateScoreByDigits[candidates[ci].digits] = candidates[ci].score;
  }
  for (var ti = 0; ti < tokens.length; ti++) {
    if (tokens[ti]) tokenMap[tokens[ti]] = true;
  }

  for (var i = 0; i < known.length; i++) {
    var item = known[i];
    var score = 0;
    var index = rawDigits.indexOf(item.digits);
     
    if (text === item.sku || rawDigits === item.digits || strippedDigits === item.digits) {
      score = 1500 + item.digits.length;
    } else if (candidateScoreByDigits[item.digits]) {
      score = 1100 + candidateScoreByDigits[item.digits] + item.digits.length;
    } else if (tokenMap[item.digits]) {
      score = 1000 + item.digits.length;
    } else if (
      index !== -1 &&
      (item.digits.length >= 13 || index === 4 || rawDigits.length <= 14)
    ) {
      score = 850 + (item.digits.length * 8) + (index === 4 ? 80 : 0);
    }

    if (!score) continue;
    if (!best || score > best.score || (score === best.score && item.digits.length > best.digits.length)) {
      best = { sku: item.sku, digits: item.digits, score: score };
    }
  }

  return best;
}

function extractScannerSku(rawText) {
  var candidates = buildScannerCandidates(rawText);
  var knownMatch = findKnownScannerMatch(rawText, candidates);
  if (knownMatch) return knownMatch.sku;
  return candidates.length ? candidates[0].sku : '';
}

function isValidEAN13(s) {
  if (!/^\d{13}$/.test(s)) return false;
  var sum = 0;
  for (var i = 0; i < 12; i++) {
    sum += parseInt(s[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === parseInt(s[12]);
}
function findProductBySku(sku) {
  var target = String(sku || '').trim();
  var targetDigits = normalizeScannerDigits(target);
  var names = Object.keys(state.allData);
  for (var i = 0; i < names.length; i++) {
    var rows = state.allData[names[i]] || [];
    for (var j = 0; j < rows.length; j++) {
      var barcode = String(rows[j].barcode || '').trim();
      if (barcode === target || (targetDigits && normalizeScannerDigits(barcode) === targetDigits)) {
        return rows[j].name || '';
      }
    }
  }
  return '';
}

function scannerSearchProduct() {
  var sku = _lastScannedSku;
  if (!sku) return;

  closeScannerModal();

  if (_scannerForAdd) {
    // ใส่ค่าใน Add Product Modal
    var skuInput = document.getElementById('add-sku');
    if (skuInput) skuInput.value = sku;
    return;
  }

  // ค้นหาสินค้าใน list หลัก
  state.search = sku;
  var searchInput = document.getElementById('search-input');
  if (searchInput) { searchInput.value = sku; toggleClearBtn(sku); }
  renderList();

  // Highlight card ที่เจอ
  setTimeout(function() {
    var found = false;
    var names = Object.keys(state.allData);
    for (var i = 0; i < names.length && !found; i++) {
      var rows = state.allData[names[i]] || [];
      for (var j = 0; j < rows.length && !found; j++) {
        var barcode = String(rows[j].barcode || '').trim();
        var barcodeDigits = normalizeScannerDigits(barcode);
        var skuDigits = normalizeScannerDigits(sku);
        if (barcode === String(sku).trim() || (skuDigits && barcodeDigits === skuDigits)) {
          var u = uid(rows[j].sheetName || names[i], rows[j].rowIndex);
          var cardEl = document.getElementById('title_' + u);
          if (cardEl) {
            cardEl.closest('.bg-white').scrollIntoView({ behavior: 'smooth', block: 'center' });
            cardEl.closest('.bg-white').classList.add('highlight-product');
            setTimeout(function() { cardEl.closest('.bg-white').classList.remove('highlight-product'); }, 2500);
          }
          found = true;
        }
      }
    }
    if (!found) showToast('ไม่พบสินค้า SKU: ' + sku, true);
  }, 300);
}

function resetScanner() {
  _lastScannedSku = '';
  var resultBox = document.getElementById('scanner-result-box');
  var actionsEl = document.getElementById('scanner-actions');
  var closeBtnEl = document.getElementById('scanner-close-btn');
  var statusEl  = document.getElementById('scanner-status');
  if (resultBox)  resultBox.classList.add('hidden');
  if (actionsEl)  actionsEl.classList.add('hidden');
  if (closeBtnEl) closeBtnEl.classList.remove('hidden');
  if (statusEl)   statusEl.textContent = 'กำลังเปิดกล้อง...';
  startScanner();
}

function closeScannerModal() {
  _scannerSessionId++;
  if (_codeReader) { try { _codeReader.reset(); } catch(e) {} _codeReader = null; }
  if (_scannerStream) { _scannerStream.getTracks().forEach(function(t) { t.stop(); }); _scannerStream = null; }
  var video = document.getElementById('scanner-video');
  if (video) { video.srcObject = null; }
  document.getElementById('scanner-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Tailwind Config ──────────────────────────────────────────────
if (typeof tailwind !== 'undefined') {
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          brand: { 50:'#eff6ff',100:'#dbeafe',200:'#bfdbfe',300:'#93c5fd',400:'#60a5fa',500:'#3b82f6',600:'#2563eb',700:'#1d4ed8',800:'#1e40af',900:'#1e3a8a' }
        },
        fontFamily: { sarabun: ['Sarabun', 'sans-serif'] },
        boxShadow: { premium: '0 8px 30px rgb(0,0,0,0.04)', glass: '0 4px 30px rgba(0,0,0,0.1)' }
      }
    }
  };
}

// ── Boot ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function() {
  updatePlaceholder();
  loadAllData({ useCache: true });
  initPullToRefresh();
  warmScannerLibrary();
});
