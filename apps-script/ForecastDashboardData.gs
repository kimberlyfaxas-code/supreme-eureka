/*******************************************************
 * ForecastDashboardData.gs (CANONICAL DATA BUILDER — FIXED)
 *
 * Output sheet: _Dashboard_Data
 * Stable columns A:X (so dashboard formulas don’t break)
 *
 * A Include
 * B Product
 * C CSM
 * D Forecast Source
 * E Forecast Line Type
 * F Baseline Month
 * G Forecast Month
 * H Baseline Amount (FY scoped)
 * I Forecast Amount (FY scoped)
 * J Baseline Q
 * K Forecast Q
 * L Is Manual Add
 * M Is Adjustment
 * N Baseline In FY
 * O Forecast In FY
 * P Moved Month
 * Q Moved Quarter
 * R Forecast Category
 * S Forecast Roll-Up
 * T Outreach Status
 * U Δ Amount vs Baseline
 * V Δ Months vs Baseline
 * W Reserved (blank)
 * X Booking Type
 *
 * Also appends 2026_Adjustments into the same dataset:
 * - Uses Baseline Amount + Baseline Month
 * - Uses Forecast Amount + Forecast Month if present (so adjustments can hit forecast too)
 *******************************************************/
const FDDATA = {
  WORKING: "CSM_Working_Forecast",
  ADJUSTMENTS: "2026_Adjustments",
  HELPER: "_Dashboard_Data",
  LISTS: "_Dashboard_Lists",
  FY_START: new Date(2026, 0, 1),
  FY_END: new Date(2026, 11, 31),
  PRODUCT_ALLOW: ["Nursing", "iHuman", "Med", "Allied Health"],
  ROLLUP_OPTIONS: ["All", "Captured", "Expected", "At Risk", "Not Expected"],
  THEME: {
    SOFT_2: "#E7EDF6",
    BORDER: "#D7DEE9",
    TEXT: "#0F172A",
  }
};
/********************** ENTRY ***************************/
function FDDATA_buildDataAndLists() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error("Another refresh is running. Try again in 30 seconds.");
  }
  try {
    const ss = SpreadsheetApp.getActive();
    const helper = FDDATA_getOrCreate_(ss, FDDATA.HELPER);
    const lists  = FDDATA_getOrCreate_(ss, FDDATA.LISTS);
    FDDATA_buildHelper_(ss, helper);
    SpreadsheetApp.flush(); // IMPORTANT: commit helper writes first
    FDDATA_buildLists_(ss); // use ss, not (lists, helper)
    helper.hideSheet();
    lists.hideSheet();
    ss.toast("Dashboard data refreshed.", "Forecast Tools", 4);
  } finally {
    lock.releaseLock();
  }
}
/********************** HELPER ***************************/
function FDDATA_buildHelper_(ss, helper) {
  helper.clear({ contentsOnly: false });
  helper.setHiddenGridlines(true);
  const w = ss.getSheetByName(FDDATA.WORKING);
  if (!w) throw new Error(`Missing sheet: ${FDDATA.WORKING}`);
  const wh = FDDATA_headerMap_(w);
  const cProd = FDDATA_findCol_(wh, ["Product Group", "Product"]);
  const cCSM  = FDDATA_findCol_(wh, ["Current CSM", "Client Success Manager", "CSM"]);
  const cSrc  = FDDATA_findCol_(wh, ["Forecast Source", "Source"]);
  const cType = FDDATA_findCol_(wh, ["Forecast Line Type"]);
  const cBM   = FDDATA_findCol_(wh, ["Baseline Month"]);
  const cBA   = FDDATA_findCol_(wh, ["Baseline Amount", "Base Amount"]);
  const cFM   = FDDATA_findCol_(wh, ["Forecast Month"]);
  const cFA   = FDDATA_findCol_(wh, ["Forecast Amount"]);
  const cCat  = FDDATA_findCol_(wh, ["Forecast Category", "Category", "Stage"]);
  const cManualId = FDDATA_findCol_(wh, ["Manual Line ID", "Manual ID"]);
  const cBooking  = FDDATA_findCol_(wh, ["Booking Type", "Booking Type (Manual)", "Sales Type", "Sales Segment"]);
  const cOut      = FDDATA_findCol_(wh, ["Outreach Status", "Forecast Outreach", "Outreach / Capture Status", "Outreach"]);
  const cAcctName = FDDATA_findCol_(wh, ["Account Name", "Account"]);
  const cAcctId   = FDDATA_findCol_(wh, ["Account Full ID", "Salesforce Account ID (FULL ID)", "FULL ID", "Salesforce Account ID", "Account ID", "SFID"]);
  if (![cProd, cCSM, cSrc, cBM, cBA, cFM, cFA].every(Boolean)) {
    throw new Error(
      "CSM_Working_Forecast missing required headers. Need: Product Group, Current CSM, Forecast Source, Baseline Month/Amount, Forecast Month/Amount."
    );
  }
  const header = [
    "Include",               // A
    "Product",               // B
    "CSM",                   // C
    "Forecast Source",       // D
    "Forecast Line Type",    // E
    "Baseline Month",        // F
    "Forecast Month",        // G
    "Baseline Amount",       // H
    "Forecast Amount",       // I
    "Baseline Q",            // J
    "Forecast Q",            // K
    "Is Manual Add",         // L
    "Is Adjustment",         // M
    "Baseline In FY",        // N
    "Forecast In FY",        // O
    "Moved Month",           // P
    "Moved Quarter",         // Q
    "Forecast Category",     // R
    "Forecast Roll-Up",      // S
    "Outreach Status",       // T
    "Δ Amount vs Baseline",  // U
    "Δ Months vs Baseline",  // V
    "Reserved",              // W
    "Booking Type",          // X
    "Account Name",          // Y
    "Account Full ID"        // Z
  ];
  helper.getRange(1, 1, 1, header.length)
    .setValues([header])
    .setFontWeight("bold")
    .setBackground(FDDATA.THEME.SOFT_2);
  helper.setFrozenRows(1);
  const lastRow = w.getLastRow();
  const lastCol = w.getLastColumn();
  const rows = lastRow >= 2 ? w.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  const out = [];
  for (const r of rows) {
    const prod = FDDATA_normProduct_(r[cProd - 1]);
    const csm  = String(r[cCSM - 1] || "").trim();
    const src  = String(r[cSrc - 1] || "").trim();
    const typ  = cType ? String(r[cType - 1] || "").trim() : "";
    const cat  = cCat ? String(r[cCat - 1] || "").trim() : "";
    const manualId = cManualId ? String(r[cManualId - 1] || "").trim() : "";
    const outStatus = cOut ? String(r[cOut - 1] || "").trim() : "";
    const bm = FDDATA_toMonthDate_(r[cBM - 1]);
    const fm = FDDATA_toMonthDate_(r[cFM - 1]);
    const baRaw = FDDATA_parseCurrency_(r[cBA - 1]);
    const faRaw = FDDATA_parseCurrency_(r[cFA - 1]);
    const bIn = !!(bm && bm >= FDDATA.FY_START && bm <= FDDATA.FY_END);
    const fIn = !!(fm && fm >= FDDATA.FY_START && fm <= FDDATA.FY_END);
    const bq = bm ? FDDATA_qLabel_(bm) : "";
    const fq = fm ? FDDATA_qLabel_(fm) : "";
    const isAdj = /adjust/i.test(src) || /adjust/i.test(typ);
    const isManual = (manualId !== "") || /manual/i.test(src) || /manual/i.test(typ);
    const movedMonth = !isAdj && !!(bm && fm && (bm.getFullYear() !== fm.getFullYear() || bm.getMonth() !== fm.getMonth()));
    const movedQuarter = !isAdj && !!(bm && fm && (bq !== fq));
    // Booking Type (stable)
    let bookingType = cBooking ? String(r[cBooking - 1] || "").trim() : "";
    if (!bookingType) {
      const t = `${typ} ${src}`.toLowerCase();
      if (t.includes("new logo")) bookingType = "New Logo";
      else if (t.includes("cross")) bookingType = "Cross Sell";
      else bookingType = "Renewal";
    }
    const rollup = FDDATA_rollup_(cat);
    // FY-scoped amounts
    const ba = bIn ? baRaw : 0;
    const fa = fIn ? faRaw : 0;
    const deltaAmt = fa - ba;
    const deltaMonths = (bm && fm)
      ? ((fm.getFullYear() - bm.getFullYear()) * 12 + (fm.getMonth() - bm.getMonth()))
      : "";
    out.push([
      true,         // A Include
      prod,         // B Product
      csm,          // C CSM
      src,          // D Forecast Source
      typ,          // E Forecast Line Type
      bm || "",     // F Baseline Month
      fm || "",     // G Forecast Month
      ba,           // H Baseline Amount
      fa,           // I Forecast Amount
      bq,           // J Baseline Q
      fq,           // K Forecast Q
      isManual,     // L Is Manual Add
      isAdj,        // M Is Adjustment
      bIn,          // N Baseline In FY
      fIn,          // O Forecast In FY
      movedMonth,   // P Moved Month
      movedQuarter, // Q Moved Quarter
      cat,          // R Forecast Category
      rollup,       // S Forecast Roll-Up
      outStatus,    // T Outreach Status
      deltaAmt,     // U Δ Amount
      deltaMonths,  // V Δ Months
      "",           // W Reserved
      bookingType,  // X Booking Type
      cAcctName ? String(r[cAcctName - 1] || "").trim() : "",  // Y Account Name
      cAcctId   ? String(r[cAcctId   - 1] || "").trim() : ""   // Z Account Full ID
    ]);
  }
  // Append adjustments
  const adj = ss.getSheetByName(FDDATA.ADJUSTMENTS);
  if (adj) FDDATA_appendAdjustments_(adj, out);
  if (out.length) {
    helper.getRange(2, 1, out.length, header.length).setValues(out);
    // Month formats (F,G)
    helper.getRange(2, 6, out.length, 2).setNumberFormat("mmm-yy");
    // Amount formats (H,I,U)
    helper.getRange(2, 8, out.length, 2).setNumberFormat("$#,##0;($#,##0)");
    helper.getRange(2, 21, out.length, 1).setNumberFormat("$#,##0;($#,##0)");
  }
  helper.autoResizeColumns(1, header.length);
}
/**
 * Append adjustments lines:
 * - Baseline side uses Baseline Amount + Baseline Month
 * - Forecast side uses Forecast Amount + Forecast Month if those columns exist
 */
