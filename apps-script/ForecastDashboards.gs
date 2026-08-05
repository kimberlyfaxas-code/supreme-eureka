/*******************************************************
 * ForecastDashboards.gs (CANONICAL DASHBOARDS) — FIXED
 *
 * Uses canonical _Dashboard_Data built by ForecastDashboardData.gs
 *
 * Dashboards:
 * - Executive Dashboard
 * - CSM Dashboard
 * - FY2026 Monthly Waterfall
 *
 * Filters:
 * - Product
 * - Booking Type (multi-select: Renewal / New Logo / Cross Sell)
 * - Outreach Status
 * - Forecast Category
 * - Manual (Include/Exclude/Only)   [based on Is Manual Add boolean]
 * - Adjs  (Include/Exclude)         [based on Is Adjustment boolean]
 *
 * FIXES INCLUDED:
 * - All filter logic is BOOLEAN-safe (TRUE/FALSE), not 1/0
 * - Multi-select booking mask uses REGEXMATCH (boolean)
 * - Any multiplied mask fed to FILTER() is forced boolean via >0
 * - Lists formulas are syntactically valid (previous version missing closing parens)
 * - Waterfall masks are boolean-safe and consistent
 *******************************************************/
const FD = {
  // Sheet names
  HELPER_SHEET: "_Dashboard_Data",
  LISTS_SHEET: "_Dashboard_Lists",
  EXEC_SHEET: "Health Retention Dashboard (FY2026)",
  CSM_SHEET: "CSM Retention Dashboard (FY2026)",
  WF_SHEET: "FY2026 Monthly Waterfall",
  // Filter options
  PRODUCT_ALLOW: ["All", "Nursing", "iHuman", "Med", "Allied Health"],
  MANUAL_OPTIONS: ["Include", "Exclude", "Only"],
  ADJ_OPTIONS: ["Include", "Exclude"],
  BOOKING_TYPES: ["All", "Renewal", "New Logo", "Cross Sell"],
  THEME: {
    NAVY: "#0b2e4d",
    CARD: "#ffffff",
    BG: "#f5f7fa",
    GRID: "#dde3ea",
    MUTED: "#6b7280",
    BORDER: "#c7d0da"
  }
};
/*********************************
 * Public entry point
 *********************************/
function FD_buildDashboards() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Ensure lists has what dashboards need (Booking, Outreach, Forecast Category)
  FD_ensureListsForDashboards_(ss);
  // Build dashboards
  FD_buildExec_(ss);
  FD_buildCsm_(ss);
  FD_buildWaterfallMonthly_(ss);
}
/*********************************
 * EXEC DASHBOARD
 *********************************/
