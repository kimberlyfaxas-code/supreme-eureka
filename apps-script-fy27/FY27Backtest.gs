/*******************************************************
 * FY27Backtest.gs
 * Run the FY27 engine as if it were a year earlier (2025 baseline -> 2026 forecast) and compare its
 * decisions with what the team actually ended up forecasting / booking in 2026.
 *
 *   Inputs (tabs in this workbook):
 *     "2026 Beginning Forecast Reference"  the starting point of the 2026 forecast (2025 baseline)
 *     "2026 Forecast Reference"            the final 2026 working forecast (categories, comments)
 *     otc_* and Salesforce Data* tabs      same as the FY27 build
 *   Output: "Backtest Summary" and "Backtest Detail".
 *
 *   Caveat: the OTC export is from Nov 2026, so cohort dates/amounts already reflect 2026. Read this as a check on the
 *   LOGIC (what gets zeroed and why), not as a forecast-accuracy score.
 *
 * The comparison key is Student Org ID + Product Group + the 2026 month of the baseline line, because the
 * 2026 file puts the 2025 baseline amount on the 2026 month it was expected to repeat in.
 *******************************************************/

/** Same roll-up the 2026 dashboards use (ForecastDashboardData.gs). */
function FY27_rollup_(cat) {
  const c = FY27_str_(cat).toLowerCase();
  if (!c) return "Expected";
  if (c.indexOf("adjustment (booked)") >= 0) return "Captured";
  if (c.indexOf("captured") >= 0) return "Captured";
  if (c.indexOf("not expected") >= 0) return "Not Expected";
  if (c.indexOf("expected") >= 0) return "Expected";
  if (c.indexOf("pending") >= 0) return "Expected";
  if (c.indexOf("risk") >= 0) return "At Risk";
  if (c.indexOf("data error") >= 0 || c.indexOf("non-recurring") >= 0 || c.indexOf("lost") >= 0) return "Not Expected";
  if (c.indexOf("adjustment") >= 0) return "Not Expected";
  return "Expected";
}

function FY27_band_(forecast, baseline) {
  if (!(baseline > 0)) return "n/a";
  const r = forecast / baseline;
  if (r <= 0.05) return "Zero";
  if (r >= 0.9) return "Full";
  return "Partial";
}

/** Why did the engine zero / reduce this baseline line? First matching flag family. */
function FY27_reasonOf_(flags) {
  const f = (flags || []).join(" | ").toLowerCase();
  if (f.indexOf("adjustment (derived)") >= 0) return "Adjustment (derived from OTC)";
  if (f.indexOf("adjustment (likely)") >= 0) return "Adjustment (likely, small line)";
  if (f.indexOf("negative adjustment") >= 0) return "Negative adjustment";
  if (f.indexOf("positive adjustment") >= 0) return "Positive adjustment (Tableau flag)";
  if (f.indexOf("black rating") >= 0) return "Black rating";
  if (f.indexOf("gray rating") >= 0) return "Gray rating";
  if (f.indexOf("booking for this program") >= 0) return "Dormant program";
  return "";
}

/**
 * @param {Object} input { beginning:[row], final:[row], salesforce:[row], otc:[row] }  (rows keyed by trimmed header)
 * @param {Object} cfg   FY27_CFG
 */