function FDDATA_appendAdjustments_(adjSheet, out) {
  const ah = FDDATA_headerMap_(adjSheet);
  const cProd = FDDATA_findCol_(ah, ["Product Group", "Product"]);
  const cCSM  = FDDATA_findCol_(ah, ["Current CSM", "CSM", "Client Success Manager"]);
  const cSrc  = FDDATA_findCol_(ah, ["Forecast Source", "Source"]);
  const cType = FDDATA_findCol_(ah, ["Forecast Line Type"]);
  const cBM   = FDDATA_findCol_(ah, ["Baseline Month", "Month", "Date"]);
  const cBA   = FDDATA_findCol_(ah, ["Baseline Amount", "Amount", "Baseline"]);
  const cFM   = FDDATA_findCol_(ah, ["Forecast Month"]);
  const cFA   = FDDATA_findCol_(ah, ["Forecast Amount", "Forecast"]);
  const cCat  = FDDATA_findCol_(ah, ["Forecast Category", "Category", "Stage"]);
  const cOut  = FDDATA_findCol_(ah, ["Outreach Status", "Forecast Outreach", "Outreach / Capture Status", "Outreach"]);
  // If no baseline amount column, nothing to append
  if (!cBA && !cFA) return;
  const lastRow = adjSheet.getLastRow();
  const lastCol = adjSheet.getLastColumn();
  const rows = lastRow >= 2 ? adjSheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  for (const r of rows) {
    const bm = cBM ? FDDATA_toMonthDate_(r[cBM - 1]) : null;
    const fm = cFM ? FDDATA_toMonthDate_(r[cFM - 1]) : null;
    const baRaw = cBA ? FDDATA_parseCurrency_(r[cBA - 1]) : 0;
    const faRaw = cFA ? FDDATA_parseCurrency_(r[cFA - 1]) : 0;
    // Skip truly empty adjustments row
    if (!baRaw && !faRaw) continue;
    const src = cSrc ? String(r[cSrc - 1] || "").trim() : "Adjustment";
    const typ = cType ? String(r[cType - 1] || "").trim() : "Adjustment";
    const cat = cCat ? String(r[cCat - 1] || "").trim() : "Not expected (Adjustment)";
    const outStatus = cOut ? String(r[cOut - 1] || "").trim() : "Adjustment";
    const prod = FDDATA_normProduct_(cProd ? r[cProd - 1] : "Unknown");
    const csm  = cCSM ? String(r[cCSM - 1] || "").trim() : "";
    const bIn = !!(bm && bm >= FDDATA.FY_START && bm <= FDDATA.FY_END);
    const fIn = !!(fm && fm >= FDDATA.FY_START && fm <= FDDATA.FY_END);
    const ba = bIn ? baRaw : 0;
    const fa = fIn ? faRaw : 0;
    const bq = bm ? FDDATA_qLabel_(bm) : "";
    const fq = fm ? FDDATA_qLabel_(fm) : "";
    const rollup = FDDATA_rollup_(cat);
    const deltaAmt = fa - ba;
    const deltaMonths = (bm && fm)
      ? ((fm.getFullYear() - bm.getFullYear()) * 12 + (fm.getMonth() - bm.getMonth()))
      : "";
    out.push([
      true,          // Include
      prod,          // Product
      csm,           // CSM
      src || "Adjustment",
      typ || "Adjustment",
      bm || "",      // Baseline Month
      fm || "",      // Forecast Month
      ba,            // Baseline Amount
      fa,            // Forecast Amount
      bq,            // Baseline Q
      fq,            // Forecast Q
      false,         // Is Manual Add
      true,          // Is Adjustment
      bIn,           // Baseline In FY
      fIn,           // Forecast In FY
      false,         // Moved Month
      false,         // Moved Quarter
      cat,           // Forecast Category
      rollup,        // Forecast Roll-Up
      outStatus,     // Outreach Status
      deltaAmt,      // Δ Amount
      deltaMonths,   // Δ Months
      "",            // Reserved
      "Renewal",     // Booking Type (keep stable; use Adjs filter to isolate)
      "",            // Account Name (not available from adjustments sheet)
      ""             // Account Full ID
    ]);
  }
}
/********************** LISTS ***************************/
function FDDATA_buildLists_(ss) {
const dataSh = ss.getSheetByName("_Dashboard_Data");
let listsSh = ss.getSheetByName("_Dashboard_Lists");
if (!listsSh) listsSh = ss.insertSheet("_Dashboard_Lists");
if (!dataSh) throw new Error("Missing _Dashboard_Data");
const lastRow = Math.max(2, dataSh.getLastRow());
    // READ ONCE: grab only the columns we need (A:X = 24 columns)
    // Your header comment says stable columns A:X. Good.
    const values = dataSh.getRange(2, 1, lastRow - 1, 24).getValues();
    // Column indexes (0-based) from your header mapping:
    // B Product (1), C CSM (2), T Outreach (19), R Forecast Category (17), X Booking Type (23)
    const COL_PRODUCT = 1;
    const COL_CSM = 2;
    const COL_FCAT = 17;
    const COL_OUTREACH = 19;
    const COL_BOOKING = 23;
    const setProduct = new Set();
    const setCsm = new Set();
    const setOutreach = new Set();
    const setFcat = new Set();
    const setBooking = new Set(["Renewal", "New Logo", "Cross Sell"]); // keep stable list
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const p = String(row[COL_PRODUCT] || "").trim();
      if (p) setProduct.add(p);
      const c = String(row[COL_CSM] || "").trim();
      if (c) setCsm.add(c);
      const o = String(row[COL_OUTREACH] || "").trim();
      if (o) setOutreach.add(o);
      const f = String(row[COL_FCAT] || "").trim();
      if (f) setFcat.add(f);
      // booking types might have commas/spaces if multi-select ever lands in data;
      // split defensively.
      const bt = String(row[COL_BOOKING] || "").trim();
      if (bt) {
        bt.split(",").map(s => s.trim()).filter(Boolean).forEach(x => setBooking.add(x));
      }
    }
    const toSortedList = (set) => Array.from(set).sort((a, b) => a.localeCompare(b));
    const products = ["All", ...toSortedList(setProduct)];
    const csms = ["All", ...toSortedList(setCsm)];
    const outreach = ["All", ...toSortedList(setOutreach)];
    const fcats = ["All", ...toSortedList(setFcat)];
    const booking = ["All", ...toSortedList(setBooking)];
    // WRITE ONCE: clear + set headers + dump columns in bulk
    listsSh.clearContents();
    listsSh.getRange("A1").setValue("Product");
    listsSh.getRange("C1").setValue("CSM");
    listsSh.getRange("I1").setValue("Outreach");
    listsSh.getRange("K1").setValue("Booking Type");
    listsSh.getRange("M1").setValue("Forecast Category");
    listsSh.getRange(2, 1, products.length, 1).setValues(products.map(x => [x])); // A
    listsSh.getRange(2, 3, csms.length, 1).setValues(csms.map(x => [x]));         // C
    listsSh.getRange(2, 9, outreach.length, 1).setValues(outreach.map(x => [x])); // I
    listsSh.getRange(2, 11, booking.length, 1).setValues(booking.map(x => [x]));  // K
    listsSh.getRange(2, 13, fcats.length, 1).setValues(fcats.map(x => [x]));      // M
  }
