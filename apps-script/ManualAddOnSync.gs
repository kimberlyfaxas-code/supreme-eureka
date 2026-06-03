/*******************************************************
 * ManualAddOnSync.gs (FINAL)
 *
 * Manual Add-ons intake + one-time submit to Working.
 *
 * Behavior:
 * - CSM fills a row in Manual_Forecast_AddOns
 * - When "Include in Forecast" is checked, we submit ONCE to CSM_Working_Forecast
 * - We DO NOT overwrite existing Working edits (we only fill blanks)
 * - We DO NOT create duplicates (Manual Line ID)
 * - We DO autofill ownership-derived fields from Ownership_Refresh
 *   (Ownership uses: "FULL ID" + "Client Success Manager")
 * - We DO NOT autofill Product Group (manual only)
 * - Manual row stays as a record (we do NOT delete rows)
 *******************************************************/
const MA_CFG = {
  MANUAL_SHEET_NAME: "Manual_Forecast_AddOns",
  WORKING_SHEET_NAME: "CSM_Working_Forecast",
  OWNERSHIP_SHEET_NAME: "Ownership_Refresh",
  FORECAST_SOURCE_VALUE: "Manual Add",
  FORECAST_LINE_TYPE_VALUE: "Forecast",
  // Script-managed columns on Manual tab
  MANUAL_LINE_ID_HEADER: "Manual Line ID",
  SUBMITTED_AT_HEADER: "Submitted At",
  // ID header candidates
  MANUAL_ID_HEADERS: [
    "Salesforce Account ID (FULL ID)",
    "Account Full ID",
    "FULL ID",
    "Salesforce Account ID",
    "Account ID",
    "SFID"
  ],
  OWNERSHIP_ID_HEADERS: [
    "FULL ID",
    "Account Full ID",
    "Salesforce Account ID (FULL ID)",
    "Salesforce Account ID",
    "Account ID",
    "SFID"
  ],
  // Ownership -> Working mapping (FIXED: no duplicate keys)
  OWNERSHIP_TO_WORKING: {
    "Account Name": "Account Name",
    "Rating": "Health Rating",
    "Billing State/Province": "Billing State/Province",
    "Billing Country": "Billing Country",
    "Account Owner": "Account Owner",
    "Parent Account": "Parent Account",
    "Student Org Id": "Student Org ID",
    "Client Success Manager": "Current CSM"
  }
};
/**
 * Called by router onEdit(e) (see Triggers.gs).
 * Runs when the edit touches the Include in Forecast column.
 * Handles:
 * - single checkbox click
 * - multi-row checkbox fill
 * - multi-column paste that includes the checkbox column
 */
function MA_onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== MA_CFG.MANUAL_SHEET_NAME) return;
    const hm = MA_headerMap_(sh);
    const includeCol =
      hm["Include in Forecast"] || hm["Include"] || hm["Use"] || hm["Active"];
    if (!includeCol) return;
    // ✅ KEY FIX: handle multi-column edits/pastes
    const editStartCol = e.range.getColumn();
    const editEndCol = e.range.getLastColumn();
    const touchesIncludeCol = (includeCol >= editStartCol && includeCol <= editEndCol);
    if (!touchesIncludeCol) return;
    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(8000)) return;
    try {
      const startRow = e.range.getRow();
      const numRows = e.range.getNumRows();
      // Read the checkbox values from the actual include column
      const vals = sh.getRange(startRow, includeCol, numRows, 1).getValues();
      for (let i = 0; i < numRows; i++) {
        const r = startRow + i;
        if (r < 2) continue;
        if (vals[i][0] === true) {
          MA_submitManualRow_(r);
        }
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log("MA_onEdit error: " + err);
  }
}
/**
 * Main submit: one manual row -> one working row (by Manual Line ID).
 */
