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

  // Credit rule: first N months after a cohort's first booking = New, afterwards = Renewal
  NEW_CREDIT_MONTHS: 12,

  // Write match results back into the empty OTC columns of the Tableau tab
  WRITE_BACK_TO_TABLEAU: true,

  // Values in OTC order_status that mean "actually booked"
  OTC_BOOKED_STATUSES: ["complete", "completed", "invoiced", "booked"],

  // Billing IDs that start with "A" + digits are BOS (new billing system) and never appear in OTC
  BOS_ID_REGEX: "^A\\d+$"
};