function FD_buildExec_(ss) {
  const sh = FD_getOrCreate_(ss, FD.EXEC_SHEET);
  sh.clear();
  sh.setFrozenRows(2);
  sh.getRange("A1:P1").merge().setValue("Health Retention Dashboard (FY2026)")
    .setBackground(FD.THEME.NAVY).setFontColor("#fff").setFontSize(16).setFontWeight("bold")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(1, 34);
  sh.getRange("A2:P2").setBackground("#eef2f7");
  sh.getRange("A2:P2").clearContent().clearDataValidations();
  // Filters row 2 (Exec)
  // Product (C2), Booking (E2), Outreach (G2), Forecast Category (I2), Manual (K2), Adjs (M2)
  sh.getRange("B2").setValue("Product").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("C2").setValue("All");
  sh.getRange("D2").setValue("Booking Type").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("E2").setValue("All");
  sh.getRange("F2").setValue("Outreach").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("G2").setValue("All");
  sh.getRange("H2").setValue("Forecast Category").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("I2").setValue("All");
  sh.getRange("J2").setValue("Manual").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("K2").setValue("Include");
  sh.getRange("L2").setValue("Adjs").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("M2").setValue("Include");
  // Validations
  const lists = ss.getSheetByName(FD.LISTS_SHEET);
  // Product: use lists sheet (includes "All") if available, else hardcoded with "All" prepended
  if (lists) FD_setRangeValidation_(sh.getRange("C2"), lists.getRange("A2:A"));
  else FD_setListValidation_(sh.getRange("C2"), ["All", ...FD.PRODUCT_ALLOW]);
  // Booking Type uses multi-select handler on E2
  if (lists) FD_setRangeValidation_(sh.getRange("E2"), lists.getRange("K2:K"));
  else FD_setListValidation_(sh.getRange("E2"), FD.BOOKING_TYPES);
  // Outreach
  if (lists) FD_setRangeValidation_(sh.getRange("G2"), lists.getRange("I2:I"));
  else FD_setListValidation_(sh.getRange("G2"), ["All"]);
  // Forecast Category
  if (lists && String(lists.getRange("M1").getValue() || "").trim() === "Forecast Category") {
    FD_setRangeValidation_(sh.getRange("I2"), lists.getRange("M2:M"));
  } else {
    FD_setListValidation_(sh.getRange("I2"), ["All"]);
  }
  FD_setListValidation_(sh.getRange("K2"), FD.MANUAL_OPTIONS);
  FD_setListValidation_(sh.getRange("M2"), FD.ADJ_OPTIONS);
  // ---- Force defaults AFTER validations (prevents blank until user clicks) ----
  const vC2 = String(sh.getRange("C2").getDisplayValue() || "").trim();
  if (!vC2) sh.getRange("C2").setValue("All");
  const vE2 = String(sh.getRange("E2").getDisplayValue() || "").trim();
  if (!vE2) sh.getRange("E2").setValue("All");
  const vG2 = String(sh.getRange("G2").getDisplayValue() || "").trim();
  if (!vG2) sh.getRange("G2").setValue("All");
  const vI2 = String(sh.getRange("I2").getDisplayValue() || "").trim();
  if (!vI2) sh.getRange("I2").setValue("All");
  const vK2 = String(sh.getRange("K2").getDisplayValue() || "").trim();
  if (!vK2) sh.getRange("K2").setValue("Include");
  const vM2 = String(sh.getRange("M2").getDisplayValue() || "").trim();
  if (!vM2) sh.getRange("M2").setValue("Include");
  // KPI block
  sh.getRange("B4:J8")
    .setBackground(FD.THEME.CARD)
    .setBorder(true, true, true, true, false, false, FD.THEME.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeights(4, 5, 28);
  sh.getRange("B4").setValue("Total Forecast").setFontWeight("bold");
  sh.getRange("D4").setValue("Total Baseline").setFontWeight("bold");
  sh.getRange("F4").setValue("Variance").setFontWeight("bold");
  sh.getRange("H4").setValue("Gross Retention").setFontWeight("bold");
  // Section headers — must merge before setValue to avoid repeating text in every cell
  sh.getRange("A10:P10").merge().setBackground(FD.THEME.NAVY).setFontColor("#fff").setFontWeight("bold")
    .setValue("MONTHLY PERFORMANCE");
  sh.getRange("A24:P24").merge().setBackground(FD.THEME.NAVY).setFontColor("#fff").setFontWeight("bold")
    .setValue("QUARTERLY PERFORMANCE");
  FD_writeExecTablesAndCharts_(ss, sh);
}
/*********************************
 * CSM DASHBOARD
 *********************************/
function FD_buildCsm_(ss) {
  const sh = FD_getOrCreate_(ss, FD.CSM_SHEET);
  sh.clear();
  sh.setFrozenRows(2);
  sh.getRange("A1:P1").merge().setValue("CSM Retention Dashboard (FY2026)")
    .setBackground(FD.THEME.NAVY).setFontColor("#fff").setFontSize(16).setFontWeight("bold")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(1, 34);
  sh.getRange("A2:P2").setBackground("#eef2f7");
  sh.getRange("A2:P2").clearContent().clearDataValidations();
  // Filters row 2 (CSM)
  // CSM (C2), Product (E2), Booking (G2), Outreach (I2), Forecast Category (K2), Manual (M2), Adjs (O2)
  sh.getRange("B2").setValue("Filter CSM").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("C2").setValue("All");
  sh.getRange("D2").setValue("Product").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("E2").setValue("All");
  sh.getRange("F2").setValue("Booking Type").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("G2").setValue("All");
  sh.getRange("H2").setValue("Outreach").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("I2").setValue("All");
  sh.getRange("J2").setValue("Forecast Category").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("K2").setValue("All");
  sh.getRange("L2").setValue("Manual").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("M2").setValue("Include");
  sh.getRange("N2").setValue("Adjs").setFontColor(FD.THEME.MUTED).setFontWeight("bold");
  sh.getRange("O2").setValue("Include");
  const lists = ss.getSheetByName(FD.LISTS_SHEET);
  // CSM + Product validations
  if (lists) {
    FD_setRangeValidation_(sh.getRange("C2"), lists.getRange("C2:C"));
    FD_setRangeValidation_(sh.getRange("E2"), lists.getRange("A2:A"));
  } else {
    FD_setListValidation_(sh.getRange("C2"), ["All"]);
    FD_setListValidation_(sh.getRange("E2"), FD.PRODUCT_ALLOW);
  }
  // Booking Type uses multi-select handler on G2
  if (lists) FD_setRangeValidation_(sh.getRange("G2"), lists.getRange("K2:K"));
  else FD_setListValidation_(sh.getRange("G2"), FD.BOOKING_TYPES);
  // Outreach
  if (lists) FD_setRangeValidation_(sh.getRange("I2"), lists.getRange("I2:I"));
  else FD_setListValidation_(sh.getRange("I2"), ["All"]);
  // Forecast Category
  if (lists && String(lists.getRange("M1").getValue() || "").trim() === "Forecast Category") {
    FD_setRangeValidation_(sh.getRange("K2"), lists.getRange("M2:M"));
  } else {
    FD_setListValidation_(sh.getRange("K2"), ["All"]);
  }
  // Manual/Adjs
  FD_setListValidation_(sh.getRange("M2"), FD.MANUAL_OPTIONS);
  FD_setListValidation_(sh.getRange("O2"), FD.ADJ_OPTIONS);
  // ---- Force defaults AFTER validations (prevents blank until user clicks) ----
  const vC2 = String(sh.getRange("C2").getDisplayValue() || "").trim();
  if (!vC2) sh.getRange("C2").setValue("All");
  const vE2 = String(sh.getRange("E2").getDisplayValue() || "").trim();
  if (!vE2) sh.getRange("E2").setValue("All");
  const vG2 = String(sh.getRange("G2").getDisplayValue() || "").trim();
  if (!vG2) sh.getRange("G2").setValue("All");
  const vI2 = String(sh.getRange("I2").getDisplayValue() || "").trim();
  if (!vI2) sh.getRange("I2").setValue("All");
  const vK2 = String(sh.getRange("K2").getDisplayValue() || "").trim();
  if (!vK2) sh.getRange("K2").setValue("All");
  const vM2 = String(sh.getRange("M2").getDisplayValue() || "").trim();
  if (!vM2) sh.getRange("M2").setValue("Include");
  const vO2 = String(sh.getRange("O2").getDisplayValue() || "").trim();
  if (!vO2) sh.getRange("O2").setValue("Include");
  // KPI block
  sh.getRange("B4:J8")
    .setBackground(FD.THEME.CARD)
    .setBorder(true, true, true, true, false, false, FD.THEME.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeights(4, 5, 28);
  sh.getRange("B4").setValue("Forecast").setFontWeight("bold");
  sh.getRange("D4").setValue("Baseline").setFontWeight("bold");
  sh.getRange("F4").setValue("Variance").setFontWeight("bold");
  sh.getRange("H4").setValue("Retention").setFontWeight("bold");
  // Section headers — must merge before setValue to avoid repeating text in every cell
  sh.getRange("A10:P10").merge().setBackground(FD.THEME.NAVY).setFontColor("#fff").setFontWeight("bold")
    .setValue("MONTHLY PERFORMANCE");
  sh.getRange("A24:P24").merge().setBackground(FD.THEME.NAVY).setFontColor("#fff").setFontWeight("bold")
    .setValue("QUARTERLY PERFORMANCE");
  FD_writeCsmTablesAndCharts_(ss, sh);
}
/*********************************
 * MONTHLY WATERFALL
 *********************************/
function FD_buildWaterfallMonthly_(ss) {
  const sh = FD_getOrCreate_(ss, FD.WF_SHEET);
  sh.clear();
  sh.setFrozenRows(3);
  sh.getRange("A1:P1").merge().setValue("FY2026 Monthly Waterfall (Baseline → Ending Forecast)")
    .setBackground(FD.THEME.NAVY).setFontColor("#fff").setFontSize(16).setFontWeight("bold")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.setRowHeight(1, 34);
  sh.getRange("A2:P2").setBackground("#eef2f7");
  sh.getRange("A2:P2").clearContent().clearDataValidations();
  // Filters row 2 (Waterfall)
  // A2 Month, C2 Product, E2 CSM, G2 Booking, I2 Outreach, K2 Forecast Category, M2 Manual, O2 Adjs
  sh.getRange("A2").setValue("Month").setFontWeight("bold").setFontColor(FD.THEME.MUTED);
  sh.getRange("B2").setValue(new Date(2026, 0, 1)).setNumberFormat("mmm-yy"); // DATE value
  sh.getRange("C2").setValue("Product").setFontWeight("bold").setFontColor(FD.THEME.MUTED);
  sh.getRange("D2").setValue("All");
  sh.getRange("E2").setValue("CSM").setFontWeight("bold").setFontColor(FD.THEME.MUTED);
  sh.getRange("F2").setValue("All");
  sh.getRange("G2").setValue("Booking Type").setFontWeight("bold").setFontColor(FD.THEME.MUTED);
  sh.getRange("H2").setValue("All");
  sh.getRange("I2").setValue("Outreach").setFontWeight("bold").setFontColor(FD.THEME.MUTED);
  sh.getRange("J2").setValue("All");
  sh.getRange("K2").setValue("Forecast Category").setFontWeight("bold").setFontColor(FD.THEME.MUTED);
  sh.getRange("L2").setValue("All");
  sh.getRange("M2").setValue("Manual").setFontWeight("bold").setFontColor(FD.THEME.MUTED);
  sh.getRange("N2").setValue("Include");
  sh.getRange("O2").setValue("Adjs").setFontWeight("bold").setFontColor(FD.THEME.MUTED);
  sh.getRange("P2").setValue("Include");
  // validations
  const lists = ss.getSheetByName(FD.LISTS_SHEET);
  const monthList = FD_uniqueMonthsFromHelper_(ss);
  FD_setListValidation_(sh.getRange("B2"), monthList.length ? monthList : [new Date(2026, 0, 1)]);
  sh.getRange("B2").setNumberFormat("mmm-yy");
  if (lists) {
    FD_setRangeValidation_(sh.getRange("D2"), lists.getRange("A2:A"));
    FD_setRangeValidation_(sh.getRange("F2"), lists.getRange("C2:C"));
  } else {
    FD_setListValidation_(sh.getRange("D2"), FD.PRODUCT_ALLOW);
    FD_setListValidation_(sh.getRange("F2"), ["All"]);
  }
  // ---- Force defaults AFTER validations (prevents blank until user clicks) ----
  // Month (B2)
  const b2 = sh.getRange("B2");
  const vB2 = b2.getValue();
  if (!(vB2 instanceof Date) || isNaN(vB2.getTime())) {
    // fall back to first month option
    const fallback = (monthList && monthList.length) ? monthList[0] : new Date(2026, 0, 1);
    b2.setValue(fallback);
    b2.setNumberFormat("mmm-yy");
  }
  // Other filters
  if (!String(sh.getRange("D2").getDisplayValue() || "").trim()) sh.getRange("D2").setValue("All");
  if (!String(sh.getRange("F2").getDisplayValue() || "").trim()) sh.getRange("F2").setValue("All");
  if (!String(sh.getRange("H2").getDisplayValue() || "").trim()) sh.getRange("H2").setValue("All");
  if (!String(sh.getRange("J2").getDisplayValue() || "").trim()) sh.getRange("J2").setValue("All");
  if (!String(sh.getRange("L2").getDisplayValue() || "").trim()) sh.getRange("L2").setValue("All");
  if (!String(sh.getRange("N2").getDisplayValue() || "").trim()) sh.getRange("N2").setValue("Include");
  if (!String(sh.getRange("P2").getDisplayValue() || "").trim()) sh.getRange("P2").setValue("Include");
  // Booking Type uses multi-select handler on H2
  if (lists) FD_setRangeValidation_(sh.getRange("H2"), lists.getRange("K2:K"));
  else FD_setListValidation_(sh.getRange("H2"), FD.BOOKING_TYPES);
  // Outreach
  if (lists) FD_setRangeValidation_(sh.getRange("J2"), lists.getRange("I2:I"));
  else FD_setListValidation_(sh.getRange("J2"), ["All"]);
  // Forecast Category
  if (lists && String(lists.getRange("M1").getValue() || "").trim() === "Forecast Category") {
    FD_setRangeValidation_(sh.getRange("L2"), lists.getRange("M2:M"));
  } else {
    FD_setListValidation_(sh.getRange("L2"), ["All"]);
  }
  FD_setListValidation_(sh.getRange("N2"), FD.MANUAL_OPTIONS);
  FD_setListValidation_(sh.getRange("P2"), FD.ADJ_OPTIONS);
  // KPI header
  sh.getRange("A4:P4").setBackground(FD.THEME.NAVY).setFontColor("#fff").setFontWeight("bold")
    .setValue("TOTAL WATERFALL");
  sh.getRange("B6:D6").merge().setValue("Baseline").setFontWeight("bold");
  sh.getRange("E6:G6").merge().setValue("Ending Forecast").setFontWeight("bold");
  sh.getRange("H6:J6").merge().setValue("Net Change").setFontWeight("bold");
  sh.getRange("K6:M6").merge().setValue("% Change").setFontWeight("bold");
  sh.getRange("B7:D7").merge().setNumberFormat("$#,##0;($#,##0)");
  sh.getRange("E7:G7").merge().setNumberFormat("$#,##0;($#,##0)");
  sh.getRange("H7:J7").merge().setNumberFormat("$#,##0;($#,##0)");
  sh.getRange("K7:M7").merge().setNumberFormat("0.0%");
  // Chart zone
  sh.getRange("A6:P21").setBackground("#ffffff");
  sh.getRange("A6:P21").setBorder(true, true, true, true, false, false, FD.THEME.BORDER, SpreadsheetApp.BorderStyle.SOLID);
  // Table header
  sh.getRange("A22:P22").setBackground(FD.THEME.NAVY).setFontColor("#fff").setFontWeight("bold")
    .setValue("WATERFALL TABLE (TOTAL + BY PRODUCT)");
  FD_writeWaterfall_(ss, sh);
  sh.setColumnWidths(1, 16, 85);
  sh.setRowHeights(22, 13, 22);
}
/********************** HELP: DYNAMIC _Dashboard_Data COLS ***************************/
function FD_colToA1_(colNum) {
  let n = colNum;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function FD_helperHeaderMap_(helperSheet) {
  const lastCol = helperSheet.getLastColumn();
  if (lastCol < 1) return {};
  const headers = helperSheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const k = String(h || "").trim().toLowerCase();
    if (k) map[k] = i + 1; // 1-based column index
  });
  return map;
}
function FD_helperColA1_(helperSheet, headerName) {
  const hm = FD_helperHeaderMap_(helperSheet);
  const key = String(headerName || "").trim().toLowerCase();
  const col = hm[key];
  if (!col) return null;
  return FD_colToA1_(col); // like "X"
}
function FD_helperColRange_(helperName, helperSheet, headerName, fallbackRangeA1) {
  const colA1 = FD_helperColA1_(helperSheet, headerName);
  const lastRow = Math.max(2, helperSheet.getLastRow());
  if (!colA1) {
    // If fallback is like 'Sheet'!F2:F, convert it to bounded automatically
    const m = String(fallbackRangeA1).match(/'([^']+)'!([A-Z]+)2:\2$/);
    if (m) return `'${m[1]}'!${m[2]}2:${m[2]}${lastRow}`;
    return fallbackRangeA1;
  }
  return `'${helperName}'!${colA1}2:${colA1}${lastRow}`;
}
/*********************************
 * Exec tables + line chart
 *********************************/
