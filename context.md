# Stock Manager v4 — Project Context

> Last updated: 2026-05-21

-----

## 1. Overview

- **Version**: 4.0.10-Hybrid
- **Platform**: Hybrid Deploy — GitHub Pages (Frontend) + Google Apps Script (Backend)
- **Stack**: GAS Backend + Google Sheets DB + Vanilla HTML/CSS/JS Frontend
- **Deploy**:
  - Frontend: `git push` → GitHub Pages อัปเดตอัตโนมัติ
  - Backend: `clasp push` → GAS Editor → Deploy → New version (ทุกครั้งที่แก้ code.js)

-----

## 2. Repository & IDs

- **GitHub Repository**: `https://github.com/trpsry/Stock-Manager-v4.git`
- **Spreadsheet ID**: `1WId___CZ_OIcoJWaIjt1BG74erZrsOXzU09Js0nVPO8`
- **GAS Web App URL**: อยู่ใน `scripts.js` ตัวแปร `GAS_URL`
- **App Icon**: `https://i.postimg.cc/zDFxrHNZ/image.png?v=20260502`

-----

## 3. File Structure

```
index.html      — HTML structure + Header (3 ชั้น)
scripts.js      — Frontend logic ทั้งหมด
modals.js       — Modal HTML injection + ฟังก์ชัน modal ทั้งหมด
styles.css      — Custom CSS + Tailwind overrides
mainfest.json   — PWA Web App Manifest
code.js         — GAS Backend (clasp แปลงเป็น code.gs อัตโนมัติ)
```

-----

## 4. Google Sheets Structure

### Product Sheets (dynamic)

ปัจจุบัน: `Oishi`, `Est`, `F&N`, `Alc.`, `น้ำดื่ม` — เพิ่มได้จาก UI

|Col|A  |B  |C |D   |E   |F   |G   |H   |I |J     |K      |L             |M                 |N       |O                |
|---|---|---|--|----|----|----|----|----|--|------|-------|--------------|------------------|--------|-----------------|
|   |ลำดับ|SKU|ชื่อ|ขนาด|LOT1|LOT2|LOT3|LOT4|OH|OHTime|LotTime|Favorite(bool)|FavTime(timestamp)|OS(bool)|OSTime(timestamp)|

- Row 1: Title (`Stock Manager — {SheetName}`)
- Row 2: Headers
- Row 3+: Data
- Col M/O ใช้เก็บ timestamp ล่าสุดตอนกด Favorite/OS

### System Sheets (ห้ามลบ)

- `Aging_Order`: A=ลำดับ, B=SKU, C=ชื่อ, D=ชีต
- `Aging`: Legacy sheet (รองรับ backward compat)

-----

## 5. Backend Functions (code.js / code.gs)

|Function           |Parameters                |คำอธิบาย                          |
|-------------------|--------------------------|--------------------------------|
|`getAllSheetData()`|—                         |ดึงข้อมูลทุกชีต รวม All/sheetNames   |
|`saveLotData()`    |sheet, row, l1, l2, l3, l4|บันทึก LOT + timestamp col K      |
|`saveProductData()`|sheet, row, sku, name     |บันทึก SKU + ชื่อ                   |
|`saveOhData()`     |sheet, row, oh            |บันทึก OH + timestamp col J       |
|`clearLotData()`   |sheet, row                |ล้าง LOT + update timestamp col K|
|`toggleFavorite()` |sheet, row, currentStatus |สลับ fav col L + timestamp col M |
|`toggleOS()`       |sheet, row, currentStatus |สลับ OS col N + timestamp col O  |
|`addProduct()`     |sheet, sku, name, size    |เพิ่มสินค้า + เพิ่มใน Aging_Order     |
|`reorderProduct()` |skuA, skuB                |สลับลำดับใน Aging_Order            |

### API Mode

- `doGet` + JSONP: ใช้กับ `getAllSheetData` เท่านั้น
- `doPost` + no-cors: ใช้กับทุก write action
- Cache: `CacheService.getScriptCache()`, TTL = 30 วินาที, key = `stock-manager:getAllSheetData:v1`
- ล้าง cache ทุกครั้งที่มีการ write

-----

## 6. Frontend State Object (scripts.js)

```javascript
state = {
  allData:     {},       // key = sheetName → array of product objects
  current:     'Aging',  // tab ปัจจุบัน ('Aging' | '__OVERVIEW__')
  subTab:      'All',    // subtab ('All' | 'Favorite' | 'OS' | sheetName)
  search:      '',       // debounced 200ms
  reorderMode: false,    // เปิดได้เฉพาะ Aging tab + All subtab
  sheetNames:  []        // dynamic จาก server
}
```

### Product Object Fields

