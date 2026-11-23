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
    .addItem("Build / refresh forecast (also applies CSM changes)", "FY27_run")
    .addSeparator()
    .addItem("Show the Read Me", "FY27_showReadMe")
    .addItem("Backtest against 2026 forecast", "FY27_runBacktest")
    .addToUi();
}

function FY27_showReadMe() {
  const ss = SpreadsheetApp.getActive();
  FY27_ensureReadMe_();
  ss.setActiveSheet(ss.getSheetByName(FY27_CFG.SHEETS.README));
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
  ["Weight Basis", "segment"],
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
  ["Not Expected Reason", "reason"],
  ["Roster Stage", "stage"],
  ["Timing vs Baseline", "timing"],
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
    const manualSheet = FY27_ensureManualSheet_();
    const manual = FY27_gridToRows_(manualSheet.getDataRange().getValues());
    const mergeSheet = FY27_ensureMergeSheet_();
    const merges = FY27_gridToRows_(mergeSheet.getDataRange().getValues());
    const carrySheet = ss.getSheetByName(cfg.SHEETS.CARRY);                                    // optional: current prior-year Nov/Dec forecast
    const carry = carrySheet ? FY27_gridToRows_(carrySheet.getDataRange().getValues()) : { rows: [] };
    const adjSheet = cfg.USE_ADJUSTMENTS_TAB ? ss.getSheetByName(cfg.SHEETS.ADJUSTMENTS) : null;   // optional: negative adjustments live here
    const adjustments = adjSheet ? FY27_gridToRows_(adjSheet.getDataRange().getValues()) : { rows: [] };

    ss.toast("Building forecast (" + tableau.rows.length + " baseline rows, " + otc.rows.length + " OTC rows)...", "FY27 Forecast", 8);
    const input = {
      tableau: tableau.rows, otc: otc.rows, salesforce: sf.rows, overrides: ov.rows,
      adjustments: adjustments.rows, manual: manual.rows, carry: carry.rows, merges: merges.rows, now: new Date()
    };
    const result = FY27_buildForecast(input, cfg);

    // summary page: predicted retention by model + actual history (never allowed to break the main build)
    let retention = null;
    try {
      retention = { models: [], history: [], team2026: null };
      if (cfg.RETENTION_MODELS) {
        ss.toast("Comparing models...", "FY27 Forecast", 8);
        retention.models = FY27_retentionModels_(input, cfg, result);
      }
      const rawSheet = ss.getSheets().filter(function (s) { return s.getName().indexOf(cfg.SHEETS.RAW_HISTORY_PREFIX) === 0; })[0];
      if (rawSheet) retention.history = FY27_historicalRetention_(FY27_gridToRows_(rawSheet.getDataRange().getValues()).rows, FY27_addMonths_(result.stats.actualsThrough, -1));
      const refSheet = ss.getSheetByName(cfg.SHEETS.BT_FINAL);
      if (refSheet) retention.team2026 = FY27_team2026Retention_(FY27_gridToRows_(refSheet.getDataRange().getValues()).rows);
    } catch (e) {
      ss.toast("Retention comparison skipped: " + e.message, "FY27 Forecast", 8);
    }

    FY27_writeForecast_(ss, result.lines, cfg.SHEETS.FORECAST);
    FY27_writeForecast_(ss, result.detail, cfg.SHEETS.DETAIL);
    FY27_writeReview_(ss, result, retention);
    FY27_writeCsmSheet_(ss, result.lines, ov.rows, result.stats.overrideStatus);
    FY27_writeOverrideStatus_(ovSheet, result.stats.overrideStatus);
    FY27_writeManualStatus_(manualSheet, result.stats.manualResults);
    FY27_writeMergeStatus_(mergeSheet, result.stats.mergeResults);
    FY27_ensureReadMe_();
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

/** Belt and braces: wipe formats on the whole grid (stale date / currency formats from older layouts were surviving a rebuild). */
function FY27_resetFormats_(sh) {
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearFormat();
}

function FY27_monthToDate_(key) {
  if (!key) return "";
  const p = String(key).split("-");
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1);
}

function FY27_writeForecast_(ss, lines, name) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear(); sh.clearFormats(); FY27_resetFormats_(sh);
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

