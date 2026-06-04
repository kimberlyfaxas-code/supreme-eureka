/*******************************************************
 * ForecastTools.gs (MINIMAL CONTROLLER)
 * - Builds the Forecast Tools menu
 * - OTC Drill (per-user)
 * - Contract Drill (per-user)
 * - Build Dashboards (calls ForecastDashboards.gs)
 * - Lockdown (optional)
 *******************************************************/
const FT_CFG = {
  MENU_NAME: "Forecast Tools",
  WORKING_SHEET: "CSM_Working_Forecast",
  // Drill templates
  OTC_TEMPLATE_SHEET: "OTC_Drill_Down",
  OTC_INPUT_A1: "B1",
  OTC_LAND_A1: "A3",
  CONTRACT_SOURCE_SHEET: "Contract_Details_2025",
  CONTRACT_TEMPLATE_SHEET: "Contract_Drill_Down",
  CONTRACT_BOX_HEIGHT: 21,
  CONTRACT_BOX_WIDTH: 2,
  CONTRACT_LABEL_TEXTS: ["Account Name", "University Name"],
  MIN_MATCH_SCORE: 0.60,
  PER_USER_OTC_PREFIX: "OTC_Drill",
  PER_USER_CONTRACT_PREFIX: "Contract_Drill"
};
/************ MENU ************/
function onOpen(e) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu(FT_CFG.MENU_NAME)
      .addItem("Show Sidebar", "FT_showSidebar")
      .addSeparator()
      .addItem("OTC Data (selected row)", "FT_openOtcDrill")
      .addItem("Contract Details (selected row)", "FT_openContractDrill")
      .addSeparator()
      .addItem("Refresh Dashboard Data (safe)", "FT_refreshDashboardData")
      .addItem("Build Dashboards", "FT_buildDashboards")
      .addSeparator()
      .addItem("Build Exec Summary", "FT_buildExecSummary")
      .addItem("Build Waterfall", "FT_buildWaterfall")
      .addItem("Refresh Waterfall", "FT_refreshWaterfall")
      .addSeparator()
      .addItem("Install Auto Refresh (every 10 min)", "FT_installAutoRefresh")
      .addSeparator()
      .addItem("Lockdown", "FT_runLockdown")
      .addToUi();
  } catch (err) {
    Logger.log("onOpen failed: " + err);
  }
}
/************ DASHBOARD DATA (safe) ************/
function FT_refreshDashboardData() {
  // Preferred: new canonical builder file
  if (typeof FDDATA_buildDataAndLists === "function") {
    FDDATA_buildDataAndLists();
    SpreadsheetApp.getActive().toast("Dashboard data refreshed.", FT_CFG.MENU_NAME, 4);
    return;
  }
  // Fallback: if you kept everything inside ForecastDashboards.gs
  if (typeof FD_buildHelper_ === "function") {
    const ss = SpreadsheetApp.getActive();
    const helper = ss.getSheetByName("_Dashboard_Data") || ss.insertSheet("_Dashboard_Data");
    const lists  = ss.getSheetByName("_Dashboard_Lists") || ss.insertSheet("_Dashboard_Lists");
    // Rebuild only data + lists (no dashboards)
    FD_buildHelper_(ss, helper);
    FD_buildLists_(lists, helper);
    helper.hideSheet();
    lists.hideSheet();
    ss.toast("Dashboard data refreshed (fallback).", FT_CFG.MENU_NAME, 4);
    return;
  }
  SpreadsheetApp.getUi().alert(
    "No data refresh function found.\n\n" +
    "Expected one of:\n" +
    "- FDDATA_buildDataAndLists() (recommended)\n" +
    "- FD_buildHelper_() + FD_buildLists_() (fallback)\n\n" +
    "Make sure ForecastDashboardData.gs is added."
  );
}
/************ DASHBOARDS (delegates to ForecastDashboards.gs) ************/
function FT_buildDashboards() {
  if (typeof FD2_buildDashboardsV2 === "function") {
    FD2_buildDashboardsV2();
    SpreadsheetApp.getActive().toast("V2 Dashboards built.", FT_CFG.MENU_NAME, 4);
    return;
  }
  // fallback to old builder
  if (typeof FD_buildDashboards === "function") {
    FD_buildDashboards();
    SpreadsheetApp.getActive().toast("Dashboards built.", FT_CFG.MENU_NAME, 4);
    return;
  }
  SpreadsheetApp.getUi().alert("No dashboard builder found.");
}
/************ AUTO REFRESH (safe wrapper) ************/
function FT_installAutoRefresh() {
  if (typeof AR_installAutoRefresh === "function") {
    AR_installAutoRefresh();
    return;
  }
  SpreadsheetApp.getUi().alert("AR_installAutoRefresh() not found in AutoRefresh.gs");
}
/************ LOCKDOWN (optional) ************/
function FT_runLockdown() {
  // If you have a lockdown function in any file, we’ll call it.
  if (typeof FT_lockdownAll === "function") {
    FT_lockdownAll();
    SpreadsheetApp.getActive().toast("Lockdown applied.", FT_CFG.MENU_NAME, 4);
    return;
  }
  SpreadsheetApp.getUi().alert(
    "Lockdown function not found.\n\n" +
    "If you want this menu item to work, add a function named:\n" +
    "FT_lockdownAll()"
  );
}
/************ EXEC SUMMARY + WATERFALL ************/
function FT_buildExecSummary() {
  if (typeof ES_buildExecSummary === "function") { ES_buildExecSummary(); return; }
  SpreadsheetApp.getUi().alert("ES_buildExecSummary() not found. Make sure ExecSummary.gs is added.");
}
function FT_buildWaterfall() {
  if (typeof ES_buildWaterfall === "function") { ES_buildWaterfall(); return; }
  SpreadsheetApp.getUi().alert("ES_buildWaterfall() not found. Make sure ExecSummary.gs is added.");
}
function FT_refreshWaterfall() {
  if (typeof ES_refreshWaterfall === "function") { ES_refreshWaterfall(); return; }
  SpreadsheetApp.getUi().alert("ES_refreshWaterfall() not found. Make sure ExecSummary.gs is added.");
}
/************ OTC DRILL (PER-USER) ************/
function FT_openOtcDrill() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const working = ss.getSheetByName(FT_CFG.WORKING_SHEET);
  if (!working) throw new Error(`Missing sheet: ${FT_CFG.WORKING_SHEET}`);
  if (ss.getActiveSheet().getName() !== FT_CFG.WORKING_SHEET) {
    SpreadsheetApp.getUi().alert(`Go to "${FT_CFG.WORKING_SHEET}" and select a row first.`);
    return;
  }
  const row = ss.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert("Select a data row (not the header row).");
    return;
  }
  const h = FT_headerMap_(working);
  const idCol = FT_findCol_(h, [
    "Account Full ID",
    "Salesforce Account ID (FULL ID)",
    "Salesforce Account ID",
    "Account ID",
    "SFID",
    "Student Org ID"
  ]);
  const nameCol = FT_findCol_(h, ["Account Name", "Parent Account", "Account", "Customer", "Client"]);
  let key = "";
  if (idCol) key = FT_extractId_(working.getRange(row, idCol).getDisplayValue());
  if (!key && nameCol) key = String(working.getRange(row, nameCol).getDisplayValue()).trim();
  if (!key) {
    SpreadsheetApp.getUi().alert(`No Account ID/Name found on row ${row}.`);
    return;
  }
  const userOtc = FT_getOrCreateUserSheet_(ss, FT_CFG.OTC_TEMPLATE_SHEET, FT_CFG.PER_USER_OTC_PREFIX);
  userOtc.getRange(FT_CFG.OTC_INPUT_A1).setValue(key);
  SpreadsheetApp.flush();
  ss.setActiveSheet(userOtc);
  userOtc.getRange(FT_CFG.OTC_LAND_A1).activate();
}
/************ CONTRACT DRILL (PER-USER) ************/
function FT_openContractDrill() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const working = ss.getSheetByName(FT_CFG.WORKING_SHEET);
  const source = ss.getSheetByName(FT_CFG.CONTRACT_SOURCE_SHEET);
  if (!working) throw new Error(`Missing sheet: ${FT_CFG.WORKING_SHEET}`);
  if (!source) throw new Error(`Missing sheet: ${FT_CFG.CONTRACT_SOURCE_SHEET}`);
  if (ss.getActiveSheet().getName() !== FT_CFG.WORKING_SHEET) {
    SpreadsheetApp.getUi().alert(`Go to "${FT_CFG.WORKING_SHEET}" and select a row first.`);
    return;
  }
  const row = ss.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert("Select a data row (not the header row).");
    return;
  }
  const h = FT_headerMap_(working);
  const nameCol = FT_findCol_(h, ["Account Name", "Parent Account", "Account", "Customer", "Client"]);
  if (!nameCol) {
    SpreadsheetApp.getUi().alert("Couldn't find an Account Name column in row 1.");
    return;
  }
  const targetName = String(working.getRange(row, nameCol).getDisplayValue()).trim();
  if (!targetName) {
    SpreadsheetApp.getUi().alert(`No Account Name found on row ${row}.`);
    return;
  }
  const cards = FT_getContractCards_(source);
  if (!cards.length) {
    SpreadsheetApp.getUi().alert(
      `No contract boxes found. Searched for labels: ${FT_CFG.CONTRACT_LABEL_TEXTS.join(", ")}`
    );
    return;
  }
  let best = { score: 0, card: null };
  for (const card of cards) {
    const s = FT_similarity_(targetName, card.name);
    if (s > best.score) best = { score: s, card };
  }
  if (!best.card || best.score < FT_CFG.MIN_MATCH_SCORE) {
    SpreadsheetApp.getUi().alert(
      `Couldn't confidently match "${targetName}".\n\n` +
      `Best match: ${best.card ? best.card.name : "(none)"} (score ${best.score.toFixed(2)})`
    );
    return;
  }
  const topRow = best.card.row;
  const topCol = Math.max(1, best.card.col - 1);
  const srcRange = source.getRange(topRow, topCol, FT_CFG.CONTRACT_BOX_HEIGHT, FT_CFG.CONTRACT_BOX_WIDTH);
  const userContract = FT_getOrCreateUserSheet_(ss, FT_CFG.CONTRACT_TEMPLATE_SHEET, FT_CFG.PER_USER_CONTRACT_PREFIX);
  const dstRange = userContract.getRange(1, 1, FT_CFG.CONTRACT_BOX_HEIGHT, FT_CFG.CONTRACT_BOX_WIDTH);
  srcRange.copyTo(dstRange, { contentsOnly: false });
  ss.setActiveSheet(userContract);
  userContract.getRange("A1").activate();
  ss.toast(`Matched "${targetName}" → "${best.card.name}" (${best.score.toFixed(2)})`, "Contract Drill", 4);
}
/************ INTERNAL HELPERS ************/
function FT_headerMap_(sheet) {
  const row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const map = {};
  row.forEach((h, i) => {
    const key = String(h || "").trim().toLowerCase();
    if (key) map[key] = i + 1;
  });
  return map;
}
function FT_findCol_(headerMap, candidates) {
  for (const c of candidates) {
    const key = String(c).trim().toLowerCase();
    if (headerMap[key]) return headerMap[key];
  }
  return null;
}
function FT_extractId_(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  return raw.replace(/[^a-zA-Z0-9]/g, "");
}
function FT_getOrCreateUserSheet_(ss, templateName, prefix) {
  const template = ss.getSheetByName(templateName);
  if (!template) throw new Error(`Missing template sheet: ${templateName}`);
  const suffix = FT_safeSuffix_(FT_userKey_());
  const name = `${prefix}__${suffix}`;
  const existing = ss.getSheetByName(name);
  if (existing) return existing;
  return template.copyTo(ss).setName(name);
}
function FT_userKey_() {
  const email = ((Session.getActiveUser() && Session.getActiveUser().getEmail()) || "").trim();
  if (email && email.includes("@")) return email.toLowerCase();
  const tempKey = Session.getTemporaryActiveUserKey();
  if (tempKey) return `anon_${tempKey}`;
  return `anon_${Utilities.getUuid()}`;
}
function FT_safeSuffix_(key) {
  return String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28) || "user";
}
/************ CONTRACT CARD MATCHING HELPERS ************/
function FT_normalizeName_(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function FT_tokenSet_(s) {
  const n = FT_normalizeName_(s);
  return n ? new Set(n.split(" ").filter(t => t.length > 1)) : new Set();
}
function FT_similarity_(a, b) {
  const A = FT_tokenSet_(a);
  const B = FT_tokenSet_(b);
  if (!A.size || !B.size) return 0;
  let overlap = 0;
  A.forEach(t => { if (B.has(t)) overlap++; });
  return (2 * overlap) / (A.size + B.size);
}
function FT_getContractCards_(sourceSheet) {
  const cache = CacheService.getDocumentCache();
  const cacheKey = "FT_CONTRACT_CARDS_V3";
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  const values = sourceSheet.getDataRange().getDisplayValues();
  const labelSet = new Set(FT_CFG.CONTRACT_LABEL_TEXTS.map(x => FT_normalizeName_(x)));
  const cards = [];
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[0].length - 1; c++) {
      const cell = FT_normalizeName_(values[r][c]);
      if (labelSet.has(cell)) {
        const nm = String(values[r][c + 1] || "").trim();
        if (nm) cards.push({ name: nm, row: r + 1, col: c + 2 });
      }
    }
  }
  cache.put(cacheKey, JSON.stringify(cards), 300);
  return cards;
}
function FT_showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("ForecastSidebar")
    .setTitle("Forecast Tools");
  SpreadsheetApp.getUi().showSidebar(html);
}