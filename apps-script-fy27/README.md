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
- Pending contracts (contract ended, no OTC contract / data) are not review flags: the Forecast Category is `Pending Contract`
  (`PENDING_CATEGORY`) and the amount still counts, like the 2026 forecast.
- Negative adjustments (any negative amount in the Tableau tab, plus the `Adjustments` tab if enabled) are baseline rows that are never
  forecast. The Review tab's Baseline check compares the forecast's Baseline Amount with Tableau + Adjustments tab; the difference
  should be 0 apart from rows whose forecast month falls outside the forecast year.
- OTC amounts only replace a baseline when the matched cohorts' total is within `MATCH_AMOUNT_BAND` (0.5x-2x) of it; otherwise the
  baseline is kept and flagged (annual fees, $0 OTC estimates).
- At Risk and weighting: a baseline line with no OTC cohort behind it (baseline repeated by assumption) is `At Risk`
  (`AT_RISK_BASELINE_ONLY`). `Weighted Forecast Amount` = Forecast Amount x `WEIGHTS[Forecast Category]` (Captured/Expected 100%,
  Pending Contract 65%, At Risk 55%, Not Expected 0%). Totals and dashboards should use the weighted amount, not the full value, so At Risk
  is not counted at 100%. Starting weights come from the 2026 backtest; recalibrate after each backtest.
- Med and Allied Health are flat fees (`FLAT_FEE_GROUPS`): a baseline-only flat-fee line follows the contract (ended 10%, covers 40%, no contract data 50%),
  and a line smaller than `FLAT_FEE_OVERAGE_FRACTION` (15%) of the SAME client's largest line in that group (a $2k line next to a $25k flat fee) is a one-time add-on: Not Expected, reason Non-Recurring, $0 (value kept in Value If Booked). Additional-cohort logic is not applied to them.
- Contract ended before the forecast month (corrected as-of backtest, no later-renewal leak): kept 77%; weights by how long ago: 1-3 months 85%, 4-6 months 70%, 7+ months 60%.
- Segment weights (`AT_RISK_WEIGHT_RULES`) for baseline-only lines, from the 2026 backtest: (older note) Med course 25%, contract ended 30%, Red 55%,
  iHuman 85%, contract covers year 80%, no OTC contract data 90% (calibrated on the as-of backtest).
- `AMOUNT_BASIS` ("baseline" default): for a Tableau baseline row with matched OTC cohorts, the Tableau total is kept and split across the
  cohorts by their OTC share (OTC supplies timing). "min" caps OTC amounts at Tableau; "otc" uses OTC amounts + trend. "otc" = OTC amounts + trend, "baseline" = Tableau total split across cohorts. In the backtest OTC/trend amounts
  ran ~17% above what the team ended with, and trend-adjusted lines were worse than repeating the baseline.
- Backtest runs "as of" the start of 2026 (`BT_AS_OF`): 2026 orders are treated as estimates, new cohort codes are removed, and orders created after 1 Jan 2026
  (`BT_AS_OF_DROP_CREATED_AFTER`) are dropped so a renewal signed during 2026 cannot make a contract look live on 1 Jan.
- Dormant programs (`EXCLUDE_UNBOOKED_PROGRAMS`, `DORMANT_PROGRAM_ACTION`): a FIRST-TIME OTC cohort (no cohort code) in a program (the OTC `program` field, e.g. NCLEX RN / NCLEX PN)
  with no booking at that account in the baseline year is flagged, set At Risk and weighted down (`DORMANT_PROGRAM_WEIGHT`, placeholder 25%) so a CSM decides; set
  the action to `zero` to make it Not Expected. A coded cohort is an existing class and is never dormant. (older behavior note:) an OTC cohort for a program (account + product group + RN/PN/Step family) with no booking in the
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

## Simplified vocabulary (for CSMs)
Three short dropdowns replace the 2026 Outreach Status x Forecast Category grid:
- **Forecast Category** (5): Captured, Expected, At Risk, Pending Contract, Not Expected.
- **Not Expected Reason** (5, only for Not Expected): Lost, No Revenue This Term, Non-Recurring, Adjustment, Data Error.
- **Roster Stage** (5): Not started, In progress, Received - held, Submitted, Not needed.
Early / On time / Late is calculated (`Timing vs Baseline`), not picked. The engine pre-fills all of it; CSMs only change what is wrong,
in the yellow cells of the **CSM Forecast** tab (dropdowns). The weighted forecast follows the category.

