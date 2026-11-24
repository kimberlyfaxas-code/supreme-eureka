// Run: node apps-script-fy27/test/writers.test.js
// Drives the sheet-writing functions against a fake SpreadsheetApp that enforces setValues(range) dimensions,
// the class of error the pure-engine tests cannot see ("data has 8 but the range has 7").
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const src = ["FY27Config.gs", "FY27Engine.gs", "FY27Build.gs", "FY27Backtest.gs"]
  .map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n");

function makeSheet(name) {
  const sh = { name, cells: {}, writes: [], filterCreated: false, protections: [], cfRules: null, frozenCols: 0, hidden: [] };
  const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
  sh.getRange = (r, c, nr, nc) => ({
    setValues(vals) {
      assert.ok(Array.isArray(vals) && vals.length === (nr || 1), `${name}: ${vals.length} rows vs range ${nr}`);
      vals.forEach((row, i) => assert.strictEqual(row.length, nc || 1, `${name} row ${i + 1}: data has ${row.length} but the range has ${nc || 1}`));
      sh.writes.push([r, c, vals.length, vals[0] ? vals[0].length : 0]);
      return this;
    },
    setNumberFormat() { return this; }, setFontWeight() { return this; }, setFontSize() { return this; }, setWrap() { return this; }, setNote() { return this; },
    setBackground() { return this; }, clearDataValidations() { sh.validationsCleared = (sh.validationsCleared || 0) + 1; return this; }, clearNote() { sh.notesCleared = (sh.notesCleared || 0) + 1; return this; }, insertCheckboxes() { return this; }, setDataValidation() { return this; }, clearFormat() { return this; },
    setValue(v) { sh.cells[r + "," + c] = v; return this; }, setFormulas(f) { sh.formulas = (sh.formulas || []).concat(f); return this; }, clearContent() { return this; },
    createFilter() { sh.filterCreated = true; return this; },
    protect() { const p = { setDescription() { return p; }, setWarningOnly() { return p; } }; sh.protections.push(p); return p; },
    getSheet() { return sh; }, getRow() { return r; }, getColumn() { return c; }, getLastRow() { return r + (nr || 1) - 1; }, getLastColumn() { return c + (nc || 1) - 1; },
    getValues() { return sh.readValues ? sh.readValues(r, c, nr || 1, nc || 1) : Array.from({ length: nr || 1 }, () => Array(nc || 1).fill("")); }
  });
  sh.getName = () => name; sh.getFilter = () => null; sh.getProtections = () => []; sh.setConditionalFormatRules = (r) => { sh.cfRules = r; }; sh.setFrozenColumns = (n) => { sh.frozenCols = n; };
  sh.hideColumns = (c) => { sh.hidden.push(c); }; sh.getDataRange = () => sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn());
  sh.getMaxRows = () => 1000; sh.getMaxColumns = () => 26; sh.clear = () => sh; sh.clearFormats = () => sh; sh.setFrozenRows = () => sh; sh.autoResizeColumns = () => sh; sh.setColumnWidth = () => sh;
  sh.getLastRow = () => 1; sh.getLastColumn = () => 1;
  return sh;
}
const sheets = {};
const builder = () => new Proxy({}, { get: (_, k) => (k === "build" ? () => ({}) : () => builder()) });
const SpreadsheetApp = { getActive: () => ss, newDataValidation: () => builder(), newConditionalFormatRule: () => builder(), ProtectionType: { RANGE: "RANGE" } };
const Session = { getActiveUser: () => ({ getEmail: () => "csm@example.com" }), getScriptTimeZone: () => "America/New_York" };
const Utilities = { formatDate: () => "Nov 23 9:00 AM" };
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = makeSheet(n)),
  setActiveSheet() {}, moveActiveSheet() {},
  toast() {}
};
const api = new Function("SpreadsheetApp", "LockService", "Session", "Utilities", src +
  "\nreturn { FY27_CFG, FY27_buildForecast, FY27_backtest_, FY27_writeForecast_, FY27_writeReview_, FY27_writeBacktest_, FY27_ensureOverridesSheet_, FY27_ensureManualSheet_, FY27_ensureMergeSheet_, FY27_writeBaselineReview_, FY27_ensureBaselineTagsSheet_, FY27_writeBaselineTagStatus_, FY27_onEditBaseline_, FY27_BASELINE_COLUMNS, FY27_writeRetentionGroups_, FY27_retentionByGroup_, FY27_ensureIhpSheet_, FY27_addLinkIds_, FY27_writeMergeStatus_, FY27_ensureReadMe_, FY27_writeCsmSheet_, FY27_writeOverrideStatus_, FY27_writeManualStatus_, FY27_onEdit_, FY27_csmHeaders_, FY27_retentionModels_, FY27_historicalRetention_, FY27_team2026Retention_ };")(SpreadsheetApp, {}, Session, Utilities);
