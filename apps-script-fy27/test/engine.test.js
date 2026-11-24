// Run: node apps-script-fy27/test/engine.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
// load the .gs files as plain JS (Apps Script and Node share enough syntax)
const cfgSrc = fs.readFileSync(path.join(__dirname, "../FY27Config.gs"), "utf8");
const engSrc = fs.readFileSync(path.join(__dirname, "../FY27Engine.gs"), "utf8");
const E = (function () { const module = { exports: {} }; new Function("module", engSrc)(module); return module.exports; })();
const CFG = new Function(cfgSrc + "; return FY27_CFG;")();
CFG.TAG_CREDIT = true;
CFG.AMOUNT_BASIS = "otc";   // legacy amount tests; "min" / "baseline" are tested in 37-38
CFG.USE_ADJUSTMENTS_TAB = true;   // engine tests feed the Adjustments tab in explicitly   // credit logic is tested with the switch on; see test 22 for off
CFG.ACTUALS_THROUGH = "2026-11";
CFG.DORMANT_PROGRAM_ACTION = "weight";   // legacy tests; the shipped default is "zero" (test 61)
CFG.EARLY_BOOKED_TREATMENT = "keep";   // legacy tests count booked cohorts as Captured; see tests 55-57 for the prior-year rule

const tab = (o) => Object.assign({
  "Account Name with Billing ID": "", "Billing ID": "001X", "Account Name": "", "Sales Rep": "", "Customer Type": "Institutional",
  "FULL ID": "", "Rating": "Green", "Client Category": "Nursing", "Client Sub-Category": "RN", "Billing State/Province": "CO",
  "Account Owner": "Owner", "Client Success Manager": "CSM", "Parent Account": "", "Billing Country": "US", "Parent Account ID": "",
  "Account Record Type": "Buying Center", "Product Group": "NURSING COURSE", "Product Name": "NCLEX RN - Curriculum Plus",
  "Forecast Source": "System Forecast", "Prior Booking Type": "Renewal", "Next Booking Type": "Renewal", "Adjustment (true/false)": "",
  "Baseline Booking Month - Tableau": "2/1/2026", "booking_id": "", "Contract ID": "", "Forecast Month - Tableau": "2/1/2027",
  "Baseline Amount - Tableau": "1000"
}, o);
const otc = (o) => Object.assign({
  "Full ID": "", "Account Name": "", "Contract ID": "C1", "Contract Start Date": "2025-01-01", "Contract End Date": "2028-01-01",
  "cohort_name": "RN Feb", "Cohort Code (if present, then this is a rebooking)": "", "cohort_dne_flag": "FALSE",
  "order_estimated_start_date": "2027-02-01", "order_actual_start_date": "", "Estimated # of Students": "10",
  "order_enrollment_final": "", "Price Per Student": "100", "Estimated or Actual Order Total": "1000", "order_status": "Roster",
  "Product Name": "RN Complete", "Product Group": "NURSING COURSE", "booking_id": ""
}, o);

const run = (t, o, sf, ov, adj) => E.FY27_buildForecast({ tableau: t, otc: o, salesforce: sf || [], overrides: ov || [], adjustments: adj || [], now: new Date(2026, 10, 18) }, CFG);

// 1. Rebooking: baseline matches OTC cohort with code -> OTC amount, Rebooking, Renewal credit
{
  const A = "0014u000025P6kx";
  const r = run(
    [tab({ "FULL ID": A + "AAC", "Account Name": "Aims" })],
    [
      otc({ "Full ID": A + "AAC", "Cohort Code (if present, then this is a rebooking)": "RC1", "Estimated or Actual Order Total": "1200", "Estimated # of Students": "12" }),
      // history: first booked 2024-02 => 2027-02 is well past 12 months -> Renewal
      otc({ "Full ID": A + "AAC", "Cohort Code (if present, then this is a rebooking)": "RC1", "order_status": "Complete", "order_actual_start_date": "2024-02-01", "order_estimated_start_date": "2024-02-01", "Estimated # of Students": "10", "order_enrollment_final": "10" })
    ]);
  assert.strictEqual(r.lines.length, 1);
  const L = r.lines[0];
  assert.strictEqual(L.bookingType, "Rebooking");
  assert.strictEqual(L.forecastAmount, 1200);
  assert.strictEqual(L.baselineAmount, 1000);
  assert.strictEqual(L.credit, "Renewal");
  assert.strictEqual(L.status, "Forecast");
}

// 2. Gray/black: OTC roster-chasing cohorts are ignored (OTC may not know about teach-outs / dropped accounts)
{
  const mk = (rating) => run(
    [tab({ "FULL ID": "0014u000025P7Y7AAK", "Rating": rating })],
    [otc({ "Full ID": "0014u000025P7Y7AAK" })]);
  assert.strictEqual(mk("Green").lines[0].bookingType, "Roster Chasing");
  assert.strictEqual(mk("Green").lines[0].credit, "Renewal");   // Tableau col U says Renewal
  assert.strictEqual(mk("Green").lines[0].forecastAmount, 1000);
  // gray: the roster-chasing cohort is dropped; the baseline repeats as an assumed rebooking
  const g = mk("Gray");
  assert.strictEqual(g.lines.length, 1);
  assert.strictEqual(g.lines[0].bookingType, "Rebooking (assumed)");
  assert.strictEqual(g.lines[0].forecastAmount, 1000);
  assert.strictEqual(g.stats.ignoredRosterChasing.cohorts, 1);
  // black: no OTC-backed rebooking exists, so nothing is forecast (value kept)
  const b = mk("Black");
  assert.strictEqual(b.lines[0].forecastAmount, 0);
  assert.strictEqual(b.lines[0].expectation, "Not Expected");
  assert.strictEqual(b.lines[0].valueIfBooked, 1000);
  assert.ok(b.lines[0].flags.some((f) => /teach-out/.test(f)));
}

// 2b. The rating comes from the Tableau tab only: a Gray/Black rating in Salesforce does not restrict a Green Tableau account
{
  const F = "0014u000025SFRATING";
  const r = run([tab({ "FULL ID": F, "Rating": "Green" })], [otc({ "Full ID": F })],
    [{ "FULL ID": F, "Rating": "Black", "Student Org Id": "001X" }]);
  assert.strictEqual(r.stats.ignoredRosterChasing.cohorts, 0);
  assert.strictEqual(r.lines[0].forecastAmount, 1000);
  assert.strictEqual(r.lines[0].rating, "Green");
}

// 3. Gray AND black still forecast OTC rebookings (existing cohorts with a code finishing their term)
{
  ["Gray", "Black"].forEach((rating) => {
    const r = run(
      [tab({ "FULL ID": "0014u000025P7Y7AAK", "Rating": rating })],
      [otc({ "Full ID": "0014u000025P7Y7AAK", "Cohort Code (if present, then this is a rebooking)": "X" })]);
    assert.strictEqual(r.lines[0].forecastAmount, 1000, rating);
    assert.strictEqual(r.lines[0].bookingType, "Rebooking", rating);
    assert.strictEqual(r.lines[0].expectation, "Expected", rating);
  });
}

// 4. CE Hub: contract covers 2027 but no upcoming cohort -> baseline line + High flag
{
  const r = run(
    [tab({ "FULL ID": "001Pl00001R9jPG" })],
    [otc({ "Full ID": "001Pl00001R9jPG", "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01" })]);
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].forecastSource, "Tableau");
  assert.ok(r.lines[0].flags.some((f) => /no upcoming cohort/.test(f)));
  assert.strictEqual(r.lines[0].forecastAmount, 1000);
}

// 5. Expired contract -> needs renewal
{
  const r = run(
    [tab({ "FULL ID": "0014W00003S8JGS" })],
    [otc({ "Full ID": "0014W00003S8JGS", "Contract End Date": "2027-04-01", "order_estimated_start_date": "2026-08-01", "order_status": "Complete", "order_actual_start_date": "2026-08-01" })]);
  // contract ends 2027-04 and the forecast month is 2027-02 -> covered, but no cohort
  assert.ok(r.lines[0].flags.some((f) => /Contract covers/.test(f)), JSON.stringify(r.lines[0].flags));
  assert.ok(!r.lines[0].flags.some((f) => /needs renewal/.test(f)));
}
{
  const r = run(
    [tab({ "FULL ID": "0014W00003S8JGS", "Forecast Month - Tableau": "9/1/2027", "Baseline Booking Month - Tableau": "9/1/2026" })],
    [otc({ "Full ID": "0014W00003S8JGS", "Contract End Date": "2027-04-01", "order_estimated_start_date": "2026-08-01", "order_status": "Complete", "order_actual_start_date": "2026-08-01" })]);
  assert.strictEqual(r.lines[0].expectation, "Pending Contract");   // expired contract: status, not a review flag
  assert.ok(!r.lines[0].flags.some((f) => /renewal|contract/i.test(f)), JSON.stringify(r.lines[0].flags));
  assert.strictEqual(r.lines[0].forecastAmount, 1000);              // still counted
}

// 6. Morgan: BOS billing ID rows skip OTC matching, OTC billed row matches (same Full ID)
{
  const F = "0014u000025P67i";
  const r = run(
    [
      tab({ "FULL ID": F + "AAC", "Billing ID": "001C0000014HBhT" }),
      tab({ "FULL ID": F + "AAC", "Billing ID": "A179574", "Product Name": "Fall 2026 Admissions", "Baseline Booking Month - Tableau": "6/1/2026", "Forecast Month - Tableau": "6/1/2027", "Baseline Amount - Tableau": "500" })
    ],
    [otc({ "Full ID": F + "AAC", "order_estimated_start_date": "2027-03-01" })]);
  const bos = r.lines.find((l) => l.studentOrgId === "A179574");
  assert.strictEqual(bos.forecastSource, "Tableau");
  assert.ok(bos.flags.some((f) => /BOS/.test(f)));
  const otcLine = r.lines.find((l) => l.studentOrgId === "001C0000014HBhT");
  assert.strictEqual(otcLine.forecastSource, "Tableau");
}

// 7. Positive adjustment -> not expected
{
  const r = run([tab({ "FULL ID": "0014u000025AAAA", "Adjustment (true/false)": "TRUE", "Baseline Amount - Tableau": "250" })], []);
  assert.strictEqual(r.lines[0].expectation, "Not Expected");
  assert.strictEqual(r.lines[0].forecastAmount, 0);
  assert.strictEqual(r.lines[0].valueIfBooked, 250);
}

// 8. Account not in Tableau is left out by default, and counted
{
  const r = run([], [otc({ "Full ID": "001NEWACCT00001AA" })]);
  assert.strictEqual(r.lines.length, 0);
  assert.strictEqual(r.stats.excludedNotInTableau.accounts, 1);
  assert.strictEqual(r.stats.excludedNotInTableau.value, 1000);
}
// 8b. ...unless INCLUDE_NOT_IN_TABLEAU is on: then it is pulled from Salesforce and flagged
CFG.INCLUDE_NOT_IN_TABLEAU = true;
{
  const r = run([], [otc({ "Full ID": "001NEWACCT00001AA" })], [{ "FULL ID": "001NEWACCT00001AA", "Account Name": "New U", "Client Success Manager": "Pat", "Rating": "Green", "Student Org Id": "001ORG" }]);
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].accountName, "New U");
  assert.strictEqual(r.lines[0].csm, "Pat");
  assert.ok(r.lines[0].flags.some((f) => /Not in Tableau/.test(f)));
  assert.strictEqual(r.review[0].severity, "High");
}

CFG.INCLUDE_NOT_IN_TABLEAU = false;

// 9. Trend adjustment: history finals 20% under estimates -> 10 students become 8
{
  const F = "0014u000025TREND";
  const hist = (m, est, fin) => otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": m, "order_estimated_start_date": m, "Estimated # of Students": est, "order_enrollment_final": fin });
  const r = run([tab({ "FULL ID": F })], [hist("2025-02-01", "10", "8"), hist("2026-02-01", "10", "8"), otc({ "Full ID": F })]);
  assert.strictEqual(r.lines[0].adjStudents, 8);
  assert.strictEqual(r.lines[0].forecastAmount, 800);
}

