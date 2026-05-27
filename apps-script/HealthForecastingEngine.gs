/**
 * Health Waterfall Engine
 * Reads from _Dashboard_Data (canonical source built by ForecastDashboardData.gs)
 * and generates a waterfall bridge table in the "Health Dashboard" sheet.
 *
 * FIXES vs original:
 * - Removed onOpen() and onEdit() — both conflict with ForecastTools.gs / Triggers.gs
 * - DATA_SHEET updated from "Data_Table_Man" to "_Dashboard_Data"
 * - Column names updated to match _Dashboard_Data headers (Product, CSM, not Product Group/Current CSM)
 * - Added "Include" (col A) filter so excluded rows are skipped
 * - normDate: uses Date object path when val is already a Date; avoids new Date(string) timezone bug
 * - isInPeriod: uses spreadsheet timezone for normalization
 */
const HWE_CFG = {
  DATA_SHEET: "_Dashboard_Data",
  DASH_SHEET: "Health Dashboard",

  COLS: {
    INCLUDE:      "Include",
    LINE_TYPE:    "Forecast Line Type",
    BOOKING_TYPE: "Booking Type",
    PRODUCT:      "Product",
    CSM:          "CSM",
    OUTREACH:     "Outreach Status",
    B_MONTH:      "Baseline Month",
    B_AMT:        "Baseline Amount",
    F_MONTH:      "Forecast Month",
    F_AMT:        "Forecast Amount"
  }
};

/**
 * Main function. Run from Forecast Tools menu or script editor.
 * Reads _Dashboard_Data, applies filters from Health Dashboard row 2, writes waterfall.
 */
function HWE_generateWaterfall() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  const dataSheet = ss.getSheetByName(HWE_CFG.DATA_SHEET);
  const dashSheet = ss.getSheetByName(HWE_CFG.DASH_SHEET);

  if (!dataSheet) {
    ss.toast(`Missing sheet: ${HWE_CFG.DATA_SHEET}. Run "Refresh Dashboard Data" first.`, "Health Waterfall", 6);
    return;
  }
  if (!dashSheet) {
    ss.toast(`Missing sheet: ${HWE_CFG.DASH_SHEET}. Create a tab named "Health Dashboard".`, "Health Waterfall", 6);
    return;
  }

  // 1. Get target period from B1
  const targetFilter = String(dashSheet.getRange("B1").getValue()).trim();
  if (!targetFilter) {
    ss.toast("Enter a Target Month (e.g. 1/1/2026) or Quarter (e.g. Q1 2026) in cell B1.", "Health Waterfall", 6);
    return;
  }

  // 2. Read filter labels from row 2 (label in col N, value in col N+1)
  const filters = {};
  const headerRow = dashSheet.getRange("A2:Z2").getValues()[0];
  const knownCols = Object.values(HWE_CFG.COLS);
  for (let i = 0; i < headerRow.length - 1; i++) {
    const key = String(headerRow[i]).trim();
    if (knownCols.includes(key)) {
      filters[key] = String(headerRow[i + 1]).trim();
    }
  }

  // 3. Read all data rows (including header)
  const rows = HWE_getObjects_(dataSheet);

  // 4. Buckets
  let base = 0, lost = 0, movedEarly = 0, movedPush = 0, downsell = 0;
  let pulledPrior = 0, pulledFuture = 0, upsell = 0, newLogo = 0, crossSell = 0, endFcst = 0;

  // 5. Process rows
  for (const r of rows) {
    // Skip rows where Include is explicitly FALSE
    const inc = r[HWE_CFG.COLS.INCLUDE];
    if (inc === false || String(inc).trim().toLowerCase() === "false") continue;

    // Apply dashboard filters
    let pass = true;
    for (const key of Object.keys(filters)) {
      if (!HWE_matchMulti_(filters[key], r[key])) { pass = false; break; }
    }
    if (!pass) continue;

    const bType = String(r[HWE_CFG.COLS.BOOKING_TYPE] || "").trim().toLowerCase();

    const bDateStr = HWE_normDate_(r[HWE_CFG.COLS.B_MONTH], tz);
    const fDateStr = HWE_normDate_(r[HWE_CFG.COLS.F_MONTH], tz);
    const bAmt = HWE_num_(r[HWE_CFG.COLS.B_AMT]);
    const fAmt = HWE_num_(r[HWE_CFG.COLS.F_AMT]);

    const isBaseInPeriod = HWE_isInPeriod_(bDateStr, targetFilter, tz);
    const isFcstInPeriod = HWE_isInPeriod_(fDateStr, targetFilter, tz);

    if (bType === "new logo") {
      if (isFcstInPeriod) { newLogo += fAmt; endFcst += fAmt; }
      continue;
    }
    if (bType.includes("cross")) {
      if (isFcstInPeriod) { crossSell += fAmt; endFcst += fAmt; }
      continue;
    }

    // Renewals / Adjustments
    if (isBaseInPeriod) {
      base += bAmt;
      if (fAmt === 0) {
        lost += bAmt;
      } else if (fDateStr && fDateStr < bDateStr && !isFcstInPeriod) {
        movedEarly += bAmt;
      } else if (fDateStr && fDateStr > bDateStr && !isFcstInPeriod) {
        movedPush += bAmt;
      } else {
        if (bAmt > fAmt) downsell += (bAmt - fAmt);
        else if (fAmt > bAmt) upsell += (fAmt - bAmt);
      }
    }
    if (isFcstInPeriod) {
      if (bDateStr && bDateStr < fDateStr && !isBaseInPeriod) pulledPrior += fAmt;
      else if (bDateStr && bDateStr > fDateStr && !isBaseInPeriod) pulledFuture += fAmt;
      endFcst += fAmt;
    }
  }

  // 6. Build waterfall rows
  const categories = [
    { name: "Baseline",                    total: true,  val: base },
    HWE_makeCat_("Lost Logo",                       lost,        true),
    HWE_makeCat_("Moved Out (Booked Early)",         movedEarly,  true),
    HWE_makeCat_("Moved Out (Pushed Forward)",       movedPush,   true),
    HWE_makeCat_("Pulled In (From Prior)",           pulledPrior, false),
    HWE_makeCat_("Pulled In (From Future)",          pulledFuture,false),
    HWE_makeCat_("Downsell",                         downsell,    true),
    HWE_makeCat_("Upsell (Renewal)",                 upsell,      false),
    HWE_makeCat_("Cross Sell",                       crossSell,   false),
    HWE_makeCat_("New Logo",                         newLogo,     false),
    { name: "Ending Forecast",             total: true,  val: endFcst }
  ];

  let running = base;
  const outData = [["Waterfall Category", "Base", "Increase", "Decrease", "Total"]];
  for (const cat of categories) {
    if (cat.total) {
      outData.push([cat.name, 0, 0, 0, cat.val]);
      running = cat.val;
    } else {
      const v = Math.abs(cat.val);
      if (v < 0.01) {
        outData.push([cat.name, running, 0, 0, 0]);
      } else if (cat.isDec) {
        running -= v;
        outData.push([cat.name, running, 0, v, 0]);
      } else {
        const rowBase = running;
        running += v;
        outData.push([cat.name, rowBase, v, 0, 0]);
      }
    }
  }

  // 7. Write to dashboard (row 4)
  dashSheet.getRange(4, 1, outData.length, 5).setValues(outData);
  ss.toast(`Waterfall updated. Period: ${targetFilter}`, "Health Waterfall", 5);
}

