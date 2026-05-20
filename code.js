// ==========================================
//  code.gs — Stock Manager v3
//  Google Apps Script Backend
// ==========================================

const SPREADSHEET_ID = '1WId___CZ_OIcoJWaIjt1BG74erZrsOXzU09Js0nVPO8';
const OH_HEADER = 'จำนวน OH';
const OH_TIME_HEADER = 'Update OH';
const LOT_TIME_HEADER = 'Update Lot';
const APP_ICON_URL = 'https://i.postimg.cc/zDFxrHNZ/image.png';
const SYSTEM_SHEETS = ['Aging', 'Aging_Order'];
const TEMPLATE_SHEET_NAMES = ['Oishi', 'Est', 'Alc.', 'F&N'];

// ── doGet: handle API requests via JSONP/GET ──────────────────
function doGet(e) {
  // หากมีการส่ง parameter 'action' มา ให้ประมวลผลเป็น API (JSONP)
  if (e.parameter.action) {
    try {
      const action = e.parameter.action;
      const callback = e.parameter.callback;
      let resultData;

      if (action === 'getAllSheetData') resultData = JSON.parse(getAllSheetData());
      else resultData = { success: false, error: 'Unknown GET action: ' + action };

      const jsonString = JSON.stringify(resultData);
      
      // ถ้ามี callback ให้ตอบกลับเป็น JSONP
      if (callback) {
        return ContentService.createTextOutput(`${callback}(${jsonString})`)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      
      // ถ้าไม่มี callback ให้ตอบเป็น JSON ปกติ
      return ContentService.createTextOutput(jsonString)
        .setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // หากไม่มี action ให้แสดงหน้า HTML ปกติ
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Stock Manager')
    .setFaviconUrl(APP_ICON_URL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── doPost: REST API สำหรับ GitHub Pages / Vercel ───────────────
function doPost(e) {
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;
    let result;

    if      (action === 'getAllSheetData')  result = getAllSheetData();
    else if (action === 'saveLotData')     result = saveLotData(params.sheet, params.row, params.l1, params.l2, params.l3, params.l4);
    else if (action === 'saveProductData') result = saveProductData(params.sheet, params.row, params.sku, params.name);
    else if (action === 'saveOhData')      result = saveOhData(params.sheet, params.row, params.oh);
    else if (action === 'clearLotData')    result = clearLotData(params.sheet, params.row);
    else if (action === 'toggleFavorite')  result = toggleFavorite(params.sheet, params.row, params.currentStatus);
    else if (action === 'addProduct')      result = addProduct(params.sheet, params.sku, params.name, params.size);
    else if (action === 'reorderProduct')  result = reorderProduct(params.skuA, params.skuB);
    else result = JSON.stringify({ success: false, error: 'Unknown action: ' + action });

    return ContentService
      .createTextOutput(result)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function pad2_(value) {
  return String(value).padStart(2, '0');
}

function formatLotDate_(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM/yy');
  }
  const text = String(value).trim();
  if (!text) return '';
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return `${pad2_(match[3])}/${pad2_(match[2])}/${parseInt(match[1], 10) % 100}`;
  }
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    let year = parseInt(match[3], 10);
    if (match[3].length === 4 && year > 2400) year -= 543;
    return `${pad2_(match[1])}/${pad2_(match[2])}/${pad2_(year % 100)}`;
  }
  return text;
}

function formatUpdateDate_(value) {
  if (value == null || value === '' || !(value instanceof Date) || isNaN(value.getTime())) return '';
  return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM/yy HH:mm');
}

function ensureColumns_(sheet) {
  const maxCols = sheet.getMaxColumns();
  if (maxCols < 12) {
    sheet.insertColumnsAfter(maxCols, 12 - maxCols);
  }
  const headers = [[OH_HEADER, OH_TIME_HEADER, LOT_TIME_HEADER, 'Favorite']];
  sheet.getRange(2, 9, 1, 4).setValues(headers);
}

function getMainSheetNames_(ss) {
  return ss.getSheets()
    .map(sheet => sheet.getName())
    .filter(name => !SYSTEM_SHEETS.includes(name));
}

function getTemplateSheet_(ss) {
  for (const name of TEMPLATE_SHEET_NAMES) {
    const sheet = ss.getSheetByName(name);
    if (sheet) return sheet;
  }
  return ss.getSheets().find(sheet => !SYSTEM_SHEETS.includes(sheet.getName())) || null;
}

function initializeProductSheet_(sheet, sheetName) {
  sheet.getRange(1, 1).setValue('Stock Manager — ' + sheetName);
  sheet.getRange(2, 1, 1, 12).setValues([[
    'ลำดับ', 'SKU', 'ชื่อสินค้า', 'ขนาด',
    'LOT1', 'LOT2', 'LOT3', 'LOT4',
    OH_HEADER, OH_TIME_HEADER, LOT_TIME_HEADER, 'Favorite'
  ]]);
  sheet.getRange(2, 1, 1, 12).setFontWeight('bold');
  ensureColumns_(sheet);
}

function createProductSheet_(ss, sheetName) {
  const templateSheet = getTemplateSheet_(ss);
  let sheet;
  if (templateSheet) {
    sheet = templateSheet.copyTo(ss).setName(sheetName);
    sheet.getRange(1, 1).setValue('Stock Manager — ' + sheetName);
    ensureColumns_(sheet);
    const maxRows = sheet.getMaxRows();
    const maxCols = sheet.getMaxColumns();
    if (maxRows > 2) {
      sheet.getRange(3, 1, maxRows - 2, maxCols).clearContent();
    }
    return sheet;
  }
  sheet = ss.insertSheet(sheetName);
  initializeProductSheet_(sheet, sheetName);
  return sheet;
}

function formatOh_(value) {
  return (value == null ? '' : String(value).trim());
}

// ── ดึงข้อมูลทุกชีท ────────────────────────────────────────────
function getAllSheetData() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const result = {};

    let agingSheet = ss.getSheetByName('Aging_Order');
    let isLegacy = false;
    if (!agingSheet) { agingSheet = ss.getSheetByName('Aging'); isLegacy = true; }
    if (!agingSheet) return JSON.stringify({ success: false, error: 'ไม่พบชีท Aging หรือ Aging_Order' });

    const agingLastRow = agingSheet.getLastRow();
    let masterSequence = [];
    let masterItems = [];

    if (agingLastRow >= 3) {
      if (isLegacy) {
        const agingBarcodesRaw = agingSheet.getRange(3, 2, agingLastRow - 2, 1).getValues();
        masterItems = agingBarcodesRaw
          .map(row => ({ sku: String(row[0] || '').trim(), sheetName: '' }))
          .filter(item => item.sku !== '');
        masterSequence = masterItems.map(item => item.sku);
      } else {
        const agingRaw = agingSheet.getRange(3, 1, agingLastRow - 2, 4).getValues();
        const sortedAging = agingRaw
          .filter(row => String(row[1] || '').trim() !== '')
          .map(row => ({ order: Number(row[0]) || 0, sku: String(row[1]).trim(), sheetName: String(row[3] || '').trim() }))
          .sort((a, b) => a.order - b.order);
        masterItems = sortedAging.map(item => ({ sku: item.sku, sheetName: item.sheetName }));
        masterSequence = masterItems.map(item => item.sku);
      }
    }

    const allRawData = {};
    const mainSheets = getMainSheetNames_(ss);

    mainSheets.forEach(name => {
      const sheet = ss.getSheetByName(name);
      allRawData[name] = {};
      if (sheet) {
        ensureColumns_(sheet);
        const lastRow = sheet.getLastRow();
        if (lastRow >= 3) {
          const vals = sheet.getRange(3, 1, lastRow - 2, 13).getValues();
          vals.forEach((row, idx) => {
            const bc = String(row[1] || '').trim();
            if (bc) {
              const favTime = row[12] instanceof Date && !isNaN(row[12].getTime()) ? row[12].getTime() : 0;
              allRawData[name][bc] = {
                rowIndex: idx + 3,
                barcode: bc,
                name: String(row[2] || '').trim(),
                size: String(row[3] || '').trim(),
                lot1: formatLotDate_(row[4]),
                lot2: formatLotDate_(row[5]),
                lot3: formatLotDate_(row[6]),
                lot4: formatLotDate_(row[7]),
                oh: formatOh_(row[8]),
                ohTime: formatUpdateDate_(row[9]),
                lotTime: formatUpdateDate_(row[10]),
                fav: row[11] === true || String(row[11]).toUpperCase() === 'TRUE',
                favTime: favTime
              };
            }
          });
        }
      }
    });

    const allCombined = [];
    mainSheets.forEach(name => {
      const sheetMap = allRawData[name];
      result[name] = masterSequence
        .filter(bc => sheetMap[bc])
        .map(bc => { const item = sheetMap[bc]; item.sheetName = name; return item; });

      const agingSet = new Set(masterSequence);
      const leftovers = Object.keys(sheetMap)
        .filter(bc => !agingSet.has(bc))
        .map(bc => { const item = sheetMap[bc]; item.sheetName = name; return item; });

      result[name] = result[name].concat(leftovers);
    });

    const addedAllKeys = new Set();
    const pushCombinedItem = (sheetName, sku, missingFromAging) => {
      const item = allRawData[sheetName] && allRawData[sheetName][sku];
      if (!item) return false;
      const key = `${sheetName}::${sku}`;
      if (addedAllKeys.has(key)) return false;
      const clone = JSON.parse(JSON.stringify(item));
      clone.sheetName = sheetName;
      clone.missingFromAging = missingFromAging === true;
      allCombined.push(clone);
      addedAllKeys.add(key);
      return true;
    };

    masterItems.forEach(masterItem => {
      const { sku, sheetName: hintSheet } = masterItem;
      if (hintSheet && allRawData[hintSheet] && allRawData[hintSheet][sku]) {
        pushCombinedItem(hintSheet, sku, false);
      } else {
        for (const sn of mainSheets) {
          if (allRawData[sn] && allRawData[sn][sku]) { pushCombinedItem(sn, sku, false); break; }
        }
      }
    });

    mainSheets.forEach(name => {
      Object.keys(allRawData[name]).forEach(sku => pushCombinedItem(name, sku, true));
    });

    result['All'] = allCombined;

    return JSON.stringify({ success: true, data: result, sheetNames: mainSheets });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

// ── บันทึก LOT ──────────────────────────────────────────────────
function saveLotData(sheetName, rowIndex, l1, l2, l3, l4) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return JSON.stringify({ success: false, error: `ไม่พบชีท: ${sheetName}` });

    const range = sheet.getRange(rowIndex, 5, 1, 4);
    range.setNumberFormat('@');
    range.setValues([[l1 || '', l2 || '', l3 || '', l4 || '']]);
    const now = new Date();
    sheet.getRange(rowIndex, 11).setValue(now);

    return JSON.stringify({ success: true, lotTime: formatUpdateDate_(now) });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

// ── บันทึก SKU + ชื่อ ───────────────────────────────────────────
function saveProductData(sheetName, rowIndex, sku, name) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return JSON.stringify({ success: false, error: `ไม่พบชีท: ${sheetName}` });

    const cleanSku  = String(sku  || '').trim();
    const cleanName = String(name || '').trim();
    const range = sheet.getRange(rowIndex, 2, 1, 2);
    range.setNumberFormat('@');
    range.setValues([[cleanSku, cleanName]]);

    return JSON.stringify({ success: true });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

// ── บันทึก OH ───────────────────────────────────────────────────
function saveOhData(sheetName, rowIndex, oh) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return JSON.stringify({ success: false, error: `ไม่พบชีท: ${sheetName}` });

    const now = new Date();
    sheet.getRange(rowIndex, 9).setValue(formatOh_(oh));
    sheet.getRange(rowIndex, 10).setValue(now);

    return JSON.stringify({ success: true, ohTime: formatUpdateDate_(now) });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

// ── เคลียร์ LOT ─────────────────────────────────────────────────
function clearLotData(sheetName, rowIndex) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return JSON.stringify({ success: false, error: `ไม่พบชีท: ${sheetName}` });

    const now = new Date();
    const range = sheet.getRange(rowIndex, 5, 1, 4);
    range.setNumberFormat('@');
    range.setValues([['', '', '', '']]);
    sheet.getRange(rowIndex, 11).setValue(now);

    return JSON.stringify({ success: true, lotTime: formatUpdateDate_(now) });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

// ── Toggle Favorite ──────────────────────────────────────────────
function toggleFavorite(sheetName, rowIndex, currentStatus) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return JSON.stringify({ success: false, error: `ไม่พบชีท: ${sheetName}` });

    if (sheet.getMaxColumns() < 13) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), 13 - sheet.getMaxColumns());
    }

    const newStatus = !currentStatus;
    const now = new Date();
    sheet.getRange(rowIndex, 12).setValue(newStatus);
    if (newStatus) sheet.getRange(rowIndex, 13).setValue(now);

    return JSON.stringify({ success: true, fav: newStatus, favTime: newStatus ? now.getTime() : null });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

