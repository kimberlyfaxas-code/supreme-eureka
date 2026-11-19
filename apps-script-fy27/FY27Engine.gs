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
  let f = FY27_family_(group, productName + " " + program);
  if (f === "Other") f = FY27_family_(group, cohortName);
  return f;
}
function FY27_familiesCompatible_(a, b) {
  return a === b || a === "Other" || b === "Other";
}

/* ---------------- normalizers ---------------- */

function FY27_normOtc_(r, cfg) {
  const booked = (cfg.OTC_BOOKED_STATUSES || []).indexOf(FY27_str_(r["order_status"]).toLowerCase()) >= 0;
  const estStart = FY27_monthKey_(FY27_pick_(r, ["order_estimated_start_date"]));
  const actStart = FY27_monthKey_(FY27_pick_(r, ["order_actual_start_date"]));
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
    cohortCode: FY27_str_(FY27_pick_(r, ["Cohort Code (if present, then this is a rebooking)", "Cohort Code", "cohort_code"])),
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
    isAdj: FY27_bool_(r["Adjustment (true/false)"]),
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
  otc.forEach(function (o) {
    if (o.dne || !o.booked || !o.actStart) return;
    const k = o.fullId + "|" + o.group + "|" + o.family;
    const h = byKey[k] || (byKey[k] = { n: 0, est: 0, fin: 0 });
    if (o.estStudents > 0 && o.finalStudents >= 0) { h.n++; h.est += o.estStudents; h.fin += o.finalStudents; }
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
  return { ratio: ratio, firstByAccountGroup: firstByAccountGroup, firstByCohort: firstByCohort, lastByFamily: lastByFamily };
}

/* ---------------- main engine ---------------- */

/**
 * @param {Object} input { tableau:[rowObj], otc:[rowObj], salesforce:[rowObj], overrides:[rowObj], now: Date }
 * @param {Object} cfg    FY27_CFG
 * @return {{lines:Array, review:Array, writeback:Object, coverage:Array, stats:Object}}
 */
function FY27_buildForecast(input, cfg) {
  const year = cfg.FORECAST_YEAR;
  const now = input.now || new Date();
  const actualsThrough = cfg.ACTUALS_THROUGH === "auto"
    ? now.getFullYear() + "-" + FY27_pad2_(now.getMonth() + 1)
    : FY27_monthKey_(cfg.ACTUALS_THROUGH);

  const otcAll = input.otc.map(function (r, i) { const o = FY27_normOtc_(r, cfg); if (!o.row) o.row = "i" + i; return o; }).filter(function (o) { return o.fullId; });
  const base = input.tableau.map(function (r, i) { const b = FY27_normBaseline_(r, cfg); if (!b.row) b.row = "i" + i; return b; })
    .filter(function (b) { return b.fullId || b.baseAmt || b.group; });
  const sfById = {};
  (input.salesforce || []).forEach(function (r) {
    const s = FY27_normSf_(r);
    if (s.fullId && !sfById[s.fullId]) sfById[s.fullId] = s.attrs;
  });

  // Reconcile Tableau baseline-year bookings with OTC baseline-year actuals to find adjustments
  // (extra students added after a cohort started) - those must not recur.
  const derivedAdj = FY27_deriveAdjustments_(base, otcAll, year - 1);

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

  // OTC rows that land in the forecast year (not flagged DNE)
  const target = otcAll.filter(function (o) { return !o.dne && FY27_yearOf_(o.month) === year; });
  const tableauIds = {};
  base.forEach(function (b) { if (b.fullId) tableauIds[b.fullId] = true; });

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
      bookingType: "", credit: "", creditBasis: "", status: "", expectation: "", flags: [], key: ""
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
      line.flags.push("Positive adjustment: tagged not expected for this client");
    }
    if (kind === "black") {
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.flags.push("Black rating: no upcoming bookings expected from this client");
    } else if (kind === "gray" && line.bookingType === "Roster Chasing" && line.status !== "Booked") {
      line.expectation = "Not Expected";
      line.forecastAmount = 0;
      line.flags.push("Gray rating: no new cohorts expected, only rebookings");
    }
  }

  base.forEach(function (b) {
    const attrs = attrsFromBaseline(b);
    const matches = assigned.get(b) || [];
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
      matches.forEach(function (o) { if (o.cohortCode) hasCode = true; else hasNoCode = true; });
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
        L.cohortCodes = o.cohortCode;
        L.priorCohorts = i === baseIdx ? prior : "";
        L.bookingType = bookingType;
        L.status = o.booked ? "Booked" : "Forecast";
        // amount: actual if booked, else (trend-adjusted) students x price, else OTC total
        let amt = o.total;
        if (!o.booked) {
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
          L.flags.push("Cohort starts after contract end (" + o.contractEnd + ") - confirm contract");
        }
        applyRatingAndAdj(L, b, !o.booked);
        lines.push(L);
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
    L.bookingId = b.bookingId;
    L.priorCohorts = prior;
    L.bookingType = "Rebooking (assumed)";
    L.status = "Forecast";
    L.expectation = "Expected";
    const cr0 = creditFor(b.fullId, b.group, b.fcMonth, b);
    L.credit = cr0.credit; L.creditBasis = cr0.basis;
    baseFlags.forEach(function (f) { L.flags.push(f); });

    // why is there no cohort?
    if (b.isBOS) {
      L.flags.push("BOS billing ID - not in OTC; forecast from baseline only");
    } else if (b.isAdj) {
      if (b.adjReason) L.flags.push(b.adjReason);
    } else if (!otcByAcct[b.fullId]) {
      L.flags.push("No OTC data for this Full ID - check contract / roster");
    } else if (!cEnd) {
      L.flags.push("No OTC contract for this product group - check");
    } else if (FY27_monthDiff_(b.fcMonth, cEnd) > 0) {
      L.flags.push("Contract ended " + cEnd + " - needs renewal contract before " + b.fcMonth);
    } else {
      L.flags.push("Contract covers " + b.fcMonth + " (ends " + cEnd + ") but no upcoming cohort in OTC - check");
    }
    applyRatingAndAdj(L, b, false);
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
      rating: FY27_str_(sf["Rating"]),
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
      bookingType: o.cohortCode ? "Rebooking" : "Roster Chasing",
      status: o.booked ? "Booked" : "Forecast",
      forecastAmount: o.total,
      expectation: o.booked ? "Captured" : "Expected"
    });
    if (!o.booked) {
      const tr = history.ratio[o.fullId + "|" + o.group + "|" + o.family];
      if (cfg.USE_TREND && tr && Math.abs(tr.ratio - 1) >= cfg.TREND_MIN_DELTA && o.estStudents > 0 && o.price > 0) {
        const adj = Math.round(o.estStudents * tr.ratio);
        L.adjStudents = adj;
        L.forecastAmount = FY27_round2_(adj * o.price);
        L.flags.push("Cohort size trend-adjusted " + o.estStudents + " -> " + adj);
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
    if (cfg.EXCLUDE_UNBOOKED_PROGRAMS && !o.booked && !notInTableau && !programActive(o.fullId, o.group, o.family)) {
      const last = history.lastByFamily[o.fullId + "|" + o.group + "|" + o.family];
      L.expectation = "Not Expected";
      L.forecastAmount = 0;
      L.flags.push("No " + (year - 1) + " booking for this program (" + o.family + ")" + (last ? ", last booked " + last : "") +
        " - cohort in OTC not forecast. Override if the program is returning");
    }
    lines.push(L);
  });

  /* ---- 3. Group detail lines: one row per account x billing org x product group x month x credit x status ---- */
  if (!cfg.TAG_CREDIT) lines.forEach(function (d) { d.credit = ""; d.creditBasis = ""; });
  const detail = lines;
  const groups = {};
  const order = [];
  detail.forEach(function (d) {
    d.forecastQuarter = FY27_quarterOf_(d.forecastMonth);
    const gk = [FY27_id15_(d.fullId), d.studentOrgId, d.productGroup, d.forecastMonth, d.credit, d.status, d.expectation].join("|");
    if (!groups[gk]) { groups[gk] = []; order.push(gk); }
    groups[gk].push(d);
  });
  const grouped = order.map(function (gk) { return FY27_mergeLines_(groups[gk], makeLine); });

  /* ---- 4. Apply manual overrides (keyed on the grouped line so they survive refreshes) ---- */
  const keyCount = {};
  grouped.forEach(function (L) {
    const base = [FY27_id15_(L.fullId), L.studentOrgId, L.productGroup, L.forecastMonth, L.credit, L.status, L.expectation].join("|");
    keyCount[base] = (keyCount[base] || 0) + 1;
    L.key = base + "|" + keyCount[base];
  });
  const ovByKey = {};
  (input.overrides || []).forEach(function (r) {
    const k = FY27_str_(r["Line Key"]);
    if (k) ovByKey[k] = r;
  });
  let overridesApplied = 0;
  grouped.forEach(function (L) {
    const ov = ovByKey[L.key];
    if (!ov) return;
    const exclude = FY27_bool_(ov["Exclude"]);
    const amt = FY27_str_(ov["Override Amount"]);
    const mo = FY27_monthKey_(ov["Override Month"]);
    if (!exclude && amt === "" && !mo) return;
    overridesApplied++;
    if (exclude) { L.forecastAmount = 0; L.expectation = "Not Expected"; L.flags.push("Manual override: excluded"); }
    if (amt !== "") { L.forecastAmount = FY27_num_(amt); L.flags.push("Manual override: amount"); }
    if (mo) { L.forecastMonth = mo; L.flags.push("Manual override: month"); }
    if (FY27_str_(ov["Comment"])) L.flags.push("Note: " + FY27_str_(ov["Comment"]));
  });
  lines = grouped;

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
  for (let m = 1; m <= 12; m++) cov[year + "-" + FY27_pad2_(m)] = { month: year + "-" + FY27_pad2_(m), booked: 0, forecast: 0, bookedLines: 0, forecastLines: 0, baselineIncomplete: false };
  lines.forEach(function (L) {
    const c = cov[L.forecastMonth];
    if (!c) return;
    if (L.status === "Booked") { c.booked += L.forecastAmount; c.bookedLines++; } else { c.forecast += L.forecastAmount; c.forecastLines++; }
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
      derivedAdjustments: derivedAdj,
      excludedNotInTableau: { accounts: Object.keys(excluded.accounts).length, cohorts: excluded.cohorts, value: excluded.value },
      otcTargetRows: target.length,
      otcMatched: Object.keys(usedOtc).length,
      overridesApplied: overridesApplied,
      total: lines.reduce(function (s, L) { return s + L.forecastAmount; }, 0)
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
function FY27_deriveAdjustments_(base, otcAll, baseYear) {
  let found = 0;
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
        return !claimed[b.row] && !otcByMonth[b.baseMonth] &&
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
  L.priorCohorts = join("priorCohorts");
  L.creditBasis = join("creditBasis");
  L.priorBookingType = join("priorBookingType");
  L.nextBookingType = join("nextBookingType");
  L.baselineAmount = sum("baselineAmount");
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

function FY27_severity_(flag) {
  const f = flag.toLowerCase();
  if (f.indexOf("needs renewal") >= 0 || f.indexOf("no otc data") >= 0 || f.indexOf("not in tableau") >= 0 ||
      f.indexOf("no upcoming cohort") >= 0 || f.indexOf("no otc contract") >= 0) return "High";
  if (f.indexOf("not complete yet") >= 0 || f.indexOf("no matching") >= 0 || f.indexOf("after contract end") >= 0 ||
      f.indexOf("positive adjustment") >= 0 || f.indexOf("adjustment (derived)") >= 0 || f.indexOf("booking for this program") >= 0 ||
      f.indexOf("adjustment: baseline") >= 0) return "Medium";
  return "Low";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FY27_buildForecast: FY27_buildForecast, FY27_gridToRows_: FY27_gridToRows_,
    FY27_monthKey_: FY27_monthKey_, FY27_addMonths_: FY27_addMonths_, FY27_family_: FY27_family_,
    FY27_num_: FY27_num_
  };
}