/********************** UTILS ***************************/
function FDDATA_getOrCreate_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function FDDATA_headerMap_(sh) {
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const map = {};
  h.forEach((x, i) => {
    const k = String(x || "").trim().toLowerCase();
    if (k) map[k] = i + 1;
  });
  return map;
}
function FDDATA_findCol_(map, candidates) {
  for (const c of candidates) {
    const k = String(c).trim().toLowerCase();
    if (map[k]) return map[k];
  }
  return null;
}
// Normalize any value to the first day of its month (Date object), else null
function FDDATA_toMonthDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return new Date(v.getFullYear(), v.getMonth(), 1);
  // Sheets sometimes passes dates as numbers (serial)
  if (typeof v === "number" && !isNaN(v)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(v) * 24 * 60 * 60 * 1000;
    const d = new Date(epoch.getTime() + ms);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);
  // "mmm-yy" or "mmm yyyy"
  const mmmYY = s.match(/^([A-Za-z]{3})[- ](\d{2,4})$/);
  if (mmmYY) {
    const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const m = months[mmmYY[1].toLowerCase()];
    let y = parseInt(mmmYY[2], 10);
    if (y < 100) y += 2000;
    if (m !== undefined) return new Date(y, m, 1);
  }
  // m/d/yyyy
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const m = parseInt(mdy[1], 10);
    const y = parseInt(mdy[3], 10);
    if (m >= 1 && m <= 12) return new Date(y, m - 1, 1);
  }
  return null;
}
function FDDATA_qLabel_(d) {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}
function FDDATA_parseCurrency_(v) {
  if (typeof v === "number") return v;
  if (!v) return 0;
  const s = String(v).replace(/[^\d.-]/g, "");
  return Number(s) || 0;
}
function FDDATA_normProduct_(p) {
  const raw = String(p || "").trim();
  if (!raw) return "Unknown";
  if (FDDATA.PRODUCT_ALLOW.includes(raw)) return raw;
  const s = raw.toUpperCase();
  if (s.includes("ALLIED")) return "Allied Health";
  if (s.includes("IHUMAN")) return "iHuman";
  if (s.includes("NURS")) return "Nursing";
  if (s.includes("MED")) return "Med";
  return "Unknown";
}
function FDDATA_rollup_(forecastCategory) {
  const c = String(forecastCategory || "").toLowerCase();
  if (c.includes("adjustment (booked)")) return "Captured";
  if (c.includes("captured")) return "Captured";
  if (c.includes("not expected")) return "Not Expected"; // must come before "expected"
  if (c.includes("expected")) return "Expected";
  if (c.includes("pending")) return "Expected";          // Renewal Pending → Expected
  if (c.includes("risk")) return "At Risk";
  if (c.includes("data error")) return "Not Expected";
  if (c.includes("non-recurring")) return "Not Expected";
  if (c.includes("lost")) return "Not Expected";
  if (c.includes("adjustment")) return "Not Expected";
  return "Not Expected";
}