function FY27_backtest_(input, cfg) {
  const year = cfg.FORECAST_YEAR - 1;                       // the year being "forecast" in the backtest (2026)
  const bcfg = Object.assign({}, cfg, {
    FORECAST_YEAR: year, ACTUALS_THROUGH: year + "-01", INCLUDE_NOT_IN_TABLEAU: false, TAG_CREDIT: false
  });
  // Beginning forecast has Student Org ID only; OTC is keyed by Full ID, so map through Salesforce.
  const orgToFull = {};
  (input.salesforce || []).forEach(function (r) {
    const o = FY27_id15_(r["Student Org Id"]), f = FY27_str_(r["FULL ID"]);
    if (o && f && !orgToFull[o]) orgToFull[o] = f;
  });
  const tableau = [];
  input.beginning.forEach(function (r) {
    const type = FY27_str_(r["Forecast Line Type"]).toLowerCase();
    const src = FY27_str_(r["Forecast Source"]).toLowerCase();
    if (type.indexOf("adjust") >= 0 || src.indexOf("manual") >= 0) return;
    // the 2026 file puts the 2025 baseline on the 2026 month it should repeat in
    const fcm = FY27_monthKey_(FY27_pick_(r, ["Starting Forecast Month", "Baseline Month", "2025 Baseline Month"]));
    if (!fcm || FY27_yearOf_(fcm) !== year) return;
    const org = FY27_str_(r["Student Org ID"]);
    tableau.push({
      "Account Name with Billing ID": FY27_str_(r["Account Name"]) + " (" + org + ")", "Billing ID": org,
      "FULL ID": orgToFull[FY27_id15_(org)] || org, "Account Name": r["Account Name"], "Rating": r["Health Rating"],
      "Billing State/Province": r["Billing State/Province"], "Billing Country": r["Billing Country"],
      "Product Group": r["Product Group"], "Product Name": "",
      "Baseline Booking Month - Tableau": FY27_addMonths_(fcm, -12), "Forecast Month - Tableau": fcm,
      "Baseline Amount - Tableau": r["Baseline Amount"], "Adjustment (true/false)": "", __row: r.__row
    });
  });
  // 2024 actuals (optional): what each account + product group booked, and in which months, the year before the baseline
  const hist = {};
  (input.actuals || []).forEach(function (r) {
    const m = FY27_str_(r["Account Name with Student Org"]).match(/\(([A-Za-z0-9]{10,18})\)\s*$/);
    const mk = FY27_monthKey_(r["Booking Month"]);
    if (!m || !mk) return;
    const k = FY27_id15_(m[1]) + "|" + FY27_str_(r["Product Group"]);
    const h = hist[k] || (hist[k] = { total: 0, months: {} });
    const v = FY27_num_(r["Metric value Sales"]);
    h.total += v; h.months[mk.slice(5, 7)] = (h.months[mk.slice(5, 7)] || 0) + v;
  });
  // As-of view: remove what only became known during the backtest year
  let otcRows = input.otc;
  if (cfg.BT_AS_OF) {
    const codeOf = function (r) { return FY27_str_(FY27_pick_(r, ["Cohort Code (if present, then this is a rebooking)", "Cohort Code", "cohort_code"])); };
    const bookedStatuses = cfg.OTC_BOOKED_STATUSES || [];
    const doneBefore = {};
    input.otc.forEach(function (r) {
      const act = FY27_monthKey_(r["order_actual_start_date"]);
      if (act && FY27_yearOf_(act) < year && bookedStatuses.indexOf(FY27_str_(r["order_status"]).toLowerCase()) >= 0 && codeOf(r)) {
        doneBefore[FY27_id15_(FY27_pick_(r, ["Full ID", "account_business_org_id"])) + "|" + codeOf(r)] = true;
      }
    });
    otcRows = input.otc.map(function (r) {
      const act = FY27_monthKey_(r["order_actual_start_date"]);
      if (!act || FY27_yearOf_(act) < year) return r;
      const o = Object.assign({}, r);
      o["order_status"] = "Roster"; o["order_actual_start_date"] = ""; o["order_enrollment_final"] = "";
      const est = FY27_num_(o["Estimated # of Students"]), price = FY27_num_(FY27_pick_(o, ["Price Per Student", "order_price"]));
      if (est > 0 && price > 0) { o["Estimated or Actual Order Total"] = String(est * price); o["order_total"] = String(est * price); }
      if (!doneBefore[FY27_id15_(FY27_pick_(o, ["Full ID", "account_business_org_id"])) + "|" + codeOf(r)]) {
        o["Cohort Code (if present, then this is a rebooking)"] = ""; o["Cohort Code"] = ""; o["cohort_code"] = "";
      }
      return o;
    });
  }
  const res = FY27_buildForecast({
    tableau: tableau, otc: otcRows, salesforce: input.salesforce || [], overrides: [], now: new Date(year, 0, 1)
  }, bcfg);

  // ---- engine side: per baseline line (org | group | 2026 month of the baseline) ----
  const eng = {};
  res.detail.forEach(function (d) {
    if (!d.baselineMonth) return;
    const k = [FY27_id15_(d.studentOrgId), d.productGroup, FY27_addMonths_(d.baselineMonth, 12)].join("|");
    const e = eng[k] || (eng[k] = { account: d.accountName, baseline: 0, forecast: 0, flags: [], expectations: {}, rating: d.rating, cohort: false, bos: false,
      hasCode: false, cohortTotal: 0, contractEnd: "", lines: 0, products: {} });
    e.lines++;
    if (d.cohortCodes) e.hasCode = true;
    if (d.cohortNames || d.cohortCodes) e.cohortTotal += d.forecastAmount;
    e.otcEst = (e.otcEst || 0) + (Number(d.otcEstimate) || 0);
    if (d.segment) e.segment = d.segment;
    if (d.contractEnd && d.contractEnd > e.contractEnd) e.contractEnd = d.contractEnd;
    e.baseline += d.baselineAmount; e.forecast += d.forecastAmount; e.weighted = (e.weighted || 0) + d.weightedAmount;
    if (d.cohortNames || d.cohortCodes) e.cohort = true;
    if (/^A\d+$/.test(FY27_str_(d.studentOrgId))) e.bos = true;
    d.flags.forEach(function (f) { if (e.flags.indexOf(f) < 0) e.flags.push(f); });
    e.expectations[d.expectation] = true;
  });

  // ---- team side: final 2026 forecast per baseline line ----
  const fin = {};
  input.final.forEach(function (r) {
    const type = FY27_str_(r["Forecast Line Type"]).toLowerCase();
    if (type.indexOf("adjust") >= 0) return;
    const org = FY27_id15_(r["Student Org ID"]);
    const bm = FY27_monthKey_(r["Baseline Month"]);
    const base = FY27_num_(r["Baseline Amount"]);
    if (!org || !bm || FY27_yearOf_(bm) !== year || !(base > 0)) return;     // only lines that carried a baseline
    const k = [org, FY27_str_(r["Product Group"]), bm].join("|");
    const t = fin[k] || (fin[k] = { account: FY27_str_(r["Account Name"]), baseline: 0, forecast: 0, cats: {}, comment: "", outreach: "", rows: 0 });
    const fa = FY27_num_(r["Forecast Amount"]);
    t.baseline += base; t.forecast += fa; t.rows++;
    const roll = FY27_rollup_(r["Forecast Category"]);
    t.cats[roll] = (t.cats[roll] || 0) + Math.max(Math.abs(fa), 0.01);
    if (!t.comment && FY27_str_(r["Latest Comment"])) t.comment = FY27_str_(r["Latest Comment"]);
    if (!t.outreach) t.outreach = FY27_str_(r["Outreach Status"]);
    if (!t.csm) t.csm = FY27_str_(r["Current CSM"]);
    if (!t.product) t.product = FY27_str_(r["Product"]);
    t.catRaw = t.catRaw || FY27_str_(r["Forecast Category"]);
  });

  // ---- compare ----
  const keys = {};
  Object.keys(eng).forEach(function (k) { keys[k] = true; });
  Object.keys(fin).forEach(function (k) { keys[k] = true; });
  const cross = {};            // "engineBand|teamBand" -> {n, base}
  const signals = {};          // signal -> {n, base, zero, zeroBase, partial, full}
  const yearAcc = {};          // org|group -> {baseline, engine, team}
  function signalsOf(e) {
    const s = [];
    const f = e.flags.join(" | ").toLowerCase();
    s.push("Rating: " + (e.rating || "(blank)"));
    s.push(e.cohort ? "OTC cohort matched" : "Baseline only (no OTC cohort)");
    if (e.bos) s.push("BOS billing (not in OTC)");
    if (e.expectations["Pending Contract"] || e.expectations["Renewal Pending"]) s.push("Contract pending");
    if (f.indexOf("no upcoming cohort") >= 0) s.push("Contract covers year, no upcoming cohort");
    if (f.indexOf("far from baseline") >= 0) s.push("OTC estimate far from baseline");
    if (f.indexOf("adjustment: baseline") >= 0) s.push("Baseline above/below OTC estimate");
    if (f.indexOf("trend-adjusted") >= 0) s.push("Cohort size trend-adjusted");
    return s;
  }
  const reasons = {};          // reason -> {n, base, teamFull, teamZero}
  const detail = [];
  const all = [];
  const monthly = {};
  Object.keys(keys).forEach(function (k) {
    const e = eng[k], t = fin[k];
    if (!e || !t) return;                                  // need both sides for a like-for-like comparison
    const base = Math.max(e.baseline, t.baseline);
    const eb = FY27_band_(e.forecast, e.baseline), tb = FY27_band_(t.forecast, t.baseline);
    if (eb === "n/a" || tb === "n/a") return;
    const ya = yearAcc[k.split("|")[0] + "|" + k.split("|")[1]] || (yearAcc[k.split("|")[0] + "|" + k.split("|")[1]] = { baseline: 0, engine: 0, team: 0 });
    ya.baseline += base; ya.engine += e.forecast; ya.team += t.forecast;
    signalsOf(e).forEach(function (sg) {
      const x = signals[sg] || (signals[sg] = { n: 0, base: 0, zero: 0, zeroBase: 0, partial: 0, full: 0 });
      x.n++; x.base += base;
      if (tb === "Zero") { x.zero++; x.zeroBase += base; } else if (tb === "Partial") x.partial++; else x.full++;
    });
    const ck = eb + "|" + tb;
    const c = cross[ck] || (cross[ck] = { n: 0, base: 0 });
    c.n++; c.base += base;
    const reason = FY27_reasonOf_(e.flags);
    if (reason) {
      const rr = reasons[reason] || (reasons[reason] = { n: 0, base: 0, teamFull: 0, teamFullBase: 0, teamZero: 0, teamZeroBase: 0 });
      rr.n++; rr.base += base;
      if (tb === "Full") { rr.teamFull++; rr.teamFullBase += base; }
      if (tb === "Zero") { rr.teamZero++; rr.teamZeroBase += base; }
    }
    const mo = k.split("|")[2];
    const hh = hist[k.split("|")[0] + "|" + k.split("|")[1]];
    all.push({
      account: e.account || t.account, org: k.split("|")[0], group: k.split("|")[1], month: mo, baseline: base,
      engine: e.forecast, team: t.forecast, engineBand: eb, teamBand: tb, teamCategory: t.catRaw || "", outreach: t.outreach,
      rating: e.rating, csm: t.csm || "", teamProduct: t.product || "",
      source: e.cohort ? (e.hasCode ? "OTC rebooking cohort" : "OTC roster cohort") : (e.bos ? "BOS baseline" : "Baseline only"),
      cohortTotal: e.cohortTotal, otcEst: e.otcEst || 0, segment: e.segment || "", engineWeighted: e.weighted || 0,
      ratio: e.baseline ? e.forecast / e.baseline : "", contractEnd: e.contractEnd,
      monthsToEnd: e.contractEnd ? FY27_monthDiff_(e.contractEnd, mo) : "",
      booked2024SameMonth: hh ? (hh.months[mo.slice(5, 7)] ? "Y" : "N") : "(no 2024 data)",
      total2024: hh ? hh.total : "", flags: e.flags.join(" | ")
    });
    const m = monthly[mo] || (monthly[mo] = { baseline: 0, engine: 0, engineWeighted: 0, team: 0 });
    m.baseline += base; m.engine += e.forecast; m.engineWeighted += e.weighted || 0; m.team += t.forecast;
    if (eb !== tb) {
      const cats = Object.keys(t.cats).sort(function (a, b) { return t.cats[b] - t.cats[a]; });
      detail.push({
        key: k, account: e.account || t.account, group: k.split("|")[1], month: mo, baseline: base,
        engine: e.forecast, team: t.forecast, engineBand: eb, teamBand: tb, engineReason: reason || "(no flag)",
        engineFlags: e.flags.join(" | "), teamCategory: t.catRaw || cats[0] || "", teamRollup: cats[0] || "",
        teamComment: t.comment, outreach: t.outreach
      });
    }
  });
  detail.sort(function (a, b) { return b.baseline - a.baseline; });
  const yearCross = {};
  Object.keys(yearAcc).forEach(function (k) {
    const y = yearAcc[k];
    const eb = FY27_band_(y.engine, y.baseline), tb = FY27_band_(y.team, y.baseline);
    if (eb === "n/a") return;
    const c = yearCross[eb + "|" + tb] || (yearCross[eb + "|" + tb] = { n: 0, base: 0, engine: 0, team: 0 });
    c.n++; c.base += y.baseline; c.engine += y.engine; c.team += y.team;
  });
  return { all: all, cross: cross, yearCross: yearCross, signals: signals, reasons: reasons, detail: detail, monthly: monthly, compared: Object.keys(keys).filter(function (k) { return eng[k] && fin[k]; }).length,
           engineOnly: Object.keys(eng).filter(function (k) { return !fin[k]; }).length, teamOnly: Object.keys(fin).filter(function (k) { return !eng[k]; }).length,
           engineStats: res.stats };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FY27_backtest_: FY27_backtest_, FY27_rollup_: FY27_rollup_ };
}
