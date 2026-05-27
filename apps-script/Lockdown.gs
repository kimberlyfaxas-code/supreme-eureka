*******************************************************
 * Lockdown.gs (REVISED - FINAL)
 *
 * What this does:
 * - WORKING: protects all NON-editable columns starting row 2 (row 1 LEFT UNPROTECTED so filtering works normally)
 * - MANUAL: protects non-input columns; script-managed cols still writable by owner/script
 * - DASHBOARDS: sheet protection + unprotected filter cells (no per-cell protections)
 * - OWNERSHIP/ADJ/HELPER/LISTS: fully locked
 *******************************************************/
const LD_CFG = {
  WORKING: "CSM_Working_Forecast",
  MANUAL: "Manual_Forecast_AddOns",
  EXEC_DASH: "Health Retention Dashboard (FY2026)",
  CSM_DASH: "CSM Retention Dashboard (FY2026)",
  ADJUSTMENTS: "2026_Adjustments",
  OWNERSHIP: "Ownership_Refresh",
  HELPER: "_Dashboard_Data",
  LISTS: "_Dashboard_Lists",
  // ✅ Only these columns editable by CSMs on WORKING
  // Added: Booking Type
  WORKING_EDITABLE_HEADERS: [
    "Forecast Category",
    "Forecast Month",
    "Forecast Amount",
    "Outreach Status",
    "Latest Comment",
    "Booking Type"
  ],
  // ✅ Manual tab: columns CSMs can fill in
  // Added: Booking Type (include synonyms just in case)
  MANUAL_EDITABLE_HEADERS: [
    "Salesforce Account ID (FULL ID)",
    "Account Full ID",
    "FULL ID",
    "Account Name",
    "Product Group",
    "Booking Type",
    "BookingType",
    "Sales Type", // (legacy name if any old column exists)
    "Forecast Category",
    "Forecast Month",
    "Forecast Amount",
    "Outreach Status",
    "Latest Comment",
    "Include in Forecast"
  ],
  // Script-managed columns on Manual tab (NOT editable by CSMs, but script must write)
  MANUAL_SCRIPT_HEADERS: [
    "Manual Line ID",
    "Submitted At"
  ],
// Dashboard filter cells (these are left editable inside a protected sheet)
EXEC_FILTER_CELLS: ["C2","E2","G2","I2","K2","M2","O2"], // Product, Sales, CSM, Outreach, Category, Manual, Adjs
CSM_FILTER_CELLS:  ["C2","E2","G2","I2","K2","M2"],      // CSM, Product, Sales, Outreach, Category, Adjs
  PROTECT_BUFFER_ROWS: 2000,
  TAG: "LOCKDOWN_v6"
};
/**
 * Forecast Tools -> Lockdown
 */