// ── เพิ่มสินค้าใหม่ ──────────────────────────────────────────────
function addProduct(sheetName, sku, name, size) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    sheetName = formatOh_(sheetName);
    if (!sheetName) return JSON.stringify({ success: false, error: 'กรุณาระบุชื่อหมวดหมู่' });
    if (SYSTEM_SHEETS.includes(sheetName)) return JSON.stringify({ success: false, error: `ไม่สามารถใช้ชื่อชีทระบบ: ${sheetName}` });

    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = createProductSheet_(ss, sheetName);

    const cleanSku  = formatOh_(sku);
    const cleanName = formatOh_(name);
    const lastRow = sheet.getLastRow();

    if (lastRow >= 3) {
      const existingSkus = sheet.getRange(3, 2, lastRow - 2, 1).getValues();
      for (let row of existingSkus) {
        if (String(row[0]).trim() === cleanSku) {
          return JSON.stringify({ success: false, error: `รหัสสินค้านี้มีอยู่แล้วในชีท ${sheetName}` });
        }
      }
    }

    const newRowData = ['', cleanSku, cleanName, size, '', '', '', '', '', '', '', false];
    sheet.appendRow(newRowData);
    const newRowIndex = sheet.getLastRow();
    sheet.getRange(newRowIndex, 2).setNumberFormat('@');

    let agingSheet = ss.getSheetByName('Aging_Order');
    let isLegacy = false;
    if (!agingSheet) { agingSheet = ss.getSheetByName('Aging'); isLegacy = true; }

    if (agingSheet) {
      const agingLastRow = agingSheet.getLastRow();
      let nextOrder = 1;
      if (!isLegacy && agingLastRow >= 3) {
        const orders = agingSheet.getRange(3, 1, agingLastRow - 2, 1).getValues();
        let maxOrder = 0;
        orders.forEach(row => { const val = Number(row[0]); if (!isNaN(val) && val > maxOrder) maxOrder = val; });
        nextOrder = maxOrder + 1;
      } else if (isLegacy && agingLastRow >= 3) {
        nextOrder = agingLastRow - 2 + 1;
      }
      if (!isLegacy) {
        agingSheet.appendRow([nextOrder, cleanSku, cleanName, sheetName]);
        agingSheet.getRange(agingSheet.getLastRow(), 2).setNumberFormat('@');
      } else {
        agingSheet.appendRow(['', cleanSku, cleanName, size, '', '', '', '', '', '', '', false]);
        const nr = agingSheet.getLastRow();
        agingSheet.getRange(nr, 2).setNumberFormat('@');
        agingSheet.getRange(nr, 5, 1, 4).setNumberFormat('@');
      }
    }

    return JSON.stringify({ success: true, data: { rowIndex: newRowIndex, sku: cleanSku, name: cleanName, size: size, sheetName: sheetName } });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