function FD_writeExecTablesAndCharts_(ss, sh) {
  const helperName = FD.HELPER_SHEET;
  const helper = ss.getSheetByName(helperName);
  if (!helper) throw new Error(`Missing helper sheet: ${helperName}`);
  const mask = FD_execMaskFormula_(helperName, sh);
  const maskB = `(${mask})>0`;
  const BM = FD_helperColRange_(helperName, helper, "Baseline Month",  `'${helperName}'!F2:F`);
  const FM = FD_helperColRange_(helperName, helper, "Forecast Month",  `'${helperName}'!G2:G`);
  const BA = FD_helperColRange_(helperName, helper, "Baseline Amount", `'${helperName}'!H2:H`);
  const FA = FD_helperColRange_(helperName, helper, "Forecast Amount", `'${helperName}'!I2:I`);
  // KPI formulas — sum monthly table (rows 12-23, col F=Total, col B=Baseline)
  // Monthly cells already apply the full filter mask, so these totals are always correct
  sh.getRange("B6").setFormula("=SUM(F12:F23)").setNumberFormat("$#,##0;($#,##0)").setFontSize(14).setFontWeight("bold");
  sh.getRange("D6").setFormula("=SUM(B12:B23)").setNumberFormat("$#,##0;($#,##0)").setFontSize(14).setFontWeight("bold");
  sh.getRange("F6").setFormula("=B6-D6").setNumberFormat("$#,##0;($#,##0)").setFontSize(14).setFontWeight("bold");
  sh.getRange("H6").setFormula('=IF(D6=0,"",B6/D6)').setNumberFormat("0.0%").setFontSize(14).setFontWeight("bold");
  // Column widths
  sh.setColumnWidth(1, 80);
  sh.setColumnWidth(2, 115);
  sh.setColumnWidth(3, 125);
  sh.setColumnWidth(4, 110);
  sh.setColumnWidth(5, 110);
  sh.setColumnWidth(6, 120);
  sh.setColumnWidth(7, 110);
  sh.setColumnWidth(8, 100);
  // Monthly table — col order: Month | Baseline | On-Time | Late | Early | Total | Variance | Retention %
  const startRow = 11;
  sh.getRange(startRow, 1, 1, 8)
    .setValues([["Month","Baseline","On-Time Forecast","Late Bookings","Early Bookings","Total Forecast","Variance","Retention %"]])
    .setFontWeight("bold").setBackground("#eef2f7");
  // Movement column header colors
  sh.getRange(startRow, 3).setBackground("#D1FAE5").setFontColor("#166534");
  sh.getRange(startRow, 4).setBackground("#FEF3C7").setFontColor("#92400E");
  sh.getRange(startRow, 5).setBackground("#DBEAFE").setFontColor("#1E40AF");
  const months = FD_monthOrderFY26Dates_();
  sh.getRange(startRow + 1, 1, months.length, 1).setValues(months.map(d => [d]));
  sh.getRange(startRow + 1, 1, months.length, 1).setNumberFormat("mmm-yy");
  for (let i = 0; i < months.length; i++) {
    const r = startRow + 1 + i;
    const mCell = `A${r}`;
    const monthMaskOnTime   = `((${mask})*N(${BM}=${mCell})*N(${FM}=${mCell}))>0`;
    const monthMaskLate     = `((${mask})*N(${FM}=${mCell})*N(${BM}<${mCell}))>0`;
    const monthMaskEarly    = `((${mask})*N(${FM}=${mCell})*N(${BM}>${mCell}))>0`;
    const monthMaskBaseline = `((${mask})*N(${BM}=${mCell}))>0`;
    sh.getRange(r, 2).setFormula(`=IFERROR(SUM(FILTER(${BA}, ${monthMaskBaseline})),0)`).setNumberFormat("$#,##0;($#,##0)").setFontWeight("bold");
    sh.getRange(r, 3).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${monthMaskOnTime})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 4).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${monthMaskLate})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 5).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${monthMaskEarly})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 6).setFormula(`=C${r}+D${r}+E${r}`).setNumberFormat("$#,##0;($#,##0)").setFontWeight("bold");
    sh.getRange(r, 7).setFormula(`=F${r}-B${r}`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 8).setFormula(`=IF(B${r}=0,"",F${r}/B${r})`).setNumberFormat("0.0%");
  }
  // Movement column background tints
  sh.getRange(startRow + 1, 3, months.length, 1).setBackground("#F0FDF4");
  sh.getRange(startRow + 1, 4, months.length, 1).setBackground("#FFFBEB");
  sh.getRange(startRow + 1, 5, months.length, 1).setBackground("#EFF6FF");
  // Quarterly table
  const qRow = 25;
  sh.getRange(qRow, 1, 1, 8)
    .setValues([["Quarter","Baseline","On-Time Forecast","Late Bookings","Early Bookings","Total Forecast","Variance","Retention %"]])
    .setFontWeight("bold").setBackground("#eef2f7");
  sh.getRange(qRow, 3).setBackground("#D1FAE5").setFontColor("#166534");
  sh.getRange(qRow, 4).setBackground("#FEF3C7").setFontColor("#92400E");
  sh.getRange(qRow, 5).setBackground("#DBEAFE").setFontColor("#1E40AF");
  const quarters = [
    ["Q1 2026", [new Date(2026,0,1), new Date(2026,1,1), new Date(2026,2,1)]],
    ["Q2 2026", [new Date(2026,3,1), new Date(2026,4,1), new Date(2026,5,1)]],
    ["Q3 2026", [new Date(2026,6,1), new Date(2026,7,1), new Date(2026,8,1)]],
    ["Q4 2026", [new Date(2026,9,1), new Date(2026,10,1), new Date(2026,11,1)]]
  ];
  sh.getRange(qRow + 1, 1, quarters.length, 1).setValues(quarters.map(q => [q[0]]));
  for (let i = 0; i < quarters.length; i++) {
    const r = qRow + 1 + i;
    const dateConsts  = `{${quarters[i][1].map(d => FD_dateConst_(d)).join(",")}}`;
    const qFirstDate  = FD_dateConst_(quarters[i][1][0]);
    const qLastDate   = FD_dateConst_(quarters[i][1][2]);
    const qMaskOnTime   = `((${mask})*N(ISNUMBER(MATCH(${BM}, ${dateConsts}, 0)))*N(ISNUMBER(MATCH(${FM}, ${dateConsts}, 0))))>0`;
    const qMaskLate     = `((${mask})*N(ISNUMBER(MATCH(${FM}, ${dateConsts}, 0)))*N(ISNA(MATCH(${BM}, ${dateConsts}, 0)))*N(${BM}<${qFirstDate}))>0`;
    const qMaskEarly    = `((${mask})*N(ISNUMBER(MATCH(${FM}, ${dateConsts}, 0)))*N(ISNA(MATCH(${BM}, ${dateConsts}, 0)))*N(${BM}>${qLastDate}))>0`;
    const qMaskBaseline = `((${mask})*N(ISNUMBER(MATCH(${BM}, ${dateConsts}, 0))))>0`;
    sh.getRange(r, 2).setFormula(`=IFERROR(SUM(FILTER(${BA}, ${qMaskBaseline})),0)`).setNumberFormat("$#,##0;($#,##0)").setFontWeight("bold");
    sh.getRange(r, 3).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${qMaskOnTime})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 4).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${qMaskLate})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 5).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${qMaskEarly})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 6).setFormula(`=C${r}+D${r}+E${r}`).setNumberFormat("$#,##0;($#,##0)").setFontWeight("bold");
    sh.getRange(r, 7).setFormula(`=F${r}-B${r}`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 8).setFormula(`=IF(B${r}=0,"",F${r}/B${r})`).setNumberFormat("0.0%");
  }
  sh.getRange(qRow + 1, 3, quarters.length, 1).setBackground("#F0FDF4");
  sh.getRange(qRow + 1, 4, quarters.length, 1).setBackground("#FFFBEB");
  sh.getRange(qRow + 1, 5, quarters.length, 1).setBackground("#EFF6FF");
  // Conditional formatting — Retention % (goal = 95%) and Variance
  const retMonthly   = sh.getRange(startRow + 1, 8, months.length, 1);
  const retQuarterly = sh.getRange(qRow + 1, 8, quarters.length, 1);
  const varMonthly   = sh.getRange(startRow + 1, 7, months.length, 1);
  const varQuarterly = sh.getRange(qRow + 1, 7, quarters.length, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThanOrEqualTo(0.95)
      .setBackground("#DCFCE7").setFontColor("#166534")
      .setRanges([retMonthly, retQuarterly]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberBetween(0.80, 0.9499)
      .setBackground("#FEF9C3").setFontColor("#854D0E")
      .setRanges([retMonthly, retQuarterly]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0.80)
      .setBackground("#FEE2E2").setFontColor("#991B1B")
      .setRanges([retMonthly, retQuarterly]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setFontColor("#166534")
      .setRanges([varMonthly, varQuarterly]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0)
      .setFontColor("#DC2626")
      .setRanges([varMonthly, varQuarterly]).build()
  ]);
  // Remove any stale charts
  sh.getCharts().forEach(c => sh.removeChart(c));
  SpreadsheetApp.flush();
}
/*********************************
 * CSM tables + line chart
 *********************************/
