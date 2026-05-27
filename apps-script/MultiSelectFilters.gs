/*******************************************************
 * MultiSelectFilters.gs (FIXED)
 * - Multi-select dropdown behavior for dashboard filters
 * - Mode filters remain single-select (Manual, Adjs)
 * - Mode filters reset to "Include" (never "All")
 *******************************************************/
const MSF_CFG = {
  ENABLED: true,
  DELIM: ", ",
  RESET_VALUES: new Set(["All", ""]),
  // Multi-select targets ONLY (keep this ONLY for Booking Type)
  TARGETS: {
    "Health Retention Dashboard (FY2026)": new Set(["E2"]), // Booking
    "CSM Retention Dashboard (FY2026)": new Set(["G2"]),    // Booking
    "FY2026 Monthly Waterfall": new Set(["H2"])             // Booking
  },
  // If you truly want Manual/Adjs ALWAYS included, DO NOT manage them here at all.
  MODE_CELLS: new Set([]),
  MODE_DEFAULTS: {}
};
function MSF_onEdit_(e) {
  try {
    if (!MSF_CFG.ENABLED) return;
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    const sheetName = sh.getName();
    const a1 = e.range.getA1Notation();
    const key = `${sheetName}!${a1}`;
    const newVal = String(e.value || "").trim();
    const oldVal = String(e.oldValue || "").trim();
    // MODE CELLS (single select)
    if (MSF_CFG.MODE_CELLS.has(key)) {
      if (MSF_CFG.RESET_VALUES.has(newVal)) {
        e.range.setValue(MSF_CFG.MODE_DEFAULTS[key] || "Include");
        return;
      }
      e.range.setValue(newVal);
      return;
    }
    // MULTISELECT CELLS
    const targets = MSF_CFG.TARGETS[sheetName];
    if (!targets || !targets.has(a1)) return;
    if (MSF_CFG.RESET_VALUES.has(newVal)) {
      e.range.setValue("All");
      return;
    }
    if (!oldVal || oldVal === "All") {
      e.range.setValue(newVal);
      return;
    }
    const parts = oldVal
      .split(MSF_CFG.DELIM)
      .map(s => s.trim())
      .filter(Boolean);
    const idx = parts.findIndex(p => p.toLowerCase() === newVal.toLowerCase());
    if (idx >= 0) parts.splice(idx, 1);
    else parts.push(newVal);
    e.range.setValue(parts.length ? parts.join(MSF_CFG.DELIM) : "All");
  } catch (err) {
    Logger.log("MSF_onEdit_ error: " + (err && err.stack ? err.stack : err));
  }
}