## Cohort sizing for cohorts with no baseline (`ENROLLMENT_BASIS` = "actual")
OTC estimates are what the rep expected at signing; actual enrollment moves through the term. A cohort with no Tableau baseline line is sized
from the same cohort's (same account + cohort_name) most recent actual enrollment x the upcoming price, else the account's actual-vs-estimate history.

## Predicted additional cohorts (`EXTRA_COHORTS`)
For each Tableau baseline row the engine counts the cohorts (booked OTC orders) that made it up last year and the OTC cohorts now expected in the same
window. If there are more now (e.g. 4 last year, 5 predicted), the extra cohort(s) add value on top of the baseline: each is valued at last year's average
cohort value (baseline / last year's count, never above the extra cohort's own OTC estimate), source `OTC`, category `EXTRA_COHORT_CATEGORY` (At Risk) weighted `EXTRA_COHORT_WEIGHT` (25%, from the backtest: predicted extras realized about a quarter of their value) until it books. $0 placeholder rosters are not counted as cohorts. The first-time (roster chasing)
cohorts are chosen as the extras. The baseline itself is not diluted: the other cohorts still add up to the Tableau baseline. Not applied to gray/black accounts.

The Review tab shows a **Weight basis** table (rows, full value, weighted $ by segment) and the Forecast tab a **Weight Basis** column, so you can see why a line is weighted the way it is.

## Summary page: predicted retention by model (`RETENTION_MODELS`)
The Review tab shows, for each model, predicted retention = forecast / Tableau baseline: repeat-the-baseline (100%), OTC amounts + trend, OTC capped at Tableau,
the current Tableau-anchored model, and the current model without additional cohorts. Columns: gross (lines tied to a baseline row) at full value and weighted,
net weighted (adds new/additional OTC cohorts), and confirmed-only (Captured + Expected). Below it, actual retention history from the raw Tableau crosstab
(tab name starting `Flex Hierarchy Crosstab`: account, product group, product, booking type, CSM, month, sales incl. negative adjustments): gross $ (renewals only),
net $ and logo retention per year pair (the current year is compared on the same months of both years), plus the 2026 team forecast as recorded.

## CSM Forecast, overrides and manual add-ons (survive refreshes)
- **CSM Forecast** is the one tab CSMs work in: filter the CSM column, review the row, and **type over the yellow cells** where it is wrong:
  Forecast Month, Forecast $, Forecast Category, Not Expected Reason, Roster Stage, plus a Comment. Calculated columns (baseline, weighted $,
  everything to the right) have a warning-only protection. A cell that differs from the calculated value turns orange; putting the old value back clears it.