function FD_writeCsmTablesAndCharts_(ss, sh) {
  const helperName = FD.HELPER_SHEET;
  const helper = ss.getSheetByName(helperName);
  if (!helper) throw new Error(`Missing helper sheet: ${helperName}`);
// boolean-safe expression
const mask = FD_csmMaskFormula_(helperName, sh);
const maskB = `(${mask})>0`;
  const BM = FD_helperColRange_(helperName, helper, "Baseline Month",  `'${helperName}'!F2:F`);
  const FM = FD_helperColRange_(helperName, helper, "Forecast Month",  `'${helperName}'!G2:G`);
  const BA = FD_helperColRange_(helperName, helper, "Baseline Amount", `'${helperName}'!H2:H`);
  const FA = FD_helperColRange_(helperName, helper, "Forecast Amount", `'${helperName}'!I2:I`);
  sh.getRange("B6").setFormula("=SUM(F12:F23)").setNumberFormat("$#,##0;($#,##0)").setFontSize(14).setFontWeight("bold");
  sh.getRange("D6").setFormula("=SUM(B12:B23)").setNumberFormat("$#,##0;($#,##0)").setFontSize(14).setFontWeight("bold");
  sh.getRange("F6").setFormula("=B6-D6").setNumberFormat("$#,##0;($#,##0)").setFontSize(14).setFontWeight("bold");
  sh.getRange("H6").setFormula('=IF(D6=0,"",B6/D6)').setNumberFormat("0.0%").setFontSize(14).setFontWeight("bold");
  const startRow = 11;
  sh.getRange(startRow, 1, 1, 8)
    .setValues([["Month","Baseline","On-Time Forecast","Late Bookings","Early Bookings","Total Forecast","Variance","Retention %"]])
    .setFontWeight("bold").setBackground("#eef2f7");
  sh.getRange(startRow, 3).setBackground("#D1FAE5").setFontColor("#166534");
  sh.getRange(startRow, 4).setBackground("#FEF3C7").setFontColor("#92400E");
  sh.getRange(startRow, 5).setBackground("#DBEAFE").setFontColor("#1E40AF");
  // Column widths
  sh.setColumnWidth(1, 80);
  sh.setColumnWidth(2, 115);
  sh.setColumnWidth(3, 125);
  sh.setColumnWidth(4, 110);
  sh.setColumnWidth(5, 110);
  sh.setColumnWidth(6, 120);
  sh.setColumnWidth(7, 110);
  sh.setColumnWidth(8, 100);
  const months = FD_monthOrderFY26Dates_();
  sh.getRange(startRow + 1, 1, months.length, 1).setValues(months.map(d => [d]));
  sh.getRange(startRow + 1, 1, months.length, 1).setNumberFormat("mmm-yy");
  for (let i = 0; i < months.length; i++) {
    const r = startRow + 1 + i;
    const mCell = `A${r}`;
    const monthMaskOnTime   = `((${mask})*N(${BM}=${mCell})*N(${FM}=${mCell}))>0`;
    const monthMaskLate     = `((${mask})*N(${FM}=${mCell})*N(${BM}<${mCell}))>0`;
    const monthMaskEarly    = `((${mask})*N(${FM}=${mCell})*N(${BM}>${mCell}))>0`;
    const monthMaskBaseline = `((${mask})*N(${BM}=${mCell}))>0`;
    sh.getRange(r, 2).setFormula(`=IFERROR(SUM(FILTER(${BA}, ${monthMaskBaseline})),0)`).setNumberFormat("$#,##0;($#,##0)").setFontWeight("bold");
    sh.getRange(r, 3).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${monthMaskOnTime})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 4).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${monthMaskLate})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 5).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${monthMaskEarly})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 6).setFormula(`=C${r}+D${r}+E${r}`).setNumberFormat("$#,##0;($#,##0)").setFontWeight("bold");
    sh.getRange(r, 7).setFormula(`=F${r}-B${r}`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 8).setFormula(`=IF(B${r}=0,"",F${r}/B${r})`).setNumberFormat("0.0%");
  }
  sh.getRange(startRow + 1, 3, months.length, 1).setBackground("#F0FDF4");
  sh.getRange(startRow + 1, 4, months.length, 1).setBackground("#FFFBEB");
  sh.getRange(startRow + 1, 5, months.length, 1).setBackground("#EFF6FF");
  const qRow = 25;
  sh.getRange(qRow, 1, 1, 8)
    .setValues([["Quarter","Baseline","On-Time Forecast","Late Bookings","Early Bookings","Total Forecast","Variance","Retention %"]])
    .setFontWeight("bold").setBackground("#eef2f7");
  sh.getRange(qRow, 3).setBackground("#D1FAE5").setFontColor("#166534");
  sh.getRange(qRow, 4).setBackground("#FEF3C7").setFontColor("#92400E");
  sh.getRange(qRow, 5).setBackground("#DBEAFE").setFontColor("#1E40AF");
  const quarters = [
    ["Q1 2026", [new Date(2026,0,1), new Date(2026,1,1), new Date(2026,2,1)]],
    ["Q2 2026", [new Date(2026,3,1), new Date(2026,4,1), new Date(2026,5,1)]],
    ["Q3 2026", [new Date(2026,6,1), new Date(2026,7,1), new Date(2026,8,1)]],
    ["Q4 2026", [new Date(2026,9,1), new Date(2026,10,1), new Date(2026,11,1)]]
  ];
  sh.getRange(qRow + 1, 1, quarters.length, 1).setValues(quarters.map(q => [q[0]]));
  for (let i = 0; i < quarters.length; i++) {
    const r = qRow + 1 + i;
    const dateConsts  = `{${quarters[i][1].map(d => FD_dateConst_(d)).join(",")}}`;
    const qFirstDate  = FD_dateConst_(quarters[i][1][0]);
    const qLastDate   = FD_dateConst_(quarters[i][1][2]);
    const qMaskOnTime   = `((${mask})*N(ISNUMBER(MATCH(${BM}, ${dateConsts}, 0)))*N(ISNUMBER(MATCH(${FM}, ${dateConsts}, 0))))>0`;
    const qMaskLate     = `((${mask})*N(ISNUMBER(MATCH(${FM}, ${dateConsts}, 0)))*N(ISNA(MATCH(${BM}, ${dateConsts}, 0)))*N(${BM}<${qFirstDate}))>0`;
    const qMaskEarly    = `((${mask})*N(ISNUMBER(MATCH(${FM}, ${dateConsts}, 0)))*N(ISNA(MATCH(${BM}, ${dateConsts}, 0)))*N(${BM}>${qLastDate}))>0`;
    const qMaskBaseline = `((${mask})*N(ISNUMBER(MATCH(${BM}, ${dateConsts}, 0))))>0`;
    sh.getRange(r, 2).setFormula(`=IFERROR(SUM(FILTER(${BA}, ${qMaskBaseline})),0)`).setNumberFormat("$#,##0;($#,##0)").setFontWeight("bold");
    sh.getRange(r, 3).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${qMaskOnTime})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 4).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${qMaskLate})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 5).setFormula(`=IFERROR(SUM(FILTER(${FA}, ${qMaskEarly})),0)`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 6).setFormula(`=C${r}+D${r}+E${r}`).setNumberFormat("$#,##0;($#,##0)").setFontWeight("bold");
    sh.getRange(r, 7).setFormula(`=F${r}-B${r}`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(r, 8).setFormula(`=IF(B${r}=0,"",F${r}/B${r})`).setNumberFormat("0.0%");
  }
  sh.getRange(qRow + 1, 3, quarters.length, 1).setBackground("#F0FDF4");
  sh.getRange(qRow + 1, 4, quarters.length, 1).setBackground("#FFFBEB");
  sh.getRange(qRow + 1, 5, quarters.length, 1).setBackground("#EFF6FF");
  // Conditional formatting — Retention % (goal = 95%) and Variance
  const retMonthly   = sh.getRange(startRow + 1, 8, months.length, 1);
  const retQuarterly = sh.getRange(qRow + 1, 8, quarters.length, 1);
  const varMonthly   = sh.getRange(startRow + 1, 7, months.length, 1);
  const varQuarterly = sh.getRange(qRow + 1, 7, quarters.length, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThanOrEqualTo(0.95)
      .setBackground("#DCFCE7").setFontColor("#166534")
      .setRanges([retMonthly, retQuarterly]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberBetween(0.80, 0.9499)
      .setBackground("#FEF9C3").setFontColor("#854D0E")
      .setRanges([retMonthly, retQuarterly]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0.80)
      .setBackground("#FEE2E2").setFontColor("#991B1B")
      .setRanges([retMonthly, retQuarterly]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setFontColor("#166534")
      .setRanges([varMonthly, varQuarterly]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0)
      .setFontColor("#DC2626")
      .setRanges([varMonthly, varQuarterly]).build()
  ]);
  sh.getCharts().forEach(c => sh.removeChart(c));
  SpreadsheetApp.flush();
}
/*********************************
 * Waterfall math + stacked chart
 *********************************/