// ── สลับลำดับสินค้า ──────────────────────────────────────────────
function reorderProduct(skuA, skuB) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const agingSheet = ss.getSheetByName('Aging_Order');
    if (!agingSheet) return JSON.stringify({ success: false, error: 'ฟีเจอร์นี้รองรับเฉพาะ Aging_Order เท่านั้น' });

    const lastRow = agingSheet.getLastRow();
    if (lastRow < 3) return JSON.stringify({ success: false, error: 'ไม่มีข้อมูลใน Aging_Order' });

    const skus = agingSheet.getRange(3, 2, lastRow - 2, 1).getValues();
    let rowA = -1, rowB = -1;
    for (let i = 0; i < skus.length; i++) {
      const cur = String(skus[i][0]).trim();
      if (cur === String(skuA).trim()) rowA = i + 3;
      if (cur === String(skuB).trim()) rowB = i + 3;
      if (rowA !== -1 && rowB !== -1) break;
    }

    if (rowA !== -1 && rowB !== -1) {
      const dataA = agingSheet.getRange(rowA, 2, 1, 3).getValues();
      const dataB = agingSheet.getRange(rowB, 2, 1, 3).getValues();
      agingSheet.getRange(rowA, 2, 1, 3).setValues(dataB);
      agingSheet.getRange(rowB, 2, 1, 3).setValues(dataA);
      return JSON.stringify({ success: true });
    }

    return JSON.stringify({ success: false, error: 'ไม่พบสินค้าที่ต้องการสลับ' });
  } catch (err) {
    return JSON.stringify({ success: false, error: err.message });
  }
}
