/* FY27 forecast build: ALL-IN-ONE FILE (generated from FY27Config.gs + FY27Engine.gs + FY27Build.gs + FY27Backtest.gs).
 * Install: delete every other file in the Apps Script project, then paste this into ONE file. Do not keep the individual files.
 */

/* ======================= FY27Config.gs ======================= */
/*******************************************************
 * FY27Config.gs
 * All tunable settings for the FY2027 forecast build live here.
 * Nothing in the engine hardcodes a year, sheet name or threshold.
 *******************************************************/
const FY27_CFG = {
  FORECAST_YEAR: 2027,

  // Input tabs. OTC / Salesforce tabs get re-pasted with new names every refresh,
  // so they are found by prefix (first match in tab order wins; exact name tried first).
  SHEETS: {
    TABLEAU: "Tableau Bookings Data",
    OTC: "otc_rerun_nov_10_2026",
    OTC_PREFIX: "otc_",
    SALESFORCE: "Salesforce Data - KF-2026-11-09-10-27-24",
    SALESFORCE_PREFIX: "Salesforce Data",
    // Outputs
    FORECAST: "Forecast",            // grouped: account x product group x month x credit type
    DETAIL: "Forecast Detail",       // ungrouped (one row per OTC cohort / baseline line) for tracing
    ADJUSTMENTS: "Adjustments",     // negative adjustments (baseline only, never forecast); optional
    REVIEW: "Forecast Review",
    BT_BEGINNING: "2026 Beginning Forecast Reference",
    BT_FINAL: "2026 Forecast Reference",
    BT_ACTUALS_2024: "2024 Actuals",
    BT_ALL: "Backtest All Lines",
    BT_SUMMARY: "Backtest Summary",
    BT_DETAIL: "Backtest Detail",
    OVERRIDES: "Forecast Overrides"
  },

  // Months strictly before this month are treated as "actuals complete".
  // "auto" = first day of the current month (so every refresh rolls forward).
  // Or pin it, e.g. "2026-11".
  ACTUALS_THROUGH: "auto",

  // OTC cohort rows are matched to a Tableau baseline row if their start month is
  // within this many months of the baseline's forecast month (same account + product family).
  MATCH_TOLERANCE_MONTHS: 3,

  // Cohort-size trend: scale OTC "Estimated # of Students" by the account's historical
  // (final enrollment / estimate) ratio when it differs from 1 by at least TREND_MIN_DELTA.
  USE_TREND: true,
  TREND_MIN_ORDERS: 2,
  TREND_MIN_DELTA: 0.10,
  TREND_CLAMP: [0.5, 1.5],

  // An OTC cohort for a program (account + product group + RN/PN/Step family) that had no booking
  // in the baseline year is shown as Not Expected (value kept in "Value If Booked"). Accounts that are
  // not in Tableau at all are exempt: those are flagged for review instead.
  EXCLUDE_UNBOOKED_PROGRAMS: true,
  // What happens to a FIRST-TIME OTC cohort (no cohort code) in a program that had no booking at that account in the baseline year:
  //  "weight" = flag it, set it At Risk and weight it by DORMANT_PROGRAM_WEIGHT (a CSM decides)
  //  "zero"   = Not Expected, $0 (value kept in Value If Booked)
  // Cohorts that already have a code are existing classes and are never treated as dormant.
  DORMANT_PROGRAM_ACTION: "weight",
  DORMANT_PROGRAM_WEIGHT: 0.25,   // placeholder, not yet calibrated: the backtest compares baseline lines, not OTC-only cohorts

  // Accounts with no Tableau rows (no baseline-year bookings) are left out of the forecast.
  // Set true to bring their OTC cohorts in, flagged "Not in Tableau".
  INCLUDE_NOT_IN_TABLEAU: false,

  // New vs Renewal sales credit. Off for now: Credit Type / Credit Basis are left out of the output
  // and do not split rows. Turn on later to tag them (see README for the rules).
  TAG_CREDIT: false,

  // Allowed values for the Forecast Source column.
  //  Tableau    = line is tied to a Tableau baseline row (amount may be refined by OTC cohort data)
  //  OTC        = OTC cohort with NO Tableau baseline line (account is in Tableau, this cohort is not)
  //  Manual Add On = reserved for the manual add-on feature (not built yet)
  SOURCES: { TABLEAU: "Tableau", OTC: "OTC", MANUAL: "Manual Add On" },

  // Adjustments (extra / dropped students) are small. A line larger than this (positive or negative) is
  // treated as a real booking that is already part of the baseline total, so it is never DERIVED as a
  // positive adjustment. Large negative lines are still not forecast (a negative cannot recur) but are
  // flagged for review.
  ADJUSTMENT_MAX_ABS: 0,   // 0 = off (any negative is an adjustment; positives are found by OTC reconciliation or the small-line test)

  // Likely-adjustment test for POSITIVE Tableau lines that OTC could not reconcile: a line is flagged when it is
  // smaller than LIKELY_ADJ_FRACTION x the median of the same account + product's other bookings AND it falls in
  // a month that is not one of that product's normal booking months (months OTC cohorts start, or where
  // normal-sized Tableau bookings land). Needs at least LIKELY_ADJ_MIN_OTHERS other bookings to compare with.
  LIKELY_ADJ_FRACTION: 0.25,
  LIKELY_ADJ_MIN_OTHERS: 2,

  // Forecast Category for lines whose contract is pending (expired / not yet renewed / not in OTC).
  // Counts toward the forecast (weighted); not flagged for review. (In the 2026 sheet "Renewal Pending" was an Outreach Status.)
  PENDING_CATEGORY: "Pending Contract",

  // The hidden "Adjustments" tab is not a complete list of individual 2026 adjustments, so it is not read
  // by default. Set true to add its rows as baseline-only lines (never forecast).
  USE_ADJUSTMENTS_TAB: false,

  // OTC cohort amounts only replace a Tableau baseline when they are in the same ballpark. If the matched
  // cohorts' estimated total is below MATCH_AMOUNT_BAND[0] x or above MATCH_AMOUNT_BAND[1] x the baseline, the
  // baseline amount is kept and the difference is flagged (e.g. annual Med fees vs. per-student cohort overages,
  // or an OTC order with a $0 estimate). Booked OTC actuals are never second-guessed.
  MATCH_AMOUNT_BAND: [0.5, 2.0],

  // Gray / black accounts: ignore OTC roster-chasing cohorts (no cohort code). OTC may not know about
  // teach-outs or dropped accounts, so only rebookings of existing cohorts are used. Black accounts also do not
  // repeat their baseline by assumption; only OTC-backed rebookings are forecast.
  IGNORE_ROSTER_CHASING_GRAY_BLACK: true,

  // At Risk + weighting. Lines with no OTC cohort behind them (baseline repeated by assumption) are the weakest
  // evidence: in the 2026 backtest the team zeroed about half of them. They are marked At Risk, and totals use a
  // WEIGHTED amount (Forecast Amount x weight by Forecast Category) so At Risk is not counted at full value.
  // Starting weights come from the backtest (team kept ~55-65% of these dollars); recalibrate after each backtest.
  // Flat-fee product groups, and the size under which a line is treated as an add-on (overage) rather than the flat fee itself.
  FLAT_FEE_GROUPS: ["MED COURSE", "ALLIED HEALTH COURSE"],
  FLAT_FEE_OVERAGE_MAX: 5000,
  AT_RISK_BASELINE_ONLY: true,
  AT_RISK_CATEGORY: "At Risk",
  // Weights for baseline-only lines (no OTC cohort) by segment, first match wins. Set from the AS-OF 2026 backtest (what we would
  // have known at the start of the year), where the share of baseline dollars the team kept was: Med 25%, contract ended 28%,
  // Red 55%, covers-year 81%, iHuman 85%, no OTC contract data 90%. (An earlier backtest that could see 2026 actuals showed much
  // lower keep rates; that one was too pessimistic and under-forecast by 15%.)
  // Fields: group (product group), rating, ended (contract ended before the month), noContract (no OTC contract data), weight.
  AT_RISK_WEIGHT_RULES: [
    // Med and Allied Health are flat fees per contract term plus small add-on bookings when a school exceeds its allocated students. The flat fee
    // repeats only if the contract is alive; add-ons are variable and rarely repeat. Backtest (baseline-only Med/Allied lines): add-ons under
    // $1k kept 8%, $1-5k kept 23%; flat fees with the contract ended kept 4% (that backtest saw later renewals, so 10% is used), with the contract
    // covering the term kept 38%.
    { name: "Med/Allied add-on (under flat-fee size)", flatFee: true, overage: true,    weight: 0.15 },
    { name: "Med/Allied flat fee, contract ended",     flatFee: true, ended: true,      weight: 0.10 },
    { name: "Med/Allied flat fee, contract covers",    flatFee: true, covers: true,     weight: 0.40 },
    { name: "Med/Allied flat fee, no contract data",   flatFee: true, noContract: true, weight: 0.50 },
    { name: "Contract ended before month",      ended: true,         weight: 0.30 },
    { name: "Red rating, no cohort",            rating: "red",       weight: 0.55 },
    { name: "iHuman, no cohort",                group: "IHUMAN",     weight: 0.85 },
    { name: "No OTC contract data",             noContract: true,     weight: 0.90 },
    { name: "Contract covers year, no cohort",  covers: true,         weight: 0.80 }
  ],

  // How a Tableau baseline row's amount is set when OTC cohorts match it:
  //  "otc"      = OTC cohort amounts (students x price, trend-adjusted).
  //  "min"      = OTC cohort amounts, scaled DOWN when their total exceeds the Tableau baseline (never above Tableau). No trend.
  //  "baseline" = Tableau baseline total, split across the OTC cohorts by their share (OTC used for timing/split only). No trend.
  // As-of 2026 backtest, line-level error vs what the team ended with ($ across 551 kept lines): baseline 2.27M, min 2.35M,
  // OTC estimate 3.04M. Tableau baseline total was within 0.4% of the team's total. Booked OTC actuals are never scaled.
  AMOUNT_BASIS: "baseline",
  WEIGHTS: { "Captured": 1, "Expected": 1, "Pending Contract": 0.65, "At Risk": 0.55, "Not Expected": 0 },

  // SIMPLIFIED vocabulary (replaces the 2026 Outreach Status x Forecast Category grid; CSMs pick from these on the Overrides tab).
  // Early / On time / Late is no longer chosen by hand: the Timing column is calculated (forecast month vs the baseline month).
  CATEGORIES: ["Captured", "Expected", "At Risk", "Pending Contract", "Not Expected"],
  NOT_EXPECTED_REASONS: ["Lost", "No Revenue This Term", "Non-Recurring", "Adjustment", "Data Error"],
  ROSTER_STAGES: ["Not started", "In progress", "Received - held", "Submitted", "Not needed"],

  // Additional predicted cohorts. If OTC expects more cohorts in a term than the same account + product actually booked last year
  // (e.g. 4 last year, 5 predicted), the extra cohort(s) add value on top of the Tableau baseline: each is valued at last year's average
  // cohort value (baseline / last year's cohort count), source "OTC", Forecast Category EXTRA_COHORT_CATEGORY (weighted like any At Risk
  // line until it books). Not applied to gray/black accounts.
  EXTRA_COHORTS: true,
  EXTRA_COHORT_CATEGORY: "At Risk",
  // Weight for an additional predicted cohort. As-of 2026 backtest: 257 baseline lines had extra cohorts predicted worth $2.83M (51% of their
  // baseline); the team's final ended 26% of that above where comparable no-extra lines landed (team/baseline 1.05 vs 0.92). So ~25%, not the
  // generic At Risk 55%. Cohorts with a $0 estimate (placeholder rosters) are not counted, and an extra is never valued above its own OTC estimate.
  EXTRA_COHORT_WEIGHT: 0.25,

  // Cohort size for OTC cohorts that have no Tableau baseline line (the amount cannot come from a baseline):
  //  "actual"   = the same cohort's most recent ACTUAL (final) enrollment, else the account's actual-vs-estimate history x OTC estimate.
  //               OTC estimates are what the rep expected at signing; actual enrollment changes through the term (adds / drops).
  //  "estimate" = OTC estimated students as they are.
  ENROLLMENT_BASIS: "actual",

  // Backtest: pretend it is the start of the backtest year. OTC orders that were actually booked during that year are
  // treated as estimates (students x price, no final enrollment) and cohort codes first assigned during that year are
  // removed, so the engine cannot "see" what happened. Set false to run it on the raw Nov-2026 export.
  BT_AS_OF: true,
  // As-of also drops OTC orders that were CREATED after the backtest year began (order_created_date). A contract renewal signed during 2026 would
  // otherwise make a 2026 line look "covered" when, on 1 Jan 2026, its contract had ended and no renewal existed yet. That leak made "contract ended"
  // look worse than it was and pushed its weight too low.
  BT_AS_OF_DROP_CREATED_AFTER: true,

  // Credit rule: first N months after a cohort's first booking = New, afterwards = Renewal
  NEW_CREDIT_MONTHS: 12,

  // Write match results back into the empty OTC columns of the Tableau tab
  WRITE_BACK_TO_TABLEAU: true,

  // Values in OTC order_status that mean "actually booked". The Nov-2026 export has: Complete 11,214; Roster 5,635; Invoicing 382;
  // AR Review 90; Controller 21; Booking 1. Everything except Roster carries an actual start date and final enrollment, so all
  // of them are booked orders moving through billing. (Any other non-Roster status with an actual start date also counts.)
  OTC_BOOKED_STATUSES: ["complete", "completed", "invoiced", "invoicing", "ar review", "controller", "booking", "booked"],

  // What makes an OTC cohort a "rebooking" (vs roster chasing = first time it will be booked):
  //  "code"   = a Cohort Code is present. The code only exists once the cohort has booked, so a period-2+ row with no code belongs to a
  //             cohort whose first period has not booked yet. Tested on the Nov-2026 export: 332 of the 337 such 2027 rows sit in a cohort
  //             (same account + cohort_name) whose period 1 exists and has not booked. This is the right definition.
  //  "period" = also treat Cohort Code Billing Period >= 2 as a rebooking (not recommended).
  REBOOKING_BASIS: "code",

  // Billing IDs that start with "A" + digits are BOS (new billing system) and never appear in OTC
  BOS_ID_REGEX: "^A\\d+$"
};

