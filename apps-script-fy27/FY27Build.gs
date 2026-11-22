/*******************************************************
 * FY27Build.gs
 * Sheet I/O around the pure engine in FY27Engine.gs.
 *
 *  Reads : Tableau Bookings Data, otc_* tab, Salesforce Data* tab, Forecast Overrides
 *  Writes: Forecast (fully rebuilt), Forecast Review (flags + coverage),
 *          Tableau Bookings Data (only the empty OTC match columns, optional)
 *  Never touches: Forecast Overrides contents (your manual edits), any other tab.
 *
 * Refresh = paste new Tableau / OTC / Salesforce data over the input tabs, then
 * menu: FY27 Forecast > Build / refresh forecast.
 *******************************************************/

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("FY27 Forecast")
    .addItem("Build / refresh forecast", "FY27_run")
    .addItem("Add override for selected Forecast row", "FY27_addOverrideForSelection")
    .addItem("Backtest against 2026 forecast", "FY27_runBacktest")
    .addSeparator()
    .addItem("Set up Overrides tab", "FY27_ensureOverridesSheet_")
    .addToUi();
}

const FY27_FORECAST_COLUMNS = [
  ["Account Name with Student Org", "accountNameWithOrg"],
  ["Student Org ID", "studentOrgId"],
  ["Account Name", "accountName"],
  ["Sales Rep", "salesRep"],
  ["Customer Type", "customerType"],
  ["FULL ID", "fullId"],
  ["Rating", "rating"],
  ["Client Category", "clientCategory"],
  ["Client Sub-Category", "clientSubCategory"],
  ["Billing State/Province", "billingState"],
  ["Account Owner", "accountOwner"],
  ["Client Success Manager", "csm"],
  ["Parent Account", "parentAccount"],
  ["Billing Country", "billingCountry"],
  ["Parent Account ID", "parentAccountId"],
  ["Account Record Type", "accountRecordType"],
  ["Product Group", "productGroup"],
  ["Product Name", "productName"],
  ["Forecast Source", "forecastSource"],
  ["Prior Booking Type", "priorBookingType"],
  ["Next Booking Type", "nextBookingType"],
  ["Adjustment (true/false)", "adjustment"],
  ["Baseline Booking Month - Tableau", "baselineMonth", "month"],
  ["booking_id", "bookingId"],
  ["Contract ID", "contractId"],
  ["Contract Start Date", "contractStart", "month"],
  ["Contract End Date", "contractEnd", "month"],
  ["Forecast Month", "forecastMonth", "month"],
  ["Forecast Quarter", "forecastQuarter"],
  ["Baseline Amount", "baselineAmount", "money"],
  ["Baseline vs OTC Variance", "adjVariance", "money"],
  ["Value If Booked", "valueIfBooked", "money"],
  ["Forecast Amount", "forecastAmount", "money"],
  ["Forecast Weight", "weight", "pct"],
  ["Weighted Forecast Amount", "weightedAmount", "money"],
  ["Est. Students (OTC)", "estStudents"],
  ["Trend-Adjusted Students", "adjStudents"],
  ["Price Per Student", "price", "money"],
  ["Cohort Names", "cohortNames"],
  ["Cohort Codes", "cohortCodes"],
  ["Prior-Year Cohorts", "priorCohorts"],
  ["Product Code (OTC)", "productCode"],
  ["Program (OTC)", "otcProgram"],
  ["Product Type (OTC)", "productType"],
  ["Modality (OTC)", "modality"],
  ["Term (months, OTC)", "termMonths"],
  ["2027 Booking Type", "bookingType"],
  ["Credit Type", "credit"],
  ["Credit Basis", "creditBasis"],
  ["Status", "status"],
  ["Forecast Category", "expectation"],
  ["Flags", "flags", "flags"],
  ["Line Key", "key"]
];