function FD_writeWaterfall_(ss, sh) {
  const helperName = FD.HELPER_SHEET;
  const categories = [
    "Baseline",
    "Adjustments",
    "Lost Logo",
    "Moved Out (Booked Early)",
    "Moved Out (Pushed Forward)",
    "Pulled In (From Prior)",
    "Pulled In (From Future)",
    "Downsell",
    "Upsell",
    "Manual Adds – Renewal",
    "Manual Adds – New Logo",
    "Manual Adds – Cross Sell",
    "Variance / Other",
    "Ending Forecast"
  ];
  const categoryRowStart = 24;
  sh.getRange(categoryRowStart - 1, 1, 1, 7)
    .setValues([["Category","TOTAL ($)","Nursing","Med","iHuman","Allied Health","Context"]])
    .setFontWeight("bold").setBackground("#eef2f7");
  sh.getRange(categoryRowStart, 1, categories.length, 1)
    .setValues(categories.map(c => [c]));
  const monthCell    = "$B$2";
  const productCell  = "$D$2";
  const csmCell      = "$F$2";
  const bookingCell  = "$H$2";
  const outreachCell = "$J$2";
  const fcatCell     = "$L$2";
  const manualCell   = "$N$2";
  const adjsCell     = "$P$2";
  // Numeric mask (terms are boolean) — we will wrap with >0 when using FILTER
  const baseMask = FD_wfBaseMaskFormula_(
    helperName,
    productCell,
    csmCell,
    manualCell,
    adjsCell,
    bookingCell,
    outreachCell,
    fcatCell
  );
  const helper = ss.getSheetByName(helperName);
  if (!helper) throw new Error(`Missing helper sheet: ${helperName}`);
  const BM   = FD_helperColRange_(helperName, helper, "Baseline Month",  `'${helperName}'!F2:F`);
  const FM   = FD_helperColRange_(helperName, helper, "Forecast Month",  `'${helperName}'!G2:G`);
  const BA   = FD_helperColRange_(helperName, helper, "Baseline Amount", `'${helperName}'!H2:H`);
  const FA   = FD_helperColRange_(helperName, helper, "Forecast Amount", `'${helperName}'!I2:I`);
  const ISMANUAL = FD_helperColRange_(helperName, helper, "Is Manual Add",   `'${helperName}'!L2:L`);
  const ISADJ    = FD_helperColRange_(helperName, helper, "Is Adjustment",   `'${helperName}'!M2:M`);
  const BOOK     = FD_helperColRange_(helperName, helper, "Booking Type",    `'${helperName}'!X2:X`);
  const sumf = (f) => `IFERROR(SUM(${f}),0)`;
  // Helper to build boolean FILTER conditions
  const WFCOND = (extraNumericMask) => `((${baseMask})*(${extraNumericMask}))>0`;
  // Baseline total (non-adjustments) in month
  const baselineAmt = `FILTER(${BA}, ${WFCOND(`(${BM}=${monthCell})*(${ISADJ}=FALSE)`)})`;
  // Adjustments that hit baseline month
  const adjAmt      = `FILTER(${BA}, ${WFCOND(`(${BM}=${monthCell})*(${ISADJ}=TRUE)`)})`;
  // Ending forecast in month (includes manual + non-manual)
  const endingAmt   = `FILTER(${FA}, ${WFCOND(`(${FM}=${monthCell})`)})`;
  // Movement out of baseline month
  const movedOutEarly   = `FILTER(${BA}, ${WFCOND(`(${BM}=${monthCell})*(${ISADJ}=FALSE)*(${FM}<${monthCell})`)})`;
  const movedOutForward = `FILTER(${BA}, ${WFCOND(`(${BM}=${monthCell})*(${ISADJ}=FALSE)*(${FM}>${monthCell})`)})`;
  // Movement into forecast month
  const pulledInPrior  = `FILTER(${FA}, ${WFCOND(`(${FM}=${monthCell})*(${ISADJ}=FALSE)*(${BM}<${monthCell})`)})`;
  const pulledInFuture = `FILTER(${FA}, ${WFCOND(`(${FM}=${monthCell})*(${ISADJ}=FALSE)*(${BM}>${monthCell})`)})`;
  // Lost logo (baseline in month; no forecast / 0 forecast)
  const lostLogo = `FILTER(${BA}, ${WFCOND(`(${BM}=${monthCell})*(${ISADJ}=FALSE)*((${FA}=0)+(${FM}=""))`)})`;
  // Same-month downsell / upsell
  const downsell = `FILTER((${BA}-${FA}), ${WFCOND(`(${BM}=${monthCell})*(${FM}=${monthCell})*(${BA}>${FA})`)})`;
  const upsell   = `FILTER((${FA}-${BA}), ${WFCOND(`(${BM}=${monthCell})*(${FM}=${monthCell})*(${FA}>${BA})`)})`;
  // Manual adds in month (by booking type)
  const manualRenewal   = `FILTER(${FA}, ${WFCOND(`(${FM}=${monthCell})*(${ISMANUAL}=TRUE)*((${BOOK}="Renewal")+(${BOOK}="Renewal "))`)})`;
  const manualNewLogo   = `FILTER(${FA}, ${WFCOND(`(${FM}=${monthCell})*(${ISMANUAL}=TRUE)*((${BOOK}="New Logo")+(${BOOK}="New Logo "))`)})`;
  const manualCrossSell = `FILTER(${FA}, ${WFCOND(`(${FM}=${monthCell})*(${ISMANUAL}=TRUE)*((${BOOK}="Cross Sell")+(${BOOK}="Cross Sell "))`)})`;
  const varianceOther =
    `(${sumf(endingAmt)}) - ( ` +
    `(${sumf(baselineAmt)}) + (${sumf(adjAmt)}) ` +
    `- (${sumf(lostLogo)}) - (${sumf(movedOutEarly)}) - (${sumf(movedOutForward)}) ` +
    `+ (${sumf(pulledInPrior)}) + (${sumf(pulledInFuture)}) ` +
    `- (${sumf(downsell)}) + (${sumf(upsell)}) ` +
    `+ (${sumf(manualRenewal)}) + (${sumf(manualNewLogo)}) + (${sumf(manualCrossSell)}) )`;
  const totalFormulas = [
    `=${sumf(baselineAmt)}`,
    `=${sumf(adjAmt)}`,
    `=-${sumf(lostLogo)}`,
    `=-${sumf(movedOutEarly)}`,
    `=-${sumf(movedOutForward)}`,
    `=${sumf(pulledInPrior)}`,
    `=${sumf(pulledInFuture)}`,
    `=-${sumf(downsell)}`,
    `=${sumf(upsell)}`,
    `=${sumf(manualRenewal)}`,
    `=${sumf(manualNewLogo)}`,
    `=${sumf(manualCrossSell)}`,
    `=${varianceOther}`,
    `=${sumf(endingAmt)}`
  ];
  sh.getRange(categoryRowStart, 2, categories.length, 1)
    .setFormulas(totalFormulas.map(x => [x]))
    .setNumberFormat("$#,##0;($#,##0)");
  sh.getRange(categoryRowStart, 7, categories.length, 1).setValues([
    ["Starting Amount (non-adjustments)"],
    ["Adjustments applied to baseline month"],
    ["Baseline lines with no forecast / $0 forecast"],
    ["Baseline moved to earlier month"],
    ["Baseline moved to later month (incl 2027)"],
    ["Forecast pulled in from earlier month"],
    ["Forecast pulled in from later month"],
    ["Same-month contraction (BA > FA)"],
    ["Same-month expansion (FA > BA)"],
    ["Manual adds in month (Renewal)"],
    ["Manual adds in month (New Logo)"],
    ["Manual adds in month (Cross Sell)"],
    ["Residual to tie to ending forecast"],
    ["Ending Forecast"]
  ]).setFontColor(FD.THEME.MUTED);
  // Top totals
  sh.getRange("B7").setFormula(`=B${categoryRowStart}`);
  sh.getRange("E7").setFormula(`=B${categoryRowStart + categories.length - 1}`);
  sh.getRange("H7").setFormula("=E7-B7");
  sh.getRange("K7").setFormula("=IF(B7=0,0,H7/B7)");
  SpreadsheetApp.flush();
  const stepsA1 = sh.getRange(categoryRowStart, 1, categories.length, 2).getA1Notation();
  const helperA1 = FD_wfWriteStackedChartData_(sh, stepsA1, 2, 28);
  SpreadsheetApp.flush();
  FD_wfUpsertStackedWaterfallChart_(sh, helperA1, 7, 2, "");
}
/*********************************
 * Waterfall chart helper data
 *********************************/