const CFG = api.FY27_CFG;
CFG.USE_ADJUSTMENTS_TAB = true;

const tab = (o) => Object.assign({ "Billing ID": "001X", "Account Name": "A", "FULL ID": "", "Rating": "Green", "Product Group": "NURSING COURSE",
  "Product Name": "NCLEX RN - Curriculum Plus", "Prior Booking Type": "Renewal", "Next Booking Type": "Renewal",
  "Baseline Booking Month - Tableau": "2/1/2026", "Forecast Month - Tableau": "2/1/2027", "Baseline Amount - Tableau": "1000" }, o);
const res = api.FY27_buildForecast({ tableau: [tab({ "FULL ID": "0014u000025WRITERS" }), tab({ "FULL ID": "0014u000025WRITERS", "Baseline Amount - Tableau": "-50" })],
  otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 18) }, CFG);

api.FY27_ensureOverridesSheet_();
api.FY27_writeForecast_(ss, res.lines, CFG.SHEETS.FORECAST);
api.FY27_writeForecast_(ss, res.detail, CFG.SHEETS.DETAIL);
const E = api.FY27_retentionModels_ ? api : null;
const input = { tableau: [tab({ "FULL ID": "0014u000025WRITERS" })], otc: [], salesforce: [], overrides: [], adjustments: [], now: new Date(2026, 10, 18) };
const retention = { models: api.FY27_retentionModels_(input, CFG, res), history: api.FY27_historicalRetention_([
  { "Crosstab Level 1 ": "Acct (001C0000014HAw7IAG)", "Crosstab Level 2": "NURSING COURSE", "Transaction Date Group": "Mar-25", "Metric value Sales": "1000" },
  { "Crosstab Level 1 ": "Acct (001C0000014HAw7IAG)", "Crosstab Level 2": "NURSING COURSE", "Transaction Date Group": "Mar-26", "Metric value Sales": "900" }], "2026-10"),
  team2026: api.FY27_team2026Retention_([{ "Forecast Line Type": "Forecast", "Baseline Amount": "1000", "Forecast Amount": "800" }]) };
api.FY27_writeReview_(ss, res, retention);
{
  const rawRows = [
    { "Crosstab Level 1 ": "Acct (001C0000014HAw7IAG)", "Crosstab Level 2": "NURSING COURSE", "Transaction Date Group": "Mar-25", "Metric value Sales": "1000" },
    { "Crosstab Level 1 ": "Acct (001C0000014HAw7IAG)", "Crosstab Level 2": "NURSING COURSE", "Transaction Date Group": "Mar-26", "Metric value Sales": "900" },
    { "Crosstab Level 1 ": "Acct (001C0000014HBBBBIAG)", "Crosstab Level 2": "MED COURSE", "Transaction Date Group": "Mar-25", "Metric value Sales": "5000" },
    { "Crosstab Level 1 ": "Acct (001C0000014HBBBBIAG)", "Crosstab Level 2": "MED COURSE", "Transaction Date Group": "Mar-26", "Metric value Sales": "2000" }];
  const byGroup = api.FY27_retentionByGroup_(input, CFG, res, rawRows, "2026-10", [{ "Forecast Line Type": "Forecast", "Product Group": "NURSING COURSE", "Baseline Amount": "1000", "Forecast Amount": "800" }]);
  assert.deepStrictEqual(Object.keys(byGroup), CFG.PRODUCT_GROUPS);
  assert.strictEqual(byGroup["NURSING COURSE"].models.length, 5);
  assert.strictEqual(byGroup["MED COURSE"].history.length, 1, "history is filtered to the group");
  assert.ok(byGroup["NURSING COURSE"].team2026 && byGroup["MED COURSE"].team2026 === null);
  api.FY27_writeRetentionGroups_(ss, { models: retention.models, history: retention.history, team2026: retention.team2026, byGroup });
  assert.ok(sheets[CFG.SHEETS.RETENTION_GROUP].writes.length >= 1, "Retention by Group tab written");
}