/** Entry point. */
function FY27_run() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error("Another refresh is running. Try again in 30 seconds.");
  try {
    const ss = SpreadsheetApp.getActive();
    const cfg = FY27_CFG;
    ss.toast("Reading input tabs...", "FY27 Forecast", 5);

    const tabSheet = FY27_mustFind_(ss, cfg.SHEETS.TABLEAU, null, "Tableau");
    const otcSheet = FY27_mustFind_(ss, cfg.SHEETS.OTC, cfg.SHEETS.OTC_PREFIX, "OTC");
    const sfSheet = FY27_mustFind_(ss, cfg.SHEETS.SALESFORCE, cfg.SHEETS.SALESFORCE_PREFIX, "Salesforce");
    const ovSheet = FY27_ensureOverridesSheet_();

    const tableau = FY27_gridToRows_(tabSheet.getDataRange().getValues());
    const otc = FY27_gridToRows_(otcSheet.getDataRange().getValues(), { skipRawHeaderRow: "account_name" });
    const sf = FY27_gridToRows_(sfSheet.getDataRange().getValues());
    const ov = FY27_gridToRows_(ovSheet.getDataRange().getValues());
    const adjSheet = cfg.USE_ADJUSTMENTS_TAB ? ss.getSheetByName(cfg.SHEETS.ADJUSTMENTS) : null;   // optional: negative adjustments live here
    const adjustments = adjSheet ? FY27_gridToRows_(adjSheet.getDataRange().getValues()) : { rows: [] };

    ss.toast("Building forecast (" + tableau.rows.length + " baseline rows, " + otc.rows.length + " OTC rows)...", "FY27 Forecast", 8);
    const result = FY27_buildForecast({
      tableau: tableau.rows, otc: otc.rows, salesforce: sf.rows, overrides: ov.rows,
      adjustments: adjustments.rows, now: new Date()
    }, cfg);

    FY27_writeForecast_(ss, result.lines, cfg.SHEETS.FORECAST);
    FY27_writeForecast_(ss, result.detail, cfg.SHEETS.DETAIL);
    FY27_writeReview_(ss, result);
    if (cfg.WRITE_BACK_TO_TABLEAU) FY27_writeBackTableau_(tabSheet, tableau, result.writeback);

    ss.toast(
      result.lines.length + " forecast rows (" + result.detail.length + " detail), " + result.review.length + " flags, total $" +
      Math.round(result.stats.total).toLocaleString() + ". See '" + cfg.SHEETS.REVIEW + "'.",
      "FY27 Forecast", 10);
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- readers ---------------- */

function FY27_mustFind_(ss, exact, prefix, label) {
  let sh = exact ? ss.getSheetByName(exact) : null;
  if (!sh && prefix) {
    const hits = ss.getSheets().filter(function (s) { return s.getName().toLowerCase().indexOf(prefix.toLowerCase()) === 0; });
    // several matches (old + new paste): take the one furthest right (most recently added)
    if (hits.length) sh = hits[hits.length - 1];
  }
  if (!sh) throw new Error("Could not find the " + label + " tab (looked for '" + (exact || prefix) + "'). Update FY27Config.gs.");
  return sh;
}

/* ---------------- writers ---------------- */

function FY27_monthToDate_(key) {
  if (!key) return "";
  const p = String(key).split("-");
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1);
}

function FY27_writeForecast_(ss, lines, name) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear(); sh.clearFormats();
  const cols = FY27_FORECAST_COLUMNS.filter(function (c) {
    return FY27_CFG.TAG_CREDIT || (c[1] !== "credit" && c[1] !== "creditBasis");
  });
  const headers = cols.map(function (c) { return c[0]; });
  const out = [headers];
  lines.forEach(function (L) {
    out.push(cols.map(function (c) {
      const v = L[c[1]], kind = c[2];
      if (kind === "month") return FY27_monthToDate_(v);
      if (kind === "flags") return (v || []).join(" | ");
      return v === undefined || v === null ? "" : v;
    }));
  });
  sh.getRange(1, 1, out.length, headers.length).setValues(out);
  // formats
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#E7EDF6");
  cols.forEach(function (c, i) {
    if (out.length < 2) return;
    const rng = sh.getRange(2, i + 1, out.length - 1, 1);
    if (c[2] === "month") rng.setNumberFormat("mmm-yy");
    if (c[2] === "money") rng.setNumberFormat("$#,##0");
    if (c[2] === "pct") rng.setNumberFormat("0%");
  });
  sh.autoResizeColumns(1, Math.min(headers.length, 20));
}

