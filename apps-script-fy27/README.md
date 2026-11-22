# FY2027 forecast build (Apps Script)

Separate from `../apps-script/` (the FY2026 dashboard tooling, left untouched).

## Install (in the FY2027 sheet: Extensions > Apps Script)
**Easiest, and the way to avoid "Identifier ... has already been declared":** delete every file in the project and paste `dist/FY27All.gs`
(all four files combined) into ONE file. For every update, replace that one file's whole contents (Ctrl+A, paste). Regenerate it with
`./build-bundle.sh` after changing any source file.

Or, with separate files:
Add four script files with the contents of: `FY27Config.gs`, `FY27Engine.gs`, `FY27Build.gs`, `FY27Backtest.gs`.
Reload the sheet; a **FY27 Forecast** menu appears.

## Refresh loop
1. Paste new Tableau / OTC / Salesforce exports over the input tabs
   (OTC and Salesforce tabs are found by name prefix, so renamed tabs are fine).
2. **FY27 Forecast > Build / refresh forecast**.
3. Review the `Forecast Review` tab (flags, month coverage), fix data or add overrides.

`ACTUALS_THROUGH` defaults to "auto" (the current month), so every refresh rolls forward as
November/December and then 2027 bookings land. Orders OTC marks Complete become **Booked / Captured**;
everything else stays **Forecast / Expected**.

## What it produces
`Forecast` tab, one row per account x product group x month x credit type (`Forecast Detail` keeps the ungrouped lines), with the same account
fields as the FY2026 working forecast plus: Forecast Month/Quarter, Baseline Amount, Value If Booked,
Forecast Amount, cohort names/codes, 2027 Booking Type (Rebooking / Roster Chasing / Mix), Credit Type
(New / Renewal), Status (Booked / Forecast), Forecast Category (Captured / Expected / Not Expected),
Flags, Line Key. Forecast Category uses the FY2026 roll-up names so existing dashboard logic carries over.

## Rules implemented (from the Forecast Goals tab)
- Accounts match on FULL ID (15-char). Billing IDs like `A123456` are BOS: baseline only, never matched to OTC.
- Each OTC cohort order starting in the forecast year is assigned to the nearest Tableau baseline row of the
  same account + product group + product family (RN/PN, Step 1/2, iHuman) within `MATCH_TOLERANCE_MONTHS`.
  Matched: forecast uses the OTC cohort month and students x price. Unmatched baseline: baseline value is
  carried at its Tableau forecast month (assumed rebooking). Unmatched OTC: its own line (new cohort / not in Tableau).
- Cohort code present = rebooking; absent = roster chasing (first booking). Mixed = Mix.
- `ADJUSTMENT_MAX_ABS` ($2,000): lines larger than this are treated as real bookings already in the baseline total and are never
  derived as positive adjustments; large negative lines are flagged LARGE for review. The `Adjustments` tab is not read by default
  (`USE_ADJUSTMENTS_TAB`) because it does not list the individual 2026 adjustments.
- Adjustments, summarised: any negative amount is an adjustment. A positive line is an adjustment when OTC actuals reconcile it
  ("Adjustment (derived)") or when it is far smaller than the product's other bookings and falls outside its normal booking months
  ("Adjustment (likely)", `LIKELY_ADJ_FRACTION`). All are forecast $0 with baseline kept, and flagged.
- Pending contracts (contract ended, no OTC contract / data) are not review flags: the Forecast Category is `Renewal Pending`
  (`PENDING_CATEGORY`) and the amount still counts, like the 2026 forecast.
- Negative adjustments (any negative amount in the Tableau tab, plus the `Adjustments` tab if enabled) are baseline rows that are never
  forecast. The Review tab's Baseline check compares the forecast's Baseline Amount with Tableau + Adjustments tab; the difference
  should be 0 apart from rows whose forecast month falls outside the forecast year.
- OTC amounts only replace a baseline when the matched cohorts' total is within `MATCH_AMOUNT_BAND` (0.5x-2x) of it; otherwise the
  baseline is kept and flagged (annual fees, $0 OTC estimates).
- At Risk and weighting: a baseline line with no OTC cohort behind it (baseline repeated by assumption) is `At Risk`
  (`AT_RISK_BASELINE_ONLY`). `Weighted Forecast Amount` = Forecast Amount x `WEIGHTS[Forecast Category]` (Captured/Expected 100%,
  Renewal Pending 65%, At Risk 55%, Not Expected 0%). Totals and dashboards should use the weighted amount, not the full value, so At Risk
  is not counted at 100%. Starting weights come from the 2026 backtest; recalibrate after each backtest.