function MA_submitManualRow_(manualRow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const manual = ss.getSheetByName(MA_CFG.MANUAL_SHEET_NAME);
  const working = ss.getSheetByName(MA_CFG.WORKING_SHEET_NAME);
  const ownership = ss.getSheetByName(MA_CFG.OWNERSHIP_SHEET_NAME);
  if (!manual) throw new Error(`Missing sheet: ${MA_CFG.MANUAL_SHEET_NAME}`);
  if (!working) throw new Error(`Missing sheet: ${MA_CFG.WORKING_SHEET_NAME}`);
  if (!ownership) throw new Error(`Missing sheet: ${MA_CFG.OWNERSHIP_SHEET_NAME}`);
  // Ensure script-managed columns exist on Manual sheet
  MA_ensureColumn_(manual, MA_CFG.MANUAL_LINE_ID_HEADER);
  MA_ensureColumn_(manual, MA_CFG.SUBMITTED_AT_HEADER);
  MA_ensureColumn_(manual, "Booking Type");   // NEW
 
  // Ensure Manual Line ID exists on Working sheet
  MA_ensureColumn_(working, MA_CFG.MANUAL_LINE_ID_HEADER);
  MA_ensureColumn_(working, "Booking Type");  // NEW
  // Rebuild header maps AFTER ensuring columns exist
  const mh = MA_headerMap_(manual);
  const wh = MA_headerMap_(working);
  const manualIdCol = mh[MA_CFG.MANUAL_LINE_ID_HEADER];
  const submittedCol = mh[MA_CFG.SUBMITTED_AT_HEADER];
  const includeCol = mh["Include in Forecast"] || mh["Include"] || mh["Use"] || mh["Active"];
  const fmCol = mh["Forecast Month"];
  const faCol = mh["Forecast Amount"];
  const btCol = mh["Booking Type"]; // NEW
  if (!includeCol || !fmCol || !faCol || !btCol) {
  throw new Error('Manual tab must include: "Include in Forecast", "Booking Type", "Forecast Month", "Forecast Amount".');
  }
  const idCol = MA_findAnyHeaderCol_(mh, MA_CFG.MANUAL_ID_HEADERS);
  if (!idCol) {
    throw new Error(`Manual tab missing an ID column. Add one of: ${MA_CFG.MANUAL_ID_HEADERS.join(", ")}`);
  }
  const rowVals = manual.getRange(manualRow, 1, 1, manual.getLastColumn()).getValues()[0];
  // Already submitted?
  const alreadySubmitted = submittedCol ? String(rowVals[submittedCol - 1] || "").trim() : "";
  if (alreadySubmitted) return;
  // Required fields
  const acctId = MA_normId_(rowVals[idCol - 1]);
  const fMonth = rowVals[fmCol - 1];
  const fAmt = MA_toNumber_(rowVals[faCol - 1]);
  const bookingType = String(rowVals[btCol - 1] || "").trim(); // Account Name (robust: accept common header variants; do NOT create a new column)
const acctNameCol =
  mh["Account Name"] ||
  mh["Account"] ||
  mh["Customer"] ||
  mh["Customer Name"] ||
  mh["Client"] ||
  mh["Client Name"];
const manualAccountName = acctNameCol
  ? String(rowVals[acctNameCol - 1] || "").trim()
  : "";
// If this is a New Sale, require Account Name (ownership may not exist yet)
if (bookingType === "New Sale" && !manualAccountName) {
  manual.getRange(manualRow, includeCol).setValue(false);
  ss.toast(
    "For New Sales, please fill Account Name before submitting.",
    "Manual Add Not Submitted",
    6
  );
  return;
}
// If this is a New Sale, require Account Name (ownership may not exist yet)
if (bookingType === "New Sale" && !manualAccountName) {
manual.getRange(manualRow, includeCol).setValue(false);
ss.toast(
"For New Sales, please fill Account Name before submitting.",
"Manual Add Not Submitted",
6
);
return;
}
  // IMPORTANT: treat blank differently from 0
  const fAmtRaw = rowVals[faCol - 1];
  const fAmtIsBlank = (fAmtRaw === "" || fAmtRaw === null || typeof fAmtRaw === "undefined");
  if (!acctId || !bookingType || !fMonth || fAmtIsBlank || isNaN(fAmt)) {
    manual.getRange(manualRow, includeCol).setValue(false);
    ss.toast("Fill Account ID + Booking Type + Forecast Month + Forecast Amount first.", "Manual Add Not Submitted", 5);
    return;
  }
  // Manual Line ID
  let lineId = String(rowVals[manualIdCol - 1] || "").trim();
  if (!lineId) {
    lineId = Utilities.getUuid();
    manual.getRange(manualRow, manualIdCol).setValue(lineId);
  }
  // Dedupe in Working by Manual Line ID
  const workingManualIdCol = wh[MA_CFG.MANUAL_LINE_ID_HEADER];
  if (!workingManualIdCol) throw new Error('Working tab missing "Manual Line ID" column (script should have added it).');
  const existingWorkingRow = MA_findWorkingRowByManualLineId_(working, workingManualIdCol, lineId);
  // Ownership lookup
  const own = MA_lookupOwnership_(ownership, acctId);
if (existingWorkingRow) {
  MA_fillWorkingBlanks_(manual, working, manualRow, existingWorkingRow, mh, wh, own);
} else {
  const outRow = MA_buildWorkingRow_(working, mh, wh, rowVals, acctId, lineId, own);
  const targetRow = working.getLastRow() + 1;
  // 1) Copy formatting + data validation from previous row so dropdowns/formatting persist
  if (targetRow > 2) {
    working.getRange(targetRow - 1, 1, 1, working.getLastColumn())
      .copyTo(
        working.getRange(targetRow, 1, 1, working.getLastColumn()),
        { formatOnly: true }
      );
  }
  // 2) Write values
  working.getRange(targetRow, 1, 1, outRow.length).setValues([outRow]);
  SpreadsheetApp.flush();
}
  // Mark submitted timestamp
  manual.getRange(manualRow, submittedCol).setValue(new Date());
  ss.toast("Manual Add submitted to Working.", "Forecast Tools", 4);
}
/* ===================== WORKING ROW BUILD ===================== */
function MA_buildWorkingRow_(working, mh, wh, manualRowVals, acctId, lineId, own) {
  const headers = working.getRange(1, 1, 1, working.getLastColumn()).getValues()[0];
  const out = new Array(headers.length).fill("");
  const set = (header, value) => {
    const col = wh[header];
    if (!col) return;
    out[col - 1] = value;
  };
  // IDs + tags
  // IDs + tags (write ID to whichever ID header exists in Working)
MA_setFirstHeader_(wh, out, [
"Account Full ID",
"Salesforce Account ID (FULL ID)",
"FULL ID",
"Salesforce Account ID",
"Account ID",
"SFID"
], acctId);
  set("Forecast Source", MA_CFG.FORECAST_SOURCE_VALUE);
  set("Forecast Line Type", MA_CFG.FORECAST_LINE_TYPE_VALUE);
  set(MA_CFG.MANUAL_LINE_ID_HEADER, lineId);
  // Ownership-derived fields
  if (own) {
    for (const [ownHeader, workHeader] of Object.entries(MA_CFG.OWNERSHIP_TO_WORKING)) {
      if (own[ownHeader] !== undefined && own[ownHeader] !== "") set(workHeader, own[ownHeader]);
    }
  }
  // Account Name override from manual only if provided
  if (mh["Account Name"]) {
    const manualName = String(manualRowVals[mh["Account Name"] - 1] || "").trim();
    if (manualName) set("Account Name", manualName);
  }
  // Product Group: manual only (do NOT autofill)
  if (mh["Product Group"]) {
    const prod = String(manualRowVals[mh["Product Group"] - 1] || "").trim();
    if (prod) set("Product Group", prod);
  }
  // Booking Type: manual only (Renewal / New Sale)
  if (mh["Booking Type"] && wh["Booking Type"]) {
    const bt = String(manualRowVals[mh["Booking Type"] - 1] || "").trim();
    if (bt) set("Booking Type", bt);
  }
  // Baseline rules for manual adds
  const fMonth = manualRowVals[mh["Forecast Month"] - 1];
  set("Baseline Month", fMonth);
  set("Baseline Amount", 0);
  // Forecast fields
  set("Forecast Month", fMonth);
  set("Forecast Amount", MA_toNumber_(manualRowVals[mh["Forecast Amount"] - 1]));
  if (mh["Forecast Category"]) set("Forecast Category", manualRowVals[mh["Forecast Category"] - 1]);
  if (mh["Outreach Status"]) set("Outreach Status", manualRowVals[mh["Outreach Status"] - 1]);
  if (mh["Latest Comment"]) set("Latest Comment", manualRowVals[mh["Latest Comment"] - 1]);
  return out;
}
/**
 * If working row exists already, fill only blanks (never overwrite).
 */