function FY27_writeReview_(ss, result) {
  const name = FY27_CFG.SHEETS.REVIEW;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear(); sh.clearFormats();
  const s = result.stats;
  const width = 7;
  const rows = [];
  const fmt = [];   // [rowIndex(1-based), colIndex, format]
  const add = function (r) { while (r.length < width) r.push(""); rows.push(r); return rows.length; };

  add(["FY" + FY27_CFG.FORECAST_YEAR + " forecast build - review"]);
  let r = add(["Built", new Date(), "Actuals complete through", FY27_addMonths_(s.actualsThrough, -1)]);
  fmt.push([r, 2, "yyyy-mm-dd hh:mm"]);
  add(["Forecast rows", s.lines, "OTC cohorts in " + FY27_CFG.FORECAST_YEAR, s.otcTargetRows, "...matched to baseline", s.otcMatched]);
  r = add(["Total forecast $ (full value)", s.total, "Weighted total $ (At Risk etc. weighted)", s.totalWeighted]);
  fmt.push([r, 2, "$#,##0"], [r, 4, "$#,##0"]);
  add(["Overrides applied", s.overridesApplied, "Adjustments derived (Tableau vs OTC)", s.derivedAdjustments]);
  r = add(["Not in Tableau (excluded)", s.excludedNotInTableau.accounts + " accounts", "OTC cohorts left out", s.excludedNotInTableau.cohorts, "Value left out", s.excludedNotInTableau.value]);
  fmt.push([r, 6, "$#,##0"]);
  r = add(["Gray/black roster chasing ignored", s.ignoredRosterChasing.cohorts + " OTC cohorts", "Value ignored", s.ignoredRosterChasing.value]);
  fmt.push([r, 4, "$#,##0"]);
  add([]);
  // baseline check: forecast baseline column should equal Tableau + Adjustments tab
  const bl = s.baseline;
  r = add(["Baseline check", "Tableau tab $", "Adjustments tab $", "Baseline in forecast $", "Difference $", ""]);
  const blHdr = r;
  r = add(["", bl.tableau, bl.adjustmentsTab, bl.inForecast, bl.difference]);
  fmt.push([r, 2, "$#,##0"], [r, 3, "$#,##0"], [r, 4, "$#,##0"], [r, 5, "$#,##0"]);
  add(["(Difference = baseline whose forecast month falls outside " + FY27_CFG.FORECAST_YEAR + ", or rows with no forecast month)"]);
  add([]);
  // what the forecast is made of
  const compHdrs = [];
  [["Forecast category", "byCategory", true], ["Forecast source", "bySource", false]].forEach(function (sec) {
    const ch = add([sec[0], "Rows", "Full value $", "Weighted $", sec[2] ? "Weight" : ""]);
    compHdrs.push(ch);
    const data = s.composition[sec[1]];
    Object.keys(data).sort(function (a, b) { return data[b].full - data[a].full; }).forEach(function (k) {
      const x = data[k];
      const rr = add([k, x.n, x.full, x.weighted, sec[2] ? (FY27_CFG.WEIGHTS[k] === undefined ? 1 : FY27_CFG.WEIGHTS[k]) : ""]);
      fmt.push([rr, 2, "#,##0"], [rr, 3, "$#,##0"], [rr, 4, "$#,##0"], [rr, 5, "0%"]);
    });
    add([]);
  });
  const covHdr = add(["Month coverage", "Booked $", "Forecast $ (full value)", "Weighted forecast $", "Booked lines", "Forecast lines", "Baseline month incomplete?"]);
  result.coverage.forEach(function (c) {
    const rr = add([FY27_monthToDate_(c.month), c.booked, c.forecast, c.weighted, c.bookedLines, c.forecastLines, c.baselineIncomplete ? "YES" : ""]);
    fmt.push([rr, 1, "mmm-yy"], [rr, 2, "$#,##0"], [rr, 3, "$#,##0"], [rr, 4, "$#,##0"]);
  });
  add([]);
  const flagHdr = add(["Severity", "Flag", "Account", "Product", "Forecast Month", "Value If Booked", ""]);
  result.review.forEach(function (x) {
    const rr = add([x.severity, x.flag, x.account, x.productGroup + " / " + x.productName, FY27_monthToDate_(x.forecastMonth), x.valueIfBooked]);
    fmt.push([rr, 5, "mmm-yy"], [rr, 6, "$#,##0"]);
  });
  const w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, width);   // never let a row outgrow the range
  rows.forEach(function (r) { while (r.length < w) r.push(""); });
  sh.getRange(1, 1, rows.length, w).setValues(rows);
  fmt.forEach(function (f) { sh.getRange(f[0], f[1]).setNumberFormat(f[2]); });
  sh.getRange(1, 1).setFontWeight("bold").setFontSize(14);
  compHdrs.forEach(function (h) { sh.getRange(h, 1, 1, w).setFontWeight("bold").setBackground("#E7EDF6"); });
  [blHdr, covHdr, flagHdr].forEach(function (h) { sh.getRange(h, 1, 1, width).setFontWeight("bold").setBackground("#E7EDF6"); });
  sh.setColumnWidth(2, 460);
  sh.autoResizeColumns(1, 1);
}