/* ======================= FY27Engine.gs ======================= */
/*******************************************************
 * FY27Engine.gs
 * Pure forecast logic: no SpreadsheetApp calls, so it can be unit-tested in Node
 * (see test/engine.test.js) and reused unchanged inside Apps Script.
 *
 * Input rows are plain objects keyed by TRIMMED header text.
 * Months are canonical "YYYY-MM" strings.
 *******************************************************/

/* ---------------- small helpers ---------------- */

function FY27_pad2_(n) { return (n < 10 ? "0" : "") + n; }

/** Any date-ish value -> "YYYY-MM" or "" */
function FY27_monthKey_(v) {
  if (v === null || v === undefined || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    if (isNaN(v.getTime())) return "";
    return v.getFullYear() + "-" + FY27_pad2_(v.getMonth() + 1);
  }
  const s = String(v).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
  if (m) return m[1] + "-" + FY27_pad2_(parseInt(m[2], 10));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + "-" + FY27_pad2_(parseInt(m[1], 10));
  m = s.match(/^([A-Za-z]{3})-(\d{2})$/);                    // "Dec-26"
  if (m) {
    const mj = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase());
    if (mj >= 0) return (2000 + parseInt(m[2], 10)) + "-" + FY27_pad2_(mj + 1);
  }
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*\.?[ -]+(\d{4})$/);   // "June 2026", "Jun 2026"
  if (m) {
    const mi = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase());
    if (mi >= 0) return m[2] + "-" + FY27_pad2_(mi + 1);
  }
  return "";
}
function FY27_monthIdx_(key) {
  if (!key) return NaN;
  const p = key.split("-");
  return parseInt(p[0], 10) * 12 + parseInt(p[1], 10) - 1;
}
function FY27_addMonths_(key, n) {
  if (!key) return "";
  const idx = FY27_monthIdx_(key) + n;
  return Math.floor(idx / 12) + "-" + FY27_pad2_((idx % 12) + 1);
}
function FY27_monthDiff_(a, b) { return FY27_monthIdx_(a) - FY27_monthIdx_(b); }
function FY27_yearOf_(key) { return key ? parseInt(key.slice(0, 4), 10) : NaN; }
function FY27_quarterOf_(key) {
  if (!key) return "";
  return "Q" + (Math.floor((parseInt(key.slice(5, 7), 10) - 1) / 3) + 1) + " " + key.slice(0, 4);
}

function FY27_num_(v) {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (v === null || v === undefined || v === "") return 0;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[^\d.-]/g, "");
  const n = Number(s);
  if (isNaN(n)) return 0;
  return neg ? -Math.abs(n) : n;
}
var FY27_MONTH_NAMES_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function FY27_str_(v) {
  if (v === null || v === undefined) return "";
  // Sheets auto-converts text like "May 2028" into a Date; show it the way OTC does
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return isNaN(v.getTime()) ? "" : FY27_MONTH_NAMES_[v.getMonth()] + " " + v.getFullYear();
  }
  return String(v).trim();
}
/** "New Logo" / "New" -> true. (A bare /new/ test also matches "Re-new-al", which is wrong.) */
function FY27_isNewType_(v) { return /^\s*new/i.test(FY27_str_(v)); }
function FY27_uniqJoin_(arr, sep) {
  const seen = {}, out = [];
  arr.forEach(function (x) { const t = FY27_str_(x); if (t && !seen[t]) { seen[t] = true; out.push(t); } });
  return out.join(sep || "; ");
}
function FY27_bool_(v) {
  if (v === true) return true;
  const s = FY27_str_(v).toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1";
}
/** Salesforce IDs: compare on the 15-char form */
function FY27_id15_(v) { return FY27_str_(v).slice(0, 15); }
function FY27_round2_(n) { return Math.round(n * 100) / 100; }

