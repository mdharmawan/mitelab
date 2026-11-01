// Balance harness: scripted strategies across presets and seeds.
const E = require(process.env.ENGINE || './engine-v2-reference.js');
const { cellIdx } = E;
const B = 0, W = 1, H = 2; // verticals
const INN = 0, EA = 1, EM = 2, LM = 3, LAG = 4;

function mk(opts) {
  return function (g, r) {
    const caps = E.fundingCaps(g);
    const evs = E.eventsForRound(g);
    const responses = {};
    for (const ev of evs) responses[ev.type] = (opts.respond && opts.respond[ev.type]) || ev.responses[0].id;
    const d = E.blankDecision();
    d.responses = responses;
    const t = opts.target(r, g);
    d.primary = t[0]; d.secondary = t.slice(1);
    const uc = E.unitCost(g);
    d.price = Math.round(Math.max(uc * (opts.markup || 1.25), opts.price ? opts.price(r, g) : 0));
    d.trial = !!(opts.trial && opts.trial(r));
    d.equity = opts.noRaise ? 0 : caps.equity;
    d.debt = opts.debt ? caps.debt * opts.debt : 0;
    // estimate operating reserve for the round (fixed overhead + upkeep + response costs + interest)
    const reserve = g.P.fixedOverhead + g.capacity * g.P.capUpkeep / 1000 + 600 + g.debtBal * 0.1;
    const bud = E.budget(g, Object.assign({}, d));
    let pool = Math.max(0, bud.available - reserve - (d.trial ? g.P.trialCost : 0) - (bud.spend));
    // capacity policy
    const last = g.history[g.history.length - 1];
    let capAdd = 0;
    if (opts.capacity !== 'none' && last) {
      const growth = opts.capGrowth || 1.6;
      const want = last.demand * growth;
      capAdd = Math.max(0, want - g.capacity);
      if (opts.capacity === 'huge') capAdd = Math.max(capAdd, g.capacity * 2);
    } else if (!last && opts.capacity !== 'none') capAdd = 3000;
    let capCost = capAdd * g.P.capCost / 1000;
    if (capCost > pool * 0.45) { capCost = pool * 0.45; capAdd = capCost * 1000 / g.P.capCost; }
    d.capacityAdd = Math.round(capAdd);
    pool -= capCost;
    const f = opts.frac(r, g);
    const tot = Object.values(f).reduce((a, b) => a + b, 0);
    const spendShare = opts.spendShare || 0.9;
    for (const k in f) d[k] = Math.round(pool * spendShare * f[k] / tot);
    return d;
  };
}

const balanced = (r) => ({
  rdPerf: 0.03, rdCompat: 0.10, rdEase: 0.07, rdRel: 0.10, qa: 0.05,
  ads: r <= 2 ? 0.12 : 0.15, sales: 0.12, refs: r <= 1 ? 0 : 0.10, channels: r >= 5 ? 0.05 : 0,
  community: r >= 2 ? 0.05 : 0, univ: r <= 5 ? 0.03 : 0, tp: r >= 2 ? 0.12 : 0.06, os: 0,
});

