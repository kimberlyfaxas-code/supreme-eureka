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
  // PN program did not book in 2026 (only RN did) -> not forecast, value kept
  assert.strictEqual(pn.expectation, "Not Expected");
  assert.strictEqual(pn.forecastAmount, 0);
  assert.strictEqual(pn.valueIfBooked, 1500);
  assert.ok(pn.flags.some((f) => /No 2026 booking for this program \(PN\)/.test(f)));
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
  assert.strictEqual(pn.expectation, "Not Expected");
  assert.strictEqual(pn.forecastAmount, 0);
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
  assert.strictEqual(med.lines[0].weight, 0.25);
  assert.strictEqual(med.lines[0].weightedAmount, 250);
  const ended = mk({}, [done("2026-12-01")]);
  assert.strictEqual(ended.lines[0].segment, "Contract ended before month");
  assert.strictEqual(ended.lines[0].expectation, "Pending Contract");
  assert.strictEqual(ended.lines[0].weightedAmount, 300);
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
  assert.strictEqual(dorm.lines.find((l) => l.productName === "NCLEX PN Enrichment").reason, "No Revenue This Term");
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
  assert.strictEqual(ex[0].weightedAmount, 550);
  assert.strictEqual(ex[0].cohortNames, "Class 5 (new)");               // the first-time (roster chasing) cohort is the extra one
  assert.ok(ex[0].flags.some((f) => /OTC expects 5 cohorts vs 4 last year/.test(f)));
  const mainTotal = r.lines.filter((l) => l.forecastSource === "Tableau").reduce((s, l) => s + l.forecastAmount, 0);
  assert.strictEqual(Math.round(mainTotal), 4000);                       // the baseline is not diluted by the extra cohort
  assert.strictEqual(Math.round(r.stats.total), 5000);
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
console.log("all engine tests passed");
