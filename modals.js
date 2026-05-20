// ==========================================
//  modals.js — Stock Manager v3
//  Barcode Display Modal + Add Product Modal + Scanner Modal
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
  document.body.insertAdjacentHTML('beforeend', getModalsHTML());
});

function getModalsHTML() {
  return `
  <!-- ── Barcode Display Modal ─────────────────────────────────── -->
  <div id="bc-modal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center px-4" onclick="closeModal(event)">
    <div class="bg-white rounded-[32px] shadow-2xl w-full max-w-sm p-6 text-center" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-5">
        <h3 id="modal-title" class="font-black text-slate-800 text-left text-base leading-tight truncate pr-4"></h3>
        <button onclick="closeBarcodeModal()" class="w-10 h-10 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center active:scale-90 transition-transform flex-shrink-0">✕</button>
      </div>
      <div class="bg-white rounded-3xl p-4 mb-4 flex items-center justify-center border border-slate-100" style="min-height:200px">
        <div id="modal-loading" class="text-slate-300 font-bold">กำลังโหลด...</div>
        <img id="modal-bc-img" class="hidden w-full object-contain" style="max-height:180px" alt="barcode" onload="onBarcodeLoaded()" onerror="onBarcodeError()"/>
      </div>
      <p id="modal-bc-num" class="font-mono font-bold text-slate-500 mb-5 text-sm bg-slate-50 py-2.5 rounded-xl border border-slate-100 tracking-widest"></p>
      <a id="modal-dl-btn" href="#" download class="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-500/30 active:scale-95 transition-transform block text-center">ดาวน์โหลดบาร์โค้ด</a>
    </div>
  </div>

  <!-- ── Toast ────────────────────────────────────────────────── -->
  <div id="toast" class="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] px-6 py-3.5 rounded-2xl bg-slate-900 text-white text-sm font-bold shadow-2xl opacity-0 translate-y-10 pointer-events-none transition-all duration-500"></div>

  <!-- ── Add Product Modal ──────────────────────────────────────── -->
  <div id="add-product-modal" class="hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center px-4" style="padding-bottom: env(safe-area-inset-bottom)" onclick="closeAddProductModal(event)">
    <div class="bg-white rounded-[32px] shadow-2xl w-full max-w-sm p-6" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-5">
        <h3 class="font-black text-slate-800 text-lg">เพิ่มสินค้าใหม่</h3>
        <button onclick="closeAddProductModal()" class="w-10 h-10 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center active:scale-90 transition-transform flex-shrink-0">✕</button>
      </div>
      <div class="space-y-4 mb-6">
        <div class="space-y-1.5">
          <label class="text-[10px] font-black text-slate-400 uppercase px-1">SKU / Barcode</label>
          <div class="flex gap-2">
            <input id="add-sku" type="text" placeholder="รหัสบาร์โค้ด" class="flex-1 px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm outline-none focus:bg-white focus:border-blue-500" />
            <button onclick="openScannerForAddProduct()" class="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center active:scale-90 transition-transform border border-blue-100">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 9V5a2 2 0 012-2h4M3 15v4a2 2 0 002 2h4m10-16h4a2 2 0 012 2v4m0 6v4a2 2 0 01-2 2h-4M7 12h.01M12 12h.01M17 12h.01"/></svg>
            </button>
          </div>
        </div>
        <div class="space-y-1.5">
          <label class="text-[10px] font-black text-slate-400 uppercase px-1">ชื่อสินค้า</label>
          <input id="add-name" type="text" placeholder="ชื่อสินค้า" class="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm outline-none focus:bg-white focus:border-blue-500" />
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-1.5">
            <label class="text-[10px] font-black text-slate-400 uppercase px-1">ขนาด</label>
            <input id="add-size" type="text" placeholder="เช่น 400 ml" class="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm outline-none focus:bg-white focus:border-blue-500" />
          </div>
          <div class="space-y-1.5">
            <label class="text-[10px] font-black text-slate-400 uppercase px-1">หมวดหมู่</label>
            <select id="add-sheet" onchange="onSheetSelectChange()" class="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm outline-none focus:bg-white focus:border-blue-500 font-semibold text-slate-700"></select>
          </div>
        </div>
        <div id="new-sheet-box" style="display:none" class="space-y-1.5">
          <label class="text-[10px] font-black text-slate-400 uppercase px-1">ชื่อหมวดหมู่ใหม่</label>
          <input id="add-new-sheet" type="text" placeholder="เช่น BevCo, ชาเขียว..." class="w-full px-4 py-3 rounded-2xl border border-blue-200 bg-blue-50 text-sm outline-none focus:bg-white focus:border-blue-500" />
        </div>
      </div>
      <div class="flex gap-3">
        <button onclick="closeAddProductModal()" class="px-4 py-3 rounded-2xl bg-slate-100 text-slate-600 text-sm font-bold active:scale-95 transition-all flex-1">ยกเลิก</button>
        <button id="submit-add-btn" onclick="submitAddProduct()" class="px-4 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all flex-[2]">เพิ่มสินค้า</button>
      </div>
    </div>
  </div>

  <!-- ── Scanner Modal (ใหม่) ──────────────────────────────────── -->
  <div id="scanner-modal" class="hidden fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[60] flex items-end justify-center sm:items-center px-4 pb-4 sm:pb-0" style="padding-bottom: calc(1rem + env(safe-area-inset-bottom))">
    <div class="bg-white rounded-[32px] shadow-2xl w-full max-w-sm p-6" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="font-black text-slate-800 text-lg">สแกนบาร์โค้ด</h3>
          <p class="text-xs text-slate-400 font-medium mt-0.5">จ่อกล้องไปที่บาร์โค้ดสินค้า</p>
        </div>
        <button onclick="closeScannerModal()" class="w-10 h-10 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center active:scale-90 transition-transform flex-shrink-0">✕</button>
      </div>

      <!-- Viewfinder -->
      <div id="scanner-viewfinder" class="mb-4">
        <video id="scanner-video" autoplay playsinline muted></video>
        <div class="scanner-frame">
          <div class="scanner-line"></div>
        </div>
      </div>

      <!-- ผลลัพธ์การสแกน -->
      <div id="scanner-result-box" class="hidden mb-4 p-4 bg-green-50 border border-green-200 rounded-2xl text-center">
        <p class="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">สแกนสำเร็จ</p>
        <p id="scanner-result-text" class="font-mono font-black text-slate-800 text-lg tracking-widest"></p>
        <p id="scanner-product-name" class="text-sm text-slate-500 font-medium mt-1"></p>
      </div>

      <!-- ข้อความ status -->
      <p id="scanner-status" class="text-center text-xs text-slate-400 font-medium mb-4">กำลังเปิดกล้อง...</p>

      <!-- ปุ่ม Action -->
      <div id="scanner-actions" class="hidden flex gap-3">
        <button onclick="scannerSearchProduct()" class="flex-1 py-3 rounded-2xl bg-blue-600 text-white text-sm font-bold active:scale-95 transition-all">ค้นหาสินค้า</button>
        <button onclick="resetScanner()" class="px-4 py-3 rounded-2xl bg-slate-100 text-slate-600 text-sm font-bold active:scale-95 transition-all">สแกนใหม่</button>
      </div>
      <button id="scanner-close-btn" onclick="closeScannerModal()" class="w-full py-3 rounded-2xl bg-slate-100 text-slate-600 text-sm font-bold active:scale-95 transition-all">ปิด</button>
    </div>
  </div>
  `;
}