/** First non-empty value among candidate header names (case/space-insensitive). */
function FY27_pick_(row, names) {
  for (let i = 0; i < names.length; i++) {
    const v = row[names[i]];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

/**
 * Turn a 2-D grid into row objects.
 * - Headers are trimmed. Duplicate header names keep the first as-is and get "__2", "__3" ... after
 *   (this is the bug that produced the $0 forecast column in the 2026 build).
 * - If the row right under the headers looks like raw/system names (OTC export), it is skipped.
 */
function FY27_gridToRows_(grid, opts) {
  opts = opts || {};
  if (!grid || !grid.length) return { headers: [], rows: [] };
  const headers = [];
  const seen = {};
  grid[0].forEach(function (h) {
    let name = FY27_str_(h);
    if (!name) name = "__blank" + headers.length;
    if (seen[name]) { seen[name]++; name = name + "__" + seen[name]; } else { seen[name] = 1; }
    headers.push(name);
  });
  let start = 1;
  if (opts.skipRawHeaderRow && grid.length > 1) {
    const second = FY27_str_(grid[1][0]);
    if (second === opts.skipRawHeaderRow) start = 2;
  }
  const rows = [];
  for (let r = start; r < grid.length; r++) {
    const line = grid[r];
    let any = false;
    const o = {};
    for (let c = 0; c < headers.length; c++) {
      const v = line[c] === undefined ? "" : line[c];
      if (v !== "" && v !== null) any = true;
      o[headers[c]] = v;
    }
    if (any) { o.__row = r + 1; rows.push(o); }
  }
  return { headers: headers, rows: rows };
}

/* ---------------- product family ---------------- */

/** Coarse family used to match Tableau product names to OTC product names. */
function FY27_family_(group, name) {
  const g = FY27_str_(group).toUpperCase();
  const n = FY27_str_(name).toUpperCase();
  if (g.indexOf("NURS") >= 0) {
    if (/\bPN\b/.test(n) || /PRACTICAL/.test(n)) return "PN";
    if (/\bRN\b/.test(n) || /NCLEX-?RN/.test(n)) return "RN";
    return "Other";
  }
  if (g.indexOf("MED") >= 0) {
    if (/STEP\s*1/.test(n)) return "Step1";
    if (/STEP\s*2/.test(n)) return "Step2";
    if (/STEP\s*3/.test(n)) return "Step3";
    return "Other";
  }
  if (g.indexOf("IHUMAN") >= 0) return "iHuman";
  return "Other";
}
/** OTC product names are often just "Curriculum Plus"; the program ("NCLEX RN") and cohort name say RN vs PN. */
function FY27_otcFamily_(group, productName, program, cohortName) {
  // the structured `program` field ("NCLEX RN" / "NCLEX PN" / "USMLE Step 1" ...) is stable; product names are not (9,080 of 13,070
  // nursing rows have names with no RN/PN in them). Program first, then the name, then the cohort name.
  let f = FY27_family_(group, program);
  if (f === "Other") f = FY27_family_(group, productName);
  if (f === "Other") f = FY27_family_(group, cohortName);
  return f;
}
function FY27_familiesCompatible_(a, b) {
  return a === b || a === "Other" || b === "Other";
}

/* ---------------- normalizers ---------------- */

function FY27_normOtc_(r, cfg) {
  const statusLc = FY27_str_(r["order_status"]).toLowerCase();
  const estStart = FY27_monthKey_(FY27_pick_(r, ["order_estimated_start_date"]));
  const actStart = FY27_monthKey_(FY27_pick_(r, ["order_actual_start_date"]));
  const booked = (cfg.OTC_BOOKED_STATUSES || []).indexOf(statusLc) >= 0 || (statusLc !== "" && statusLc !== "roster" && !!actStart);
  const period = FY27_num_(FY27_pick_(r, ["Cohort Code Billing Period"]));
  const code = FY27_str_(FY27_pick_(r, ["Cohort Code (if present, then this is a rebooking)", "Cohort Code", "cohort_code"]));
  const group = FY27_str_(FY27_pick_(r, ["Product Group", "reporting_group"]));
  const pname = FY27_str_(FY27_pick_(r, ["Product Name", "product_name"]));
  const est = FY27_num_(FY27_pick_(r, ["Estimated # of Students", "order_enrollment_estimate"]));
  const fin = FY27_num_(FY27_pick_(r, ["order_enrollment_final"]));
  return {
    row: r.__row,
    fullId: FY27_id15_(FY27_pick_(r, ["Full ID", "account_business_org_id"])),
    accountName: FY27_str_(r["Account Name"]),
    group: group,
    productName: pname,
    family: FY27_otcFamily_(group, pname, FY27_str_(FY27_pick_(r, ["program", "opportunity_program"])), FY27_str_(r["cohort_name"])),
    bookingId: FY27_str_(FY27_pick_(r, ["booking_id"])),
    contractId: FY27_str_(FY27_pick_(r, ["Contract ID", "contract_id"])),
    contractStart: FY27_monthKey_(FY27_pick_(r, ["Contract Start Date", "contract_start_date"])),
    contractEnd: FY27_monthKey_(FY27_pick_(r, ["Contract End Date", "contract_end_date"])),
    cohortName: FY27_str_(FY27_pick_(r, ["cohort_name"])),
    cohortCode: code,
    billingPeriod: period,
    isRebooking: !!code || (cfg.REBOOKING_BASIS === "period" && period >= 2),
    productCode: FY27_str_(FY27_pick_(r, ["product_code"])),
    productType: FY27_str_(FY27_pick_(r, ["product_type"])),
    modality: FY27_str_(FY27_pick_(r, ["product_modality"])),
    otcProgram: FY27_str_(FY27_pick_(r, ["program", "opportunity_program"])),
    termMonths: (function () {
      const a = FY27_monthKey_(FY27_pick_(r, ["order_estimated_start_date"])), z = FY27_monthKey_(FY27_pick_(r, ["order_estimated_end_date"]));
      return a && z ? FY27_monthDiff_(z, a) : "";
    })(),
    dne: FY27_bool_(r["cohort_dne_flag"]),
    status: FY27_str_(r["order_status"]),
    booked: booked,
    estStart: estStart,
    actStart: actStart,
    month: actStart || estStart,          // effective start month
    estStudents: est,
    finalStudents: fin,
    price: FY27_num_(FY27_pick_(r, ["Price Per Student", "order_price"])),
    total: FY27_num_(FY27_pick_(r, ["Estimated or Actual Order Total", "order_total"]))
  };
}

function FY27_normBaseline_(r, cfg) {
  const baseMonth = FY27_monthKey_(FY27_pick_(r, ["Baseline Booking Month - Tableau"]));
  let fcMonth = FY27_monthKey_(FY27_pick_(r, ["Forecast Month - Tableau"]));
  if (!fcMonth && baseMonth) fcMonth = FY27_addMonths_(baseMonth, 12);
  const billingId = FY27_str_(r["Billing ID"]);
  const group = FY27_str_(r["Product Group"]);
  const pname = FY27_str_(r["Product Name"]);
  const bosRe = new RegExp(cfg.BOS_ID_REGEX || "^A\\d+$");
  return {
    row: r.__row,
    raw: r,
    fullId: FY27_id15_(r["FULL ID"]),
    billingId: billingId,
    isBOS: bosRe.test(billingId),
    group: group,
    productName: pname,
    family: FY27_family_(group, pname),
    rating: FY27_str_(r["Rating"]),
    baseMonth: baseMonth,
    fcMonth: fcMonth,
    baseAmt: FY27_num_(r["Baseline Amount - Tableau"]),
    isNegAdj: FY27_num_(r["Baseline Amount - Tableau"]) < 0,
    isAdj: FY27_bool_(r["Adjustment (true/false)"]) || FY27_num_(r["Baseline Amount - Tableau"]) < 0,
    priorType: FY27_str_(r["Prior Booking Type"]),
    nextType: FY27_str_(r["Next Booking Type"]),
    bookingId: FY27_str_(r["booking_id"])
  };
}

function FY27_normSf_(r) {
  return {
    fullId: FY27_id15_(r["FULL ID"]),
    attrs: r
  };
}

/* ---------------- history / trend ---------------- */

/** Per account+group+family: how do completed cohorts compare to their estimates? */
function FY27_buildHistory_(otc, cfg) {
  const byKey = {};
  const firstByAccountGroup = {};
  const firstByCohort = {};
  const lastByFamily = {};
  const cohortLast = {};
  otc.forEach(function (o) {
    if (o.dne || !o.booked || !o.actStart) return;
    const k = o.fullId + "|" + o.group + "|" + o.family;
    const h = byKey[k] || (byKey[k] = { n: 0, est: 0, fin: 0 });
    if (o.estStudents > 0 && o.finalStudents >= 0) { h.n++; h.est += o.estStudents; h.fin += o.finalStudents; }
    if (o.cohortName && o.finalStudents > 0) {
      const ck2 = o.fullId + "|" + o.cohortName;
      if (!cohortLast[ck2] || o.actStart > cohortLast[ck2].month) cohortLast[ck2] = { final: o.finalStudents, price: o.price, total: o.total, month: o.actStart };
    }
    const lk = o.fullId + "|" + o.group + "|" + o.family;
    if (!lastByFamily[lk] || o.actStart > lastByFamily[lk]) lastByFamily[lk] = o.actStart;
    const ag = o.fullId + "|" + o.group;
    if (!firstByAccountGroup[ag] || o.actStart < firstByAccountGroup[ag]) firstByAccountGroup[ag] = o.actStart;
    if (o.cohortCode) {
      const ck = o.fullId + "|" + o.cohortCode;
      if (!firstByCohort[ck] || o.actStart < firstByCohort[ck]) firstByCohort[ck] = o.actStart;
    }
  });
  const ratio = {};
  Object.keys(byKey).forEach(function (k) {
    const h = byKey[k];
    if (h.n >= cfg.TREND_MIN_ORDERS && h.est > 0) {
      const lo = cfg.TREND_CLAMP[0], hi = cfg.TREND_CLAMP[1];
      ratio[k] = { ratio: Math.min(hi, Math.max(lo, h.fin / h.est)), n: h.n };
    }
  });
  return { ratio: ratio, firstByAccountGroup: firstByAccountGroup, firstByCohort: firstByCohort, lastByFamily: lastByFamily, cohortLast: cohortLast };
}

/* ---------------- main engine ---------------- */

/**
 * @param {Object} input { tableau:[rowObj], otc:[rowObj], salesforce:[rowObj], overrides:[rowObj], now: Date }
 * @param {Object} cfg    FY27_CFG
 * @return {{lines:Array, review:Array, writeback:Object, coverage:Array, stats:Object}}
 */
function FY27_buildForecast(input, cfg) {
  const year = cfg.FORECAST_YEAR;
  const now = input.now || new Date();
  const actualsThrough = cfg.ACTUALS_THROUGH === "auto"
    ? now.getFullYear() + "-" + FY27_pad2_(now.getMonth() + 1)
    : FY27_monthKey_(cfg.ACTUALS_THROUGH);

  const otcAll = input.otc.map(function (r, i) { const o = FY27_normOtc_(r, cfg); if (!o.row) o.row = "i" + i; return o; }).filter(function (o) { return o.fullId; });
  // Rows from the separate Adjustments tab (mostly negative adjustments) are baseline too: they count in the
  // baseline, are never forecast. Mapped onto the Tableau column names so one code path handles both.
  const adjRows = (input.adjustments || []).map(function (r) {
    return {
      "Account Name with Billing ID": r["Account Name with Student Org"], "Billing ID": r["Student Org ID"],
      "Account Name": r["Account Name"], "Sales Rep": r["Sales Rep"], "Customer Type": r["Customer Type"],
      "FULL ID": r["FULL ID"], "Rating": r["Rating"], "Client Category": r["Client Category"],
      "Client Sub-Category": r["Client Sub-Category"], "Billing State/Province": r["Billing State/Province"],
      "Account Owner": r["Account Owner"], "Client Success Manager": r["Client Success Manager"],
      "Parent Account": r["Parent Account"], "Billing Country": r["Billing Country"],
      "Parent Account ID": r["Parent Account ID"], "Account Record Type": r["Account Record Type"],
      "Product Group": r["Product Group"], "Product Name": r["Product Name"],
      "Prior Booking Type": r["Sales Type"], "Next Booking Type": "", "Adjustment (true/false)": "TRUE",
      "Baseline Booking Month - Tableau": r["Booking Month"], "Forecast Month - Tableau": r["Baseline Month"],
      "Baseline Amount - Tableau": r["Baseline Amount"], "booking_id": "", __row: "adj" + r.__row, __adjTab: true
    };
  });
  const base = input.tableau.concat(adjRows).map(function (r, i) {
      const b = FY27_normBaseline_(r, cfg); if (!b.row) b.row = "i" + i; b.fromAdjTab = !!r.__adjTab; return b; })
    .filter(function (b) { return b.fullId || b.baseAmt || b.group; });
  const sfById = {};
  (input.salesforce || []).forEach(function (r) {
    const s = FY27_normSf_(r);
    if (s.fullId && !sfById[s.fullId]) sfById[s.fullId] = s.attrs;
  });

  // Reconcile Tableau baseline-year bookings with OTC baseline-year actuals to find adjustments
  // (extra students added after a cohort started) - those must not recur.
  const derivedAdj = FY27_deriveAdjustments_(base, otcAll, year - 1, cfg.ADJUSTMENT_MAX_ABS);
  const likelyAdj = FY27_flagLikelyAdjustments_(base, otcAll, year - 1, cfg);

  const history = FY27_buildHistory_(otcAll, cfg);

  // Index OTC by account
  const otcByAcct = {};
  otcAll.forEach(function (o) { (otcByAcct[o.fullId] = otcByAcct[o.fullId] || []).push(o); });

  // Account-level contract end per group (for flags)
  const contractEnd = {};
  otcAll.forEach(function (o) {
    if (!o.contractEnd) return;
    const k = o.fullId + "|" + o.group;
    if (!contractEnd[k] || o.contractEnd > contractEnd[k]) contractEnd[k] = o.contractEnd;
  });

  // Gray / black accounts: OTC may not know about teach-outs or dropped accounts, so OTC roster-chasing cohorts
  // (no cohort code = first booking) are ignored for them; only rebookings of existing cohorts are used.
  const ratingByFull = {};
  base.forEach(function (b) { if (b.fullId && b.rating && !ratingByFull[b.fullId]) ratingByFull[b.fullId] = b.rating; });
  function restrictedAccount(fullId) {
    // rating comes from the Tableau Bookings Data tab only (most recent; brought in from Salesforce there)
    const r = FY27_str_(ratingByFull[fullId]).toLowerCase();
    return r === "gray" || r === "grey" || r === "black";
  }
  const ignoredRoster = { cohorts: 0, value: 0 };
  // OTC rows that land in the forecast year (not flagged DNE)
  const target = otcAll.filter(function (o) { return !o.dne && FY27_yearOf_(o.month) === year; }).filter(function (o) {
    if (cfg.IGNORE_ROSTER_CHASING_GRAY_BLACK && !o.booked && !o.isRebooking && restrictedAccount(o.fullId)) {
      ignoredRoster.cohorts++; ignoredRoster.value += o.total;
      return false;
    }
    return true;
  });
  const tableauIds = {};
  base.forEach(function (b) { if (b.fullId) tableauIds[b.fullId] = true; });

  // Which programs (account + product group + family) actually booked in the baseline year?
  // An OTC cohort for a program that did NOT book last year is not forecast (e.g. a PN program
  // that stopped running when two sites merged contracts). Value is kept in "Value If Booked".
  const activeProg = {};
  function markActive(fullId, group, family) {
    const k = fullId + "|" + group;
    (activeProg[k] = activeProg[k] || {})[family] = true;
  }
  base.forEach(function (b) { if (b.fullId && !b.isAdj && b.baseAmt > 0) markActive(b.fullId, b.group, b.family); });
  otcAll.forEach(function (o) {
    if (!o.dne && o.booked && FY27_yearOf_(o.actStart) === year - 1) markActive(o.fullId, o.group, o.family);
  });
  function programActive(fullId, group, family) {
    const fam = activeProg[fullId + "|" + group];
    if (!fam) return false;
    if (family === "Other") return true;
    return !!(fam[family] || fam["Other"]);
  }

  let lines = [];
  const usedOtc = {};         // OTC row -> true once assigned
  const writeback = {};       // tableau row number -> info

  function ratingKind(rating) {
    const r = rating.toLowerCase();
    if (r === "gray" || r === "grey") return "gray";
    if (r === "black") return "black";
    return "";
  }

  /* ---- 1. Baseline rows -> match to OTC cohorts ---- */
  const baseByAcctGroup = {};
  base.forEach(function (b) {
    const k = b.fullId + "|" + b.group;
    (baseByAcctGroup[k] = baseByAcctGroup[k] || []).push(b);
  });

  // assignment: each target OTC row goes to the nearest compatible baseline row (within tolerance)
  const assigned = new Map();   // baseline -> [otc]
  target.forEach(function (o) {
    const cands = (baseByAcctGroup[o.fullId + "|" + o.group] || []).filter(function (b) {
      return !b.isBOS && !b.isAdj && b.fcMonth && FY27_familiesCompatible_(b.family, o.family);
    });
    let best = null, bestD = Infinity;
    cands.forEach(function (b) {
      const d = Math.abs(FY27_monthDiff_(o.month, b.fcMonth));
      // prefer exact family match on ties
      const tie = d === bestD && best && b.family === o.family && best.family !== o.family;
      if (d < bestD || tie) { best = b; bestD = d; }
    });
    if (best && bestD <= cfg.MATCH_TOLERANCE_MONTHS) {
      if (!assigned.has(best)) assigned.set(best, []);
      assigned.get(best).push(o);
      usedOtc[o.row] = true;
    }
  });

  // how many cohorts (booked OTC orders) made up each baseline row last year? (same nearest-row assignment as the upcoming cohorts)
  const lastCount = new Map();
  otcAll.forEach(function (o) {
    if (o.dne || !o.booked || !o.actStart || o.total <= 0 || FY27_yearOf_(o.actStart) !== year - 1) return;
    const cands = (baseByAcctGroup[o.fullId + "|" + o.group] || []).filter(function (b) {
      return !b.isBOS && !b.isAdj && b.baseMonth && FY27_familiesCompatible_(b.family, o.family);
    });
    let best = null, bestD = Infinity;
    cands.forEach(function (b) {
      const d = Math.abs(FY27_monthDiff_(o.actStart, b.baseMonth));
      const tie = d === bestD && best && b.family === o.family && best.family !== o.family;
      if (d < bestD || tie) { best = b; bestD = d; }
    });
    if (best && bestD <= cfg.MATCH_TOLERANCE_MONTHS) lastCount.set(best, (lastCount.get(best) || 0) + 1);
  });

  /**
   * Credit type (New vs Renewal) is decided at the account + PRODUCT GROUP level:
   *  1. If the group already has a Tableau baseline line, the next booking is whatever Tableau
   *     column U ("Next Booking Type") says - normally Renewal.
   *  2. Otherwise (group not in Tableau) apply the 12-month rule from the group's first OTC booking:
   *     within 12 months = New, after = Renewal, never booked = New.
   * The basis is written next to the credit so every New is traceable.
   */
  function creditFor(fullId, group, month, baselineRow) {
    if (baselineRow && baselineRow.nextType) {
      return { credit: FY27_isNewType_(baselineRow.nextType) ? "New" : "Renewal", basis: "Tableau Next Booking Type (col U)" };
    }
    const sibs = (baseByAcctGroup[fullId + "|" + group] || []).filter(function (x) { return x.nextType && !x.isAdj; });
    if (sibs.length) {
      sibs.sort(function (x, y) { return x.baseMonth < y.baseMonth ? 1 : x.baseMonth > y.baseMonth ? -1 : 0; });
      return { credit: FY27_isNewType_(sibs[0].nextType) ? "New" : "Renewal", basis: "Same product group in Tableau (col U)" };
    }
    const first = history.firstByAccountGroup[fullId + "|" + group] || "";
    if (!first) return { credit: "New", basis: "First booking of this product group" };
    const age = FY27_monthDiff_(month, first);
    return { credit: age < cfg.NEW_CREDIT_MONTHS ? "New" : "Renewal", basis: "12-month rule: first booked " + first };
  }

  function sfAttrs(fullId) { return sfById[fullId] || {}; }

  function makeLine(partial) {
    const l = {
      accountNameWithOrg: "", studentOrgId: "", accountName: "", salesRep: "", customerType: "",
      fullId: "", rating: "", clientCategory: "", clientSubCategory: "", billingState: "",
      accountOwner: "", csm: "", parentAccount: "", billingCountry: "", parentAccountId: "",
      accountRecordType: "", productGroup: "", productName: "", forecastSource: "",
      priorBookingType: "", nextBookingType: "", adjustment: "", baselineMonth: "", bookingId: "", adjVariance: "",
      contractId: "", contractStart: "", contractEnd: "", forecastMonth: "", forecastQuarter: "",
      baselineAmount: 0, valueIfBooked: 0, forecastAmount: 0,
      estStudents: "", adjStudents: "", price: "", cohortNames: "", cohortCodes: "", priorCohorts: "",
      productCode: "", productType: "", modality: "", otcProgram: "", termMonths: "", reason: "", stage: "", timing: "",
      bookingType: "", credit: "", creditBasis: "", status: "", expectation: "", weight: 1, weightedAmount: 0, otcEstimate: "", segment: "", flags: [], key: ""
    };
    for (const k in partial) l[k] = partial[k];
    return l;
  }

  function attrsFromBaseline(b) {
    const r = b.raw;
    return {
      accountNameWithOrg: FY27_str_(r["Account Name with Billing ID"]),
      studentOrgId: b.billingId,
      accountName: FY27_str_(r["Account Name"]),
      salesRep: FY27_str_(r["Sales Rep"]),
      customerType: FY27_str_(r["Customer Type"]),
      fullId: FY27_str_(r["FULL ID"]),
      rating: b.rating,
      clientCategory: FY27_str_(r["Client Category"]),
      clientSubCategory: FY27_str_(r["Client Sub-Category"]),
      billingState: FY27_str_(r["Billing State/Province"]),
      accountOwner: FY27_str_(r["Account Owner"]),
      csm: FY27_str_(r["Client Success Manager"]),
      parentAccount: FY27_str_(r["Parent Account"]),
      billingCountry: FY27_str_(r["Billing Country"]),
      parentAccountId: FY27_str_(r["Parent Account ID"]),
      accountRecordType: FY27_str_(r["Account Record Type"]),
      priorBookingType: b.priorType,
      nextBookingType: b.nextType,
      adjustment: b.isAdj ? "TRUE" : "FALSE",
      baselineMonth: b.baseMonth,
      bookingId: b.bookingId
    };
  }

  function priorCohortsFor(b) {
    if (!b.baseMonth || b.isBOS) return "";
    const names = {};
    (otcByAcct[b.fullId] || []).forEach(function (o) {
      if (o.group === b.group && o.booked && o.actStart === b.baseMonth &&
          FY27_familiesCompatible_(b.family, o.family) && o.cohortName) names[o.cohortName] = true;
    });
    return Object.keys(names).join("; ");
  }

  function applyRatingAndAdj(line, b, otcIsRoster) {
    // returns nothing; mutates line.expectation / flags / forecastAmount
    const kind = ratingKind(b ? b.rating : line.rating);
    line.valueIfBooked = line.forecastAmount;
    if (b && b.isAdj && b.baseAmt > 0) {
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.reason = "Adjustment";
      line.flags.push("Positive adjustment: tagged not expected for this client");
    } else if (b && b.isAdj && b.baseAmt < 0) {
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.reason = "Adjustment";
      line.flags.push("Negative adjustment" + (b.fromAdjTab ? " (Adjustments tab)" : "") + ": in baseline, not forecast" +
        (cfg.ADJUSTMENT_MAX_ABS > 0 && Math.abs(b.baseAmt) > cfg.ADJUSTMENT_MAX_ABS
          ? " - LARGE (over $" + cfg.ADJUSTMENT_MAX_ABS.toLocaleString() + "): probably part of a booking total, review" : ""));
    }
    if (kind === "black" && line.bookingType === "Rebooking (assumed)" && line.status !== "Booked") {
      // teach-out: only cohorts that exist in OTC (rebookings with a cohort code) are expected to finish their term;
      // a baseline repeated "by assumption" is not evidence of one
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.reason = "Lost";
      line.flags.push("Black rating (teach-out): only existing OTC cohorts are forecast, baseline not repeated");
    } else if ((kind === "gray" || kind === "black") && line.bookingType === "Roster Chasing" && line.status !== "Booked") {
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.reason = "No Revenue This Term";
      line.flags.push((kind === "black" ? "Black" : "Gray") + " rating: no new cohorts expected, only rebookings");
    }
  }

  base.forEach(function (b) {
    const attrs = attrsFromBaseline(b);
    let matches = assigned.get(b) || [];
    // predicted additional cohorts: more upcoming cohorts than last year's booked cohorts -> the extras add value on top of the baseline
    let extras = [], extraNote = "", extraAvg = 0;
    const isFlatFee = (cfg.FLAT_FEE_GROUPS || []).some(function (g) { return g.toUpperCase() === b.group.toUpperCase(); });
    if (cfg.EXTRA_COHORTS && !isFlatFee && matches.length && b.baseAmt > 0 && !b.isAdj && !restrictedAccount(b.fullId)) {
      const lastN = lastCount.get(b) || 0;
      const countable = matches.filter(function (o) { return o.total > 0; });     // $0 placeholder rosters are not real cohorts
      if (lastN > 0 && countable.length > lastN) {
        const nExtra = countable.length - lastN;
        extraAvg = FY27_round2_(b.baseAmt / lastN);
        // extras: not-yet-booked first, first-time (roster chasing) cohorts first, latest month first
        const ranked = countable.slice().sort(function (x, y) {
          return (x.booked - y.booked) || (x.isRebooking - y.isRebooking) || (y.month < x.month ? -1 : y.month > x.month ? 1 : 0);
        });
        extras = ranked.slice(0, nExtra);
        matches = matches.filter(function (o) { return extras.indexOf(o) < 0; });
        extraNote = "Additional cohort: OTC expects " + (lastN + nExtra) + " cohorts vs " + lastN + " last year (+" + nExtra + " x $" + Math.round(extraAvg).toLocaleString() + " average cohort value)";
      }
    }
    let otcDiffers = "";
    if (matches.length && b.baseAmt > 0 && cfg.MATCH_AMOUNT_BAND && !matches.some(function (o) { return o.booked; })) {
      const tot = matches.reduce(function (t, o) { return t + o.total; }, 0);
      if (tot < cfg.MATCH_AMOUNT_BAND[0] * b.baseAmt || tot > cfg.MATCH_AMOUNT_BAND[1] * b.baseAmt) {
        otcDiffers = "OTC cohort estimate $" + Math.round(tot).toLocaleString() + " is far from baseline $" + Math.round(b.baseAmt).toLocaleString() +
          " - baseline kept, check cohort / contract";
        matches = [];   // cohorts stay consumed (not re-added as OTC-only lines); baseline carries the forecast
      }
    }
    const prior = priorCohortsFor(b);
    const ceKey = b.fullId + "|" + b.group;
    const cEnd = contractEnd[ceKey] || "";
    const baseFlags = [];

    // baseline month incomplete?
    if (b.baseMonth && FY27_monthDiff_(b.baseMonth, actualsThrough) >= 0) {
      baseFlags.push("Baseline month " + b.baseMonth + " is not complete yet (actuals through " + FY27_addMonths_(actualsThrough, -1) + ")");
    }

    if (matches.length) {
      // one forecast line per OTC cohort order (month-accurate); baseline amount sits on the first line only
      matches.sort(function (x, y) { return x.month < y.month ? -1 : x.month > y.month ? 1 : 0; });
      let hasCode = false, hasNoCode = false;
      matches.forEach(function (o) { if (o.isRebooking) hasCode = true; else hasNoCode = true; });
      const bookingType = hasCode && hasNoCode ? "Mix" : hasCode ? "Rebooking" : "Roster Chasing";
      const otcEstTotal = matches.reduce(function (t, o) { return t + o.total; }, 0);
      // baseline $ lands on the line in the baseline's own forecast month (else the first line)
      let baseIdx = 0;
      matches.forEach(function (o, i) { if (o.month === b.fcMonth && baseIdx === 0 && i > 0) baseIdx = i; });
      if (matches[0].month === b.fcMonth) baseIdx = 0;
      matches.forEach(function (o, i) {
        const L = makeLine(attrs);
        L.productGroup = b.group;
        L.productName = o.productName || b.productName;
        L.forecastSource = cfg.SOURCES.TABLEAU;
        L.contractId = o.contractId;
        L.contractStart = o.contractStart;
        L.contractEnd = o.contractEnd;
        L.forecastMonth = o.month;
        L.baselineAmount = i === baseIdx ? b.baseAmt : 0;
        L.bookingId = FY27_uniqJoin_([b.bookingId, o.bookingId]);
        L.estStudents = o.estStudents;
        L.price = o.price;
        L.cohortNames = o.cohortName;
        L.productCode = o.productCode; L.productType = o.productType; L.modality = o.modality; L.otcProgram = o.otcProgram; L.termMonths = o.termMonths;
        L.cohortCodes = o.cohortCode;
        L.priorCohorts = i === baseIdx ? prior : "";
        L.bookingType = bookingType;
        L.status = o.booked ? "Booked" : "Forecast";
        L.stage = o.booked ? "Submitted" : (o.isRebooking ? "Not needed" : "Not started");
        if (b.fcMonth && o.month) { const dm = FY27_monthDiff_(o.month, b.fcMonth); L.timing = dm < 0 ? "Early" : dm > 0 ? "Late" : "On time"; }
        // amount: actual if booked, else (trend-adjusted) students x price, else OTC total
        let amt = o.total;
        L.otcEstimate = o.total;
        const basis = cfg.AMOUNT_BASIS || "otc";
        if (!o.booked && basis !== "otc" && b.baseAmt > 0 && otcEstTotal > 0) {
          const k = basis === "baseline" ? b.baseAmt / otcEstTotal : Math.min(1, b.baseAmt / otcEstTotal);
          amt = FY27_round2_(o.total * k);
          if (k < 0.999 && i === baseIdx) {
            L.flags.push("Amount held to Tableau baseline: OTC cohorts $" + Math.round(otcEstTotal).toLocaleString() + " vs baseline $" + Math.round(b.baseAmt).toLocaleString());
          }
        } else if (!o.booked && basis === "otc") {
          const tr = history.ratio[o.fullId + "|" + o.group + "|" + o.family];
          if (cfg.USE_TREND && tr && Math.abs(tr.ratio - 1) >= cfg.TREND_MIN_DELTA && o.estStudents > 0 && o.price > 0) {
            const adj = Math.round(o.estStudents * tr.ratio);
            L.adjStudents = adj;
            amt = FY27_round2_(adj * o.price);
            L.flags.push("Cohort size trend-adjusted " + o.estStudents + " -> " + adj + " (history x" + FY27_round2_(tr.ratio) + " over " + tr.n + " cohorts)");
          }
        }
        L.forecastAmount = amt;
        const cr = creditFor(o.fullId, o.group, o.month, b);
        L.credit = cr.credit; L.creditBasis = cr.basis;
        L.expectation = o.booked ? "Captured" : "Expected";
        if (i === baseIdx) {
          baseFlags.forEach(function (f) { L.flags.push(f); });
          // Baseline includes adjustments (extra students, overages) that the OTC contract estimate does not
          const delta = FY27_round2_(b.baseAmt - otcEstTotal);
          L.adjVariance = delta;
          if (Math.abs(delta) >= 1) {
            L.flags.push("Adjustment: baseline $" + Math.round(b.baseAmt).toLocaleString() + " vs OTC estimate $" +
              Math.round(otcEstTotal).toLocaleString() + " (" + (delta > 0 ? "+" : "-") + "$" + Math.abs(Math.round(delta)).toLocaleString() +
              (delta > 0 ? " added after the contract estimate" : " below the contract estimate") + ")");
          }
        }
        if (o.contractEnd && o.month && FY27_monthDiff_(o.month, o.contractEnd) > 0) {
          if (L.expectation === "Expected") L.expectation = cfg.PENDING_CATEGORY;   // contract pending, no review flag
        }
        applyRatingAndAdj(L, b, !o.booked);
        lines.push(L);
      });
      extras.forEach(function (o) {
        const X = makeLine(attrs);
        X.productGroup = b.group; X.productName = o.productName || b.productName;
        X.forecastSource = cfg.SOURCES.OTC;
        X.contractId = o.contractId; X.contractStart = o.contractStart; X.contractEnd = o.contractEnd;
        X.forecastMonth = o.month;
        X.baselineAmount = 0;
        X.estStudents = o.estStudents; X.price = o.price; X.otcEstimate = o.total;
        X.cohortNames = o.cohortName; X.cohortCodes = o.cohortCode;
        X.productCode = o.productCode; X.productType = o.productType; X.modality = o.modality; X.otcProgram = o.otcProgram; X.termMonths = o.termMonths;
        X.bookingId = o.bookingId;
        X.bookingType = o.isRebooking ? "Rebooking" : "Roster Chasing";
        X.status = o.booked ? "Booked" : "Forecast";
        X.stage = o.booked ? "Submitted" : (o.isRebooking ? "Not needed" : "Not started");
        X.forecastAmount = o.booked ? o.total : Math.min(extraAvg, o.total);
        X.expectation = o.booked ? "Captured" : cfg.EXTRA_COHORT_CATEGORY;
        if (!o.booked) { X.weightOverride = cfg.EXTRA_COHORT_WEIGHT; X.segment = "Additional predicted cohort"; }
        X.flags.push(extraNote);
        applyRatingAndAdj(X, null, !o.booked);
        lines.push(X);
      });
      writeback[b.row] = {
        contractId: matches.map(function (o) { return o.contractId; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join("; "),
        contractStart: matches[0].contractStart,
        contractEnd: matches[0].contractEnd,
        forecastMonthOtc: matches[0].month,
        price: matches[0].price,
        estStudents: matches.reduce(function (s, o) { return s + o.estStudents; }, 0),
        estAmount: matches.reduce(function (s, o) { return s + o.total; }, 0),
        bookingType: bookingType,
        productType: "",
        cohortNames: matches.map(function (o) { return o.cohortName; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join("; ")
      };
      return;
    }

    // No OTC cohort matched -> baseline-only line (assume rebooking at the same value)
    if (!b.fcMonth || FY27_yearOf_(b.fcMonth) !== year) return;
    const L = makeLine(attrs);
    L.productGroup = b.group;
    L.productName = b.productName;
    L.forecastSource = cfg.SOURCES.TABLEAU;
    L.forecastMonth = b.fcMonth;
    L.baselineAmount = b.baseAmt;
    L.forecastAmount = b.baseAmt;
    L.contractEnd = cEnd;
    L.bookingId = b.bookingId;
    L.priorCohorts = prior;
    L.bookingType = "Rebooking (assumed)";
    L.status = "Forecast";
    L.stage = "Not started";
    L.expectation = "Expected";
    const cr0 = creditFor(b.fullId, b.group, b.fcMonth, b);
    L.credit = cr0.credit; L.creditBasis = cr0.basis;
    baseFlags.forEach(function (f) { L.flags.push(f); });

    // why is there no cohort?
    if (otcDiffers && !b.isBOS && !b.isAdj) {
      L.flags.push(otcDiffers);
    } else if (b.isBOS) {
      L.flags.push("BOS billing ID - not in OTC; forecast from baseline only");
    } else if (b.isAdj) {
      if (b.adjReason) L.flags.push(b.adjReason);
    } else if (!otcByAcct[b.fullId]) {
      L.expectation = cfg.PENDING_CATEGORY;
    } else if (!cEnd) {
      L.expectation = cfg.PENDING_CATEGORY;
    } else if (FY27_monthDiff_(b.fcMonth, cEnd) > 0) {
      L.expectation = cfg.PENDING_CATEGORY;   // contract ended / not renewed yet: pending, not a review flag
    } else {
      L.flags.push("Contract covers " + b.fcMonth + " (ends " + cEnd + ") but no upcoming cohort in OTC - check");
    }
    // repeated by assumption, no OTC cohort behind it: At Risk (pending contracts keep their own status)
    if (cfg.AT_RISK_BASELINE_ONLY && L.expectation === "Expected" && !b.isBOS && !b.isAdj) L.expectation = cfg.AT_RISK_CATEGORY;
    // weight by segment (what share of this kind of line did the team keep in the backtest?)
    if (!b.isBOS && !b.isAdj && (L.expectation === cfg.AT_RISK_CATEGORY || L.expectation === cfg.PENDING_CATEGORY)) {
      const ended = !!(otcByAcct[b.fullId] && cEnd && FY27_monthDiff_(b.fcMonth, cEnd) > 0);
      const noContract = !otcByAcct[b.fullId] || !cEnd;
      const flatFee = (cfg.FLAT_FEE_GROUPS || []).some(function (g) { return g.toUpperCase() === b.group.toUpperCase(); });
      const facts = { group: b.group.toUpperCase(), rating: b.rating.toLowerCase(), ended: ended, noContract: noContract, covers: !ended && !noContract,
        flatFee: flatFee, overage: flatFee && b.baseAmt < cfg.FLAT_FEE_OVERAGE_MAX };
      const rules = cfg.AT_RISK_WEIGHT_RULES || [];
      for (let ri = 0; ri < rules.length; ri++) {
        const ru = rules[ri];
        if ((ru.group === undefined || ru.group.toUpperCase() === facts.group) && (ru.rating === undefined || ru.rating === facts.rating) &&
            (ru.ended === undefined || ru.ended === facts.ended) && (ru.noContract === undefined || ru.noContract === facts.noContract) &&
            (ru.covers === undefined || ru.covers === facts.covers) && (ru.flatFee === undefined || ru.flatFee === facts.flatFee) &&
            (ru.overage === undefined || ru.overage === facts.overage)) {
          L.weightOverride = ru.weight; L.segment = ru.name;
          break;
        }
      }
    }
    applyRatingAndAdj(L, b, false);
    lines.push(L);
    writeback[b.row] = {
      contractId: "", contractStart: "", contractEnd: cEnd, forecastMonthOtc: "", price: "",
      estStudents: "", estAmount: "", bookingType: "Rebooking (assumed)", productType: "", cohortNames: ""
    };
  });

  /* ---- 2. OTC cohorts with no baseline match -> own lines ---- */
  const excluded = { cohorts: 0, value: 0, accounts: {} };
  target.forEach(function (o) {
    if (usedOtc[o.row]) return;
    const sf = sfAttrs(o.fullId);
    const notInTableau = !tableauIds[o.fullId];
    if (notInTableau && !cfg.INCLUDE_NOT_IN_TABLEAU) {
      excluded.cohorts++; excluded.value += o.total; excluded.accounts[o.fullId] = true;
      return;
    }
    const L = makeLine({
      accountNameWithOrg: (sf["Account Name"] || o.accountName) + (sf["Student Org Id"] ? " (" + sf["Student Org Id"] + ")" : ""),
      studentOrgId: FY27_str_(sf["Student Org Id"]),
      accountName: FY27_str_(sf["Account Name"] || o.accountName),
      fullId: FY27_str_(sf["FULL ID"] || o.fullId),
      rating: FY27_str_(ratingByFull[o.fullId] || (notInTableau ? sf["Rating"] : "")),
      clientCategory: FY27_str_(sf["Client Category"]),
      clientSubCategory: FY27_str_(sf["Client Sub-Category"]),
      billingState: FY27_str_(sf["Billing State/Province"]),
      accountOwner: FY27_str_(sf["Account Owner"]),
      csm: FY27_str_(sf["Client Success Manager"]),
      parentAccount: FY27_str_(sf["Parent Account"]),
      billingCountry: FY27_str_(sf["Billing Country"]),
      parentAccountId: FY27_str_(sf["Parent Account ID"]),
      accountRecordType: FY27_str_(sf["Account Record Type"]),
      productGroup: o.group, productName: o.productName,
      forecastSource: cfg.SOURCES.OTC,
      contractId: o.contractId, contractStart: o.contractStart, contractEnd: o.contractEnd,
      forecastMonth: o.month, estStudents: o.estStudents, price: o.price, bookingId: o.bookingId,
      cohortNames: o.cohortName, cohortCodes: o.cohortCode,
      productCode: o.productCode, productType: o.productType, modality: o.modality, otcProgram: o.otcProgram, termMonths: o.termMonths,
      bookingType: o.isRebooking ? "Rebooking" : "Roster Chasing",
      status: o.booked ? "Booked" : "Forecast",
      stage: o.booked ? "Submitted" : (o.isRebooking ? "Not needed" : "Not started"),
      forecastAmount: o.total, otcEstimate: o.total,
      expectation: o.booked ? "Captured" : "Expected"
    });
    if (!o.booked && (cfg.ENROLLMENT_BASIS || "actual") === "actual" && o.price > 0) {
      // no baseline for this cohort: size it from what the same cohort ACTUALLY enrolled last time (OTC estimates are the rep's
      // expectation at signing); if the cohort is new, fall back to the account's actual-vs-estimate history
      const last = history.cohortLast[o.fullId + "|" + o.cohortName];
      const tr = history.ratio[o.fullId + "|" + o.group + "|" + o.family];
      if (last && last.month < o.month && last.final > 0) {
        L.adjStudents = last.final;
        L.forecastAmount = FY27_round2_(last.final * o.price);
        L.flags.push("Cohort size from last actual enrollment: " + last.final + " students (" + last.month + ") instead of OTC estimate " + o.estStudents);
      } else if (cfg.USE_TREND && tr && Math.abs(tr.ratio - 1) >= cfg.TREND_MIN_DELTA && o.estStudents > 0) {
        const adj = Math.round(o.estStudents * tr.ratio);
        L.adjStudents = adj;
        L.forecastAmount = FY27_round2_(adj * o.price);
        L.flags.push("Cohort size from account's actual-vs-estimate history: " + o.estStudents + " -> " + adj + " (x" + FY27_round2_(tr.ratio) + " over " + tr.n + " cohorts)");
      }
    }
    if (notInTableau) {
      const cr = creditFor(o.fullId, o.group, o.month, null);
      L.credit = cr.credit; L.creditBasis = cr.basis;
    } else {
      // account is in Tableau but this cohort has no baseline line: incremental, so new sales credit
      L.credit = "New"; L.creditBasis = "Cohort not in " + (year - 1) + " baseline: new sales credit";
    }
    L.flags.push(notInTableau
      ? "Not in Tableau (no " + (year - 1) + " actuals): new account or missing bookings - verify"
      : "No matching " + (year - 1) + " baseline for this cohort - new cohort or product");
    applyRatingAndAdj(L, null, !o.booked);
    // Existing account, but this program did not book last year -> do not add it for next year
    // Only FIRST-TIME cohorts (no cohort code) can be a dormant program: a cohort code exists only once the class has booked, so a coded
    // cohort is an existing class and the program is alive (e.g. Capital Idea PN, booked last week, has codes).
    if (cfg.EXCLUDE_UNBOOKED_PROGRAMS && !o.booked && !o.isRebooking && !notInTableau && !programActive(o.fullId, o.group, o.family)) {
      const last = history.lastByFamily[o.fullId + "|" + o.group + "|" + o.family];
      const noteBase = "No " + (year - 1) + " booking for this program (" + o.family + ")" + (last ? ", last booked " + last : "");
      if ((cfg.DORMANT_PROGRAM_ACTION || "weight") === "zero") {
        L.expectation = "Not Expected";
        L.reason = "No Revenue This Term";
        L.forecastAmount = 0;
        L.flags.push(noteBase + " - cohort in OTC not forecast. Override if the program is returning");
      } else {
        // flag and weight down; a CSM decides
        L.expectation = cfg.AT_RISK_CATEGORY;
        L.weightOverride = cfg.DORMANT_PROGRAM_WEIGHT;
        L.segment = "Program not booked in " + (year - 1);
        L.flags.push(noteBase + " - first-time cohort, weighted down. CSM: confirm the program is running, or set Not Expected");
      }
    }
    lines.push(L);
  });

  /* ---- 3. Group detail lines: one row per account x billing org x product group x month x credit x status ---- */
  if (!cfg.TAG_CREDIT) lines.forEach(function (d) { d.credit = ""; d.creditBasis = ""; });
  const detail = lines;
  const weightOf = function (L) {
    if (L.expectation === "Not Expected") return 0;
    if (L.weightOverride !== undefined) return L.weightOverride;
    const w = cfg.WEIGHTS && cfg.WEIGHTS[L.expectation];
    return w === undefined ? 1 : w;
  };
  detail.forEach(function (d) { d.weight = weightOf(d); d.weightedAmount = FY27_round2_(d.forecastAmount * d.weight); });
  const groups = {};
  const order = [];
  detail.forEach(function (d) {
    d.forecastQuarter = FY27_quarterOf_(d.forecastMonth);
    const gk = [FY27_id15_(d.fullId), d.studentOrgId, d.productGroup, d.forecastMonth, d.credit, d.status, d.expectation].join("|");
    if (!groups[gk]) { groups[gk] = []; order.push(gk); }
    groups[gk].push(d);
  });
  const grouped = order.map(function (gk) { return FY27_mergeLines_(groups[gk], makeLine); });

  /* ---- 4. Apply manual overrides (keyed on the grouped line so they survive refreshes) ---- */
  const keyCount = {};
  grouped.forEach(function (L) {
    const base = [FY27_id15_(L.fullId), L.studentOrgId, L.productGroup, L.forecastMonth, L.credit, L.status, L.expectation].join("|");
    keyCount[base] = (keyCount[base] || 0) + 1;
    L.key = base + "|" + keyCount[base];
  });
  const ovByKey = {};
  (input.overrides || []).forEach(function (r) {
    const k = FY27_str_(r["Line Key"]);
    if (k) ovByKey[k] = r;
  });
  let overridesApplied = 0;
  grouped.forEach(function (L) {
    const ov = ovByKey[L.key];
    if (!ov) return;
    const exclude = FY27_bool_(ov["Exclude"]);
    const amt = FY27_str_(ov["Override Amount"]);
    const mo = FY27_monthKey_(ov["Override Month"]);
    const catRaw = FY27_str_(ov["Forecast Category"]).toLowerCase();
    const cat = (cfg.CATEGORIES || []).filter(function (c) { return c.toLowerCase() === catRaw; })[0] || "";
    const reasonRaw = FY27_str_(ov["Not Expected Reason"]);
    const stageRaw = FY27_str_(ov["Roster Stage"]);
    if (!exclude && amt === "" && !mo && !cat && !reasonRaw && !stageRaw) return;
    overridesApplied++;
    if (cat) {
      L.expectation = cat;
      const w = cfg.WEIGHTS && cfg.WEIGHTS[cat];
      L.weight = w === undefined ? 1 : w;
      L.flags.push("Manual override: category " + cat);
    }
    if (reasonRaw) L.reason = reasonRaw;
    if (stageRaw) L.stage = stageRaw;
    if (exclude) { L.forecastAmount = 0; L.expectation = "Not Expected"; L.flags.push("Manual override: excluded"); }
    if (amt !== "") { L.forecastAmount = FY27_num_(amt); L.flags.push("Manual override: amount"); }
    if (mo) { L.forecastMonth = mo; L.flags.push("Manual override: month"); }
    if (FY27_str_(ov["Comment"])) L.flags.push("Note: " + FY27_str_(ov["Comment"]));
  });
  lines = grouped;
  lines.forEach(function (L) {
    if (L.expectation === "Not Expected") L.stage = L.stage && L.stage !== "Not started" && L.stage !== "Not needed" ? L.stage : "";
    else L.reason = "";
  });
  // a grouped row keeps the blended weight of its parts; overrides (exclude / amount) rescale it
  lines.forEach(function (L) { L.weightedAmount = FY27_round2_(L.forecastAmount * (L.expectation === "Not Expected" ? 0 : L.weight)); });

  lines.forEach(function (L) { L.forecastQuarter = FY27_quarterOf_(L.forecastMonth); });
  lines.sort(function (a, b) {
    return (a.forecastMonth < b.forecastMonth ? -1 : a.forecastMonth > b.forecastMonth ? 1 : 0) ||
      (a.accountName < b.accountName ? -1 : a.accountName > b.accountName ? 1 : 0);
  });

  /* ---- 4. Review list + coverage ---- */
  const review = [];
  lines.forEach(function (L) {
    L.flags.forEach(function (f) {
      review.push({
        severity: FY27_severity_(f), flag: f, account: L.accountName, fullId: L.fullId,
        productGroup: L.productGroup, productName: L.productName, forecastMonth: L.forecastMonth,
        amount: L.forecastAmount, valueIfBooked: L.valueIfBooked || L.forecastAmount,
        csm: L.csm, owner: L.accountOwner, key: L.key
      });
    });
  });
  const sevOrder = { High: 0, Medium: 1, Low: 2 };
  review.sort(function (a, b) { return sevOrder[a.severity] - sevOrder[b.severity] || (b.valueIfBooked - a.valueIfBooked); });

  // monthly coverage: how complete is each month?
  const cov = {};
  for (let m = 1; m <= 12; m++) cov[year + "-" + FY27_pad2_(m)] = { month: year + "-" + FY27_pad2_(m), booked: 0, forecast: 0, bookedLines: 0, forecastLines: 0, baselineIncomplete: false, weighted: 0 };
  lines.forEach(function (L) {
    const c = cov[L.forecastMonth];
    if (!c) return;
    if (L.status === "Booked") { c.booked += L.forecastAmount; c.bookedLines++; } else { c.forecast += L.forecastAmount; c.forecastLines++; c.weighted += L.weightedAmount; }
    if (L.flags.some(function (f) { return f.indexOf("not complete yet") >= 0; })) c.baselineIncomplete = true;
  });

  return {
    lines: lines,
    detail: detail,
    review: review,
    writeback: writeback,
    coverage: Object.keys(cov).sort().map(function (k) { return cov[k]; }),
    stats: {
      actualsThrough: actualsThrough,
      lines: lines.length,
      detailLines: detail.length,
      composition: (function () {
        const out = { byCategory: {}, bySource: {}, bySegment: {} };
        lines.forEach(function (L) {
          [["byCategory", L.expectation || "(none)"], ["bySource", L.forecastSource || "(none)"], ["bySegment", L.segment || "(cohort-backed or Tableau line)"]].forEach(function (p) {
            const x = out[p[0]][p[1]] || (out[p[0]][p[1]] = { n: 0, full: 0, weighted: 0 });
            x.n++; x.full += L.forecastAmount; x.weighted += L.weightedAmount;
          });
        });
        return out;
      })(),
      ignoredRosterChasing: ignoredRoster,
      derivedAdjustments: derivedAdj,
      likelyAdjustments: likelyAdj,
      baseline: (function () {
        const r2 = FY27_round2_;
        const tab = base.filter(function (b) { return !b.fromAdjTab; }).reduce(function (t, b) { return t + b.baseAmt; }, 0);
        const adjT = base.filter(function (b) { return b.fromAdjTab; }).reduce(function (t, b) { return t + b.baseAmt; }, 0);
        const inFc = detail.reduce(function (t, d) { return t + d.baselineAmount; }, 0);
        return { tableau: r2(tab), adjustmentsTab: r2(adjT), inForecast: r2(inFc), difference: r2(tab + adjT - inFc) };
      })(),
      excludedNotInTableau: { accounts: Object.keys(excluded.accounts).length, cohorts: excluded.cohorts, value: excluded.value },
      otcTargetRows: target.length,
      otcMatched: Object.keys(usedOtc).length,
      overridesApplied: overridesApplied,
      total: lines.reduce(function (s, L) { return s + L.forecastAmount; }, 0),
      totalWeighted: FY27_round2_(lines.reduce(function (s, L) { return s + L.weightedAmount; }, 0))
    }
  };
}

/**
 * Derive adjustments by comparing Tableau baseline-year bookings with OTC baseline-year actuals.
 *
 * Example (Aims RN): OTC Complete cohorts starting 2026-02 total $9,765. Tableau shows $9,585 in Feb and
 * $180 in Mar. 9,585 + 180 = 9,765, so the Mar $180 is an extra student added to the Feb cohort - an
 * adjustment, not a recurring booking.
 *
 * Per account + product group + Tableau family: for every month where OTC cohorts started ("anchor"),
 * if Tableau's amount for that month is short of the OTC total, look for a set of later Tableau rows (in months
 * where no OTC cohort started) that closes the gap exactly. Those rows are marked as adjustments.
 * Exact-sum matching keeps false positives low. Mutates the baseline row objects; returns a count.
 */
function FY27_deriveAdjustments_(base, otcAll, baseYear, maxAbs) {
  let found = 0;
  const cap = maxAbs > 0 ? maxAbs : Infinity;
  const byAcct = {};
  base.forEach(function (b) {
    if (!b.fullId || b.isBOS || b.isAdj || !b.baseMonth || b.baseAmt <= 0 || FY27_yearOf_(b.baseMonth) !== baseYear) return;
    const k = b.fullId + "|" + b.group + "|" + b.family;
    (byAcct[k] = byAcct[k] || []).push(b);
  });
  const otcByGroup = {};
  otcAll.forEach(function (o) {
    if (o.dne || !o.booked || !o.actStart || FY27_yearOf_(o.actStart) !== baseYear) return;
    (otcByGroup[o.fullId + "|" + o.group] = otcByGroup[o.fullId + "|" + o.group] || []).push(o);
  });
  Object.keys(byAcct).forEach(function (k) {
    const rows = byAcct[k];
    const parts = k.split("|");
    const fam = parts[2];
    const orders = (otcByGroup[parts[0] + "|" + parts[1]] || []).filter(function (o) { return FY27_familiesCompatible_(fam, o.family); });
    if (!orders.length) return;
    const otcByMonth = {};
    orders.forEach(function (o) { otcByMonth[o.actStart] = (otcByMonth[o.actStart] || 0) + o.total; });
    const anchors = Object.keys(otcByMonth).sort();
    const claimed = {};
    anchors.forEach(function (m) {
      const S = otcByMonth[m];
      let have = 0;
      rows.forEach(function (b) { if (b.baseMonth === m && !claimed[b.row]) have += b.baseAmt; });
      const gap = FY27_round2_(S - have);
      const tol = Math.max(1, S * 0.002);
      if (have <= 0 || gap <= tol) return;
      const cands = rows.filter(function (b) {
        return !claimed[b.row] && !otcByMonth[b.baseMonth] && b.baseAmt <= cap &&
          FY27_monthDiff_(b.baseMonth, m) > 0 && FY27_monthDiff_(b.baseMonth, m) <= 12;
      }).sort(function (x, y) { return x.baseMonth < y.baseMonth ? -1 : x.baseMonth > y.baseMonth ? 1 : 0; }).slice(0, 12);
      let best = null;
      for (let mask = 1; mask < (1 << cands.length); mask++) {
        let sum = 0, cnt = 0;
        for (let i = 0; i < cands.length; i++) if (mask & (1 << i)) { sum += cands[i].baseAmt; cnt++; }
        if (Math.abs(sum - gap) <= tol && (!best || cnt < best.cnt)) best = { mask: mask, cnt: cnt };
      }
      if (!best) return;
      for (let i = 0; i < cands.length; i++) {
        if (!(best.mask & (1 << i))) continue;
        const b = cands[i];
        claimed[b.row] = true;
        b.isAdj = true;
        b.adjReason = "Adjustment (derived): $" + Math.round(b.baseAmt).toLocaleString() + " booked " + b.baseMonth +
          " is extra students on the cohort that started " + m + " (OTC " + baseYear + " actuals $" + Math.round(S).toLocaleString() +
          " = Tableau " + m + " $" + Math.round(have).toLocaleString() + " + later adjustments). Not recurring, forecast $0";
        found++;
      }
    });
  });
  return found;
}

function FY27_median_(arr) {
  const a = arr.slice().sort(function (x, y) { return x - y; });
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/**
 * Flag POSITIVE Tableau lines that look like adjustments but did not reconcile to OTC: much smaller than the
 * same account + product's other bookings, in a month that product does not normally book in.
 * Mutates baseline rows (isAdj, adjReason); returns a count.
 */
function FY27_flagLikelyAdjustments_(base, otcAll, baseYear, cfg) {
  let found = 0;
  const groups = {};
  base.forEach(function (b) {
    if (!b.fullId || b.fromAdjTab || b.isAdj || b.baseAmt <= 0 || !b.baseMonth || FY27_yearOf_(b.baseMonth) !== baseYear) return;
    const k = b.fullId + "|" + b.group + "|" + b.family;
    (groups[k] = groups[k] || []).push(b);
  });
  Object.keys(groups).forEach(function (k) {
    const rows = groups[k];
    const parts = k.split("|");
    // normal booking months-of-year for this product: OTC cohort starts (any year) ...
    const normal = {};
    otcAll.forEach(function (o) {
      if (o.dne || !o.booked || !o.actStart || o.fullId !== parts[0] || o.group !== parts[1]) return;
      if (FY27_familiesCompatible_(parts[2], o.family)) normal[o.actStart.slice(5, 7)] = true;
    });
    rows.forEach(function (r) {
      const others = rows.filter(function (x) { return x !== r && !x.isAdj; });
      if (others.length < cfg.LIKELY_ADJ_MIN_OTHERS) return;
      const med = FY27_median_(others.map(function (x) { return x.baseAmt; }));
      // ... plus months where normal-sized Tableau bookings land
      const months = Object.assign({}, normal);
      others.forEach(function (x) { if (x.baseAmt >= med * 0.5) months[x.baseMonth.slice(5, 7)] = true; });
      if (r.baseAmt < med * cfg.LIKELY_ADJ_FRACTION && !months[r.baseMonth.slice(5, 7)]) {
        r.isAdj = true;
        r.adjReason = "Adjustment (likely): $" + Math.round(r.baseAmt).toLocaleString() + " booked " + r.baseMonth +
          " is much smaller than this product's usual bookings (median $" + Math.round(med).toLocaleString() +
          ") and not in its normal booking months. Not recurring, forecast $0";
        found++;
      }
    });
  });
  return found;
}

/** Collapse detail lines that share a group key into one forecast row. */
function FY27_mergeLines_(parts, makeLine) {
  const first = parts[0];
  const L = makeLine(first);
  const join = function (f) { return FY27_uniqJoin_(parts.map(function (p) { return p[f]; })); };
  const sum = function (f) { return FY27_round2_(parts.reduce(function (t, p) { return t + (Number(p[f]) || 0); }, 0)); };
  L.productName = join("productName");
  L.forecastSource = join("forecastSource");
  L.bookingId = join("bookingId");
  L.contractId = join("contractId");
  L.cohortNames = join("cohortNames");
  L.cohortCodes = join("cohortCodes");
  L.productCode = join("productCode"); L.productType = join("productType"); L.modality = join("modality"); L.otcProgram = join("otcProgram");
  L.termMonths = join("termMonths");
  L.priorCohorts = join("priorCohorts");
  L.creditBasis = join("creditBasis");
  L.priorBookingType = join("priorBookingType");
  L.nextBookingType = join("nextBookingType");
  L.baselineAmount = sum("baselineAmount");
  L.reason = join("reason"); L.stage = join("stage"); L.timing = join("timing");
  L.otcEstimate = parts.some(function (p) { return p.otcEstimate !== ""; }) ? sum("otcEstimate") : "";
  L.segment = FY27_uniqJoin_(parts.map(function (p) { return p.segment; }));
  const wsum = parts.reduce(function (t, p) { return t + (Number(p.weightedAmount) || 0); }, 0);
  const fsum = parts.reduce(function (t, p) { return t + (Number(p.forecastAmount) || 0); }, 0);
  L.weight = fsum ? wsum / fsum : first.weight;
  L.valueIfBooked = sum("valueIfBooked");
  L.forecastAmount = sum("forecastAmount");
  L.estStudents = parts.some(function (p) { return p.estStudents !== ""; }) ? sum("estStudents") : "";
  L.adjStudents = parts.some(function (p) { return p.adjStudents !== ""; })
    ? FY27_round2_(parts.reduce(function (t, p) { return t + (p.adjStudents !== "" ? Number(p.adjStudents) : (Number(p.estStudents) || 0)); }, 0)) : "";
  L.adjVariance = parts.some(function (p) { return p.adjVariance !== ""; }) ? sum("adjVariance") : "";
  const prices = {}; parts.forEach(function (p) { if (p.price !== "") prices[p.price] = true; });
  const pk = Object.keys(prices);
  L.price = pk.length === 1 ? Number(pk[0]) : "";
  const bm = parts.map(function (p) { return p.baselineMonth; }).filter(Boolean).sort();
  L.baselineMonth = bm.length ? bm[0] : "";
  const cs = parts.map(function (p) { return p.contractStart; }).filter(Boolean).sort();
  const ce = parts.map(function (p) { return p.contractEnd; }).filter(Boolean).sort();
  L.contractStart = cs.length ? cs[0] : "";
  L.contractEnd = ce.length ? ce[ce.length - 1] : "";
  L.adjustment = parts.some(function (p) { return p.adjustment === "TRUE"; }) ? "TRUE" : first.adjustment;
  const types = {}; parts.forEach(function (p) { types[p.bookingType] = true; });
  const hasRebook = types["Rebooking"] || types["Rebooking (assumed)"] || types["Mix"];
  const hasRoster = types["Roster Chasing"] || types["Mix"];
  L.bookingType = hasRebook && hasRoster ? "Mix" : Object.keys(types).length === 1 ? first.bookingType
    : types["Rebooking"] ? "Rebooking" : first.bookingType;
  const flags = [];
  parts.forEach(function (p) { p.flags.forEach(function (f) { if (flags.indexOf(f) < 0) flags.push(f); }); });
  L.flags = flags;
  L.forecastQuarter = first.forecastQuarter;
  L.detailCount = parts.length;
  return L;
}

function FY27_severity_(flag) {
  const f = flag.toLowerCase();
  if (f.indexOf("needs renewal") >= 0 || f.indexOf("no otc data") >= 0 || f.indexOf("not in tableau") >= 0 ||
      f.indexOf("no upcoming cohort") >= 0 || f.indexOf("no otc contract") >= 0) return "High";
  if (f.indexOf("not complete yet") >= 0 || f.indexOf("no matching") >= 0 || f.indexOf("after contract end") >= 0 ||
      f.indexOf("positive adjustment") >= 0 || f.indexOf("adjustment (derived)") >= 0 || f.indexOf("far from baseline") >= 0 || f.indexOf("adjustment (likely)") >= 0 || f.indexOf("booking for this program") >= 0 ||
      f.indexOf("adjustment: baseline") >= 0) return "Medium";
  return "Low";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FY27_buildForecast: FY27_buildForecast, FY27_gridToRows_: FY27_gridToRows_,
    FY27_monthKey_: FY27_monthKey_, FY27_addMonths_: FY27_addMonths_, FY27_family_: FY27_family_,
    FY27_num_: FY27_num_
  };
}

/* ======================= FY27Build.gs ======================= */
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

function FY27_writeReview_(ss, result) {
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
  [["Forecast category", "byCategory", true], ["Forecast source", "bySource", false], ["Weight basis", "bySegment", false]].forEach(function (sec) {
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
  const header = ["Line Key", "Account", "Product", "Forecast Month", "Override Amount", "Override Month",
    "Forecast Category", "Not Expected Reason", "Roster Stage", "Comment"];
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const cur = sh.getRange(1, 1, 1, header.length).getValues()[0];
  if (!header.every(function (h, i) { return cur[i] === h; })) {
    // older layout had an "Exclude" checkbox in column G and Comment in H: carry rows over (Exclude -> Not Expected)
    let carried = [];
    if (sh.getLastRow() > 1 && cur[6] === "Exclude") {
      carried = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().filter(function (r) { return r[0] !== ""; }).map(function (r) {
        return [r[0], r[1], r[2], r[3], r[4], r[5], (r[6] === true || String(r[6]).toLowerCase() === "true") ? "Not Expected" : "", "", "", r[7]];
      });
    }
    sh.clear();
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    if (carried.length) sh.getRange(2, 1, carried.length, header.length).setValues(carried);
  }
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#E7EDF6");
  sh.setFrozenRows(1);
  const dd = function (col, list) {
    sh.getRange(2, col, 500, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
  };
  dd(7, FY27_CFG.CATEGORIES); dd(8, FY27_CFG.NOT_EXPECTED_REASONS); dd(9, FY27_CFG.ROSTER_STAGES);
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

/* ======================= FY27Backtest.gs ======================= */
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
  if (cfg.BT_AS_OF && cfg.BT_AS_OF_DROP_CREATED_AFTER) {
    const asOfStart = year + "-01";
    otcRows = otcRows.filter(function (r) {
      const c = FY27_monthKey_(r["order_created_date"]);
      return !c || c < asOfStart;
    });
  }
  if (cfg.BT_AS_OF) {
    const codeOf = function (r) { return FY27_str_(FY27_pick_(r, ["Cohort Code (if present, then this is a rebooking)", "Cohort Code", "cohort_code"])); };
    const bookedStatuses = cfg.OTC_BOOKED_STATUSES || [];
    const doneBefore = {};
    otcRows.forEach(function (r) {
      const act = FY27_monthKey_(r["order_actual_start_date"]);
      if (act && FY27_yearOf_(act) < year && bookedStatuses.indexOf(FY27_str_(r["order_status"]).toLowerCase()) >= 0 && codeOf(r)) {
        doneBefore[FY27_id15_(FY27_pick_(r, ["Full ID", "account_business_org_id"])) + "|" + codeOf(r)] = true;
      }
    });
    otcRows = otcRows.map(function (r) {
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
