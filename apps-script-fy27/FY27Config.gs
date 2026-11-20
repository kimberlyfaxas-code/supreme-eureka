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
  // Counts as Expected in the roll-up (same idea as "Renewal Pending" in the 2026 forecast); not flagged for review.
  PENDING_CATEGORY: "Renewal Pending",

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

  // Credit rule: first N months after a cohort's first booking = New, afterwards = Renewal
  NEW_CREDIT_MONTHS: 12,

  // Write match results back into the empty OTC columns of the Tableau tab
  WRITE_BACK_TO_TABLEAU: true,

  // Values in OTC order_status that mean "actually booked"
  OTC_BOOKED_STATUSES: ["complete", "completed", "invoiced", "booked"],

  // Billing IDs that start with "A" + digits are BOS (new billing system) and never appear in OTC
  BOS_ID_REGEX: "^A\\d+$"
};
