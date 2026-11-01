// Multiplayer balance: several scripted teams share one market.
const E = require('../shared/engine.js');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/sim-strategies.js', 'utf8');
const body = src.slice(0, src.indexOf('function run('));
const strategies = new Function('require', 'E_ENGINE', body.replace(/const E = require\([^)]*\);/, 'const E = E_ENGINE;') + '\nreturn strategies;')(require, E);
function play(names, settings) {
  const m = E.createMarket(settings, names.length);
  while (!m.over) m.teams.length && E.simulateMarketRound(m, m.teams.map((g, t) => strategies[names[t]](g, g.round)));
  return m;
}
const lineups = [
  ['bowlToHomes', 'beachheadBld', 'sprayThin', 'homesMass'],
  ['beachheadBld', 'beachheadBld', 'beachheadBld', 'beachheadBld'],
  ['beachheadBld', 'beachheadWh', 'homesMass', 'noEcosystem', 'adsBlitz', 'earlyOnly'],
  ['bowlToHomes', 'bowlToHomes', 'sprayThin'],
  ['beachheadBld', 'noEcosystem'],
];
for (const L of lineups) {
  const agg = L.map(() => []); let mk = [];
  for (let seed = 1; seed <= 20; seed++) {
    const m = play(L, { preset: 'standard', seed });
    m.teams.forEach((g, t) => agg[t].push(E.score(g) * 100));
    mk.push(m.history[m.history.length - 1].adoption * 100);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log('\n' + L.join(' vs ') + `  | market total ${mean(mk).toFixed(1)}%`);
  L.forEach((n, t) => console.log(`  ${n.padEnd(14)} ${mean(agg[t]).toFixed(2)}%  (min ${Math.min(...agg[t]).toFixed(2)} max ${Math.max(...agg[t]).toFixed(2)})`));
}
// sample drivers
const g = E.createGame({ seed: 4242 }); while (!g.over) E.simulateRound(g, strategies.beachheadBld(g, g.round));
console.log('\nsample drivers:', g.history.map((h) => h.round + ':' + h.drivers.map((d) => d.key + '=' + Math.round(d.value)).join('/')).join('  '));
// determinism + replay
const L = ['bowlToHomes', 'sprayThin', 'beachheadBld'];
const m1 = E.createMarket({ seed: 9 }, 3); const log = [];
while (!m1.over) { const d = m1.teams.map((g, t) => strategies[L[t]](g, g.round)); log.push(JSON.parse(JSON.stringify(d))); E.simulateMarketRound(m1, d); }
const m2 = E.replay({ seed: 9 }, 3, log);
console.log('replay identical:', JSON.stringify(m1.teams.map((g) => g.history.map((h) => h.active))) === JSON.stringify(m2.teams.map((g) => g.history.map((h) => h.active))));
const m3 = E.replay({ seed: 9 }, 3, log.slice(0, 4)); console.log('rewind to round 5 → round', m3.round);