const ORG = "001ORGAAAAAAAAA1";
const bt = api.FY27_backtest_({
  beginning: [{ "Student Org ID": ORG, "Forecast Source": "System Forecast", "Forecast Line Type": "Forecast", "Health Rating": "Green", "Account Name": "A",
    "Product Group": "NURSING COURSE", "Baseline Month": "Feb-26", "Baseline Amount": "$1,000", "Starting Forecast Amount": "$1,000" }],
  final: [{ "Student Org ID": ORG, "Forecast Line Type": "Forecast", "Account Name": "A", "Product Group": "NURSING COURSE", "Baseline Month": "2/1/2026",
    "Baseline Amount": "1000", "Forecast Amount": "1000", "Forecast Category": "Captured - On Time" }],
  salesforce: [], otc: [], actuals: []
}, CFG);
api.FY27_writeBacktest_(ss, bt);

// ---- CSM tab, manual tab, read me, overrides status, edit sync
const msheet = api.FY27_ensureManualSheet_();
const ihpSh = api.FY27_ensureIhpSheet_();
assert.ok(ihpSh.writes.length >= 1, "iHP tab header written on first creation");
// the account name on the iHP list is a link to the Salesforce record: its ID is kept on the row
{
  const fake = { getLastRow: () => 3, getLastColumn: () => 2, getRange: (r, c, nr, nc) => ({
    getValues: () => [["Account", "Customer Type"]],
    getRichTextValues: () => [[{ getLinkUrl: () => "https://x.lightning.force.com/lightning/r/Account/0014u000025LINKAA1/view" }], [{ getLinkUrl: () => null, getRuns: () => [] }]] }) };
  const rowsIn = [{ __row: 2, Account: "A" }, { __row: 3, Account: "B" }];
  api.FY27_addLinkIds_(fake, rowsIn);
  assert.ok(/0014u000025LINKAA1/.test(rowsIn[0]["Account Link"]));
  assert.strictEqual(rowsIn[1]["Account Link"], undefined);
}
const mg = api.FY27_ensureMergeSheet_();
api.FY27_writeMergeStatus_(mg, [{ row: 2, status: "Applied: 3 rows now count as X" }]);
assert.strictEqual(mg.cells["2,4"], "Applied: 3 rows now count as X");
api.FY27_ensureReadMe_();
api.FY27_writeCsmSheet_(ss, res.lines, [], res.stats.overrideStatus);
const csm = sheets[CFG.SHEETS.CSM];
assert.ok(csm.validationsCleared >= 1 && csm.notesCleared >= 1, "stale dropdowns and notes from an older layout are cleared before writing");
assert.ok(csm.filterCreated, "CSM tab has a filter");
assert.ok(csm.formulas && /ROUNDUP\(MONTH\(/.test(csm.formulas[0][0]), "Forecast Quarter is a formula on the Forecast Month cell");
assert.strictEqual(csm.frozenCols, 2);
assert.ok(csm.cfRules && csm.cfRules.length === 9, "5 changed-cell rules + 4 category colour rules");
assert.ok(csm.protections.length >= 1, "calculated columns protected (warning only)");
assert.ok(sheets[CFG.SHEETS.README].writes.length >= 1, "read me written");
api.FY27_writeOverrideStatus_(sheets[CFG.SHEETS.OVERRIDES], {});
api.FY27_writeManualStatus_(msheet, [{ row: 2, status: "Added" }]);
assert.strictEqual(msheet.cells["2,14"], "Added");
// empty-state CSM tab (no lines) still writes cleanly
api.FY27_writeCsmSheet_(ss, [], [], {});

// onEdit: edit a yellow cell on the CSM tab -> row lands on the Overrides tab
const hdr = api.FY27_csmHeaders_();
const rowVals = hdr.map(() => "");
rowVals[hdr.indexOf("Line Key")] = "KEY|1"; rowVals[hdr.indexOf("Account Name")] = "A"; rowVals[hdr.indexOf("Forecast Category")] = "Not Expected"; rowVals[hdr.indexOf("Calc: Category")] = "Expected";
rowVals[hdr.indexOf("Not Expected Reason")] = "Lost"; rowVals[hdr.indexOf("Calc: Reason")] = "";
rowVals[hdr.indexOf("Forecast Month")] = new Date(2027, 2, 1); rowVals[hdr.indexOf("Calc: Month")] = new Date(2027, 2, 1);
rowVals[hdr.indexOf("Forecast $")] = 500; rowVals[hdr.indexOf("Calc: Amount")] = 500;
const csm2 = sheets[CFG.SHEETS.CSM];
csm2.getLastColumn = () => hdr.length;
csm2.readValues = (r, c, nr, nc) => (r === 1 ? [hdr] : [rowVals]);
const ovSh = sheets[CFG.SHEETS.OVERRIDES];
ovSh.getLastRow = () => 1; ovSh.getLastColumn = () => 13;
const catCol = hdr.indexOf("Forecast Category") + 1;
const ovWrites = [];
const origGetRange = ovSh.getRange;
ovSh.getRange = (r, c, nr, nc) => { const g = origGetRange(r, c, nr, nc); const sv = g.setValues; g.setValues = function (v) { if (r === 2) ovWrites.push(v); return sv.call(this, v); }; return g; };
const editRange = csm2.getRange(2, catCol, 1, 1);
api.FY27_onEdit_({ range: editRange });
assert.strictEqual(ovWrites.length, 1, "override row written");
assert.strictEqual(ovWrites[0][0][0], "KEY|1");
assert.strictEqual(ovWrites[0][0][6], "Not Expected");
assert.strictEqual(ovWrites[0][0][7], "Lost");
assert.strictEqual(ovWrites[0][0][4], "", "unchanged amount is not an override");
assert.strictEqual(ovWrites[0][0][5], "", "unchanged month is not an override");
assert.strictEqual(ovWrites[0][0][10], "csm@example.com");
// editing a calculated column does nothing
ovWrites.length = 0;
api.FY27_onEdit_({ range: csm2.getRange(2, 2, 1, 1) });   // Account Name column
assert.strictEqual(ovWrites.length, 0, "calculated columns do not write overrides");
// editing another sheet does nothing
api.FY27_onEdit_({ range: sheets[CFG.SHEETS.FORECAST].getRange(2, 2, 1, 1) });
assert.strictEqual(ovWrites.length, 0);

// Baseline Review tab, its store, and the edit sync
{
  api.FY27_writeBaselineReview_(ss, res);
  const br = sheets[CFG.SHEETS.BASELINE_REVIEW];
  assert.ok(br.writes.length >= 1 && br.filterCreated, "Baseline Review written with a filter");
  const store = api.FY27_ensureBaselineTagsSheet_();
  api.FY27_writeBaselineTagStatus_(store, {});
  const bh = api.FY27_BASELINE_COLUMNS;
  const brow = bh.map(() => "");
  brow[bh.indexOf("Baseline Key")] = "k|1"; brow[bh.indexOf("Account Name")] = "A"; brow[bh.indexOf("Baseline Tag")] = "Data error - remove from baseline"; brow[bh.indexOf("Baseline $")] = 500;
  br.getLastColumn = () => bh.length;
  br.readValues = (r, c, nr, nc) => (r === 1 ? [bh] : [brow]);
  store.getLastRow = () => 1; store.getLastColumn = () => 10;
  const tw = [];
  const og = store.getRange;
  store.getRange = (r, c, nr, nc) => { const g = og(r, c, nr, nc); const sv = g.setValues; g.setValues = function (v) { if (r === 2) tw.push(v); return sv.call(this, v); }; return g; };
  api.FY27_onEdit_({ range: br.getRange(2, bh.indexOf("Baseline Tag") + 1, 1, 1) });
  assert.strictEqual(tw.length, 1, "tag written to the Baseline Tags store");
  assert.strictEqual(tw[0][0][0], "k|1");
  assert.strictEqual(tw[0][0][5], "Data error - remove from baseline");
}

assert.ok(sheets[CFG.SHEETS.OVERRIDES].writes.length >= 1, "overrides header written");
assert.ok(sheets[CFG.SHEETS.FORECAST].writes.length >= 1);
assert.ok(sheets[CFG.SHEETS.REVIEW].writes.length >= 1);
assert.ok(sheets[CFG.SHEETS.BT_SUMMARY].writes.length >= 1);
assert.ok(sheets[CFG.SHEETS.BT_ALL].writes.length >= 1);
console.log("all writer tests passed");