const strategies = {
  beachheadBld: mk({
    target: (r) => r <= 2 ? [cellIdx(B, EA), cellIdx(B, INN)] : [cellIdx(B, EM), cellIdx(B, EA), cellIdx(B, LM)],
    price: (r) => r <= 2 ? 6000 : 4300, frac: balanced, respond: { competitor: 'refs', regulation_fail: 'comply', failure: 'recall', winter: 'cut' },
  }),
  beachheadWh: mk({
    target: (r) => r <= 2 ? [cellIdx(W, EA), cellIdx(W, INN)] : [cellIdx(W, EM), cellIdx(W, EA), cellIdx(W, LM)],
    price: (r) => r <= 2 ? 7000 : 5000, frac: balanced, respond: { competitor: 'refs', regulation_fail: 'comply', failure: 'recall' },
  }),
  bowlingAlley: mk({
    target: (r) => r <= 2 ? [cellIdx(B, EA), cellIdx(B, INN)] : r <= 6 ? [cellIdx(B, EM), cellIdx(B, EA)] : [cellIdx(W, EM), cellIdx(B, EM), cellIdx(B, LM)],
    price: (r) => r <= 2 ? 6000 : 4300, frac: balanced, respond: { competitor: 'refs', regulation_fail: 'comply', failure: 'recall' },
  }),
  bowlToHomes: mk({
    target: (r) => r <= 2 ? [cellIdx(B, EA), cellIdx(B, INN)] : r <= 5 ? [cellIdx(B, EM), cellIdx(B, EA)] : [cellIdx(H, EM), cellIdx(B, EM), cellIdx(H, EA)],
    price: (r) => r <= 2 ? 6000 : r <= 5 ? 4300 : 2200, markup: 1.15,
    frac: (r) => Object.assign(balanced(r), r >= 6 ? { channels: 0.12, os: 0.04 } : {}), respond: { competitor: 'refs', regulation_fail: 'comply', failure: 'recall' },
  }),
  homesEarlyThenBld: mk({
    target: (r) => r <= 4 ? [cellIdx(H, EA), cellIdx(H, INN)] : [cellIdx(H, EM), cellIdx(B, EM), cellIdx(H, LM)],
    price: (r) => r <= 2 ? 4000 : 2000, frac: (r) => Object.assign(balanced(r), { channels: 0.12, os: 0.05, sales: 0.03 }),
  }),
  sprayThin: mk({
    target: (r) => [cellIdx(B, EM), cellIdx(W, EM), cellIdx(H, EM)],
    price: () => 4000, frac: balanced,
  }),
  earlyOnly: mk({
    target: (r) => [cellIdx(B, EA), cellIdx(W, EA), cellIdx(H, EA)],
    price: () => 6000, frac: balanced,
  }),
  adsBlitz: mk({
    target: (r) => [cellIdx(H, EM)],
    price: () => 3000, frac: () => ({ ads: 0.8, sales: 0.1, rdPerf: 0.1 }), respond: { failure: 'silent' },
  }),
  noEcosystem: mk({
    target: (r) => r <= 2 ? [cellIdx(B, EA), cellIdx(B, INN)] : [cellIdx(B, EM), cellIdx(B, EA), cellIdx(B, LM)],
    price: (r) => r <= 2 ? 6000 : 4300,
    frac: (r) => Object.assign(balanced(r), { community: 0, univ: 0, tp: 0, os: 0, rdCompat: 0.03 }),
  }),
  homesMass: mk({
    target: (r) => r <= 2 ? [cellIdx(H, EA), cellIdx(H, INN)] : [cellIdx(H, EM), cellIdx(H, EA), cellIdx(H, LM)],
    price: (r) => r <= 2 ? 4000 : 2000, frac: (r) => Object.assign(balanced(r), { channels: 0.12, os: 0.05, sales: 0.03 }),
  }),
  engineers: mk({
    target: (r) => [cellIdx(B, INN), cellIdx(W, INN)],
    price: () => 8000, frac: () => ({ rdPerf: 0.6, rdRel: 0.1, ads: 0.15, sales: 0.15 }),
  }),
  noCapacity: mk({
    target: (r) => r <= 2 ? [cellIdx(B, EA), cellIdx(B, INN)] : [cellIdx(B, EM), cellIdx(B, EA), cellIdx(B, LM)],
    price: (r) => r <= 2 ? 6000 : 4300, frac: balanced, capacity: 'none',
  }),
  overScale: mk({
    target: (r) => r <= 2 ? [cellIdx(B, EA), cellIdx(B, INN)] : [cellIdx(B, EM), cellIdx(B, EA), cellIdx(B, LM)],
    price: (r) => 2500, markup: 1.0, frac: (r) => Object.assign(balanced(r), { qa: 0, rdRel: 0.01 }), capacity: 'huge', debt: 1, spendShare: 1.0,
  }),
  idle: mk({ target: () => [cellIdx(B, EA)], price: () => 6000, frac: () => ({ ads: 0.05 }), spendShare: 0.2, noRaise: true }),
};

function run(name, settings, verbose) {
  const g = E.createGame(settings);
  const strat = strategies[name];
  while (!g.over) E.simulateRound(g, strat(g, g.round));
  if (verbose) {
    console.log(`\n== ${name} (${settings.preset || 'standard'}, seed ${settings.seed})`);
    for (const h of g.history) {
      console.log(`R${h.round} ${h.stage.padEnd(14)} adopt ${(h.adoption * 100).toFixed(2).padStart(6)}%  act ${Math.round(h.active).toString().padStart(7)} dem ${Math.round(h.demand).toString().padStart(7)} sold ${Math.round(h.sold).toString().padStart(7)} cap ${h.capacity.toString().padStart(7)} p ${Math.round(h.newFromP).toString().padStart(6)} q ${Math.round(h.newFromQ).toString().padStart(6)} price ${Math.round(h.price || 0)} uc ${Math.round(h.unitCost)} wp ${h.wpV.map(x=>x.toFixed(0)).join("/")} EM ${h.emPen.map((x) => (x * 100).toFixed(1)).join('/')} cash ${Math.round(h.cashEnd)} fail ${h.failed ? 'Y' : '-'} ev ${h.events.map((e) => e.type).join(',')} drv ${(h.drivers || []).map((d) => d.key).join(',')}`);
    }
  }
  const last = g.history[g.history.length - 1];
  return { score: E.score(g), chasm: g.chasmRound, cash: last.cashEnd, admin: g.admin, stage: last.stage };
}

const args = process.argv.slice(2);
if (args[0] === 'one') {
  run(args[1], { preset: args[2] || 'standard', seed: +(args[3] || 4242) }, true);
} else {
  const presets = ['easy', 'standard', 'hard'];
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  for (const preset of presets) {
    console.log(`\n### ${preset}`);
    const wins = {};
    const rows = [];
    for (const name of Object.keys(strategies)) {
      const res = seeds.map((s) => run(name, { preset, seed: s }));
      const sc = res.map((r) => r.score * 100);
      const mean = sc.reduce((a, b) => a + b, 0) / sc.length;
      const crossed = res.filter((r) => r.chasm != null).length;
      const admin = res.filter((r) => r.admin).length;
      rows.push({ name, mean, min: Math.min(...sc), max: Math.max(...sc), crossed, admin });
    }
    for (const s of seeds) {
      let best = null, bs = -1;
      for (const name of Object.keys(strategies)) { const r = run(name, { preset, seed: s }).score; if (r > bs) { bs = r; best = name; } }
      wins[best] = (wins[best] || 0) + 1;
    }
    rows.sort((a, b) => b.mean - a.mean);
    for (const r of rows) console.log(`${r.name.padEnd(14)} mean ${r.mean.toFixed(2).padStart(6)}%  min ${r.min.toFixed(2).padStart(6)} max ${r.max.toFixed(2).padStart(6)}  crossed ${r.crossed}/20  admin ${r.admin}/20`);
    console.log('wins by seed:', JSON.stringify(wins));
  }
}
