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
  ES_buildWaterfallTab_(ss);
  ss.toast("Waterfall built. Pick a period in C2, then Forecast Tools → Refresh Waterfall.", "Forecast Tools", 6);
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

// Source sheets for the waterfall (no _Dashboard_Data dependency)
const ES_WF_SRC  = "CSM_Working_Forecast";
const ES_WF_MAN  = "Manual_Forecast_AddOns";
const ES_WF_ADJ  = "2026_Adjustments";

// Column indices (0-based) in CSM_Working_Forecast
const ES_WF_C = {
  acctId:   1,   // Account ID
  src:      2,   // Forecast Source
  csm:      8,   // Current CSM
  acctName: 10,  // Account Name
  product:  11,  // Product Group
  bMonth:   14,  // Baseline Month
  bAmt:     15,  // Baseline Amount
  fMonth:   16,  // Forecast Month
  fAmt:     17,  // Forecast Amount
  outreach: 18,  // Outreach Status
  fCat:     19,  // Forecast Category
  comment:  20,  // Latest Comment
};

function ES_buildWaterfallTab_(ss) {
  const sh = ES_getOrCreate_(ss, ES.WF_SHEET);
  sh.clear();
  sh.setHiddenGridlines(true);
  sh.setFrozenRows(3);

  // ── Row 1: Title ──────────────────────────────────────────
  sh.setRowHeight(1, 40);
  sh.getRange("A1:H1").merge()
    .setValue("FY2026 Renewal Forecast Bridge")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff")
    .setFontSize(15).setFontWeight("bold")
    .setHorizontalAlignment("left").setVerticalAlignment("middle");

  // ── Row 2: Period | CSM | Product | Forecast Category ────
  sh.setRowHeight(2, 30);
  sh.getRange("A2:L2").setBackground(ES.THEME.SECTION);

  // Period (single-select)
  sh.getRange("B2").setValue("Period:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("C2").setNumberFormat("@").setValue("Jan-26");
  const periods = ["Full Year 2026", ...ES.QUARTERS,
    "Dec-25",
    "Jan-26","Feb-26","Mar-26","Apr-26","May-26","Jun-26",
    "Jul-26","Aug-26","Sep-26","Oct-26","Nov-26","Dec-26"];
  ES_listVal_(sh.getRange("C2"), periods);

  // CSM (multi-select) — write list to hidden col P to avoid the 500-item requireValueInList limit
  sh.getRange("E2").setValue("CSM:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("F2").setValue("All");
  const csmList = ES_wf_getUnique_(ss, ES_WF_SRC, ES_WF_C.csm).sort();
  const csmItems = ["All", ...csmList];
  sh.getRange(1, 16, csmItems.length, 1).setValues(csmItems.map(v => [v]));
  sh.getRange("F2").setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(sh.getRange(1, 16, csmItems.length, 1), true)
      .setAllowInvalid(true).build()
  );
  sh.hideColumns(16);

  // Product (multi-select) — small list, requireValueInList is fine
  sh.getRange("H2").setValue("Product:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("I2").setValue("All");
  ES_listVal_(sh.getRange("I2"), ["All", "Nursing", "Med", "iHuman", "Allied Health"]);

  // Forecast Category (multi-select) — write list to hidden col R
  sh.getRange("K2").setValue("Fcst Cat:").setFontColor(ES.THEME.MUTED).setFontWeight("bold");
  sh.getRange("L2").setValue("All");
  const catList = ES_wf_getUnique_(ss, ES_WF_SRC, ES_WF_C.fCat, true)
    .filter(v => v && v.trim());
  const catItems = ["All", "Standard (No Category)", ...catList];
  sh.getRange(1, 18, catItems.length, 1).setValues(catItems.map(v => [v]));
  sh.getRange("L2").setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(sh.getRange(1, 18, catItems.length, 1), true)
      .setAllowInvalid(true).build()
  );
  sh.hideColumns(18);

  // ── Row 3: instructions ───────────────────────────────────
  sh.setRowHeight(3, 20);
  sh.getRange("B3:L3").merge()
    .setValue("↑ Set filters above, then Forecast Tools → Refresh Waterfall  |  CSM, Product, Fcst Cat support comma-separated multi-select (click again to deselect)")
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
  sh.setColumnWidth(3, 120);  // C TOTAL / Period filter
  sh.setColumnWidth(4, 100);  // D Nursing
  sh.setColumnWidth(5, 100);  // E Med / CSM label
  sh.setColumnWidth(6, 100);  // F iHuman / CSM value
  sh.setColumnWidth(7, 110);  // G Allied Health
  sh.setColumnWidth(8, 260);  // H Context
  sh.setColumnWidth(9, 100);  // I Product value
  sh.setColumnWidth(11, 70);  // K Category label
  sh.setColumnWidth(12, 200); // L Category value

  ES_computeAndWriteWaterfall_(ss, sh);
}

function ES_computeAndWriteWaterfall_(ss, sh) {
  const wfSh = ss.getSheetByName(ES_WF_SRC);
  if (!wfSh) {
    sh.getRange(6, 2).setValue("ERROR: Missing sheet " + ES_WF_SRC).setFontColor("red");
    return;
  }

  const period   = sh.getRange("C2").getDisplayValue().trim();
  const csmRaw   = String(sh.getRange("F2").getValue() || "All").trim();
  const prodRaw  = String(sh.getRange("I2").getValue() || "All").trim();
  const catRaw   = String(sh.getRange("L2").getValue() || "All").trim();
  if (!period) return;

  // Clear old content (rows 6+, 8 cols wide)
  sh.getRange(6, 2, 400, 8).clearContent().clearFormat();

  const periodMonths = ES_wf_periodMonths_(period);
  if (!periodMonths.length) {
    sh.getRange(6, 2).setValue("Cannot parse period: " + period);
    return;
  }

  // ── Parse multi-select filters (comma-separated; "All" = no filter) ──
  function parseFilter(raw) {
    if (!raw || raw === "All") return null;
    return raw.split(/,\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  const csmFilter  = parseFilter(csmRaw);
  const prodFilter = parseFilter(prodRaw);
  const catFilter  = parseFilter(catRaw);

  // ── Read CSM_Working_Forecast ──────────────────────────────
  const C = ES_WF_C;
  const lastRow = wfSh.getLastRow();
  if (lastRow < 2) return;
  const data = wfSh.getRange(2, 1, lastRow - 1, 21).getValues();

  // ── Read 2026_Adjustments and normalize to same 21-col format ──
  const adjRows = [];
  const adjSh = ss.getSheetByName(ES_WF_ADJ);
  if (adjSh && adjSh.getLastRow() > 1) {
    const ahRaw = adjSh.getRange(1, 1, 1, adjSh.getLastColumn()).getValues()[0];
    const ah = {};
    ahRaw.forEach((h, i) => { if (h) ah[String(h).trim()] = i; });
    function adjCol(candidates) {
      for (const c of candidates) { if (ah[c] !== undefined) return ah[c]; }
      return -1;
    }
    const ai_csm  = adjCol(["Current CSM", "CSM", "Client Success Manager"]);
    const ai_prod = adjCol(["Product Group", "Product"]);
    const ai_name = adjCol(["Account Name", "Account"]);
    const ai_bm   = adjCol(["Baseline Month", "Month", "Date"]);
    const ai_ba   = adjCol(["Baseline Amount", "Amount", "Baseline"]);
    const ai_fm   = adjCol(["Forecast Month"]);
    const ai_fa   = adjCol(["Forecast Amount", "Forecast"]);
    const ai_cat  = adjCol(["Forecast Category", "Category"]);
    const ai_out  = adjCol(["Outreach Status", "Outreach"]);
    const ai_cmt  = adjCol(["Latest Comment", "Comment", "Notes"]);
    const aRows   = adjSh.getRange(2, 1, adjSh.getLastRow() - 1, adjSh.getLastColumn()).getValues();
    for (const r of aRows) {
      const baV = ai_ba >= 0 ? r[ai_ba] : 0;
      const faV = ai_fa >= 0 ? r[ai_fa] : (ai_ba >= 0 ? r[ai_ba] : 0);
      if (!baV && !faV) continue;
      const synth = new Array(21).fill("");
      synth[C.src]      = "Adjustment";
      synth[C.csm]      = ai_csm  >= 0 ? r[ai_csm]  : "";
      synth[C.acctName] = ai_name >= 0 ? r[ai_name] : "";
      synth[C.product]  = ai_prod >= 0 ? r[ai_prod] : "";
      synth[C.bMonth]   = ai_bm   >= 0 ? r[ai_bm]   : "";
      synth[C.bAmt]     = typeof baV === "number" ? baV : 0;
      synth[C.fMonth]   = ai_fm   >= 0 ? r[ai_fm]   : (ai_bm >= 0 ? r[ai_bm] : "");
      synth[C.fAmt]     = typeof faV === "number" ? faV : 0;
      synth[C.fCat]     = (ai_cat >= 0 && r[ai_cat]) ? r[ai_cat] : "Not expected (Adjustment)";
      synth[C.outreach] = ai_out  >= 0 ? r[ai_out]  : "";
      synth[C.comment]  = ai_cmt  >= 0 ? r[ai_cmt]  : "";
      adjRows.push(synth);
    }
  }
  const allData = adjRows.length ? data.concat(adjRows) : data;

  function mkB() { return { total: 0, n: 0, m: 0, ih: 0, ah: 0, accts: [] }; }
  const B = {
    baseline:       mkB(),
    lostLogo:       mkB(),
    movedOutEarlier:mkB(),
    movedOutLater:  mkB(),
    movedInPrior:   mkB(),
    movedInNext:    mkB(),
    offCycle:       mkB(),
    manualAdds:     mkB(),
    adjustments:    mkB(),  // net impact from 2026_Adjustments rows
    forecast:       mkB(),
  };

  function addTo(bkt, prod, amt, acct, note) {
    bkt.total += amt;
    if      (prod === "Nursing")       bkt.n  += amt;
    else if (prod === "Med")           bkt.m  += amt;
    else if (prod === "iHuman")        bkt.ih += amt;
    else if (prod === "Allied Health") bkt.ah += amt;
    if (Math.abs(amt) > 0.009) bkt.accts.push({ acct, prod, amt, note });
  }

  for (const r of allData) {
    const csm    = String(r[C.csm]     || "").trim();
    const rawPrd = String(r[C.product] || "").trim();
    const prod   = ES_wf_normProd_(rawPrd);
    const acct   = String(r[C.acctName]|| "").trim() || "Unknown";
    const fcat   = String(r[C.fCat]    || "").trim();
    const src    = String(r[C.src]     || "").trim();
    const note   = String(r[C.comment] || fcat || "").trim();

    if (prod === "Unknown") continue;

    // ── Apply filters ──
    if (csmFilter  && !csmFilter.includes(csm.toLowerCase())) continue;
    if (prodFilter && !prodFilter.includes(prod.toLowerCase())) continue;
    if (catFilter) {
      const hasStd = catFilter.includes("standard (no category)");
      if (!fcat) {
        if (!hasStd) continue;
      } else {
        if (!catFilter.some(f => fcat.toLowerCase() === f || fcat.toLowerCase().includes(f))) continue;
      }
    }

    const bDate = ES_wf_parseDate_(r[C.bMonth]);
    const fDate = ES_wf_parseDate_(r[C.fMonth]);
    const bAmt  = typeof r[C.bAmt] === "number" ? r[C.bAmt] : 0;
    const fAmt  = typeof r[C.fAmt] === "number" ? r[C.fAmt] : 0;

    // Skip pure zero-placeholder rows (bAmt=0, fAmt=0)
    if (bAmt === 0 && fAmt === 0) continue;

    const bInPeriod = bDate && periodMonths.some(
      pm => pm.year === bDate.getFullYear() && pm.month === bDate.getMonth());
    const fInPeriod = fDate && periodMonths.some(
      pm => pm.year === fDate.getFullYear() && pm.month === fDate.getMonth());

    const isAdj      = src === "Adjustment";  // rows from 2026_Adjustments
    const isManual   = /manual\s*add/i.test(src);
    const isLostLogo = /lost\s*(account|logo)/i.test(fcat);
    const isOffCycle = !isLostLogo && /active\s+client.*no\s+rev|no\s+rev.*this\s+term/i.test(fcat);
    const isNotExp   = /^not\s+expected/i.test(fcat) && !isLostLogo && !isOffCycle;

    // ── FORECAST bucket (all rows with forecast in period) ──
    if (fInPeriod) addTo(B.forecast, prod, fAmt, acct, note);

    // ── ADJUSTMENT rows (from 2026_Adjustments sheet) ──
    if (isAdj) {
      if (bInPeriod) addTo(B.baseline, prod, bAmt, acct, note);
      // Track the net adjustment impact (fAmt − bAmt for period-matching sides)
      const adjNet = (fInPeriod ? fAmt : 0) - (bInPeriod ? bAmt : 0);
      if (Math.abs(adjNet) > 0.009) addTo(B.adjustments, prod, adjNet, acct, note || "Adjustment");
      continue;
    }

    // ── MANUAL ADDS (source = Manual Add, or bAmt=0 with forecast) ──
    if (fInPeriod && (isManual || (bAmt === 0 && !bDate))) {
      addTo(B.manualAdds, prod, fAmt, acct, note);
      continue;
    }

    // ── BASELINE rows (baseline month falls in selected period) ──
    if (bInPeriod) {
      addTo(B.baseline, prod, bAmt, acct, note);

      if (isLostLogo) {
        addTo(B.lostLogo, prod, bAmt, acct, note);
      } else if (isOffCycle) {
        addTo(B.offCycle, prod, bAmt, acct, note);
      } else if (!fInPeriod && fDate && !isNotExp) {
        // MOVED OUT: forecast is in a different period
        const bSer = bDate.getFullYear() * 12 + bDate.getMonth();
        const fSer = fDate.getFullYear() * 12 + fDate.getMonth();
        const toLabel = ES_wf_dateLabel_(fDate);
        if (fSer < bSer)
          addTo(B.movedOutEarlier, prod, bAmt, acct, "→ " + toLabel);
        else
          addTo(B.movedOutLater,   prod, bAmt, acct, "→ " + toLabel);
      }
    }

    // ── MOVED IN: forecast in period, baseline in a different period ──
    if (fInPeriod && !bInPeriod && bDate && !isLostLogo && !isOffCycle && !isNotExp && !isManual) {
      const bSer = bDate.getFullYear() * 12 + bDate.getMonth();
      const fSer = fDate.getFullYear() * 12 + fDate.getMonth();
      const fromLabel = ES_wf_dateLabel_(bDate);
      if (bSer < fSer)
        addTo(B.movedInPrior, prod, fAmt, acct, "← " + fromLabel);
      else
        addTo(B.movedInNext,  prod, fAmt, acct, "← " + fromLabel);
    }
  }

  // ── Read Manual_Forecast_AddOns for any pending / not-yet-synced adds ──
  const manSh = ss.getSheetByName(ES_WF_MAN);
  if (manSh && manSh.getLastRow() > 1) {
    const mHdr = manSh.getRange(1, 1, 1, manSh.getLastColumn()).getValues()[0];
    const mData = manSh.getRange(2, 1, manSh.getLastRow() - 1, manSh.getLastColumn()).getValues();
    const mIdx = {};
    mHdr.forEach((h, i) => { if (h) mIdx[String(h).trim()] = i; });
    const inclCol = mIdx["Include in Forecast"] !== undefined ? mIdx["Include in Forecast"] : -1;
    const fmCol   = mIdx["Forecast Month"]   !== undefined ? mIdx["Forecast Month"]   : -1;
    const faCol   = mIdx["Forecast Amount"]  !== undefined ? mIdx["Forecast Amount"]  : -1;
    const pCol    = mIdx["Product Group"]    !== undefined ? mIdx["Product Group"]    : -1;
    const aCol    = mIdx["Account Name"]     !== undefined ? mIdx["Account Name"]     : -1;
    const rCol    = mIdx["Add-On Reason"]    !== undefined ? mIdx["Add-On Reason"]    : -1;
    const subCol  = mIdx["Submitted At"]     !== undefined ? mIdx["Submitted At"]     : -1;
    for (const r of mData) {
      if (inclCol < 0 || r[inclCol] !== true) continue;
      // Skip if already submitted to Working (Submitted At is set)
      if (subCol >= 0 && r[subCol]) continue;
      const fDate = ES_wf_parseDate_(fmCol >= 0 ? r[fmCol] : null);
      if (!fDate) continue;
      const fInPeriod = periodMonths.some(
        pm => pm.year === fDate.getFullYear() && pm.month === fDate.getMonth());
      if (!fInPeriod) continue;
      const prod = ES_wf_normProd_(pCol >= 0 ? r[pCol] : "");
      if (prod === "Unknown") continue;
      if (prodFilter && !prodFilter.includes(prod.toLowerCase())) continue;
      const fAmt = typeof r[faCol] === "number" ? r[faCol] : 0;
      if (fAmt === 0) continue;
      const acct = aCol >= 0 ? String(r[aCol] || "").trim() : "Manual Add";
      const reason = rCol >= 0 ? String(r[rCol] || "").trim() : "";
      addTo(B.manualAdds, prod, fAmt, acct, reason || "Pending manual add");
    }
  }

  // ── Variance = Forecast − (Baseline − LostLogo − OffCycle
  //              − MovedOutEarlier − MovedOutLater
  //              + MovedInPrior + MovedInNext + ManualAdds) ──
  function calcVar(k) {
    return B.forecast[k] - (
      B.baseline[k]
      - B.lostLogo[k]       - B.offCycle[k]
      - B.movedOutEarlier[k]- B.movedOutLater[k]
      + B.movedInPrior[k]   + B.movedInNext[k]
      + B.manualAdds[k]
      + B.adjustments[k]
    );
  }
  const variance = {
    total: calcVar("total"), n: calcVar("n"), m: calcVar("m"),
    ih: calcVar("ih"), ah: calcVar("ah"),
  };

  // ── Build waterfall rows ───────────────────────────────────
  const AMT_FMT = "$#,##0;($#,##0)";
  const pLabel = ES_wf_periodLabel_(periodMonths);

  function mkRow(label, bkt, sign, ctx) {
    return [label, sign*bkt.total, sign*bkt.n, sign*bkt.m, sign*bkt.ih, sign*bkt.ah, ctx];
  }

  const wfRows = [];
  wfRows.push(mkRow(`${pLabel} Baseline`,               B.baseline,        1,  "Starting Amount"));
  if (Math.abs(B.lostLogo.total)        > 0.5)
    wfRows.push(mkRow("Lost Logo",                       B.lostLogo,        -1, "No expected renewal"));
  if (Math.abs(B.movedOutEarlier.total) > 0.5)
    wfRows.push(mkRow("Moved Out (to Earlier Period)",   B.movedOutEarlier, -1, "Captured / pulled into prior period"));
  if (Math.abs(B.movedOutLater.total)   > 0.5)
    wfRows.push(mkRow("Moved Out (to Later Period)",     B.movedOutLater,   -1, "Pushed to future period"));
  if (Math.abs(B.movedInPrior.total)    > 0.5)
    wfRows.push(mkRow("Moved In (from Earlier Period)",  B.movedInPrior,     1, "Trailing from earlier period"));
  if (Math.abs(B.movedInNext.total)     > 0.5)
    wfRows.push(mkRow("Moved In (from Later Period)",    B.movedInNext,      1, "Pulled forward from later period"));
  if (Math.abs(B.offCycle.total)        > 0.5)
    wfRows.push(mkRow("Off-Cycle / No Rev This Term",    B.offCycle,        -1, "Active clients with no rev this period"));
  if (Math.abs(B.manualAdds.total)      > 0.5)
    wfRows.push(mkRow("Manual Adds",                     B.manualAdds,       1, "Added to forecast, not in baseline"));
  if (Math.abs(B.adjustments.total)    > 0.5)
    wfRows.push(mkRow("Adjustments",                     B.adjustments,      1, "Net impact from 2026 adjustment entries"));
  if (Math.abs(variance.total)          > 0.5)
    wfRows.push([
      "Variance / Other",
      variance.total, variance.n, variance.m, variance.ih, variance.ah,
      "Amount changes, upsells, rounding"
    ]);
  wfRows.push(mkRow(`${pLabel} Forecast`,               B.forecast,         1,  "Ending Amount"));

  // ── Write waterfall table ─────────────────────────────────
  sh.getRange(6, 2, wfRows.length, 7).setValues(wfRows);
  sh.getRange(6, 3, wfRows.length, 5).setNumberFormat(AMT_FMT);

  wfRows.forEach((row, i) => {
    const r = 6 + i;
    const isEnd = i === 0 || i === wfRows.length - 1;
    const gr = sh.getRange(r, 2, 1, 7);
    if (isEnd) {
      gr.setBackground(ES.THEME.SECTION).setFontWeight("bold").setFontSize(11);
    } else if (row[1] < 0) {
      gr.setBackground("#fff0f0");
    } else if (row[1] > 0) {
      gr.setBackground("#f0fff4");
    }
    sh.getRange(r, 2).setFontWeight("bold");
  });

  // ── Account Drilldown ─────────────────────────────────────
  const drillDefs = [
    { label: "Lost Logo",                bkt: B.lostLogo        },
    { label: "Moved Out (Earlier)",      bkt: B.movedOutEarlier },
    { label: "Moved Out (Later)",        bkt: B.movedOutLater   },
    { label: "Moved In (from Earlier)",  bkt: B.movedInPrior    },
    { label: "Moved In (from Later)",    bkt: B.movedInNext     },
    { label: "Off-Cycle / No Rev",       bkt: B.offCycle        },
    { label: "Manual Adds",              bkt: B.manualAdds      },
    { label: "Adjustments",             bkt: B.adjustments     },
  ];

  let dr = 6 + wfRows.length + 2;
  sh.getRange(dr, 2, 1, 7).merge()
    .setValue("ACCOUNT DRILLDOWN  ·  accounts contributing to each bucket")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff").setFontWeight("bold");
  dr++;

  for (const dd of drillDefs) {
    if (!dd.bkt.accts.length) continue;
    sh.getRange(dr, 2, 1, 7).merge()
      .setValue(`${dd.label}  (${dd.bkt.accts.length} account(s)  ·  $${Math.round(Math.abs(dd.bkt.total)).toLocaleString()})`)
      .setBackground(ES.THEME.SECTION).setFontWeight("bold");
    dr++;
    sh.getRange(dr, 2, 1, 4)
      .setValues([["Account Name", "Product", "Amount ($)", "Notes / Period"]])
      .setFontWeight("bold").setFontColor(ES.THEME.MUTED).setFontSize(9);
    dr++;
    const sorted = dd.bkt.accts.slice().sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt));
    for (const a of sorted) {
      sh.getRange(dr, 2).setValue(a.acct);
      sh.getRange(dr, 3).setValue(a.prod);
      sh.getRange(dr, 4).setValue(a.amt).setNumberFormat(AMT_FMT);
      if (a.note) sh.getRange(dr, 5).setValue(a.note).setFontColor(ES.THEME.MUTED).setFontSize(9);
      dr++;
    }
    dr++;
  }

  // ── CSM Accountability Summary ────────────────────────────
  dr++;
  sh.getRange(dr, 2, 1, 7).merge()
    .setValue("CSM ACCOUNTABILITY SUMMARY  ·  forecast changes by rep")
    .setBackground(ES.THEME.NAVY).setFontColor("#fff").setFontWeight("bold");
  dr++;

  // Group rows by CSM to show per-rep delta
  const csmMap = {};
  for (const r of allData) {
    const csm  = String(r[C.csm]     || "(Unassigned)").trim();
    const prod = ES_wf_normProd_(String(r[C.product] || "").trim());
    if (prod === "Unknown") continue;
    const bDate = ES_wf_parseDate_(r[C.bMonth]);
    const fDate = ES_wf_parseDate_(r[C.fMonth]);
    const bAmt  = typeof r[C.bAmt] === "number" ? r[C.bAmt] : 0;
    const fAmt  = typeof r[C.fAmt] === "number" ? r[C.fAmt] : 0;
    const fcat  = String(r[C.fCat]  || "").trim();
    const out   = String(r[C.outreach] || "").trim();
    if (bAmt === 0 && fAmt === 0) continue;

    const bInPeriod = bDate && periodMonths.some(
      pm => pm.year === bDate.getFullYear() && pm.month === bDate.getMonth());
    const fInPeriod = fDate && periodMonths.some(
      pm => pm.year === fDate.getFullYear() && pm.month === fDate.getMonth());
    if (!bInPeriod && !fInPeriod) continue;

    if (!csmMap[csm]) csmMap[csm] = { baseline: 0, forecast: 0, notExp: 0, noStatus: 0, moves: 0 };
    const e = csmMap[csm];
    if (bInPeriod) e.baseline += bAmt;
    if (fInPeriod) e.forecast += fAmt;
    if (/^not\s+expected/i.test(fcat)) e.notExp++;
    if (!out && fInPeriod && fAmt > 0) e.noStatus++;
    if (bDate && fDate && bDate.getTime() !== fDate.getTime()) e.moves++;
  }

  const csmHdrs = [["CSM", "Baseline ($)", "Forecast ($)", "Delta ($)", "Not Expected", "Missing Status", "Month Moves"]];
  sh.getRange(dr, 2, 1, 7).setValues(csmHdrs)
    .setFontWeight("bold").setBackground(ES.THEME.SECTION).setFontColor(ES.THEME.MUTED).setFontSize(9);
  dr++;

  const csmEntries = Object.entries(csmMap).sort((a, b) => b[1].baseline - a[1].baseline);
  for (const [name, e] of csmEntries) {
    const delta = e.forecast - e.baseline;
    sh.getRange(dr, 2).setValue(name);
    sh.getRange(dr, 3).setValue(e.baseline).setNumberFormat(AMT_FMT);
    sh.getRange(dr, 4).setValue(e.forecast).setNumberFormat(AMT_FMT);
    sh.getRange(dr, 5).setValue(delta).setNumberFormat(AMT_FMT);
    if (delta < 0) sh.getRange(dr, 5).setFontColor("red");
    sh.getRange(dr, 6).setValue(e.notExp);
    sh.getRange(dr, 7).setValue(e.noStatus > 0 ? `⚠ ${e.noStatus}` : "");
    if (e.noStatus > 0) sh.getRange(dr, 7).setFontColor("#c05000");
    sh.getRange(dr, 8).setValue(e.moves);
    dr++;
  }
}

/* ==================== WATERFALL HELPERS ==================== */

/** Parse "Jan-26", "Q1 2026", or "Full Year 2026" into [{year, month(0-based)}] */
function ES_wf_periodMonths_(period) {
  if (period === "Full Year 2026") {
    return Array.from({length: 13}, (_, i) => {
      // Dec-25 (month 11 of 2025) through Dec-26 (month 11 of 2026)
      // Full year = all months that can appear in FY2026 baseline or forecast
      const y = i === 0 ? 2025 : 2026;
      const m = i === 0 ? 11 : i - 1;
      return { year: y, month: m };
    });
  }
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

/** "Jan-26" → "Jan",  "Q1 2026" → "Q1",  Full Year → "FY2026" */
function ES_wf_periodLabel_(periodMonths) {
  const ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (periodMonths.length === 1) return ABBR[periodMonths[0].month];
  if (periodMonths.length >= 12) return "FY2026";
  return `Q${Math.floor(periodMonths[0].month / 3) + 1}`;
}

/** Format a Date as "Jan-26" */
function ES_wf_dateLabel_(d) {
  const ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const yr = String(d.getFullYear()).slice(-2);
  return ABBR[d.getMonth()] + "-" + yr;
}

/** Get unique non-blank values from a 0-based column index in a sheet */
function ES_wf_getUnique_(ss, sheetName, colIdx, sorted) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2, colIdx + 1, sh.getLastRow() - 1, 1).getValues().flat();
  const seen = new Set();
  const result = [];
  for (const v of vals) {
    const s = String(v || "").trim();
    if (s && !seen.has(s)) { seen.add(s); result.push(s); }
  }
  return sorted ? result.sort() : result;
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
