/******************************************************
 * Triggers.gs
 * - Installable onEdit trigger handler (runs as owner)
 * - Routes:
 *    1) MSF_onEdit_(e) for dashboard multi-select filters
 *    2) MA_onEdit(e) for manual add-ons submit workflow (if present)
 *    3) AR_requestRefreshFromEdit_(e) debounced refresh request (if present)
 *******************************************************/
function TR_onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (!sh) return;
    const shName = sh.getName();
    const isDash =
      shName === "Health Retention Dashboard (FY2026)" ||
      shName === "CSM Retention Dashboard (FY2026)" ||
      shName === "FY2026 Monthly Waterfall";
    // 1) Dashboard filter behavior (multi-select) — NEVER trigger rebuilds
    if (isDash) {
      if (typeof MSF_onEdit_ === "function") MSF_onEdit_(e);
      return; // critical: dashboard edits should NOT trigger MA/AR
    }
    // 2) Manual add-ons sync (if present)
    if (typeof MA_onEdit === "function") {
      MA_onEdit(e);
    }
    // 3) Refresh request (debounced) (if present)
    if (typeof AR_requestRefreshFromEdit_ === "function") {
      AR_requestRefreshFromEdit_(e);
    }
  } catch (err) {
    Logger.log("TR_onEdit error: %s", err && err.stack ? err.stack : err);
  }
}
/**
 * Run once to install the onEdit trigger for THIS spreadsheet.
 */
function TR_installOnEditTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("No active spreadsheet found. Open the forecast sheet and run again.");
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction && t.getHandlerFunction();
    if (fn === "TR_onEdit") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("TR_onEdit")
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  SpreadsheetApp.getActive().toast("Installed onEdit trigger (TR_onEdit).", "Forecast Tools", 5);
}