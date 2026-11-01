// Every key used in the client exists in English, and Bahasa Indonesia has exactly the same keys (LANG-3, LANG-7).
const fs = require('fs');
const path = require('path');
const en = require('../public/i18n/en.js');
const id = require('../public/i18n/id.js');
const E = require('../shared/engine.js');
const { COLS } = require('../server/export.js');

const missingInId = Object.keys(en).filter((k) => !(k in id));
const extraInId = Object.keys(id).filter((k) => !(k in en));
const used = new Set();
const dir = path.join(__dirname, '../public/js');
for (const f of fs.readdirSync(dir)) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.]+)'(?!\s*\+)/g)) used.add(m[1]);
}
// keys built at runtime
const dyn = [];
E.VERTICALS.forEach((v) => dyn.push('vert.' + v.id, 'vert.' + v.id + '.short'));
E.CATEGORIES.forEach((c) => dyn.push('cat.' + c.id, 'cat.' + c.id + '.short'));
['introduction', 'chasm', 'early_growth', 'tornado', 'maturity', 'administration'].forEach((s) => dyn.push('stage.' + s));
Object.keys(E.EVENT_RESPONSES).forEach((ev) => {
  ['kicker', 'head', 'brief'].forEach((k) => dyn.push(`event.${ev}.${k}`));
  E.EVENT_RESPONSES[ev].forEach((o) => dyn.push(`event.${ev}.${o.id}`, `event.${ev}.${o.id}.desc`));
  dyn.push('mark.' + ev);
});
['p', 'q', 'backlog', 'gate', 'chasm', 'price', 'capacity', 'churn', 'competitor', 'admin'].forEach((k) => dyn.push('driver.' + k, 'driver.' + k + '.why'));
['admin', 'broke', 'crossed', 'failed', 'capacity', 'q', 'chasm', 'price', 'competitor', 'p', 'default'].forEach((k) => dyn.push('head.' + k));
['price', 'rdPerf', 'rdCompat', 'rdEase', 'rdRel', 'trial', 'ads', 'sales', 'refs', 'channels', 'capacityAdd', 'qa', 'equity', 'debt', 'community', 'univ', 'tp', 'os']
  .forEach((k) => dyn.push('lever.' + k, 'lever.' + k + '.desc'));
['targeting', 'prod', 'mkt', 'ops', 'eco'].forEach((g) => dyn.push('group.' + g));
['sol', 'kiri', 'dev', 'ines', 'ama'].forEach((a) => dyn.push(`advisor.${a}.name`, `advisor.${a}.role`));
['relAdv', 'compat', 'complexity', 'quality', 'trial', 'bassP', 'bassQ', 'reach', 'tornado', 'runway', 'communityQ', 'wholeProduct', 'leadTime', 'retention', 'wpDefence', 'chasm', 'sCurve', 'bass', 'learning']
  .forEach((k) => dyn.push('term.' + k));
['now', 'next', 'two'].forEach((k) => dyn.push('lag.' + k));
[1, 2, 3].forEach((k) => dyn.push('act.' + k, 'refl.' + k));
[1, 2, 3, 4, 5].forEach((k) => dyn.push(`brief.${k}.title`, `brief.${k}.body`));
[1, 2, 3, 4].forEach((k) => dyn.push('brief.loop' + k));
[1, 2, 3, 4, 5, 6].forEach((k) => dyn.push('about.obj.' + k));
[1, 2, 3, 4, 5, 6, 7].forEach((k) => dyn.push('guide.' + k));
['admin', 'cash', 'stuck', 'late'].forEach((k) => dyn.push('alert.' + k));
['lobby', 'settings', 'staff', 'live', 'teams', 'debrief', 'runs'].forEach((k) => dyn.push('stab.' + k));
['lobby', 'running', 'finished'].forEach((k) => dyn.push('status.' + k));
['lobby', 'deciding', 'results', 'finished'].forEach((k) => dyn.push('phase.' + k));
['multi', 'single'].forEach((k) => dyn.push('mode.' + k, 'mode.' + k + '.desc'));
['easy', 'standard', 'hard'].forEach((k) => dyn.push('preset.' + k, 'preset.' + k + '.desc'));
['self', 'instructor'].forEach((k) => dyn.push('assign.' + k, 'assign.' + k + '.desc'));
['off', 'random', 'boom', 'winter'].forEach((k) => dyn.push('funding.' + k));
['en', 'id'].forEach((k) => dyn.push('lang.' + k));
['not_allowed', 'not_found', 'bad_code', 'not_instructor', 'instructor_assigns', 'game_started', 'no_teams', 'not_deciding', 'paused', 'submitted', 'no_target',
  'over_budget', 'captain_only', 'no_team', 'not_results', 'not_started', 'bad_email', 'bad_path', 'not_member', 'no_session', 'offline', 'timeout', 'server_error', 'signed_out', 'generic']
  .forEach((k) => dyn.push('err.' + k));
['about.param.p', 'about.param.q', 'about.param.chasm', 'about.param.wp', 'about.param.learning', 'about.param.lost', 'about.param.cash', 'about.param.capacity', 'about.param.market',
  'log.primary', 'log.price', 'log.rd', 'log.adsSales', 'log.refs', 'log.eco', 'log.capacity', 'log.raised', 'log.stage', 'mark.crossed', 'mark.failure', 'team.default'].forEach((k) => dyn.push(k));
COLS.forEach((c) => dyn.push('csv.' + c));
dyn.forEach((k) => used.add(k));
// server error codes thrown by Game must have messages
const gsrc = fs.readFileSync(path.join(__dirname, '../server/game.js'), 'utf8');
for (const m of gsrc.matchAll(/fail\('([a-z_]+)'\)/g)) used.add('err.' + m[1]);

used.delete('key');
const missingInEn = Array.from(used).filter((k) => !(k in en)).sort();
const unused = Object.keys(en).filter((k) => !used.has(k) && !k.startsWith('csv.') && !k.startsWith('home.title'));
let bad = 0;
if (missingInEn.length) { bad++; console.log('MISSING in en:', missingInEn.join(', ')); }
if (missingInId.length) { bad++; console.log('MISSING in id:', missingInId.join(', ')); }
if (extraInId.length) { bad++; console.log('EXTRA in id:', extraInId.join(', ')); }
// placeholders must match between languages
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
const phDiff = Object.keys(en).filter((k) => k in id && ph(en[k]) !== ph(id[k]));
if (phDiff.length) { bad++; console.log('PLACEHOLDER mismatch:', phDiff.join(', ')); }
console.log(`i18n: ${Object.keys(en).length} keys, ${used.size} referenced, unused ${unused.length}${unused.length ? ' (' + unused.slice(0, 25).join(', ') + ')' : ''}`);
if (bad) process.exit(1); else console.log('i18n check passed');
