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
    CARRY: "FY26Nov_DecForecast",
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
    RAW_HISTORY_PREFIX: "Flex Hierarchy Crosstab",   // raw Tableau crosstab 2024-2026 (account, group, product, booking type, CSM, month, sales)
    CSM: "CSM Forecast",              // the working tab for CSMs: filter to your accounts, edit the yellow cells
    MANUAL: "Manual Add-Ons",         // lines the data does not know about (new sales, placeholders); source "Manual Add On"
    README: "Read Me",
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
  // ---- Link to the current prior-year (2026) forecast -------------------------------------------------------------
  // Paste the current Nov/Dec 2026 forecast into the tab below (same columns as the 2026 forecast file). Optional: if the tab is missing nothing changes.
  // "prior_year": a cohort for the forecast year that is already booked while "now" is still before the forecast year is credited to the year it was
  //   signed (it shows as Captured in the 2026 forecast): $0 here, baseline kept, reason "Booked in 2026". Switches itself off once the forecast year starts.
  // "keep": count it in the forecast year as Captured.
  EARLY_BOOKED_TREATMENT: "prior_year",
  // Open prior-year lines still dated Nov/Dec: share assumed to slip into CARRY_OPEN_SLIP_MONTH of the forecast year (0 = none; CSMs push lines explicitly
  // by setting the Forecast Month on the 2026 tab). Lines already moved into the forecast year are always carried in.
  CARRY_OPEN_SLIP_RATE: 0,
  CARRY_OPEN_SLIP_MONTH: 1,

  SOURCES: { TABLEAU: "Tableau", OTC: "OTC", MANUAL: "Manual Add On", CARRY: "2026 Carry-In" },

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
  // Flat-fee product groups. A line is an add-on (students over the allocation, a one-time fee) when it is smaller than this fraction of the SAME
  // client's largest line in that product group (a $2k line next to a $25k flat fee is 8%). The client's largest line is the flat fee itself.
  // In the 2026 backtest the team zeroed 82% of add-ons defined this way. An add-on is a one-time fee: it is set Not Expected with reason
  // "Non-Recurring" ($0; the value stays in Value If Booked) and does not go through the generic adjustment test.
  FLAT_FEE_GROUPS: ["MED COURSE", "ALLIED HEALTH COURSE"],
  FLAT_FEE_OVERAGE_FRACTION: 0.15,
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
    { name: "Med/Allied flat fee, contract ended",     flatFee: true, ended: true,      weight: 0.40 },
    { name: "Med/Allied flat fee, contract covers",    flatFee: true, covers: true,     weight: 0.30 },
    { name: "Med/Allied flat fee, no contract data",   flatFee: true, noContract: true, weight: 0.50 },
    // CORRECTED AS-OF BACKTEST (orders created after 1 Jan 2026 removed, so a later renewal cannot hide an ended contract): lines whose contract had
    // ended before the forecast month were kept 77% (325 lines, $4.4M), not the 27% the leaky backtest showed. By how long ago it ended: 1-3 months 86%,
    // 4-6 months 72%, 7-12 months 62% (clients usually renew late, and a recent end is more likely a renewal in progress).
    { name: "Contract ended 1-3 months before", ended: true, endedMaxMonths: 3, weight: 0.85 },
    { name: "Contract ended 4-6 months before", ended: true, endedMaxMonths: 6, weight: 0.70 },
    { name: "Contract ended 7+ months before",  ended: true,                    weight: 0.60 },
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
  NOT_EXPECTED_REASONS: ["Lost", "No Revenue This Term", "Non-Recurring", "Adjustment", "Data Error", "Booked in 2026"],
  EARLY_BOOKED_REASON: "Booked in 2026",
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

  // Dropdown lists for the Manual Add-Ons tab
  PRODUCT_GROUPS: ["NURSING COURSE", "MED COURSE", "IHUMAN", "ALLIED HEALTH COURSE"],
  BOOKING_TYPES: ["New Logo", "Renewal", "Cross Sell"],

  // Summary page: predicted retention under each model, next to actual retention history. Re-runs the engine a few times (a bit slower).
  RETENTION_MODELS: true,

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