function FD_wfWriteStackedChartData_(sh, stepRangeA1, outTopRow, outLeftCol) {
  const steps = sh.getRange(stepRangeA1).getValues();
  const clean = steps.filter(r => String(r[0] || "").trim() !== "" && r[1] !== "" && r[1] !== null);
  if (clean.length < 2) return null;
  const labels = clean.map(r => String(r[0] || "").trim());
  const amounts = clean.map(r => Number(r[1]) || 0);
  const totalIdx = new Set([0, clean.length - 1]);
  let running = 0;
  const out = [];
  out.push(["Category", "Base", "Increase", "Decrease", "Total"]);
  for (let i = 0; i < clean.length; i++) {
    const label = labels[i];
    const val = amounts[i];
    if (totalIdx.has(i)) {
      out.push([label, 0, 0, 0, val]);
      if (i === 0) running = val;
      continue;
    }
    const base = running;
    const inc = val > 0 ? val : 0;
    const dec = val < 0 ? Math.abs(val) : 0;
    out.push([label, base, inc, dec, 0]);
    running = running + val;
  }
  const rng = sh.getRange(outTopRow, outLeftCol, out.length, out[0].length);
  rng.clearContent();
  rng.setValues(out);
  sh.getRange(outTopRow + 1, outLeftCol + 1, out.length - 1, 4)
    .setNumberFormat("$#,##0;($#,##0)");
  sh.getRange(outTopRow, outLeftCol, out.length, out[0].length).setFontColor("#ffffff");
  return rng.getA1Notation();
}
function FD_wfUpsertStackedWaterfallChart_(sh, dataA1, posRow, posCol, title) {
  sh.getCharts().forEach(c => sh.removeChart(c));
  if (!dataA1) return;
  const builder = sh.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange(dataA1))
    .setNumHeaders(1)
    .setPosition(posRow, posCol, 0, 0)
    .setOption("title", title || "")
    .setOption("isStacked", true)
    .setOption("legend", { position: "none" })
    .setOption("backgroundColor", "#ffffff")
    .setOption("chartArea", { left: 70, top: 10, width: "92%", height: "80%" })
    .setOption("hAxis", { slantedText: true, slantedTextAngle: 30, textStyle: { fontSize: 11 } })
    .setOption("vAxis", { format: "$#,###", textStyle: { fontSize: 11 } })
    .setOption("series", {
      0: { color: "#FFFFFF", visibleInLegend: false },
      1: { visibleInLegend: false },
      2: { visibleInLegend: false },
      3: { visibleInLegend: false }
    });
  sh.insertChart(builder.build());
}
/*********************************
 * MASKS (BOOLEAN SAFE)
 *********************************/
