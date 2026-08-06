/*******************************************************
 * ChurnLog.gs
 *
 * Builds "Lost_Accounts_FY2026" — a full-row copy of every
 * line in CSM_Working_Forecast where Forecast Category is
 * any "Not Expected" variant (Lost Account, Non-Recurring,
 * Data Error, etc.).
 *
 * Adds a "Date First Logged" column. On each rebuild the
 * date is PRESERVED for accounts already in the log, so
 * you keep a record of when each account was first flagged.
 * New accounts get today's date automatically.
 *******************************************************/
const CL = {
  SOURCE:  "CSM_Working_Forecast",
  OUTPUT:  "Lost_Accounts_FY2026",
  DATE_HEADER: "Date First Logged",
  // Case-insensitive substrings that flag a row as lost/not-expected
  LOST_PATTERNS: ["not expected", "non-recurring", "data error"],
  // Priority order for finding a stable account key
  ID_CANDIDATES: [
    "account full id",
    "salesforce account id (full id)",
    "salesforce account id",
    "account id",
    "sfid",
    "student org id"
  ]
};

function CL_buildChurnLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(CL.SOURCE);
  if (!source) throw new Error("Missing sheet: " + CL.SOURCE);

  const lastRow = source.getLastRow();
  const lastCol = source.getLastColumn();
  if (lastRow < 2) {
    ss.toast("No data in " + CL.SOURCE, "Lost Logo Log", 4);
    return;
  }

  // Read source — getValues preserves Date objects and numbers
  const headers = source.getRange(1, 1, 1, lastCol).getValues()[0];
  const allData  = source.getRange(2, 1, lastRow - 1, lastCol).getValues();

  // Locate Forecast Category column (0-based index)
  const fcatIdx = headers.findIndex(h =>
    String(h).trim().toLowerCase() === "forecast category"
  );
  if (fcatIdx < 0) throw new Error("'Forecast Category' column not found in " + CL.SOURCE);

  // Locate best account ID column for date preservation (0-based)
  const idIdx = CL.ID_CANDIDATES.reduce((found, candidate) => {
    if (found >= 0) return found;
    return headers.findIndex(h => String(h).trim().toLowerCase() === candidate);
  }, -1);

  // Filter rows matching any lost pattern
  const lostRows = allData.filter(row => {
    const cat = String(row[fcatIdx] || "").toLowerCase().trim();
    return CL.LOST_PATTERNS.some(p => cat.includes(p));
  });

  // ── Preserve existing "Date First Logged" by account ID ──────────────
  const dateMap = {};
  const existing = ss.getSheetByName(CL.OUTPUT);
  if (existing && existing.getLastRow() > 1) {
    const exLastCol = existing.getLastColumn();
    const exHeaders = existing.getRange(1, 1, 1, exLastCol).getValues()[0];
    const exDateIdx = exHeaders.findIndex(h => String(h).trim() === CL.DATE_HEADER);
    const exIdIdx   = idIdx >= 0
      ? exHeaders.findIndex(h =>
          String(h).trim().toLowerCase() === String(headers[idIdx]).trim().toLowerCase())
      : -1;
    if (exDateIdx >= 0 && exIdIdx >= 0 && existing.getLastRow() > 1) {
      existing.getRange(2, 1, existing.getLastRow() - 1, exLastCol)
        .getValues()
        .forEach(row => {
          const id = String(row[exIdIdx] || "").trim();
          const dt = row[exDateIdx];
          if (id && dt) dateMap[id] = dt;
        });
    }
  }

  // ── Build output sheet ───────────────────────────────────────────────
  let out = ss.getSheetByName(CL.OUTPUT);
  if (!out) {
    out = ss.insertSheet(CL.OUTPUT);
  } else {
    out.clearContents();
    out.clearFormats();
    out.clearConditionalFormatRules();
  }

  const outHeaders = [...headers, CL.DATE_HEADER];
  const today = new Date();

  // Add Date First Logged to each row
  const outputRows = lostRows.map(row => {
    const accountId = idIdx >= 0 ? String(row[idIdx] || "").trim() : "";
    const dateLogged = (accountId && dateMap[accountId]) ? dateMap[accountId] : today;
    return [...row, dateLogged];
  });

  // Header row
  out.getRange(1, 1, 1, outHeaders.length)
    .setValues([outHeaders])
    .setFontWeight("bold")
    .setBackground("#0b2e4d")
    .setFontColor("#ffffff")
    .setFontSize(11);
  out.setFrozenRows(1);
  out.setRowHeight(1, 30);

  if (outputRows.length === 0) {
    out.getRange(2, 1).setValue("No accounts currently marked as Not Expected.");
    ss.toast("No lost accounts found.", "Lost Logo Log", 4);
    return;
  }

  // Write all data rows
  out.getRange(2, 1, outputRows.length, outHeaders.length).setValues(outputRows);

  // ── Formatting ───────────────────────────────────────────────────────

  // Dollar columns (Baseline Amount, Forecast Amount, 2025 Total, etc.)
  outHeaders.forEach((h, i) => {
    const lower = String(h).toLowerCase();
    if (lower.includes("amount") || lower.includes("total") || lower.includes("revenue")) {
      out.getRange(2, i + 1, outputRows.length, 1)
        .setNumberFormat("$#,##0.00;($#,##0.00)");
    }
  });

  // Date columns (Baseline Month, Forecast Month — but NOT Date First Logged which is already a Date)
  outHeaders.forEach((h, i) => {
    const lower = String(h).toLowerCase();
    if (lower.includes("month") || (lower.includes("date") && !lower.includes("logged"))) {
      out.getRange(2, i + 1, outputRows.length, 1).setNumberFormat("m/d/yyyy");
    }
  });

  // Date First Logged column
  const dateColNum = outHeaders.length;
  out.getRange(2, dateColNum, outputRows.length, 1).setNumberFormat("m/d/yyyy");

  // Alternating row backgrounds
  for (let r = 0; r < outputRows.length; r++) {
    out.getRange(r + 2, 1, 1, outHeaders.length)
      .setBackground(r % 2 === 0 ? "#ffffff" : "#f8fafc");
  }
  out.setRowHeights(2, outputRows.length, 21);

  // Conditional formatting on Forecast Category column
  const fcatOutRange = out.getRange(2, fcatIdx + 1, outputRows.length, 1);
  out.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("Lost Account")
      .setBackground("#FEE2E2").setFontColor("#991B1B")
      .setRanges([fcatOutRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("not expected")
      .setBackground("#FEE2E2").setFontColor("#991B1B")
      .setRanges([fcatOutRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("Non-Recurring")
      .setBackground("#FEF9C3").setFontColor("#854D0E")
      .setRanges([fcatOutRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("Data Error")
      .setBackground("#FEF9C3").setFontColor("#854D0E")
      .setRanges([fcatOutRange]).build()
  ]);

  ss.toast(
    outputRows.length + " accounts logged.",
    "Lost Logo Log", 5
  );
}
