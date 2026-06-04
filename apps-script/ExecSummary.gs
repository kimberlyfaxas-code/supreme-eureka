/*******************************************************
 * ExecSummary.gs
 * Builds two clean, granular dashboard tabs:
 *
 *  "FY2026 Exec Summary"
 *    - Filter row: Product, CSM, Quarter, Booking Type, Roll-Up
 *    - KPI cards: Forecast, Baseline, Variance, Gross Retention %
 *    - Capture Status breakdown (Captured/Expected/At Risk/Not Expected)
 *    - By Product breakdown
 *    - ACCOUNT DETAIL: full FILTER table — every matching account row
 *
 *  "FY2026 Waterfall"
 *    - Filter row: Product, CSM, Booking Type
 *    - Period selector: pick any month or quarter
 *    - Script-computed waterfall table (Baseline → buckets → Ending Forecast)
 *    - Account-level drilldown tables for each waterfall bucket
 *
 * Prereq: _Dashboard_Data must exist (run FDDATA_buildDataAndLists first).
 *******************************************************/
const ES = {
  EXEC_SHEET: "FY2026 Exec Summary",
  WF_SHEET:   "FY2026 Waterfall",
  DATA:       "_Dashboard_Data",
  PRODUCTS:   ["Nursing", "iHuman", "Med", "Allied Health"],
  ROLLUPS:    ["Captured", "Expected", "At Risk", "Not Expected"],
  QUARTERS:   ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"],
  BOOKING:    ["Renewal", "New Logo", "Cross Sell"],
  THEME: {
    NAVY:         "#0b2e4d",
    WHITE:        "#ffffff",
    BG:           "#f5f7fa",
    MUTED:        "#6b7280",
    BORDER:       "#c7d0da",
    SECTION:      "#eef2f7",
    CAPTURED:     "#155724",
    EXPECTED:     "#0c4a8a",
    AT_RISK:      "#7d4e00",
    NOT_EXPECTED: "#7b1a1a"
  }
};

/* ==================== PUBLIC ENTRY POINTS ==================== */

function ES_buildExecSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(ES.DATA)) {
    throw new Error("Missing _Dashboard_Data. Run FDDATA_buildDataAndLists first.");
  }
  ES_buildSummaryTab_(ss);
  ss.toast("Exec Summary built. Use filter dropdowns in row 2.", "Forecast Tools", 6);
}

function ES_buildWaterfall() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(ES.DATA)) {
    throw new Error("Missing _Dashboard_Data. Run FDDATA_buildDataAndLists first.");
  }
  ES_buildWaterfallTab_(ss);
  ss.toast("Waterfall built. Pick a period in B2, then run ES_refreshWaterfall.", "Forecast Tools", 6);
}

/** Recomputes the waterfall table using the current filter/period selections.
 *  Wire to a button or menu item for one-click refresh. */
function ES_refreshWaterfall() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ES.WF_SHEET);
  if (!sh) { ES_buildWaterfall(); return; }
  ES_computeAndWriteWaterfall_(ss, sh);
  ss.toast("Waterfall refreshed.", "Forecast Tools", 4);
}

/* ==================== EXEC SUMMARY TAB ==================== */