function FD_execMaskFormula_(helperName, sh) {
  const product  = "$C$2";
  const booking  = "$E$2";
  const outreach = "$G$2";
  const fcat     = "$I$2";
  const manual   = "$K$2";
  const adjs     = "$M$2";
  const helper = SpreadsheetApp.getActive().getSheetByName(helperName);
  if (!helper) throw new Error(`Missing helper sheet: ${helperName}`);
  const prodCol     = FD_helperColRange_(helperName, helper, "Product",           `'${helperName}'!B2:B`);
  const bookCol     = FD_helperColRange_(helperName, helper, "Booking Type",      `'${helperName}'!X2:X`);
  const outCol      = FD_helperColRange_(helperName, helper, "Outreach Status",   `'${helperName}'!T2:T`);
  const catCol      = FD_helperColRange_(helperName, helper, "Forecast Category", `'${helperName}'!R2:R`);
  const isManualCol = FD_helperColRange_(helperName, helper, "Is Manual Add",     `'${helperName}'!L2:L`);
  const isAdjCol    = FD_helperColRange_(helperName, helper, "Is Adjustment",     `'${helperName}'!M2:M`);
  const productMask  = `N(IF(${product}="All",TRUE,${prodCol}=${product}))`;
  const bookingMask  = FD_multiSelectMask_(booking, bookCol); // returns N(...)
  const outreachMask = `N(IF(${outreach}="All",TRUE,${outCol}=${outreach}))`;
  const fcatMask     = `N(IF(${fcat}="All",TRUE,${catCol}=${fcat}))`;
  const manualMask = FD_manualBoolMask_(manual, isManualCol);
  const adjsMask   = FD_adjBoolMask_(adjs, isAdjCol);
  return `(${productMask})*(${bookingMask})*(${outreachMask})*(${fcatMask})*(${manualMask})*(${adjsMask})`;
}
function FD_csmMaskFormula_(helperName, sh) {
  const csm      = "$C$2";
  const product  = "$E$2";
  const booking  = "$G$2";
  const outreach = "$I$2";
  const fcat     = "$K$2";
  const manual   = "$M$2";
  const adjs     = "$O$2";
  const helper = SpreadsheetApp.getActive().getSheetByName(helperName);
  if (!helper) throw new Error(`Missing helper sheet: ${helperName}`);
  const csmCol     = FD_helperColRange_(helperName, helper, "CSM",               `'${helperName}'!C2:C`);
  const prodCol    = FD_helperColRange_(helperName, helper, "Product",           `'${helperName}'!B2:B`);
  const bookCol    = FD_helperColRange_(helperName, helper, "Booking Type",      `'${helperName}'!X2:X`);
  const outCol     = FD_helperColRange_(helperName, helper, "Outreach Status",   `'${helperName}'!T2:T`);
  const catCol     = FD_helperColRange_(helperName, helper, "Forecast Category", `'${helperName}'!R2:R`);
  const isManualCol= FD_helperColRange_(helperName, helper, "Is Manual Add",     `'${helperName}'!L2:L`);
  const isAdjCol   = FD_helperColRange_(helperName, helper, "Is Adjustment",     `'${helperName}'!M2:M`);
  const csmMask      = `N(IF(${csm}="All",TRUE,${csmCol}=${csm}))`;
  const productMask  = `N(IF(${product}="All",TRUE,${prodCol}=${product}))`;
  const bookingMask  = FD_multiSelectMask_(booking, bookCol); // returns N(...)
  const outreachMask = `N(IF(${outreach}="All",TRUE,${outCol}=${outreach}))`;
  const fcatMask     = `N(IF(${fcat}="All",TRUE,${catCol}=${fcat}))`;
  const manualMask = FD_manualBoolMask_(manual, isManualCol);
  const adjsMask   = FD_adjBoolMask_(adjs, isAdjCol);
  return `(${csmMask})*(${productMask})*(${bookingMask})*(${outreachMask})*(${fcatMask})*(${manualMask})*(${adjsMask})`;
}
function FD_wfBaseMaskFormula_(helperName, productCell, csmCell, manualCell, adjsCell, bookingCell, outreachCell, fcatCell) {
  const helper = SpreadsheetApp.getActive().getSheetByName(helperName);
  if (!helper) throw new Error(`Missing helper sheet: ${helperName}`);
  const prodCol     = FD_helperColRange_(helperName, helper, "Product",           `'${helperName}'!B2:B`);
  const csmCol      = FD_helperColRange_(helperName, helper, "CSM",               `'${helperName}'!C2:C`);
  const bookCol     = FD_helperColRange_(helperName, helper, "Booking Type",      `'${helperName}'!X2:X`);
  const outCol      = FD_helperColRange_(helperName, helper, "Outreach Status",   `'${helperName}'!T2:T`);
  const catCol      = FD_helperColRange_(helperName, helper, "Forecast Category", `'${helperName}'!R2:R`);
  const isManualCol = FD_helperColRange_(helperName, helper, "Is Manual Add",     `'${helperName}'!L2:L`);
  const isAdjCol    = FD_helperColRange_(helperName, helper, "Is Adjustment",     `'${helperName}'!M2:M`);
  const productMask  = `IF(${productCell}="All",TRUE,${prodCol}=${productCell})`;
  const csmMask      = `IF(${csmCell}="All",TRUE,${csmCol}=${csmCell})`;
  const bookingMask  = FD_multiSelectMask_(bookingCell, bookCol);
  const outreachMask = `IF(${outreachCell}="All",TRUE,${outCol}=${outreachCell})`;
  const fcatMask     = `IF(${fcatCell}="All",TRUE,${catCol}=${fcatCell})`;
 
  const manualMask = FD_manualBoolMask_(manualCell, isManualCol);
  const adjsMask   = FD_adjBoolMask_(adjsCell, isAdjCol);
  // Return numeric (0/1-ish) expression; caller wraps with >0 after combining with month logic
  return `(${productMask})*(${csmMask})*(${bookingMask})*(${outreachMask})*(${fcatMask})*(${manualMask})*(${adjsMask})`;
}
/*********************************
 * Boolean masks (Manual/Adjs)
 *********************************/
function FD_manualBoolMask_(manualCellRef, isManualColRef) {
  const isTrue  = `N(((${isManualColRef}=TRUE)+(${isManualColRef}="TRUE"))>0)`;
  const isFalse = `N(((${isManualColRef}=FALSE)+(${isManualColRef}="FALSE"))>0)`;
  return `N(IF(${manualCellRef}="Include",TRUE,IF(${manualCellRef}="Exclude",${isFalse}>0,${isTrue}>0)))`;
}
function FD_adjBoolMask_(adjsCellRef, isAdjColRef) {
  const isFalse = `N(((${isAdjColRef}=FALSE)+(${isAdjColRef}="FALSE"))>0)`;
  return `N(IF(${adjsCellRef}="Include",TRUE,${isFalse}>0))`;
}
/*********************************
 * Multi-select mask (Booking Type) — BOOLEAN
 *********************************/
