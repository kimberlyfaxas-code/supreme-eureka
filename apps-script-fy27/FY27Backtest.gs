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
  const res = FY27_buildForecast({
    tableau: tableau, otc: input.otc, salesforce: input.salesforce || [], overrides: [], now: new Date(year, 0, 1)
  }, bcfg);

  // ---- engine side: per baseline line (org | group | 2026 month of the baseline) ----
  const eng = {};
  res.detail.forEach(function (d) {
    if (!d.baselineMonth) return;
    const k = [FY27_id15_(d.studentOrgId), d.productGroup, FY27_addMonths_(d.baselineMonth, 12)].join("|");
    const e = eng[k] || (eng[k] = { account: d.accountName, baseline: 0, forecast: 0, flags: [], expectations: {} });
    e.baseline += d.baselineAmount; e.forecast += d.forecastAmount;
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
    t.catRaw = t.catRaw || FY27_str_(r["Forecast Category"]);
  });

  // ---- compare ----
  const keys = {};
  Object.keys(eng).forEach(function (k) { keys[k] = true; });
  Object.keys(fin).forEach(function (k) { keys[k] = true; });
  const cross = {};            // "engineBand|teamBand" -> {n, base}
  const reasons = {};          // reason -> {n, base, teamFull, teamZero}
  const detail = [];
  const monthly = {};
  Object.keys(keys).forEach(function (k) {
    const e = eng[k], t = fin[k];
    if (!e || !t) return;                                  // need both sides for a like-for-like comparison
    const base = Math.max(e.baseline, t.baseline);
    const eb = FY27_band_(e.forecast, e.baseline), tb = FY27_band_(t.forecast, t.baseline);
    if (eb === "n/a" || tb === "n/a") return;
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
    const m = monthly[mo] || (monthly[mo] = { baseline: 0, engine: 0, team: 0 });
    m.baseline += base; m.engine += e.forecast; m.team += t.forecast;
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
  return { cross: cross, reasons: reasons, detail: detail, monthly: monthly, compared: Object.keys(keys).filter(function (k) { return eng[k] && fin[k]; }).length,
           engineOnly: Object.keys(eng).filter(function (k) { return !fin[k]; }).length, teamOnly: Object.keys(fin).filter(function (k) { return !eng[k]; }).length,
           engineStats: res.stats };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FY27_backtest_: FY27_backtest_, FY27_rollup_: FY27_rollup_ };
}
