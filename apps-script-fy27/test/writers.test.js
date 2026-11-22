// Run: node apps-script-fy27/test/writers.test.js
// Drives the sheet-writing functions against a fake SpreadsheetApp that enforces setValues(range) dimensions,
// the class of error the pure-engine tests cannot see ("data has 8 but the range has 7").
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const src = ["FY27Config.gs", "FY27Engine.gs", "FY27Build.gs", "FY27Backtest.gs"]
  .map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");

function makeSheet(name) {
  const sh = { name, cells: {}, writes: [] };
  const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
  sh.getRange = (r, c, nr, nc) => ({
    setValues(vals) {
      assert.ok(Array.isArray(vals) && vals.length === (nr || 1), `${name}: ${vals.length} rows vs range ${nr}`);
      vals.forEach((row, i) => assert.strictEqual(row.length, nc || 1, `${name} row ${i + 1}: data has ${row.length} but the range has ${nc || 1}`));
      sh.writes.push([r, c, vals.length, vals[0] ? vals[0].length : 0]);
      return this;
    },
    setNumberFormat() { return this; }, setFontWeight() { return this; }, setFontSize() { return this; },
    setBackground() { return this; }, insertCheckboxes() { return this; }
  });
  sh.clear = () => sh; sh.setFrozenRows = () => sh; sh.autoResizeColumns = () => sh; sh.setColumnWidth = () => sh;
  sh.getLastRow = () => 1; sh.getLastColumn = () => 1;
  return sh;
}
const sheets = {};
const SpreadsheetApp = { getActive: () => ss };
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = makeSheet(n)),
  toast() {}
};
const api = new Function("SpreadsheetApp", "LockService", src +
  "\nreturn { FY27_CFG, FY27_buildForecast, FY27_backtest_, FY27_writeForecast_, FY27_writeReview_, FY27_writeBacktest_ };")(SpreadsheetApp, {});
const CFG = api.FY27_CFG;
CFG.USE_ADJUSTMENTS_TAB = true;

const tab = (o) => Object.assign({ "Billing ID": "001X", "Account Name": "A", "FULL ID": "", "Rating": "Green", "Product Group": "NURSING COURSE",
  "Product Name": "NCLEX RN - Curriculum Plus", "Prior Booking Type": "Renewal", "Next Booking Type": "Renewal",
  "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027", "Baseline Amount - Tableau": "1000" }, o);
const res = api.FY27_buildForecast({ tableau: [tab({ "FULL ID": "0014u000025WRITERS" }), tab({ "FULL ID": "0014u000025WRITERS", "Baseline Amount - Tableau": "-50" })],
  otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 18) }, CFG);

api.FY27_writeForecast_(ss, res.lines, CFG.SHEETS.FORECAST);
api.FY27_writeForecast_(ss, res.detail, CFG.SHEETS.DETAIL);
api.FY27_writeReview_(ss, res);

const ORG = "001ORGAAAAAAAAA1";
const bt = api.FY27_backtest_({
  beginning: [{ "Student Org ID": ORG, "Forecast Source": "System Forecast", "Forecast Line Type": "Forecast", "Health Rating": "Green", "Account Name": "A",
    "Product Group": "NURSING COURSE", "Baseline Month": "Feb-26", "Baseline Amount": "$1,000", "Starting Forecast Amount": "$1,000" }],
  final: [{ "Student Org ID": ORG, "Forecast Line Type": "Forecast", "Account Name": "A", "Product Group": "NURSING COURSE", "Baseline Month": "2/1/2026",
    "Baseline Amount": "1000", "Forecast Amount": "1000", "Forecast Category": "Captured - On Time" }],
  salesforce: [], otc: [], actuals: []
}, CFG);
api.FY27_writeBacktest_(ss, bt);

assert.ok(sheets[CFG.SHEETS.FORECAST].writes.length >= 1);
assert.ok(sheets[CFG.SHEETS.REVIEW].writes.length >= 1);
assert.ok(sheets[CFG.SHEETS.BT_SUMMARY].writes.length >= 1);
assert.ok(sheets[CFG.SHEETS.BT_ALL].writes.length >= 1);
console.log("all writer tests passed");