```javascript
{
  rowIndex, barcode, name, size, sheetName,
  lot1, lot2, lot3, lot4,
  oh, ohTime, lotTime,
  fav,      // boolean
  favTime,  // timestamp (ms) จาก col M
  os,       // boolean
  osTime    // timestamp (ms) จาก col O
}
```

-----

## 7. Frontend Architecture

### API Communication

```javascript
// GET (getAllSheetData) — JSONP เพื่อเลี่ยง CORS
callGAS('getAllSheetData', {})

// POST (write actions) — fetch no-cors (ไม่เห็น response body)
callGAS('saveLotData', { sheet, row, l1, l2, l3, l4 })
```

### Cache Strategy

- **Frontend**: `localStorage`, key = `stock-manager-v3-cache-v2`, TTL = 5 นาที
- Boot: hydrate จาก cache ก่อน → fetch ใหม่ทุกครั้ง (stale-while-revalidate)
- ถ้า fetch ล้มเหลว + มี cache → แสดง “ใช้ข้อมูลแคช”

### Render

- Chunk render: `CHUNK_SIZE = 15` cards, `setTimeout(renderChunk, 16)`
- Skeleton loading (shimmer) ขณะรอ fetch ครั้งแรก
- Optimistic update: อัปเดต UI ก่อน → rollback ถ้า error

### Helpers

```javascript
uid(sn, ri)        // สร้าง unique element ID
ea(v)              // HTML escape
ja(v)              // JSON-safe string
bh(name, args)     // inline onclick builder
syncData(p, oldB, oldN) // sync ข้อมูลสินค้าเดียวกันข้ามชีต
```

-----

## 8. UI / Design System

### Layout

- Header: 3 ชั้น (Logo+Search+Actions / Tabs / Subtabs+Buttons)
- `sticky top-0` header, `overflow-hidden` body, `overflow-y-auto` main
- Pull-to-Refresh: touch gesture บน scroll-container (threshold 60px)

### Design Tokens

- **Framework**: Tailwind CSS 3 CDN
- **Font**: Sarabun (Google Fonts)
- **Brand color**: `#2563eb` (blue-600)
- **Style**: Material-inspired + Glassmorphism
- **Border radius**: rounded-2xl (cards), rounded-3xl (containers), rounded-[32px] (modals)

### Tabs

- `Update` → `state.current = 'Aging'`
- `รายการสินค้า` → `state.current = '__OVERVIEW__'`

### Subtabs

- `All` — รายการ Aging_Order ตามลำดับ
- `Favorite` — sort by `favTime` desc (cross-device)
- `OS` — สินค้า out of stock, sort by `osTime` desc, card สีแดง
- Dynamic sheet tabs — กรองตาม sheetName

### Icons (SVG)

- ปุ่มสแกนบาร์โค้ด (header + Add Product modal): ใช้ path เดียวกัน
  
  ```html
  <g transform="translate(0.25 0.25)">
    <path stroke-width="1.75"
      d="M4.75 8V5.75A1.75 1.75 0 0 1 6.5 4h2.25M19.25 8V5.75...
         M9.5 10.25v3.5M12 9.5v5M14.5 10.25v3.5" />
  </g>
  ```
- Header icon size: `.header-action-icon` = 18×18px, `stroke-width: 1.75`

-----

## 9. Modals (modals.js)

inject HTML ผ่าน `document.body.insertAdjacentHTML('beforeend', getModalsHTML())`

|Modal ID           |คำอธิบาย                       |
|-------------------|-----------------------------|
|`bc-modal`         |แสดง barcode image + ดาวน์โหลด|
|`add-product-modal`|ฟอร์มเพิ่มสินค้าใหม่               |
|`scanner-modal`    |สแกนบาร์โค้ดผ่านกล้อง            |
|`toast`            |แจ้งเตือน (3 วินาที, สีแดง=error) |

### Barcode Image API

```
https://bwipjs-api.metafloor.com/?bcid=code128&text={SKU}&scale=5&height=18&includetext&guardwhitespace
```

-----

## 10. Scanner (ZXing)

- **Library**: `@zxing/library@latest` (unpkg CDN)
- **โหลด**: Lazy load เมื่อใช้งาน + `warmScannerLibrary()` preload ตอน idle
- **Formats**: EAN_13, EAN_8, CODE_128, CODE_39, UPC_A, UPC_E
- **Filter**: รับ raw จาก barcode แล้วแยก candidate SKU 8–14 หลัก
- **SKU Selection**: เทียบกับ SKU ใน `state.allData` ก่อนเสมอ แล้วค่อย fallback ด้วย token `/.../`, EAN-13 checksum, และ pattern ป้ายราคา `8880 + SKU + suffix`
- **Camera**: `facingMode: environment`, continuous autofocus
- **Viewfinder**: aspect-ratio 4/3, max-height 260px
- **Mode**:
  - `_scannerForAdd = false` → ค้นหา + highlight card ในหน้าหลัก
  - `_scannerForAdd = true` → กรอก SKU ใน Add Product Modal