- Segment weights (`AT_RISK_WEIGHT_RULES`) for baseline-only lines, from the 2026 backtest: Med course 10%, contract ended 30%, Red 40%,
  iHuman 65%, contract covers year 65%, no OTC contract data 90%.
- `AMOUNT_BASIS` ("min" default): matched OTC cohort amounts are scaled down when they exceed the Tableau baseline (never above Tableau),
  with no trend adjustment. "otc" = OTC amounts + trend, "baseline" = Tableau total split across cohorts. In the backtest OTC/trend amounts
  ran ~17% above what the team ended with, and trend-adjusted lines were worse than repeating the baseline.
- Backtest runs "as of" the start of 2026 (`BT_AS_OF`): 2026 orders are treated as estimates and new cohort codes removed.
- Dormant programs: an OTC cohort for a program (account + product group + RN/PN/Step family) with no booking in the
  baseline year is Not Expected, value kept in Value If Booked, flagged for review (`EXCLUDE_UNBOOKED_PROGRAMS`). Accounts
  missing from Tableau entirely are exempt and flagged instead.
- Gray / black ratings come from the Tableau Bookings Data tab only (the Salesforce tab's rating is not used). (`IGNORE_ROSTER_CHASING_GRAY_BLACK`): OTC may not know about teach-outs or dropped accounts, so OTC roster-chasing
  cohorts (no cohort code) are ignored and only rebookings of existing cohorts are used. Gray repeats the baseline by assumption; black
  does not (only OTC-backed rebookings are forecast). Ignored cohorts are counted on the Review tab.
- (older note) Rating: Gray drops roster-chasing lines (rebookings only); Black zeroes the client (Value If Booked is kept).
- Positive adjustments are tagged Not Expected. Adjustments are also derived by reconciling Tableau baseline-year bookings with OTC
  baseline-year actuals: if OTC cohorts starting in month M total more than Tableau's month-M amount and later Tableau rows
  (months with no OTC cohort start) close the gap exactly, those rows are added students, not recurring bookings, and forecast $0.
- Cohort-size trend: estimate x (history final/estimate) when >= 2 completed orders and the gap is >= 10%.
- New vs Renewal credit is OFF (`TAG_CREDIT: false`): Credit Type / Credit Basis columns are omitted and do not split rows. The
  code is kept for later: credit would be set per product group, 12 months after its first new sale.
- Accounts with no Tableau rows are left out (counted on the Review tab; `INCLUDE_NOT_IN_TABLEAU` brings them back).
- Flags: contract covers the year but no upcoming cohort (CE Hub case), contract ended/expiring before the
  forecast month, no OTC data, not in Tableau, baseline month still incomplete, cohort after contract end.

## Forecast Source
`Tableau` = the line is tied to a Tableau baseline row (the amount may come from OTC cohort data); `OTC` = OTC cohort with
no Tableau baseline line; `Manual Add On` = reserved for the manual add-on feature (not built yet). A grouped row that mixes
sources shows both, e.g. `Tableau; OTC`.

## Overrides (survive refreshes)
Select a row on `Forecast`, run **Add override for selected Forecast row**, then set Override Amount /
Override Month / Exclude on `Forecast Overrides`. Overrides are keyed on `Line Key`.

## Backtest against the 2026 forecast
**FY27 Forecast > Backtest against 2026 forecast** runs the same engine on the 2025 baseline (`2026 Beginning Forecast Reference`)
and compares it, per Student Org ID + product group + 2026 baseline month, with the final 2026 forecast (`2026 Forecast Reference`).
Outputs `Backtest Summary` (engine vs team agreement table, why the engine zeroed lines, month totals) and `Backtest Detail`
(every disagreement, largest first, with the team's category and comment), a signals table (how often the team zeroed lines the
engine flagged a given way) and a year-level (account x product group) comparison that ignores month moves. The OTC export is from Nov 2026, so treat it as a logic
check, not an accuracy score.

## Tests
`node apps-script-fy27/test/engine.test.js` (pure engine) and `node apps-script-fy27/test/writers.test.js` (sheet writers against a fake SpreadsheetApp that checks range sizes). Do NOT paste the test files into Apps Script.

## Not built yet
Dynamic dashboards (next step: formula-driven views over the `Forecast` tab).
