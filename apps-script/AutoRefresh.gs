/*******************************************************
 * AutoRefresh.gs (FINAL - CLEAN)
 * - Timer-based rebuild ONLY
 * - onEdit only records "a refresh was requested" (no rebuild)
 *******************************************************/
const AR_CFG = {
  WATCH_SHEETS: new Set([
    "CSM_Working_Forecast",
    "Manual_Forecast_AddOns",
    "2026_Adjustments"
  ]),
  // Debounce window (seconds) for recording requests
  DEBOUNCE_SECONDS: 600,
  // Time-driven trigger frequency (minutes)
  TIMER_MINUTES: 15,
  // Script property keys
  PROP_LAST_REQUEST_TS: "AR_LAST_REQUEST_TS"
};
/**
 * Run once manually to install the timer trigger.
 */
function AR_installAutoRefresh() {
  AR_removeAutoRefreshTriggers_();
  ScriptApp.newTrigger("AR_refreshDashboards")
    .timeBased()
    .everyMinutes(AR_CFG.TIMER_MINUTES)
    .create();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Auto-refresh installed (every ${AR_CFG.TIMER_MINUTES} minutes).`,
    "Forecast Tools",
    5
  );
}
/**
 * Removes ONLY the dashboard timer trigger(s).
 * (If you want to nuke everything, do it explicitly elsewhere.)
 */
function AR_removeAutoRefreshTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction && t.getHandlerFunction();
    if (fn === "AR_refreshDashboards") ScriptApp.deleteTrigger(t);
  });
}
/**
 * Called by TR_onEdit for changes on WATCH_SHEETS.
 * Records a timestamp but DOES NOT rebuild immediately.
 */
function AR_requestRefreshFromEdit_(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (!sh) return;
    if (!AR_CFG.WATCH_SHEETS.has(sh.getName())) return;
    const props = PropertiesService.getDocumentProperties();
    const now = Date.now();
    const last = Number(props.getProperty(AR_CFG.PROP_LAST_REQUEST_TS) || "0");
    if (now - last < AR_CFG.DEBOUNCE_SECONDS * 1000) return;
    props.setProperty(AR_CFG.PROP_LAST_REQUEST_TS, String(now));
    // No rebuild here — timer handles it.
  } catch (err) {
    Logger.log("AR_requestRefreshFromEdit_ error: " + (err && err.stack ? err.stack : err));
  }
}
/**
 * Timer entrypoint.
 * Rebuilds data + lists (and your dashboards, if your pipeline does that).
 */
function AR_refreshDashboards() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) return;
  try {
    if (typeof FDDATA_buildDataAndLists !== "function") {
      Logger.log("FDDATA_buildDataAndLists not found.");
      return;
    }
    FDDATA_buildDataAndLists();
  } catch (err) {
    Logger.log("AR_refreshDashboards error: " + (err && err.stack ? err.stack : err));
  } finally {
    lock.releaseLock();
  }
}