### Scanner State Variables

```javascript
_scannerStream    // MediaStream ปัจจุบัน
_codeReader       // ZXing BrowserMultiFormatReader
_scannerForAdd    // boolean
_lastScannedSku   // string
_scannerSessionId // int (ป้องกัน race condition)
_zxingLoadPromise // Promise (singleton load)
```

-----

## 11. Rules สำคัญ

- **Version bump**: ทุกครั้งที่แก้ไขโค้ด ให้ bump patch version +0.0.1 และใช้เลขเดียวกันใน context.md (Section 1), index.html (Version label), และ cache-bust query string ใน index.html
- **LOT sort**: sort เฉพาะตอน Save (`sortLots()`) ไม่ sort ตอน render
- **OH validation**: ห้ามติดลบ
- **Dynamic sheets**: ใช้ `getMainSheetNames_()` ไม่ hardcode
- **reorderMode**: ใช้ได้เฉพาะ Aging tab + All subtab
- **Column M/O**: timestamp ของ Favorite/OS สร้างโดย `ensureColumns_()`
- **SYSTEM_SHEETS**: `['Aging', 'Aging_Order']` — ห้ามลบ ห้ามใช้ชื่อซ้ำ
- **Search**: debounce 200ms, ค้นหาใน sheetName + name + barcode + size + lots + oh
- **Duplicate SKU**: ตรวจสอบใน `addProduct()` ก่อน append

-----

## 12. Changelog

|Version          |รายการ                                                    |
|-----------------|----------------------------------------------------------|
|v4 (4.0.10-Hybrid)|ปัจจุบัน — แก้ Fav toggle ให้กดเพิ่มแล้วเอาออกได้ทันที และเพิ่ม OS subtab/ปุ่ม/การ์ดสีแดง|
|v4 (4.0.9-Hybrid)|ปรับปรุงระบบสแกนบาร์โค้ดป้ายราคาให้สมบูรณ์และแม่นยำ 100%|
|                 |รองรับ SKU 14 หลัก GTIN-14 และ SKU ที่ไม่ได้ขึ้นต้นด้วย 885|
|                 |คำนวณตำแหน่งและตัดขนาดตัวเลข SKU จริงด้วยสูตรตายตัว (Exact Length Boost)|
|                 |เพิ่มการตรวจสอบความถูกต้อง Checksum 14 หลัก (isValidGTIN14) และระบบ GTIN-14 Window|
|v4 (4.0.8-Hybrid)|push target: `Stock-Manager-v4.0.8.git` (เวอร์ชันก่อนหน้า)|
|                 |Scanner เลือก SKU จากฐานข้อมูลก่อน fallback เพื่อลดการอ่านป้ายราคาผิด|
|                 |รองรับ raw ป้ายราคาแบบ `8880 + SKU + suffix`, token `/.../`, EAN-13 checksum และ SKU 14 หลักที่ไม่ขึ้นต้น `885`|
|                 |ปรับเลขเวอร์ชันใน index/cache-bust ให้ตรงกับ context เป็น `4.0.8-Hybrid`|
|v4 (4.0.7-Hybrid)|ปรับ Scanner ให้เลือก SKU จากฐานข้อมูลก่อน และรองรับป้ายราคาที่มี prefix/suffix|
|v4 (4.0.6-Hybrid)|เวอร์ชั่นหลักก่อนหน้า                                         |
|                 |แก้ไอคอนปุ่มสแกนใน Add Product Modal ให้ตรงกับหน้าหลัก           |
|                 |เพิ่ม Scanner modal (ZXing) — ค้นหาหน้าหลัก + กรอก SKU ใน modal|
|                 |Hybrid deploy: GitHub Pages + GAS backend                 |
|                 |Dynamic category system                                   |
|                 |Favorite sort by timestamp (col M) — cross-device         |
|                 |Header 4→3 ชั้น, compact                                    |
|                 |เอา Header collapse ออก (แก้ปัญหากระตุก)                     |
|                 |แก้ syntax error `}` หายใน `getAllSheetData`               |

-----

## 13. Troubleshooting

|ปัญหา                     |วิธีแก้                                           |
|-------------------------|-----------------------------------------------|
|“ไม่พบ doGet”             |เปิด URL ลงท้าย `/exec` ไม่ใช่ `/edit`             |
|แก้โค้ดแล้วไม่อัปเดต          |ต้อง Deploy → New version ทุกครั้ง                 |
|CORS error               |ตรวจสอบ Deploy ตั้ง “Anyone” และใช้ JSONP สำหรับ GET|
|Scanner ไม่ขึ้นขอ permission|ต้องเปิดผ่าน HTTPS เท่านั้น                          |
|code.js vs code.gs       |clasp แปลงอัตโนมัติ — แก้ที่ `.js` เสมอ              |