function MA_fillWorkingBlanks_(manual, working, manualRow, workingRow, mh, wh, own) {
  const wVals = working.getRange(workingRow, 1, 1, working.getLastColumn()).getValues()[0];
  const mVals = manual.getRange(manualRow, 1, 1, manual.getLastColumn()).getValues()[0];
  const fill = (header, value) => {
    const col = wh[header];
    if (!col) return;
    const idx = col - 1;
    const blank = (wVals[idx] === "" || wVals[idx] === null);
    if (blank && value !== "" && value !== null && value !== undefined) {
      working.getRange(workingRow, col).setValue(value);
    }
  };
  // Ownership first (only blanks)
  if (own) {
    for (const [ownHeader, workHeader] of Object.entries(MA_CFG.OWNERSHIP_TO_WORKING)) {
      if (own[ownHeader] !== undefined && own[ownHeader] !== "") fill(workHeader, own[ownHeader]);
    }
  }
  // Manual fields: override only if manual supplied
  if (mh["Account Name"]) {
    const manualName = String(mVals[mh["Account Name"] - 1] || "").trim();
    if (manualName) fill("Account Name", manualName);
  }
  if (mh["Product Group"]) {
    const prod = String(mVals[mh["Product Group"] - 1] || "").trim();
    if (prod) fill("Product Group", prod);
  }
  // Booking Type: fill only if blank in Working
  if (mh["Booking Type"] && wh["Booking Type"]) {
    const bt = String(mVals[mh["Booking Type"] - 1] || "").trim();
    if (bt) fill("Booking Type", bt);
  }
  // Forecast fields
  if (mh["Forecast Month"]) fill("Forecast Month", mVals[mh["Forecast Month"] - 1]);
  if (mh["Forecast Amount"]) fill("Forecast Amount", MA_toNumber_(mVals[mh["Forecast Amount"] - 1]));
  if (mh["Forecast Category"] && wh["Forecast Category"]) fill("Forecast Category", mVals[mh["Forecast Category"] - 1]);
  if (mh["Outreach Status"] && wh["Outreach Status"]) fill("Outreach Status", mVals[mh["Outreach Status"] - 1]);
  if (mh["Latest Comment"] && wh["Latest Comment"]) fill("Latest Comment", mVals[mh["Latest Comment"] - 1]);
  // Baseline rules for manual adds
  if (mh["Forecast Month"]) fill("Baseline Month", mVals[mh["Forecast Month"] - 1]);
  fill("Baseline Amount", 0);
  // Tags
  fill("Forecast Source", MA_CFG.FORECAST_SOURCE_VALUE);
  fill("Forecast Line Type", MA_CFG.FORECAST_LINE_TYPE_VALUE);
}
/* ===================== OWNERSHIP LOOKUP ===================== */
function MA_lookupOwnership_(ownership, acctIdNorm) {
  const hm = MA_headerMap_(ownership);
  const idCol = MA_findAnyHeaderCol_(hm, MA_CFG.OWNERSHIP_ID_HEADERS);
  if (!idCol) return null;
  const lastRow = ownership.getLastRow();
  const lastCol = ownership.getLastColumn();
  const data = (lastRow >= 2) ? ownership.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  const acct = MA_normId_(acctIdNorm);
  const row = data.find(r => MA_normId_(r[idCol - 1]) === acct);
  if (!row) return null;
  const get = (h) => hm[h] ? row[hm[h] - 1] : "";
  return {
    "Account Name": get("Account Name"),
    "Rating": get("Rating"),
    "Billing State/Province": get("Billing State/Province"),
    "Billing Country": get("Billing Country"),
    "Account Owner": get("Account Owner"),
    "Parent Account": get("Parent Account"),
    "Student Org Id": get("Student Org Id"),
    "Client Success Manager": get("Client Success Manager")
  };
}
/* ===================== UTILITIES ===================== */
function MA_headerMap_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => map[String(h || "").trim()] = i + 1);
  return map;
}
function MA_findAnyHeaderCol_(headerMap, candidates) {
  for (const h of candidates) {
    if (headerMap[h]) return headerMap[h];
  }
  return null;
}
function MA_setFirstHeader_(wh, outArr, headers, value) {
for (const h of headers) {
const col = wh[h];
if (col) {
outArr[col - 1] = value;
return true;
}
}
return false;
}
function MA_normId_(v) {
  return String(v || "").trim().replace(/[^a-zA-Z0-9]/g, "");
}
function MA_toNumber_(v) {
  if (typeof v === "number") return v;
  const s = String(v || "").replace(/[$,]/g, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function MA_ensureColumn_(sheet, headerName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || "").trim());
  if (headers.includes(headerName)) return;
  sheet.getRange(1, sheet.getLastColumn() + 1).setValue(headerName).setFontWeight("bold");
}
function MA_findWorkingRowByManualLineId_(working, manualLineIdCol, lineId) {
  const lastRow = working.getLastRow();
  if (lastRow < 2) return 0;
  const vals = working.getRange(2, manualLineIdCol, lastRow - 1, 1).getValues().flat();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i] || "").trim() === String(lineId).trim()) return i + 2;
  }
  return 0;
}