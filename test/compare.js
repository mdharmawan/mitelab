// One team on the new market engine must reproduce the single-player prototype engine.
const OLD = require('./engine-v2-reference.js');
const NEW = require('../shared/engine.js');
process.env.SIM_LIB = '1';
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/sim-strategies.js', 'utf8');
const body = src.slice(0, src.indexOf('function run('));
function load(E) { const f = new Function('require', 'E_ENGINE', body.replace(/const E = require\([^)]*\);/, 'const E = E_ENGINE;') + '\nreturn strategies;'); return f(require, E); }
const sOld = load(OLD), sNew = load(NEW);
let worst = 0, n = 0, drvDiff = 0;
for (const preset of ['easy', 'standard', 'hard']) for (let seed = 1; seed <= 20; seed++) for (const name of Object.keys(sOld)) {
  const a = OLD.createGame({ preset, seed }), b = NEW.createGame({ preset, seed });
  while (!a.over) { OLD.simulateRound(a, sOld[name](a, a.round)); NEW.simulateRound(b, sNew[name](b, b.round)); }
  a.history.forEach((ra, i) => {
    const rb = b.history[i];
    for (const k of ['active', 'cashEnd', 'sold', 'demand', 'revenue', 'newFromP', 'newFromQ', 'churnedNow']) {
      const d = Math.abs(ra[k] - rb[k]) / Math.max(1, Math.abs(ra[k])); if (d > worst) worst = d;
    }
    if (ra.failed !== rb.failed) throw new Error('fail mismatch');
    if (JSON.stringify(ra.drivers.map((x) => x.key)) !== JSON.stringify(rb.drivers.map((x) => x.key))) drvDiff++;
  });
  n++;
}
console.log('runs', n, 'worst relative diff', worst, 'rounds with different driver order', drvDiff);