function FD_multiSelectMask_(cellRef, colRef) {
  return `N(IF(${cellRef}="All",TRUE,ISNUMBER(SEARCH(","&SUBSTITUTE(${colRef}," ","")&",",","&SUBSTITUTE(${cellRef}," ","")&","))))`;
}
/*********************************
 * Multi-select dropdown handler
 *********************************/
function FD_multiSelectDropdownOnEdit_(e) {
  try {
    if (!e || !e.range) return;
    const rng = e.range;
    const sh = rng.getSheet();
    const a1 = rng.getA1Notation();
    if (!e.value) return;
    // Booking Type dropdown cells
    const targets = {
      [FD.EXEC_SHEET]: new Set(["E2"]),
      [FD.CSM_SHEET]: new Set(["G2"]),
      [FD.WF_SHEET]: new Set(["H2"])
    };
    if (!targets[sh.getName()] || !targets[sh.getName()].has(a1)) return;
    const newVal = String(e.value).trim();
    const oldVal = String(e.oldValue || "").trim();
    if (newVal.toLowerCase() === "all") {
      rng.setValue("All");
      return;
    }
    if (!oldVal || oldVal.toLowerCase() === "all") {
      rng.setValue(newVal);
      return;
    }
    const parts = oldVal.split(",").map(s => s.trim()).filter(Boolean);
    const set = new Set(parts);
    if (set.has(newVal)) set.delete(newVal);
    else set.add(newVal);
    if (set.size === 0) {
      rng.setValue("All");
      return;
    }
    const ORDER = ["Renewal", "New Logo", "Cross Sell"];
    const rebuilt = ORDER.filter(x => set.has(x)).join(", ");
    rng.setValue(rebuilt || Array.from(set).join(", "));
  } catch (err) {
    // swallow
  }
}
/*********************************
 * Charts
 *********************************/
function FD_upsertLineChart_(sh, range, posRow, posCol, title) {
  sh.getCharts().forEach(c => sh.removeChart(c));
  const builder = sh.newChart()
    .setChartType(Charts.ChartType.LINE)
    .addRange(range)
    .setNumHeaders(1)
    .setPosition(posRow, posCol, 0, 0)
    .setOption("title", title)
    .setOption("width", 500)
    .setOption("height", 320)
    .setOption("legend", { position: "top" })
    .setOption("chartArea", { left: 60, top: 40, width: "85%", height: "65%" })
    .setOption("hAxis", { slantedText: true, slantedTextAngle: 30 })
    .setOption("vAxis", { format: "$#,###" });
  sh.insertChart(builder.build());
}
function FD_addMovementChart_(sh, startRow, numRows, posRow, posCol, title) {
  // Stacked column: Month labels (col 1) + On-Time (col 4), Late Bookings (col 5), Early Bookings (col 6)
  const builder = sh.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange(startRow, 1, numRows, 1))
    .addRange(sh.getRange(startRow, 4, numRows, 3))
    .setNumHeaders(1)
    .setPosition(posRow, posCol, 0, 0)
    .setOption("title", title || "")
    .setOption("width", 500)
    .setOption("height", 320)
    .setOption("isStacked", true)
    .setOption("legend", { position: "top" })
    .setOption("backgroundColor", "#ffffff")
    .setOption("chartArea", { left: 70, top: 40, width: "85%", height: "65%" })
    .setOption("hAxis", { slantedText: true, slantedTextAngle: 30, textStyle: { fontSize: 10 } })
    .setOption("vAxis", { format: "$#,###", textStyle: { fontSize: 10 } })
    .setOption("series", {
      0: { color: "#1a7340" },
      1: { color: "#e07b39" },
      2: { color: "#3b7dd8" }
    });
  sh.insertChart(builder.build());
}
/*********************************
 * Lists sheet safety: ensure needed columns exist
 *********************************/
function FD_ensureListsForDashboards_(ss) {
  const lists = ss.getSheetByName(FD.LISTS_SHEET);
  const helper = ss.getSheetByName(FD.HELPER_SHEET);
  if (!lists || !helper) return;
  const hName = helper.getName();
  // Ensure Booking Type column K exists with stable list
  if (String(lists.getRange("K1").getValue() || "").trim() !== "Booking Type") {
    lists.getRange("K1").setValue("Booking Type").setFontWeight("bold");
    lists.getRange("K2").setValue("All");
    lists.getRange("K3:K5").setValues([["Renewal"], ["New Logo"], ["Cross Sell"]]);
  }
  // Ensure Outreach column I exists (FIXED: valid formula)
  if (String(lists.getRange("I1").getValue() || "").trim() !== "Outreach") {
    lists.getRange("I1").setValue("Outreach").setFontWeight("bold");
    lists.getRange("I2").setValue("All");
    lists.getRange("I3").setFormula(
      `=IFERROR(SORT(UNIQUE(FILTER('${hName}'!T2:T, LEN('${hName}'!T2:T)))),"")`
    );
  }
  // Ensure Forecast Category column M exists (FIXED: valid formula)
  if (String(lists.getRange("M1").getValue() || "").trim() !== "Forecast Category") {
    lists.getRange("M1").setValue("Forecast Category").setFontWeight("bold");
    lists.getRange("M2").setValue("All");
    lists.getRange("M3").setFormula(
      `=IFERROR(SORT(UNIQUE(FILTER('${hName}'!R2:R, LEN('${hName}'!R2:R)))),"")`
    );
  }
}
/*********************************
 * Utilities
 *********************************/
function FD_getOrCreate_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}
function FD_setListValidation_(range, list) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(list, true)
    .setAllowInvalid(false)
    .build();
  range.setDataValidation(rule);
}
function FD_setRangeValidation_(range, srcRange) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(srcRange, true)
    .setAllowInvalid(false)
    .build();
  range.setDataValidation(rule);
}
function FD_monthOrderFY26Dates_() {
  return [
    new Date(2026,0,1), new Date(2026,1,1), new Date(2026,2,1),
    new Date(2026,3,1), new Date(2026,4,1), new Date(2026,5,1),
    new Date(2026,6,1), new Date(2026,7,1), new Date(2026,8,1),
    new Date(2026,9,1), new Date(2026,10,1), new Date(2026,11,1)
  ];
}
function FD_uniqueMonthsFromHelper_(ss) {
  const helper = ss.getSheetByName(FD.HELPER_SHEET);
  if (!helper) return [];
  const lastRow = helper.getLastRow();
  const lastCol = helper.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const hm = FD_helperHeaderMap_(helper);
  const bmCol = hm["baseline month"];
  const fmCol = hm["forecast month"];
  // fallback to old positions if headers missing
  const bmIdx = bmCol ? bmCol - 1 : 5; // 0-based
  const fmIdx = fmCol ? fmCol - 1 : 6;
  const vals = helper.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const out = new Map(); // key yyyy-mm => Date
  for (let i = 0; i < vals.length; i++) {
    const b = vals[i][bmIdx];
    const f = vals[i][fmIdx];
    if (b instanceof Date && !isNaN(b.getTime())) out.set(`${b.getFullYear()}-${b.getMonth()}`, new Date(b.getFullYear(), b.getMonth(), 1));
    if (f instanceof Date && !isNaN(f.getTime())) out.set(`${f.getFullYear()}-${f.getMonth()}`, new Date(f.getFullYear(), f.getMonth(), 1));
  }
  const arr = Array.from(out.values()).sort((a, b) => a.getTime() - b.getTime());
  const fy26 = arr.filter(d => d.getFullYear() === 2026);
  return fy26.length ? fy26 : arr;
}
function FD_dateConst_(d) {
  // Create DATE(y,m,d) constant for Sheets formulas (month is 1-based)
  return `DATE(${d.getFullYear()},${d.getMonth() + 1},1)`;
}