function FY27_writeReview_(ss, result, retention) {
  const name = FY27_CFG.SHEETS.REVIEW;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear(); sh.clearFormats(); FY27_resetFormats_(sh);
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
  const ovSt = s.overrideStatus || {};
  const ovNotFound = Object.keys(ovSt).filter(function (k) { return ovSt[k] === "Not found"; }).length;
  const manRes = s.manualResults || [];
  const manBad = manRes.filter(function (m) { return String(m.status).indexOf("NOT ADDED") === 0; }).length;
  add(["CSM changes applied", s.overridesApplied, "CSM changes NOT matched to a line (see Overrides tab)", ovNotFound, "Adjustments derived (Tableau vs OTC)", s.derivedAdjustments]);
  const eb = s.earlyBooked || { lines: 0, value: 0 }, cy = s.carry || {};
  add(["Booked early in " + (FY27_CFG.FORECAST_YEAR - 1) + " (counted there, $0 here)", eb.active ? eb.lines + " lines" : "rule off", "Value $", eb.value, "Pushed in from " + (FY27_CFG.FORECAST_YEAR - 1) + " forecast", (cy.replaced || 0) + (cy.added || 0) + " lines"]);
  add(["Open " + (FY27_CFG.FORECAST_YEAR - 1) + " Nov/Dec lines (not booked)", (cy.openLines || 0) + " lines", "Value $", cy.openValue || 0, "Pushed value $", cy.pushedValue || 0, "Slip rate", FY27_CFG.CARRY_OPEN_SLIP_RATE]);
  add(["Manual add-on lines added", s.manualAdded || 0, "Manual add-on rows NOT added (see Status column)", manBad]);
  r = add(["Not in Tableau (excluded)", s.excludedNotInTableau.accounts + " accounts", "OTC cohorts left out", s.excludedNotInTableau.cohorts, "Value left out", s.excludedNotInTableau.value]);
  fmt.push([r, 6, "$#,##0"]);
  r = add(["Gray/black roster chasing ignored", s.ignoredRosterChasing.cohorts + " OTC cohorts", "Value ignored", s.ignoredRosterChasing.value]);
  fmt.push([r, 4, "$#,##0"]);
  add([]);
  // predicted retention under each model, next to what retention actually was
  const retHdrs = [];
  if (retention && retention.models && retention.models.length) {
    retHdrs.push(add(["Predicted retention by model", "Forecast $ (full)", "Weighted $", "Gross retention (full)", "Gross retention (weighted)", "Net retention (weighted)", "Confirmed only (gross)"]));
    retention.models.forEach(function (m) {
      const rr = add([m.name, m.fullNet, m.weightedNet, m.fullGrossPct, m.weightedGrossPct, m.weightedNetPct, m.confirmedGrossPct]);
      fmt.push([rr, 2, "$#,##0"], [rr, 3, "$#,##0"], [rr, 4, "0.0%"], [rr, 5, "0.0%"], [rr, 6, "0.0%"], [rr, 7, "0.0%"]);
    });
    add(["Retention = forecast / Tableau baseline (" + "$" + Math.round(retention.models[0].baseline).toLocaleString() + "). Gross = lines tied to a Tableau baseline row only; net also counts new and additional OTC cohorts; confirmed = Captured + Expected only."]);
  }
  if (retention && ((retention.history && retention.history.length) || retention.team2026)) {
    retHdrs.push(add(["Actual retention history (raw Tableau)", "Earlier-year $", "Gross $ retention", "Net $ retention", "Logo retention", "Accounts x group", ""]));
    (retention.history || []).forEach(function (h) {
      const rr = add([h.label, h.baseline, h.grossPct, h.netPct, h.logoPct, h.accounts]);
      fmt.push([rr, 2, "$#,##0"], [rr, 3, "0.0%"], [rr, 4, "0.0%"], [rr, 5, "0.0%"], [rr, 6, "#,##0"]);
    });
    if (retention.team2026) {
      let rr = add(["2026 team forecast, system-forecast lines only (like for like)", retention.team2026.baseline, retention.team2026.pct, "", "", ""]);
      fmt.push([rr, 2, "$#,##0"], [rr, 3, "0.0%"]);
      rr = add(["...including manual adds (new sales and placeholders; not retention)", retention.team2026.baseline, retention.team2026.pctWithManual, "", "", ""]);
      fmt.push([rr, 2, "$#,##0"], [rr, 3, "0.0%"]);
    }
    add(["Gross $ = renewals only (min of this year and last year per account x group); net $ includes expansion; logo = share of accounts x group with any booking."]);
  }
  if (retHdrs.length) add([]);
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
  [["Forecast category", "byCategory", true], ["Forecast source", "bySource", false], ["Weight basis", "bySegment", false]].forEach(function (sec) {
    const ch = add([sec[0], "Rows", "Full value $", "Weighted $", "Effective weight"]);
    compHdrs.push(ch);
    const data = s.composition[sec[1]];
    Object.keys(data).sort(function (a, b) { return data[b].full - data[a].full; }).forEach(function (k) {
      const x = data[k];
      // effective weight = weighted / full (a category can mix segment weights, e.g. Pending Contract is 60-85% by how long ago the contract ended)
      const rr = add([k, x.n, x.full, x.weighted, x.full ? x.weighted / x.full : ""]);
      fmt.push([rr, 2, "#,##0"], [rr, 3, "$#,##0"], [rr, 4, "$#,##0"], [rr, 5, "0%"]);
    });
    add([]);
  });
  const covHdr = add(["Month coverage", "Booked $", "Forecast $ (full value)", "Weighted forecast $", "Booked lines", "Forecast lines", "Baseline month incomplete?"]);
  result.coverage.forEach(function (c) {
    const rr = add([FY27_monthToDate_(c.month), c.booked, c.forecast, c.weighted, c.bookedLines, c.forecastLines, c.baselineIncomplete ? "YES" : ""]);
    fmt.push([rr, 1, "mmm-yy"], [rr, 2, "$#,##0"], [rr, 3, "$#,##0"], [rr, 4, "$#,##0"], [rr, 5, "#,##0"], [rr, 6, "#,##0"]);
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
  compHdrs.concat(retHdrs).forEach(function (h) { sh.getRange(h, 1, 1, w).setFontWeight("bold").setBackground("#E7EDF6"); });
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

const FY27_OVERRIDE_HEADER = ["Line Key", "Account", "Product", "Forecast Month", "Override Amount", "Override Month",
  "Forecast Category", "Not Expected Reason", "Roster Stage", "Comment", "Updated By", "Updated At", "Status"];

/**
 * The Overrides tab is the store behind the CSM tab's yellow cells (one row per line the CSM changed). CSMs do not need to open it.
 * Existing rows are never discarded: an older 10-column layout just gets the three new columns.
 */
function FY27_ensureOverridesSheet_() {
  const ss = SpreadsheetApp.getActive();
  const name = FY27_CFG.SHEETS.OVERRIDES;
  const header = FY27_OVERRIDE_HEADER;
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const cur = sh.getRange(1, 1, 1, header.length).getValues()[0];
  const matches = function (n) { return header.slice(0, n).every(function (h, i) { return cur[i] === h; }); };
  if (!matches(header.length)) {
    if (matches(10)) {
      sh.getRange(1, 11, 1, 3).setValues([header.slice(10)]);                     // 10-column layout: just add the new columns
    } else {
      // oldest layout had an "Exclude" checkbox in column G and Comment in H: carry rows over (Exclude -> Not Expected)
      let carried = [];
      if (sh.getLastRow() > 1 && cur[6] === "Exclude") {
        carried = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().filter(function (r) { return r[0] !== ""; }).map(function (r) {
          return [r[0], r[1], r[2], r[3], r[4], r[5], (r[6] === true || String(r[6]).toLowerCase() === "true") ? "Not Expected" : "", "", "", r[7], "", "", ""];
        });
      }
      sh.clear();
      sh.getRange(1, 1, 1, header.length).setValues([header]);
      if (carried.length) sh.getRange(2, 1, carried.length, header.length).setValues(carried);
    }
  }
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#E7EDF6");
  sh.setFrozenRows(1);
  const dd = function (col, list) {
    sh.getRange(2, col, 500, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
  };
  dd(7, FY27_CFG.CATEGORIES); dd(8, FY27_CFG.NOT_EXPECTED_REASONS); dd(9, FY27_CFG.ROSTER_STAGES);
  return sh;
}

/** After a build: tell each stored override whether it was applied or could not be matched to a line any more. */
function FY27_writeOverrideStatus_(sh, status) {
  const last = sh.getLastRow();
  if (last < 2) return;
  const keys = sh.getRange(2, 1, last - 1, 1).getValues();
  const out = keys.map(function (r) {
    const k = FY27_str_(r[0]);
    if (!k) return [""];
    const st = status[k];
    return [st === "Applied" ? "Applied" : st === "Not found" ? "NOT FOUND - the line changed in a refresh; re-enter it on the CSM tab" : "(no change set)"];
  });
  sh.getRange(2, 13, out.length, 1).setValues(out);
}

/* ---------------- Manual Add-Ons tab ---------------- */

const FY27_MANUAL_HEADER = ["Full ID", "Student Org ID", "Account Name", "Product Group", "Product Name", "Forecast Month", "Amount",
  "Forecast Category", "Not Expected Reason", "Roster Stage", "Booking Type", "CSM", "Comment", "Status"];

/**
 * Lines the data does not know about: a new sale, a one-off, a placeholder. Fill Full ID (or Student Org ID), Product Group, Forecast Month and Amount;
 * the Status column says whether the line was added. Rows are never cleared by a refresh.
 */
function FY27_ensureManualSheet_() {
  const ss = SpreadsheetApp.getActive();
  const header = FY27_MANUAL_HEADER;
  let sh = ss.getSheetByName(FY27_CFG.SHEETS.MANUAL);
  if (!sh) sh = ss.insertSheet(FY27_CFG.SHEETS.MANUAL);
  const cur = sh.getRange(1, 1, 1, header.length).getValues()[0];
  if (!header.every(function (h, i) { return cur[i] === h; })) sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#FFF2CC");
  sh.setFrozenRows(1);
  const dd = function (col, list) {
    sh.getRange(2, col, 500, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
  };
  dd(4, FY27_CFG.PRODUCT_GROUPS); dd(8, FY27_CFG.CATEGORIES); dd(9, FY27_CFG.NOT_EXPECTED_REASONS); dd(10, FY27_CFG.ROSTER_STAGES); dd(11, FY27_CFG.BOOKING_TYPES);
  sh.getRange(2, 6, 500, 1).setNumberFormat("mmm-yy");
  sh.getRange(2, 7, 500, 1).setNumberFormat("$#,##0");
  sh.getRange(1, 1).setNote("Full ID or Student Org ID: copy it from the CSM Forecast tab. Forecast Month must be in " + FY27_CFG.FORECAST_YEAR + ". Leave Forecast Category blank for Expected.");
  sh.getRange(1, 14).setNote("Filled in by the refresh: Added, or NOT ADDED with the reason.");
  return sh;
}

function FY27_writeManualStatus_(sh, results) {
  (results || []).forEach(function (r) { if (r.row) sh.getRange(r.row, 14).setValue(r.status); });
}

/* ---------------- Account Merges tab ---------------- */

const FY27_MERGE_HEADER = ["From ID", "Into ID", "Comment", "Status"];

/**
 * "Count this ID as that account": one row per duplicate. From ID / Into ID can each be a Full ID or a Student Org (Billing) ID.
 * Applied at the start of every refresh, to every input tab, so the two IDs become one account everywhere (baseline, OTC, overrides, manual lines).
 */
function FY27_ensureMergeSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(FY27_CFG.SHEETS.MERGES);
  if (!sh) sh = ss.insertSheet(FY27_CFG.SHEETS.MERGES);
  const cur = sh.getRange(1, 1, 1, FY27_MERGE_HEADER.length).getValues()[0];
  if (!FY27_MERGE_HEADER.every(function (h, i) { return cur[i] === h; })) sh.getRange(1, 1, 1, FY27_MERGE_HEADER.length).setValues([FY27_MERGE_HEADER]);
  sh.getRange(1, 1, 1, FY27_MERGE_HEADER.length).setFontWeight("bold").setBackground("#FFF2CC");
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 190); sh.setColumnWidth(2, 190); sh.setColumnWidth(3, 300); sh.setColumnWidth(4, 360);
  sh.getRange(1, 1).setNote("The duplicate ID (the extra Billing ID / Full ID). Copy it from the Tableau or CSM Forecast tab.");
  sh.getRange(1, 2).setNote("The account it should be counted as (the main one). Its name, CSM and rating are used for every row of the From ID.");
  return sh;
}

function FY27_writeMergeStatus_(sh, results) {
  (results || []).forEach(function (r) { if (r.row) sh.getRange(r.row, 4).setValue(r.status); });
}

/* ---------------- Read Me tab ---------------- */

function FY27_ensureReadMe_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(FY27_CFG.SHEETS.README);
  const fresh = !sh;
  if (!sh) sh = ss.insertSheet(FY27_CFG.SHEETS.README);
  sh.clear();
  const lines = FY27_readmeLines_(FY27_CFG);
  sh.getRange(1, 1, lines.length, 1).setValues(lines);
  sh.setColumnWidth(1, 900);
  sh.getRange(1, 1, lines.length, 1).setWrap(true);
  lines.forEach(function (l, i) {
    if (l[0] && l[0] === l[0].toUpperCase() && /[A-Z]/.test(l[0])) sh.getRange(i + 1, 1).setFontWeight("bold").setBackground("#E7EDF6");
  });
  sh.getRange(1, 1).setFontSize(14);
  if (fresh) { ss.setActiveSheet(sh); ss.moveActiveSheet(1); }
  return sh;
}

/* ---------------- CSM Forecast tab ---------------- */

/** The tab CSMs work in: filter to your accounts, change the yellow cells. Everything else is calculated and protected with a warning. */
function FY27_writeCsmSheet_(ss, lines, overrideRows, status) {
  const cfg = FY27_CFG;
  const sh = ss.getSheetByName(cfg.SHEETS.CSM) || ss.insertSheet(cfg.SHEETS.CSM);
  const existingFilter = sh.getFilter();
  if (existingFilter) existingFilter.remove();
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (String(p.getDescription()).indexOf("FY27") === 0) p.remove(); });
  sh.clear(); sh.clearFormats(); FY27_resetFormats_(sh);
  const headers = FY27_csmHeaders_();
  const rows = FY27_csmRows_(lines, overrideRows, status);
  const nCalc = FY27_CSM_COLUMNS.length, nIn = FY27_CSM_INPUTS.length;
  const colOf = function (h) { return headers.indexOf(h) + 1; };
  const out = [headers];
  rows.forEach(function (r) {
    const x = r.slice();
    [colOf("Baseline Month"), colOf("Forecast Month"), colOf("SET: Month")].forEach(function (c) { x[c - 1] = x[c - 1] ? FY27_monthToDate_(FY27_monthKey_(x[c - 1])) : ""; });
    out.push(x);
  });
  sh.getRange(1, 1, out.length, headers.length).setValues(out);
  sh.setFrozenRows(1); sh.setFrozenColumns(2);
  // header styling: calculated = blue-grey, inputs = yellow
  sh.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#E7EDF6").setWrap(true);
  sh.getRange(1, nCalc + 1, 1, nIn).setBackground("#FFD966");
  const n = Math.max(rows.length, 1);
  sh.getRange(2, nCalc + 1, n, nIn).setBackground("#FFF2CC");                       // the cells a CSM edits
  sh.getRange(2, colOf("Baseline Month"), n, 1).setNumberFormat("mmm-yy");
  sh.getRange(2, colOf("Forecast Month"), n, 1).setNumberFormat("mmm-yy");
  sh.getRange(2, colOf("SET: Month"), n, 1).setNumberFormat("mmm-yy");
  [colOf("Baseline $"), colOf("Forecast $ (full value)"), colOf("Weighted $"), colOf("SET: Amount")].forEach(function (c) { sh.getRange(2, c, n, 1).setNumberFormat("$#,##0"); });
  const widths = { "CSM": 130, "Account Name": 260, "Full ID": 150, "Student Org ID": 150, "Rating": 60, "Baseline Month": 80, "Timing vs Baseline": 90, "Product Group": 130, "Product Name": 200, "Forecast Month": 80,
    "Baseline $": 90, "Forecast $ (full value)": 100, "Weighted $": 90, "Forecast Category": 120, "Not Expected Reason": 140, "Roster Stage": 110, "Timing vs Baseline": 80,
    "Source": 100, "Why (flags)": 320, "Booking Type": 110, "Cohort Names": 220, "Cohort Codes": 140, "Est. Students": 80, "Price Per Student": 90, "Prior-Year Cohorts": 200, "Contract End": 90, "Weight": 60, "Weight Basis": 200, "SET: Category": 120, "SET: Reason": 140, "SET: Stage": 110, "SET: Amount": 90, "SET: Month": 80, "Comment": 240, "Saved?": 130, "Line Key": 60 };
  headers.forEach(function (h, i) { sh.setColumnWidth(i + 1, widths[h] || 100); });
  // dropdowns on the inputs
  const dd = function (h, list) {
    sh.getRange(2, colOf(h), n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
  };
  dd("SET: Category", cfg.CATEGORIES); dd("SET: Reason", cfg.NOT_EXPECTED_REASONS); dd("SET: Stage", cfg.ROSTER_STAGES);
  // colour the category so risk is visible at a glance
  const catRange = sh.getRange(2, colOf("Forecast Category"), n, 1);
  const rule = function (text, bg) { return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bg).setRanges([catRange]).build(); };
  sh.setConditionalFormatRules([rule("Captured", "#D9EAD3"), rule("At Risk", "#FFE599"), rule("Pending Contract", "#CFE2F3"), rule("Not Expected", "#E0E0E0")]);
  // filter on the header row so a CSM can pick their own name
  sh.getRange(1, 1, out.length, headers.length).createFilter();
  // calculated columns: warn before editing
  const warn = function (rng, desc) { const p = rng.protect(); p.setDescription(desc); p.setWarningOnly(true); };
  warn(sh.getRange(2, 1, n, nCalc), "FY27 calculated columns");
  warn(sh.getRange(2, nCalc + nIn + 1, n, headers.length - nCalc - nIn), "FY27 system columns");
  sh.getRange(2, colOf("Weight"), n, 1).setNumberFormat("0%");
  sh.getRange(2, colOf("Price Per Student"), n, 1).setNumberFormat("$#,##0");
  sh.getRange(1, colOf("Booking Type")).setNote("What kind of line this is: Renewal (baseline-backed), Rebooking (cohort code present), Roster Chasing (extra predicted cohort), New sale...");
  sh.hideColumns(colOf("Line Key"));
  sh.getRange(2, colOf("Why (flags)"), n, 1).setWrap(true);
  sh.getRange(1, colOf("Baseline Month")).setNote("The month of the booking this line is based on (last year's booking, from Tableau). Blank = no baseline (a new or extra cohort).");
  sh.getRange(1, colOf("Weighted $")).setNote("Forecast $ x how likely this kind of line is to book. Add this column up for any total.");
  sh.getRange(1, colOf("Full ID")).setNote("Copy this into the Manual Add-Ons or Account Merges tab.");
  sh.getRange(1, colOf("SET: Category")).setNote("Change what the forecast says about this line. Saved as soon as you type; applied at the next refresh.");
  sh.getRange(1, colOf("SET: Amount")).setNote("Only if the amount is wrong. This replaces the full-value amount.");
  sh.getRange(1, colOf("SET: Month")).setNote("Only if it will book in a different month than shown.");
  return sh;
}

