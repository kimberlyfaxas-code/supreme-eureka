/*******************************************************
 * Triggers.gs
 * Installable onEdit trigger handler (runs as owner).
 *
 * BUG FIX: Removed LD_debugWhoAmI() nested inside TR_onEdit
 * and TR_installOnEditTrigger — nested function declarations
 * are a syntax error in V8 strict mode and prevented ALL
 * scripts from loading.
 *******************************************************/

function TR_onEdit(e) {
  try {
    if (!e || !e.range) return;

    Logger.log("TR_onEdit fired | Sheet: " + e.range.getSheet().getName() +
               " | Cell: " + e.range.getA1Notation());

    if (typeof MA_onEdit === "function") {
      MA_onEdit(e);
    } else {
      Logger.log("MA_onEdit not found");
    }

    if (typeof AR_requestRefreshFromEdit_ === "function") {
      AR_requestRefreshFromEdit_(e);
    } else {
      Logger.log("AR_requestRefreshFromEdit_ not found");
    }

  } catch (err) {
    Logger.log("TR_onEdit error: " + err);
  }
}

/**
 * Run once to install the onEdit trigger for this spreadsheet.
 */
function TR_installOnEditTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("No active spreadsheet. Open the forecast sheet and run again.");

  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction && t.getHandlerFunction();
    const evt = t.getEventType && t.getEventType();
    if (fn === "TR_onEdit") ScriptApp.deleteTrigger(t);
    if (evt === ScriptApp.EventType.ON_EDIT) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("TR_onEdit")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  ss.toast("Installed installable onEdit trigger (TR_onEdit).", "Forecast Tools", 5);
}

/**
 * Debug helper — run manually from the script editor.
 */
function TR_debugWhoAmI() {
  Logger.log("Effective user: " + Session.getEffectiveUser().getEmail());
  Logger.log("Active user: " + Session.getActiveUser().getEmail());
}

/**
 * Optional quick test: simulate a manual row submission.
 * Change rowToTest to a real data row in Manual_Forecast_AddOns.
 */
function TR_testManualSubmit() {
  const rowToTest = 4;
  if (typeof MA_submitManualRow_ !== "function") {
    throw new Error("MA_submitManualRow_ not found.");
  }
  MA_submitManualRow_(rowToTest);
}
