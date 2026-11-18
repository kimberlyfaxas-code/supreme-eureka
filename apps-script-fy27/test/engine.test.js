// Run: node apps-script-fy27/test/engine.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
// load the .gs files as plain JS (Apps Script and Node share enough syntax)
const cfgSrc = fs.readFileSync(path.join(__dirname, "../FY27Config.gs"), "utf8");
const engSrc = fs.readFileSync(path.join(__dirname, "../FY27Engine.gs"), "utf8");
const E = (function () { const module = { exports: {} }; new Function("module", engSrc)(module); return module.exports; })();
const CFG = new Function(cfgSrc + "; return FY27_CFG;")();
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
  "Product Name": "RN Complete", "Product Group": "NURSING COURSE"
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
  assert.strictEqual(mk("Green").lines[0].credit, "New");
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
  assert.strictEqual(r.lines[0].forecastSource, "Baseline (Tableau)");
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
  assert.strictEqual(bos.forecastSource, "Baseline (Tableau)");
  assert.ok(bos.flags.some((f) => /BOS/.test(f)));
  const otcLine = r.lines.find((l) => l.studentOrgId === "001C0000014HBhT");
  assert.strictEqual(otcLine.forecastSource, "OTC Cohort");
}

// 7. Positive adjustment -> not expected
{
  const r = run([tab({ "FULL ID": "0014u000025AAAA", "Adjustment (true/false)": "TRUE", "Baseline Amount - Tableau": "250" })], []);
  assert.strictEqual(r.lines[0].expectation, "Not Expected");
  assert.strictEqual(r.lines[0].forecastAmount, 0);
  assert.strictEqual(r.lines[0].valueIfBooked, 250);
}

// 8. OTC-only account (not in Tableau) -> pulled from Salesforce, flagged
{
  const r = run([], [otc({ "Full ID": "001NEWACCT00001AA" })], [{ "FULL ID": "001NEWACCT00001AA", "Account Name": "New U", "Client Success Manager": "Pat", "Rating": "Green", "Student Org Id": "001ORG" }]);
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(r.lines[0].accountName, "New U");
  assert.strictEqual(r.lines[0].csm, "Pat");
  assert.ok(r.lines[0].flags.some((f) => /Not in Tableau/.test(f)));
  assert.strictEqual(r.review[0].severity, "High");
}

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
console.log("all engine tests passed");