/* ---- Helpers ---- */

function HWE_getObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  const objs = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.join("") === "") continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = row[j];
    objs.push(obj);
  }
  return objs;
}

function HWE_matchMulti_(filterVal, rowVal) {
  if (!filterVal || String(filterVal).toLowerCase() === "all") return true;
  const criteria = String(filterVal).split(",").map(s => s.trim().toLowerCase());
  return criteria.includes(String(rowVal || "").trim().toLowerCase());
}

function HWE_makeCat_(name, value, naturallyDec) {
  if (value === 0) return { name, isDec: naturallyDec, val: 0 };
  if (value < 0)  return { name, isDec: !naturallyDec, val: Math.abs(value) };
  return { name, isDec: naturallyDec, val: value };
}

function HWE_num_(val) {
  if (typeof val === "number") return val;
  const s = String(val || "").replace(/[$,]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function HWE_normDate_(val, tz) {
  if (!val) return "";
  // Date objects from Apps Script are already correct — format directly
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, tz, "yyyy-MM-dd");
  }
  // Numeric serial (rare when reading from _Dashboard_Data)
  if (typeof val === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + Math.round(val) * 86400000);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, "yyyy-MM-dd");
  }
  return "";
}

function HWE_isInPeriod_(dateStr, target, tz) {
  if (!dateStr) return false;
  const t = target.trim().toUpperCase();
  if (t.startsWith("Q")) {
    return HWE_getQuarter_(dateStr) === t;
  }
  // Monthly comparison — normalize the target using the spreadsheet timezone
  const d = new Date(target);
  if (!isNaN(d.getTime())) {
    const targetNorm = Utilities.formatDate(d, tz, "yyyy-MM-01");
    return dateStr.slice(0, 7) === targetNorm.slice(0, 7);
  }
  return false;
}

function HWE_getQuarter_(dateStr) {
  if (!dateStr) return "";
  const month = parseInt(dateStr.split("-")[1], 10);
  const year = dateStr.split("-")[0];
  return `Q${Math.ceil(month / 3)} ${year}`;
}
