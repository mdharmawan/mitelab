/* Chasm & Curve — simulation engine (single-player prototype)
 * Rules follow the PRD (Oct 29, 2026). Where the PRD is silent, values come from
 * Chasm_and_Curve_Engine_Prototype.xlsx, then balance-tested. Deterministic: the
 * same settings (incl. seed) and decisions always give the same results.
 */
(function (root) {
  'use strict';

  // ---------- Market structure ----------
  const VERTICALS = [
    { id: 'bld', name: 'Smart buildings', short: 'Buildings', m: 400000, wtp: 1.2, salesEff: 1.0, mainReach: 1.0,
      early: 'Tech-forward property developers', main: 'Facility managers of mid-size offices' },
    { id: 'wh', name: 'Warehouses & logistics', short: 'Warehouses', m: 250000, wtp: 1.4, salesEff: 1.0, mainReach: 1.0,
      early: 'Automation-heavy distribution centres', main: 'Regional third-party logistics firms' },
    { id: 'home', name: 'Homes', short: 'Homes', m: 1350000, wtp: 0.5, salesEff: 0.25, mainReach: 0.35, wpAdj: 10,
      early: 'Hobbyists and smart-home enthusiasts', main: 'Mass-market households via retailers' },
  ];

  // Rogers attributes: perf (relative advantage), compat, ease (low complexity), rel (reliability),
  // trial (trialability), obs (observability)
  const CATEGORIES = [
    { id: 'inn', name: 'Innovators', short: 'Inn', share: 0.025, pMult: 8, qMult: 0.6, reach: 1.0, wtp: 7000,
      w: { perf: 0.45, compat: 0.05, ease: 0.05, rel: 0.15, trial: 0.20, obs: 0.10 } },
    { id: 'ea', name: 'Early adopters', short: 'EA', share: 0.135, pMult: 3, qMult: 1.0, reach: 1.0, wtp: 5500,
      w: { perf: 0.35, compat: 0.15, ease: 0.10, rel: 0.20, trial: 0.10, obs: 0.10 } },
    { id: 'em', name: 'Early majority', short: 'EM', share: 0.34, pMult: 0.6, qMult: 1.2, reach: 0.6, wtp: 3500,
      w: { perf: 0.10, compat: 0.25, ease: 0.20, rel: 0.25, trial: 0.05, obs: 0.15 } },
    { id: 'lm', name: 'Late majority', short: 'LM', share: 0.34, pMult: 0.5, qMult: 1.1, reach: 0.3, wtp: 2400,
      w: { perf: 0.05, compat: 0.25, ease: 0.25, rel: 0.25, trial: 0.05, obs: 0.15 } },
    { id: 'lag', name: 'Laggards', short: 'Lag', share: 0.16, pMult: 0.4, qMult: 0.9, reach: 0.2, wtp: 1800,
      w: { perf: 0.05, compat: 0.25, ease: 0.30, rel: 0.30, trial: 0.00, obs: 0.10 } },
  ];
  const NV = VERTICALS.length, NC = CATEGORIES.length, NCELL = NV * NC;
  const cellV = (i) => Math.floor(i / NC), cellC = (i) => i % NC, cellIdx = (v, c) => v * NC + c;
  const cellName = (i) => VERTICALS[cellV(i)].short + ' · ' + CATEGORIES[cellC(i)].name;
  const MAINSTREAM = (c) => c >= 2;
  const TOTAL_M = VERTICALS.reduce((s, v) => s + v.m, 0);

  // ---------- Parameters ----------
  const BASE = {
    startCash: 6000, startCapacity: 2000,
    start: { perf: 70, compat: 20, ease: 30, rel: 25 },
    // Bass (PRD Standard). Spend response is S-shaped: a segment needs critical mass.
    p0: 0.01, pMax: 0.03, pHalf: 5000,       // $K per 100k sites in a cell for half the p uplift (~$50/site)
    q0: 0.20, qMax: 0.40, qHalf: 1200,       // $K reference-equivalent × sqrt(cell size / 100k)
    communityEq: 30,                         // $K reference-equivalent per community point
    hazardCap: 0.55,
    // Chasm & whole product
    crossWOM: 0.20, bridgeMax: 0.25, bridgeSpend: 1500,
    wpThreshold: 60, maxPartnerShare: 0.15,
    adjacency: [[0, 0.4, 0.2], [0.4, 0, 0.1], [0.2, 0.1, 0]],
    beachheadPerRound: 0.15, beachheadMaxRounds: 3, dilution: 0.75,
    // Product
    rdCostPerPoint: 40, univRdBonus: 0.5, tpToCompat: 0.3, osToEase: 0.3, osWtpCut: 0.15,
    trialCost: 400, trialLevel: 80, baseTrial: 20,
    // Ecosystem
    retention: 0.85, cost: { community: 20, univ: 25, tp: 30, os: 20, channel: 30 },
    // Operations ($ per site unless stated)
    unitCost0: 3500, learnStart: 2000, learning: 0.85, capCost: 1500, capUpkeep: 150,
    fixedOverhead: 1500, varOverhead: 0.10,
    baseChurn: 0.03, failChurn: 0.10, adminDecay: 0.20, communityRetention: 0.3,
    lostDemand: 0.5,
    // Risk
    failRisk0: 0.35, qaScale: 2000, minRisk: 0.02, strainRisk: 0.15, strainLevel: 0.9, detFailThreshold: 0.2,
    // Funding ($K)
    equityBase: 4000, equityPerRevenue: 1.0, debtBase: 1000, debtPerRevenue: 0.5, debtRate: 0.10,
    // Events
    regCompat: 50, regCost: 800, regBonus: 1.15, regDelayPenalty: 0.7,
    compMaxShare: 0.35,
    // Scoring
    chasmPen: 0.10,
  };

  const PRESETS = {
    easy: { label: 'Easy', startCash: 8000, crossWOM: 0.30, bridgeMax: 0.35, wpThreshold: 50, failRisk0: 0.25, compMaxShare: 0.25 },
    standard: { label: 'Standard' },
    hard: { label: 'Hard', startCash: 5000, crossWOM: 0.10, bridgeMax: 0.15, wpThreshold: 70, failRisk0: 0.40, compMaxShare: 0.45, lostDemand: 0.6, q0: 0.18 },
  };

  const DEFAULT_SETTINGS = {
    preset: 'standard', rounds: 10, seed: 4242,
    hints: true, unlocks: true, randomness: true, timerMin: 6, startCashM: 0, // 0 = preset default
    competitor: { on: true, round: 6, vertical: 1 },
    regulation: { on: true, round: 4 },
    funding: { mode: 'random', round: 6 },   // off | random | boom | winter
    failures: true,
  };

  function buildParams(settings) {
    const p = JSON.parse(JSON.stringify(BASE));
    Object.assign(p, PRESETS[settings.preset] || {});
    delete p.label;
    if (settings.startCashM) p.startCash = settings.startCashM * 1000;
    return p;
  }

  const wpThresholdFor = (P, v) => P.wpThreshold + (VERTICALS[v].wpAdj || 0);

  // ---------- Seeded RNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Lever unlock round (when gradual unlocks are on)
  const UNLOCK = {
    targeting: 1, price: 1, rdPerf: 1, rdCompat: 1, rdEase: 1, rdRel: 1, ads: 1, sales: 1, qa: 1, capacityAdd: 1,
    refs: 2, channels: 2, trial: 2, equity: 2, debt: 2,
    community: 3, univ: 3, tp: 3, os: 3,
  };

  function blankDecision() {
    return { primary: cellIdx(0, 1), secondary: [], price: 6000,
      rdPerf: 0, rdCompat: 0, rdEase: 0, rdRel: 0, trial: false,
      ads: 0, sales: 0, refs: 0, channels: 0,
      qa: 0, capacityAdd: 0, equity: 0, debt: 0,
      community: 0, univ: 0, tp: 0, os: 0, responses: {} };
  }

  // ---------- Game creation ----------
  function createGame(settingsIn) {
    const si = settingsIn || {};
    const settings = Object.assign({}, DEFAULT_SETTINGS, si);
    settings.competitor = Object.assign({}, DEFAULT_SETTINGS.competitor, si.competitor || {});
    settings.regulation = Object.assign({}, DEFAULT_SETTINGS.regulation, si.regulation || {});
    settings.funding = Object.assign({}, DEFAULT_SETTINGS.funding, si.funding || {});
    const P = buildParams(settings);
    const rng = mulberry32(settings.seed >>> 0);
    const R = settings.rounds;
    const draws = [];
    for (let i = 0; i <= R + 1; i++) draws.push(rng());

    const schedule = { competitor: null, regulation: null, funding: null };
    if (settings.competitor.on) schedule.competitor = { round: clamp(settings.competitor.round, 2, R), vertical: settings.competitor.vertical };
    if (settings.regulation.on) schedule.regulation = { round: clamp(settings.regulation.round, 2, R) };
    const fm = settings.funding.mode;
    if (fm !== 'off') {
      let type = fm, round = settings.funding.round;
      if (fm === 'random') { type = rng() < 0.5 ? 'boom' : 'winter'; round = 3 + Math.floor(rng() * Math.max(1, R - 4)); }
      schedule.funding = { type, round: clamp(round, 2, R - 1) };
    }

    const zeros = () => new Array(NCELL).fill(0);
    return {
      v: 2, settings, P, draws, schedule,
      round: 1, over: false,
      cash: P.startCash, debtBal: 0, bridgeBal: 0, ownership: 1,
      capacity: P.startCapacity, cumOutput: 0,
      attr: Object.assign({}, P.start),
      eco: { community: 0, univ: 0, tpV: [0, 0, 0], os: 0, channel: 0 },
      univHist: [0, 0],
      N: zeros(), backlog: zeros(), churned: zeros(),
      lastRevenue: 0, lastFill: 1, admin: false,
      primaryStreak: 0, lastPrimaryV: -1,
      fx: { failRounds: 0, failRecall: false, failStatement: false, compRefs: 0, priceWarRounds: 0,
        regStatus: 'none', boomRounds: 0, winterRounds: 0, winterCut: 0 },
      firedEvents: [], pendingFailure: false,
      chasmRound: null, history: [],
    };
  }

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function sum(a) { return a.reduce((s, x) => s + x, 0); }
  const sCurve = (x) => (x * x) / (1 + x * x);

  // ---------- Derived state ----------
  function unitCost(g) {
    const P = g.P;
    return P.unitCost0 * Math.pow(Math.max(g.cumOutput, P.learnStart) / P.learnStart, Math.log(P.learning) / Math.LN2);
  }

  // Product attributes in force this round; compatibility and whole-product index are per vertical
  function derived(g, dec) {
    const P = g.P, a = g.attr, e = g.eco;
    const ease = Math.min(100, a.ease + P.osToEase * e.os);
    const totalN = sum(g.N);
    const refs = dec ? dec.refs : 0;
    const obs = Math.min(100, 10 + 18 * Math.log10(1 + totalN / 1000) + refs / 25);
    const trial = dec && dec.trial ? P.trialLevel : P.baseTrial;
    const compatV = e.tpV.map((tp) => Math.min(100, a.compat + P.tpToCompat * tp));
    const wpV = e.tpV.map((tp, v) => clamp(0.35 * compatV[v] + 0.35 * tp + 0.15 * e.os + 0.15 * e.community, 0, 100));
    const compat = sum(compatV) / NV;
    return { perf: a.perf, compat, compatV, ease, rel: a.rel, trial, obs, wpV, wp: Math.max.apply(null, wpV) };
  }

  function fitTable(d) {
    return VERTICALS.map((V, v) => CATEGORIES.map((C) => {
      const w = C.w;
      return (w.perf * d.perf + w.compat * d.compatV[v] + w.ease * d.ease + w.rel * d.rel + w.trial * d.trial + w.obs * d.obs) / 100;
    }));
  }
  const fitFactor = (fit) => clamp(Math.pow(fit / 0.6, 1.5), 0.05, 1.3);

  function focusWeights(dec) {
    const sec = (dec.secondary || []).filter((x, k, arr) => x != null && x !== dec.primary && arr.indexOf(x) === k).slice(0, 2);
    const w = new Array(NCELL).fill(0);
    if (sec.length === 0) w[dec.primary] = 1;
    else if (sec.length === 1) { w[dec.primary] = 0.7; w[sec[0]] = 0.3; }
    else { w[dec.primary] = 0.6; w[sec[0]] = 0.2; w[sec[1]] = 0.2; }
    const wv = [0, 0, 0];
    w.forEach((x, i) => { wv[cellV(i)] += x; });
    return { w, wv, cells: [dec.primary].concat(sec) };
  }

  function fundingCaps(g) {
    const P = g.P, fx = g.fx;
    let climate = 1;
    if (fx.boomRounds > 0) climate = 1.5;
    if (fx.winterRounds > 0) climate = 0.4;
    return {
      equity: Math.round(climate * (P.equityBase + P.equityPerRevenue * g.lastRevenue)),
      debt: Math.round(P.debtBase + P.debtPerRevenue * g.lastRevenue),
      climate,
    };
  }

  // ---------- Events ----------
  const EVENT_RESPONSES = {
    competitor: [
      { id: 'refs', label: 'Lock in reference customers', cost: 500, desc: 'Win public endorsements from your best customers in that vertical. Strong defence for the rest of the game.' },
      { id: 'price', label: 'Start a price war', cost: 0, desc: 'Discount 15% on all sales for two rounds. Slows the rival a little, costs you margin.' },
      { id: 'ignore', label: 'Stay the course', cost: 0, desc: 'No spend. Rely on the whole product and references you have already built.' },
    ],
    regulation_fail: [
      { id: 'comply', label: 'Pay to comply now', cost: 800, desc: 'Certify against the standard: compatibility +15, and mainstream buyers reward compliant vendors (+15%).' },
      { id: 'delay', label: 'Delay compliance', cost: 0, desc: 'Free today, but mainstream buyers hold back (−30%) until average compatibility reaches 50.' },
    ],
    regulation_pass: [
      { id: 'ok', label: 'Announce we already comply', cost: 0, desc: 'Your compatibility already meets the standard. Mainstream buyers reward compliant vendors (+15%).' },
    ],
    boom: [
      { id: 'raise', label: 'Raise a bonus round now', cost: 0, desc: 'Take $3M of extra equity on generous terms (low dilution).' },
      { id: 'hold', label: 'No bonus round', cost: 0, desc: 'Keep ownership. Your normal equity limit is still 50% higher this round and next.' },
    ],
    winter: [
      { id: 'cut', label: 'Cut burn', cost: 0, desc: 'Fixed overhead −25% for two rounds, but R&D is 20% less effective.' },
      { id: 'bridge', label: 'Take a bridge loan', cost: 0, desc: 'Borrow $2M now at 20% interest per round on that loan.' },
      { id: 'ride', label: 'Ride it out', cost: 0, desc: 'No change. Equity raises are capped at 40% of normal for two rounds.' },
    ],
    failure: [
      { id: 'recall', label: 'Recall and fix', cost: 600, desc: 'Replace faulty nodes: reliability +8, and both the churn and word-of-mouth hits are halved.' },
      { id: 'statement', label: 'Public apology', cost: 150, desc: 'Own it publicly: the word-of-mouth hit is halved; churn still rises.' },
      { id: 'silent', label: 'Say nothing', cost: 0, desc: 'No cost. Full churn and word-of-mouth damage for two rounds.' },
    ],
  };

  function eventsForRound(g) {
    const r = g.round, s = g.schedule, out = [];
    if (g.admin || g.over) return out;
    if (g.pendingFailure) out.push({ type: 'failure', fromRound: r - 1 });
    if (s.competitor && s.competitor.round === r) out.push({ type: 'competitor', vertical: s.competitor.vertical });
    if (s.regulation && s.regulation.round === r) {
      const d = derived(g, null);
      out.push({ type: d.compat >= g.P.regCompat ? 'regulation_pass' : 'regulation_fail', compat: d.compat });
    }
    if (s.funding && s.funding.round === r) out.push({ type: s.funding.type });
    const n = sum(g.N);
    return out.map((e) => {
      let responses = EVENT_RESPONSES[e.type];
      if (e.type === 'failure') responses = responses.map((o) => Object.assign({}, o, {
        cost: o.id === 'recall' ? Math.round(300 + 0.03 * n) : o.id === 'statement' ? Math.round(150 + 0.005 * n) : 0 }));
      return Object.assign(e, { responses });
    });
  }

  function chosenResponse(ev, responses) {
    const id = responses && responses[ev.type];
    return ev.responses.find((o) => o.id === id) || ev.responses[ev.responses.length - 1];
  }

  // ---------- Budget ----------
  function spendOf(dec, P) {
    return dec.rdPerf + dec.rdCompat + dec.rdEase + dec.rdRel + dec.ads + dec.sales + dec.refs + dec.channels +
      dec.qa + dec.community + dec.univ + dec.tp + dec.os + (dec.trial ? P.trialCost : 0) +
      dec.capacityAdd * P.capCost / 1000;
  }

  function budget(g, dec) {
    const caps = fundingCaps(g);
    const evs = eventsForRound(g);
    const equity = Math.max(0, Math.min(dec.equity || 0, caps.equity));
    const debt = Math.max(0, Math.min(dec.debt || 0, caps.debt));
    let extra = 0, respCost = 0;
    for (const ev of evs) {
      const o = chosenResponse(ev, dec.responses);
      respCost += o.cost;
      if (ev.type === 'boom' && o.id === 'raise') extra += 3000;
      if (ev.type === 'winter' && o.id === 'bridge') extra += 2000;
    }
    const available = g.cash + equity + debt + extra;
    const spend = spendOf(dec, g.P) + respCost;
    return { available, spend, left: available - spend, ok: spend <= available + 1e-6, caps, equity, debt, extra, respCost };
  }

  // ---------- Demand model for one round (pure; supports counterfactual overrides) ----------
  function demandModel(g, dec, ov) {
    ov = ov || {};
    const P = g.P, fx = g.fx;
    const d = derived(g, dec);
    const fits = fitTable(d);
    const uc = unitCost(g);
    const price = Math.max(dec.price, uc);
    const fw = focusWeights(dec);
    const targetedV = new Set(fw.cells.map(cellV));
    const primaryV = cellV(dec.primary);
    const streak = (g.lastPrimaryV === primaryV ? g.primaryStreak + 1 : 1);
    const gateV = d.wpV.map((wp, v) => ov.noGate ? 1 : Math.min(1, wp / wpThresholdFor(P, v)));
    const osCut = 1 - P.osWtpCut * g.eco.os / 100;
    const shortage = 0.8 + 0.2 * g.lastFill;
    const failQ = fx.failRounds > 0 ? (fx.failStatement || fx.failRecall ? 0.75 : 0.5) : 1;
    let regMult = 1;
    if (fx.regStatus === 'bonus') regMult = P.regBonus;
    if (fx.regStatus === 'delayed') regMult = d.compat >= P.regCompat ? 1 : P.regDelayPenalty;
    const univTalent = 1 + 0.2 * g.univHist[0] / 100;
    const earlyBase = Math.min(1, sumEarly(g) / 3000);
    const emPen = VERTICALS.map((v, vi) => g.N[cellIdx(vi, 2)] / (v.m * CATEGORIES[2].share));

    const cells = [];
    for (let i = 0; i < NCELL; i++) {
      const vi = cellV(i), ci = cellC(i), V = VERTICALS[vi], C = CATEGORIES[ci];
      const m = V.m * C.share;
      // External influence (p): advertising is 40% broad, 60% targeted; direct sales fully targeted
      const broad = 0.4 * dec.ads * (m / TOTAL_M);
      const push = broad + fw.w[i] * (0.6 * dec.ads + dec.sales * V.salesEff * univTalent);
      const pDrv = P.p0 + (P.pMax - P.p0) * sCurve(push / (P.pHalf * m / 1e5));
      // Imitation (q): references in targeted cells plus user community
      const comm = P.communityEq * g.eco.community * earlyBase * (targetedV.has(vi) ? 1 : 0.3);
      const refCell = fw.w[i] * dec.refs;
      const qDrv = P.q0 + (P.qMax - P.q0) * sCurve((refCell + comm) / (P.qHalf * Math.sqrt(m / 1e5)));
      const ff = fitFactor(fits[vi][ci]);
      const wtp = C.wtp * V.wtp * osCut;
      let pf = Math.min(1.25, Math.pow(wtp / price, 2));
      if (ov.noPrice && targetedV.has(vi)) pf = Math.max(pf, 1);
      const reachBase = C.reach * (MAINSTREAM(ci) ? V.mainReach : 1);
      const reach = reachBase + (1 - reachBase) * g.eco.channel / 100;
      const ms = MAINSTREAM(ci) ? ((ov.noGate && targetedV.has(vi)) ? 1 : gateV[vi]) * regMult : 1;
      let bh = 1;
      if (targetedV.size === 1 && vi === primaryV) bh = 1 + P.beachheadPerRound * Math.min(streak, P.beachheadMaxRounds);
      else if (targetedV.size >= 3) bh = P.dilution;
      const p = pDrv * C.pMult * ff * pf * reach * ms;
      const q = qDrv * C.qMult * ff * Math.min(1, pf) * reach * ms * bh * failQ * shortage;
      // Word-of-mouth reference group (the chasm: EM discounts early-market references)
      const N = (c) => g.N[cellIdx(vi, c)], M = (c) => V.m * CATEGORIES[c].share;
      let infl;
      if (ci === 0) infl = N(0) / M(0);
      else if (ci === 1) infl = (N(0) + N(1)) / (M(0) + M(1));
      else if (ci === 2) {
        const refsV = fw.w[i] * dec.refs;
        const w = (ov.noChasm && targetedV.has(vi)) ? 1 : P.crossWOM + P.bridgeMax * Math.min(1, refsV / P.bridgeSpend);
        infl = (N(2) + w * (N(0) + N(1))) / M(2);
        for (let u = 0; u < NV; u++) if (u !== vi) infl += P.adjacency[u][vi] * emPen[u]; // bowling alley
      } else if (ci === 3) infl = (N(3) + N(2)) / (M(3) + M(2));
      else infl = (N(4) + N(3)) / (M(4) + M(3));
      infl = Math.min(1, infl);
      // Competitor (defended by whole product and references, less by price)
      let comp = 0;
      const sc = g.schedule.competitor;
      if (!ov.noComp && sc && g.round >= sc.round && sc.vertical === vi && ci >= 1) {
        const refDef = Math.min(1, fw.wv[vi] * dec.refs / 2000) + fx.compRefs;
        comp = P.compMaxShare * (1 - 0.6 * d.wpV[vi] / 100) * (1 - 0.35 * Math.min(1.25, refDef)) * (fx.priceWarRounds > 0 ? 0.85 : 1);
      }
      const remaining = Math.max(0, m - g.N[i] - g.churned[i] - g.backlog[i]);
      const raw = p + q * infl;
      const hz = Math.min(P.hazardCap, raw);
      const scale = raw > 0 ? hz / raw : 0;
      const newDemand = remaining * hz * (1 - comp);
      cells.push({ i, m, p, q, infl, remaining, newDemand, fromP: remaining * p * scale * (1 - comp),
        fromQ: remaining * q * infl * scale * (1 - comp), compTaken: remaining * hz * comp, pf, reach, ff });
    }
    return { cells, d, fits, price, uc, gateV, streak, fw, regMult, targetedV };
  }

  function sumEarly(g) {
    let s = 0;
    for (let v = 0; v < NV; v++) s += g.N[cellIdx(v, 0)] + g.N[cellIdx(v, 1)];
    return s;
  }

  // ---------- Apply event responses (start of round) ----------
  function valuation(g) { return Math.max(15000, 3 * g.lastRevenue); }

  function applyEvents(g, dec, log) {
    const fx = g.fx;
    const evs = eventsForRound(g);
    for (const ev of evs) {
      const opt = chosenResponse(ev, dec.responses);
      const id = opt.id;
      log.push({ type: ev.type, response: id, label: opt.label, cost: opt.cost, vertical: ev.vertical });
      g.firedEvents.push({ round: g.round, type: ev.type, response: id });
      if (ev.type === 'failure') {
        fx.failRounds = 2; fx.failRecall = id === 'recall'; fx.failStatement = id === 'statement';
        if (id === 'recall') g.attr.rel = Math.min(100, g.attr.rel + 8);
        g.pendingFailure = false;
      } else if (ev.type === 'competitor') {
        if (id === 'refs') fx.compRefs = 0.25;
        if (id === 'price') fx.priceWarRounds = 2;
      } else if (ev.type === 'regulation_fail') {
        if (id === 'comply') { g.attr.compat = Math.min(100, g.attr.compat + 15); fx.regStatus = 'bonus'; }
        else fx.regStatus = 'delayed';
      } else if (ev.type === 'regulation_pass') fx.regStatus = 'bonus';
      else if (ev.type === 'boom') {
        fx.boomRounds = 2;
        if (id === 'raise') g.ownership *= 1 - 3000 / (3000 + valuation(g) * 2);
      } else if (ev.type === 'winter') {
        fx.winterRounds = 2;
        if (id === 'cut') fx.winterCut = 2;
        if (id === 'bridge') g.bridgeBal += 2000;
      }
    }
  }

  // ---------- Simulate one round ----------
  function simulateRound(g, decIn) {
    if (g.over) throw new Error('Game over');
    const P = g.P, fx = g.fx;
    const dec = Object.assign(blankDecision(), decIn || {});
    dec.responses = (decIn && decIn.responses) || {};
    const rec = { round: g.round, events: [], admin: g.admin };
    const r = g.round;

    if (g.admin) {
      const startN = sum(g.N);
      for (let i = 0; i < NCELL; i++) { const lost = g.N[i] * P.adminDecay; g.N[i] -= lost; g.churned[i] += lost; }
      g.backlog.fill(0);
      Object.assign(rec, emptyRecord(g), { decision: dec, admin: true, startN, churnedNow: startN * P.adminDecay });
      finishRecord(g, rec);
      return rec;
    }

    // Budget (the UI blocks overspending; the engine scales down to stay safe)
    const b = budget(g, dec);
    if (!b.ok) {
      const disc = spendOf(dec, P);
      const s = clamp((b.available - b.respCost) / Math.max(1, disc), 0, 1);
      ['rdPerf', 'rdCompat', 'rdEase', 'rdRel', 'ads', 'sales', 'refs', 'channels', 'qa', 'community', 'univ', 'tp', 'os', 'capacityAdd'].forEach((k) => { dec[k] *= s; });
      if (s < 1) dec.trial = false;
    }
    const equity = b.equity, debt = b.debt;
    rec.eventsSeen = eventsForRound(g).map((e) => e.type);
    applyEvents(g, dec, rec.events);
    if (equity > 0) {
      const val = valuation(g) * (fx.boomRounds > 0 ? 1.5 : 1) * (fx.winterRounds > 0 ? 0.6 : 1);
      g.ownership *= 1 - equity / (equity + val);
    }
    g.debtBal += debt;

    // Demand (Bass per cell)
    const dm = demandModel(g, dec);
    const totalNew = sum(dm.cells.map((c) => c.newDemand));
    const backlogTotal = sum(g.backlog);
    const demand = totalNew + backlogTotal;
    const cap = g.capacity;
    const soldBacklog = Math.min(backlogTotal, cap);
    const fillNew = totalNew > 0 ? Math.min(1, (cap - soldBacklog) / totalNew) : 1;
    const fillBacklog = backlogTotal > 0 ? soldBacklog / backlogTotal : 1;
    const sold = soldBacklog + totalNew * fillNew;
    const fill = demand > 0 ? sold / demand : 1;
    const util = cap > 0 ? sold / cap : 0;

    // Churn, sales, waiting buyers
    const churnRate = (P.baseChurn * (1 - P.communityRetention * g.eco.community / 100)) +
      (fx.failRounds > 0 ? P.failChurn * (fx.failRecall ? 0.5 : 1) : 0);
    const startN = sum(g.N);
    let churnedNow = 0, newFromP = 0, newFromQ = 0, lostDemand = 0, compTaken = 0;
    const soldV = [0, 0, 0];
    const newBacklog = new Array(NCELL).fill(0);
    for (let k = 0; k < NCELL; k++) {
      const c = dm.cells[k];
      const ch = g.N[k] * churnRate;
      churnedNow += ch;
      const soldCell = g.backlog[k] * fillBacklog + c.newDemand * fillNew;
      soldV[cellV(k)] += soldCell;
      const unmetNew = c.newDemand * (1 - fillNew);
      newBacklog[k] = unmetNew * (1 - P.lostDemand);
      lostDemand += unmetNew * P.lostDemand + g.backlog[k] * (1 - fillBacklog);
      g.N[k] = g.N[k] - ch + soldCell;
      g.churned[k] += ch;
      newFromP += c.fromP * fillNew; newFromQ += c.fromQ * fillNew;
      compTaken += c.compTaken;
    }
    g.backlog = newBacklog;

    // Product failure roll
    let risk = Math.max(P.minRisk, P.failRisk0 * (1 - g.attr.rel / 100) - dec.qa / P.qaScale) + (util > P.strainLevel ? P.strainRisk : 0);
    risk = clamp(risk, 0, 0.95);
    let failed = false;
    if (g.settings.failures) failed = g.settings.randomness ? g.draws[r] < risk : risk >= P.detFailThreshold;

    // Financials ($K)
    const gross = sold * dm.price / 1000;
    const revenue = gross * (fx.priceWarRounds > 0 ? 0.85 : 1);
    const partnerShare = sum(soldV.map((s, v) => s * dm.price / 1000 * P.maxPartnerShare * g.eco.tpV[v] / 100));
    const cogs = sold * dm.uc / 1000;
    const overhead = P.fixedOverhead * (fx.winterCut > 0 ? 0.75 : 1) + P.varOverhead * revenue + cap * P.capUpkeep / 1000;
    const capInvest = dec.capacityAdd * P.capCost / 1000;
    const leverSpend = spendOf(dec, P) - capInvest;
    const interest = g.debtBal * P.debtRate + g.bridgeBal * 0.20;
    const cashStart = g.cash;
    const cashEnd = cashStart + equity + debt + b.extra + revenue - partnerShare - cogs - overhead - leverSpend - capInvest - b.respCost - interest;

    // Counterfactuals for "why this happened" (targeted verticals only)
    const inT = (c) => dm.targetedV.has(cellV(c.i));
    const baseT = sum(dm.cells.filter(inT).map((c) => c.newDemand));
    const cf = (ov) => Math.max(0, sum(demandModel(g, dec, ov).cells.filter(inT).map((c) => c.newDemand)) - baseT);

    Object.assign(rec, {
      decision: dec, price: dm.price, unitCost: dm.uc, d: dm.d, gateV: dm.gateV, streak: dm.streak,
      demand, sold, capacity: cap, fill, util, newFromP, newFromQ, fromBacklog: soldBacklog,
      lostDemand, compTaken, churnRate, churnedNow, startN,
      risk, failed, revenue, partnerShare, cogs, overhead, leverSpend, capInvest, interest, eventCost: b.respCost,
      equity, debt, extraCash: b.extra, cashStart, cashEnd,
      cf: { gate: cf({ noGate: true }), chasm: cf({ noChasm: true }), price: cf({ noPrice: true }) },
      cellDemand: dm.cells.map((c) => c.newDemand), cellP: dm.cells.map((c) => c.p), cellQ: dm.cells.map((c) => c.q),
      cellFit: dm.cells.map((c) => c.ff), targets: dm.fw.cells, soldV,
    });

    // ---- Advance state to next round ----
    g.cash = cashEnd;
    g.lastRevenue = revenue;
    g.lastFill = fill;
    g.cumOutput += sold;
    g.capacity += Math.round(dec.capacityAdd);
    g.lastPrimaryV = cellV(dec.primary); g.primaryStreak = dm.streak;
    // R&D lands next round; university effect arrives two rounds after spend
    const rdMult = (1 + P.univRdBonus * g.univHist[0] / 100) * (fx.winterCut > 0 ? 0.8 : 1);
    const gain = (spend, cur) => spend / P.rdCostPerPoint * rdMult * (1 - cur / 110);
    const A = g.attr;
    A.perf = Math.min(100, A.perf + gain(dec.rdPerf, A.perf));
    A.compat = Math.min(100, A.compat + gain(dec.rdCompat, A.compat));
    A.ease = Math.min(100, A.ease + gain(dec.rdEase, A.ease));
    A.rel = Math.min(100, A.rel + gain(dec.rdRel, A.rel));
    // Ecosystem: indices decay; community needs an early-adopter base; tech partners are vertical-specific
    const earlyBase = Math.min(1, sumEarly(g) / 3000);
    const e = g.eco, C = P.cost;
    e.community = Math.min(100, e.community * P.retention + dec.community / C.community * (0.3 + 0.7 * earlyBase));
    e.univ = Math.min(100, e.univ * P.retention + dec.univ / C.univ);
    e.tpV = e.tpV.map((x, v) => Math.min(100, x * P.retention + dec.tp * dm.fw.wv[v] / C.tp));
    e.os = Math.min(100, e.os * P.retention + dec.os / C.os);
    e.channel = Math.min(100, e.channel * P.retention + dec.channels / C.channel);
    g.univHist = [g.univHist[1], e.univ];
    if (fx.failRounds > 0) fx.failRounds--;
    if (fx.priceWarRounds > 0) fx.priceWarRounds--;
    if (fx.boomRounds > 0) fx.boomRounds--;
    if (fx.winterRounds > 0) fx.winterRounds--;
    if (fx.winterCut > 0) fx.winterCut--;
    if (failed) g.pendingFailure = true;

    finishRecord(g, rec);
    return rec;
  }

  function emptyRecord(g) {
    return { price: 0, unitCost: unitCost(g), d: derived(g, null), demand: 0, sold: 0, capacity: g.capacity, fill: 0, util: 0,
      newFromP: 0, newFromQ: 0, fromBacklog: 0, lostDemand: 0, compTaken: 0, churnRate: g.P.adminDecay, churnedNow: 0,
      risk: 0, failed: false, revenue: 0, partnerShare: 0, cogs: 0, overhead: 0, leverSpend: 0, capInvest: 0, interest: 0,
      eventCost: 0, equity: 0, debt: 0, extraCash: 0, cashStart: g.cash, cashEnd: g.cash, cf: { gate: 0, chasm: 0, price: 0 },
      gateV: [0, 0, 0], startN: sum(g.N), targets: [], soldV: [0, 0, 0] };
  }

  function finishRecord(g, rec) {
    const P = g.P;
    rec.N = g.N.slice();
    rec.active = sum(g.N);
    rec.adoption = rec.active / TOTAL_M;
    rec.penCat = CATEGORIES.map((C, ci) => {
      let n = 0, m = 0;
      for (let v = 0; v < NV; v++) { n += g.N[cellIdx(v, ci)]; m += VERTICALS[v].m * C.share; }
      return n / m;
    });
    rec.penVert = VERTICALS.map((V, vi) => { let n = 0; for (let c = 0; c < NC; c++) n += g.N[cellIdx(vi, c)]; return n / V.m; });
    rec.emPen = VERTICALS.map((V, vi) => g.N[cellIdx(vi, 2)] / (V.m * CATEGORIES[2].share));
    if (g.chasmRound == null && Math.max.apply(null, rec.emPen) >= P.chasmPen) g.chasmRound = rec.round;
    rec.chasmRound = g.chasmRound;
    const dAfter = derived(g, null);
    rec.wpV = dAfter.wpV; rec.wp = dAfter.wp;
    rec.wpInForce = rec.d ? rec.d.wpV : dAfter.wpV;
    rec.attrAfter = Object.assign({}, g.attr);
    rec.ecoAfter = JSON.parse(JSON.stringify(g.eco));
    rec.capacityNext = g.capacity;
    rec.ownership = g.ownership;
    rec.debtBal = g.debtBal + g.bridgeBal;
    rec.drivers = rec.admin ? [{ key: 'admin', dir: -1, value: rec.churnedNow }] : drivers(rec);
    if (!g.admin && g.cash < 0) g.admin = true;
    rec.adminNext = g.admin;
    rec.cashEnd = g.cash;
    rec.stage = stageOf(g, rec);
    rec.pendingFailure = g.pendingFailure;
    g.history.push(rec);
    g.round++;
    if (g.round > g.settings.rounds) g.over = true;
  }

  function stageOf(g, rec) {
    if (rec.admin || g.admin) return 'Administration';
    if (g.chasmRound == null) {
      // At the chasm once any vertical's early adopters are substantially won
      const eaPen = VERTICALS.map((V, v) => g.N[cellIdx(v, 1)] / (V.m * CATEGORIES[1].share));
      return Math.max.apply(null, eaPen) >= 0.15 ? 'Chasm' : 'Introduction';
    }
    if (rec.adoption < 0.16) return 'Early growth';
    if (rec.adoption < 0.5) return 'Tornado';
    return 'Maturity';
  }

  // ---------- "Why this happened": top three drivers ----------
  function drivers(rec) {
    const list = [
      { key: 'p', dir: +1, value: rec.newFromP },
      { key: 'q', dir: +1, value: rec.newFromQ },
      { key: 'backlog', dir: +1, value: rec.fromBacklog },
      { key: 'gate', dir: -1, value: rec.cf.gate },
      { key: 'chasm', dir: -1, value: rec.cf.chasm },
      { key: 'price', dir: -1, value: rec.cf.price },
      { key: 'capacity', dir: -1, value: Math.max(0, rec.demand - rec.sold) },
      { key: 'churn', dir: -1, value: rec.churnedNow },
      { key: 'competitor', dir: -1, value: rec.compTaken },
    ];
    return list.filter((x) => x.value >= 1).sort((a, b) => b.value - a.value).slice(0, 3);
  }

  function score(g) {
    const last = g.history[g.history.length - 1];
    return last ? last.adoption : 0;
  }

  // Textbook Bass curve: cumulative adopters after t rounds
  function bassCurve(p, q, m, rounds) {
    const out = [];
    for (let t = 0; t <= rounds; t++) {
      const e = Math.exp(-(p + q) * t);
      out.push(m * (1 - e) / (1 + (q / p) * e));
    }
    return out;
  }

  const api = { VERTICALS, CATEGORIES, NV, NC, NCELL, TOTAL_M, cellV, cellC, cellIdx, cellName, BASE, PRESETS, DEFAULT_SETTINGS,
    UNLOCK, EVENT_RESPONSES, createGame, blankDecision, simulateRound, budget, fundingCaps, eventsForRound, derived,
    unitCost, demandModel, score, bassCurve, spendOf, focusWeights, buildParams, chosenResponse, wpThresholdFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChasmEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
