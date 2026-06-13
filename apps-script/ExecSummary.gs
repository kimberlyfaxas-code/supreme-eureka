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
  sh.getRange("A1:I1").merge()
    .setValue("FY2026 Renewal Forecast Bridge")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff")
    .setFontSize(15).setFontWeight("bold")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");
  sh.getRange("A1").setIndent(1);

  // ── Row 2: Period | CSM | Booking ────────────────────────
  sh.setRowHeight(2, 30);
  sh.getRange("A2:I2").setBackground(ES.THEME.SECTION);

  sh.getRange("B2").setValue("Period:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("C2").setValue("Jan-26");
  const periods = [...ES.QUARTERS,
    "Jan-26","Feb-26","Mar-26","Apr-26","May-26","Jun-26",
    "Jul-26","Aug-26","Sep-26","Oct-26","Nov-26","Dec-26"];
  ES_listVal_(sh.getRange("C2"), periods);

  sh.getRange("E2").setValue("CSM:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("F2").setValue("All");
  const lists = ss.getSheetByName("_Dashboard_Lists");
  if (lists) ES_rangeVal_(sh.getRange("F2"), lists.getRange("C2:C"));

  sh.getRange("H2").setValue("Booking:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("I2").setValue("All");
  ES_listVal_(sh.getRange("I2"), ["All", ...ES.BOOKING]);

  // ── Row 3: instructions ───────────────────────────────────
  sh.setRowHeight(3, 20);
  sh.getRange("B3:I3").merge()
    .setValue("↑ Set period & filters above, then Forecast Tools → Refresh Waterfall")
    .setFontColor(ES.THEME.MUTED).setFontSize(9).setFontStyle("italic");

  // ── Row 4: spacer, Row 5: column headers ─────────────────
  sh.setRowHeight(4, 10);
  sh.setRowHeight(5, 24);
  const wfHeaders = ["Category", "TOTAL ($)", "Nursing", "Med", "iHuman", "Allied Health", "Context"];
  sh.getRange(5, 2, 1, wfHeaders.length)
    .setValues([wfHeaders])
    .setFontWeight("bold")
    .setBackground(ES.THEME.SECTION);

  // ── Column widths ─────────────────────────────────────────
  sh.setColumnWidth(1, 14);
  sh.setColumnWidth(2, 230);  // B Category
  sh.setColumnWidth(3, 120);  // C TOTAL
  sh.setColumnWidth(4, 100);  // D Nursing
  sh.setColumnWidth(5, 100);  // E Med
  sh.setColumnWidth(6, 100);  // F iHuman
  sh.setColumnWidth(7, 110);  // G Allied Health
  sh.setColumnWidth(8, 280);  // H Context

  ES_computeAndWriteWaterfall_(ss, sh);
}

function ES_computeAndWriteWaterfall_(ss, sh) {
  // Primary source: _Dashboard_Data (merges CSM_Working_Forecast + 2026_Adjustments)
  const dataSh = ss.getSheetByName(ES.DATA);
  if (!dataSh) {
    sh.getRange(6, 2).setValue("ERROR: Run FDDATA_buildDataAndLists first (missing _Dashboard_Data).").setFontColor("red");
    return;
  }

  const period   = String(sh.getRange("C2").getValue() || "").trim();
  const csmFilt  = String(sh.getRange("F2").getValue() || "All").trim();
  const bookFilt = String(sh.getRange("I2").getValue() || "All").trim();
  if (!period) return;

  // Clear old content (rows 6 onward, 8 cols)
  sh.getRange(6, 2, 300, 8).clearContent().clearFormat();

  const periodMonths = ES_wf_periodMonths_(period);
  if (!periodMonths.length) {
    sh.getRange(6, 2).setValue("Cannot parse period: " + period);
    return;
  }

  // ── Flag lookup from CSM_Working_Forecast (explicit boolean flags) ───────────
  // keyed by "AccountFullID|yyyyMM" → { isLostLogo, isOffCycle }
  const flagLookup = ES_wf_buildFlagLookup_(ss);

  // ── Read _Dashboard_Data (stable A:Z = 26 columns) ───────────────────────────
  // A=0 Include  B=1 Product  C=2 CSM  D=3 Source  E=4 LineType
  // F=5 BaseMonth  G=6 FcstMonth  H=7 BaseAmt  I=8 FcstAmt
  // L=11 IsManual  M=12 IsAdj  R=17 FcstCat  X=23 BookingType
  // Y=24 AcctName  Z=25 AcctFullID
  const lastRow = dataSh.getLastRow();
  if (lastRow < 2) return;
  const data = dataSh.getRange(2, 1, lastRow - 1, 26).getValues();

  const PRODS = ["Nursing", "Med", "iHuman", "Allied Health"];

  function mkB() {
    return { total: 0, n: 0, m: 0, ih: 0, ah: 0, accts: [] };
  }
  const B = {
    baseline: mkB(), lostLogo: mkB(),
    movedOutEarlier: mkB(), movedOutLater: mkB(),
    movedInPrior: mkB(), movedInNext: mkB(),
    offCycle: mkB(), manualAdds: mkB(), forecast: mkB(),
  };

  function addToBucket(bkt, prod, amt, acct, dispAmt, note) {
    bkt.total += amt;
    if      (prod === "Nursing")       bkt.n  += amt;
    else if (prod === "Med")           bkt.m  += amt;
    else if (prod === "iHuman")        bkt.ih += amt;
    else if (prod === "Allied Health") bkt.ah += amt;
    bkt.accts.push({ acct, prod, amt: dispAmt, note });
  }

  // ── Process rows ──────────────────────────────────────────
  for (const r of data) {
    if (r[0] === false) continue;                        // Include = FALSE
    const prod    = String(r[1]  || "").trim();          // B Product (already normalized)
    if (!PRODS.includes(prod)) continue;
    const csm     = String(r[2]  || "").trim();          // C CSM
    const src     = String(r[3]  || "").trim();          // D Forecast Source
    const booking = String(r[23] || "").trim();          // X Booking Type
    const fcat    = String(r[17] || "").trim();          // R Forecast Category
    const acctId  = String(r[25] || "").trim();          // Z Account Full ID
    const acct    = String(r[24] || "").trim() || acctId || "Unknown"; // Y Account Name

    if (csmFilt  !== "All" && csm !== csmFilt)  continue;
    if (bookFilt !== "All" && booking.toLowerCase() !== bookFilt.toLowerCase()) continue;

    const bDate = ES_wf_parseDate_(r[5]);                // F Baseline Month
    const fDate = ES_wf_parseDate_(r[6]);                // G Forecast Month
    const bAmt  = typeof r[7] === "number" ? r[7] : 0;  // H Baseline Amount
    const fAmt  = typeof r[8] === "number" ? r[8] : 0;  // I Forecast Amount
    const isManual = r[11] === true;                     // L Is Manual Add

    const bInPeriod = bDate && periodMonths.some(pm =>
      pm.year === bDate.getFullYear() && pm.month === bDate.getMonth());
    const fInPeriod = fDate && periodMonths.some(pm =>
      pm.year === fDate.getFullYear() && pm.month === fDate.getMonth());

    // Resolve explicit flags (from WF boolean columns) falling back to fcat patterns
    let flags = {};
    if (bDate && acctId) {
      const key = `${acctId}|${bDate.getFullYear() * 100 + bDate.getMonth()}`;
      flags = flagLookup[key] || {};
    }
    const fcatLower = fcat.toLowerCase();
    const isLostLogo = flags.isLostLogo != null
      ? flags.isLostLogo
      : /lost\s*account|lost\s*logo/i.test(fcatLower);
    const isOffCycle = !isLostLogo && (flags.isOffCycle != null
      ? flags.isOffCycle
      : /no\s+rev(?:enue)?\s+this\s+term|active\s+client.*no\s+rev|off.?cycle/i.test(fcatLower));

    // FORECAST
    if (fInPeriod) addToBucket(B.forecast, prod, fAmt, acct, fAmt, fcat);

    // MANUAL ADDS (manual add lines, or new logo/cross sell with no baseline)
    if (fInPeriod && (isManual || (bAmt === 0 && booking !== "Renewal"))) {
      addToBucket(B.manualAdds, prod, fAmt, acct, fAmt, fcat);
      continue;
    }

    // Non-manual renewal lines
    if (bInPeriod) {
      addToBucket(B.baseline, prod, bAmt, acct, bAmt, fcat);

      if (isLostLogo)
        addToBucket(B.lostLogo, prod, bAmt, acct, bAmt, fcat);
      else if (isOffCycle)
        addToBucket(B.offCycle, prod, bAmt, acct, bAmt, fcat);

      // MOVED OUT (baseline in period, forecast outside period)
      if (fDate && !fInPeriod && !isLostLogo && !isOffCycle) {
        const bTotal = bDate.getFullYear() * 12 + bDate.getMonth();
        const fTotal = fDate.getFullYear() * 12 + fDate.getMonth();
        if (fTotal < bTotal)
          addToBucket(B.movedOutEarlier, prod, bAmt, acct, bAmt, fcat);
        else
          addToBucket(B.movedOutLater,   prod, bAmt, acct, bAmt, fcat);
      }
    }

    // MOVED IN (forecast in period, baseline outside period)
    if (fInPeriod && !bInPeriod && !isManual && bDate) {
      const bTotal = bDate.getFullYear() * 12 + bDate.getMonth();
      const fTotal = fDate.getFullYear() * 12 + fDate.getMonth();
      if (bTotal < fTotal)
        addToBucket(B.movedInPrior, prod, fAmt, acct, fAmt, fcat);
      else
        addToBucket(B.movedInNext,  prod, fAmt, acct, fAmt, fcat);
    }
  }

  // ── Variance = Forecast − (Baseline − LostLogo − MovedOutEarlier − MovedOutLater
  //                          + MovedInPrior + MovedInNext − OffCycle + ManualAdds) ──
  function calcVar(key) {
    return B.forecast[key] - (
      B.baseline[key] - B.lostLogo[key]
      - B.movedOutEarlier[key] - B.movedOutLater[key]
      + B.movedInPrior[key]   + B.movedInNext[key]
      - B.offCycle[key]       + B.manualAdds[key]
    );
  }
  const variance = {
    total: calcVar("total"), n: calcVar("n"), m: calcVar("m"),
    ih:    calcVar("ih"),    ah: calcVar("ah"),
  };

  // ── Period labels ─────────────────────────────────────────
  const mLabel     = ES_wf_periodLabel_(periodMonths);
  const priorLabel = ES_wf_adjacentLabel_(periodMonths, -1);
  const nextLabel  = ES_wf_adjacentLabel_(periodMonths,  1);

  // ── Build waterfall rows  [Cat, Total, Nursing, Med, iHuman, AH, Context] ──
  const AMT_FMT = "$#,##0;($#,##0)";
  function mkRow(label, bkt, sign, ctx) {
    const s = sign;
    return [label, s*bkt.total, s*bkt.n, s*bkt.m, s*bkt.ih, s*bkt.ah, ctx];
  }

  const wfRows = [];
  wfRows.push(mkRow(`${mLabel} Baseline`,   B.baseline,  1,  "Starting Amount"));
  if (Math.abs(B.lostLogo.total)        > 0.5)
    wfRows.push(mkRow(`${mLabel} Lost Logo`,                 B.lostLogo,        -1, "Accounts with no expected renewal"));
  if (Math.abs(B.movedOutEarlier.total) > 0.5)
    wfRows.push(mkRow(`Moved to ${priorLabel} (Out)`,        B.movedOutEarlier, -1, "Booked Early"));
  if (Math.abs(B.movedOutLater.total)   > 0.5)
    wfRows.push(mkRow(`Moved to ${nextLabel} (Out)`,         B.movedOutLater,   -1, "Pushed forward"));
  if (Math.abs(B.movedInPrior.total)    > 0.5)
    wfRows.push(mkRow(`From ${priorLabel} (In)`,             B.movedInPrior,     1, `${priorLabel} Trailing`));
  if (Math.abs(B.movedInNext.total)     > 0.5)
    wfRows.push(mkRow(`From ${nextLabel} (In)`,              B.movedInNext,      1, `Pulled forward from ${nextLabel}`));
  if (Math.abs(B.offCycle.total)        > 0.5)
    wfRows.push(mkRow(`${mLabel} Off-Cycle / Zeroed`,        B.offCycle,        -1, "Clients dropped to $0 (Risk/Downsell)"));
  if (Math.abs(B.manualAdds.total)      > 0.5)
    wfRows.push(mkRow("Manual Adds",                         B.manualAdds,       1, "Added to the forecast, not in the baseline"));
  if (Math.abs(variance.total)          > 0.5)
    wfRows.push([
      "Variance / Other",
      variance.total, variance.n, variance.m, variance.ih, variance.ah,
      "Upsell / Price lift to close gap"
    ]);
  wfRows.push(mkRow(`${mLabel} Forecast`,  B.forecast,  1,  "Ending Amount"));

  // ── Write waterfall table ─────────────────────────────────
  sh.getRange(6, 2, wfRows.length, 7).setValues(wfRows);
  sh.getRange(6, 3, wfRows.length, 5).setNumberFormat(AMT_FMT);  // C-G
  sh.getRange(6, 2, wfRows.length, 1).setFontWeight("bold");

  wfRows.forEach((row, i) => {
    const r = 6 + i;
    const isEnd = i === 0 || i === wfRows.length - 1;
    if (isEnd) {
      sh.getRange(r, 2, 1, 7).setBackground(ES.THEME.SECTION).setFontWeight("bold").setFontSize(11);
    } else if (row[1] < 0) {
      sh.getRange(r, 2, 1, 7).setBackground("#fff0f0");
    } else if (row[1] > 0) {
      sh.getRange(r, 2, 1, 7).setBackground("#f0fff4");
    }
  });

  // ── Drilldown ─────────────────────────────────────────────
  const drillDefs = [
    { label: "Lost Logo",              bkt: B.lostLogo        },
    { label: "Moved Out (Earlier)",    bkt: B.movedOutEarlier },
    { label: "Moved Out (Later)",      bkt: B.movedOutLater   },
    { label: "Moved In (From Prior)",  bkt: B.movedInPrior    },
    { label: "Moved In (From Next)",   bkt: B.movedInNext     },
    { label: "Off-Cycle / Zeroed",     bkt: B.offCycle        },
    { label: "Manual Adds",            bkt: B.manualAdds      },
  ];

  let dr = 6 + wfRows.length + 2;
  sh.getRange(dr, 2, 1, 7).merge()
    .setValue("ACCOUNT DRILLDOWN  ·  accounts contributing to each bucket")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff").setFontWeight("bold");
  dr++;

  for (const dd of drillDefs) {
    if (!dd.bkt.accts.length) continue;
    // Section header
    sh.getRange(dr, 2, 1, 7).merge()
      .setValue(`${dd.label}  (${dd.bkt.accts.length} accounts  ·  $${Math.round(Math.abs(dd.bkt.total)).toLocaleString()})`)
      .setBackground(ES.THEME.SECTION).setFontWeight("bold");
    dr++;
    // Column micro-headers
    sh.getRange(dr, 2, 1, 4)
      .setValues([["Account Name", "Product", "Amount ($)", "Notes"]])
      .setFontWeight("bold").setFontColor(ES.THEME.MUTED).setFontSize(9);
    dr++;
    // Rows sorted by |amt| desc
    const sorted = dd.bkt.accts.slice().sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
    for (const a of sorted) {
      sh.getRange(dr, 2).setValue(a.acct);
      sh.getRange(dr, 3).setValue(a.prod);
      sh.getRange(dr, 4).setValue(a.amt).setNumberFormat(AMT_FMT);
      if (a.note) sh.getRange(dr, 5).setValue(a.note).setFontColor(ES.THEME.MUTED).setFontSize(9);
      dr++;
    }
    dr++; // spacer
  }
}

/* ==================== WATERFALL HELPERS ==================== */

/**
 * Scan the header row for known flag column patterns.
 * Returns { lostLogo: {monthIdx→colIdx}, offCycle: {…}, movement: {"from->to"→colIdx} }
 */
function ES_wf_detectFlags_(header) {
  const PATS = [
    /\bjan(?:uary)?\b/i,         // 0
    /\bfeb(?:ruary)?\b/i,        // 1
    /\bmar(?:ch)?\b/i,           // 2
    /\bapr(?:il)?\b/i,           // 3
    /\bmay\b/i,                  // 4
    /\bjun(?:e)?\b/i,            // 5
    /\bjul(?:y)?\b/i,            // 6
    /\baug(?:ust)?\b/i,          // 7
    /\bsep(?:t(?:ember)?)?\b/i,  // 8
    /\boct(?:ober)?\b/i,         // 9
    /\bnov(?:ember)?\b/i,        // 10
    /\bdec(?:ember)?\b/i,        // 11
  ];

  function monthsInStr(s) {
    const found = [];
    for (let i = 0; i < PATS.length; i++) {
      const m = PATS[i].exec(s);
      if (m) found.push({ idx: i, pos: m.index });
    }
    return found.sort((a, b) => a.pos - b.pos);
  }

  const result = { lostLogo: {}, offCycle: {}, movement: {} };

  header.forEach((h, ci) => {
    const s = String(h || "").trim();
    if (!s) return;

    if (/lost\s*logo/i.test(s)) {
      const ms = monthsInStr(s);
      if (ms.length) result.lostLogo[ms[0].idx] = ci;

    } else if (/current\s+client/i.test(s) && /not\s+expected/i.test(s)) {
      const ms = monthsInStr(s);
      if (ms.length) result.offCycle[ms[0].idx] = ci;

    } else if (/\bmoved\b/i.test(s)) {
      const ms = monthsInStr(s);
      if (ms.length === 2) {
        let fromIdx, toIdx;
        if (/moved\s+from\b/i.test(s)) {
          // "Moved from A to B" → from=first, to=second
          fromIdx = ms[0].idx; toIdx = ms[1].idx;
        } else {
          // "Moved To B from A" / "Moved to B from A" → to=first, from=second
          toIdx = ms[0].idx; fromIdx = ms[1].idx;
        }
        result.movement[`${fromIdx}->${toIdx}`] = ci;
      }
    }
  });

  return result;
}

/** Parse "Jan-26" or "Q1 2026" into [{year, month(0-based)}] */
function ES_wf_periodMonths_(period) {
  const qMatch = period.match(/^Q([1-4])\s+(\d{4})$/);
  if (qMatch) {
    const q = parseInt(qMatch[1], 10);
    const y = parseInt(qMatch[2], 10);
    const s = (q - 1) * 3;
    return [{ year: y, month: s }, { year: y, month: s+1 }, { year: y, month: s+2 }];
  }
  const MON = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  const mMatch = period.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (mMatch) {
    const m = MON[mMatch[1].toLowerCase()];
    if (m === undefined) return [];
    return [{ year: 2000 + parseInt(mMatch[2], 10), month: m }];
  }
  return [];
}

/** Parse a raw cell value to the first-of-month Date, or null */
function ES_wf_parseDate_(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime()))
    return new Date(v.getFullYear(), v.getMonth(), 1);
  if (typeof v === "number") {
    const d = new Date(new Date(Date.UTC(1899,11,30)).getTime() + Math.round(v)*86400000);
    if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1);
  return null;
}

