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
    REVIEW: "Forecast Review",
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

  // Credit rule: first N months after a cohort's first booking = New, afterwards = Renewal
  NEW_CREDIT_MONTHS: 12,

  // Write match results back into the empty OTC columns of the Tableau tab
  WRITE_BACK_TO_TABLEAU: true,

  // Values in OTC order_status that mean "actually booked"
  OTC_BOOKED_STATUSES: ["complete", "completed", "invoiced", "booked"],

  // Billing IDs that start with "A" + digits are BOS (new billing system) and never appear in OTC
  BOS_ID_REGEX: "^A\\d+$"
};