function ES_buildSummaryTab_(ss) {
  const sh = ES_getOrCreate_(ss, ES.EXEC_SHEET);
  sh.clear();
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(2);

  const D = `'${ES.DATA}'`;  // formula shorthand

  // ── Row 1: Title ──────────────────────────────────────────
  sh.setRowHeight(1, 40);
  sh.getRange("A1:N1").merge()
    .setValue("FY2026 Retention Forecast  —  Exec Summary")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff")
    .setFontSize(15).setFontWeight("bold")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.getRange("A1").setIndent(1);

  // ── Row 2: Filters ────────────────────────────────────────
  sh.setRowHeight(2, 30);
  sh.getRange("A2:N2").setBackground(ES.THEME.SECTION);

  const filters = [
    { label: "Product",       labelCol: "B", valCol: "C" },
    { label: "CSM",           labelCol: "E", valCol: "F" },
    { label: "Quarter",       labelCol: "H", valCol: "I" },
    { label: "Booking Type",  labelCol: "K", valCol: "L" },
    { label: "Roll-Up",       labelCol: "N", valCol: "O" }
  ];
  filters.forEach(f => {
    sh.getRange(`${f.labelCol}2`).setValue(f.label + ":").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
    sh.getRange(`${f.valCol}2`).setValue("All");
  });

  const lists = ss.getSheetByName("_Dashboard_Lists");
  ES_listVal_(sh.getRange("C2"), ["All", ...ES.PRODUCTS]);
  if (lists) ES_rangeVal_(sh.getRange("F2"), lists.getRange("C2:C"));
  else ES_listVal_(sh.getRange("F2"), ["All"]);
  ES_listVal_(sh.getRange("I2"), ["All", ...ES.QUARTERS]);
  ES_listVal_(sh.getRange("L2"), ["All", ...ES.BOOKING]);
  ES_listVal_(sh.getRange("O2"), ["All", ...ES.ROLLUPS]);

  // Base mask — all SUMPRODUCT and FILTER formulas use this
  // _Dashboard_Data cols: A=Include, B=Product, C=CSM, K=Forecast Q, S=Roll-Up, X=Booking Type
  const m =
    `(${D}!$A$2:$A=TRUE)` +
    `*(IF($C$2="All",1,${D}!$B$2:$B=$C$2))` +
    `*(IF($F$2="All",1,${D}!$C$2:$C=$F$2))` +
    `*(IF($I$2="All",1,${D}!$K$2:$K=$I$2))` +
    `*(IF($L$2="All",1,${D}!$X$2:$X=$L$2))` +
    `*(IF($O$2="All",1,${D}!$S$2:$S=$O$2))`;

  // ── Row 3: spacer ─────────────────────────────────────────
  sh.setRowHeight(3, 8);

  // ── Rows 4-6: KPI cards ───────────────────────────────────
  sh.setRowHeight(4, 22); sh.setRowHeight(5, 36); sh.setRowHeight(6, 8);

  const kpis = [
    { range: "B4:C5", label: "Total Forecast",    formula: `=SUMPRODUCT(${m},${D}!$I$2:$I)`,        fmt: "$#,##0",          color: ES.THEME.NAVY },
    { range: "E4:F5", label: "Total Baseline",     formula: `=SUMPRODUCT(${m},${D}!$H$2:$H)`,        fmt: "$#,##0",          color: ES.THEME.NAVY },
    { range: "H4:I5", label: "Variance",           formula: `=B5-E5`,                                 fmt: "$#,##0;($#,##0)", color: ES.THEME.AT_RISK },
    { range: "K4:L5", label: "Gross Retention %",  formula: `=IFERROR(B5/E5-1,"—")`,                  fmt: "0.0%",            color: ES.THEME.EXPECTED }
  ];
  kpis.forEach(k => {
    const [tl] = k.range.split(":");
    sh.getRange(k.range).merge()
      .setBackground(ES.THEME.WHITE)
      .setBorder(true,true,true,true,false,false, ES.THEME.BORDER, SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(tl).setValue(k.label).setFontColor(ES.THEME.MUTED).setFontWeight("bold").setFontSize(9);
    // value cell is one row below label in merged range — put formula in row 5
    const valCell = tl.replace(/\d+/, "5");
    sh.getRange(valCell).setFormula(k.formula).setNumberFormat(k.fmt)
      .setFontSize(16).setFontWeight("bold").setFontColor(k.color);
  });

  // ── Row 7: spacer, Row 8: Capture Status header ──────────
  sh.setRowHeight(7, 8);
  sh.setRowHeight(8, 26);
  sh.getRange("B8:N8").merge()
    .setValue("CAPTURE STATUS BREAKDOWN")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff").setFontWeight("bold");

  // Column headers
  sh.setRowHeight(9, 20);
  [["B9","Status"],["D9","Forecast $"],["F9","Baseline $"],["H9","Variance $"],["J9","# Accounts"],["L9","% of Total Fcst"]].forEach(([cell, label]) => {
    sh.getRange(cell).setValue(label).setFontWeight("bold").setBackground(ES.THEME.SECTION).setFontSize(9);
  });

  const rollupColors = { "Captured": ES.THEME.CAPTURED, "Expected": ES.THEME.EXPECTED, "At Risk": ES.THEME.AT_RISK, "Not Expected": ES.THEME.NOT_EXPECTED };
  ES.ROLLUPS.forEach((ru, i) => {
    const r = 10 + i;
    sh.setRowHeight(r, 24);
    const rm = m + `*(${D}!$S$2:$S="${ru}")`;
    sh.getRange(`B${r}:C${r}`).merge().setValue(ru).setFontColor(rollupColors[ru]).setFontWeight("bold");
    sh.getRange(`D${r}:E${r}`).merge().setFormula(`=SUMPRODUCT(${rm},${D}!$I$2:$I)`).setNumberFormat("$#,##0");
    sh.getRange(`F${r}:G${r}`).merge().setFormula(`=SUMPRODUCT(${rm},${D}!$H$2:$H)`).setNumberFormat("$#,##0");
    sh.getRange(`H${r}:I${r}`).merge().setFormula(`=D${r}-F${r}`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(`J${r}:K${r}`).merge().setFormula(`=IFERROR(SUMPRODUCT((${rm})>0),0)`).setNumberFormat("0");
    sh.getRange(`L${r}:M${r}`).merge().setFormula(`=IFERROR(D${r}/$B$5,"—")`).setNumberFormat("0.0%");
  });
  // Totals row
  const totR = 14;
  sh.setRowHeight(totR, 26);
  sh.getRange(`B${totR}:C${totR}`).merge().setValue("TOTAL").setFontWeight("bold").setBackground(ES.THEME.SECTION);
  sh.getRange(`D${totR}:E${totR}`).merge().setFormula(`=SUM(D10:D13)`).setNumberFormat("$#,##0").setFontWeight("bold").setBackground(ES.THEME.SECTION);
  sh.getRange(`F${totR}:G${totR}`).merge().setFormula(`=SUM(F10:F13)`).setNumberFormat("$#,##0").setFontWeight("bold").setBackground(ES.THEME.SECTION);
  sh.getRange(`H${totR}:I${totR}`).merge().setFormula(`=D${totR}-F${totR}`).setNumberFormat("$#,##0;($#,##0)").setFontWeight("bold").setBackground(ES.THEME.SECTION);

  // ── Row 16: By Product ────────────────────────────────────
  sh.setRowHeight(15, 8);
  sh.setRowHeight(16, 26);
  sh.getRange("B16:N16").merge()
    .setValue("BY PRODUCT")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff").setFontWeight("bold");

  sh.setRowHeight(17, 20);
  [["B17","Product"],["D17","Forecast $"],["F17","Baseline $"],["H17","Variance $"],["J17","Retention %"],["L17","# Accounts"]].forEach(([cell, label]) => {
    sh.getRange(cell).setValue(label).setFontWeight("bold").setBackground(ES.THEME.SECTION).setFontSize(9);
  });
  ES.PRODUCTS.forEach((prod, i) => {
    const r = 18 + i;
    sh.setRowHeight(r, 24);
    const pm = m + `*(${D}!$B$2:$B="${prod}")`;
    sh.getRange(`B${r}:C${r}`).merge().setValue(prod).setFontWeight("bold");
    sh.getRange(`D${r}:E${r}`).merge().setFormula(`=SUMPRODUCT(${pm},${D}!$I$2:$I)`).setNumberFormat("$#,##0");
    sh.getRange(`F${r}:G${r}`).merge().setFormula(`=SUMPRODUCT(${pm},${D}!$H$2:$H)`).setNumberFormat("$#,##0");
    sh.getRange(`H${r}:I${r}`).merge().setFormula(`=D${r}-F${r}`).setNumberFormat("$#,##0;($#,##0)");
    sh.getRange(`J${r}:K${r}`).merge().setFormula(`=IFERROR(D${r}/F${r}-1,"—")`).setNumberFormat("0.0%");
    sh.getRange(`L${r}:M${r}`).merge().setFormula(`=IFERROR(SUMPRODUCT((${pm})>0),0)`).setNumberFormat("0");
  });

  // ── Row 23: Account Detail ────────────────────────────────
  sh.setRowHeight(22, 8);
  sh.setRowHeight(23, 26);
  sh.getRange("B23:N23").merge()
    .setValue("ACCOUNT DETAIL  ·  All accounts matching filters above  (sorted by Forecast $ desc)")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff").setFontWeight("bold");

  sh.setRowHeight(24, 20);
  const acctHeaders = ["Account Name","Account Full ID","CSM","Product","Forecast Category","Roll-Up","Booking Type","Fcst Month","Fcst Qtr","Baseline $","Forecast $","Variance $","Outreach Status"];
  sh.getRange(24, 2, 1, acctHeaders.length).setValues([acctHeaders])
    .setFontWeight("bold").setBackground(ES.THEME.SECTION);

  // FILTER formula — spills down automatically
  // Cols used: Y=Account Name, Z=Account Full ID, C=CSM, B=Product, R=Category, S=Roll-Up, X=Booking Type, G=Fcst Month, K=Fcst Q, H=Baseline, I=Forecast, T=Outreach
  const filterMask =
    `(${D}!$A$2:$A=TRUE)` +
    `*(IF($C$2="All",1,${D}!$B$2:$B=$C$2))` +
    `*(IF($F$2="All",1,${D}!$C$2:$C=$F$2))` +
    `*(IF($I$2="All",1,${D}!$K$2:$K=$I$2))` +
    `*(IF($L$2="All",1,${D}!$X$2:$X=$L$2))` +
    `*(IF($O$2="All",1,${D}!$S$2:$S=$O$2))`;

  const filterFormula =
    `=IFERROR(SORT(FILTER(` +
    `{${D}!$Y$2:$Y,${D}!$Z$2:$Z,${D}!$C$2:$C,${D}!$B$2:$B,${D}!$R$2:$R,${D}!$S$2:$S,${D}!$X$2:$X,${D}!$G$2:$G,${D}!$K$2:$K,${D}!$H$2:$H,${D}!$I$2:$I,${D}!$I$2:$I-${D}!$H$2:$H,${D}!$T$2:$T},` +
    `${filterMask}),11,FALSE),"No accounts match the selected filters.")`;

  sh.getRange("B25").setFormula(filterFormula);
  // Pre-format dollar columns (col 10=K, 11=L, 12=M relative to spill; absolute = K25:M2000)
  sh.getRange("K25:K2000").setNumberFormat("$#,##0");
  sh.getRange("L25:L2000").setNumberFormat("$#,##0");
  sh.getRange("M25:M2000").setNumberFormat("$#,##0;($#,##0)");
  sh.getRange("I25:I2000").setNumberFormat("mmm-yy");

  // ── Column widths ─────────────────────────────────────────
  sh.setColumnWidth(1,  14);   // A margin
  sh.setColumnWidth(2,  200);  // B Account Name / labels
  sh.setColumnWidth(3,  140);  // C Account ID / filter value
  sh.setColumnWidth(4,  120);  // D Forecast $ / label
  sh.setColumnWidth(5,  60);   // E
  sh.setColumnWidth(6,  120);  // F Baseline $ / CSM
  sh.setColumnWidth(7,  60);   // G
  sh.setColumnWidth(8,  110);  // H Variance $
  sh.setColumnWidth(9,  60);   // I
  sh.setColumnWidth(10, 90);   // J # Accounts / Fcst Qtr
  sh.setColumnWidth(11, 60);   // K
  sh.setColumnWidth(12, 100);  // L % Total / Forecast $
  sh.setColumnWidth(13, 60);   // M
  sh.setColumnWidth(14, 110);  // N label / Variance $
  sh.setColumnWidth(15, 60);   // O filter / Outreach
}

/* ==================== WATERFALL TAB ==================== */

function ES_buildWaterfallTab_(ss) {
  const sh = ES_getOrCreate_(ss, ES.WF_SHEET);
  sh.clear();
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(3);

  // ── Row 1: Title ──────────────────────────────────────────
  sh.setRowHeight(1, 40);
  sh.getRange("A1:M1").merge()
    .setValue("FY2026 Renewal Forecast Waterfall")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff")
    .setFontSize(15).setFontWeight("bold")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.getRange("A1").setIndent(1);

  // ── Row 2: Period + Filters ───────────────────────────────
  sh.setRowHeight(2, 30);
  sh.getRange("A2:M2").setBackground(ES.THEME.SECTION);
  sh.getRange("B2").setValue("Period:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("C2").setValue("Q1 2026");
  const periods = [...ES.QUARTERS,
    "Jan-26","Feb-26","Mar-26","Apr-26","May-26","Jun-26",
    "Jul-26","Aug-26","Sep-26","Oct-26","Nov-26","Dec-26"];
  ES_listVal_(sh.getRange("C2"), periods);

  sh.getRange("E2").setValue("Product:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("F2").setValue("All");
  ES_listVal_(sh.getRange("F2"), ["All", ...ES.PRODUCTS]);

  sh.getRange("H2").setValue("CSM:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("I2").setValue("All");
  const lists = ss.getSheetByName("_Dashboard_Lists");
  if (lists) ES_rangeVal_(sh.getRange("I2"), lists.getRange("C2:C"));

  sh.getRange("K2").setValue("Booking:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("L2").setValue("All");
  ES_listVal_(sh.getRange("L2"), ["All", ...ES.BOOKING]);

  // ── Row 3: instructions ───────────────────────────────────
  sh.setRowHeight(3, 20);
  sh.getRange("B3:M3").merge()
    .setValue("↑ Set filters above, then go to Forecast Tools  →  Refresh Waterfall")
    .setFontColor(ES.THEME.MUTED).setFontSize(9).setFontStyle("italic");

  // ── Rows 5+: waterfall table placeholder ─────────────────
  sh.setRowHeight(4, 10);
  sh.setRowHeight(5, 24);
  const wfHeaders = ["Category", "Base $", "Increase $", "Decrease $", "Net Change $", "Running Total $", "# Accounts"];
  sh.getRange(5, 2, 1, wfHeaders.length).setValues([wfHeaders])
    .setFontWeight("bold").setBackground(ES.THEME.SECTION);

  sh.getRange("B6:H6").setValues([["← Run 'Refresh Waterfall' from the Forecast Tools menu to populate","","","","","",""]]);
  sh.getRange("B6").setFontColor(ES.THEME.MUTED).setFontStyle("italic");

  // ── Column widths ─────────────────────────────────────────
  sh.setColumnWidth(1, 14);
  sh.setColumnWidth(2, 220);  // Category
  sh.setColumnWidth(3, 110);  // Base $
  sh.setColumnWidth(4, 110);  // Increase $
  sh.setColumnWidth(5, 110);  // Decrease $
  sh.setColumnWidth(6, 110);  // Net Change $
  sh.setColumnWidth(7, 120);  // Running Total $
  sh.setColumnWidth(8, 90);   // # Accounts

  // Now compute with default selections
  ES_computeAndWriteWaterfall_(ss, sh);
}

function ES_computeAndWriteWaterfall_(ss, sh) {
  const dataSh = ss.getSheetByName(ES.DATA);
  if (!dataSh) return;

  const period   = String(sh.getRange("C2").getValue() || "").trim();
  const prodFilt = String(sh.getRange("F2").getValue() || "All").trim();
  const csmFilt  = String(sh.getRange("I2").getValue() || "All").trim();
  const bookFilt = String(sh.getRange("L2").getValue() || "All").trim();
  if (!period) return;

  // Read all of _Dashboard_Data
  const lastRow = dataSh.getLastRow();
  if (lastRow < 2) return;
  const ncols = dataSh.getLastColumn();
  const data = dataSh.getRange(2, 1, lastRow - 1, ncols).getValues();

  // Column indexes (0-based) matching the fixed layout:
  const CI = { include:0, product:1, csm:2, bMonth:5, fMonth:6, bAmt:7, fAmt:8,
               bQ:9, fQ:10, isAdj:12, bIn:13, fIn:14, fcat:17, rollup:18,
               outreach:19, booking:23, acctName:24, acctId:25 };

  const tz = ss.getSpreadsheetTimeZone();
  const isQtr = period.startsWith("Q");

  function normPeriod(dateVal) {
    if (!dateVal) return "";
    let d = dateVal instanceof Date ? dateVal : null;
    if (!d && typeof dateVal === "number") {
      const epoch = new Date(Date.UTC(1899,11,30));
      d = new Date(epoch.getTime() + Math.round(dateVal) * 86400000);
    }
    if (!d) return "";
    if (isQtr) {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `Q${q} ${d.getFullYear()}`;
    }
    return Utilities.formatDate(d, tz, "MMM-yy");
  }

  function matchesPeriod(dateVal) {
    return normPeriod(dateVal) === period;
  }

  // Buckets: arrays of account names for drilldown
  const buckets = {
    baseline:    { rows: [], amt: 0 },
    lost:        { rows: [], amt: 0 },
    movedOut:    { rows: [], amt: 0 },
    movedIn:     { rows: [], amt: 0 },
    downsell:    { rows: [], amt: 0 },
    upsell:      { rows: [], amt: 0 },
    newLogo:     { rows: [], amt: 0 },
    crossSell:   { rows: [], amt: 0 },
    ending:      { rows: [], amt: 0 }
  };

  for (const r of data) {
    if (r[CI.include] === false || String(r[CI.include]).toLowerCase() === "false") continue;
    if (prodFilt !== "All" && String(r[CI.product] || "") !== prodFilt) continue;
    if (csmFilt  !== "All" && String(r[CI.csm]     || "") !== csmFilt)  continue;
    const bt = String(r[CI.booking] || "").trim().toLowerCase();
    if (bookFilt !== "All" && bt !== bookFilt.toLowerCase()) continue;

    const bInPeriod = matchesPeriod(r[CI.bMonth]);
    const fInPeriod = matchesPeriod(r[CI.fMonth]);
    const bAmt = typeof r[CI.bAmt] === "number" ? r[CI.bAmt] : 0;
    const fAmt = typeof r[CI.fAmt] === "number" ? r[CI.fAmt] : 0;
    const acct = String(r[CI.acctName] || r[CI.acctId] || "Unknown").trim();

    if (bt === "new logo") {
      if (fInPeriod) { buckets.newLogo.rows.push(acct); buckets.newLogo.amt += fAmt; buckets.ending.amt += fAmt; }
      continue;
    }
    if (bt === "cross sell") {
      if (fInPeriod) { buckets.crossSell.rows.push(acct); buckets.crossSell.amt += fAmt; buckets.ending.amt += fAmt; }
      continue;
    }

    if (bInPeriod) {
      buckets.baseline.rows.push(acct);
      buckets.baseline.amt += bAmt;
      if (fAmt === 0) {
        buckets.lost.rows.push(acct); buckets.lost.amt += bAmt;
      } else if (!fInPeriod && normPeriod(r[CI.fMonth]) < period) {
        buckets.movedOut.rows.push(acct); buckets.movedOut.amt += bAmt; // moved to earlier period
      } else if (!fInPeriod && normPeriod(r[CI.fMonth]) > period) {
        buckets.movedOut.rows.push(acct); buckets.movedOut.amt += bAmt; // pushed to later period
      } else if (fInPeriod) {
        if (fAmt < bAmt) { buckets.downsell.rows.push(acct); buckets.downsell.amt += (bAmt - fAmt); }
        else if (fAmt > bAmt) { buckets.upsell.rows.push(acct); buckets.upsell.amt += (fAmt - bAmt); }
      }
    }
    if (fInPeriod) {
      if (!bInPeriod) {
        buckets.movedIn.rows.push(acct); buckets.movedIn.amt += fAmt;
      }
      buckets.ending.amt += fAmt;
    }
  }

  // Build waterfall rows
  let running = buckets.baseline.amt;
  const wfRows = [
    ["Baseline",             buckets.baseline.amt,  0,                    0,                    0,                       running,                           buckets.baseline.rows.length],
    ["Lost / Churn",         0,                     0,                    buckets.lost.amt,     -buckets.lost.amt,        running -= buckets.lost.amt,        buckets.lost.rows.length],
    ["Moved Out of Period",  0,                     0,                    buckets.movedOut.amt, -buckets.movedOut.amt,    running -= buckets.movedOut.amt,    buckets.movedOut.rows.length],
    ["Pulled In from Other", 0,                     buckets.movedIn.amt,  0,                    buckets.movedIn.amt,      running += buckets.movedIn.amt,     buckets.movedIn.rows.length],
    ["Downsell",             0,                     0,                    buckets.downsell.amt, -buckets.downsell.amt,    running -= buckets.downsell.amt,    buckets.downsell.rows.length],
    ["Upsell / Expansion",   0,                     buckets.upsell.amt,   0,                    buckets.upsell.amt,       running += buckets.upsell.amt,      buckets.upsell.rows.length],
    ["New Logo",             0,                     buckets.newLogo.amt,  0,                    buckets.newLogo.amt,      running += buckets.newLogo.amt,     buckets.newLogo.rows.length],
    ["Cross Sell",           0,                     buckets.crossSell.amt,0,                    buckets.crossSell.amt,    running += buckets.crossSell.amt,   buckets.crossSell.rows.length],
    ["Ending Forecast",      buckets.ending.amt,    0,                    0,                    buckets.ending.amt - buckets.baseline.amt, buckets.ending.amt, 0]
  ];

  // Clear old waterfall data (rows 6 onwards, before drilldown section)
  const clearRows = Math.max(wfRows.length + 10, 30);
  sh.getRange(6, 2, clearRows, 7).clearContent().clearFormat();

  // Write waterfall table
  sh.getRange(6, 2, wfRows.length, wfRows[0].length).setValues(wfRows);

  // Format
  const fmtCols = [3,4,5,6,7]; // Base, Inc, Dec, Net, Running (1-based relative to col 2 = col B)
  fmtCols.forEach(c => sh.getRange(6, 1 + c, wfRows.length, 1).setNumberFormat("$#,##0;($#,##0)"));
  sh.getRange(6, 8, wfRows.length, 1).setNumberFormat("0"); // # Accounts
  sh.getRange(6, 2, wfRows.length, 1).setFontWeight("bold");

  // Highlight baseline + ending rows
  [0, wfRows.length - 1].forEach(i => {
    sh.getRange(6 + i, 2, 1, 7).setBackground(ES.THEME.SECTION).setFontWeight("bold");
  });
  // Decrease rows in light red, increase in light green
  wfRows.forEach((row, i) => {
    const net = row[4];
    if (net < 0)      sh.getRange(6 + i, 2, 1, 7).setBackground("#fff0f0");
    else if (net > 0) sh.getRange(6 + i, 2, 1, 7).setBackground("#f0fff4");
  });

  // ── Drilldown tables ──────────────────────────────────────
  let drillRow = 6 + wfRows.length + 2;
  sh.getRange(drillRow, 2, 1, 7).merge()
    .setValue("ACCOUNT DRILLDOWN  ·  individual accounts for each waterfall bucket")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff").setFontWeight("bold");
  drillRow++;

  const drillBuckets = [
    { label: "Lost / Churn",          bucket: "lost"      },
    { label: "Moved Out of Period",    bucket: "movedOut"  },
    { label: "Pulled In from Other",   bucket: "movedIn"   },
    { label: "Downsell",               bucket: "downsell"  },
    { label: "Upsell / Expansion",     bucket: "upsell"    },
    { label: "New Logo",               bucket: "newLogo"   },
    { label: "Cross Sell",             bucket: "crossSell" }
  ];

  for (const db of drillBuckets) {
    const bkt = buckets[db.bucket];
    if (bkt.rows.length === 0) continue;
    sh.getRange(drillRow, 2, 1, 7).merge()
      .setValue(`${db.label}  (${bkt.rows.length} accounts  ·  $${Math.round(bkt.amt).toLocaleString()})`)
      .setBackground(ES.THEME.SECTION).setFontWeight("bold");
    drillRow++;
    const unique = [...new Set(bkt.rows)].sort();
    unique.forEach(name => {
      sh.getRange(drillRow, 2).setValue(name);
      drillRow++;
    });
    drillRow++; // spacer
  }
}

/* ==================== SHARED HELPERS ==================== */

function ES_getOrCreate_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function ES_listVal_(range, items) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(items, true).setAllowInvalid(false).build();
  range.setDataValidation(rule);
}
function ES_rangeVal_(range, sourceRange) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(sourceRange, true).setAllowInvalid(false).build();
  range.setDataValidation(rule);
}