/** Normalize a raw product value to one of the four canonical names */
function ES_wf_normProd_(raw) {
  const s = String(raw || "").trim();
  if (!s) return "Unknown";
  const u = s.toUpperCase();
  if (u.includes("ALLIED"))                     return "Allied Health";
  if (u === "IHUMAN" || u.includes("IHUMAN"))   return "iHuman";
  if (s === "iHuman")                            return "iHuman";
  if (u.includes("NURS"))                        return "Nursing";
  if (u.includes("MED"))                         return "Med";
  return "Unknown";
}

/** "Jan-26" → "Jan",  "Q1 2026" → "Q1" */
function ES_wf_periodLabel_(periodMonths) {
  const ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (periodMonths.length === 1) return ABBR[periodMonths[0].month];
  return `Q${Math.floor(periodMonths[0].month / 3) + 1}`;
}

/**
 * Build a lookup from CSM_Working_Forecast boolean flag columns.
 * Returns { "AccountFullID|yyyyMM" → { isLostLogo, isOffCycle } }
 * Used to augment _Dashboard_Data rows with explicit CSM classifications.
 */
function ES_wf_buildFlagLookup_(ss) {
  const wfSh = ss.getSheetByName("CSM_Working_Forecast");
  if (!wfSh || wfSh.getLastRow() < 2) return {};

  const lastCol   = wfSh.getLastColumn();
  const rawHeader = wfSh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const data      = wfSh.getRange(2, 1, wfSh.getLastRow() - 1, lastCol).getValues();

  const hmap = {};
  rawHeader.forEach((h, i) => { hmap[String(h || "").trim().toLowerCase()] = i; });
  function col() {
    for (let i = 0; i < arguments.length; i++) {
      const k = String(arguments[i] || "").trim().toLowerCase();
      if (hmap[k] !== undefined) return hmap[k];
    }
    return -1;
  }

  const ciAcct = col("account full id","salesforce account id (full id)","full id","sfid");
  const ciBM   = col("baseline month");
  const flagMap = ES_wf_detectFlags_(rawHeader);

  const lookup = {};
  for (const r of data) {
    const acctId = ciAcct >= 0 ? String(r[ciAcct] || "").trim() : "";
    if (!acctId) continue;
    const bDate = ES_wf_parseDate_(ciBM >= 0 ? r[ciBM] : null);
    if (!bDate) continue;

    const key  = `${acctId}|${bDate.getFullYear() * 100 + bDate.getMonth()}`;
    const bMon = bDate.getMonth();
    const llCol = flagMap.lostLogo[bMon];
    const ocCol = flagMap.offCycle[bMon];

    const existing = lookup[key] || {};
    if (llCol !== undefined) existing.isLostLogo = existing.isLostLogo || (r[llCol] === true);
    if (ocCol !== undefined) existing.isOffCycle  = existing.isOffCycle  || (r[ocCol]  === true);
    lookup[key] = existing;
  }
  return lookup;
}

/** Label for the period immediately before (-1) or after (+1) the given period */
function ES_wf_adjacentLabel_(periodMonths, dir) {
  const ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (periodMonths.length === 1) {
    let y = periodMonths[0].year, m = periodMonths[0].month + dir;
    if (m < 0)  { m = 11; y--; }
    if (m > 11) { m = 0;  y++; }
    return ABBR[m];
  }
  const q = Math.floor(periodMonths[0].month / 3) + 1;
  const y = periodMonths[0].year;
  if (dir < 0) {
    return q === 1 ? `Q4 ${y-1}` : `Q${q-1} ${y}`;
  } else {
    return q === 4 ? `Q1 ${y+1}` : `Q${q+1} ${y}`;
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
