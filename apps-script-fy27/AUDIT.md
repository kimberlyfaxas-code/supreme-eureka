# FY27 forecast build: assumption audit (2026-11-22)

Every assumption the engine makes, checked against the live sheets and the two background documents
(Forecast Outreach Status Cheat Sheet; SF Forecast Fields wishlist).

## Verified against data
| Assumption | Evidence |
|---|---|
| Column names the code reads exist (Tableau, OTC, Salesforce, 2026 Beginning/Final reference, 2024 Actuals) | compared with the header rows of each tab |
| OTC `order_status` values | Complete 11,214; Roster 5,635; Invoicing 382; AR Review 90; Controller 21; Booking 1 (17,343 rows) |
| Roster = upcoming estimate, no actual start | only 5 of 5,635 Roster rows have an actual start date |
| Tableau Rating values | Green, Yellow, Red, Black, Gray, blank |
| Cohort code absent ~ first booking | Roster rows starting in 2027: billing period 1 = 734 without code / 14 with code |
| Gray/black definitions | Forecast Goals tab (gray: only rebookings; black: no value) and your later teach-out clarification |

## Corrected during this audit
1. **OTC statuses.** The engine only treated Complete/Completed/Invoiced/Booked as booked. 494 orders in Invoicing (382), AR Review (90),
   Controller (21) and Booking (1) all have actual start dates and final enrollment, so they are booked. They were being forecast as
   if unbooked, which also hid them from the "booked in the baseline year" tests (dormant program, derived adjustments, history).
   Fixed: any non-Roster status with an actual start counts as booked.
2. **"Renewal Pending" is an Outreach Status in the 2026 sheet, not a Forecast Category.** Renamed the category `Pending Contract`; simplified vocabulary adopted (item A, decided).
3. `cohort_dne_flag` is FALSE on all 17,343 OTC rows, so that exclusion never fires (harmless, kept).
4. Tableau `Adjustment (true/false)` is blank on every row, so only derived/likely adjustments are found; the explicit-flag path is idle.
5. Tableau `Next Booking Type` is "Renewal" on every row, so the old credit logic read from it carried no information (credit is switched off anyway).

## Open items that need your decision
A. **Vocabulary (DECIDED: simplify).** 2026 used two fields: Outreach Status (17 values, CSM workflow) and Forecast Category (9 values with Early/On time/Late).
   The cheat sheet and the 2026 data also disagree on names ("Not expected (Loss)" vs "Not expected (Lost Account)"; outreach
   "Lost (Active Client - No Rev this Term)" / "Lost (Client has Dropped)" vs "Lost (No Booking Expected)" in the data).
B. **Rebooking definition (DECIDED: cohort code).** Tested with cohort_name: 332 of 337 period-2+/no-code rows belong to a cohort whose period 1 has not booked. Header says code present = rebooking; Forecast Goals say billing period 1 = first booking. 337 of the 2,407 Roster rows
   starting in 2027 have period 2+ but no code. `REBOOKING_BASIS` ("code" default | "period") switches it.
C. **Cohort size (DECIDED: from actuals).** See README. Earlier note: trend adjustment (Forecast Goals: use cohort-size history) is off by default since `AMOUNT_BASIS` = "baseline"; the backtest showed it did worse than repeating Tableau.
D. **Weights** are calibrated on one backtest year; treat as starting values.
