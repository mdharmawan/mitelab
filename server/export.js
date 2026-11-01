/* CSV export (INS-12, LANG-8): stable English column keys on row 1, labels in the exporter's language on row 2. */
'use strict';
const E = require('../shared/engine.js');
const I18N = { en: require('../public/i18n/en.js'), id: require('../public/i18n/id.js') };

const COLS = ['run', 'run_type', 'team', 'captain', 'members', 'year', 'stage', 'primary_target', 'secondary_targets', 'price',
  'rd_performance', 'rd_compatibility', 'rd_ease', 'rd_reliability', 'trial', 'ads', 'sales', 'references', 'channels', 'qa',
  'capacity_added', 'equity_raised', 'debt_raised', 'community', 'universities', 'tech_partners', 'open_source', 'event_responses',
  'demand', 'sold', 'capacity', 'new_from_marketing', 'new_from_word_of_mouth', 'churned', 'active_sites', 'adoption_pct',
  'wp_buildings', 'wp_warehouses', 'wp_homes', 'revenue_k', 'cash_end_k', 'product_failure', 'top_drivers', 'chasm_crossed_year',
  'reflection_1', 'reflection_2', 'reflection_3'];

function buildCSV(game, s, lang, teamIdx) {
  const L = I18N[lang] || I18N.en, EN = I18N.en;
  const tr = (k) => (L[k] != null ? L[k] : EN[k] != null ? EN[k] : k);
  const cell = (i) => (i == null ? '' : tr('vert.' + E.VERTICALS[E.cellV(i)].id + '.short') + ' · ' + tr('cat.' + E.CATEGORIES[E.cellC(i)].id));
  const q = (v) => { const x = String(v == null ? '' : v); return /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
  const teamName = (t) => t.name || tr('team.default').replace('{n}', t.n);
  const nameOf = (e) => (s.players[e] || {}).name || e;
  const rows = [COLS, COLS.map((c) => tr('csv.' + c))];
  for (const { run, practice, scored, team, rec } of game.exportRows(s, teamIdx)) {
    const d = rec.decision || {};
    const last = rec.round === s.settings.rounds || rec === undefined;
    rows.push([
      run, practice ? tr('csv.practice') : tr('csv.scored') + (scored ? ' *' : ''), teamName(team), nameOf(team.captain || ''), team.members.map(nameOf).join(' | '),
      rec.round, tr('stage.' + rec.stage), rec.admin ? '' : cell(d.primary), rec.admin ? '' : (d.secondary || []).map(cell).join(' | '), Math.round(rec.price || 0),
      d.rdPerf || 0, d.rdCompat || 0, d.rdEase || 0, d.rdRel || 0, d.trial ? tr('csv.yes') : tr('csv.no'), d.ads || 0, d.sales || 0, d.refs || 0, d.channels || 0, d.qa || 0,
      Math.round(d.capacityAdd || 0), Math.round(rec.equity || 0), Math.round(rec.debt || 0), d.community || 0, d.univ || 0, d.tp || 0, d.os || 0,
      (rec.events || []).map((e) => e.type + ':' + e.response).join(' | '),
      Math.round(rec.demand || 0), Math.round(rec.sold || 0), rec.capacity, Math.round(rec.newFromP || 0), Math.round(rec.newFromQ || 0), Math.round(rec.churnedNow || 0),
      Math.round(rec.active), (rec.adoption * 100).toFixed(3), ...rec.wpV.map((x) => x.toFixed(1)), Math.round(rec.revenue || 0), Math.round(rec.cashEnd),
      rec.failed ? tr('csv.yes') : tr('csv.no'), (rec.drivers || []).map((x) => x.key).join(' | '), rec.chasmRound || '',
      last ? team.reflection[0] : '', last ? team.reflection[1] : '', last ? team.reflection[2] : '',
    ]);
  }
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}

module.exports = { buildCSV, COLS };
