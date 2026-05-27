/*******************************************************
 * BackfillOwnership.gs
 * Backfill of Current CSM (and optional fields) from
 * Ownership_Refresh into CSM_Working_Forecast.
 *
 * BUG FIXES:
 * 1. BF_setValuesIgnoringValidation_ was nested inside
 *    BF_backfillOwnership_ (invalid in V8 strict mode).
 *    Moved to top-level.
 * 2. Write-back used undefined variables (working, startRow,
 *    cCSM, numRows, out). Fixed to use correct variable `w`
 *    and write the entire wData array back.
 *******************************************************/

const BF_CFG = {
  WORKING_SHEET: "CSM_Working_Forecast",
  OWNERSHIP_SHEET: "Ownership_Refresh",

  WORKING_ID_HEADERS: [
    "Account Full ID",
    "Salesforce Account ID (FULL ID)",
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

  WORKING_CSM_HEADER: "Current CSM",
  OWNERSHIP_CSM_HEADERS: ["Client Success Manager", "Current CSM", "CSM"],

  OPTIONAL_FIELD_MAP: {
    "Account Owner": ["Account Owner"],
    "Billing Country": ["Billing Country"],
    "Billing State/Province": ["Billing State/Province"],
    "Health Rating": ["Rating", "Health Rating"],
    "Parent Account": ["Parent Account"],
    "Student Org ID": ["Student Org Id", "Student Org ID", "Student OrgID"]
  }
};

/** Fill blank Current CSM only (recommended). */
function BF_backfillCurrentCsm_fillBlanks() {
  BF_backfillOwnership_({ overwrite: false, includeOptionalFields: false });
}

/** Overwrite Current CSM even when already populated. */
function BF_backfillCurrentCsm_overwriteAll() {
  BF_backfillOwnership_({ overwrite: true, includeOptionalFields: false });
}

/** Backfill Current CSM + other ownership fields (blanks only). */
function BF_backfillCurrentCsm_plusFields_fillBlanks() {
  BF_backfillOwnership_({ overwrite: false, includeOptionalFields: true });
}

/* ===================== CORE ===================== */

function BF_backfillOwnership_({ overwrite, includeOptionalFields }) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const w = ss.getSheetByName(BF_CFG.WORKING_SHEET);
  const o = ss.getSheetByName(BF_CFG.OWNERSHIP_SHEET);

  if (!w) throw new Error(`Missing sheet: ${BF_CFG.WORKING_SHEET}`);
  if (!o) throw new Error(`Missing sheet: ${BF_CFG.OWNERSHIP_SHEET}`);

  const wHeaders = w.getRange(1, 1, 1, w.getLastColumn()).getDisplayValues()[0];
  const oHeaders = o.getRange(1, 1, 1, o.getLastColumn()).getDisplayValues()[0];

  const wMap = BF_headerMap_(wHeaders);
  const oMap = BF_headerMap_(oHeaders);

  const wIdCol = BF_findFirstCol_(wMap, BF_CFG.WORKING_ID_HEADERS);
  const oIdCol = BF_findFirstCol_(oMap, BF_CFG.OWNERSHIP_ID_HEADERS);

  if (!wIdCol) throw new Error(`Working sheet missing an ID column. Need one of: ${BF_CFG.WORKING_ID_HEADERS.join(", ")}`);
  if (!oIdCol) throw new Error(`Ownership sheet missing an ID column. Need one of: ${BF_CFG.OWNERSHIP_ID_HEADERS.join(", ")}`);

  const wCsmCol = wMap[BF_CFG.WORKING_CSM_HEADER];
  if (!wCsmCol) throw new Error(`Working sheet missing column: ${BF_CFG.WORKING_CSM_HEADER}`);

  const oCsmCol = BF_findFirstCol_(oMap, BF_CFG.OWNERSHIP_CSM_HEADERS);
  if (!oCsmCol) throw new Error(`Ownership sheet missing CSM column. Need one of: ${BF_CFG.OWNERSHIP_CSM_HEADERS.join(", ")}`);

  // Build ownership index keyed on first 15 chars of normalized ID
  const oLastRow = o.getLastRow();
  const oLastCol = o.getLastColumn();
  const oData = oLastRow >= 2 ? o.getRange(2, 1, oLastRow - 1, oLastCol).getValues() : [];
  const ownershipIndex = new Map();

  for (const r of oData) {
    const key = BF_normId15_(r[oIdCol - 1]);
    if (!key) continue;
    if (!ownershipIndex.has(key)) {
      ownershipIndex.set(key, {
        csm: String(r[oCsmCol - 1] || "").trim(),
        rawRow: r
      });
    }
  }

  // Prepare optional field column mapping
  const optionalTargets = [];
  if (includeOptionalFields) {
    Object.keys(BF_CFG.OPTIONAL_FIELD_MAP).forEach(wHeader => {
      const wCol = wMap[wHeader];
      if (!wCol) return;
      const oCol = BF_findFirstCol_(oMap, BF_CFG.OPTIONAL_FIELD_MAP[wHeader]);
      if (!oCol) return;
      optionalTargets.push({ wHeader, wCol, oCol });
    });
  }

  // Read all working data into memory
  const wLastRow = w.getLastRow();
  const wLastCol = w.getLastColumn();
  const wData = wLastRow >= 2 ? w.getRange(2, 1, wLastRow - 1, wLastCol).getValues() : [];

  let updates = 0, skipsNoId = 0, skipsNoMatch = 0, skipsAlreadyFilled = 0;

  for (let i = 0; i < wData.length; i++) {
    const row = wData[i];
    const key = BF_normId15_(row[wIdCol - 1]);

    if (!key) { skipsNoId++; continue; }

    const match = ownershipIndex.get(key);
    if (!match) { skipsNoMatch++; continue; }

    const currentCsm = String(row[wCsmCol - 1] || "").trim();
    if (!overwrite && currentCsm) { skipsAlreadyFilled++; continue; }

    const newCsm = match.csm;
    if (!newCsm) { skipsNoMatch++; continue; }

    row[wCsmCol - 1] = newCsm;

    if (includeOptionalFields) {
      for (const t of optionalTargets) {
        const existingVal = row[t.wCol - 1];
        if (!overwrite && existingVal !== "" && existingVal !== null) continue;
        const ownVal = match.rawRow[t.oCol - 1];
        if (ownVal === "" || ownVal === null || ownVal === undefined) continue;
        row[t.wCol - 1] = ownVal;
      }
    }

    updates++;
  }

  // Write the entire working data range back in one batch call
  if (wData.length > 0) {
    const rng = w.getRange(2, 1, wData.length, wLastCol);
    BF_setValuesIgnoringValidation_(rng, wData);
  }

  SpreadsheetApp.getActive().toast(
    `Backfill done. Updated: ${updates}. Skips — noID: ${skipsNoId}, noMatch: ${skipsNoMatch}, alreadyFilled: ${skipsAlreadyFilled}`,
    "Ownership Backfill",
    8
  );
}

/* ===================== HELPERS ===================== */

/**
 * Clears data validation, writes values, then restores validation.
 * Prevents validation rules from rejecting valid script-written values.
 * TOP-LEVEL (not nested) so Apps Script V8 can see it.
 */
function BF_setValuesIgnoringValidation_(range, values2d) {
  const firstCell = range.getSheet().getRange(range.getRow(), range.getColumn());
  const dv = firstCell.getDataValidation();
  range.clearDataValidations();
  range.setValues(values2d);
  if (dv) range.setDataValidation(dv);
}

function BF_headerMap_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h || "").trim();
    if (key) map[key] = i + 1;
  });
  return map;
}

function BF_findFirstCol_(map, candidates) {
  for (const h of candidates) {
    if (map[h]) return map[h];
  }
  return null;
}

function BF_normId15_(v) {
  const s = String(v || "").trim().replace(/[^a-zA-Z0-9]/g, "");
  if (!s) return "";
  return s.length >= 15 ? s.slice(0, 15) : s;
}