// 10. Already-booked 2027 order -> Booked / Captured with actual amount
{
  const F = "0014u000025BOOKED";
  const r = run([tab({ "FULL ID": F })], [otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": "2027-02-01", "Estimated or Actual Order Total": "1111" })]);
  assert.strictEqual(r.lines[0].status, "Booked");
  assert.strictEqual(r.lines[0].expectation, "Captured");
  assert.strictEqual(r.lines[0].forecastAmount, 1111);
}

// 11. Incomplete baseline month flagged (Nov/Dec 2026 baseline while actuals only through Oct)
{
  const r = run([tab({ "FULL ID": "0014u000025INCOMP", "Baseline Booking Month - Tableau": "11/1/2026", "Forecast Month - Tableau": "11/1/2027" })], []);
  assert.ok(r.lines[0].flags.some((f) => /not complete yet/.test(f)));
}

// 12. Overrides survive a rebuild
{
  const F = "0014u000025OVERRIDE";
  const t = [tab({ "FULL ID": F })];
  const first = run(t, []);
  const key = first.lines[0].key;
  const second = run(t, [], [], [{ "Line Key": key, "Override Amount": "777", "Comment": "CSM call" }]);
  assert.strictEqual(second.lines[0].forecastAmount, 777);
  assert.strictEqual(second.stats.overridesApplied, 1);
}

// 13. Duplicate header names don't clobber the first column
{
  const g = E.FY27_gridToRows_([["A", "Forecast Amount", "Forecast Amount"], [1, 5, 0]]);
  assert.strictEqual(g.rows[0]["Forecast Amount"], 5);
  assert.strictEqual(g.rows[0]["Forecast Amount__2"], 0);
}

// 14. Aims-style: two cohorts in different months + baseline -> grouped by product group + month,
//     baseline sits on its own forecast month, adjustment variance flagged, credit from col U, booking_id from OTC,
//     cohort names that Sheets turned into Dates read "May 2028".
{
  const F = "0014u000025P6kx";
  const t = [tab({ "FULL ID": F, "Baseline Amount - Tableau": "9585", "Forecast Month - Tableau": "2/1/2027", "Baseline Booking Month - Tableau": "2/1/2026" })];
  const o = [
    otc({ "Full ID": F, "order_estimated_start_date": "2027-01-01", "Estimated or Actual Order Total": "5040", "Estimated # of Students": "28", "booking_id": "PO-1", "cohort_name": new Date(2028, 4, 1), "Cohort Code (if present, then this is a rebooking)": "A1" }),
    otc({ "Full ID": F, "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "2160", "Estimated # of Students": "12", "booking_id": "PO-2", "cohort_name": "May 2027 LPN to RN", "Cohort Code (if present, then this is a rebooking)": "A2" }),
    otc({ "Full ID": F, "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "1980", "Estimated # of Students": "11", "booking_id": "PO-3", "cohort_name": "Aug 2027", "Cohort Code (if present, then this is a rebooking)": "A3" }),
    // PN line with no baseline: inherits renewal credit from the account's Tableau rows
    otc({ "Full ID": F, "order_estimated_start_date": "2027-06-01", "Estimated or Actual Order Total": "1500", "Product Name": "NCLEX PN Enrichment", "cohort_name": "Aug 2027 PN" })
  ];
  const r = run(t, o);
  const rn = r.lines.filter((l) => l.productGroup === "NURSING COURSE" && l.forecastSource === "Tableau");
  assert.strictEqual(rn.length, 2, "Jan + Feb groups");
  const feb = rn.find((l) => l.forecastMonth === "2027-02");
  const jan = rn.find((l) => l.forecastMonth === "2027-01");
  assert.strictEqual(feb.forecastAmount, 4140);      // two Feb cohorts combined
  assert.strictEqual(feb.baselineAmount, 9585);      // baseline lands on its own month
  assert.strictEqual(jan.baselineAmount, 0);
  assert.strictEqual(feb.detailCount, 2);
  assert.ok(feb.bookingId.indexOf("PO-2") >= 0 && feb.bookingId.indexOf("PO-3") >= 0);
  assert.ok(jan.cohortNames === "May 2028", jan.cohortNames);
  assert.ok(feb.flags.some((f) => f.indexOf("Adjustment: baseline $9,585 vs OTC estimate $9,180 (+$405") === 0), JSON.stringify(feb.flags));
  assert.strictEqual(r.detail.length, 4);
  const sum = (a) => a.reduce((s, l) => s + l.forecastAmount, 0);
  assert.strictEqual(sum(r.lines), sum(r.detail), "grouping must not change totals");
  const pn = r.lines.find((l) => l.productName === "NCLEX PN Enrichment");
  assert.strictEqual(pn.credit, "New");   // in Tableau, but cohort has no baseline line -> new sales credit
  assert.ok(/new sales credit/.test(pn.creditBasis));
  // PN program did not book in 2026 (only RN did) and this is a first-time cohort: flagged, At Risk, weighted down (CSM decides)
  assert.strictEqual(pn.expectation, "At Risk");
  assert.strictEqual(pn.forecastAmount, 1500);
  assert.strictEqual(pn.weightedAmount, 375);
  assert.ok(pn.flags.some((f) => /No 2026 booking for this program \(PN\)/.test(f)));
  CFG.DORMANT_PROGRAM_ACTION = "zero";
  const pnz = run(t, o).lines.find((l) => l.productName === "NCLEX PN Enrichment");
  assert.strictEqual(pnz.expectation, "Not Expected"); assert.strictEqual(pnz.forecastAmount, 0); assert.strictEqual(pnz.valueIfBooked, 1500);
  CFG.DORMANT_PROGRAM_ACTION = "weight";
  // RN lines are untouched
  assert.ok(rn.every((l) => l.expectation === "Expected"));
}

// 15. Variance flag text + sign: baseline above OTC estimate
{
  const F = "0014u000025VARIANCE";
  const r = run([tab({ "FULL ID": F, "Baseline Amount - Tableau": "9585" })], [otc({ "Full ID": F, "Estimated or Actual Order Total": "9180", "order_estimated_start_date": "2027-02-01" })]);
  assert.ok(r.lines[0].flags.some((f) => f.indexOf("Adjustment: baseline $9,585 vs OTC estimate $9,180 (+$405") === 0), JSON.stringify(r.lines[0].flags));
  assert.strictEqual(r.lines[0].adjVariance, 405);
}

// 16. "Renewal" must never be read as a New type (regression: /new/ matched Re-new-al)
{
  const r = run([tab({ "FULL ID": "0014u000025REGRESS", "Next Booking Type": "Renewal", "Prior Booking Type": "New Logo" })], []);
  assert.strictEqual(r.lines[0].credit, "Renewal");
  const n = run([tab({ "FULL ID": "0014u000025REGRESS", "Next Booking Type": "New Logo" })], []);
  assert.strictEqual(n.lines[0].credit, "New");
}

CFG.INCLUDE_NOT_IN_TABLEAU = true;
// 17. Product group never in Tableau: 12-month rule from first OTC booking
{
  const F = "0014u000025NEWGRP";
  const done = otc({ "Full ID": F, "Product Group": "MED COURSE", "Product Name": "Step 1", "order_status": "Complete", "order_actual_start_date": "2026-09-01", "order_estimated_start_date": "2026-09-01" });
  const within = otc({ "Full ID": F, "Product Group": "MED COURSE", "Product Name": "Step 1", "order_estimated_start_date": "2027-03-01" });
  const after = otc({ "Full ID": F, "Product Group": "MED COURSE", "Product Name": "Step 1", "order_estimated_start_date": "2027-10-01" });
  const r = run([], [done, within, after]);
  assert.strictEqual(r.lines.find((l) => l.forecastMonth === "2027-03").credit, "New");
  assert.strictEqual(r.lines.find((l) => l.forecastMonth === "2027-10").credit, "Renewal");
  assert.ok(/12-month rule/.test(r.lines[0].creditBasis));
}

// 18. Different credit types in one group-month stay separate rows
{
  const F = "0014u000025SPLIT";
  const r = run([], [
    otc({ "Full ID": F, "Product Group": "MED COURSE", "Product Name": "Step 1", "order_status": "Complete", "order_actual_start_date": "2026-09-01", "order_estimated_start_date": "2026-09-01" }),
    otc({ "Full ID": F, "Product Group": "MED COURSE", "Product Name": "Step 1", "order_estimated_start_date": "2027-03-01" })
  ]);
  assert.strictEqual(r.lines.length, 1);
}

// 20. Aims: OTC 2026 actuals (3 cohorts starting 2026-02, $9,765) = Tableau Feb $9,585 + Mar $180
//     -> the Mar $180 is an added student, not recurring: forecast 0, flagged, value kept
{
  const F = "0014u000025AIMSADJ";
  const done = (total, students, price) => otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Estimated or Actual Order Total": String(total), "Estimated # of Students": String(students), "order_enrollment_final": String(students), "Price Per Student": String(price), "Product Name": "Curriculum Plus" });
  const t = [
    tab({ "FULL ID": F, "Baseline Amount - Tableau": "9585", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" }),
    tab({ "FULL ID": F, "Baseline Amount - Tableau": "180", "Baseline Booking Month - Tableau": "3/1/2026", "Forecast Month - Tableau": "3/1/2027" })
  ];
  const r = run(t, [done(2145, 13, 165), done(3300, 20, 165), done(4320, 24, 180)]);
  assert.strictEqual(r.stats.derivedAdjustments, 1);
  const mar = r.lines.find((l) => l.forecastMonth === "2027-03");
  assert.strictEqual(mar.forecastAmount, 0);
  assert.strictEqual(mar.valueIfBooked, 180);
  assert.strictEqual(mar.expectation, "Not Expected");
  assert.strictEqual(mar.adjustment, "TRUE");
  assert.ok(mar.flags.some((f) => /^Adjustment \(derived\): \$180 booked 2026-03/.test(f)), JSON.stringify(mar.flags));
  const feb = r.lines.find((l) => l.forecastMonth === "2027-02");
  assert.strictEqual(feb.forecastAmount, 9585);   // Feb stays recurring (baseline-only here: no 2027 cohorts yet)
}
// 20b. Amount that does NOT reconcile with OTC stays a normal recurring booking
{
  const F = "0014u000025NOADJ";
  const done = otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Estimated or Actual Order Total": "9765" });
  const r = run([
    tab({ "FULL ID": F, "Baseline Amount - Tableau": "9585", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" }),
    tab({ "FULL ID": F, "Baseline Amount - Tableau": "200", "Baseline Booking Month - Tableau": "3/1/2026", "Forecast Month - Tableau": "3/1/2027" })
  ], [done]);
  assert.strictEqual(r.stats.derivedAdjustments, 0);
  assert.strictEqual(r.lines.find((l) => l.forecastMonth === "2027-03").forecastAmount, 200);
}

// 19a. In-Tableau account, extra cohort in an ACTIVE program with no baseline line -> included, New credit
{
  const F = "0014u000025EXTRA";
  const r = run(
    [tab({ "FULL ID": F, "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" })],
    [otc({ "Full ID": F, "order_estimated_start_date": "2027-02-01" }),
     otc({ "Full ID": F, "order_estimated_start_date": "2027-09-01", "Estimated or Actual Order Total": "800" })]);
  const sep = r.lines.find((l) => l.forecastMonth === "2027-09");
  assert.strictEqual(sep.forecastAmount, 800);
  assert.strictEqual(sep.expectation, "Expected");
  assert.strictEqual(sep.credit, "New");
  assert.strictEqual(r.lines.find((l) => l.forecastMonth === "2027-02").credit, "Renewal");
}

// 19. Program booked last year (Tableau PN baseline) and has an OTC PN cohort -> still forecast;
//     separate months stay separate rows
{
  const F = "0014u000025PNACTIVE";
  const r = run(
    [tab({ "FULL ID": F, "Product Name": "NCLEX PN Prep", "Baseline Booking Month - Tableau": "5/1/2026", "Forecast Month - Tableau": "5/1/2027" })],
    [otc({ "Full ID": F, "Product Name": "NCLEX PN Enrichment", "order_estimated_start_date": "2027-05-01" }),
     otc({ "Full ID": F, "Product Name": "NCLEX PN Enrichment", "order_estimated_start_date": "2027-08-01", "Estimated or Actual Order Total": "700" })]);
  const may = r.lines.find((l) => l.forecastMonth === "2027-05");
  assert.strictEqual(may.expectation, "Expected");
  assert.ok(r.lines.length >= 1);
}
CFG.INCLUDE_NOT_IN_TABLEAU = false;

// 21. OTC "Curriculum Plus" with program NCLEX RN counts as RN, so a PN cohort is NOT covered by RN bookings
{
  const F = "0014u000025PROGFAM";
  const r = run(
    [tab({ "FULL ID": F, "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" })],
    [otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Product Name": "Curriculum Plus", "program": "NCLEX RN" }),
     otc({ "Full ID": F, "order_estimated_start_date": "2027-08-01", "Product Name": "NCLEX PN Enrichment/Inst 4 Month", "program": "NCLEX PN", "cohort_name": "Aug 2027 PN" })]);
  const pn = r.lines.find((l) => l.forecastMonth === "2027-08");
  assert.strictEqual(pn.expectation, "At Risk");        // flagged and weighted down, not zeroed
  assert.strictEqual(pn.weight, 0.25);
  assert.strictEqual(pn.forecastAmount, 1000);
}
// 22. Credit off: no credit values, and rows are not split by it
{
  CFG.TAG_CREDIT = false;
  const F = "0014u000025NOCREDIT";
  const r = run([tab({ "FULL ID": F })], [otc({ "Full ID": F })]);
  assert.strictEqual(r.lines[0].credit, "");
  assert.strictEqual(r.lines[0].creditBasis, "");
  CFG.TAG_CREDIT = true;
}
// 23. Forecast Source: Tableau when a baseline line exists, OTC only for cohorts with no baseline line
{
  const F = "0014u000025SRC";
  const r = run([tab({ "FULL ID": F })], [
    otc({ "Full ID": F, "order_estimated_start_date": "2027-02-01" }),
    otc({ "Full ID": F, "order_estimated_start_date": "2027-09-01", "Estimated or Actual Order Total": "800" })]);
  assert.strictEqual(r.lines.find((l) => l.forecastMonth === "2027-02").forecastSource, "Tableau");
  assert.strictEqual(r.lines.find((l) => l.forecastMonth === "2027-09").forecastSource, "OTC");
  assert.ok(r.lines.every((l) => ["Tableau", "OTC", "Manual Add On"].indexOf(l.forecastSource) >= 0));
}
// 24. Negative adjustments (Adjustments tab, "June 2026" text months): baseline kept, forecast 0.
//     Baseline in forecast == Tableau tab + Adjustments tab.
{
  const F = "0014u000025NEGADJ";
  const adjRow = { "Account Name with Student Org": "X", "Student Org ID": "001Z", "Account Name": "X", "FULL ID": F, "Rating": "Green",
    "Booking Month": "June 2026", "Baseline Month": "June 2027", "Baseline Amount": "-195", "Sales Type": "New Logo",
    "Product Group": "NURSING COURSE", "Product Name": "PN Prep Select", "Forecast Line Type": "Adjustment", __row: 2 };
  const t = [tab({ "FULL ID": F, "Baseline Amount - Tableau": "1000", "Baseline Booking Month - Tableau": "6/1/2026", "Forecast Month - Tableau": "6/1/2027" })];
  const r = run(t, [], [], [], [adjRow]);
  const neg = r.lines.find((l) => l.baselineAmount === -195);
  assert.ok(neg, "adjustment row present");
  assert.strictEqual(neg.forecastMonth, "2027-06");
  assert.strictEqual(neg.forecastAmount, 0);
  assert.strictEqual(neg.expectation, "Not Expected");
  assert.strictEqual(neg.adjustment, "TRUE");
  assert.ok(neg.flags.some((f) => /Negative adjustment \(Adjustments tab\)/.test(f)));
  assert.strictEqual(r.stats.baseline.tableau, 1000);
  assert.strictEqual(r.stats.baseline.adjustmentsTab, -195);
  assert.strictEqual(r.stats.baseline.inForecast, 805);
  assert.strictEqual(r.stats.baseline.difference, 0);
  // total forecast excludes the adjustment
  assert.strictEqual(r.stats.total, 1000);
}
// 24b. A negative amount sitting in the Tableau tab itself is treated as a negative adjustment too
{
  const F = "0014u000025NEGTAB";
  const r = run([tab({ "FULL ID": F, "Baseline Amount - Tableau": "-500" })], []);
  assert.strictEqual(r.lines[0].forecastAmount, 0);
  assert.strictEqual(r.lines[0].baselineAmount, -500);
  assert.strictEqual(r.stats.total, 0);
}
// 25. Baseline check reports baseline that falls outside the forecast year
{
  const F = "0014u000025OUTSIDE";
  const r = run([tab({ "FULL ID": F, "Baseline Amount - Tableau": "700", "Baseline Booking Month - Tableau": "5/1/2025", "Forecast Month - Tableau": "5/1/2026" })], []);
  assert.strictEqual(r.stats.baseline.tableau, 700);
  assert.strictEqual(r.stats.baseline.inForecast, 0);
  assert.strictEqual(r.stats.baseline.difference, 700);
}
// 26. Month text parsing
{
  assert.strictEqual(E.FY27_monthKey_("June 2026"), "2026-06");
  assert.strictEqual(E.FY27_monthKey_("Sep 2027"), "2027-09");
  assert.strictEqual(E.FY27_monthKey_("May 2028 LPN to RN"), "");
}
CFG.ADJUSTMENT_MAX_ABS = 2000;
// 27. Lines over the cap are real bookings, not derived adjustments
{
  const F = "0014u000025BIGLINE";
  const done = (total) => otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Estimated or Actual Order Total": String(total) });
  const r = run([
    tab({ "FULL ID": F, "Baseline Amount - Tableau": "9000", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" }),
    tab({ "FULL ID": F, "Baseline Amount - Tableau": "2500", "Baseline Booking Month - Tableau": "3/1/2026", "Forecast Month - Tableau": "3/1/2027" })
  ], [done(11500)]);
  assert.strictEqual(r.stats.derivedAdjustments, 0);                 // $2,500 > $2,000 cap
  assert.strictEqual(r.lines.find((l) => l.forecastMonth === "2027-03").forecastAmount, 2500);
}
// 28. Large negative: still forecast 0 but flagged LARGE
{
  const r = run([tab({ "FULL ID": "0014u000025BIGNEG", "Baseline Amount - Tableau": "-7605" })], []);
  assert.strictEqual(r.lines[0].forecastAmount, 0);
  assert.ok(r.lines[0].flags.some((f) => /LARGE/.test(f)));
}
CFG.ADJUSTMENT_MAX_ABS = 0;

// 29. Negative of any size is an adjustment, no LARGE note when the cap is off
{
  const r = run([tab({ "FULL ID": "0014u000025NEGBIG2", "Baseline Amount - Tableau": "-7605" })], []);
  assert.strictEqual(r.lines[0].forecastAmount, 0);
  assert.ok(!r.lines[0].flags.some((f) => /LARGE/.test(f)));
}
// 30. Likely positive adjustment: much smaller than the product's usual bookings, in a non-booking month
{
  const F = "0014u000025LIKELY";
  const row = (month, amt, fc) => tab({ "FULL ID": F, "Baseline Amount - Tableau": String(amt), "Baseline Booking Month - Tableau": month, "Forecast Month - Tableau": fc });
  const r = run([row("2/1/2026", 9000, "2/1/2027"), row("8/1/2026", 11000, "8/1/2027"), row("5/1/2026", 10000, "5/1/2027"), row("3/1/2026", 300, "3/1/2027")], []);
  assert.strictEqual(r.stats.likelyAdjustments, 1);
  const mar = r.lines.find((l) => l.forecastMonth === "2027-03");
  assert.strictEqual(mar.forecastAmount, 0);
  assert.strictEqual(mar.adjustment, "TRUE");
  assert.ok(mar.flags.some((f) => /^Adjustment \(likely\): \$300/.test(f)));
  assert.strictEqual(r.lines.find((l) => l.forecastMonth === "2027-02").forecastAmount, 9000);
}
// 30b. Small line IN a normal booking month is a real booking, not flagged
{
  const F = "0014u000025NORMALM";
  const row = (month, amt, fc) => tab({ "FULL ID": F, "Baseline Amount - Tableau": String(amt), "Baseline Booking Month - Tableau": month, "Forecast Month - Tableau": fc });
  const r = run([row("2/1/2026", 9000, "2/1/2027"), row("8/1/2026", 11000, "8/1/2027"), row("5/1/2026", 10000, "5/1/2027"), row("8/1/2026", 300, "8/1/2027")], []);
  assert.strictEqual(r.stats.likelyAdjustments, 0);
}
// 30c. Not enough other bookings to compare with -> not flagged
{
  const F = "0014u000025FEWOTH";
  const row = (month, amt, fc) => tab({ "FULL ID": F, "Baseline Amount - Tableau": String(amt), "Baseline Booking Month - Tableau": month, "Forecast Month - Tableau": fc });
  const r = run([row("2/1/2026", 9000, "2/1/2027"), row("3/1/2026", 300, "3/1/2027")], []);
  assert.strictEqual(r.stats.likelyAdjustments, 0);
}
// 31. Pending contract: no OTC contract at all for a non-BOS account -> Pending Contract, no flags
{
  const r = run([tab({ "FULL ID": "0014u000025PENDING" })], [otc({ "Full ID": "0014u000025OTHERACCT" })]);
  assert.strictEqual(r.lines[0].expectation, "Pending Contract");
  assert.strictEqual(r.lines[0].flags.length, 0);
  assert.strictEqual(r.lines[0].forecastAmount, 1000);
  assert.strictEqual(r.review.length, 0);
}
// 32. Backtest: engine zeroes a small off-month line (adjustment) and the team also zeroed it -> agree;
//     a line the engine keeps but the team zeroed shows up as a disagreement
{
  const btSrc = fs.readFileSync(path.join(__dirname, "../FY27Backtest.gs"), "utf8");
  const BT = new Function(engSrc + "\n" + btSrc + "\nreturn { FY27_backtest_, FY27_rollup_ };")();
  assert.strictEqual(BT.FY27_rollup_("Captured - On Time"), "Captured");
  assert.strictEqual(BT.FY27_rollup_("Not expected (Active Client - ...)"), "Not Expected");
  assert.strictEqual(BT.FY27_rollup_("Pending Contract"), "Expected");
  const ORG = "001ORGAAAAAAAAA1";
  const beg = (m, amt) => ({ "Student Org ID": ORG, "Forecast Source": "System Forecast", "Forecast Line Type": "Forecast", "Health Rating": "Green",
    "Account Name": "Acct", "Product Group": "NURSING COURSE", "Baseline Month": m, "Baseline Amount": "$" + amt, "Starting Forecast Amount": "$" + amt });
  const fin = (m, base, fc, cat) => ({ "Student Org ID": ORG, "Forecast Line Type": "Forecast", "Account Name": "Acct", "Product Group": "NURSING COURSE",
    "Baseline Month": m, "Baseline Amount": String(base), "Forecast Amount": String(fc), "Forecast Category": cat, "Latest Comment": "c" });
  const r = BT.FY27_backtest_({
    beginning: [beg("Feb-26", 9000), beg("Mar-26", 300), beg("May-26", 10000), beg("Aug-26", 11000), beg("Jun-26", 5000)],
    final: [fin("2/1/2026", 9000, 9000, "Captured - On Time"), fin("3/1/2026", 300, 0, "Not expected (Active Client)"),
            fin("5/1/2026", 10000, 10000, "Captured - Early"), fin("8/1/2026", 11000, 11000, "Expected"),
            fin("6/1/2026", 5000, 0, "Not expected (Active Client)")],
    salesforce: [{ "Student Org Id": ORG, "FULL ID": "0014u000025SFFULL01" }], otc: [],
    actuals: [{ "Account Name with Student Org": "Acct (" + ORG + ")", "Product Group": "NURSING COURSE", "Booking Month": "Feb-24", "Metric value Sales": "8000" }]
  }, CFG);
  assert.strictEqual(r.all.length, 5);
  const feb = r.all.find((a) => a.month === "2026-02");
  assert.strictEqual(feb.booked2024SameMonth, "Y");
  assert.strictEqual(r.all.find((a) => a.month === "2026-05").booked2024SameMonth, "N");
  assert.strictEqual(feb.source, "Baseline only");
  assert.strictEqual(r.compared, 5);
  assert.strictEqual(r.cross["Zero|Zero"].n, 1);              // the $300 adjustment
  assert.strictEqual(r.cross["Full|Full"].n, 3);
  assert.strictEqual(r.cross["Full|Zero"].n, 1);              // $5,000 June: engine kept it, team zeroed it
  assert.strictEqual(r.detail.length, 1);
  assert.strictEqual(r.detail[0].teamBand, "Zero");
  assert.strictEqual(r.reasons["Adjustment (likely, small line)"].teamZero, 1);
  // as-of: an order booked in 2026 is only an estimate (students x price) and its brand-new cohort code is removed
  const asOf = BT.FY27_backtest_({
    beginning: [beg("Feb-26", 9000)], final: [fin("2/1/2026", 9000, 9000, "Captured - On Time")],
    salesforce: [{ "Student Org Id": ORG, "FULL ID": "0014u000025SFFULL01" }],
    otc: [{ "Full ID": "0014u000025SFFULL01", "Product Group": "NURSING COURSE", "Product Name": "Curriculum Plus", "order_status": "Complete",
      "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Estimated # of Students": "40", "order_enrollment_final": "90",
      "Price Per Student": "200", "Estimated or Actual Order Total": "18000", "Cohort Code (if present, then this is a rebooking)": "NEWCODE", "Contract End Date": "2028-01-01" }]
  }, Object.assign({}, CFG, { BT_AS_OF: true, AMOUNT_BASIS: "otc" }));
  assert.strictEqual(asOf.all[0].otcEst, 8000);                        // 40 x $200, not the $18,000 actual
  const raw = BT.FY27_backtest_({
    beginning: [beg("Feb-26", 9000)], final: [fin("2/1/2026", 9000, 9000, "Captured - On Time")],
    salesforce: [{ "Student Org Id": ORG, "FULL ID": "0014u000025SFFULL01" }],
    otc: [{ "Full ID": "0014u000025SFFULL01", "Product Group": "NURSING COURSE", "Product Name": "Curriculum Plus", "order_status": "Complete",
      "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Estimated # of Students": "40", "order_enrollment_final": "90",
      "Price Per Student": "200", "Estimated or Actual Order Total": "18000", "Cohort Code (if present, then this is a rebooking)": "NEWCODE", "Contract End Date": "2028-01-01" }]
  }, Object.assign({}, CFG, { BT_AS_OF: false, AMOUNT_BASIS: "otc" }));
  assert.strictEqual(raw.all[0].otcEst, 18000);
}
// 33. OTC estimate far from baseline (or $0): baseline kept, flagged, cohorts not re-added as extra lines
{
  const F = "0014u000025BANDAAA";
  const mk = (total) => run([tab({ "FULL ID": F, "Baseline Amount - Tableau": "225000" })], [otc({ "Full ID": F, "Estimated or Actual Order Total": String(total), "order_estimated_start_date": "2027-02-01" })]);
  const low = mk(1298);
  assert.strictEqual(low.lines.length, 1);
  assert.strictEqual(low.lines[0].forecastAmount, 225000);
  assert.ok(low.lines[0].flags.some((f) => /far from baseline/.test(f)));
  const zero = mk(0);
  assert.strictEqual(zero.lines[0].forecastAmount, 225000);
  const ok = mk(200000);                         // within 0.5x - 2x: OTC amount used
  assert.strictEqual(ok.lines[0].forecastAmount, 200000);
  assert.strictEqual(ok.lines[0].forecastSource, "Tableau");
}
// 34. At Risk + weighting: baseline-only lines with a contract covering the year are At Risk, weighted; cohort-backed lines are full;
//     pending contracts and BOS keep their own status
{
  const F = "0014u000025ATRISK", G = "0014u000025COHORT", P = "0014u000025PENDNG";
  const r = run(
    [tab({ "FULL ID": F, "Billing ID": "001A1", "Baseline Amount - Tableau": "1000" }),
     tab({ "FULL ID": G, "Billing ID": "001A2", "Baseline Amount - Tableau": "1000" }),
     tab({ "FULL ID": P, "Billing ID": "001A3", "Baseline Amount - Tableau": "1000" }),
     tab({ "FULL ID": "0014u000025BOSACCT", "Billing ID": "A123456", "Baseline Amount - Tableau": "1000" })],
    [otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01" }),  // contract covers 2027, no 2027 cohort
     otc({ "Full ID": G, "order_estimated_start_date": "2027-02-01" })]);
  const byId = (id) => r.lines.find((l) => l.fullId === id);
  assert.strictEqual(byId(F).expectation, "At Risk");
  assert.strictEqual(byId(F).forecastAmount, 1000);
  assert.strictEqual(byId(F).segment, "Contract covers year, no cohort");
  assert.strictEqual(byId(F).weight, 0.80);
  assert.strictEqual(byId(F).weightedAmount, 800);
  assert.strictEqual(byId(G).expectation, "Expected");
  assert.strictEqual(byId(G).weightedAmount, 1000);
  assert.strictEqual(byId(P).expectation, "Pending Contract");
  assert.strictEqual(byId(P).segment, "No OTC contract data");
  assert.strictEqual(byId(P).weightedAmount, 900);
  assert.strictEqual(r.lines.find((l) => l.studentOrgId === "A123456").expectation, "Expected");
  assert.strictEqual(r.stats.total, 4000);
  assert.strictEqual(r.stats.totalWeighted, 800 + 1000 + 900 + 1000);
  const jan = r.coverage.reduce((s, c) => s + c.weighted, 0);
  assert.strictEqual(jan, r.stats.totalWeighted);
}
// 35. Not Expected (adjustment) weighs 0; an override that excludes a line zeroes its weighted amount too
{
  const F = "0014u000025WEIGHT0";
  const first = run([tab({ "FULL ID": F, "Adjustment (true/false)": "TRUE", "Baseline Amount - Tableau": "250" })], []);
  assert.strictEqual(first.lines[0].weightedAmount, 0);
  const G = "0014u000025WEIGHT1";
  const a = run([tab({ "FULL ID": G })], []);
  const b = run([tab({ "FULL ID": G })], [], [], [{ "Line Key": a.lines[0].key, "Exclude": "TRUE" }]);
  assert.strictEqual(b.lines[0].weightedAmount, 0);
}
// 36. Composition stats add up to the totals
{
  const r = run([tab({ "FULL ID": "0014u000025COMPOS1" }), tab({ "FULL ID": "0014u000025COMPOS2", "Adjustment (true/false)": "TRUE" })], []);
  const cat = r.stats.composition.byCategory;
  const full = Object.keys(cat).reduce((s, k) => s + cat[k].full, 0);
  const wtd = Object.keys(cat).reduce((s, k) => s + cat[k].weighted, 0);
  assert.strictEqual(full, r.stats.total);
  assert.ok(Math.abs(wtd - r.stats.totalWeighted) < 0.01);
}
// 37. Segment weights for baseline-only lines: Med, contract ended, Red, iHuman
{
  const mk = (over, otcRows) => run([tab(Object.assign({ "FULL ID": "0014u000025SEGMENTS" }, over))], otcRows);
  const done = (end, group) => otc({ "Full ID": "0014u000025SEGMENTS", "Product Group": group || "NURSING COURSE", "order_status": "Complete", "order_actual_start_date": "2026-02-01",
    "order_estimated_start_date": "2026-02-01", "Contract End Date": end });
  const med = mk({ "Product Group": "MED COURSE" }, [done("2028-01-01", "MED COURSE")]);
  // the client's only Med line is its flat fee, whatever its size
  assert.strictEqual(med.lines[0].segment, "Med/Allied flat fee, contract covers");
  assert.strictEqual(med.lines[0].weight, 0.30);
  assert.strictEqual(med.lines[0].weightedAmount, 300);
  const ended = mk({}, [done("2026-12-01")]);
  assert.strictEqual(ended.lines[0].segment, "Contract ended 1-3 months before");   // ended 2026-12, forecast month 2027-02
  assert.strictEqual(ended.lines[0].expectation, "Pending Contract");
  assert.strictEqual(ended.lines[0].weightedAmount, 850);
  const endedLong = mk({}, [done("2026-06-01")]);                                    // ended 8 months before the forecast month
  assert.strictEqual(endedLong.lines[0].segment, "Contract ended 7+ months before"); assert.strictEqual(endedLong.lines[0].weightedAmount, 600);
  const endedMid = mk({}, [done("2026-10-01")]);                                     // ended 4 months before
  assert.strictEqual(endedMid.lines[0].segment, "Contract ended 4-6 months before"); assert.strictEqual(endedMid.lines[0].weightedAmount, 700);
  const red = mk({ "Rating": "Red" }, [done("2028-01-01")]);
  assert.strictEqual(red.lines[0].weight, 0.55);
  const ih = mk({ "Product Group": "IHUMAN" }, [done("2028-01-01", "IHUMAN")]);
  assert.strictEqual(ih.lines[0].weight, 0.85);
}
// 38. Amount basis: "min" never exceeds the Tableau baseline; "baseline" splits the baseline across cohorts; "otc" keeps OTC
{
  const F = "0014u000025BASIS";
  const t = [tab({ "FULL ID": F, "Baseline Amount - Tableau": "1000" })];
  const o = [otc({ "Full ID": F, "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "900", "cohort_name": "A" }),
             otc({ "Full ID": F, "order_estimated_start_date": "2027-03-01", "Estimated or Actual Order Total": "600", "cohort_name": "B" })];   // OTC total 1500
  const total = (r) => r.lines.reduce((s, l) => s + l.forecastAmount, 0);
  CFG.AMOUNT_BASIS = "otc";      assert.strictEqual(total(run(t, o)), 1500);
  CFG.AMOUNT_BASIS = "min";      const rm = run(t, o); assert.strictEqual(Math.round(total(rm)), 1000);
  assert.ok(rm.lines.some((l) => l.flags.some((f) => /held to Tableau baseline/.test(f))));
  CFG.AMOUNT_BASIS = "baseline"; assert.strictEqual(Math.round(total(run(t, o))), 1000);
  // OTC below baseline: "min" keeps the lower OTC amount (cohort shrink), "baseline" restores the baseline
  const small = [otc({ "Full ID": F, "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "700" })];
  CFG.AMOUNT_BASIS = "min";      assert.strictEqual(total(run(t, small)), 700);
  CFG.AMOUNT_BASIS = "baseline"; assert.strictEqual(Math.round(total(run(t, small))), 1000);
  CFG.AMOUNT_BASIS = "otc";
}
// 39. Every non-Roster OTC status with an actual start is a booked order (Invoicing, AR Review, Controller, Booking)
{
  ["Invoicing", "AR Review", "Controller", "Booking", "Complete"].forEach((status) => {
    const F = "0014u000025STATUS" + status.slice(0, 2);
    const r = run([tab({ "FULL ID": F })], [otc({ "Full ID": F, "order_status": status, "order_actual_start_date": "2027-02-01", "order_estimated_start_date": "2027-02-01" })]);
    assert.strictEqual(r.lines[0].status, "Booked", status);
    assert.strictEqual(r.lines[0].expectation, "Captured", status);
  });
  const roster = run([tab({ "FULL ID": "0014u000025STATUSRO" })], [otc({ "Full ID": "0014u000025STATUSRO" })]);
  assert.strictEqual(roster.lines[0].status, "Forecast");
}
// 40. REBOOKING_BASIS: billing period 2+ with no cohort code is a rebooking only when the basis is "period"
{
  const F = "0014u000025PERIOD1";
  const row = otc({ "Full ID": F, "Cohort Code Billing Period": "3" });
  CFG.REBOOKING_BASIS = "code";   assert.strictEqual(run([tab({ "FULL ID": F })], [row]).lines[0].bookingType, "Roster Chasing");
  CFG.REBOOKING_BASIS = "period"; assert.strictEqual(run([tab({ "FULL ID": F })], [row]).lines[0].bookingType, "Rebooking");
  CFG.REBOOKING_BASIS = "code";
}
// 41. Helpful OTC info (product code, program, type, modality, term length) is carried to the forecast line
{
  const F = "0014u000025OTCINFO";
  const r = run([tab({ "FULL ID": F })], [otc({ "Full ID": F, "product_code": "OLNCLSYR", "program": "NCLEX RN", "product_type": "Curriculum Plus", "product_modality": "SELF-PACED",
    "order_estimated_start_date": "2027-02-01", "order_estimated_end_date": "2027-08-01" })]);
  const l = r.lines[0];
  assert.strictEqual(l.productCode, "OLNCLSYR"); assert.strictEqual(l.otcProgram, "NCLEX RN");
  assert.strictEqual(l.productType, "Curriculum Plus"); assert.strictEqual(l.modality, "SELF-PACED"); assert.strictEqual(l.termMonths, "6");
}
// 42. Simplified vocabulary: reason / stage / timing are filled in by the engine
{
  const F = "0014u000025VOCAB1";
  // matched cohorts: Early / Late / On time vs the baseline month, stage from rebooking vs roster chasing
  const r = run([tab({ "FULL ID": F, "Baseline Amount - Tableau": "3000", "Forecast Month - Tableau": "2/1/2027" })], [
    otc({ "Full ID": F, "order_estimated_start_date": "2027-01-01", "Estimated or Actual Order Total": "1000", "cohort_name": "A", "Cohort Code (if present, then this is a rebooking)": "C1" }),
    otc({ "Full ID": F, "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "1000", "cohort_name": "B" }),
    otc({ "Full ID": F, "order_estimated_start_date": "2027-03-01", "Estimated or Actual Order Total": "1000", "cohort_name": "C", "Cohort Code (if present, then this is a rebooking)": "C3" })]);
  const at = (m) => r.lines.find((l) => l.forecastMonth === m);
  assert.strictEqual(at("2027-01").timing, "Early"); assert.strictEqual(at("2027-02").timing, "On time"); assert.strictEqual(at("2027-03").timing, "Late");
  assert.strictEqual(at("2027-01").stage, "Not needed");      // rebooking: roster already in house
  assert.strictEqual(at("2027-02").stage, "Not started");     // roster chasing
  // reasons: adjustment / black (teach-out) / dormant program
  const adj = run([tab({ "FULL ID": "0014u000025VOCAB2", "Adjustment (true/false)": "TRUE", "Baseline Amount - Tableau": "250" })], []);
  assert.strictEqual(adj.lines[0].expectation, "Not Expected"); assert.strictEqual(adj.lines[0].reason, "Adjustment"); assert.strictEqual(adj.lines[0].stage, "");
  const blk = run([tab({ "FULL ID": "0014u000025VOCAB3", "Rating": "Black" })], []);
  assert.strictEqual(blk.lines[0].reason, "Lost");
  const dorm = run([tab({ "FULL ID": "0014u000025VOCAB4" })], [otc({ "Full ID": "0014u000025VOCAB4", "Product Name": "NCLEX PN Enrichment", "program": "NCLEX PN", "order_estimated_start_date": "2027-08-01" })]);
  assert.strictEqual(dorm.lines.find((l) => l.productName === "NCLEX PN Enrichment").expectation, "At Risk");
  CFG.DORMANT_PROGRAM_ACTION = "zero";
  const dz = run([tab({ "FULL ID": "0014u000025VOCAB4" })], [otc({ "Full ID": "0014u000025VOCAB4", "Product Name": "NCLEX PN Enrichment", "program": "NCLEX PN", "order_estimated_start_date": "2027-08-01" })]);
  assert.strictEqual(dz.lines.find((l) => l.productName === "NCLEX PN Enrichment").reason, "No Revenue This Term");
  CFG.DORMANT_PROGRAM_ACTION = "weight";
  // reason is blank unless the line is Not Expected
  assert.ok(r.lines.every((l) => l.reason === ""));
}
// 43. A CSM picks the Forecast Category (and reason / stage) on the Overrides tab
{
  const F = "0014u000025CSMPICK";
  const t = [tab({ "FULL ID": F })];
  const base = run(t, []);
  const key = base.lines[0].key;
  const risk = run(t, [], [], [{ "Line Key": key, "Forecast Category": "At Risk" }]);
  assert.strictEqual(risk.lines[0].expectation, "At Risk"); assert.strictEqual(risk.lines[0].weightedAmount, 550); assert.strictEqual(risk.stats.overridesApplied, 1);
  const lost = run(t, [], [], [{ "Line Key": key, "Forecast Category": "not expected", "Not Expected Reason": "Lost", "Roster Stage": "Not needed" }]);
  assert.strictEqual(lost.lines[0].expectation, "Not Expected"); assert.strictEqual(lost.lines[0].reason, "Lost"); assert.strictEqual(lost.lines[0].weightedAmount, 0);
  const bad = run(t, [], [], [{ "Line Key": key, "Forecast Category": "Maybe" }]);       // not a valid category: ignored
  assert.strictEqual(bad.stats.overridesApplied, 0);
  const captured = run(t, [], [], [{ "Line Key": key, "Forecast Category": "Captured" }]);
  assert.strictEqual(captured.lines[0].weightedAmount, 1000);
}
// 44. Cohort with no baseline line: size it from the same cohort's last ACTUAL enrollment, not the rep's estimate
{
  const F = "0014u000025ACTUALS";
  const prior = otc({ "Full ID": F, "cohort_name": "Cohort A", "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01",
    "Estimated # of Students": "40", "order_enrollment_final": "30", "Price Per Student": "100", "Estimated or Actual Order Total": "3000" });
  const next = otc({ "Full ID": F, "cohort_name": "Cohort A", "Cohort Code (if present, then this is a rebooking)": "CA1", "order_estimated_start_date": "2027-08-01",
    "Estimated # of Students": "40", "Price Per Student": "100", "Estimated or Actual Order Total": "4000" });
  const t = [tab({ "FULL ID": F })];                       // baseline sits in Feb-27, six months from the cohort: unmatched, source OTC
  const r = run(t, [prior, next]);
  const l = r.lines.find((x) => x.forecastMonth === "2027-08");
  assert.strictEqual(l.forecastSource, "OTC");
  assert.strictEqual(l.forecastAmount, 3000);               // 30 actual students x $100, not 40 x $100
  assert.strictEqual(l.adjStudents, 30);
  assert.ok(l.flags.some((f) => /last actual enrollment: 30 students/.test(f)));
  CFG.ENROLLMENT_BASIS = "estimate";
  assert.strictEqual(run(t, [prior, next]).lines.find((x) => x.forecastMonth === "2027-08").forecastAmount, 4000);
  CFG.ENROLLMENT_BASIS = "actual";
  // a brand-new cohort (no prior booking) keeps the OTC estimate unless the account has an actual-vs-estimate pattern
  const fresh = run(t, [next]);
  assert.strictEqual(fresh.lines.find((x) => x.forecastMonth === "2027-08").forecastAmount, 4000);
}
// 45. Predicted additional cohorts: 4 cohorts last year, 5 predicted -> the 5th adds value on top of the baseline
{
  const F = "0014u000025EXTRA45";
  const prev = [1, 2, 3, 4].map((i) => otc({ "Full ID": F, "cohort_name": "Class " + i, "Cohort Code (if present, then this is a rebooking)": "K" + i, "order_status": "Complete",
    "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Estimated or Actual Order Total": "1000", "Estimated # of Students": "10", "order_enrollment_final": "10", "Price Per Student": "100" }));
  const next = [1, 2, 3, 4].map((i) => otc({ "Full ID": F, "cohort_name": "Class " + i, "Cohort Code (if present, then this is a rebooking)": "K" + i,
    "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "1000" }))
    .concat([otc({ "Full ID": F, "cohort_name": "Class 5 (new)", "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "1000" })]);
  const t = (rating) => [tab({ "FULL ID": F, "Rating": rating || "Green", "Baseline Amount - Tableau": "4000", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" })];
  CFG.AMOUNT_BASIS = "baseline";
  const r = run(t(), prev.concat(next));
  const ex = r.lines.filter((l) => l.forecastSource === "OTC");
  assert.strictEqual(ex.length, 1, "one additional cohort line");
  assert.strictEqual(ex[0].forecastAmount, 1000);                       // last year's average cohort value
  assert.strictEqual(ex[0].expectation, "At Risk");
  assert.strictEqual(ex[0].weightedAmount, 250);                        // EXTRA_COHORT_WEIGHT 25%
  assert.strictEqual(ex[0].segment, "Additional predicted cohort");
  assert.strictEqual(ex[0].cohortNames, "Class 5 (new)");               // the first-time (roster chasing) cohort is the extra one
  assert.ok(ex[0].flags.some((f) => /OTC expects 5 cohorts vs 4 last year/.test(f)));
  const mainTotal = r.lines.filter((l) => l.forecastSource === "Tableau").reduce((s, l) => s + l.forecastAmount, 0);
  assert.strictEqual(Math.round(mainTotal), 4000);                       // the baseline is not diluted by the extra cohort
  assert.strictEqual(Math.round(r.stats.total), 5000);
  // $0 placeholder rosters are not cohorts: 4 real + 1 placeholder is still 4 vs 4 last year -> no extra
  const placeholder = next.slice(0, 4).concat([otc({ "Full ID": F, "cohort_name": "Placeholder", "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "0" })]);
  assert.strictEqual(run(t(), prev.concat(placeholder)).lines.filter((l) => l.forecastSource === "OTC").length, 0);
  // an extra is never valued above its own OTC estimate
  const small = next.slice(0, 4).concat([otc({ "Full ID": F, "cohort_name": "Small new", "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "400" })]);
  assert.strictEqual(run(t(), prev.concat(small)).lines.filter((l) => l.forecastSource === "OTC")[0].forecastAmount, 400);
  // no history of last year's cohorts -> nothing to compare with, no extras
  const noHist = run(t(), next);
  assert.strictEqual(noHist.lines.filter((l) => l.forecastSource === "OTC").length, 0);
  // fewer or equal cohorts -> no extras
  const same = run(t(), prev.concat(next.slice(0, 4)));
  assert.strictEqual(same.lines.filter((l) => l.forecastSource === "OTC").length, 0);
  // gray account: not applied
  const gray = run(t("Gray"), prev.concat(next));
  assert.strictEqual(gray.lines.filter((l) => l.forecastSource === "OTC").length, 0);
  CFG.EXTRA_COHORTS = false;
  assert.strictEqual(run(t(), prev.concat(next)).lines.filter((l) => l.forecastSource === "OTC").length, 0);
  CFG.EXTRA_COHORTS = true;
  CFG.AMOUNT_BASIS = "otc";
}
// 46. Capital Idea case: an existing PN class (cohort code present) is never "dormant", even if the PN booking is not in this export yet
{
  const F = "0014u000025CAPIDEA";
  const t = [tab({ "FULL ID": F, "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" })];   // RN baseline only
  const rn = otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Product Name": "Curriculum Plus", "program": "NCLEX RN" });
  const coded = otc({ "Full ID": F, "order_estimated_start_date": "2027-08-01", "Product Name": "Curriculum Plus", "program": "NCLEX PN", "cohort_name": "Dec 2026 PN",
    "Cohort Code (if present, then this is a rebooking)": "QNWC26004" });
  const first = otc({ "Full ID": F, "order_estimated_start_date": "2027-08-01", "Product Name": "Curriculum Plus", "program": "NCLEX PN", "cohort_name": "PN Self Paced Code" });
  const lc = run(t, [rn, coded]).lines.find((l) => l.forecastMonth === "2027-08");
  assert.strictEqual(lc.expectation, "Expected");
  assert.ok(!lc.flags.some((f) => /No 2026 booking/.test(f)));
  const lf = run(t, [rn, first]).lines.find((l) => l.forecastMonth === "2027-08");
  assert.strictEqual(lf.expectation, "At Risk");
  // once the PN booking is in the data (Tableau PN line), the first-time cohort is a normal new class
  const t2 = t.concat([tab({ "FULL ID": F, "Product Name": "PN Prep Select", "Baseline Booking Month - Tableau": "11/1/2026", "Forecast Month - Tableau": "11/1/2027", "Baseline Amount - Tableau": "800" })]);
  const l2 = run(t2, [rn, first]).lines.find((l) => l.forecastMonth === "2027-08");
  assert.strictEqual(l2.expectation, "Expected");
}
// 47. Program-first classification: product name with no RN/PN signal still classifies from the `program` field
{
  assert.strictEqual(E.FY27_family_("NURSING COURSE", "NCLEX PN"), "PN");
  const F = "0014u000025PROGONLY";
  const r = run([tab({ "FULL ID": F, "Product Name": "PN Prep Select", "Baseline Booking Month - Tableau": "8/1/2026", "Forecast Month - Tableau": "8/1/2027" })],
    [otc({ "Full ID": F, "Product Name": "Curriculum Plus", "program": "NCLEX PN", "order_estimated_start_date": "2027-08-01" })]);
  assert.strictEqual(r.lines.filter((l) => l.forecastSource === "OTC").length, 0, "matched to the PN baseline row by program, not left as OTC-only");
  assert.strictEqual(r.lines[0].forecastSource, "Tableau");
}
// 48. Weight basis composition adds up and names the segments
{
  const F = "0014u000025SEGCOMP";
  const r = run([tab({ "FULL ID": F, "Product Group": "MED COURSE" })], [otc({ "Full ID": F, "Product Group": "MED COURSE", "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Contract End Date": "2028-01-01" })]);
  const seg = r.stats.composition.bySegment;
  assert.ok(seg["Med/Allied flat fee, contract covers"], JSON.stringify(Object.keys(seg)));
  assert.strictEqual(Object.keys(seg).reduce((s2, k) => s2 + seg[k].full, 0), r.stats.total);
}
// 49. As-of backtest ignores orders created after the backtest year began (a renewal signed in 2026 is not visible on 1 Jan 2026)
{
  const BT2 = new Function(engSrc + "\n" + fs.readFileSync(path.join(__dirname, "../FY27Backtest.gs"), "utf8") + "\nreturn { FY27_backtest_ };")();
  const ORG = "001ORGAAAAAAAAB1";
  const beg = [{ "Student Org ID": ORG, "Forecast Source": "System Forecast", "Forecast Line Type": "Forecast", "Health Rating": "Green", "Account Name": "A", "Product Group": "NURSING COURSE", "Baseline Month": "Feb-26", "Baseline Amount": "$1,000" }];
  const fin = [{ "Student Org ID": ORG, "Forecast Line Type": "Forecast", "Account Name": "A", "Product Group": "NURSING COURSE", "Baseline Month": "2/1/2026", "Baseline Amount": "1000", "Forecast Amount": "1000", "Forecast Category": "Captured - On Time" }];
  const old = { "Full ID": "0014u000025SFASOF1", "Product Group": "NURSING COURSE", "Product Name": "Curriculum Plus", "program": "NCLEX RN", "order_status": "Complete", "order_actual_start_date": "2025-02-01",
    "order_estimated_start_date": "2025-02-01", "order_created_date": "2025-01-15", "Contract End Date": "2025-12-01", "Estimated or Actual Order Total": "1000" };
  const renewal = Object.assign({}, old, { "order_status": "Roster", "order_actual_start_date": "", "order_estimated_start_date": "2026-02-01", "order_created_date": "2026-03-10", "Contract End Date": "2028-01-01" });
  const sf = [{ "Student Org Id": ORG, "FULL ID": "0014u000025SFASOF1" }];
  const withLeak = BT2.FY27_backtest_({ beginning: beg, final: fin, salesforce: sf, otc: [old, renewal], actuals: [] }, Object.assign({}, CFG, { BT_AS_OF_DROP_CREATED_AFTER: false }));
  const asOf = BT2.FY27_backtest_({ beginning: beg, final: fin, salesforce: sf, otc: [old, renewal], actuals: [] }, Object.assign({}, CFG, { BT_AS_OF_DROP_CREATED_AFTER: true }));
  assert.ok(!/ended/i.test(withLeak.all[0].segment));      // leak: the later renewal makes the contract look live
  assert.ok(/^Contract ended/.test(asOf.all[0].segment), asOf.all[0].segment);   // as of 1 Jan 2026 the contract had ended
}
// 50. Med / Allied Health are flat fees: the flat fee follows the contract; small add-ons are weighted low; no extra-cohort logic
{
  const F = "0014u000025FLATFEE";
  const mk = (group, amt, end) => run([tab({ "FULL ID": F, "Product Group": group, "Baseline Amount - Tableau": String(amt) })],
    [otc({ "Full ID": F, "Product Group": group, "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Contract End Date": end })]);
  const flatCovers = mk("MED COURSE", 120000, "2028-01-01").lines[0];
  assert.strictEqual(flatCovers.segment, "Med/Allied flat fee, contract covers"); assert.strictEqual(flatCovers.weightedAmount, 36000);
  const flatEnded = mk("ALLIED HEALTH COURSE", 120000, "2026-12-01").lines[0];
  assert.strictEqual(flatEnded.segment, "Med/Allied flat fee, contract ended"); assert.strictEqual(flatEnded.weightedAmount, 48000);
  // a small line next to the same client's big flat fee is a one-time add-on (relative, not an absolute dollar cutoff)
  const two = run([tab({ "FULL ID": F, "Product Group": "MED COURSE", "Baseline Amount - Tableau": "25000", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" }),
                   tab({ "FULL ID": F, "Product Group": "MED COURSE", "Baseline Amount - Tableau": "2000", "Baseline Booking Month - Tableau": "9/1/2026", "Forecast Month - Tableau": "9/1/2027" }),
                   tab({ "FULL ID": F, "Product Group": "MED COURSE", "Baseline Amount - Tableau": "9000", "Baseline Booking Month - Tableau": "5/1/2026", "Forecast Month - Tableau": "5/1/2027" })],
    [otc({ "Full ID": F, "Product Group": "MED COURSE", "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Contract End Date": "2028-01-01" })]);
  const at = (m) => two.lines.find((l) => l.forecastMonth === m);
  assert.strictEqual(at("2027-02").segment, "Med/Allied flat fee, contract covers");
  assert.strictEqual(at("2027-05").segment, "Med/Allied flat fee, contract covers");   // $9k is 36% of $25k: a second flat fee, not an add-on
  const ad = at("2027-09");                                                             // $2k is 8% of $25k
  assert.strictEqual(ad.expectation, "Not Expected"); assert.strictEqual(ad.reason, "Non-Recurring"); assert.strictEqual(ad.forecastAmount, 0);
  assert.strictEqual(ad.valueIfBooked, 2000); assert.ok(ad.flags.some((f) => /One-time add-on: \$2,000 next to this client's \$25,000 flat fee/.test(f)));
  // no extra cohorts for flat-fee groups even if OTC lists more cohort rows than last year
  const prev = otc({ "Full ID": F, "Product Group": "MED COURSE", "cohort_name": "S1", "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Estimated or Actual Order Total": "1000" });
  const nxt = ["S1", "S2"].map((n) => otc({ "Full ID": F, "Product Group": "MED COURSE", "cohort_name": n, "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "1000" }));
  CFG.AMOUNT_BASIS = "baseline";
  const ex = run([tab({ "FULL ID": F, "Product Group": "MED COURSE", "Baseline Amount - Tableau": "1000" })], [prev].concat(nxt));
  CFG.AMOUNT_BASIS = "otc";
  assert.strictEqual(ex.lines.filter((l) => l.forecastSource === "OTC").length, 0);
}
// 51. Historical retention from the raw crosstab: gross (renewals only), net (with expansion), logo; partial years compare like months
{
  const row = (acct, grp, mon, v) => ({ "Crosstab Level 1 ": acct + " (001C0000014HAw7IAG)", "Crosstab Level 2": grp, "Transaction Date Group": mon, "Metric value Sales": String(v) });
  const A = "Alpha", B = "Beta", C = "Gamma";
  const raw = [
    row(A, "NURSING COURSE", "Feb-24", 1000), row(B, "NURSING COURSE", "Mar-24", 500), row(C.replace("Gamma", "Gamma"), "MED COURSE", "Apr-24", 300),
    // 2025: A grows to 1500 (-100 adjustment), B drops to 0, C keeps 300
    row(A, "NURSING COURSE", "Feb-25", 1600), row(A, "NURSING COURSE", "Jun-25", -100), row(C, "MED COURSE", "Apr-25", 300),
    // 2026: only through Oct; A 1200, C nothing; a November booking must be ignored when comparing like months
    row(A, "NURSING COURSE", "Feb-26", 1200), row(A, "NURSING COURSE", "Nov-26", 9999)
  ];
  // all three share the same org id in this fixture, so make them distinct by group+org: use the same id but different groups to keep keys apart
  const h = E.FY27_historicalRetention_(raw, "2026-10");
  const p2425 = h.find((x) => /^2024 to 2025/.test(x.label));
  assert.ok(p2425 && !/Jan-/.test(p2425.label), "2024 to 2025 is a full-year comparison");
  // keys (org|group): NURSING (A+B combined under one org id) 1500 -> 1500 ; MED 300 -> 300
  assert.strictEqual(Math.round(p2425.baseline), 1800);
  assert.ok(p2425.grossPct > 0.99 && p2425.grossPct <= 1.0001);
  const p2526 = h.find((x) => /^2025 to 2026/.test(x.label));
  assert.ok(/Jan-Oct/.test(p2526.label), p2526.label);
  assert.strictEqual(Math.round(p2526.baseline), 1800);              // 2025 through Oct
  assert.ok(Math.abs(p2526.grossPct - 1200 / 1800) < 1e-9, p2526.grossPct);   // Nov-26 ignored; MED lost, NURSING 1500 -> 1200 (min)
  assert.ok(Math.abs(p2526.logoPct - 0.5) < 1e-9);
}
// 52. Retention by model: repeat-baseline row is 100%, weighted <= full, confirmed-only <= weighted-gross upper bound, extras lift net only
{
  const F = "0014u000025RETMODEL";
  const input = { tableau: [tab({ "FULL ID": F })], otc: [otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Contract End Date": "2028-01-01" })],
    salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 18) };
  const res = E.FY27_buildForecast(input, CFG);
  const models = E.FY27_retentionModels_(input, CFG, res);
  assert.strictEqual(models[0].fullGrossPct, 1);
  assert.ok(models.length >= 5);
  models.slice(1).forEach((m) => { assert.ok(m.weightedGrossPct <= m.fullGrossPct + 1e-9, m.name); assert.ok(m.confirmedGrossPct <= m.fullGrossPct + 1e-9, m.name); });
  const cur = models.find((m) => /current model: AMOUNT_BASIS/.test(m.name));
  assert.strictEqual(cur.baseline, 1000);
  assert.strictEqual(cur.fullGross, 1000);              // baseline-only line repeats at full value
  assert.strictEqual(Math.round(cur.weightedGross), 800);   // "contract covers year, no cohort" weight 80%
  assert.strictEqual(cur.confirmedGross, 0);            // At Risk is not confirmed
  const tr = E.FY27_team2026Retention_([{ "Forecast Line Type": "Forecast", "Forecast Source": "System Forecast", "Baseline Amount": "1000", "Forecast Amount": "800" },
    { "Forecast Line Type": "Forecast", "Forecast Source": "Manual Add", "Baseline Amount": "0", "Forecast Amount": "150" },
    { "Forecast Line Type": "Adjustment", "Forecast Source": "Manual Add", "Baseline Amount": "0", "Forecast Amount": "-50" }]);
  assert.strictEqual(tr.pct, 0.8); assert.strictEqual(tr.pctWithManual, 0.95); assert.strictEqual(tr.manualAdds, 150);
}
// 53. Manual add-ons: validated, attributes looked up by Full ID / Student Org ID, kept as their own rows, weighted by category
{
  const F = "0014u000025MANUAL1";
  const t = [tab({ "FULL ID": F, "Billing ID": "001MANUALORG", "Account Name": "Manual U", "Client Success Manager": "Pat CSM", "Rating": "Green" })];
  const mrow = (o, n) => Object.assign({ "Full ID": F, "Product Group": "NURSING COURSE", "Product Name": "Step Up", "Forecast Month": "3/1/2027", "Amount": "$5,000", "Forecast Category": "", "Comment": "new sale", __row: n }, o);
  const run2 = (manual) => E.FY27_buildForecast({ tableau: t, otc: [], salesforce: [], overrides: [], adjustments: [], manual: manual, now: new Date(2026, 10, 18) }, CFG);
  const r = run2([mrow({}, 2), mrow({ "Full ID": "", "Student Org ID": "001MANUALORG", "Forecast Month": "4/1/2027", "Forecast Category": "At Risk" }, 3),
    mrow({ "Amount": "" }, 4), mrow({ "Forecast Month": "3/1/2026" }, 5), mrow({ "Product Group": "" }, 6), mrow({ "Full ID": "0014u000025UNKNOWNID", "Forecast Month": "5/1/2027" }, 7),
    { __row: 8 }]);
  const man = r.lines.filter((l) => l.forecastSource === "Manual Add On");
  assert.strictEqual(man.length, 3);                                         // rows 2, 3 and 7
  const m1 = man.find((l) => l.forecastMonth === "2027-03");
  assert.strictEqual(m1.forecastAmount, 5000); assert.strictEqual(m1.expectation, "Expected"); assert.strictEqual(m1.weightedAmount, 5000);
  assert.strictEqual(m1.accountName, "Manual U"); assert.strictEqual(m1.csm, "Pat CSM"); assert.strictEqual(m1.stage, "Not started");
  assert.ok(m1.flags.some((f) => /Manual add-on: new sale/.test(f)));
  const m2 = man.find((l) => l.forecastMonth === "2027-04");
  assert.strictEqual(m2.expectation, "At Risk"); assert.strictEqual(m2.weightedAmount, 2750);   // found through the Student Org ID, At Risk 55%
  assert.strictEqual(m2.accountName, "Manual U");
  const status = (n) => r.stats.manualResults.find((x) => x.row === n).status;
  assert.strictEqual(status(2), "Added");
  assert.ok(/NOT ADDED: Amount missing/.test(status(4)));
  assert.ok(/NOT ADDED: Forecast Month must be in 2027/.test(status(5)));
  assert.ok(/NOT ADDED: Product Group missing/.test(status(6)));
  assert.ok(/ID not found/.test(status(7)));
  assert.strictEqual(r.stats.manualResults.length, 6);                       // the blank row 8 is ignored
  assert.strictEqual(r.stats.manualAdded, 3);
  // a manual line is a separate row from a baseline line in the same account / group / month, and counts in the totals
  const both = run2([mrow({ "Forecast Month": "2/1/2027" }, 2)]);
  assert.strictEqual(both.lines.filter((l) => l.forecastMonth === "2027-02").length, 2);
  assert.strictEqual(Math.round(both.stats.total), 6000);
}
// 54. Override keys survive a data refresh that changes the line's category; override status says Applied / Not found
{
  const F = "0014u000025KEYSTAB";
  const t = [tab({ "FULL ID": F })];
  const at = (o) => E.FY27_buildForecast({ tableau: t, otc: o, salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 18) }, CFG);
  const first = at([]);                                    // baseline-only: no OTC contract -> Pending Contract
  const key = first.lines[0].key;
  const second = at([otc({ "Full ID": F, "order_status": "Complete", "order_actual_start_date": "2026-02-01", "order_estimated_start_date": "2026-02-01", "Contract End Date": "2028-01-01" })]);
  assert.notStrictEqual(first.lines[0].expectation, second.lines[0].expectation);        // the category changed...
  assert.strictEqual(second.lines[0].key, key);                                            // ...the key did not
  const ov = [{ "Line Key": key, "Forecast Category": "Not Expected", "Not Expected Reason": "Lost" }, { "Line Key": "0014u000025GONE|x|y|2027-09|Forecast|1", "Override Amount": "5" },
    { "Line Key": "0014u000025EMPTY|x|y|2027-09|Forecast|1" }];
  const r = E.FY27_buildForecast({ tableau: t, otc: [], salesforce: [], overrides: ov, adjustments: [], now: new Date(2026, 10, 18) }, CFG);
  assert.strictEqual(r.stats.overrideStatus[key], "Applied");
  assert.strictEqual(r.stats.overrideStatus["0014u000025GONE|x|y|2027-09|Forecast|1"], "Not found");
  assert.strictEqual(r.stats.overrideStatus["0014u000025EMPTY|x|y|2027-09|Forecast|1"], undefined);   // nothing set: no status
  // a comment on its own is shown but is not counted as an override
  const c = E.FY27_buildForecast({ tableau: t, otc: [], salesforce: [], overrides: [{ "Line Key": key, "Comment": "called CSM" }], adjustments: [], now: new Date(2026, 10, 18) }, CFG);
  assert.ok(c.lines[0].flags.some((f) => /Note: called CSM/.test(f))); assert.strictEqual(c.stats.overridesApplied, 0);
}


// 55. Booked early: a forecast-year cohort already booked while still the prior year is credited to the prior year ($0, baseline kept)
(function () {
  CFG.EARLY_BOOKED_TREATMENT = "prior_year";
  const base = [tab({ "FULL ID": "0014u000025EARLY0", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027", "Baseline Amount - Tableau": "1000" })];
  const mk = (booked, now) => E.FY27_buildForecast({ tableau: base, otc: [otc({ "Full ID": "0014u000025EARLY0", "order_status": booked ? "Complete" : "Roster", "order_actual_start_date": booked ? "2027-02-01" : "" })],
    salesforce: [], overrides: [], adjustments: [], now }, CFG);
  const early = mk(true, new Date(2026, 10, 23));
  const L = early.lines.filter((x) => x.forecastMonth === "2027-02")[0];
  assert.strictEqual(L.expectation, "Not Expected");
  assert.strictEqual(L.reason, "Booked in 2026");
  assert.strictEqual(L.forecastAmount, 0);
  assert.strictEqual(L.baselineAmount, 1000, "baseline stays in the forecast year");
  assert.strictEqual(early.stats.earlyBooked.lines, 1);
  assert.strictEqual(early.stats.earlyBooked.value, 1000);
  assert.ok(L.flags.some((f) => f.indexOf("Booked early") === 0));
  // not booked yet: unchanged
  const open = mk(false, new Date(2026, 10, 23));
  assert.strictEqual(open.lines.filter((x) => x.forecastMonth === "2027-02")[0].expectation, "Expected");
  assert.strictEqual(open.stats.earlyBooked.lines, 0);
  // once the forecast year has started the rule switches itself off: booked orders are real forecast-year bookings
  const later = mk(true, new Date(2027, 1, 10));
  assert.strictEqual(later.lines.filter((x) => x.forecastMonth === "2027-02")[0].expectation, "Captured");
  assert.strictEqual(later.stats.earlyBooked.active, false);
  CFG.EARLY_BOOKED_TREATMENT = "keep";
})();

// 56. Carry-in from the prior-year Nov/Dec forecast: pushed lines are added, captured / not expected are not, open lines only at the slip rate
(function () {
  const carryRow = (o) => Object.assign({ "Student Org ID": "001X", "Account Full ID": "0014u000025CARRY0", "Booking Type": "Renewal", "Health Rating": "Green", "Current CSM": "Pat",
    "Account Name": "Carry U", "Product Group": "NURSING COURSE", "Product": "NCLEX RN Prep Select", "Baseline Month": "12/1/2026", "Forecast Month": "1/1/2027",
    "Forecast Amount": "5,000.00", "Forecast Category": "Expected (Late)", "Latest Comment": "Roster promised for January" }, o);
  const run = (carry) => E.FY27_buildForecast({ tableau: [], otc: [], salesforce: [], overrides: [], adjustments: [], carry, now: new Date(2026, 10, 23) }, CFG);
  const r = run([
    carryRow({}),                                                                   // pushed into 2027 -> added
    carryRow({ "Forecast Month": "12/1/2026", "Forecast Amount": "2,000", "Forecast Category": "Risk (On time)" }),      // open, still Dec -> not counted at slip rate 0
    carryRow({ "Forecast Month": "11/1/2026", "Forecast Category": "Captured - On Time" }),                                // booked in 2026 -> ignored
    carryRow({ "Forecast Month": "2/1/2027", "Forecast Category": "Not expected (Lost)" })                                // not expected -> ignored
  ]);
  assert.strictEqual(r.lines.length, 1);
  const C = r.lines[0];
  assert.strictEqual(C.forecastSource, "2026 Carry-In");
  assert.strictEqual(C.forecastMonth, "2027-01");
  assert.strictEqual(C.forecastAmount, 5000);
  assert.strictEqual(C.expectation, "Expected");
  assert.strictEqual(C.csm, "Pat");
  assert.ok(C.flags[0].indexOf("Pushed from the 2026 forecast") === 0);
  assert.strictEqual(r.stats.carry.pushedLines, 1);
  assert.strictEqual(r.stats.carry.openLines, 1);
  assert.strictEqual(r.stats.carry.openValue, 2000);
  assert.strictEqual(r.stats.carry.added, 1);
  // slip rate: open lines carried into January at At Risk
  CFG.CARRY_OPEN_SLIP_RATE = 0.5;
  const s = run([carryRow({ "Forecast Month": "12/1/2026", "Forecast Amount": "2,000", "Forecast Category": "Risk (On time)" })]);
  CFG.CARRY_OPEN_SLIP_RATE = 0;
  assert.strictEqual(s.lines.length, 1);
  assert.strictEqual(s.lines[0].forecastAmount, 1000);
  assert.strictEqual(s.lines[0].forecastMonth, "2027-01");
  assert.strictEqual(s.lines[0].expectation, "At Risk");
  assert.strictEqual(run([]).stats.carry.rows, 0, "no tab = no change");
})();

// 57. A pushed line replaces the OTC-only estimate for the same account and group (no double count); a nearby baseline line is flagged
(function () {
  const carryRow = { "Student Org ID": "001X", "Account Full ID": "0014u000025TWIN00", "Product Group": "NURSING COURSE", "Product": "NCLEX RN", "Baseline Month": "12/1/2026",
    "Forecast Month": "1/1/2027", "Forecast Amount": "4,000", "Forecast Category": "Risk (Late)", "Current CSM": "Pat", "Account Name": "Twin U" };
  const baseTab = tab({ "FULL ID": "0014u000025TWIN00", "Baseline Booking Month - Tableau": "6/1/2026", "Forecast Month - Tableau": "6/1/2027", "Baseline Amount - Tableau": "9000" });
  const r = E.FY27_buildForecast({ tableau: [baseTab], otc: [otc({ "Full ID": "0014u000025TWIN00", "order_estimated_start_date": "2027-01-01", "cohort_name": "RN Jan 27", "Estimated or Actual Order Total": "7000" })],
    salesforce: [], overrides: [], adjustments: [], carry: [carryRow], now: new Date(2026, 10, 23) }, CFG);
  const jan = r.lines.filter((x) => x.forecastMonth === "2027-01");
  assert.strictEqual(jan.length, 1, "pushed line and OTC-only estimate are one line");
  assert.strictEqual(jan[0].forecastAmount, 4000);
  assert.strictEqual(jan[0].expectation, "At Risk");
  assert.ok(jan[0].flags.some((f) => f.indexOf("replaces the OTC-only estimate") >= 0));
  assert.strictEqual(r.stats.carry.replaced + r.stats.carry.added, 1);
})();
// 58. Account merges: a second Billing ID created for one booking counts as the main account (baseline, OTC, name, CSM) and groups with it
(function () {
  const MAIN = "0014u000025MAINAA", MAINORG = "0013b00001MAINORG", DUPORG = "0013b00001DUPORG";
  const rows = [
    tab({ "FULL ID": MAIN, "Billing ID": MAINORG, "Account Name": "Johns Hopkins", "Client Success Manager": "Pat", "Rating": "Green", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027", "Baseline Amount - Tableau": "1000" }),
    tab({ "FULL ID": MAIN, "Billing ID": DUPORG, "Account Name": "JHU booking acct", "Client Success Manager": "Other", "Rating": "Red", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027", "Baseline Amount - Tableau": "500" })
  ];
  const run = (merges) => E.FY27_buildForecast({ tableau: rows, otc: [], salesforce: [], overrides: [], adjustments: [], merges, now: new Date(2026, 10, 23) }, CFG);
  const apart = run([]);
  assert.strictEqual(apart.lines.length, 2, "two billing IDs = two lines without a merge");
  const joined = run([{ "From ID": DUPORG, "Into ID": MAINORG, __row: 2 }]);
  assert.strictEqual(joined.lines.length, 1, "merged into one line");
  assert.strictEqual(joined.lines[0].baselineAmount, 1500);
  assert.strictEqual(joined.lines[0].accountName, "Johns Hopkins");
  assert.strictEqual(joined.lines[0].csm, "Pat");
  assert.strictEqual(joined.lines[0].studentOrgId, MAINORG);
  assert.ok(/^Applied: 1 rows/.test(joined.stats.mergeResults[0].status), joined.stats.mergeResults[0].status);
  // From ID typed as a different account's Full ID, OTC rows follow
  const OTHER = "0014u000025OTHER0";
  const r2 = E.FY27_buildForecast({ tableau: [rows[0], tab({ "FULL ID": OTHER, "Billing ID": "0013b00001OTHERORG", "Account Name": "JHU Med", "Baseline Amount - Tableau": "700", "Baseline Booking Month - Tableau": "2/1/2026" })],
    otc: [otc({ "Full ID": OTHER, "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "700" })], salesforce: [], overrides: [], adjustments: [],
    merges: [{ "From ID": OTHER, "Into ID": MAIN, __row: 2 }], now: new Date(2026, 10, 23) }, CFG);
  assert.ok(r2.lines.every((L) => L.accountName === "Johns Hopkins" && L.fullId.slice(0, 15) === MAIN.slice(0, 15)));
  assert.strictEqual(r2.lines.reduce((s, L) => s + L.baselineAmount, 0), 1700, "both baselines kept under the main account");
  assert.ok(r2.lines.every((L) => L.studentOrgId === MAINORG));
  // bad rows say why
  const bad = run([{ "From ID": "NOPE", "Into ID": MAINORG, __row: 2 }, { "From ID": DUPORG, "Into ID": "MISSING", __row: 3 }, { "From ID": DUPORG, "Into ID": DUPORG, __row: 4 }]);
  const st = bad.stats.mergeResults.map((x) => x.status).join(" / ");
  assert.ok(/From ID not found/.test(st) && /Into ID not found/.test(st) && /same account/.test(st), st);
})();
// 59. CSM tab rows carry the detail columns (booking type, cohorts, students) and match the header width
(function () {
  const r = E.FY27_buildForecast({ tableau: [tab({ "FULL ID": "0014u000025DETAIL0" })], otc: [otc({ "Full ID": "0014u000025DETAIL0", "cohort_name": "RN Feb Detail" })], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  const hdr = E.FY27_csmHeaders_();
  const rows = E.FY27_csmRows_(r.lines, [], {});
  assert.ok(rows.length >= 1);
  rows.forEach((row) => assert.strictEqual(row.length, hdr.length));
  const row = rows[0];
  assert.ok(row[hdr.indexOf("Cohort Names")].indexOf("RN Feb Detail") >= 0);
  assert.strictEqual(row[hdr.indexOf("Booking Type")], r.lines[0].bookingType);
})();
// 60. In-place editing: an override is only recorded where the visible cell differs from the calculated value; reverting clears it
(function () {
  const r = E.FY27_buildForecast({ tableau: [tab({ "FULL ID": "0014u000025INPLACE" })], otc: [otc({ "Full ID": "0014u000025INPLACE" })], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  const hdr = E.FY27_csmHeaders_();
  const row = E.FY27_csmRows_(r.lines, [], {})[0];
  const rec0 = E.FY27_overrideRecFromCsmRow_(hdr, row);
  assert.strictEqual(rec0.empty, true, "untouched row has no override");
  const set = (name, v) => { const x = row.slice(); x[hdr.indexOf(name)] = v; return E.FY27_overrideRecFromCsmRow_(hdr, x); };
  assert.strictEqual(set("Forecast Category", "Not Expected")["Forecast Category"], "Not Expected");
  assert.strictEqual(set("Forecast $", 1234)["Override Amount"], 1234);
  assert.strictEqual(set("Forecast Month", new Date(2027, 5, 1))["Override Month"], "2027-06");
  assert.strictEqual(set("Comment", "call Tue").empty, false);
  assert.strictEqual(set("Forecast $", row[hdr.indexOf("Calc: Amount")]).empty, true, "typing the calculated value back clears it");
  // after the override is applied the visible cell shows the new value but the hidden calc cell keeps the engine value
  const ov = [{ "Line Key": r.lines[0].key, "Forecast Category": "At Risk", "Override Amount": "999" }];
  const r2 = E.FY27_buildForecast({ tableau: [tab({ "FULL ID": "0014u000025INPLACE" })], otc: [otc({ "Full ID": "0014u000025INPLACE" })], salesforce: [], overrides: ov, adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  const row2 = E.FY27_csmRows_(r2.lines, ov, {})[0];
  assert.strictEqual(row2[hdr.indexOf("Forecast Category")], "At Risk");
  assert.strictEqual(row2[hdr.indexOf("Forecast $")], 999);
  assert.strictEqual(row2[hdr.indexOf("Calc: Category")], r.lines[0].expectation);
  assert.strictEqual(row2[hdr.indexOf("Calc: Amount")], r.lines[0].forecastAmount);
  const rec2 = E.FY27_overrideRecFromCsmRow_(hdr, row2);
  assert.strictEqual(rec2["Forecast Category"], "At Risk");
  assert.strictEqual(rec2["Override Amount"], 999);
})();
// 61. A first-time / dormant program starts at $0 (not a gettable amount); typing an amount counts it as Expected
(function () {
  CFG.DORMANT_PROGRAM_ACTION = "zero";
  const T = [tab({ "FULL ID": "0014u000025DORM0001" })];
  const O = [otc({ "Full ID": "0014u000025DORM0001", "Product Name": "NCLEX PN Enrichment", "program": "NCLEX PN", "order_estimated_start_date": "2027-08-01", "Estimated or Actual Order Total": "3000" })];
  const run = (ov) => E.FY27_buildForecast({ tableau: T, otc: O, salesforce: [], overrides: ov || [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  const r = run();
  const L = r.lines.find((l) => l.productName === "NCLEX PN Enrichment");
  assert.strictEqual(L.forecastAmount, 0);
  assert.strictEqual(L.expectation, "Not Expected");
  assert.strictEqual(L.weightedAmount, 0);
  assert.strictEqual(L.valueIfBooked, 3000);
  assert.ok(L.flags.some((f) => /forecast \$0 until confirmed/.test(f)), JSON.stringify(L.flags));
  const r2 = run([{ "Line Key": L.key, "Override Amount": "2500" }]);
  const L2 = r2.lines.find((l) => l.productName === "NCLEX PN Enrichment");
  assert.strictEqual(L2.forecastAmount, 2500);
  assert.strictEqual(L2.expectation, "Expected");
  assert.strictEqual(L2.weightedAmount, 2500);
  CFG.DORMANT_PROGRAM_ACTION = "weight";
})();

// 62. Active iHP list: iHP lines for accounts not on the list are ignored entirely; other groups, manual and carry lines are untouched; no list = no filtering
(function () {
  const IH = (id, org, extra) => tab(Object.assign({ "FULL ID": id, "Billing ID": org, "Account Name": "Acct " + id.slice(11, 14), "Product Group": "IHUMAN", "Product Name": "iHP Traditional & OSCE Cases", "Baseline Amount - Tableau": "5000" }, extra || {}));
  const rows = [IH("0014u000025ONAAA001", "0013b00001ORGON1"), IH("0014u000025OFBBB001", "0013b00001ORGOFF"), IH("0014u000025OFBBB001", "0013b00001ORGOFF", { "Product Group": "NURSING COURSE", "Product Name": "Curriculum Plus" })];
  const run = (active) => E.FY27_buildForecast({ tableau: rows, otc: [], salesforce: [], overrides: [], adjustments: [], ihpActive: active, now: new Date(2026, 10, 23) }, CFG);
  assert.strictEqual(run([]).lines.length, 3, "no list = no filtering");
  const r = run([{ "Account": "Acct ONA", "Student Org Account ID": "", "Business Org Account ID": "0014u000025ONAAA001" }]);
  assert.strictEqual(r.lines.length, 2);
  assert.ok(r.lines.some((l) => l.productGroup === "IHUMAN" && l.fullId.slice(0, 15) === "0014u000025ONAA"));
  assert.ok(r.lines.some((l) => l.productGroup === "NURSING COURSE"), "non-iHP lines of an inactive iHP account stay");
  assert.strictEqual(r.stats.ihpIgnored.lines, 1);
  assert.strictEqual(r.stats.ihpIgnored.baseline, 5000);
  assert.strictEqual(r.stats.ihpIgnored.top[0].account, "Acct OFB");
  assert.strictEqual(r.stats.baseline.difference, 0, "ignored iHP baseline is accounted for in the baseline check");
  // matched by Student Org ID or by name too
  assert.strictEqual(run([{ "Account": "", "Student Org Account ID": "0013b00001ORGOFF", "Business Org Account ID": "" }, { "Account": "Acct ONA" }]).lines.length, 3);
})();
// 63. iHP list matched on the account NAME (punctuation / & / case ignored) and on the ID inside the Salesforce link behind the name
(function () {
  assert.strictEqual(E.FY27_nameKey_("  Texas A&M   International University. "), E.FY27_nameKey_("texas a and m international university"));
  assert.strictEqual(E.FY27_idFromUrl_("https://kaplan.lightning.force.com/lightning/r/Account/0014u000025PBFfAAO/view"), "0014u000025PBFfAAO");
  assert.strictEqual(E.FY27_idFromUrl_("https://x.my.salesforce.com/0014u000025PBFf"), "0014u000025PBFf");
  assert.strictEqual(E.FY27_idFromUrl_("https://example.com/nothing"), "");
  const IH = (id, org, name) => tab({ "FULL ID": id, "Billing ID": org, "Account Name": name, "Product Group": "IHUMAN", "Product Name": "iHP Traditional & OSCE Cases", "Baseline Amount - Tableau": "5000" });
  const rows = [IH("0014u000025NAMEAA1", "0013b00001NAME01", "Texas A&M International University"), IH("0014u000025LINKAA1", "0013b00001LINK01", "Totally Different Name"), IH("0014u000025GONEAA1", "0013b00001GONE01", "Dropped College")];
  const r = E.FY27_buildForecast({ tableau: rows, otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23), ihpActive: [
    { "Account": "texas a and m international university." },                                                         // name only
    { "Account": "Some Other Spelling", "Account Link": "https://x.lightning.force.com/lightning/r/Account/0014u000025LINKAA1/view" },   // name does not match, link does
    { "Account": "Never Heard Of Them" }                                                                           // on the list, not in the data
  ] }, CFG);
  assert.deepStrictEqual(r.lines.map((l) => l.accountName).sort(), ["Texas A&M International University", "Totally Different Name"]);
  assert.strictEqual(r.stats.ihpIgnored.lines, 1);
  assert.deepStrictEqual(r.stats.ihpIgnored.notFound, ["Never Heard Of Them"]);
})();
// 64. Booked-early value is kept per line and per month (for the coverage table and later reporting)
(function () {
  CFG.EARLY_BOOKED_TREATMENT = "prior_year";
  const r = E.FY27_buildForecast({ tableau: [tab({ "FULL ID": "0014u000025EARLYM01", "Forecast Month - Tableau": "2/1/2027", "Baseline Amount - Tableau": "1000" })],
    otc: [otc({ "Full ID": "0014u000025EARLYM01", "order_status": "Complete", "order_actual_start_date": "2027-02-01" })], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  const L = r.lines.find((x) => x.forecastMonth === "2027-02");
  assert.strictEqual(L.earlyAmount, 1000);
  assert.strictEqual(L.forecastAmount, 0);
  const feb = r.coverage.find((c) => c.month === "2027-02");
  assert.strictEqual(feb.early, 1000);
  assert.strictEqual(feb.earlyLines, 1);
  assert.strictEqual(feb.booked, 0);
  assert.strictEqual(r.coverage.reduce((s, c) => s + c.early, 0), r.stats.earlyBooked.value);
  CFG.EARLY_BOOKED_TREATMENT = "keep";
})();
// 65. A CSM change of category/amount on a "booked early" line removes the booked-early credit (the line did not book early)
(function () {
  CFG.EARLY_BOOKED_TREATMENT = "prior_year";
  const T = [tab({ "FULL ID": "0014u000025WGU00001", "Forecast Month - Tableau": "2/1/2027", "Baseline Amount - Tableau": "1000" })];
  const O = [otc({ "Full ID": "0014u000025WGU00001", "order_status": "Complete", "order_actual_start_date": "2027-02-01" })];
  const run = (ov) => E.FY27_buildForecast({ tableau: T, otc: O, salesforce: [], overrides: ov || [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  const r = run();
  const L = r.lines.find((x) => x.forecastMonth === "2027-02");
  assert.strictEqual(L.earlyAmount, 1000);
  const r2 = run([{ "Line Key": L.key, "Forecast Category": "Not Expected", "Not Expected Reason": "Non-Recurring" }]);
  const L2 = r2.lines.find((x) => x.forecastMonth === "2027-02");
  assert.strictEqual(L2.earlyAmount, 0);
  assert.strictEqual(L2.reason, "Non-Recurring");
  assert.strictEqual(r2.stats.earlyBooked.value, 0);
  assert.strictEqual(r2.stats.earlyBooked.lines, 0);
  assert.strictEqual(r2.coverage.find((c) => c.month === "2027-02").early, 0);
  // a comment alone does not remove it
  const r3 = run([{ "Line Key": L.key, "Comment": "check" }]);
  assert.strictEqual(r3.lines.find((x) => x.forecastMonth === "2027-02").earlyAmount, 1000);
  CFG.EARLY_BOOKED_TREATMENT = "keep";
})();
// 66. Booked-early OTC cohorts with no baseline are not lines at all (kept in the totals and the monthly coverage); ones with a baseline stay at $0
(function () {
  CFG.EARLY_BOOKED_TREATMENT = "prior_year";
  const r = E.FY27_buildForecast({ tableau: [tab({ "FULL ID": "0014u000025EONLY001", "Forecast Month - Tableau": "2/1/2027", "Baseline Amount - Tableau": "1000" })],
    otc: [otc({ "Full ID": "0014u000025EONLY001", "order_status": "Complete", "order_actual_start_date": "2027-02-01" }),
          otc({ "Full ID": "0014u000025EONLY001", "cohort_name": "Extra Jun", "order_status": "Complete", "order_actual_start_date": "2027-06-01", "order_estimated_start_date": "2027-06-01", "Estimated or Actual Order Total": "700", "Product Name": "Other Program" })],
    salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  assert.ok(r.lines.some((x) => x.forecastMonth === "2027-02" && x.baselineAmount === 1000 && x.expectation === "Not Expected"), "baseline slot stays as a $0 line");
  assert.ok(!r.lines.some((x) => x.forecastMonth === "2027-06"), "no-baseline early cohort is not a line");
  assert.strictEqual(r.stats.earlyBooked.onlyLines, 1);
  assert.strictEqual(r.stats.earlyBooked.onlyValue, 700);
  assert.strictEqual(r.stats.earlyBooked.value, 1700);
  assert.strictEqual(r.coverage.find((c) => c.month === "2027-06").early, 700);
  assert.strictEqual(r.coverage.reduce((s, c) => s + c.early, 0), r.stats.earlyBooked.value);
  CFG.EARLY_BOOKED_TREATMENT = "keep";
})();
// 67. Med / Allied Health: all products and categories of the group in a month are one line (flat fee per group); other groups stay split by category
(function () {
  const M = (name, amt, month, extra) => tab(Object.assign({ "FULL ID": "0014u000025MEDALL01", "Product Group": "MED COURSE", "Product Name": name, "Baseline Amount - Tableau": String(amt),
    "Baseline Booking Month - Tableau": month, "Forecast Month - Tableau": month.replace("2026", "2027") }, extra || {}));
  const rows = [M("Step 1 Live Online", 20000, "2/1/2026"), M("Installment Plan", 3000, "2/1/2026"), M("Step 2 CK", 1500, "2/1/2026"),
    tab({ "FULL ID": "0014u000025MEDALL01", "Product Group": "ALLIED HEALTH COURSE", "Product Name": "Allied A", "Baseline Amount - Tableau": "4000", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" })];
  const r = E.FY27_buildForecast({ tableau: rows, otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  const med = r.lines.filter((l) => l.productGroup === "MED COURSE");
  assert.strictEqual(med.length, 1, "one Med line per account x month");
  assert.strictEqual(med[0].baselineAmount, 24500);
  assert.ok(/Step 1 Live Online/.test(med[0].productName) && /Installment Plan/.test(med[0].productName));
  assert.strictEqual(r.lines.filter((l) => l.productGroup === "ALLIED HEALTH COURSE").length, 1, "Allied is its own line, not merged into Med");
  assert.strictEqual(r.detail.filter((l) => l.productGroup === "MED COURSE").length, 3, "detail keeps every product");
  const total = (a) => a.reduce((s, l) => s + l.weightedAmount, 0);
  assert.ok(Math.abs(total(r.lines) - total(r.detail)) < 0.02, "combining must not change the weighted total");
  assert.ok(Math.abs(r.lines.reduce((s, l) => s + l.forecastAmount, 0) - r.detail.reduce((s, l) => s + l.forecastAmount, 0)) < 0.02);
  // iHP is combined the same way, without becoming a flat-fee group
  const ih = E.FY27_buildForecast({ tableau: [tab({ "FULL ID": "0014u000025IHPGRP01", "Product Group": "IHUMAN", "Product Name": "iHP Traditional & OSCE Cases", "Baseline Amount - Tableau": "5000" }),
    tab({ "FULL ID": "0014u000025IHPGRP01", "Product Group": "IHUMAN", "Product Name": "iHP Other Cases", "Baseline Amount - Tableau": "2000" })], otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  assert.strictEqual(ih.lines.length, 1);
  assert.strictEqual(ih.lines[0].baselineAmount, 7000);
  assert.ok(CFG.FLAT_FEE_GROUPS.indexOf("IHUMAN") < 0);
})();
// 68. Prep Select is always roster chasing (never an automatic rebooking, even with a cohort code); other products keep the cohort-code rule
(function () {
  const T = [tab({ "FULL ID": "0014u000025PREP0001", "Product Name": "NCLEX PN Prep Select", "Baseline Amount - Tableau": "4950", "Baseline Booking Month - Tableau": "9/1/2026", "Forecast Month - Tableau": "9/1/2027" }),
             tab({ "FULL ID": "0014u000025PREP0001", "Product Name": "NCLEX RN - Curriculum Plus", "Baseline Amount - Tableau": "3000", "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" })];
  const O = [otc({ "Full ID": "0014u000025PREP0001", "Product Name": "NCLEX PN Prep Select", "cohort_name": "PN Fall 27", "Cohort Code (if present, then this is a rebooking)": "PS2701", "order_estimated_start_date": "2027-08-01", "Estimated or Actual Order Total": "5500" }),
             otc({ "Full ID": "0014u000025PREP0001", "Product Name": "NCLEX RN - Curriculum Plus", "cohort_name": "RN Feb", "Cohort Code (if present, then this is a rebooking)": "RN2701", "order_estimated_start_date": "2027-02-01", "Estimated or Actual Order Total": "3000" })];
  const r = E.FY27_buildForecast({ tableau: T, otc: O, salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  const ps = r.detail.find((l) => /Prep Select/.test(l.productName) && l.forecastMonth === "2027-08");
  assert.strictEqual(ps.bookingType, "Roster Chasing");
  assert.strictEqual(ps.stage, "Not started");
  const cp = r.detail.find((l) => /Curriculum Plus/.test(l.productName));
  assert.strictEqual(cp.bookingType, "Rebooking");
  assert.strictEqual(cp.stage, "Not needed");
  // baseline repeated by assumption (no OTC cohort) is roster chasing for Prep Select too
  const r2 = E.FY27_buildForecast({ tableau: T, otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  assert.strictEqual(r2.detail.find((l) => /Prep Select/.test(l.productName)).bookingType, "Roster Chasing");
  assert.strictEqual(r2.detail.find((l) => /Curriculum Plus/.test(l.productName)).bookingType, "Rebooking (assumed)");
  // a coded Prep Select cohort is still an existing class: never treated as a dormant program
  CFG.DORMANT_PROGRAM_ACTION = "zero";
  const r3 = E.FY27_buildForecast({ tableau: [T[1]], otc: [O[0]], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  CFG.DORMANT_PROGRAM_ACTION = "weight";
  assert.notStrictEqual(r3.detail.find((l) => /Prep Select/.test(l.productName)).reason, "No Revenue This Term");
})();
// 69. Student-pay / hybrid iHP accounts: nothing is split; matching lines carry an FYI note that is not added to the Review list
(function () {
  const IH = (id, extra) => tab(Object.assign({ "FULL ID": id, "Billing ID": "0013b00001" + id.slice(-5), "Account Name": "Acct " + id.slice(-5), "Product Group": "IHUMAN", "Product Name": "iHP Traditional & OSCE Cases",
    "Baseline Amount - Tableau": "1000", "Baseline Booking Month - Tableau": "3/1/2026", "Forecast Month - Tableau": "3/1/2027" }, extra || {}));
  const run = (id, pm) => E.FY27_buildForecast({ tableau: [IH(id)], otc: [otc({ "Full ID": id, "Product Group": "IHUMAN", "Product Name": "iHP Traditional & OSCE Cases", "program": "iHP", "cohort_name": "Fall cohort", "order_estimated_start_date": "2027-08-01", "Estimated or Actual Order Total": "10000" })],
    salesforce: [], overrides: [], adjustments: [], ihpActive: [{ "Account": "Acct " + id.slice(-5), "Business Org Account ID": id, "Payment Method": pm }], now: new Date(2026, 10, 23) }, CFG);
  const student = run("0014u000025SPLIT001", "Student Pay, Pay as you go, Single Term");
  assert.ok(student.lines.length >= 2 && student.lines.every((l) => l.flags.some((f) => f.indexOf("FYI: Student Pay") === 0)), "every iHP line of the account carries the note");
  assert.deepStrictEqual(student.lines.filter((l) => l.baselineAmount === 0).map((l) => l.forecastMonth), ["2027-08"], "nothing is split ahead of time");
  assert.ok(!student.review.some((x) => x.flag.indexOf("FYI:") === 0), "FYI notes stay out of the Review list");
  assert.strictEqual(student.stats.ihpSplit.lines, student.lines.length);
  const inst = run("0014u000025SPLIT002", "Institution Pay, Flat Fee, License-Based");
  assert.ok(inst.lines.every((l) => !l.flags.some((f) => f.indexOf("FYI:") === 0)));
  const hybrid = run("0014u000025SPLIT003", "Student Pay (N620/622) & Institution Pay (N632/634), Pay as you go, Single Term");
  assert.ok(hybrid.lines.every((l) => l.flags.some((f) => f.indexOf("FYI:") === 0)));
})();
// 70. Composition tables stay exact for combined (Med / Allied / iHP) lines: no composite "a; b" weight-basis rows, and totals equal the line totals
(function () {
  const M = (name, amt, extra) => tab(Object.assign({ "FULL ID": "0014u000025COMP00001", "Product Group": "MED COURSE", "Product Name": name, "Baseline Amount - Tableau": String(amt),
    "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027" }, extra || {}));
  const r = E.FY27_buildForecast({ tableau: [M("Step 1 Live Online", 25000), M("Installment Plan", 500)], otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  const segs = Object.keys(r.stats.composition.bySegment);
  assert.ok(segs.every((s) => s.indexOf(";") < 0), segs.join(" | "));
  const sumFull = (t) => Object.keys(t).reduce((s, k) => s + t[k].full, 0);
  const sumW = (t) => Object.keys(t).reduce((s, k) => s + t[k].weighted, 0);
  const lineFull = r.lines.reduce((s, l) => s + l.forecastAmount, 0), lineW = r.lines.reduce((s, l) => s + l.weightedAmount, 0);
  [r.stats.composition.byCategory, r.stats.composition.bySegment, r.stats.composition.bySource].forEach((tbl) => {
    assert.ok(Math.abs(sumFull(tbl) - lineFull) < 0.05, "full totals match");
    assert.ok(Math.abs(sumW(tbl) - lineW) < 0.05, "weighted totals match");
  });
})();
// 71. Retention by product group: group baselines add up to the total baseline; group rows add up to the overall row
(function () {
  const G = (id, group, amt) => tab({ "FULL ID": id, "Product Group": group, "Product Name": group === "MED COURSE" ? "Step 1 Live Online" : "NCLEX RN - Curriculum Plus", "Baseline Amount - Tableau": String(amt) });
  const input = { tableau: [G("0014u000025GRPA0001", "NURSING COURSE", 4000), G("0014u000025GRPB0001", "MED COURSE", 6000)], otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) };
  const res = E.FY27_buildForecast(input, CFG);
  assert.strictEqual(res.stats.baselineByGroup["NURSING COURSE"], 4000);
  assert.strictEqual(res.stats.baselineByGroup["MED COURSE"], 6000);
  const by = E.FY27_retentionByGroup_(input, CFG, res, null, "2026-10", null);
  const current = (g) => by[g].models[3];
  const sum = (f) => CFG.PRODUCT_GROUPS.reduce((s, g) => s + current(g)[f], 0);
  const overall = E.FY27_retentionSummary_(res, "all");
  assert.ok(Math.abs(sum("baseline") - overall.baseline) < 0.01);
  assert.ok(Math.abs(sum("weightedNet") - overall.weightedNet) < 0.01);
  assert.strictEqual(by["MED COURSE"].models[0].baseline, 6000, "repeat-baseline row uses the group's baseline");
})();
// 72. Baseline tags: data errors leave the baseline entirely, one-time fees stay in it but are never forecast, notes only add a flag; unmatched tags say so
(function () {
  const B = (amt, month, extra) => tab(Object.assign({ "FULL ID": "0014u000025BTAG0001", "Billing ID": "0013b00001BTAG01", "Account Name": "Tag U", "Baseline Amount - Tableau": String(amt),
    "Baseline Booking Month - Tableau": month, "Forecast Month - Tableau": month.replace("2026", "2027") }, extra || {}));
  const rows = [B(1000, "2/1/2026"), B(50000, "3/1/2026"), B(700, "4/1/2026"), B(300, "5/1/2026")];
  const run = (tags) => E.FY27_buildForecast({ tableau: rows, otc: [], salesforce: [], overrides: [], adjustments: [], baselineTags: tags || [], now: new Date(2026, 10, 23) }, CFG);
  const plain = run();
  assert.strictEqual(plain.baselineRows.length, 4);
  const keyOf = (r, m) => r.baselineRows.find((x) => x.baseMonth === m).key;
  const tags = [
    { "Baseline Key": keyOf(plain, "2026-03"), "Tag": "One-time fee - keep in baseline, do not forecast", "Comment": "implementation fee" },
    { "Baseline Key": keyOf(plain, "2026-04"), "Tag": "Data error - remove from baseline" },
    { "Baseline Key": keyOf(plain, "2026-05"), "Tag": "Checked - correct" },
    { "Baseline Key": "no|such|key|x", "Tag": "Data error - remove from baseline" }
  ];
  const r = run(tags);
  assert.strictEqual(r.lines.length, 3, "the data error is gone");
  assert.ok(!r.lines.some((l) => l.baselineAmount === 700));
  assert.strictEqual(r.stats.baselineRemoved.rows, 1);
  assert.strictEqual(r.stats.baselineRemoved.value, 700);
  const one = r.lines.find((l) => l.baselineAmount === 50000);
  assert.strictEqual(one.expectation, "Not Expected"); assert.strictEqual(one.reason, "Non-Recurring"); assert.strictEqual(one.forecastAmount, 0);
  assert.ok(one.flags.some((f) => f.indexOf("Baseline tag:") === 0 && /implementation fee/.test(f)));
  const checked = r.lines.find((l) => l.baselineAmount === 300);
  assert.strictEqual(checked.expectation, plain.lines.find((l) => l.baselineAmount === 300).expectation);
  assert.ok(checked.flags.some((f) => f.indexOf("FYI: baseline tag") === 0));
  assert.strictEqual(r.stats.baselineTagStatus[keyOf(plain, "2026-03")], "Applied");
  assert.strictEqual(r.stats.baselineTagStatus["no|such|key|x"], "Not found");
  const bl = r.baselineRows.find((x) => x.baseMonth === "2026-04");
  assert.strictEqual(bl.state, "Removed from baseline", "removed rows stay visible on the review list so the tag can be undone");
  assert.ok(Math.abs(r.stats.baseline.tableau - (1000 + 50000 + 300)) < 0.01, "baseline no longer includes the removed row");
  // identical repeated rows get their own keys
  const dup = E.FY27_buildForecast({ tableau: [B(500, "2/1/2026"), B(500, "2/1/2026")], otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 23) }, CFG);
  assert.strictEqual(new Set(dup.baselineRows.map((x) => x.key)).size, 2);
  const rowsOut = E.FY27_baselineReviewRows_(r.baselineRows);
  assert.strictEqual(rowsOut[0].length, E.FY27_BASELINE_COLUMNS.length);
})();
console.log("all engine tests passed");
