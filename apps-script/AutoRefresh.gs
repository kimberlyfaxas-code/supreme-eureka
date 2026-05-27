/*******************************************************
 * AutoRefresh.gs
 * Auto-refresh dashboards on a timer + debounced onEdit.
 *
 * BUG FIX: Timer was incorrectly set to everyMinutes(1).
 * Now correctly set to everyMinutes(15) to avoid exhausting
 * Apps Script quota and causing UI freezes.
 *******************************************************/

const AR_CFG = {
  WATCH_SHEETS: new Set([
    "CSM_Working_Forecast",
    "Manual_Forecast_AddOns",
    "2026_Adjustments"
  ]),

  // Minimum gap between edit-triggered refreshes (seconds)
  DEBOUNCE_SECONDS: 90,

  PROP_LAST_REQUEST_TS: "AR_LAST_REQUEST_TS",
};

/**
 * Install triggers (run once manually from the script editor).
 * Creates a time-driven refresh every 15 minutes.
 */
function AR_installAutoRefresh() {
  AR_removeAutoRefreshTriggers_();

  ScriptApp.newTrigger("AR_refreshDashboards")
    .timeBased()
    .everyMinutes(15)
    .create();

  SpreadsheetApp.getActiveSpreadsheet()
    .toast("Auto-refresh installed (every 15 minutes).", "Forecast Tools", 5);
}

/**
 * Remove ONLY the auto-refresh triggers created by this project.
 */
function AR_removeAutoRefreshTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction && t.getHandlerFunction();
    if (fn === "AR_refreshDashboards") ScriptApp.deleteTrigger(t);
  });
}

/**
 * Called from TR_onEdit (Triggers.gs) when a watched sheet is edited.
 * Debounced to avoid constant rebuilds during rapid editing.
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
    AR_refreshDashboards();
  } catch (err) {
    Logger.log("AR_requestRefreshFromEdit_ error: " + err);
  }
}

/**
 * Safe refresh entrypoint.
 * Uses a lock to prevent concurrent rebuilds.
 */
function AR_refreshDashboards() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) {
    Logger.log("AR_refreshDashboards: lock not acquired, skipping.");
    return;
  }
  try {
    if (typeof FD_buildDashboards !== "function") {
      Logger.log("FD_buildDashboards not found.");
      return;
    }
    FD_buildDashboards();
  } catch (err) {
    Logger.log("AR_refreshDashboards error: " + err);
  } finally {
    lock.releaseLock();
  }
}
