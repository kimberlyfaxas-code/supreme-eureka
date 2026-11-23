/*******************************************************
 * FY27Engine.gs
 * Pure forecast logic: no SpreadsheetApp calls, so it can be unit-tested in Node
 * (see test/engine.test.js) and reused unchanged inside Apps Script.
 *
 * Input rows are plain objects keyed by TRIMMED header text.
 * Months are canonical "YYYY-MM" strings.
 *******************************************************/

/* ---------------- small helpers ---------------- */

function FY27_pad2_(n) { return (n < 10 ? "0" : "") + n; }

/** Any date-ish value -> "YYYY-MM" or "" */
function FY27_monthKey_(v) {
  if (v === null || v === undefined || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    if (isNaN(v.getTime())) return "";
    return v.getFullYear() + "-" + FY27_pad2_(v.getMonth() + 1);
  }
  const s = String(v).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/);
  if (m) return m[1] + "-" + FY27_pad2_(parseInt(m[2], 10));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + "-" + FY27_pad2_(parseInt(m[1], 10));
  m = s.match(/^([A-Za-z]{3})-(\d{2})$/);                    // "Dec-26"
  if (m) {
    const mj = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase());
    if (mj >= 0) return (2000 + parseInt(m[2], 10)) + "-" + FY27_pad2_(mj + 1);
  }
  m = s.match(/^([A-Za-z]{3})[A-Za-z]*\.?[ -]+(\d{4})$/);   // "June 2026", "Jun 2026"
  if (m) {
    const mi = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase());
    if (mi >= 0) return m[2] + "-" + FY27_pad2_(mi + 1);
  }
  return "";
}
function FY27_monthIdx_(key) {
  if (!key) return NaN;
  const p = key.split("-");
  return parseInt(p[0], 10) * 12 + parseInt(p[1], 10) - 1;
}
function FY27_addMonths_(key, n) {
  if (!key) return "";
  const idx = FY27_monthIdx_(key) + n;
  return Math.floor(idx / 12) + "-" + FY27_pad2_((idx % 12) + 1);
}
function FY27_monthDiff_(a, b) { return FY27_monthIdx_(a) - FY27_monthIdx_(b); }
function FY27_yearOf_(key) { return key ? parseInt(key.slice(0, 4), 10) : NaN; }
function FY27_quarterOf_(key) {
  if (!key) return "";
  return "Q" + (Math.floor((parseInt(key.slice(5, 7), 10) - 1) / 3) + 1) + " " + key.slice(0, 4);
}

function FY27_num_(v) {
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  if (v === null || v === undefined || v === "") return 0;
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[^\d.-]/g, "");
  const n = Number(s);
  if (isNaN(n)) return 0;
  return neg ? -Math.abs(n) : n;
}
var FY27_MONTH_NAMES_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function FY27_str_(v) {
  if (v === null || v === undefined) return "";
  // Sheets auto-converts text like "May 2028" into a Date; show it the way OTC does
  if (Object.prototype.toString.call(v) === "[object Date]") {
    return isNaN(v.getTime()) ? "" : FY27_MONTH_NAMES_[v.getMonth()] + " " + v.getFullYear();
  }
  return String(v).trim();
}
/** "New Logo" / "New" -> true. (A bare /new/ test also matches "Re-new-al", which is wrong.) */
function FY27_isNewType_(v) { return /^\s*new/i.test(FY27_str_(v)); }
function FY27_uniqJoin_(arr, sep) {
  const seen = {}, out = [];
  arr.forEach(function (x) { const t = FY27_str_(x); if (t && !seen[t]) { seen[t] = true; out.push(t); } });
  return out.join(sep || "; ");
}
function FY27_bool_(v) {
  if (v === true) return true;
  const s = FY27_str_(v).toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1";
}
/** Salesforce IDs: compare on the 15-char form */
function FY27_id15_(v) { return FY27_str_(v).slice(0, 15); }
function FY27_round2_(n) { return Math.round(n * 100) / 100; }