- The visible cells are compared with hidden `Calc:` columns (the engine's value before any CSM change). The change is **saved the moment it is typed**
  (`onEdit` writes it to the **Overrides** tab; `Saved?` shows the time) and **applied at the next Build / refresh** (Weighted $ moves then).
  The Overrides tab is just the store. `Why (flags)` and the cohort detail sit at the far right so the editable cells stay on one laptop screen.
- Override keys are `Full ID | Org ID | product group | month | status | #n`, so a data refresh does not orphan a change unless the
  line itself disappears; those show `Not applied` on the CSM tab and `NOT FOUND` on the Overrides tab (also counted on the Review tab).
- **Manual Add-Ons**: one row per line the data does not know about (new sale, one-off). Needs Full ID or Student Org ID, Product Group,
  Forecast Month (in the forecast year) and Amount. The `Status` column says `Added` / `NOT ADDED: reason` after each refresh.
  Manual lines are never merged with data lines and appear with Source `Manual Add`.
- **Read Me** is regenerated from the config on every build (weights shown there come from `WEIGHTS`).
- The old "Add override for selected Forecast row" menu item and its `Exclude` column are gone; an old Overrides tab is upgraded in
  place (rows kept, `Exclude` -> Not Expected).

## Med / Allied Health / iHP: one line per product group
`COMBINE_GROUPS` (MED COURSE, ALLIED HEALTH COURSE, IHUMAN; separate from the flat-fee list `FLAT_FEE_GROUPS`, which iHP is not in) are booked per product group, so all products and categories of the group in a month are **one line**
per account x month (each group separately; Med, Allied and iHP are never merged with each other). The line is named by the category carrying the most dollars, the weight is the blend of its
parts (the weighted total is unchanged) and a flag lists the combined categories. `Forecast Detail` still has one row per product. Line keys for these groups change once.

## New / dormant programs start at $0
`DORMANT_PROGRAM_ACTION = "zero"` (default): a first-time OTC cohort (no cohort code) for an account + program (family) with no booking in the baseline
year (never, or last booked earlier, e.g. 2024) is `Not Expected`, reason `No Revenue This Term`, **$0**, with the OTC value kept in `Value If Booked`
and in the Why text. Typing a positive amount in `Forecast $` on such a line counts it as `Expected` at the next refresh (pick At Risk to weight it).
Programs that book every two years or prepay are the exception: CSMs add the amount by typing it in. Coded cohorts (existing classes) are never dormant.
`"weight"` restores the old behaviour (At Risk at `DORMANT_PROGRAM_WEIGHT`).

## Active iHP accounts (`iHP Active Accounts` tab)
Paste the maintained iHP account list (main tab of the iHP Account Database, with its header row; needs at least `Account`) into `iHP Active Accounts`.
Lines match on, in any order: the Business Org ID / Student Org ID columns if present; the **Salesforce ID inside the link behind the account name** (read from the cell's
hyperlink, so paste with formatting / copy the tab rather than pasting values only); or the **account name**, compared ignoring case, punctuation and `&` vs `and`. Once it has rows, any `IHP_ACTIVE_GROUPS` (IHUMAN) line, baseline-driven or OTC-only, whose Full ID /
Student Org ID / account name is not on the list is dropped completely (not forecast, not shown). Other product groups of the same account, Manual Add-Ons
and carry-ins are untouched. The Review tab shows how many lines and baseline $ were ignored and the ten largest accounts; the baseline check subtracts them.
The Review tab also lists list accounts that matched nothing in the data (name/ID mismatch). Empty tab = no filtering. The source database's `Lost 2024-2026` and `SP27 Renewal List` tabs are not used (names only / prospects).

## Combining accounts (`Account Merges` tab)
One row per duplicate: `From ID` (the extra Billing ID / Full ID) and `Into ID` (the main account); either can be a Full ID or a Student Org ID.
At the start of every refresh, every input (Tableau, Adjustments, OTC, Manual Add-Ons, the Nov/Dec tab) has the From ID rewritten to the Into account's
IDs, name, CSM and rating, so baseline rows, OTC cohorts and overrides behave as one account and lines group together. Chains are followed.
The `Status` column says `Applied: N rows ...` or `NOT APPLIED: reason` (ID not found, same account, ...). Merges do not edit the source tabs.

## Link to the current 2026 Nov/Dec forecast
Paste the current 2026 forecast (same columns as the 2026 forecast file) into the tab `FY26Nov_DecForecast` (`SHEETS.CARRY`); the tab is optional.
- **Booked early** (`EARLY_BOOKED_TREATMENT = "prior_year"`): while "now" is before 2027, a 2027 cohort whose OTC order is already booked is a
  2026 booking (the 2026 forecast counts it as Captured). It stays on its baseline row (the baseline month is still in 2027) with forecast $0,
  Not Expected, reason `Booked in 2026`; a booked cohort with **no baseline row** (OTC-only) has no slot to hold, so it is **not a line at all** - it is only counted in the booked-early totals and the monthly coverage; the Review tab shows how many lines / dollars moved, per month, in the Month coverage table (`Booked early in 2026 $`, with a Total row), and every line carries `Booked Early (counted in prior year) $` on the Forecast / Forecast Detail tabs and at the right of the CSM tab - ready for dashboard reporting. The rule switches itself off once the year starts.
  Set `"keep"` to count them in 2027 instead.
- **Pushed out**: open 2026 lines whose Forecast Month has been moved into 2027 on that tab are carried in (source `2026 Carry-In`, category mapped
  Expected / At Risk / Pending Contract). If the same account + product group already has an OTC-only unconfirmed line within the match window, the pushed
  line replaces it (no double count); if a baseline-driven line sits nearby the new line is flagged `CHECK`.
- **Still dated Nov/Dec and open**: not counted unless `CARRY_OPEN_SLIP_RATE` > 0 (share assumed to slip into `CARRY_OPEN_SLIP_MONTH`); the Review tab shows the open value so the rate can be chosen.

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