/**
 * Runs when anyone edits the sheet (a simple trigger). When a CSM changes a yellow cell on the CSM tab, the change is written to the Overrides tab
 * straight away, so it survives refreshes and rebuilds.
 */
function onEdit(e) {
  try { FY27_onEdit_(e); }
  catch (err) { SpreadsheetApp.getActive().toast("Could not save that change: " + err.message, "FY27 Forecast", 8); }
}

function FY27_onEdit_(e) {
  const cfg = FY27_CFG;
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== cfg.SHEETS.CSM) return;
  const lastCol = sh.getLastColumn();
  const hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const inCols = FY27_CSM_INPUTS.map(function (h) { return hdr.indexOf(h) + 1; });
  const c1 = e.range.getColumn(), c2 = e.range.getLastColumn();
  if (!inCols.some(function (c) { return c >= c1 && c <= c2; })) return;       // not an input cell
  const r1 = Math.max(2, e.range.getRow()), r2 = e.range.getLastRow();
  if (r2 < r1) return;
  const rowsVals = sh.getRange(r1, 1, r2 - r1 + 1, lastCol).getValues();
  const ov = FY27_ensureOverridesSheet_();
  const oh = FY27_OVERRIDE_HEADER;
  const lastOv = ov.getLastRow();
  let store = lastOv > 1 ? ov.getRange(2, 1, lastOv - 1, oh.length).getValues() : [];
  let who = ""; try { who = Session.getActiveUser().getEmail(); } catch (x) { who = ""; }
  const now = new Date();
  const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "MMM d h:mm a");
  const savedCol = hdr.indexOf("Saved?") + 1;
  rowsVals.forEach(function (row, i) {
    const rec = FY27_overrideRecFromCsmRow_(hdr, row);
    if (!rec["Line Key"]) return;
    rec["Updated By"] = who; rec["Updated At"] = now; rec["Status"] = "Saved - applies at the next refresh";
    const res = FY27_upsertOverride_(oh, store, rec);
    store = res.values;
    sh.getRange(r1 + i, savedCol).setValue(res.action === "removed" ? "Cleared " + stamp : "Saved " + stamp + " (applies at next refresh)");
  });
  if (lastOv > 1) ov.getRange(2, 1, lastOv - 1, oh.length).clearContent();
  if (store.length) ov.getRange(2, 1, store.length, oh.length).setValues(store);
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
  sum.clear(); sum.clearFormats(); FY27_resetFormats_(sum); det.clear(); det.clearFormats(); FY27_resetFormats_(det);
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
  allSh.clear(); allSh.clearFormats(); FY27_resetFormats_(allSh);
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
