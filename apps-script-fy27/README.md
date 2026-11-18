# FY2027 forecast build (Apps Script)

Separate from `../apps-script/` (the FY2026 dashboard tooling, left untouched).

## Install (in the FY2027 sheet: Extensions > Apps Script)
Add three script files with the contents of: `FY27Config.gs`, `FY27Engine.gs`, `FY27Build.gs`.
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
`Forecast` tab, one row per forecast line (account x product x cohort/month), with the same account
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
- Rating: Gray drops roster-chasing lines (rebookings only); Black zeroes the client (Value If Booked is kept).
- Positive adjustments are tagged Not Expected.
- Cohort-size trend: estimate x (history final/estimate) when >= 2 completed orders and the gap is >= 10%.
- Credit: first 12 months after a cohort's first booking = New, afterwards Renewal; never-booked cohorts = New.
- Flags: contract covers the year but no upcoming cohort (CE Hub case), contract ended/expiring before the
  forecast month, no OTC data, not in Tableau, baseline month still incomplete, cohort after contract end.

## Overrides (survive refreshes)
Select a row on `Forecast`, run **Add override for selected Forecast row**, then set Override Amount /
Override Month / Exclude on `Forecast Overrides`. Overrides are keyed on `Line Key`.

## Tests
`node apps-script-fy27/test/engine.test.js` (pure engine, synthetic fixtures mirroring the Forecast Goals examples).

## Not built yet
Dynamic dashboards (next step: formula-driven views over the `Forecast` tab).