/** Fill the (empty) OTC columns on the Tableau tab. Only these named columns are touched. */
function FY27_writeBackTableau_(sh, tableau, writeback) {
  const map = {
    "Contract ID": "contractId",
    "Contract Start Date": "contractStart",
    "Contract End Date - OTC": "contractEnd",
    "Forecast Month - OTC": "forecastMonthOtc",
    "Price Per Student - OTC": "price",
    "Estimated # of Students - OTC": "estStudents",
    "Estimated Forecast Amount - OTC": "estAmount",
    "2027 Forecast Booking Type (roster chasing, rebooking, mix)": "bookingType",
    "2027 Forecast Booking Cohort Names": "cohortNames"
  };
  const monthCols = { "Contract Start Date": 1, "Contract End Date - OTC": 1, "Forecast Month - OTC": 1 };
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  Object.keys(map).forEach(function (header) {
    const idx = tableau.headers.indexOf(header);
    if (idx < 0) return;
    const col = idx + 1;
    const vals = [];
    for (let r = 2; r <= lastRow; r++) {
      const wb = writeback[r];
      let v = wb ? wb[map[header]] : "";
      if (monthCols[header]) v = FY27_monthToDate_(v);
      vals.push([v === undefined || v === null ? "" : v]);
    }
    const rng = sh.getRange(2, col, vals.length, 1);
    rng.setValues(vals);
    if (monthCols[header]) rng.setNumberFormat("m/d/yyyy");
  });
}

/* ---------------- overrides ---------------- */

function FY27_ensureOverridesSheet_() {
  const ss = SpreadsheetApp.getActive();
  const name = FY27_CFG.SHEETS.OVERRIDES;
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 8).setValues([["Line Key", "Account", "Product", "Forecast Month", "Override Amount", "Override Month", "Exclude", "Comment"]]);
    sh.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#E7EDF6");
    sh.setFrozenRows(1);
    sh.getRange(2, 7, 500, 1).insertCheckboxes();
  }
  return sh;
}

/** Select any cell in a Forecast row, run this, then fill Override Amount / Month / Exclude on the Overrides tab. */
function FY27_addOverrideForSelection() {
  const ss = SpreadsheetApp.getActive();
  const fc = ss.getSheetByName(FY27_CFG.SHEETS.FORECAST);
  if (!fc || ss.getActiveSheet().getName() !== fc.getName()) {
    SpreadsheetApp.getUi().alert("Select a row on the '" + FY27_CFG.SHEETS.FORECAST + "' tab first.");
    return;
  }
  const row = ss.getActiveRange().getRow();
  if (row < 2) return;
  const hdr = fc.getRange(1, 1, 1, fc.getLastColumn()).getValues()[0];
  const vals = fc.getRange(row, 1, 1, hdr.length).getValues()[0];
  const get = function (h) { return vals[hdr.indexOf(h)]; };
  const ov = FY27_ensureOverridesSheet_();
  const last = Math.max(ov.getLastRow(), 1) + 1;
  ov.getRange(last, 1, 1, 4).setValues([[get("Line Key"), get("Account Name"), get("Product Group") + " / " + get("Product Name"), get("Forecast Month")]]);
  ov.getRange(last, 4).setNumberFormat("mmm-yy");
  ov.getRange(last, 7).insertCheckboxes();
  ss.setActiveSheet(ov);
  ov.setActiveRange(ov.getRange(last, 5));
}

/* ---------------- backtest vs the 2026 forecast ---------------- */