/** First non-empty value among candidate header names (case/space-insensitive). */
function FY27_pick_(row, names) {
  for (let i = 0; i < names.length; i++) {
    const v = row[names[i]];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

/**
 * Turn a 2-D grid into row objects.
 * - Headers are trimmed. Duplicate header names keep the first as-is and get "__2", "__3" ... after
 *   (this is the bug that produced the $0 forecast column in the 2026 build).
 * - If the row right under the headers looks like raw/system names (OTC export), it is skipped.
 */
function FY27_gridToRows_(grid, opts) {
  opts = opts || {};
  if (!grid || !grid.length) return { headers: [], rows: [] };
  const headers = [];
  const seen = {};
  grid[0].forEach(function (h) {
    let name = FY27_str_(h);
    if (!name) name = "__blank" + headers.length;
    if (seen[name]) { seen[name]++; name = name + "__" + seen[name]; } else { seen[name] = 1; }
    headers.push(name);
  });
  let start = 1;
  if (opts.skipRawHeaderRow && grid.length > 1) {
    const second = FY27_str_(grid[1][0]);
    if (second === opts.skipRawHeaderRow) start = 2;
  }
  const rows = [];
  for (let r = start; r < grid.length; r++) {
    const line = grid[r];
    let any = false;
    const o = {};
    for (let c = 0; c < headers.length; c++) {
      const v = line[c] === undefined ? "" : line[c];
      if (v !== "" && v !== null) any = true;
      o[headers[c]] = v;
    }
    if (any) { o.__row = r + 1; rows.push(o); }
  }
  return { headers: headers, rows: rows };
}

/* ---------------- product family ---------------- */

/** Coarse family used to match Tableau product names to OTC product names. */
function FY27_family_(group, name) {
  const g = FY27_str_(group).toUpperCase();
  const n = FY27_str_(name).toUpperCase();
  if (g.indexOf("NURS") >= 0) {
    if (/\bPN\b/.test(n) || /PRACTICAL/.test(n)) return "PN";
    if (/\bRN\b/.test(n) || /NCLEX-?RN/.test(n)) return "RN";
    return "Other";
  }
  if (g.indexOf("MED") >= 0) {
    if (/STEP\s*1/.test(n)) return "Step1";
    if (/STEP\s*2/.test(n)) return "Step2";
    if (/STEP\s*3/.test(n)) return "Step3";
    return "Other";
  }
  if (g.indexOf("IHUMAN") >= 0) return "iHuman";
  return "Other";
}
/** OTC product names are often just "Curriculum Plus"; the program ("NCLEX RN") and cohort name say RN vs PN. */
function FY27_otcFamily_(group, productName, program, cohortName) {
  // the structured `program` field ("NCLEX RN" / "NCLEX PN" / "USMLE Step 1" ...) is stable; product names are not (9,080 of 13,070
  // nursing rows have names with no RN/PN in them). Program first, then the name, then the cohort name.
  let f = FY27_family_(group, program);
  if (f === "Other") f = FY27_family_(group, productName);
  if (f === "Other") f = FY27_family_(group, cohortName);
  return f;
}
function FY27_familiesCompatible_(a, b) {
  return a === b || a === "Other" || b === "Other";
}

/* ---------------- account merges ---------------- */

/**
 * Account Merges tab: "count this ID as that account". Rows of every input that carry the From ID (as a Full ID or a Student Org / Billing ID) are
 * rewritten to the Into account (its IDs, name, CSM, rating...) BEFORE anything is matched, so baseline, OTC cohorts, overrides and manual lines
 * all behave as one account. Chains (A into B, B into C) are followed. Returns copies; the inputs are not touched.
 * merges: [{ "From ID", "Into ID", "Comment", __row }] -> results [{row, status}]
 */
function FY27_applyMerges_(input) {
  const merges = (input.merges || []).filter(function (m) { return FY27_str_(m["From ID"]) || FY27_str_(m["Into ID"]); });
  const results = [];
  if (!merges.length) return { input: input, results: results };
  const key = function (v) { return FY27_id15_(v); };
  // find the account behind an ID: first Tableau row, else Salesforce row
  const acct = {};
  const fromKeys = {};
  merges.forEach(function (m) { const f = key(m["From ID"]); if (f) fromKeys[f] = true; });
  // a row that carries a From ID is never the description of the Into account (the duplicate may share the Into account's Full ID)
  const isFromRow = function (r) { return !!(fromKeys[key(r["Billing ID"])] || fromKeys[key(r["Student Org Id"])] || (fromKeys[key(r["FULL ID"])] && !key(r["Billing ID"]))); };
  const target = function (id) {
    const k = key(id);
    if (acct[k] !== undefined) return acct[k];
    let found = null;
    (input.tableau || []).some(function (r) { if (!isFromRow(r) && (key(r["FULL ID"]) === k || key(r["Billing ID"]) === k)) { found = { src: "t", r: r }; return true; } return false; });
    if (!found) (input.salesforce || []).some(function (r) { if (!isFromRow(r) && (key(r["FULL ID"]) === k || key(r["Student Org Id"]) === k)) { found = { src: "s", r: r }; return true; } return false; });
    acct[k] = found;
    return found;
  };
  const into = {};   // from key -> into key
  merges.forEach(function (m) {
    const f = key(m["From ID"]), t = key(m["Into ID"]);
    if (!f || !t) { results.push({ row: m.__row, status: "NOT APPLIED: both From ID and Into ID are needed" }); return; }
    if (f === t) { results.push({ row: m.__row, status: "NOT APPLIED: From and Into are the same account" }); return; }
    if (!target(m["Into ID"])) { results.push({ row: m.__row, status: "NOT APPLIED: Into ID not found in the Tableau or Salesforce data" }); return; }
    into[f] = t; m.__ok = true; m.__f = f;
  });
  const finalOf = function (k) { let n = 0; while (into[k] && n++ < 10) k = into[k]; return k; };
  const info = {};
  Object.keys(into).forEach(function (f) {
    const t = finalOf(f);
    if (t === f) return;
    const tt = target(t);
    const r = tt.r;
    info[f] = tt.src === "t" ? {
      full: r["FULL ID"], bill: r["Billing ID"], name: r["Account Name"], nameOrg: r["Account Name with Billing ID"], csm: r["Client Success Manager"], rating: r["Rating"],
      owner: r["Account Owner"], parent: r["Parent Account"], parentId: r["Parent Account ID"]
    } : { full: r["FULL ID"], bill: r["Student Org Id"], name: r["Account Name"], nameOrg: r["Account Name"] + (r["Student Org Id"] ? " (" + r["Student Org Id"] + ")" : ""), csm: r["Client Success Manager"], rating: r["Rating"], owner: r["Account Owner"], parent: r["Parent Account"], parentId: r["Parent Account ID"] };
  });
  const counts = {};
  const bump = function (f) { counts[f] = (counts[f] || 0) + 1; };
  const set = function (o, k, v) { if (v !== undefined && v !== null && String(v) !== "") o[k] = v; };
  // [rowObj, headers for: full ID, org ID] per source
  const remap = function (rows, fullCols, orgCols, apply) {
    return (rows || []).map(function (r) {
      let f = "";
      fullCols.concat(orgCols).forEach(function (c) { const k = key(r[c]); if (!f && k && info[k]) f = k; });
      if (!f) return r;
      const o = {}; for (const k in r) o[k] = r[k];
      apply(o, info[f]);
      bump(f);
      return o;
    });
  };
  const out = {}; for (const k in input) out[k] = input[k];
  out.tableau = remap(input.tableau, ["FULL ID"], ["Billing ID"], function (o, t) {
    set(o, "FULL ID", t.full); set(o, "Billing ID", t.bill); set(o, "Account Name", t.name); set(o, "Account Name with Billing ID", t.nameOrg);
    set(o, "Client Success Manager", t.csm); set(o, "Rating", t.rating); set(o, "Account Owner", t.owner); set(o, "Parent Account", t.parent); set(o, "Parent Account ID", t.parentId);
  });
  out.otc = remap(input.otc, ["Full ID", "account_business_org_id"], [], function (o, t) {
    if (o["Full ID"] !== undefined) set(o, "Full ID", t.full); if (o["account_business_org_id"] !== undefined) set(o, "account_business_org_id", t.full); set(o, "Account Name", t.name);
  });
  out.adjustments = remap(input.adjustments, ["FULL ID"], ["Student Org ID"], function (o, t) {
    set(o, "FULL ID", t.full); set(o, "Student Org ID", t.bill); set(o, "Account Name", t.name); set(o, "Account Name with Student Org", t.nameOrg);
    set(o, "Client Success Manager", t.csm); set(o, "Rating", t.rating);
  });
  out.manual = remap(input.manual, ["Full ID"], ["Student Org ID"], function (o, t) {
    set(o, "Full ID", t.full); set(o, "Student Org ID", t.bill); set(o, "Account Name", t.name);
  });
  out.carry = remap(input.carry, ["Account Full ID"], ["Student Org ID"], function (o, t) {
    set(o, "Account Full ID", t.full); set(o, "Student Org ID", t.bill); set(o, "Account Name", t.name); set(o, "Current CSM", t.csm); set(o, "Health Rating", t.rating);
  });
  merges.forEach(function (m) {
    if (!m.__ok) return;
    const f = m.__f;
    if (!info[f]) { results.push({ row: m.__row, status: "NOT APPLIED: merges back into itself (check the chain)" }); return; }
    const n = counts[f] || 0;
    results.push({ row: m.__row, status: n ? "Applied: " + n + " rows now count as " + info[f].name : "NOT APPLIED: From ID not found in any data tab (check the ID)" });
  });
  return { input: out, results: results };
}

/* ---------------- normalizers ---------------- */

function FY27_normOtc_(r, cfg) {
  const statusLc = FY27_str_(r["order_status"]).toLowerCase();
  const estStart = FY27_monthKey_(FY27_pick_(r, ["order_estimated_start_date"]));
  const actStart = FY27_monthKey_(FY27_pick_(r, ["order_actual_start_date"]));
  const booked = (cfg.OTC_BOOKED_STATUSES || []).indexOf(statusLc) >= 0 || (statusLc !== "" && statusLc !== "roster" && !!actStart);
  const period = FY27_num_(FY27_pick_(r, ["Cohort Code Billing Period"]));
  const code = FY27_str_(FY27_pick_(r, ["Cohort Code (if present, then this is a rebooking)", "Cohort Code", "cohort_code"]));
  const group = FY27_str_(FY27_pick_(r, ["Product Group", "reporting_group"]));
  const pname = FY27_str_(FY27_pick_(r, ["Product Name", "product_name"]));
  const est = FY27_num_(FY27_pick_(r, ["Estimated # of Students", "order_enrollment_estimate"]));
  const fin = FY27_num_(FY27_pick_(r, ["order_enrollment_final"]));
  return {
    row: r.__row,
    fullId: FY27_id15_(FY27_pick_(r, ["Full ID", "account_business_org_id"])),
    accountName: FY27_str_(r["Account Name"]),
    group: group,
    productName: pname,
    family: FY27_otcFamily_(group, pname, FY27_str_(FY27_pick_(r, ["program", "opportunity_program"])), FY27_str_(r["cohort_name"])),
    bookingId: FY27_str_(FY27_pick_(r, ["booking_id"])),
    contractId: FY27_str_(FY27_pick_(r, ["Contract ID", "contract_id"])),
    contractStart: FY27_monthKey_(FY27_pick_(r, ["Contract Start Date", "contract_start_date"])),
    contractEnd: FY27_monthKey_(FY27_pick_(r, ["Contract End Date", "contract_end_date"])),
    cohortName: FY27_str_(FY27_pick_(r, ["cohort_name"])),
    cohortCode: code,
    billingPeriod: period,
    isRebooking: !!code || (cfg.REBOOKING_BASIS === "period" && period >= 2),
    productCode: FY27_str_(FY27_pick_(r, ["product_code"])),
    productType: FY27_str_(FY27_pick_(r, ["product_type"])),
    modality: FY27_str_(FY27_pick_(r, ["product_modality"])),
    otcProgram: FY27_str_(FY27_pick_(r, ["program", "opportunity_program"])),
    termMonths: (function () {
      const a = FY27_monthKey_(FY27_pick_(r, ["order_estimated_start_date"])), z = FY27_monthKey_(FY27_pick_(r, ["order_estimated_end_date"]));
      return a && z ? FY27_monthDiff_(z, a) : "";
    })(),
    dne: FY27_bool_(r["cohort_dne_flag"]),
    status: FY27_str_(r["order_status"]),
    booked: booked,
    estStart: estStart,
    actStart: actStart,
    month: actStart || estStart,          // effective start month
    estStudents: est,
    finalStudents: fin,
    price: FY27_num_(FY27_pick_(r, ["Price Per Student", "order_price"])),
    total: FY27_num_(FY27_pick_(r, ["Estimated or Actual Order Total", "order_total"]))
  };
}

function FY27_normBaseline_(r, cfg) {
  const baseMonth = FY27_monthKey_(FY27_pick_(r, ["Baseline Booking Month - Tableau"]));
  let fcMonth = FY27_monthKey_(FY27_pick_(r, ["Forecast Month - Tableau"]));
  if (!fcMonth && baseMonth) fcMonth = FY27_addMonths_(baseMonth, 12);
  const billingId = FY27_str_(r["Billing ID"]);
  const group = FY27_str_(r["Product Group"]);
  const pname = FY27_str_(r["Product Name"]);
  const bosRe = new RegExp(cfg.BOS_ID_REGEX || "^A\\d+$");
  return {
    row: r.__row,
    raw: r,
    fullId: FY27_id15_(r["FULL ID"]),
    billingId: billingId,
    isBOS: bosRe.test(billingId),
    group: group,
    productName: pname,
    family: FY27_family_(group, pname),
    rating: FY27_str_(r["Rating"]),
    baseMonth: baseMonth,
    fcMonth: fcMonth,
    baseAmt: FY27_num_(r["Baseline Amount - Tableau"]),
    isNegAdj: FY27_num_(r["Baseline Amount - Tableau"]) < 0,
    isAdj: FY27_bool_(r["Adjustment (true/false)"]) || FY27_num_(r["Baseline Amount - Tableau"]) < 0,
    priorType: FY27_str_(r["Prior Booking Type"]),
    nextType: FY27_str_(r["Next Booking Type"]),
    bookingId: FY27_str_(r["booking_id"])
  };
}

function FY27_normSf_(r) {
  return {
    fullId: FY27_id15_(r["FULL ID"]),
    attrs: r
  };
}

/* ---------------- history / trend ---------------- */

/** Per account+group+family: how do completed cohorts compare to their estimates? */
function FY27_buildHistory_(otc, cfg) {
  const byKey = {};
  const firstByAccountGroup = {};
  const firstByCohort = {};
  const lastByFamily = {};
  const cohortLast = {};
  otc.forEach(function (o) {
    if (o.dne || !o.booked || !o.actStart) return;
    const k = o.fullId + "|" + o.group + "|" + o.family;
    const h = byKey[k] || (byKey[k] = { n: 0, est: 0, fin: 0 });
    if (o.estStudents > 0 && o.finalStudents >= 0) { h.n++; h.est += o.estStudents; h.fin += o.finalStudents; }
    if (o.cohortName && o.finalStudents > 0) {
      const ck2 = o.fullId + "|" + o.cohortName;
      if (!cohortLast[ck2] || o.actStart > cohortLast[ck2].month) cohortLast[ck2] = { final: o.finalStudents, price: o.price, total: o.total, month: o.actStart };
    }
    const lk = o.fullId + "|" + o.group + "|" + o.family;
    if (!lastByFamily[lk] || o.actStart > lastByFamily[lk]) lastByFamily[lk] = o.actStart;
    const ag = o.fullId + "|" + o.group;
    if (!firstByAccountGroup[ag] || o.actStart < firstByAccountGroup[ag]) firstByAccountGroup[ag] = o.actStart;
    if (o.cohortCode) {
      const ck = o.fullId + "|" + o.cohortCode;
      if (!firstByCohort[ck] || o.actStart < firstByCohort[ck]) firstByCohort[ck] = o.actStart;
    }
  });
  const ratio = {};
  Object.keys(byKey).forEach(function (k) {
    const h = byKey[k];
    if (h.n >= cfg.TREND_MIN_ORDERS && h.est > 0) {
      const lo = cfg.TREND_CLAMP[0], hi = cfg.TREND_CLAMP[1];
      ratio[k] = { ratio: Math.min(hi, Math.max(lo, h.fin / h.est)), n: h.n };
    }
  });
  return { ratio: ratio, firstByAccountGroup: firstByAccountGroup, firstByCohort: firstByCohort, lastByFamily: lastByFamily, cohortLast: cohortLast };
}

/* ---------------- main engine ---------------- */

/**
 * @param {Object} input { tableau:[rowObj], otc:[rowObj], salesforce:[rowObj], overrides:[rowObj], now: Date }
 * @param {Object} cfg    FY27_CFG
 * @return {{lines:Array, review:Array, writeback:Object, coverage:Array, stats:Object}}
 */
function FY27_buildForecast(input, cfg) {
  const mergeApplied = FY27_applyMerges_(input);
  input = mergeApplied.input;
  const year = cfg.FORECAST_YEAR;
  const now = input.now || new Date();
  const actualsThrough = cfg.ACTUALS_THROUGH === "auto"
    ? now.getFullYear() + "-" + FY27_pad2_(now.getMonth() + 1)
    : FY27_monthKey_(cfg.ACTUALS_THROUGH);

  const otcAll = input.otc.map(function (r, i) { const o = FY27_normOtc_(r, cfg); if (!o.row) o.row = "i" + i; return o; }).filter(function (o) { return o.fullId; });
  // Rows from the separate Adjustments tab (mostly negative adjustments) are baseline too: they count in the
  // baseline, are never forecast. Mapped onto the Tableau column names so one code path handles both.
  const adjRows = (input.adjustments || []).map(function (r) {
    return {
      "Account Name with Billing ID": r["Account Name with Student Org"], "Billing ID": r["Student Org ID"],
      "Account Name": r["Account Name"], "Sales Rep": r["Sales Rep"], "Customer Type": r["Customer Type"],
      "FULL ID": r["FULL ID"], "Rating": r["Rating"], "Client Category": r["Client Category"],
      "Client Sub-Category": r["Client Sub-Category"], "Billing State/Province": r["Billing State/Province"],
      "Account Owner": r["Account Owner"], "Client Success Manager": r["Client Success Manager"],
      "Parent Account": r["Parent Account"], "Billing Country": r["Billing Country"],
      "Parent Account ID": r["Parent Account ID"], "Account Record Type": r["Account Record Type"],
      "Product Group": r["Product Group"], "Product Name": r["Product Name"],
      "Prior Booking Type": r["Sales Type"], "Next Booking Type": "", "Adjustment (true/false)": "TRUE",
      "Baseline Booking Month - Tableau": r["Booking Month"], "Forecast Month - Tableau": r["Baseline Month"],
      "Baseline Amount - Tableau": r["Baseline Amount"], "booking_id": "", __row: "adj" + r.__row, __adjTab: true
    };
  });
  const base = input.tableau.concat(adjRows).map(function (r, i) {
      const b = FY27_normBaseline_(r, cfg); if (!b.row) b.row = "i" + i; b.fromAdjTab = !!r.__adjTab; return b; })
    .filter(function (b) { return b.fullId || b.baseAmt || b.group; });
  const sfById = {};
  (input.salesforce || []).forEach(function (r) {
    const s = FY27_normSf_(r);
    if (s.fullId && !sfById[s.fullId]) sfById[s.fullId] = s.attrs;
  });

  // Reconcile Tableau baseline-year bookings with OTC baseline-year actuals to find adjustments
  // (extra students added after a cohort started) - those must not recur.
  const derivedAdj = FY27_deriveAdjustments_(base, otcAll, year - 1, cfg.ADJUSTMENT_MAX_ABS);
  const likelyAdj = FY27_flagLikelyAdjustments_(base, otcAll, year - 1, cfg);

  const history = FY27_buildHistory_(otcAll, cfg);

  // Index OTC by account
  const otcByAcct = {};
  otcAll.forEach(function (o) { (otcByAcct[o.fullId] = otcByAcct[o.fullId] || []).push(o); });

  // Account-level contract end per group (for flags)
  const contractEnd = {};
  otcAll.forEach(function (o) {
    if (!o.contractEnd) return;
    const k = o.fullId + "|" + o.group;
    if (!contractEnd[k] || o.contractEnd > contractEnd[k]) contractEnd[k] = o.contractEnd;
  });

  // Gray / black accounts: OTC may not know about teach-outs or dropped accounts, so OTC roster-chasing cohorts
  // (no cohort code = first booking) are ignored for them; only rebookings of existing cohorts are used.
  const ratingByFull = {};
  base.forEach(function (b) { if (b.fullId && b.rating && !ratingByFull[b.fullId]) ratingByFull[b.fullId] = b.rating; });
  function restrictedAccount(fullId) {
    // rating comes from the Tableau Bookings Data tab only (most recent; brought in from Salesforce there)
    const r = FY27_str_(ratingByFull[fullId]).toLowerCase();
    return r === "gray" || r === "grey" || r === "black";
  }
  const ignoredRoster = { cohorts: 0, value: 0 };
  // OTC rows that land in the forecast year (not flagged DNE)
  const target = otcAll.filter(function (o) { return !o.dne && FY27_yearOf_(o.month) === year; }).filter(function (o) {
    if (cfg.IGNORE_ROSTER_CHASING_GRAY_BLACK && !o.booked && !o.isRebooking && restrictedAccount(o.fullId)) {
      ignoredRoster.cohorts++; ignoredRoster.value += o.total;
      return false;
    }
    return true;
  });
  const tableauIds = {};
  base.forEach(function (b) { if (b.fullId) tableauIds[b.fullId] = true; });

  // the client's largest baseline line per product group: for flat-fee groups that line is the flat fee, much smaller lines are add-ons
  const flatFeeMax = {};
  base.forEach(function (b) {
    if (!b.fullId || b.isAdj || b.baseAmt <= 0) return;
    const k = b.fullId + "|" + b.group;
    if (!flatFeeMax[k] || b.baseAmt > flatFeeMax[k]) flatFeeMax[k] = b.baseAmt;
  });

  // Which programs (account + product group + family) actually booked in the baseline year?
  // An OTC cohort for a program that did NOT book last year is not forecast (e.g. a PN program
  // that stopped running when two sites merged contracts). Value is kept in "Value If Booked".
  const activeProg = {};
  function markActive(fullId, group, family) {
    const k = fullId + "|" + group;
    (activeProg[k] = activeProg[k] || {})[family] = true;
  }
  base.forEach(function (b) { if (b.fullId && !b.isAdj && b.baseAmt > 0) markActive(b.fullId, b.group, b.family); });
  otcAll.forEach(function (o) {
    if (!o.dne && o.booked && FY27_yearOf_(o.actStart) === year - 1) markActive(o.fullId, o.group, o.family);
  });
  function programActive(fullId, group, family) {
    const fam = activeProg[fullId + "|" + group];
    if (!fam) return false;
    if (family === "Other") return true;
    return !!(fam[family] || fam["Other"]);
  }

  let lines = [];
  const usedOtc = {};         // OTC row -> true once assigned
  const writeback = {};       // tableau row number -> info

  function ratingKind(rating) {
    const r = rating.toLowerCase();
    if (r === "gray" || r === "grey") return "gray";
    if (r === "black") return "black";
    return "";
  }

  /* ---- 1. Baseline rows -> match to OTC cohorts ---- */
  const baseByAcctGroup = {};
  base.forEach(function (b) {
    const k = b.fullId + "|" + b.group;
    (baseByAcctGroup[k] = baseByAcctGroup[k] || []).push(b);
  });

  // assignment: each target OTC row goes to the nearest compatible baseline row (within tolerance)
  const assigned = new Map();   // baseline -> [otc]
  target.forEach(function (o) {
    const cands = (baseByAcctGroup[o.fullId + "|" + o.group] || []).filter(function (b) {
      return !b.isBOS && !b.isAdj && b.fcMonth && FY27_familiesCompatible_(b.family, o.family);
    });
    let best = null, bestD = Infinity;
    cands.forEach(function (b) {
      const d = Math.abs(FY27_monthDiff_(o.month, b.fcMonth));
      // prefer exact family match on ties
      const tie = d === bestD && best && b.family === o.family && best.family !== o.family;
      if (d < bestD || tie) { best = b; bestD = d; }
    });
    if (best && bestD <= cfg.MATCH_TOLERANCE_MONTHS) {
      if (!assigned.has(best)) assigned.set(best, []);
      assigned.get(best).push(o);
      usedOtc[o.row] = true;
    }
  });

  // how many cohorts (booked OTC orders) made up each baseline row last year? (same nearest-row assignment as the upcoming cohorts)
  const lastCount = new Map();
  otcAll.forEach(function (o) {
    if (o.dne || !o.booked || !o.actStart || o.total <= 0 || FY27_yearOf_(o.actStart) !== year - 1) return;
    const cands = (baseByAcctGroup[o.fullId + "|" + o.group] || []).filter(function (b) {
      return !b.isBOS && !b.isAdj && b.baseMonth && FY27_familiesCompatible_(b.family, o.family);
    });
    let best = null, bestD = Infinity;
    cands.forEach(function (b) {
      const d = Math.abs(FY27_monthDiff_(o.actStart, b.baseMonth));
      const tie = d === bestD && best && b.family === o.family && best.family !== o.family;
      if (d < bestD || tie) { best = b; bestD = d; }
    });
    if (best && bestD <= cfg.MATCH_TOLERANCE_MONTHS) lastCount.set(best, (lastCount.get(best) || 0) + 1);
  });

  /**
   * Credit type (New vs Renewal) is decided at the account + PRODUCT GROUP level:
   *  1. If the group already has a Tableau baseline line, the next booking is whatever Tableau
   *     column U ("Next Booking Type") says - normally Renewal.
   *  2. Otherwise (group not in Tableau) apply the 12-month rule from the group's first OTC booking:
   *     within 12 months = New, after = Renewal, never booked = New.
   * The basis is written next to the credit so every New is traceable.
   */
  function creditFor(fullId, group, month, baselineRow) {
    if (baselineRow && baselineRow.nextType) {
      return { credit: FY27_isNewType_(baselineRow.nextType) ? "New" : "Renewal", basis: "Tableau Next Booking Type (col U)" };
    }
    const sibs = (baseByAcctGroup[fullId + "|" + group] || []).filter(function (x) { return x.nextType && !x.isAdj; });
    if (sibs.length) {
      sibs.sort(function (x, y) { return x.baseMonth < y.baseMonth ? 1 : x.baseMonth > y.baseMonth ? -1 : 0; });
      return { credit: FY27_isNewType_(sibs[0].nextType) ? "New" : "Renewal", basis: "Same product group in Tableau (col U)" };
    }
    const first = history.firstByAccountGroup[fullId + "|" + group] || "";
    if (!first) return { credit: "New", basis: "First booking of this product group" };
    const age = FY27_monthDiff_(month, first);
    return { credit: age < cfg.NEW_CREDIT_MONTHS ? "New" : "Renewal", basis: "12-month rule: first booked " + first };
  }

  function sfAttrs(fullId) { return sfById[fullId] || {}; }

  function makeLine(partial) {
    const l = {
      accountNameWithOrg: "", studentOrgId: "", accountName: "", salesRep: "", customerType: "",
      fullId: "", rating: "", clientCategory: "", clientSubCategory: "", billingState: "",
      accountOwner: "", csm: "", parentAccount: "", billingCountry: "", parentAccountId: "",
      accountRecordType: "", productGroup: "", productName: "", forecastSource: "",
      priorBookingType: "", nextBookingType: "", adjustment: "", baselineMonth: "", bookingId: "", adjVariance: "",
      contractId: "", contractStart: "", contractEnd: "", forecastMonth: "", forecastQuarter: "",
      baselineAmount: 0, valueIfBooked: 0, forecastAmount: 0,
      estStudents: "", adjStudents: "", price: "", cohortNames: "", cohortCodes: "", priorCohorts: "",
      productCode: "", productType: "", modality: "", otcProgram: "", termMonths: "", reason: "", stage: "", timing: "", isManual: false, manualRow: "",
      bookingType: "", credit: "", creditBasis: "", status: "", expectation: "", weight: 1, weightedAmount: 0, otcEstimate: "", segment: "", flags: [], key: ""
    };
    for (const k in partial) l[k] = partial[k];
    return l;
  }

  function attrsFromBaseline(b) {
    const r = b.raw;
    return {
      accountNameWithOrg: FY27_str_(r["Account Name with Billing ID"]),
      studentOrgId: b.billingId,
      accountName: FY27_str_(r["Account Name"]),
      salesRep: FY27_str_(r["Sales Rep"]),
      customerType: FY27_str_(r["Customer Type"]),
      fullId: FY27_str_(r["FULL ID"]),
      rating: b.rating,
      clientCategory: FY27_str_(r["Client Category"]),
      clientSubCategory: FY27_str_(r["Client Sub-Category"]),
      billingState: FY27_str_(r["Billing State/Province"]),
      accountOwner: FY27_str_(r["Account Owner"]),
      csm: FY27_str_(r["Client Success Manager"]),
      parentAccount: FY27_str_(r["Parent Account"]),
      billingCountry: FY27_str_(r["Billing Country"]),
      parentAccountId: FY27_str_(r["Parent Account ID"]),
      accountRecordType: FY27_str_(r["Account Record Type"]),
      priorBookingType: b.priorType,
      nextBookingType: b.nextType,
      adjustment: b.isAdj ? "TRUE" : "FALSE",
      baselineMonth: b.baseMonth,
      bookingId: b.bookingId
    };
  }

  function priorCohortsFor(b) {
    if (!b.baseMonth || b.isBOS) return "";
    const names = {};
    (otcByAcct[b.fullId] || []).forEach(function (o) {
      if (o.group === b.group && o.booked && o.actStart === b.baseMonth &&
          FY27_familiesCompatible_(b.family, o.family) && o.cohortName) names[o.cohortName] = true;
    });
    return Object.keys(names).join("; ");
  }

  function applyRatingAndAdj(line, b, otcIsRoster) {
    // returns nothing; mutates line.expectation / flags / forecastAmount
    const kind = ratingKind(b ? b.rating : line.rating);
    line.valueIfBooked = line.forecastAmount;
    if (b && b.isAdj && b.baseAmt > 0) {
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.reason = "Adjustment";
      line.flags.push("Positive adjustment: tagged not expected for this client");
    } else if (b && b.isAdj && b.baseAmt < 0) {
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.reason = "Adjustment";
      line.flags.push("Negative adjustment" + (b.fromAdjTab ? " (Adjustments tab)" : "") + ": in baseline, not forecast" +
        (cfg.ADJUSTMENT_MAX_ABS > 0 && Math.abs(b.baseAmt) > cfg.ADJUSTMENT_MAX_ABS
          ? " - LARGE (over $" + cfg.ADJUSTMENT_MAX_ABS.toLocaleString() + "): probably part of a booking total, review" : ""));
    }
    if (kind === "black" && line.bookingType === "Rebooking (assumed)" && line.status !== "Booked") {
      // teach-out: only cohorts that exist in OTC (rebookings with a cohort code) are expected to finish their term;
      // a baseline repeated "by assumption" is not evidence of one
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.reason = "Lost";
      line.flags.push("Black rating (teach-out): only existing OTC cohorts are forecast, baseline not repeated");
    } else if ((kind === "gray" || kind === "black") && line.bookingType === "Roster Chasing" && line.status !== "Booked") {
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.reason = "No Revenue This Term";
      line.flags.push((kind === "black" ? "Black" : "Gray") + " rating: no new cohorts expected, only rebookings");
    }
  }

  base.forEach(function (b) {
    const attrs = attrsFromBaseline(b);
    let matches = assigned.get(b) || [];
    // predicted additional cohorts: more upcoming cohorts than last year's booked cohorts -> the extras add value on top of the baseline
    let extras = [], extraNote = "", extraAvg = 0;
    const isFlatFee = (cfg.FLAT_FEE_GROUPS || []).some(function (g) { return g.toUpperCase() === b.group.toUpperCase(); });
    if (cfg.EXTRA_COHORTS && !isFlatFee && matches.length && b.baseAmt > 0 && !b.isAdj && !restrictedAccount(b.fullId)) {
      const lastN = lastCount.get(b) || 0;
      const countable = matches.filter(function (o) { return o.total > 0; });     // $0 placeholder rosters are not real cohorts
      if (lastN > 0 && countable.length > lastN) {
        const nExtra = countable.length - lastN;
        extraAvg = FY27_round2_(b.baseAmt / lastN);
        // extras: not-yet-booked first, first-time (roster chasing) cohorts first, latest month first
        const ranked = countable.slice().sort(function (x, y) {
          return (x.booked - y.booked) || (x.isRebooking - y.isRebooking) || (y.month < x.month ? -1 : y.month > x.month ? 1 : 0);
        });
        extras = ranked.slice(0, nExtra);
        matches = matches.filter(function (o) { return extras.indexOf(o) < 0; });
        extraNote = "Additional cohort: OTC expects " + (lastN + nExtra) + " cohorts vs " + lastN + " last year (+" + nExtra + " x $" + Math.round(extraAvg).toLocaleString() + " average cohort value)";
      }
    }
    let otcDiffers = "";
    if (matches.length && b.baseAmt > 0 && cfg.MATCH_AMOUNT_BAND && !matches.some(function (o) { return o.booked; })) {
      const tot = matches.reduce(function (t, o) { return t + o.total; }, 0);
      if (tot < cfg.MATCH_AMOUNT_BAND[0] * b.baseAmt || tot > cfg.MATCH_AMOUNT_BAND[1] * b.baseAmt) {
        otcDiffers = "OTC cohort estimate $" + Math.round(tot).toLocaleString() + " is far from baseline $" + Math.round(b.baseAmt).toLocaleString() +
          " - baseline kept, check cohort / contract";
        matches = [];   // cohorts stay consumed (not re-added as OTC-only lines); baseline carries the forecast
      }
    }
    const prior = priorCohortsFor(b);
    const ceKey = b.fullId + "|" + b.group;
    const cEnd = contractEnd[ceKey] || "";
    const baseFlags = [];

    // baseline month incomplete?
    if (b.baseMonth && FY27_monthDiff_(b.baseMonth, actualsThrough) >= 0) {
      baseFlags.push("Baseline month " + b.baseMonth + " is not complete yet (actuals through " + FY27_addMonths_(actualsThrough, -1) + ")");
    }

    if (matches.length) {
      // one forecast line per OTC cohort order (month-accurate); baseline amount sits on the first line only
      matches.sort(function (x, y) { return x.month < y.month ? -1 : x.month > y.month ? 1 : 0; });
      let hasCode = false, hasNoCode = false;
      matches.forEach(function (o) { if (o.isRebooking) hasCode = true; else hasNoCode = true; });
      const bookingType = hasCode && hasNoCode ? "Mix" : hasCode ? "Rebooking" : "Roster Chasing";
      const otcEstTotal = matches.reduce(function (t, o) { return t + o.total; }, 0);
      // baseline $ lands on the line in the baseline's own forecast month (else the first line)
      let baseIdx = 0;
      matches.forEach(function (o, i) { if (o.month === b.fcMonth && baseIdx === 0 && i > 0) baseIdx = i; });
      if (matches[0].month === b.fcMonth) baseIdx = 0;
      matches.forEach(function (o, i) {
        const L = makeLine(attrs);
        L.productGroup = b.group;
        L.productName = o.productName || b.productName;
        L.forecastSource = cfg.SOURCES.TABLEAU;
        L.contractId = o.contractId;
        L.contractStart = o.contractStart;
        L.contractEnd = o.contractEnd;
        L.forecastMonth = o.month;
        L.baselineAmount = i === baseIdx ? b.baseAmt : 0;
        L.bookingId = FY27_uniqJoin_([b.bookingId, o.bookingId]);
        L.estStudents = o.estStudents;
        L.price = o.price;
        L.cohortNames = o.cohortName;
        L.productCode = o.productCode; L.productType = o.productType; L.modality = o.modality; L.otcProgram = o.otcProgram; L.termMonths = o.termMonths;
        L.cohortCodes = o.cohortCode;
        L.priorCohorts = i === baseIdx ? prior : "";
        L.bookingType = bookingType;
        L.status = o.booked ? "Booked" : "Forecast";
        L.stage = o.booked ? "Submitted" : (o.isRebooking ? "Not needed" : "Not started");
        if (b.fcMonth && o.month) { const dm = FY27_monthDiff_(o.month, b.fcMonth); L.timing = dm < 0 ? "Early" : dm > 0 ? "Late" : "On time"; }
        // amount: actual if booked, else (trend-adjusted) students x price, else OTC total
        let amt = o.total;
        L.otcEstimate = o.total;
        const basis = cfg.AMOUNT_BASIS || "otc";
        if (!o.booked && basis !== "otc" && b.baseAmt > 0 && otcEstTotal > 0) {
          const k = basis === "baseline" ? b.baseAmt / otcEstTotal : Math.min(1, b.baseAmt / otcEstTotal);
          amt = FY27_round2_(o.total * k);
          if (k < 0.999 && i === baseIdx) {
            L.flags.push("Amount held to Tableau baseline: OTC cohorts $" + Math.round(otcEstTotal).toLocaleString() + " vs baseline $" + Math.round(b.baseAmt).toLocaleString());
          }
        } else if (!o.booked && basis === "otc") {
          const tr = history.ratio[o.fullId + "|" + o.group + "|" + o.family];
          if (cfg.USE_TREND && tr && Math.abs(tr.ratio - 1) >= cfg.TREND_MIN_DELTA && o.estStudents > 0 && o.price > 0) {
            const adj = Math.round(o.estStudents * tr.ratio);
            L.adjStudents = adj;
            amt = FY27_round2_(adj * o.price);
            L.flags.push("Cohort size trend-adjusted " + o.estStudents + " -> " + adj + " (history x" + FY27_round2_(tr.ratio) + " over " + tr.n + " cohorts)");
          }
        }
        L.forecastAmount = amt;
        const cr = creditFor(o.fullId, o.group, o.month, b);
        L.credit = cr.credit; L.creditBasis = cr.basis;
        L.expectation = o.booked ? "Captured" : "Expected";
        if (i === baseIdx) {
          baseFlags.forEach(function (f) { L.flags.push(f); });
          // Baseline includes adjustments (extra students, overages) that the OTC contract estimate does not
          const delta = FY27_round2_(b.baseAmt - otcEstTotal);
          L.adjVariance = delta;
          if (Math.abs(delta) >= 1) {
            L.flags.push("Adjustment: baseline $" + Math.round(b.baseAmt).toLocaleString() + " vs OTC estimate $" +
              Math.round(otcEstTotal).toLocaleString() + " (" + (delta > 0 ? "+" : "-") + "$" + Math.abs(Math.round(delta)).toLocaleString() +
              (delta > 0 ? " added after the contract estimate" : " below the contract estimate") + ")");
          }
        }
        if (o.contractEnd && o.month && FY27_monthDiff_(o.month, o.contractEnd) > 0) {
          if (L.expectation === "Expected") L.expectation = cfg.PENDING_CATEGORY;   // contract pending, no review flag
        }
        applyRatingAndAdj(L, b, !o.booked);
        lines.push(L);
      });
      extras.forEach(function (o) {
        const X = makeLine(attrs);
        X.productGroup = b.group; X.productName = o.productName || b.productName;
        X.forecastSource = cfg.SOURCES.OTC;
        X.contractId = o.contractId; X.contractStart = o.contractStart; X.contractEnd = o.contractEnd;
        X.forecastMonth = o.month;
        X.baselineAmount = 0;
        X.estStudents = o.estStudents; X.price = o.price; X.otcEstimate = o.total;
        X.cohortNames = o.cohortName; X.cohortCodes = o.cohortCode;
        X.productCode = o.productCode; X.productType = o.productType; X.modality = o.modality; X.otcProgram = o.otcProgram; X.termMonths = o.termMonths;
        X.bookingId = o.bookingId;
        X.bookingType = o.isRebooking ? "Rebooking" : "Roster Chasing";
        X.status = o.booked ? "Booked" : "Forecast";
        X.stage = o.booked ? "Submitted" : (o.isRebooking ? "Not needed" : "Not started");
        X.forecastAmount = o.booked ? o.total : Math.min(extraAvg, o.total);
        X.expectation = o.booked ? "Captured" : cfg.EXTRA_COHORT_CATEGORY;
        if (!o.booked) { X.weightOverride = cfg.EXTRA_COHORT_WEIGHT; X.segment = "Additional predicted cohort"; }
        X.flags.push(extraNote);
        applyRatingAndAdj(X, null, !o.booked);
        lines.push(X);
      });
      writeback[b.row] = {
        contractId: matches.map(function (o) { return o.contractId; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join("; "),
        contractStart: matches[0].contractStart,
        contractEnd: matches[0].contractEnd,
        forecastMonthOtc: matches[0].month,
        price: matches[0].price,
        estStudents: matches.reduce(function (s, o) { return s + o.estStudents; }, 0),
        estAmount: matches.reduce(function (s, o) { return s + o.total; }, 0),
        bookingType: bookingType,
        productType: "",
        cohortNames: matches.map(function (o) { return o.cohortName; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join("; ")
      };
      return;
    }

    // No OTC cohort matched -> baseline-only line (assume rebooking at the same value)
    if (!b.fcMonth || FY27_yearOf_(b.fcMonth) !== year) return;
    const L = makeLine(attrs);
    L.productGroup = b.group;
    L.productName = b.productName;
    L.forecastSource = cfg.SOURCES.TABLEAU;
    L.forecastMonth = b.fcMonth;
    L.baselineAmount = b.baseAmt;
    L.forecastAmount = b.baseAmt;
    L.contractEnd = cEnd;
    L.bookingId = b.bookingId;
    L.priorCohorts = prior;
    L.bookingType = "Rebooking (assumed)";
    L.status = "Forecast";
    L.stage = "Not started";
    L.expectation = "Expected";
    const cr0 = creditFor(b.fullId, b.group, b.fcMonth, b);
    L.credit = cr0.credit; L.creditBasis = cr0.basis;
    baseFlags.forEach(function (f) { L.flags.push(f); });

    // why is there no cohort?
    if (otcDiffers && !b.isBOS && !b.isAdj) {
      L.flags.push(otcDiffers);
    } else if (b.isBOS) {
      L.flags.push("BOS billing ID - not in OTC; forecast from baseline only");
    } else if (b.isAdj) {
      if (b.adjReason) L.flags.push(b.adjReason);
    } else if (!otcByAcct[b.fullId]) {
      L.expectation = cfg.PENDING_CATEGORY;
    } else if (!cEnd) {
      L.expectation = cfg.PENDING_CATEGORY;
    } else if (FY27_monthDiff_(b.fcMonth, cEnd) > 0) {
      L.expectation = cfg.PENDING_CATEGORY;   // contract ended / not renewed yet: pending, not a review flag
    } else {
      L.flags.push("Contract covers " + b.fcMonth + " (ends " + cEnd + ") but no upcoming cohort in OTC - check");
    }
    // repeated by assumption, no OTC cohort behind it: At Risk (pending contracts keep their own status)
    if (cfg.AT_RISK_BASELINE_ONLY && L.expectation === "Expected" && !b.isBOS && !b.isAdj) L.expectation = cfg.AT_RISK_CATEGORY;
    // weight by segment (what share of this kind of line did the team keep in the backtest?)
    if (!b.isBOS && !b.isAdj && (L.expectation === cfg.AT_RISK_CATEGORY || L.expectation === cfg.PENDING_CATEGORY)) {
      const ended = !!(otcByAcct[b.fullId] && cEnd && FY27_monthDiff_(b.fcMonth, cEnd) > 0);
      const noContract = !otcByAcct[b.fullId] || !cEnd;
      const flatFee = (cfg.FLAT_FEE_GROUPS || []).some(function (g) { return g.toUpperCase() === b.group.toUpperCase(); });
      const facts = { group: b.group.toUpperCase(), rating: b.rating.toLowerCase(), ended: ended, noContract: noContract, covers: !ended && !noContract,
        flatFee: flatFee, overage: false, monthsSinceEnd: ended ? FY27_monthDiff_(b.fcMonth, cEnd) : 0 };
      const rules = cfg.AT_RISK_WEIGHT_RULES || [];
      for (let ri = 0; ri < rules.length; ri++) {
        const ru = rules[ri];
        if ((ru.group === undefined || ru.group.toUpperCase() === facts.group) && (ru.rating === undefined || ru.rating === facts.rating) &&
            (ru.ended === undefined || ru.ended === facts.ended) && (ru.noContract === undefined || ru.noContract === facts.noContract) &&
            (ru.covers === undefined || ru.covers === facts.covers) && (ru.flatFee === undefined || ru.flatFee === facts.flatFee) &&
            (ru.overage === undefined || ru.overage === facts.overage) &&
            (ru.endedMaxMonths === undefined || (facts.ended && facts.monthsSinceEnd <= ru.endedMaxMonths))) {
          L.weightOverride = ru.weight; L.segment = ru.name;
          break;
        }
      }
    }
    applyRatingAndAdj(L, b, false);
    // Med / Allied add-on next to the same client's flat fee: a one-time fee, not expected to repeat
    if (!b.isBOS && !b.isAdj && L.expectation !== "Not Expected") {
      const fMax = flatFeeMax[b.fullId + "|" + b.group] || 0;
      const isFlat = (cfg.FLAT_FEE_GROUPS || []).some(function (g) { return g.toUpperCase() === b.group.toUpperCase(); });
      if (isFlat && fMax > b.baseAmt && b.baseAmt < cfg.FLAT_FEE_OVERAGE_FRACTION * fMax) {
        L.expectation = "Not Expected"; L.reason = "Non-Recurring"; L.forecastAmount = 0; L.weightOverride = undefined; L.segment = "Med/Allied one-time add-on";
        L.flags.push("One-time add-on: $" + Math.round(b.baseAmt).toLocaleString() + " next to this client's $" + Math.round(fMax).toLocaleString() + " flat fee (" + b.group + ") - not expected to repeat");
      }
    }
    lines.push(L);
    writeback[b.row] = {
      contractId: "", contractStart: "", contractEnd: cEnd, forecastMonthOtc: "", price: "",
      estStudents: "", estAmount: "", bookingType: "Rebooking (assumed)", productType: "", cohortNames: ""
    };
  });

  /* ---- 2. OTC cohorts with no baseline match -> own lines ---- */
  const excluded = { cohorts: 0, value: 0, accounts: {} };
  target.forEach(function (o) {
    if (usedOtc[o.row]) return;
    const sf = sfAttrs(o.fullId);
    const notInTableau = !tableauIds[o.fullId];
    if (notInTableau && !cfg.INCLUDE_NOT_IN_TABLEAU) {
      excluded.cohorts++; excluded.value += o.total; excluded.accounts[o.fullId] = true;
      return;
    }
    const L = makeLine({
      accountNameWithOrg: (sf["Account Name"] || o.accountName) + (sf["Student Org Id"] ? " (" + sf["Student Org Id"] + ")" : ""),
      studentOrgId: FY27_str_(sf["Student Org Id"]),
      accountName: FY27_str_(sf["Account Name"] || o.accountName),
      fullId: FY27_str_(sf["FULL ID"] || o.fullId),
      rating: FY27_str_(ratingByFull[o.fullId] || (notInTableau ? sf["Rating"] : "")),
      clientCategory: FY27_str_(sf["Client Category"]),
      clientSubCategory: FY27_str_(sf["Client Sub-Category"]),
      billingState: FY27_str_(sf["Billing State/Province"]),
      accountOwner: FY27_str_(sf["Account Owner"]),
      csm: FY27_str_(sf["Client Success Manager"]),
      parentAccount: FY27_str_(sf["Parent Account"]),
      billingCountry: FY27_str_(sf["Billing Country"]),
      parentAccountId: FY27_str_(sf["Parent Account ID"]),
      accountRecordType: FY27_str_(sf["Account Record Type"]),
      productGroup: o.group, productName: o.productName,
      forecastSource: cfg.SOURCES.OTC,
      contractId: o.contractId, contractStart: o.contractStart, contractEnd: o.contractEnd,
      forecastMonth: o.month, estStudents: o.estStudents, price: o.price, bookingId: o.bookingId,
      cohortNames: o.cohortName, cohortCodes: o.cohortCode,
      productCode: o.productCode, productType: o.productType, modality: o.modality, otcProgram: o.otcProgram, termMonths: o.termMonths,
      bookingType: o.isRebooking ? "Rebooking" : "Roster Chasing",
      status: o.booked ? "Booked" : "Forecast",
      stage: o.booked ? "Submitted" : (o.isRebooking ? "Not needed" : "Not started"),
      forecastAmount: o.total, otcEstimate: o.total,
      expectation: o.booked ? "Captured" : "Expected"
    });
    if (!o.booked && (cfg.ENROLLMENT_BASIS || "actual") === "actual" && o.price > 0) {
      // no baseline for this cohort: size it from what the same cohort ACTUALLY enrolled last time (OTC estimates are the rep's
      // expectation at signing); if the cohort is new, fall back to the account's actual-vs-estimate history
      const last = history.cohortLast[o.fullId + "|" + o.cohortName];
      const tr = history.ratio[o.fullId + "|" + o.group + "|" + o.family];
      if (last && last.month < o.month && last.final > 0) {
        L.adjStudents = last.final;
        L.forecastAmount = FY27_round2_(last.final * o.price);
        L.flags.push("Cohort size from last actual enrollment: " + last.final + " students (" + last.month + ") instead of OTC estimate " + o.estStudents);
      } else if (cfg.USE_TREND && tr && Math.abs(tr.ratio - 1) >= cfg.TREND_MIN_DELTA && o.estStudents > 0) {
        const adj = Math.round(o.estStudents * tr.ratio);
        L.adjStudents = adj;
        L.forecastAmount = FY27_round2_(adj * o.price);
        L.flags.push("Cohort size from account's actual-vs-estimate history: " + o.estStudents + " -> " + adj + " (x" + FY27_round2_(tr.ratio) + " over " + tr.n + " cohorts)");
      }
    }
    if (notInTableau) {
      const cr = creditFor(o.fullId, o.group, o.month, null);
      L.credit = cr.credit; L.creditBasis = cr.basis;
    } else {
      // account is in Tableau but this cohort has no baseline line: incremental, so new sales credit
      L.credit = "New"; L.creditBasis = "Cohort not in " + (year - 1) + " baseline: new sales credit";
    }
    L.flags.push(notInTableau
      ? "Not in Tableau (no " + (year - 1) + " actuals): new account or missing bookings - verify"
      : "No matching " + (year - 1) + " baseline for this cohort - new cohort or product");
    applyRatingAndAdj(L, null, !o.booked);
    // Existing account, but this program did not book last year -> do not add it for next year
    // Only FIRST-TIME cohorts (no cohort code) can be a dormant program: a cohort code exists only once the class has booked, so a coded
    // cohort is an existing class and the program is alive (e.g. Capital Idea PN, booked last week, has codes).
    if (cfg.EXCLUDE_UNBOOKED_PROGRAMS && !o.booked && !o.isRebooking && !notInTableau && !programActive(o.fullId, o.group, o.family)) {
      const last = history.lastByFamily[o.fullId + "|" + o.group + "|" + o.family];
      const noteBase = "No " + (year - 1) + " booking for this program (" + o.family + ")" + (last ? ", last booked " + last : "");
      if ((cfg.DORMANT_PROGRAM_ACTION || "weight") === "zero") {
        L.valueIfBooked = L.forecastAmount;
        L.expectation = "Not Expected";
        L.reason = "No Revenue This Term";
        L.segment = "Program not booked in " + (year - 1);
        L.forecastAmount = 0;
        L.flags.push(noteBase + " - first-time cohort: $" + Math.round(L.valueIfBooked).toLocaleString() + " in OTC, forecast $0 until confirmed. If the program is returning, type the amount in Forecast $");
      } else {
        // flag and weight down; a CSM decides
        L.expectation = cfg.AT_RISK_CATEGORY;
        L.weightOverride = cfg.DORMANT_PROGRAM_WEIGHT;
        L.segment = "Program not booked in " + (year - 1);
        L.flags.push(noteBase + " - first-time cohort, weighted down. CSM: confirm the program is running, or set Not Expected");
      }
    }
    lines.push(L);
  });

  /* ---- 2-. Active iHP accounts: the maintained iHP account list is the reference for the iHP product group ----
   * When the "iHP Active Accounts" tab has rows, an iHP line (baseline-driven or OTC-only) whose account is not on that list is dropped entirely:
   * it is not forecast, not shown, and not counted. Manual add-ons and carry-ins are never dropped. No rows = rule off. */
  const ihpIgnored = { active: false, activeAccounts: 0, lines: 0, baseline: 0, forecast: 0, accounts: 0, top: [] };
  (function () {
    const rowsIn = (input.ihpActive || []).filter(function (r) { return FY27_str_(FY27_pick_(r, ["Business Org Account ID", "Full ID"])) || FY27_str_(FY27_pick_(r, ["Student Org Account ID", "Student Org ID"])) || FY27_str_(r["Account"]); });
    if (!rowsIn.length) return;
    const ids = {}, names = {};
    rowsIn.forEach(function (r) {
      const f = FY27_id15_(FY27_pick_(r, ["Business Org Account ID", "Full ID"])), s = FY27_id15_(FY27_pick_(r, ["Student Org Account ID", "Student Org ID"])), n = FY27_str_(r["Account"]).toLowerCase();
      if (f) ids[f] = true; if (s) ids[s] = true; if (n) names[n] = true;
    });
    const groups = cfg.IHP_ACTIVE_GROUPS || [];
    ihpIgnored.active = true;
    ihpIgnored.activeAccounts = Object.keys(ids).length;
    const byAcct = {};
    const kept = [];
    lines.forEach(function (L) {
      if (groups.indexOf(L.productGroup) < 0 || ids[FY27_id15_(L.fullId)] || ids[FY27_id15_(L.studentOrgId)] || names[FY27_str_(L.accountName).toLowerCase()]) { kept.push(L); return; }
      ihpIgnored.lines++; ihpIgnored.baseline += L.baselineAmount; ihpIgnored.forecast += L.forecastAmount;
      const k = L.accountName || L.fullId;
      byAcct[k] = (byAcct[k] || 0) + L.baselineAmount;
    });
    lines = kept;
    ihpIgnored.accounts = Object.keys(byAcct).length;
    ihpIgnored.baseline = FY27_round2_(ihpIgnored.baseline); ihpIgnored.forecast = FY27_round2_(ihpIgnored.forecast);
    ihpIgnored.top = Object.keys(byAcct).sort(function (a, b) { return byAcct[b] - byAcct[a]; }).slice(0, 10).map(function (k) { return { account: k, baseline: FY27_round2_(byAcct[k]) }; });
  })();

  /* ---- 2a. Booked early: a cohort for the forecast year that was already booked while it is still the year before ----
   * The team credits a booking to the month it is signed, so an order that is already booked in the year before the forecast year is a
   * prior-year booking (it shows as Captured in that year's forecast). It stays on its baseline line - the baseline slot is still in the
   * forecast year - but carries $0 here so it is not counted twice. Only while "now" is before the forecast year: once the year has
   * started, booked orders are real bookings of the year and this rule switches itself off. */
  const earlyBooked = { lines: 0, value: 0, active: false };
  if (cfg.EARLY_BOOKED_TREATMENT === "prior_year" && now.getFullYear() < year) {
    earlyBooked.active = true;
    lines.forEach(function (L) {
      if (L.isManual || L.expectation !== "Captured" || !(L.forecastAmount > 0)) return;
      if (FY27_yearOf_(L.forecastMonth) !== year) return;
      earlyBooked.lines++; earlyBooked.value += L.forecastAmount;
      L.flags.push("Booked early: $" + Math.round(L.forecastAmount).toLocaleString() + " was signed in " + (year - 1) + " and counts in " + (year - 1) + " bookings, so $0 here (baseline stays)");
      L.earlyAmount = L.forecastAmount;
      L.forecastAmount = 0; L.valueIfBooked = L.valueIfBooked || L.earlyAmount;
      L.expectation = "Not Expected"; L.reason = cfg.EARLY_BOOKED_REASON; L.stage = ""; L.weightOverride = undefined;
    });
    earlyBooked.value = FY27_round2_(earlyBooked.value);
  }

  /* ---- 2b. Manual add-ons (the "Manual Add-Ons" tab): lines the data does not know about ---- */
  const manualResults = [];
  const firstBaseByFull = {}, firstBaseByBilling = {}, sfByOrg = {};
  base.forEach(function (b) {
    if (b.fullId && !firstBaseByFull[b.fullId]) firstBaseByFull[b.fullId] = b;
    if (b.billingId && !firstBaseByBilling[b.billingId]) firstBaseByBilling[b.billingId] = b;
  });
  (input.salesforce || []).forEach(function (r) { const o2 = FY27_str_(r["Student Org Id"]); if (o2 && !sfByOrg[o2]) sfByOrg[o2] = r; });
  (input.manual || []).forEach(function (r) {
    const idRaw = FY27_str_(FY27_pick_(r, ["Full ID", "FULL ID"])) || FY27_str_(r["Student Org ID"]);
    const month = FY27_monthKey_(r["Forecast Month"]);
    const amtRaw = FY27_str_(r["Amount"]);
    const group = FY27_str_(r["Product Group"]);
    if (!idRaw && !FY27_str_(r["Account Name"]) && !month && amtRaw === "" && !group) return;       // blank row
    const problems = [];
    if (!idRaw && !FY27_str_(r["Account Name"])) problems.push("Full ID, Student Org ID or Account Name needed");
    if (!month) problems.push("Forecast Month missing");
    else if (FY27_yearOf_(month) !== year) problems.push("Forecast Month must be in " + year);
    if (amtRaw === "" || !/\d/.test(amtRaw)) problems.push("Amount missing");
    if (!group) problems.push("Product Group missing");
    if (problems.length) { manualResults.push({ row: r.__row, status: "NOT ADDED: " + problems.join("; ") }); return; }
    const id15 = FY27_id15_(idRaw);
    const b0 = firstBaseByFull[id15] || firstBaseByBilling[idRaw] || null;
    const sf0 = sfById[id15] || sfByOrg[idRaw] || null;
    let attrs = {};
    if (b0) attrs = attrsFromBaseline(b0);
    else if (sf0) attrs = {
      accountNameWithOrg: FY27_str_(sf0["Account Name"]) + (sf0["Student Org Id"] ? " (" + sf0["Student Org Id"] + ")" : ""), studentOrgId: FY27_str_(sf0["Student Org Id"]),
      accountName: FY27_str_(sf0["Account Name"]), fullId: FY27_str_(sf0["FULL ID"]), rating: FY27_str_(sf0["Rating"]), clientCategory: FY27_str_(sf0["Client Category"]),
      clientSubCategory: FY27_str_(sf0["Client Sub-Category"]), billingState: FY27_str_(sf0["Billing State/Province"]), accountOwner: FY27_str_(sf0["Account Owner"]),
      csm: FY27_str_(sf0["Client Success Manager"]), parentAccount: FY27_str_(sf0["Parent Account"]), billingCountry: FY27_str_(sf0["Billing Country"]),
      parentAccountId: FY27_str_(sf0["Parent Account ID"]), accountRecordType: FY27_str_(sf0["Account Record Type"])
    };
    const M = makeLine(attrs);
    // a manual line is not tied to a baseline row
    M.baselineMonth = ""; M.bookingId = ""; M.priorBookingType = ""; M.nextBookingType = ""; M.adjustment = "FALSE";
    if (!b0 && !sf0) { M.fullId = idRaw; }
    if (FY27_str_(r["Account Name"])) M.accountName = FY27_str_(r["Account Name"]);
    if (FY27_str_(r["CSM"])) M.csm = FY27_str_(r["CSM"]);
    M.productGroup = group; M.productName = FY27_str_(r["Product Name"]);
    M.forecastSource = cfg.SOURCES.MANUAL;
    M.forecastMonth = month;
    M.forecastAmount = FY27_num_(amtRaw);
    M.valueIfBooked = M.forecastAmount;
    const catLc = FY27_str_(r["Forecast Category"]).toLowerCase();
    M.expectation = (cfg.CATEGORIES || []).filter(function (c) { return c.toLowerCase() === catLc; })[0] || "Expected";
    M.status = M.expectation === "Captured" ? "Booked" : "Forecast";
    M.bookingType = FY27_str_(r["Booking Type"]) || "Manual add-on";
    M.reason = M.expectation === "Not Expected" ? FY27_str_(r["Not Expected Reason"]) : "";
    M.stage = M.expectation === "Not Expected" ? "" : (FY27_str_(r["Roster Stage"]) || (M.status === "Booked" ? "Submitted" : "Not started"));
    M.segment = "Manual add-on";
    M.isManual = true; M.manualRow = r.__row;
    M.flags.push("Manual add-on" + (FY27_str_(r["Comment"]) ? ": " + FY27_str_(r["Comment"]) : ""));
    lines.push(M);
    manualResults.push({ row: r.__row, status: (b0 || sf0) ? "Added" : "Added (ID not found in the data - check it)" });
  });

  /* ---- 2c. Link to the current prior-year forecast (the Nov/Dec tab) ----
   * Open lines whose forecast month the CSMs have already pushed into the forecast year are carried in. A pushed line replaces an
   * unconfirmed OTC-only line for the same account and group within the match window (so it is not counted twice); otherwise it is added.
   * Lines still dated in the prior year and not booked are only counted as carry-in at CARRY_OPEN_SLIP_RATE (the share expected to slip). */
  const carryStats = { rows: 0, pushedLines: 0, pushedValue: 0, replaced: 0, added: 0, openLines: 0, openValue: 0, slipLines: 0, slipValue: 0, skipped: 0, duplicateWarnings: 0 };
  (input.carry || []).forEach(function (r) {
    const catRaw = FY27_str_(FY27_pick_(r, ["Forecast Category"]));
    const catLc = catRaw.toLowerCase();
    const amount = FY27_num_(FY27_pick_(r, ["Forecast Amount"]));
    const month = FY27_monthKey_(FY27_pick_(r, ["Forecast Month"]));
    if (!month || !(amount > 0)) return;
    carryStats.rows++;
    if (catLc.indexOf("captured") === 0 || catLc.indexOf("not expected") === 0) return;   // booked in the prior year, or not expected
    const mapped = catLc.indexOf("risk") === 0 ? "At Risk" : catLc.indexOf("pending") === 0 ? "Pending Contract" : "Expected";
    let useMonth = "", useAmount = amount, cat = mapped, why = "";
    if (FY27_yearOf_(month) === year) {
      useMonth = month; why = "Pushed from the " + (year - 1) + " forecast (was " + (FY27_monthKey_(FY27_pick_(r, ["Baseline Month"])) || "Nov/Dec " + (year - 1)) + ")";
      carryStats.pushedLines++; carryStats.pushedValue += amount;
    } else if (FY27_yearOf_(month) === year - 1) {
      carryStats.openLines++; carryStats.openValue += amount;
      if (!(cfg.CARRY_OPEN_SLIP_RATE > 0)) return;
      useMonth = year + "-" + FY27_pad2_(cfg.CARRY_OPEN_SLIP_MONTH || 1); useAmount = FY27_round2_(amount * cfg.CARRY_OPEN_SLIP_RATE); cat = "At Risk";
      why = "Open " + (year - 1) + " line (" + month + ") assumed " + Math.round(cfg.CARRY_OPEN_SLIP_RATE * 100) + "% to slip into " + useMonth;
      carryStats.slipLines++; carryStats.slipValue += useAmount;
    } else return;
    const id15 = FY27_id15_(FY27_pick_(r, ["Account Full ID", "Full ID"]));
    const group = FY27_str_(FY27_pick_(r, ["Product Group"]));
    const note = FY27_str_(FY27_pick_(r, ["Latest Comment"])).replace(/\s+/g, " ").slice(0, 140);
    // an OTC-only, unconfirmed line for the same account and group is the same cohort: upgrade it instead of adding a second line
    let twin = null;
    lines.forEach(function (L) {
      if (twin || L.isManual || L.status !== "Forecast" || L.baselineAmount > 0 || L.carryUsed) return;
      if (FY27_id15_(L.fullId) !== id15 || L.productGroup !== group) return;
      if (Math.abs(FY27_monthDiff_(L.forecastMonth, useMonth)) > cfg.MATCH_TOLERANCE_MONTHS) return;
      twin = L;
    });
    if (twin) {
      twin.carryUsed = true;
      twin.forecastAmount = useAmount; twin.valueIfBooked = useAmount; twin.expectation = cat; twin.weightOverride = undefined;
      twin.segment = "Pushed from " + (year - 1); twin.reason = ""; if (!twin.stage || twin.stage === "") twin.stage = "Not started";
      twin.flags.push(why + (note ? " - " + note : "") + " (replaces the OTC-only estimate)");
      carryStats.replaced++;
      return;
    }
    const b0 = firstBaseByFull[id15] || firstBaseByBilling[FY27_str_(FY27_pick_(r, ["Student Org ID"]))] || null;
    const sf0 = sfById[id15] || sfByOrg[FY27_str_(FY27_pick_(r, ["Student Org ID"]))] || null;
    let attrs = {};
    if (b0) attrs = attrsFromBaseline(b0);
    else if (sf0) attrs = {
      accountNameWithOrg: FY27_str_(sf0["Account Name"]) + (sf0["Student Org Id"] ? " (" + sf0["Student Org Id"] + ")" : ""), studentOrgId: FY27_str_(sf0["Student Org Id"]),
      accountName: FY27_str_(sf0["Account Name"]), fullId: FY27_str_(sf0["FULL ID"]), rating: FY27_str_(sf0["Rating"]), clientCategory: FY27_str_(sf0["Client Category"]),
      csm: FY27_str_(sf0["Client Success Manager"]), parentAccount: FY27_str_(sf0["Parent Account"])
    };
    const C = makeLine(attrs);
    C.baselineMonth = ""; C.bookingId = ""; C.priorBookingType = ""; C.nextBookingType = ""; C.adjustment = "FALSE";
    if (!b0 && !sf0) C.fullId = id15;
    if (!C.studentOrgId) C.studentOrgId = FY27_str_(FY27_pick_(r, ["Student Org ID"]));
    if (!C.accountName) C.accountName = FY27_str_(FY27_pick_(r, ["Account Name"]));
    if (!C.csm) C.csm = FY27_str_(FY27_pick_(r, ["Current CSM"]));
    if (!C.rating) C.rating = FY27_str_(FY27_pick_(r, ["Health Rating"]));
    C.productGroup = group; C.productName = FY27_str_(FY27_pick_(r, ["Product"]));
    C.forecastSource = cfg.SOURCES.CARRY; C.forecastMonth = useMonth;
    C.forecastAmount = useAmount; C.valueIfBooked = useAmount; C.expectation = cat; C.status = "Forecast";
    C.bookingType = FY27_str_(FY27_pick_(r, ["Booking Type"])) || "Renewal"; C.stage = "Not started"; C.segment = "Pushed from " + (year - 1);
    C.flags.push(why + (note ? " - " + note : ""));
    const dup = lines.some(function (L) {
      return !L.isManual && FY27_id15_(L.fullId) === id15 && L.productGroup === group && L.forecastAmount > 0 && Math.abs(FY27_monthDiff_(L.forecastMonth, useMonth)) <= cfg.MATCH_TOLERANCE_MONTHS;
    });
    if (dup) { C.flags.push("CHECK: this account/product group already has a forecast line within " + cfg.MATCH_TOLERANCE_MONTHS + " months - make sure it is not counted twice"); carryStats.duplicateWarnings++; }
    lines.push(C);
    carryStats.added++;
  });
  carryStats.pushedValue = FY27_round2_(carryStats.pushedValue); carryStats.openValue = FY27_round2_(carryStats.openValue); carryStats.slipValue = FY27_round2_(carryStats.slipValue);

  /* ---- 3. Group detail lines: one row per account x billing org x product group x month x credit x status ---- */
  if (!cfg.TAG_CREDIT) lines.forEach(function (d) { d.credit = ""; d.creditBasis = ""; });
  const detail = lines;
  const weightOf = function (L) {
    if (L.expectation === "Not Expected") return 0;
    if (L.weightOverride !== undefined) return L.weightOverride;
    const w = cfg.WEIGHTS && cfg.WEIGHTS[L.expectation];
    return w === undefined ? 1 : w;
  };
  detail.forEach(function (d) { d.weight = weightOf(d); d.weightedAmount = FY27_round2_(d.forecastAmount * d.weight); });
  const groups = {};
  const order = [];
  detail.forEach(function (d) {
    d.forecastQuarter = FY27_quarterOf_(d.forecastMonth);
    const gk = [FY27_id15_(d.fullId), d.studentOrgId, d.productGroup, d.forecastMonth, d.credit, d.status, d.expectation, d.isManual ? "M" + d.manualRow : ""].join("|");
    if (!groups[gk]) { groups[gk] = []; order.push(gk); }
    groups[gk].push(d);
  });
  const grouped = order.map(function (gk) { return FY27_mergeLines_(groups[gk], makeLine); });

  /* ---- 4. Apply manual overrides (keyed on the grouped line so they survive refreshes) ---- */
  // The key must not change when a data refresh changes a line's category, so it holds account, product group, month and booked-or-not only;
  // rows that share it are numbered in a fixed order (largest first).
  const keyCount = {};
  grouped.slice().sort(function (a, b) {
    return (a.forecastAmount < b.forecastAmount ? 1 : a.forecastAmount > b.forecastAmount ? -1 : 0) ||
      (a.productName < b.productName ? -1 : a.productName > b.productName ? 1 : 0);
  }).forEach(function (L) {
    const base = [FY27_id15_(L.fullId), L.studentOrgId, L.productGroup, L.forecastMonth, L.status, L.isManual ? "M" + L.manualRow : ""].join("|");
    keyCount[base] = (keyCount[base] || 0) + 1;
    L.key = base + "|" + keyCount[base];
  });
  const lineKeys = {};
  grouped.forEach(function (L) { lineKeys[L.key] = true; });
  const ovByKey = {};
  (input.overrides || []).forEach(function (r) {
    const k = FY27_str_(r["Line Key"]);
    if (k) ovByKey[k] = r;
  });
  let overridesApplied = 0;
  const overrideStatus = {};      // key -> "Applied" | "Not found"
  Object.keys(ovByKey).forEach(function (k) {
    const o = ovByKey[k];
    const has = ["Override Amount", "Override Month", "Forecast Category", "Not Expected Reason", "Roster Stage", "Comment"].some(function (f) { return FY27_str_(o[f]) !== ""; }) || FY27_bool_(o["Exclude"]);
    if (has) overrideStatus[k] = lineKeys[k] ? "Applied" : "Not found";
  });
  grouped.forEach(function (L) {
    L.calc = { month: L.forecastMonth, amount: L.forecastAmount, category: L.expectation, reason: L.reason, stage: L.stage };   // what the engine says before any CSM change
    const ov = ovByKey[L.key];
    if (!ov) return;
    const exclude = FY27_bool_(ov["Exclude"]);
    const amt = FY27_str_(ov["Override Amount"]);
    const mo = FY27_monthKey_(ov["Override Month"]);
    const catRaw = FY27_str_(ov["Forecast Category"]).toLowerCase();
    const cat = (cfg.CATEGORIES || []).filter(function (c) { return c.toLowerCase() === catRaw; })[0] || "";
    const reasonRaw = FY27_str_(ov["Not Expected Reason"]);
    const stageRaw = FY27_str_(ov["Roster Stage"]);
    if (!exclude && amt === "" && !mo && !cat && !reasonRaw && !stageRaw) {
      if (FY27_str_(ov["Comment"])) L.flags.push("Note: " + FY27_str_(ov["Comment"]));       // a comment alone is shown, it changes nothing
      return;
    }
    overridesApplied++;
    if (cat) {
      L.expectation = cat;
      const w = cfg.WEIGHTS && cfg.WEIGHTS[cat];
      L.weight = w === undefined ? 1 : w;
      L.flags.push("Manual override: category " + cat);
    }
    if (reasonRaw) L.reason = reasonRaw;
    if (stageRaw) L.stage = stageRaw;
    if (exclude) { L.forecastAmount = 0; L.expectation = "Not Expected"; L.flags.push("Manual override: excluded"); }
    if (amt !== "") {
      L.forecastAmount = FY27_num_(amt); L.flags.push("Manual override: amount");
      if (FY27_num_(amt) > 0 && L.expectation === "Not Expected" && !cat && !exclude) {
        // typing an amount on a line that was $0 / not expected means the CSM expects it: count it as Expected (they can pick At Risk instead)
        L.expectation = "Expected"; L.weight = cfg.WEIGHTS && cfg.WEIGHTS.Expected !== undefined ? cfg.WEIGHTS.Expected : 1; L.weightOverride = undefined; L.reason = "";
        L.flags.push("Amount entered on a Not Expected line: counted as Expected");
      }
    }
    if (mo) { L.forecastMonth = mo; L.flags.push("Manual override: month"); }
    if (FY27_str_(ov["Comment"])) L.flags.push("Note: " + FY27_str_(ov["Comment"]));
  });
  lines = grouped;
  lines.forEach(function (L) {
    if (L.expectation === "Not Expected") L.stage = L.stage && L.stage !== "Not started" && L.stage !== "Not needed" ? L.stage : "";
    else L.reason = "";
  });
  // a grouped row keeps the blended weight of its parts; overrides (exclude / amount) rescale it
  lines.forEach(function (L) { L.weightedAmount = FY27_round2_(L.forecastAmount * (L.expectation === "Not Expected" ? 0 : L.weight)); });

  lines.forEach(function (L) { L.forecastQuarter = FY27_quarterOf_(L.forecastMonth); });
  lines.sort(function (a, b) {
    return (a.forecastMonth < b.forecastMonth ? -1 : a.forecastMonth > b.forecastMonth ? 1 : 0) ||
      (a.accountName < b.accountName ? -1 : a.accountName > b.accountName ? 1 : 0);
  });

  /* ---- 4. Review list + coverage ---- */
  const review = [];
  lines.forEach(function (L) {
    L.flags.forEach(function (f) {
      review.push({
        severity: FY27_severity_(f), flag: f, account: L.accountName, fullId: L.fullId,
        productGroup: L.productGroup, productName: L.productName, forecastMonth: L.forecastMonth,
        amount: L.forecastAmount, valueIfBooked: L.valueIfBooked || L.forecastAmount,
        csm: L.csm, owner: L.accountOwner, key: L.key
      });
    });
  });
  const sevOrder = { High: 0, Medium: 1, Low: 2 };
  review.sort(function (a, b) { return sevOrder[a.severity] - sevOrder[b.severity] || (b.valueIfBooked - a.valueIfBooked); });

  // monthly coverage: how complete is each month?
  const cov = {};
  for (let m = 1; m <= 12; m++) cov[year + "-" + FY27_pad2_(m)] = { month: year + "-" + FY27_pad2_(m), booked: 0, forecast: 0, bookedLines: 0, forecastLines: 0, baselineIncomplete: false, weighted: 0 };
  lines.forEach(function (L) {
    const c = cov[L.forecastMonth];
    if (!c) return;
    if (L.status === "Booked") { c.booked += L.forecastAmount; c.bookedLines++; } else { c.forecast += L.forecastAmount; c.forecastLines++; c.weighted += L.weightedAmount; }
    if (L.flags.some(function (f) { return f.indexOf("not complete yet") >= 0; })) c.baselineIncomplete = true;
  });

  return {
    lines: lines,
    detail: detail,
    review: review,
    writeback: writeback,
    coverage: Object.keys(cov).sort().map(function (k) { return cov[k]; }),
    stats: {
      actualsThrough: actualsThrough,
      lines: lines.length,
      detailLines: detail.length,
      composition: (function () {
        const out = { byCategory: {}, bySource: {}, bySegment: {} };
        lines.forEach(function (L) {
          [["byCategory", L.expectation || "(none)"], ["bySource", L.forecastSource || "(none)"], ["bySegment", L.segment || "(cohort-backed or Tableau line)"]].forEach(function (p) {
            const x = out[p[0]][p[1]] || (out[p[0]][p[1]] = { n: 0, full: 0, weighted: 0 });
            x.n++; x.full += L.forecastAmount; x.weighted += L.weightedAmount;
          });
        });
        return out;
      })(),
      ignoredRosterChasing: ignoredRoster,
      earlyBooked: earlyBooked,
      ihpIgnored: ihpIgnored,
      mergeResults: mergeApplied.results,
      carry: carryStats,
      derivedAdjustments: derivedAdj,
      likelyAdjustments: likelyAdj,
      baseline: (function () {
        const r2 = FY27_round2_;
        const tab = base.filter(function (b) { return !b.fromAdjTab; }).reduce(function (t, b) { return t + b.baseAmt; }, 0);
        const adjT = base.filter(function (b) { return b.fromAdjTab; }).reduce(function (t, b) { return t + b.baseAmt; }, 0);
        const inFc = detail.reduce(function (t, d) { return t + d.baselineAmount; }, 0);
        return { tableau: r2(tab), adjustmentsTab: r2(adjT), inForecast: r2(inFc), difference: r2(tab + adjT - inFc - ihpIgnored.baseline) };
      })(),
      excludedNotInTableau: { accounts: Object.keys(excluded.accounts).length, cohorts: excluded.cohorts, value: excluded.value },
      otcTargetRows: target.length,
      otcMatched: Object.keys(usedOtc).length,
      overridesApplied: overridesApplied,
      overrideStatus: overrideStatus,
      manualResults: manualResults,
      manualAdded: lines.filter(function (L) { return L.isManual; }).length,
      total: lines.reduce(function (s, L) { return s + L.forecastAmount; }, 0),
      totalWeighted: FY27_round2_(lines.reduce(function (s, L) { return s + L.weightedAmount; }, 0))
    }
  };
}

/**
 * Derive adjustments by comparing Tableau baseline-year bookings with OTC baseline-year actuals.
 *
 * Example (Aims RN): OTC Complete cohorts starting 2026-02 total $9,765. Tableau shows $9,585 in Feb and
 * $180 in Mar. 9,585 + 180 = 9,765, so the Mar $180 is an extra student added to the Feb cohort - an
 * adjustment, not a recurring booking.
 *
 * Per account + product group + Tableau family: for every month where OTC cohorts started ("anchor"),
 * if Tableau's amount for that month is short of the OTC total, look for a set of later Tableau rows (in months
 * where no OTC cohort started) that closes the gap exactly. Those rows are marked as adjustments.
 * Exact-sum matching keeps false positives low. Mutates the baseline row objects; returns a count.
 */
function FY27_deriveAdjustments_(base, otcAll, baseYear, maxAbs) {
  let found = 0;
  const cap = maxAbs > 0 ? maxAbs : Infinity;
  const byAcct = {};
  base.forEach(function (b) {
    if (!b.fullId || b.isBOS || b.isAdj || !b.baseMonth || b.baseAmt <= 0 || FY27_yearOf_(b.baseMonth) !== baseYear) return;
    const k = b.fullId + "|" + b.group + "|" + b.family;
    (byAcct[k] = byAcct[k] || []).push(b);
  });
  const otcByGroup = {};
  otcAll.forEach(function (o) {
    if (o.dne || !o.booked || !o.actStart || FY27_yearOf_(o.actStart) !== baseYear) return;
    (otcByGroup[o.fullId + "|" + o.group] = otcByGroup[o.fullId + "|" + o.group] || []).push(o);
  });
  Object.keys(byAcct).forEach(function (k) {
    const rows = byAcct[k];
    const parts = k.split("|");
    const fam = parts[2];
    const orders = (otcByGroup[parts[0] + "|" + parts[1]] || []).filter(function (o) { return FY27_familiesCompatible_(fam, o.family); });
    if (!orders.length) return;
    const otcByMonth = {};
    orders.forEach(function (o) { otcByMonth[o.actStart] = (otcByMonth[o.actStart] || 0) + o.total; });
    const anchors = Object.keys(otcByMonth).sort();
    const claimed = {};
    anchors.forEach(function (m) {
      const S = otcByMonth[m];
      let have = 0;
      rows.forEach(function (b) { if (b.baseMonth === m && !claimed[b.row]) have += b.baseAmt; });
      const gap = FY27_round2_(S - have);
      const tol = Math.max(1, S * 0.002);
      if (have <= 0 || gap <= tol) return;
      const cands = rows.filter(function (b) {
        return !claimed[b.row] && !otcByMonth[b.baseMonth] && b.baseAmt <= cap &&
          FY27_monthDiff_(b.baseMonth, m) > 0 && FY27_monthDiff_(b.baseMonth, m) <= 12;
      }).sort(function (x, y) { return x.baseMonth < y.baseMonth ? -1 : x.baseMonth > y.baseMonth ? 1 : 0; }).slice(0, 12);
      let best = null;
      for (let mask = 1; mask < (1 << cands.length); mask++) {
        let sum = 0, cnt = 0;
        for (let i = 0; i < cands.length; i++) if (mask & (1 << i)) { sum += cands[i].baseAmt; cnt++; }
        if (Math.abs(sum - gap) <= tol && (!best || cnt < best.cnt)) best = { mask: mask, cnt: cnt };
      }
      if (!best) return;
      for (let i = 0; i < cands.length; i++) {
        if (!(best.mask & (1 << i))) continue;
        const b = cands[i];
        claimed[b.row] = true;
        b.isAdj = true;
        b.adjReason = "Adjustment (derived): $" + Math.round(b.baseAmt).toLocaleString() + " booked " + b.baseMonth +
          " is extra students on the cohort that started " + m + " (OTC " + baseYear + " actuals $" + Math.round(S).toLocaleString() +
          " = Tableau " + m + " $" + Math.round(have).toLocaleString() + " + later adjustments). Not recurring, forecast $0";
        found++;
      }
    });
  });
  return found;
}

function FY27_median_(arr) {
  const a = arr.slice().sort(function (x, y) { return x - y; });
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/**
 * Flag POSITIVE Tableau lines that look like adjustments but did not reconcile to OTC: much smaller than the
 * same account + product's other bookings, in a month that product does not normally book in.
 * Mutates baseline rows (isAdj, adjReason); returns a count.
 */
function FY27_flagLikelyAdjustments_(base, otcAll, baseYear, cfg) {
  let found = 0;
  const groups = {};
  base.forEach(function (b) {
    if (!b.fullId || b.fromAdjTab || b.isAdj || b.baseAmt <= 0 || !b.baseMonth || FY27_yearOf_(b.baseMonth) !== baseYear) return;
    const k = b.fullId + "|" + b.group + "|" + b.family;
    (groups[k] = groups[k] || []).push(b);
  });
  Object.keys(groups).forEach(function (k) {
    const rows = groups[k];
    const parts = k.split("|");
    if ((cfg.FLAT_FEE_GROUPS || []).some(function (g) { return g.toUpperCase() === rows[0].group.toUpperCase(); })) return;   // add-ons handled by the flat-fee rule
    // normal booking months-of-year for this product: OTC cohort starts (any year) ...
    const normal = {};
    otcAll.forEach(function (o) {
      if (o.dne || !o.booked || !o.actStart || o.fullId !== parts[0] || o.group !== parts[1]) return;
      if (FY27_familiesCompatible_(parts[2], o.family)) normal[o.actStart.slice(5, 7)] = true;
    });
    rows.forEach(function (r) {
      const others = rows.filter(function (x) { return x !== r && !x.isAdj; });
      if (others.length < cfg.LIKELY_ADJ_MIN_OTHERS) return;
      const med = FY27_median_(others.map(function (x) { return x.baseAmt; }));
      // ... plus months where normal-sized Tableau bookings land
      const months = Object.assign({}, normal);
      others.forEach(function (x) { if (x.baseAmt >= med * 0.5) months[x.baseMonth.slice(5, 7)] = true; });
      if (r.baseAmt < med * cfg.LIKELY_ADJ_FRACTION && !months[r.baseMonth.slice(5, 7)]) {
        r.isAdj = true;
        r.adjReason = "Adjustment (likely): $" + Math.round(r.baseAmt).toLocaleString() + " booked " + r.baseMonth +
          " is much smaller than this product's usual bookings (median $" + Math.round(med).toLocaleString() +
          ") and not in its normal booking months. Not recurring, forecast $0";
        found++;
      }
    });
  });
  return found;
}

/** Collapse detail lines that share a group key into one forecast row. */
function FY27_mergeLines_(parts, makeLine) {
  const first = parts[0];
  const L = makeLine(first);
  const join = function (f) { return FY27_uniqJoin_(parts.map(function (p) { return p[f]; })); };
  const sum = function (f) { return FY27_round2_(parts.reduce(function (t, p) { return t + (Number(p[f]) || 0); }, 0)); };
  L.productName = join("productName");
  L.forecastSource = join("forecastSource");
  L.bookingId = join("bookingId");
  L.contractId = join("contractId");
  L.cohortNames = join("cohortNames");
  L.cohortCodes = join("cohortCodes");
  L.productCode = join("productCode"); L.productType = join("productType"); L.modality = join("modality"); L.otcProgram = join("otcProgram");
  L.termMonths = join("termMonths");
  L.priorCohorts = join("priorCohorts");
  L.creditBasis = join("creditBasis");
  L.priorBookingType = join("priorBookingType");
  L.nextBookingType = join("nextBookingType");
  L.baselineAmount = sum("baselineAmount");
  L.reason = join("reason"); L.stage = join("stage"); L.timing = join("timing");
  L.otcEstimate = parts.some(function (p) { return p.otcEstimate !== ""; }) ? sum("otcEstimate") : "";
  L.segment = FY27_uniqJoin_(parts.map(function (p) { return p.segment; }));
  const wsum = parts.reduce(function (t, p) { return t + (Number(p.weightedAmount) || 0); }, 0);
  const fsum = parts.reduce(function (t, p) { return t + (Number(p.forecastAmount) || 0); }, 0);
  L.weight = fsum ? wsum / fsum : first.weight;
  L.valueIfBooked = sum("valueIfBooked");
  L.forecastAmount = sum("forecastAmount");
  L.estStudents = parts.some(function (p) { return p.estStudents !== ""; }) ? sum("estStudents") : "";
  L.adjStudents = parts.some(function (p) { return p.adjStudents !== ""; })
    ? FY27_round2_(parts.reduce(function (t, p) { return t + (p.adjStudents !== "" ? Number(p.adjStudents) : (Number(p.estStudents) || 0)); }, 0)) : "";
  L.adjVariance = parts.some(function (p) { return p.adjVariance !== ""; }) ? sum("adjVariance") : "";
  const prices = {}; parts.forEach(function (p) { if (p.price !== "") prices[p.price] = true; });
  const pk = Object.keys(prices);
  L.price = pk.length === 1 ? Number(pk[0]) : "";
  const bm = parts.map(function (p) { return p.baselineMonth; }).filter(Boolean).sort();
  L.baselineMonth = bm.length ? bm[0] : "";
  const cs = parts.map(function (p) { return p.contractStart; }).filter(Boolean).sort();
  const ce = parts.map(function (p) { return p.contractEnd; }).filter(Boolean).sort();
  L.contractStart = cs.length ? cs[0] : "";
  L.contractEnd = ce.length ? ce[ce.length - 1] : "";
  L.adjustment = parts.some(function (p) { return p.adjustment === "TRUE"; }) ? "TRUE" : first.adjustment;
  const types = {}; parts.forEach(function (p) { types[p.bookingType] = true; });
  const hasRebook = types["Rebooking"] || types["Rebooking (assumed)"] || types["Mix"];
  const hasRoster = types["Roster Chasing"] || types["Mix"];
  L.bookingType = hasRebook && hasRoster ? "Mix" : Object.keys(types).length === 1 ? first.bookingType
    : types["Rebooking"] ? "Rebooking" : first.bookingType;
  const flags = [];
  parts.forEach(function (p) { p.flags.forEach(function (f) { if (flags.indexOf(f) < 0) flags.push(f); }); });
  L.flags = flags;
  L.forecastQuarter = first.forecastQuarter;
  L.detailCount = parts.length;
  return L;
}

/* ---------------- retention summary ---------------- */

/**
 * Retention for one engine result. Denominator = the Tableau baseline (+ Adjustments tab). "Gross" counts only lines linked to a Tableau
 * baseline row (what happens to last year's bookings); "net" also counts new / additional OTC cohorts.
 */
function FY27_retentionSummary_(result, name) {
  const b = result.stats.baseline;
  const baseline = b.tableau + b.adjustmentsTab;
  const o = { name: name, baseline: baseline, fullGross: 0, weightedGross: 0, fullNet: 0, weightedNet: 0, confirmedGross: 0 };
  result.lines.forEach(function (L) {
    const linked = String(L.forecastSource).indexOf("Tableau") >= 0;
    o.fullNet += L.forecastAmount; o.weightedNet += L.weightedAmount;
    if (linked) {
      o.fullGross += L.forecastAmount; o.weightedGross += L.weightedAmount;
      if (L.expectation === "Captured" || L.expectation === "Expected") o.confirmedGross += L.forecastAmount;
    }
  });
  const pct = function (v) { return baseline ? v / baseline : 0; };
  o.fullGrossPct = pct(o.fullGross); o.weightedGrossPct = pct(o.weightedGross); o.weightedNetPct = pct(o.weightedNet);
  o.fullNetPct = pct(o.fullNet); o.confirmedGrossPct = pct(o.confirmedGross);
  return o;
}

/** Re-run the engine under the alternative models so their predicted retention can be compared side by side. */
function FY27_retentionModels_(input, cfg, defaultResult) {
  const rows = [];
  const base = defaultResult.stats.baseline.tableau + defaultResult.stats.baseline.adjustmentsTab;
  rows.push({ name: "Repeat the Tableau baseline (no model)", baseline: base, fullGross: base, weightedGross: base, fullNet: base, weightedNet: base, confirmedGross: base,
    fullGrossPct: 1, weightedGrossPct: 1, weightedNetPct: 1, fullNetPct: 1, confirmedGrossPct: 1 });
  [["OTC cohort amounts + trend (AMOUNT_BASIS otc)", { AMOUNT_BASIS: "otc" }],
   ["OTC amounts capped at Tableau (AMOUNT_BASIS min)", { AMOUNT_BASIS: "min" }]].forEach(function (m) {
    rows.push(FY27_retentionSummary_(FY27_buildForecast(input, Object.assign({}, cfg, m[1])), m[0]));
  });
  const d = FY27_retentionSummary_(defaultResult, "Tableau baseline anchored (current model: AMOUNT_BASIS " + (cfg.AMOUNT_BASIS || "otc") + ")");
  rows.push(d);
  rows.push(FY27_retentionSummary_(FY27_buildForecast(input, Object.assign({}, cfg, { EXTRA_COHORTS: false })), "Current model without additional predicted cohorts"));
  return rows;
}

/**
 * Historical actual retention from the raw Tableau crosstab (Level 1 "Account (OrgID)", Level 2 product group, Transaction Date Group "Jun-26",
 * Metric value Sales incl. negative adjustments). For each year pair: keys = account x product group booked in the earlier year.
 *   gross $ = sum of min(this year, last year) / last year   (renewals only, no expansion)
 *   net $   = this year's bookings of those same keys / last year
 *   logo    = share of those keys with any booking this year
 * A year that is not complete yet is compared on the same months of both years (Jan..lastCompleteMonth).
 */
function FY27_historicalRetention_(rawRows, lastCompleteMonth) {
  const sums = {};     // year -> key -> {m: month-of-year -> $}
  const years = {};
  rawRows.forEach(function (r) {
    const l1 = FY27_str_(r["Crosstab Level 1"] || r["Crosstab Level 1 "]);
    const mo = FY27_monthKey_(r["Transaction Date Group"]);
    if (!l1 || !mo) return;
    const m = l1.match(/\(([A-Za-z0-9]{10,18})\)\s*$/);
    const key = (m ? FY27_id15_(m[1]) : l1) + "|" + FY27_str_(r["Crosstab Level 2"]);
    const y = FY27_yearOf_(mo), mm = parseInt(mo.slice(5, 7), 10);
    years[y] = true;
    const ym = sums[y] || (sums[y] = {});
    const k = ym[key] || (ym[key] = {});
    k[mm] = (k[mm] || 0) + FY27_num_(r["Metric value Sales"]);
  });
  const ys = Object.keys(years).map(Number).sort();
  const lastY = FY27_yearOf_(lastCompleteMonth), lastM = parseInt(lastCompleteMonth.slice(5, 7), 10);
  const out = [];
  ys.forEach(function (y) {
    if (!years[y - 1]) return;
    const partial = y > lastY || (y === lastY && lastM < 12);
    const upto = partial ? lastM : 12;
    const tot = function (obj, key) { const k = obj[key]; if (!k) return 0; let s = 0; for (let i = 1; i <= upto; i++) s += k[i] || 0; return s; };
    let base = 0, gross = 0, net = 0, n = 0, kept = 0;
    Object.keys(sums[y - 1]).forEach(function (key) {
      const prev = tot(sums[y - 1], key);
      if (prev <= 0) return;
      const cur = tot(sums[y] || {}, key);
      base += prev; gross += Math.min(Math.max(cur, 0), prev); net += cur; n++; if (cur > 0) kept++;
    });
    if (base > 0) out.push({ label: (y - 1) + " to " + y + (partial ? " (Jan-" + FY27_MONTH_NAMES_[upto - 1] + " of both years)" : ""), baseline: base,
      grossPct: gross / base, netPct: net / base, logoPct: n ? kept / n : 0, accounts: n });
  });
  return out;
}

/** The 2026 team forecast as recorded in the 2026 forecast reference: forecast / baseline over the forecast lines. */
function FY27_team2026Retention_(rows) {
  let base = 0, fc = 0, manual = 0;
  rows.forEach(function (r) {
    if (FY27_str_(r["Forecast Line Type"]).toLowerCase().indexOf("adjust") >= 0) return;
    // "Manual Add" lines are new sales and placeholders with no baseline; they are not retention of the baseline
    if (FY27_str_(r["Forecast Source"]).toLowerCase().indexOf("manual") >= 0) { manual += FY27_num_(r["Forecast Amount"]); return; }
    base += FY27_num_(r["Baseline Amount"]); fc += FY27_num_(r["Forecast Amount"]);
  });
  return base > 0 ? { baseline: base, forecast: fc, pct: fc / base, manualAdds: manual, pctWithManual: (fc + manual) / base } : null;
}

/* ---------------- CSM working tab (pure helpers) ---------------- */

/** Columns of the CSM tab: [header, line field, kind]. "SET:" columns and Comment are the CSM's inputs (stored on the Overrides tab). */
// Display order, left to right. The marked columns are EDITABLE IN PLACE: type over them (the cell turns orange when it differs from the calculated value).
const FY27_CSM_COLUMNS = [
  ["CSM", "csm"], ["Account Name", "accountName"], ["Product Group", "productGroup"], ["Product Name", "productName"],
  ["Baseline Month", "baselineMonth", "month"], ["Baseline $", "baselineAmount", "money"], ["Forecast Month", "forecastMonth", "month", true],
  ["Forecast $", "forecastAmount", "money", true], ["Weighted $", "weightedAmount", "money"],
  ["Forecast Category", "expectation", "", true], ["Not Expected Reason", "reason", "", true], ["Roster Stage", "stage", "", true]
];
// editable column -> the field it sets on the Overrides tab -> the hidden column holding the calculated value it is compared with
const FY27_CSM_EDITS = [
  ["Forecast Month", "Override Month", "Calc: Month"], ["Forecast $", "Override Amount", "Calc: Amount"], ["Forecast Category", "Forecast Category", "Calc: Category"],
  ["Not Expected Reason", "Not Expected Reason", "Calc: Reason"], ["Roster Stage", "Roster Stage", "Calc: Stage"]
];
// every column a CSM may type in (the five above plus Comment)
const FY27_CSM_INPUTS = FY27_CSM_EDITS.map(function (x) { return x[0]; }).concat(["Comment"]);
// right after Comment: whether the change was saved, the explanation, the hidden key and the hidden calculated values
const FY27_CSM_TAIL = ["Saved?", "Why (flags)", "Line Key"].concat(FY27_CSM_EDITS.map(function (x) { return x[2]; }));
// to the right: rating, IDs (to copy into Manual Add-Ons / Account Merges), what kind of line it is, and which cohorts it is made of
const FY27_CSM_DETAIL = [
  ["Rating", "rating"], ["Timing vs Baseline", "timing"], ["Full ID", "fullId"], ["Student Org ID", "studentOrgId"], ["Source", "forecastSource"],
  ["Booking Type", "bookingType"], ["Cohort Names", "cohortNames"], ["Cohort Codes", "cohortCodes"], ["Est. Students", "estStudents"], ["Price Per Student", "price", "money"],
  ["Prior-Year Cohorts", "priorCohorts"], ["Contract End", "contractEnd"], ["Weight", "weight", "pct"], ["Weight Basis", "segment"]
];

function FY27_csmHeaders_() {
  return FY27_CSM_COLUMNS.map(function (c) { return c[0]; }).concat(["Comment"], FY27_CSM_TAIL, FY27_CSM_DETAIL.map(function (c) { return c[0]; }));
}

/** Rows for the CSM tab, sorted CSM > account > month, with each line's saved override (from the Overrides tab) pre-filled. */
function FY27_csmRows_(lines, overrideRows, status) {
  const ovByKey = {};
  (overrideRows || []).forEach(function (r) { const k = FY27_str_(r["Line Key"]); if (k) ovByKey[k] = r; });
  const sorted = lines.slice().sort(function (a, b) {
    return (a.csm < b.csm ? -1 : a.csm > b.csm ? 1 : 0) || (a.accountName < b.accountName ? -1 : a.accountName > b.accountName ? 1 : 0) ||
      (a.forecastMonth < b.forecastMonth ? -1 : a.forecastMonth > b.forecastMonth ? 1 : 0);
  });
  const val = function (v) { return v === undefined || v === null ? "" : v; };
  return sorted.map(function (L) {
    const o = ovByKey[L.key] || {};
    const c = L.calc || { month: L.forecastMonth, amount: L.forecastAmount, category: L.expectation, reason: L.reason, stage: L.stage };
    // same clean-up the engine applies to the displayed values, so "unchanged" compares equal
    const isNE = c.category === "Not Expected";
    const calcReason = isNE ? c.reason : "";
    const calcStage = isNE ? (c.stage && c.stage !== "Not started" && c.stage !== "Not needed" ? c.stage : "") : c.stage;
    const row = FY27_CSM_COLUMNS.map(function (col) { return val(L[col[1]]); });
    const saved = status && status[L.key] ? (status[L.key] === "Applied" ? "Applied" : "Not applied") : "";
    return row.concat([FY27_str_(o["Comment"]), saved, (L.flags || []).join(" | "), L.key, c.month, c.amount, c.category, calcReason, calcStage],
      FY27_CSM_DETAIL.map(function (col) { return val(L[col[1]]); }));
  });
}

/** One CSM-tab row -> the record kept on the Overrides tab. */
function FY27_overrideRecFromCsmRow_(headers, row) {
  const g = function (n) { const i = headers.indexOf(n); return i < 0 ? "" : row[i]; };
  const same = function (a, b) { return FY27_str_(a) === FY27_str_(b); };
  const rec = {
    "Line Key": FY27_str_(g("Line Key")), "Account": g("Account Name"), "Product": g("Product Group") + " / " + g("Product Name"), "Forecast Month": g("Calc: Month"),
    "Override Amount": "", "Override Month": "", "Forecast Category": "", "Not Expected Reason": "", "Roster Stage": "", "Comment": g("Comment")
  };
  // an override is only recorded where the cell now differs from the calculated value (typing the old value back clears it)
  const vm = FY27_monthKey_(g("Forecast Month")), cm = FY27_monthKey_(g("Calc: Month"));
  if (vm && vm !== cm) rec["Override Month"] = vm;
  const va = g("Forecast $"), ca = g("Calc: Amount");
  if (FY27_str_(va) !== "" && Math.abs(FY27_num_(va) - FY27_num_(ca)) > 0.005) rec["Override Amount"] = FY27_num_(va);
  if (FY27_str_(g("Forecast Category")) !== "" && !same(g("Forecast Category"), g("Calc: Category"))) rec["Forecast Category"] = g("Forecast Category");
  if (FY27_str_(g("Not Expected Reason")) !== "" && !same(g("Not Expected Reason"), g("Calc: Reason"))) rec["Not Expected Reason"] = g("Not Expected Reason");
  if (FY27_str_(g("Roster Stage")) !== "" && !same(g("Roster Stage"), g("Calc: Stage"))) rec["Roster Stage"] = g("Roster Stage");
  rec.empty = ["Override Amount", "Override Month", "Forecast Category", "Not Expected Reason", "Roster Stage", "Comment"].every(function (f) { return FY27_str_(rec[f]) === ""; });
  return rec;
}

/**
 * Upsert a record into the Overrides store (a 2-D array of values below `header`). A record with every input blank removes the stored row.
 * Returns { values, action: "added" | "updated" | "removed" | "none" }.
 */
function FY27_upsertOverride_(header, values, rec) {
  const col = function (n) { return header.indexOf(n); };
  const kc = col("Line Key");
  let idx = -1;
  for (let i = 0; i < values.length; i++) if (FY27_str_(values[i][kc]) === rec["Line Key"]) { idx = i; break; }
  if (rec.empty) {
    if (idx < 0) return { values: values, action: "none" };
    const out = values.slice(); out.splice(idx, 1);
    return { values: out, action: "removed" };
  }
  const row = idx >= 0 ? values[idx].slice() : header.map(function () { return ""; });
  Object.keys(rec).forEach(function (k) { const c = col(k); if (c >= 0) row[c] = rec[k]; });
  const out2 = values.slice();
  if (idx >= 0) { out2[idx] = row; return { values: out2, action: "updated" }; }
  out2.push(row);
  return { values: out2, action: "added" };
}

/** The "Read Me" tab text for CSMs. */
function FY27_readmeLines_(cfg) {
  const w = cfg.WEIGHTS || {};
  const pct = function (k) { return Math.round((w[k] === undefined ? 1 : w[k]) * 100) + "%"; };
  return [
    ["FY" + cfg.FORECAST_YEAR + " FORECAST - HOW TO USE THIS FILE"],
    [""],
    ["WHAT YOU DO"],
    ["1. Open the tab '" + cfg.SHEETS.CSM + "'. Use the filter on the CSM column to show only your accounts."],
    ["2. Each row is one account, product group and month. The columns to the far right (Why, Booking Type, Cohort Names, Est. Students, Price, Prior-Year Cohorts, Weight Basis) show what the row is made of: a renewal, a rebooking, or roster chasing (an extra predicted cohort). One row per cohort is on the '" + cfg.SHEETS.DETAIL + "' tab. 'Baseline Month' and 'Baseline $' are what the client booked in " + (cfg.FORECAST_YEAR - 1) + "; 'Forecast Month' and 'Forecast $' are what we expect (both editable); 'Why' explains any flag."],
    ["3. If a row is wrong, TYPE OVER the YELLOW cells: Forecast Month, Forecast $, Forecast Category, Not Expected Reason, Roster Stage, and add a Comment. Everything else is calculated. A cell you changed turns ORANGE; put the old value back to undo it."],
    ["4. Your change is saved the moment you type it ('Saved?' shows the time) and is applied at the next refresh (until then the cell shows what you typed, in orange, and Weighted $ has not moved yet). You never have to touch any other tab."],
    ["5. Something the data does not know about (a new sale, a one-off)? Add a line on the tab '" + cfg.SHEETS.MANUAL + "'. The Status column tells you if it was accepted."],
    [""],
    ["THE FIVE CATEGORIES (Forecast Category)"],
    ["Captured - already booked."],
    ["Expected - we expect it to book as shown (counts " + pct("Expected") + " in the weighted forecast)."],
    ["At Risk - could happen but we are not sure (weighted). The 'Why' says what is uncertain."],
    ["Pending Contract - the client's contract has ended or is not in the billing system yet; a renewal is needed first (weighted)."],
    ["Not Expected - we do not expect it (counts $0). Pick a reason: Lost, No Revenue This Term, Non-Recurring, Adjustment or Data Error."],
    [""],
    ["WEIGHTED $ - the number to use for totals"],
    ["'Forecast $ (full value)' is what the line is worth if it books. 'Weighted $' multiplies it by how likely that kind of line has been to book (Expected 100%, At Risk and Pending Contract lower, Not Expected 0%)."],
    ["Add up Weighted $, not Forecast $, for any total. Full value overstates the year."],
    [""],
    ["ROSTER STAGE (where you are with the roster)"],
    ["Not started, In progress, Received - held, Submitted, Not needed (rebookings and SSO need no new roster)."],
    [""],
    ["TIMING vs BASELINE"],
    ["Early / On time / Late is worked out for you from the forecast month. To move a month, type the new month over Forecast Month."],
    [""],
    ["SAME ACCOUNT, TWO IDs (e.g. a separate Billing ID created just for one booking)"],
    ["Add a row on the '" + cfg.SHEETS.MERGES + "' tab: From ID = the duplicate, Into ID = the main account (either can be a Full ID or Student Org ID). After the next refresh both count as one account. The Status column confirms."],
    [""],
    ["NEW OR DORMANT PROGRAMS START AT $0"],
    ["A first-time cohort for a program the client has not booked since last year (or never) shows Not Expected with $0 and the OTC value in the Why column. If it is really coming, type the amount in Forecast $ and it counts as Expected."],
    [""],
    ["iHP ACCOUNTS"],
    ["iHP lines for accounts that are not on the active iHP list (tab '" + cfg.SHEETS.IHP_ACTIVE + "') are ignored completely - they do not appear here. If a CSM expects one, add it on the '" + cfg.SHEETS.MANUAL + "' tab."],
    [""],
    ["THE 2026 NOV/DEC LINK"],
    ["Booked early: a " + cfg.FORECAST_YEAR + " cohort that is already booked now counts in " + (cfg.FORECAST_YEAR - 1) + " bookings. It stays on its baseline row but shows Not Expected, reason 'Booked in " + (cfg.FORECAST_YEAR - 1) + "', $0."],
    ["Pushed out: an open " + (cfg.FORECAST_YEAR - 1) + " Nov/Dec line moves into " + cfg.FORECAST_YEAR + " when its Forecast Month is changed to " + cfg.FORECAST_YEAR + " on the '" + cfg.SHEETS.CARRY + "' tab (source '" + cfg.SOURCES.CARRY + "')."],
    [""],
    ["REFRESH"],
    ["The file is rebuilt when new Tableau / OTC / Salesforce data is pasted in (menu: FY27 Forecast > Build / refresh forecast). Your yellow-cell changes are re-applied each time."],
    ["If a line changes so much in a refresh that your change cannot be matched, the 'Saved?' column on the CSM tab shows 'Not applied' (and the Overrides tab says NOT FOUND) - re-enter it on that line."],
    [""],
    ["DO NOT edit the non-yellow columns or the other tabs (Excel-style warning appears if you try). Questions: ask the forecast owner."]
  ];
}

function FY27_severity_(flag) {
  const f = flag.toLowerCase();
  if (f.indexOf("needs renewal") >= 0 || f.indexOf("no otc data") >= 0 || f.indexOf("not in tableau") >= 0 ||
      f.indexOf("no upcoming cohort") >= 0 || f.indexOf("no otc contract") >= 0) return "High";
  if (f.indexOf("not complete yet") >= 0 || f.indexOf("no matching") >= 0 || f.indexOf("after contract end") >= 0 ||
      f.indexOf("positive adjustment") >= 0 || f.indexOf("adjustment (derived)") >= 0 || f.indexOf("far from baseline") >= 0 || f.indexOf("adjustment (likely)") >= 0 || f.indexOf("booking for this program") >= 0 ||
      f.indexOf("adjustment: baseline") >= 0) return "Medium";
  return "Low";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FY27_buildForecast: FY27_buildForecast, FY27_gridToRows_: FY27_gridToRows_,
    FY27_monthKey_: FY27_monthKey_, FY27_addMonths_: FY27_addMonths_, FY27_family_: FY27_family_,
    FY27_num_: FY27_num_, FY27_retentionSummary_: FY27_retentionSummary_, FY27_retentionModels_: FY27_retentionModels_,
    FY27_historicalRetention_: FY27_historicalRetention_, FY27_team2026Retention_: FY27_team2026Retention_,
    FY27_csmHeaders_: FY27_csmHeaders_, FY27_CSM_DETAIL: FY27_CSM_DETAIL, FY27_csmRows_: FY27_csmRows_, FY27_overrideRecFromCsmRow_: FY27_overrideRecFromCsmRow_,
    FY27_upsertOverride_: FY27_upsertOverride_, FY27_applyMerges_: FY27_applyMerges_, FY27_readmeLines_: FY27_readmeLines_
  };
}