function FT_lockdownAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  LD_removeOurProtections_(ss);
  LD_lockWorking_(ss);
  LD_lockManual_(ss);
  LD_lockDashboard_(ss, LD_CFG.EXEC_DASH, LD_CFG.EXEC_FILTER_CELLS);
  LD_lockDashboard_(ss, LD_CFG.CSM_DASH, LD_CFG.CSM_FILTER_CELLS);
  LD_lockSheetFully_(ss, LD_CFG.OWNERSHIP);
  LD_lockSheetFully_(ss, LD_CFG.ADJUSTMENTS);
  LD_lockSheetFully_(ss, LD_CFG.HELPER);
  LD_lockSheetFully_(ss, LD_CFG.LISTS);
  ss.toast("Lockdown applied (Working filters normal + manual adds + scripts should still work).", "Forecast Tools", 6);
}
function FT_unlockAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  LD_removeOurProtections_(ss);
  ss.toast("Lockdown removed.", "Forecast Tools", 5);
}
/* ========================= WORKING ========================= */
function LD_lockWorking_(ss) {
  const sh = ss.getSheetByName(LD_CFG.WORKING);
  if (!sh) throw new Error(`Missing sheet: ${LD_CFG.WORKING}`);
  const headerMap = LD_headerMap_(sh);
  const lastDataRow = Math.max(sh.getLastRow(), 2);
  const lastProtectRow = Math.min(sh.getMaxRows(), lastDataRow + LD_CFG.PROTECT_BUFFER_ROWS);
  const maxCol = sh.getLastColumn();
  // ✅ IMPORTANT: do NOT protect row 1 so users can filter normally with no warnings.
  const editableCols = new Set();
  LD_CFG.WORKING_EDITABLE_HEADERS.forEach(h => {
    const c = headerMap[h];
    if (c) editableCols.add(c);
  });
  const numRows = Math.max(0, lastProtectRow - 1);
  for (let c = 1; c <= maxCol; c++) {
    if (editableCols.has(c)) continue;
    if (numRows <= 0) continue;
    LD_protectRange_(sh.getRange(2, c, numRows, 1), `${LD_CFG.TAG} | WORKING_COL_${c}`);
  }
}
/* ========================= MANUAL ========================= */
function LD_lockManual_(ss) {
  const sh = ss.getSheetByName(LD_CFG.MANUAL);
  if (!sh) return;
  const headerMap = LD_headerMap_(sh);
  const lastDataRow = Math.max(sh.getLastRow(), 2);
  const lastProtectRow = Math.min(sh.getMaxRows(), lastDataRow + LD_CFG.PROTECT_BUFFER_ROWS);
  const maxCol = sh.getLastColumn();
  // Protect header row
  LD_protectRange_(sh.getRange(1, 1, 1, maxCol), `${LD_CFG.TAG} | MANUAL_HEADER`);
  const editableCols = new Set();
  LD_CFG.MANUAL_EDITABLE_HEADERS.forEach(h => {
    const c = headerMap[h];
    if (c) editableCols.add(c);
  });
  const numRows = Math.max(0, lastProtectRow - 1);
  for (let c = 1; c <= maxCol; c++) {
    if (editableCols.has(c)) continue;
    if (numRows <= 0) continue;
    LD_protectRange_(sh.getRange(2, c, numRows, 1), `${LD_CFG.TAG} | MANUAL_COL_${c}`);
  }
}
/* ========================= DASHBOARDS ========================= */
function LD_lockDashboard_(ss, sheetName, filterCellsA1) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  const p = sh.protect().setDescription(`${LD_CFG.TAG} | DASH_SHEET_${sheetName}`);
  p.setWarningOnly(false);
  const unprotected = filterCellsA1.map(a1 => sh.getRange(a1));
  try {
    p.setUnprotectedRanges(unprotected);
  } catch (e) {
    Logger.log(`setUnprotectedRanges failed for ${sheetName}: ${e}`);
  }
  LD_applyEditorsSafely_(p);
}
/* ========================= FULL LOCK SHEETS ========================= */
function LD_lockSheetFully_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return;
  const p = sh.protect().setDescription(`${LD_CFG.TAG} | FULL_${sheetName}`);
  p.setWarningOnly(false);
  LD_applyEditorsSafely_(p);
}
/* ========================= PROTECTION HELPERS ========================= */
function LD_removeOurProtections_(ss) {
  ss.getSheets().forEach(sh => {
    sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => {
      const d = String(p.getDescription() || "");
      if (d.includes(LD_CFG.TAG)) {
        try { p.remove(); } catch (e) {}
      }
    });
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => {
      const d = String(p.getDescription() || "");
      if (d.includes(LD_CFG.TAG)) {
        try { p.remove(); } catch (e) {}
      }
    });
  });
}
function LD_protectRange_(range, description) {
  const p = range.protect();
  p.setDescription(description);
  p.setWarningOnly(false);
  // allow filter/sort where applicable
  try { p.setAllowFilter(true); } catch (e) {}
  LD_applyEditorsSafely_(p);
  return p;
}
/**
 * Ensure owner can always edit protected ranges (so scripts can write).
 * Hard-set to Kim's email.
 */
function LD_applyEditorsSafely_(protection) {
  try { protection.setDomainEdit(false); } catch (e) {}
  const OWNER_EMAIL = "kimberly.faxas@kaplan.edu";
  if (!OWNER_EMAIL || !OWNER_EMAIL.includes("@")) return;
  try { protection.addEditor(OWNER_EMAIL); } catch (e) {}
  try {
    const editors = protection.getEditors() || [];
    editors.forEach(u => {
      const em = (u && u.getEmail && u.getEmail()) ? u.getEmail() : "";
      if (em && em.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
        protection.removeEditor(u);
      }
    });
  } catch (e) {}
}
function LD_headerMap_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h || "").trim();
    if (key) map[key] = i + 1;
  });
  return map;
}