function FY27_runBacktest() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) throw new Error("Another run is in progress. Try again in 30 seconds.");
  try {
    const ss = SpreadsheetApp.getActive();
    const cfg = FY27_CFG;
    ss.toast("Reading reference tabs...", "FY27 Backtest", 5);
    const readRows = function (sh, opts) { return FY27_gridToRows_(sh.getDataRange().getValues(), opts).rows; };
    const beginning = readRows(FY27_mustFind_(ss, cfg.SHEETS.BT_BEGINNING, null, "2026 Beginning Forecast Reference"));
    const final = readRows(FY27_mustFind_(ss, cfg.SHEETS.BT_FINAL, null, "2026 Forecast Reference"));
    const otc = readRows(FY27_mustFind_(ss, cfg.SHEETS.OTC, cfg.SHEETS.OTC_PREFIX, "OTC"), { skipRawHeaderRow: "account_name" });
    const sf = readRows(FY27_mustFind_(ss, cfg.SHEETS.SALESFORCE, cfg.SHEETS.SALESFORCE_PREFIX, "Salesforce"));
    const a24 = ss.getSheetByName(cfg.SHEETS.BT_ACTUALS_2024);
    const actuals = a24 ? readRows(a24) : [];
    ss.toast("Running the engine on the 2025 baseline...", "FY27 Backtest", 8);
    const bt = FY27_backtest_({ beginning: beginning, final: final, salesforce: sf, otc: otc, actuals: actuals }, cfg);
    FY27_writeBacktest_(ss, bt);
    ss.toast(bt.compared + " baseline lines compared. See '" + cfg.SHEETS.BT_SUMMARY + "'.", "FY27 Backtest", 10);
  } finally {
    lock.releaseLock();
  }
}

