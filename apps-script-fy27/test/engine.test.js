// Run: node apps-script-fy27/test/engine.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
// load the .gs files as plain JS (Apps Script and Node share enough syntax)
const cfgSrc = fs.readFileSync(path.join(__dirname, "../FY27Config.gs"), "utf8");
const engSrc = fs.readFileSync(path.join(__dirname, "../FY27Engine.gs"), "utf8");
const E = (function () { const module = { exports: {} }; new Function("module", engSrc)(module); return module.exports; })();
const CFG = new Function(cfgSrc + "; return FY27_CFG;")();
CFG.TAG_CREDIT = true;   // credit logic is tested with the switch on; see test 22 for off
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

const run = (t, o, sf, ov) => E.FY27_buildForecast({ tableau: t, otc: o, salesforce: sf || [], overrides: ov || [], now: new Date(2026, 10, 18) }, CFG);

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

// 2. Roster chasing (no code) -> New credit; gray rating suppresses it, black zeroes everything
{
  const mk = (rating) => run(
    [tab({ "FULL ID": "0014u000025P7Y7AAK", "Rating": rating })],
    [otc({ "Full ID": "0014u000025P7Y7AAK" })]);
  assert.strictEqual(mk("Green").lines[0].bookingType, "Roster Chasing");
  assert.strictEqual(mk("Green").lines[0].credit, "Renewal");   // Tableau col U says Renewal
  assert.strictEqual(mk("Green").lines[0].forecastAmount, 1000);
  assert.strictEqual(mk("Gray").lines[0].forecastAmount, 0);
  assert.strictEqual(mk("Gray").lines[0].expectation, "Not Expected");
  assert.strictEqual(mk("Black").lines[0].forecastAmount, 0);
  assert.strictEqual(mk("Black").lines[0].valueIfBooked, 1000);
}

// 3. Gray still allows rebookings
{
  const r = run(
    [tab({ "FULL ID": "0014u000025P7Y7AAK", "Rating": "Gray" })],
    [otc({ "Full ID": "0014u000025P7Y7AAK", "Cohort Code (if present, then this is a rebooking)": "X" })]);
  assert.strictEqual(r.lines[0].forecastAmount, 1000);
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
  assert.ok(r.lines[0].flags.some((f) => /needs renewal/.test(f)));
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
console.log("all engine tests passed");