function FY27_writeBacktest_(ss, bt) {
  const cfg = FY27_CFG;
  const sum = ss.getSheetByName(cfg.SHEETS.BT_SUMMARY) || ss.insertSheet(cfg.SHEETS.BT_SUMMARY);
  const det = ss.getSheetByName(cfg.SHEETS.BT_DETAIL) || ss.insertSheet(cfg.SHEETS.BT_DETAIL);
  sum.clear(); sum.clearFormats(); det.clear(); det.clearFormats();
  const rows = [], fmt = [];
  const add = function (r) { while (r.length < 7) r.push(""); rows.push(r); return rows.length; };
  add(["Backtest: engine logic on the 2025 baseline vs the final 2026 forecast"]);
  add(["Compared baseline lines", bt.compared, "Engine only", bt.engineOnly, "Team forecast only", bt.teamOnly]);
  add(["Bands: Full = forecast >= 90% of baseline, Zero = <= 5%, Partial = in between. OTC is the Nov 2026 export, so read this as a logic check."]);
  add([]);
  let hdr = add(["Engine says", "Team 2026 final says", "Lines", "Baseline $", "", "", ""]);
  const hdrs = [hdr];
  ["Zero", "Partial", "Full"].forEach(function (eb) {
    ["Zero", "Partial", "Full"].forEach(function (tb) {
      const c = bt.cross[eb + "|" + tb] || { n: 0, base: 0 };
      const r = add([eb, tb, c.n, c.base]);
      fmt.push([r, 3, "#,##0"], [r, 4, "$#,##0"]);
    });
  });
  add([]);
  hdr = add(["Why the engine zeroed it", "Lines", "Baseline $", "Team also zero", "Team zero $", "Team kept (full)", "Team kept $"]);
  hdrs.push(hdr);
  Object.keys(bt.reasons).sort(function (a, b) { return bt.reasons[b].base - bt.reasons[a].base; }).forEach(function (k) {
    const x = bt.reasons[k];
    const r = add([k, x.n, x.base, x.teamZero, x.teamZeroBase, x.teamFull, x.teamFullBase]);
    fmt.push([r, 2, "#,##0"], [r, 3, "$#,##0"], [r, 4, "#,##0"], [r, 5, "$#,##0"], [r, 6, "#,##0"], [r, 7, "$#,##0"]);
  });
  add([]);
  hdr = add(["Signal on the engine side", "Lines", "Baseline $", "Team zero (lines)", "Team zero (% of lines)", "Team zero $", "Team zero (% of $)"]);
  hdrs.push(hdr);
  Object.keys(bt.signals).sort().forEach(function (k) {
    const x = bt.signals[k];
    const r = add([k, x.n, x.base, x.zero, x.n ? x.zero / x.n : 0, x.zeroBase, x.base ? x.zeroBase / x.base : 0]);
    fmt.push([r, 2, "#,##0"], [r, 3, "$#,##0"], [r, 4, "#,##0"], [r, 5, "0%"], [r, 6, "$#,##0"], [r, 7, "0%"]);
  });
  add([]);
  hdr = add(["Year level (account x product group)", "Team says", "Accounts", "Baseline $", "Engine forecast $", "Team final $", ""]);
  hdrs.push(hdr);
  ["Zero", "Partial", "Full"].forEach(function (eb) {
    ["Zero", "Partial", "Full"].forEach(function (tb) {
      const c = bt.yearCross[eb + "|" + tb] || { n: 0, base: 0, engine: 0, team: 0 };
      const r = add(["Engine " + eb, tb, c.n, c.base, c.engine, c.team]);
      fmt.push([r, 3, "#,##0"], [r, 4, "$#,##0"], [r, 5, "$#,##0"], [r, 6, "$#,##0"]);
    });
  });
  add([]);
  hdr = add(["2026 month", "Baseline $", "Engine forecast $ (full)", "Engine weighted $", "Team final forecast $", "", ""]);
  hdrs.push(hdr);
  Object.keys(bt.monthly).sort().forEach(function (m) {
    const x = bt.monthly[m];
    const r = add([FY27_monthToDate_(m), x.baseline, x.engine, x.engineWeighted, x.team]);
    fmt.push([r, 1, "mmm-yy"], [r, 2, "$#,##0"], [r, 3, "$#,##0"], [r, 4, "$#,##0"], [r, 5, "$#,##0"]);
  });
  const bw = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 7);
  rows.forEach(function (r) { while (r.length < bw) r.push(""); });
  sum.getRange(1, 1, rows.length, bw).setValues(rows);
  fmt.forEach(function (f) { sum.getRange(f[0], f[1]).setNumberFormat(f[2]); });
  sum.getRange(1, 1).setFontWeight("bold").setFontSize(14);
  hdrs.forEach(function (h) { sum.getRange(h, 1, 1, 7).setFontWeight("bold").setBackground("#E7EDF6"); });
  sum.autoResizeColumns(1, 7);

  const head = ["Account", "Product Group", "2026 Month", "Baseline $", "Engine forecast $", "Team final $", "Engine band", "Team band",
    "Engine reason", "Team category", "Team roll-up", "Team outreach status", "Team comment", "Engine flags"];
  const out = [head];
  bt.detail.slice(0, 2000).forEach(function (d) {
    out.push([d.account, d.group, FY27_monthToDate_(d.month), d.baseline, d.engine, d.team, d.engineBand, d.teamBand,
      d.engineReason, d.teamCategory, d.teamRollup, d.outreach, d.teamComment, d.engineFlags]);
  });
  det.getRange(1, 1, out.length, head.length).setValues(out);
  det.setFrozenRows(1);
  det.getRange(1, 1, 1, head.length).setFontWeight("bold").setBackground("#E7EDF6");
  if (out.length > 1) {
    det.getRange(2, 3, out.length - 1, 1).setNumberFormat("mmm-yy");
    det.getRange(2, 4, out.length - 1, 3).setNumberFormat("$#,##0");
  }
  det.autoResizeColumns(1, 11);

  // every compared line with its features, so the signals can be mined offline
  const allSh = ss.getSheetByName(cfg.SHEETS.BT_ALL) || ss.insertSheet(cfg.SHEETS.BT_ALL);
  allSh.clear(); allSh.clearFormats();
  const ah = ["Account", "Org ID", "Product Group", "2026 Month", "Baseline $", "Engine $", "Team $", "Engine band", "Team band", "Team category",
    "Team outreach", "Rating", "CSM", "Source", "Cohort total $", "Engine/baseline", "Contract end", "Months to contract end",
    "Booked same month in 2024", "2024 total (group)", "Engine flags", "OTC estimate $", "Segment", "Engine weighted $"];
  const ao = [ah];
  bt.all.slice(0, 5000).forEach(function (a) {
    ao.push([a.account, a.org, a.group, FY27_monthToDate_(a.month), a.baseline, a.engine, a.team, a.engineBand, a.teamBand, a.teamCategory,
      a.outreach, a.rating, a.csm, a.source, a.cohortTotal, a.ratio, FY27_monthToDate_(a.contractEnd), a.monthsToEnd,
      a.booked2024SameMonth, a.total2024, a.flags, a.otcEst, a.segment, a.engineWeighted]);
  });
  allSh.getRange(1, 1, ao.length, ah.length).setValues(ao);
  allSh.setFrozenRows(1);
  allSh.getRange(1, 1, 1, ah.length).setFontWeight("bold").setBackground("#E7EDF6");
  if (ao.length > 1) {
    allSh.getRange(2, 4, ao.length - 1, 1).setNumberFormat("mmm-yy");
    allSh.getRange(2, 5, ao.length - 1, 3).setNumberFormat("$#,##0");
    allSh.getRange(2, 17, ao.length - 1, 1).setNumberFormat("mmm-yy");
  }
}
