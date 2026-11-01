/* Instructor and teaching-assistant console: lobby, live view, teams, class debrief, runs, staff. */
(function () {
  'use strict';
  const E = window.ChasmEngine;
  const MC = window.MC;
  const t = MC.t, esc = MC.esc, S = MC.S;
  const fmtN = (n) => MC.fmtN(n), fmtK = (k) => MC.fmtK(k), fmtPct = (x, d) => MC.fmtPct(x, d);

  const isOwner = () => S.view.role === 'owner';
  const canPace = () => isOwner() || (S.view.tas || []).some((x) => x.email === S.me.email && x.canPace);

  function groupAmounts(d, P) {
    if (!d) return null;
    const ks = (g) => MC.GROUPS.find((x) => x.id === g).levers;
    const sumOf = (g) => ks(g).reduce((s, k) => s + (k === 'price' || k === 'equity' || k === 'debt' ? 0 : k === 'trial' ? (d.trial ? P.trialCost : 0) : k === 'capacityAdd' ? (d.capacityAdd || 0) * P.capCost / 1000 : (d[k] || 0)), 0);
    return ['prod', 'mkt', 'ops', 'eco'].map((g) => ({ g, k: sumOf(g) }));
  }
  function splitBar(d, P) {
    const a = groupAmounts(d, P); if (!a) return '';
    const tot = a.reduce((s, x) => s + x.k, 0);
    if (!tot) return `<span class="small muted">${esc(t('live.noSpend'))}</span>`;
    const col = { prod: 'var(--s3)', mkt: 'var(--s2)', ops: 'var(--s1)', eco: 'var(--s4)' };
    return `<span class="split" title="${esc(a.map((x) => t('group.' + x.g) + ' ' + fmtK(x.k)).join(' · '))}">${a.map((x) => x.k ? `<i style="flex:${x.k};background:${col[x.g]}"></i>` : '').join('')}</span><span class="small mono">${fmtK(tot)}</span>`;
  }
  function splitLegend() {
    const col = { prod: 'var(--s3)', mkt: 'var(--s2)', ops: 'var(--s1)', eco: 'var(--s4)' };
    return `<div class="legend">${['prod', 'mkt', 'ops', 'eco'].map((g) => `<span><i class="box" style="background:${col[g]}"></i>${esc(t('group.' + g))}</span>`).join('')}</div>`;
  }
  function alertsFor(team, session) {
    const out = [];
    if (!team.state) return out;
    const g = team.state, P = team.P, last = team.history[team.history.length - 1];
    if (g.admin) out.push({ k: 'admin', cls: 'danger' });
    else if (g.cash < P.fixedOverhead + g.capacity * P.capUpkeep / 1000) out.push({ k: 'cash', cls: 'danger' });
    const R = session.settings.rounds;
    if (last && last.round >= Math.ceil(R * 0.6) && last.chasmRound == null && !g.admin) out.push({ k: 'stuck', cls: 'gold' });
    const deciding = team.phase === 'deciding';
    const ms = MC.remaining(team.deadline, team.remainingMs);
    if (deciding && !team.submitted && ms != null && ms < 60000) out.push({ k: 'late', cls: 'danger' });
    return out;
  }

  // ---------------- header ----------------
  function staffHeader() {
    const v = S.view, s = v.session;
    const R = s.settings.rounds;
    const multi = s.mode === 'multi';
    let roundTxt = '';
    if (s.status === 'running' && multi && v.allTeams && v.allTeams[0]) {
      const r = v.allTeams[0].state.round;
      roundTxt = s.phase === 'deciding' ? t('live.phaseDeciding', { n: r, R }) : t('live.phaseResults', { n: r - 1, R });
    } else roundTxt = t('status.' + s.status);
    const submitted = (v.allTeams || []).filter((x) => x.submitted).length;
    const ms = multi && s.phase === 'deciding' ? MC.remaining(s.deadline, s.remainingMs) : null;
    const btn = (act, label, cls, dis) => `<button class="btn ${cls || ''} small" data-act="${act}" ${dis ? 'disabled' : ''}>${esc(label)}</button>`;
    let controls = '';
    if (canPace() && s.status === 'running') {
      controls += btn(s.paused ? 'resume' : 'pause', s.paused ? t('live.resume') : t('live.pause'));
      controls += btn('extend1', t('live.extend', { n: 1 })) + btn('extend2', t('live.extend', { n: 2 }));
      if (multi && s.phase === 'deciding') controls += btn('run', t('live.runNow', { a: submitted, b: v.teams.length }), 'primary');
      if (multi && s.phase === 'results') controls += btn('next', t('live.openNext', { n: v.allTeams[0].state.round }), 'glow');
    }
    if (isOwner() && s.status === 'lobby') controls += `<button class="btn primary" data-act="start" ${v.teams.some((x) => x.members.length) ? '' : 'disabled'}>${esc(t('lobby.start'))}</button>`;
    return `<div class="staff-head">
      <div class="stack" style="gap:4px;min-width:0"><p class="eyebrow">${esc(t(isOwner() ? 'staff.owner' : 'staff.ta'))} · ${esc(t('mode.' + s.mode))} · ${esc(t('preset.' + s.settings.preset))}</p>
        <h2>${esc(s.name || t('session.untitled'))}</h2>
        <div class="row"><span class="pill ${s.status === 'running' ? 'teal' : ''}">${esc(roundTxt)}</span>
          ${s.paused ? `<span class="pill danger">${esc(t('timer.paused'))}</span>` : ''}
          ${ms != null ? `<span class="pill" id="timer">${esc(MC.timerText(ms))}</span>` : ''}
          ${s.run && s.run.practice ? `<span class="pill gold">${esc(t('runs.practiceTag'))}</span>` : ''}</div></div>
      <div class="codechip"><span class="small">${esc(t('staff.code'))}</span><b class="mono">${esc(MC.fmtCode(s.code))}</b><button class="btn ghost small" data-act="copy-code">${esc(t('common.copy'))}</button></div>
      <div class="row controls">${controls}</div>
    </div>`;
  }
  MC.staffTick = function (el) {
    const s = S.view.session;
    const ms = MC.remaining(s.deadline, s.remainingMs);
    el.textContent = MC.timerText(ms);
    el.className = 'pill' + (ms != null && ms < 60000 ? ' danger' : '');
  };

  function tabs() {
    const s = S.view.session;
    const list = s.status === 'lobby' ? ['lobby', 'settings', 'staff'] : ['live', 'teams', 'debrief', 'runs', 'staff'];
    if (!list.includes(S.ui.staffTab)) S.ui.staffTab = list[0];
    return `<div class="tabs" role="tablist">${list.filter((x) => x !== 'settings' || isOwner()).map((x) => `<button class="tab" role="tab" data-act="stab" data-tab="${x}" aria-selected="${S.ui.staffTab === x}">${esc(t('stab.' + x))}</button>`).join('')}</div>`;
  }

  MC.renderStaff = function () {
    const tab = S.ui.staffTab;
    let body = '';
    if (tab === 'lobby') body = lobbyTab();
    else if (tab === 'settings') { if (!S.ui.setup || S.ui.setupFor !== S.view.session.id) MC.openSetup(true); body = MC.setupForm(S.ui.setup, true); }
    else if (tab === 'live') body = liveTab();
    else if (tab === 'teams') body = teamsTab();
    else if (tab === 'debrief') body = debriefTab();
    else if (tab === 'runs') body = runsTab();
    else if (tab === 'staff') body = staffTab();
    return MC.topbar() + `<main class="wrap stack">${MC.banners()}${staffHeader()}${tabs()}${body}</main>`;
  };

  // ---------------- lobby ----------------
  function teamSelect(email, current) {
    if (!isOwner()) return '';
    const v = S.view;
    return `<select class="sel small" data-assign="${esc(email)}" aria-label="${esc(t('lobby.moveTo'))}"><option value="">${esc(t('lobby.unassigned'))}</option>
      ${v.teams.map((tm) => `<option value="${esc(tm.id)}" ${tm.id === current ? 'selected' : ''}>${esc(MC.teamName(tm))}</option>`).join('')}</select>`;
  }
  function lobbyTab() {
    const v = S.view, s = v.session;
    const unassigned = v.players.filter((p) => !p.teamId);
    const url = location.origin;
    return `<div class="codebox"><span class="eyebrow" style="color:#B7C0D2">${esc(t('lobby.howJoin'))}</span>
        <span class="code">${esc(MC.fmtCode(s.code))}</span>
        <span class="muted small">${esc(t('lobby.howJoinBody', { url }))}</span></div>
      <div class="row"><p class="muted">${esc(t('lobby.counts', { p: v.players.length, t: v.teams.length }))} ${esc(s.settings.assign === 'self' ? t('assign.self.desc') : t('assign.instructor.desc'))}</p></div>
      <div class="team-grid">${v.teams.map((tm) => `<div class="card team-card" style="border-top:4px solid ${MC.teamColor(tm)}">
        <h3>${esc(MC.teamName(tm))}</h3>
        <ul class="members">${tm.members.map((m) => `<li><span>${esc(m.name)}${tm.captain === m.email ? ` <span class="tag">${esc(t('lobby.captain'))}</span>` : ''}</span>
          <span class="row" style="gap:6px">${isOwner() && tm.captain !== m.email ? `<button class="btn ghost small" data-act="make-captain" data-team="${esc(tm.id)}" data-email="${esc(m.email)}">${esc(t('lobby.makeCaptain'))}</button>` : ''}${teamSelect(m.email, tm.id)}</span></li>`).join('') || `<li class="muted">${esc(t('lobby.empty'))}</li>`}</ul></div>`).join('')}</div>
      ${unassigned.length ? `<div class="card stack"><h3>${esc(t('lobby.waiting'))}</h3><ul class="members">${unassigned.map((p) => `<li><span>${esc(p.name)} <span class="small muted">${esc(p.email)}</span></span>${teamSelect(p.email, null)}</li>`).join('')}</ul></div>` : ''}
      <p class="small muted">${esc(t('lobby.startNote'))}</p>`;
  }

  // ---------------- live ----------------
  function liveTab() {
    const v = S.view, s = v.session, R = s.settings.rounds;
    const rows = (v.allTeams || []).map((tm) => {
      const last = tm.history[tm.history.length - 1];
      const al = alertsFor(tm, s);
      const status = tm.phase === 'deciding' ? (tm.submitted ? `<span class="pill teal">✓ ${esc(t('live.submitted'))}</span>` : `<span class="pill">${esc(t('live.deciding'))}</span>`)
        : `<span class="pill">${esc(t('phase.' + tm.phase))}</span>`;
      return `<tr><td><span class="sw" style="background:${MC.teamColor(tm)}"></span><b>${esc(MC.teamName(tm))}</b><div class="small muted">${esc(tm.members.map((m) => m.name).join(', '))}</div></td>
        ${s.mode === 'single' ? `<td>${Math.min(tm.state.round, R)}</td>` : ''}
        <td>${status}</td><td class="splitcell">${tm.phase === 'deciding' ? splitBar(tm.draft, tm.P) : '–'}</td>
        <td class="num">${fmtK(tm.state.cash)}</td><td class="num">${fmtN(last ? last.active : 0)}</td><td class="num">${fmtPct(last ? last.adoption : 0, 2)}</td>
        <td><span class="pill ${MC.stageClass(last ? last.stage : '')}">${esc(MC.stageName(last ? last.stage : 'introduction'))}</span></td>
        <td>${al.map((a) => `<span class="pill ${a.cls}">${esc(t('alert.' + a.k))}</span>`).join(' ') || '<span class="small muted">–</span>'}</td></tr>`;
    }).join('');
    const xs = [t('common.start')]; const n = Math.max(0, ...(v.allTeams || []).map((x) => x.history.length));
    for (let i = 1; i <= n; i++) xs.push(t('common.yShort', { n: i }));
    const chart = n ? MC.chart('live-adopt', { title: t('live.adoptionChart'), xs, yPct: true, yFmt: (x) => fmtPct(x, 2),
      lines: (v.allTeams || []).map((tm) => ({ name: MC.teamName(tm), short: MC.teamName(tm), color: MC.teamColor(tm), values: [0].concat(tm.history.map((h) => h.adoption)) })) }) : `<p class="muted small">${esc(t('live.noRounds'))}</p>`;
    const NT = v.market && v.market.NTnow;
    return `<div class="card stack"><div class="row"><h3>${esc(t('live.teams'))}</h3><div class="spacer"></div>${splitLegend()}</div>
        <div class="tbl-wrap"><table class="data live"><thead><tr><th>${esc(t('live.team'))}</th>${s.mode === 'single' ? `<th>${esc(t('kpi.year'))}</th>` : ''}<th>${esc(t('live.status'))}</th><th>${esc(t('live.split'))}</th><th>${esc(t('kpi.cash'))}</th><th>${esc(t('kpi.sites'))}</th><th>${esc(t('kpi.adoption'))}</th><th>${esc(t('live.stage'))}</th><th>${esc(t('live.alerts'))}</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="debrief-grid">
        <div class="card"><h3>${esc(t('live.adoptionChart'))}</h3>${chart}</div>
        ${NT && v.session.mode === 'multi' ? `<div class="card stack"><h3>${esc(t('live.marketMap'))}</h3>${MC.mapSVG({ P: v.market.P, N: NT })}</div>` : ''}
      </div>
      ${canPace() ? `<form class="card row" id="broadcast-form"><label for="bc-text" class="small" style="font-weight:700">${esc(t('live.broadcast'))}</label>
        <input class="input" id="bc-text" maxlength="300" placeholder="${esc(t('live.broadcastPh'))}" style="flex:1 1 280px"><button class="btn" type="submit">${esc(t('live.send'))}</button></form>` : ''}
      ${isOwner() && s.status === 'running' ? `<div class="row"><div class="spacer"></div><button class="btn ghost small" data-act="end">${esc(S.ui.confirm === 'end' ? t('live.endConfirm') : t('live.end'))}</button></div>` : ''}`;
  }

  // ---------------- teams ----------------
  function teamsTab() {
    const v = S.view;
    return `<div class="team-grid wide">${(v.allTeams || []).map((tm) => {
      const last = tm.history[tm.history.length - 1];
      const d = tm.draft || {};
      return `<div class="card stack" style="border-top:4px solid ${MC.teamColor(tm)}">
        <div class="row"><h3>${esc(MC.teamName(tm))}</h3><div class="spacer"></div><span class="pill">${esc(t('phase.' + tm.phase))}</span></div>
        <ul class="members">${tm.members.map((m) => `<li><span>${esc(m.name)}${tm.captain === m.email ? ` <span class="tag">${esc(t('lobby.captain'))}</span>` : ''}</span>
          <span class="row" style="gap:6px">${isOwner() && tm.captain !== m.email ? `<button class="btn ghost small" data-act="make-captain" data-team="${esc(tm.id)}" data-email="${esc(m.email)}">${esc(t('lobby.makeCaptain'))}</button>` : ''}${teamSelect(m.email, tm.id)}</span></li>`).join('')}</ul>
        <div class="lastyear">
          <div class="stat"><span class="k">${esc(t('kpi.cash'))}</span><span class="v">${fmtK(tm.state.cash)}</span></div>
          <div class="stat"><span class="k">${esc(t('stat.capacity'))}</span><span class="v">${fmtN(tm.state.capacity)}</span></div>
          <div class="stat"><span class="k">${esc(t('kpi.sites'))}</span><span class="v">${fmtN(last ? last.active : 0)}</span></div>
          <div class="stat"><span class="k">${esc(MC.term('wholeProduct'))}</span><span class="v">${last ? last.wpV.map((x) => Math.round(x)).join(' · ') : '–'}</span></div>
        </div>
        ${tm.phase === 'deciding' ? `<div class="small"><b>${esc(t('teams.draft'))}</b> ${esc(d.primary != null ? MC.cellName(d.primary) : t('target.none'))}${(d.secondary || []).length ? ' + ' + esc(d.secondary.map(MC.cellName).join(', ')) : ''} · ${esc(t('log.price'))} ${MC.fmtUSD(d.price || 0)}<div style="margin-top:6px">${splitBar(d, tm.P)}</div></div>` : ''}
        ${tm.history.length ? `<details><summary class="small" style="cursor:pointer;font-weight:700">${esc(t('debrief.log'))}</summary><div class="tbl-wrap">${MC.decisionTable(tm)}</div></details>` : ''}
        ${tm.reflection && tm.reflection.some(Boolean) ? `<details><summary class="small" style="cursor:pointer;font-weight:700">${esc(t('refl.title'))}</summary>${tm.reflection.map((r, i) => r ? `<p class="small"><b>${i + 1}.</b> ${esc(r)}</p>` : '').join('')}</details>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  // ---------------- class debrief ----------------
  function debriefTab() {
    const v = S.view, s = v.session;
    const teams = v.allTeams || [];
    if (!teams.some((x) => x.history.length)) return `<p class="muted">${esc(t('live.noRounds'))}</p>`;
    const n = Math.max(...teams.map((x) => x.history.length));
    const xs = [t('common.start')]; for (let i = 1; i <= n; i++) xs.push(t('common.yShort', { n: i }));
    const bass = E.bassCurve(0.03, 0.38, 1, s.settings.rounds);
    const marks = [];
    (teams[0].state.firedEvents || []).forEach((e) => { if (['competitor', 'regulation_fail', 'regulation_pass', 'boom', 'winter'].includes(e.type) && !marks.some((m) => m.i === e.round)) marks.push({ i: e.round, label: t('mark.' + e.type), color: 'var(--ink-3)' }); });
    const deb1 = MC.chart('cls1', { title: t('deb.class1.title'), xs, yPct: true, yFmt: (x) => fmtPct(x, 2), marks,
      lines: teams.map((tm) => ({ name: MC.teamName(tm), short: MC.teamName(tm), color: MC.teamColor(tm), values: [0].concat(tm.history.map((h) => h.adoption)) }))
        .concat(s.mode === 'multi' ? [{ name: t('deb.class1.market'), short: t('deb.class1.marketShort'), color: 'var(--ink-3)', width: 1.5, values: [0].concat((v.market && v.market.teams[0] ? v.market.teams[0].adoption : []).map((_, i) => teams.reduce((acc, tm) => acc + (tm.history[i] ? tm.history[i].adoption : 0), 0))) }] : [])
        .concat(S.ui.hideBass ? [] : [{ name: t('deb.1.bass'), short: 'Bass', color: 'var(--s1)', dash: true, values: bass }]) });
    const ranking = teams.map((tm) => ({ tm, last: tm.history[tm.history.length - 1] })).sort((a, b) => (b.last ? b.last.adoption : 0) - (a.last ? a.last.adoption : 0));
    const sel = S.ui.debriefTeam && teams.find((x) => x.id === S.ui.debriefTeam) ? S.ui.debriefTeam : teams[0].id;
    const team = teams.find((x) => x.id === sel);
    const charts = MC.debriefCharts(team, { rounds: s.settings.rounds, prefix: 'st' });
    const cmp = S.ui.compare.map((id, k) => (id && teams.find((x) => x.id === id)) || teams[Math.min(k, teams.length - 1)]);
    const fq = [1, 2, 3, 4, 5, 6, 7].map((k) => t('guide.' + k));
    return `<div class="row no-print"><div class="spacer"></div><button class="btn" data-act="print">${esc(t('export.pdf'))}</button></div>
      <div class="card"><h3>${esc(t('deb.rank'))}</h3><div class="tbl-wrap"><table class="data"><thead><tr><th>#</th><th>${esc(t('live.team'))}</th><th>${esc(t('kpi.adoption'))}</th><th>${esc(t('kpi.sites'))}</th><th>${esc(t('debrief.stage'))}</th><th>${esc(t('debrief.chasm'))}</th><th>${esc(t('stat.cashEnd'))}</th></tr></thead>
        <tbody>${ranking.map((r, i) => `<tr><td>${i + 1}</td><td><span class="sw" style="background:${MC.teamColor(r.tm)}"></span>${esc(MC.teamName(r.tm))}</td><td>${fmtPct(r.last ? r.last.adoption : 0, 2)}</td><td>${fmtN(r.last ? r.last.active : 0)}</td>
          <td>${esc(MC.stageName(r.last ? r.last.stage : 'introduction'))}</td><td>${esc(r.last && r.last.chasmRound ? t('debrief.chasmYear', { n: r.last.chasmRound }) : t('debrief.notCrossed'))}</td><td>${fmtK(r.tm.state.cash)}</td></tr>`).join('')}</tbody></table></div></div>
      <section class="card chart-card"><p class="eyebrow">DEB-1 · DEB-8</p><h3>${esc(t('deb.class1.title'))}</h3><span class="tag theory concept">${esc(MC.term('sCurve'))} · ${esc(MC.term('bass'))}</span>
        <label class="check no-print" style="margin-top:8px"><input type="checkbox" id="show-bass" data-showbass="1" ${S.ui.hideBass ? '' : 'checked'}><span>${esc(t('deb.class1.showBass'))}</span></label>${deb1}<p class="question"><b>${esc(t('debrief.discuss'))}</b> ${esc(t('deb.class1.q'))}</p></section>
      <div class="card stack"><div class="row"><h3>${esc(t('deb.byTeam'))}</h3><div class="spacer"></div>
        <label class="small" for="deb-team">${esc(t('live.team'))}</label><select class="sel" id="deb-team" data-debteam="1">${teams.map((tm) => `<option value="${esc(tm.id)}" ${tm.id === sel ? 'selected' : ''}>${esc(MC.teamName(tm))}</option>`).join('')}</select></div></div>
      <div class="debrief-grid">${charts.map((c) => `<section class="card chart-card"><p class="eyebrow">${esc(c.id)}</p><h3>${esc(c.t)} · ${esc(MC.teamName(team))}</h3><span class="tag theory concept">${esc(c.c)}</span>${c.html}<p class="question"><b>${esc(t('debrief.discuss'))}</b> ${esc(c.q)}</p></section>`).join('')}</div>
      <section class="card stack"><p class="eyebrow">DEB-7</p><h3>${esc(t('deb.7.title'))}</h3><span class="tag theory concept">${esc(t('deb.7.concept'))}</span>
        <div class="row">${[0, 1].map((k) => `<select class="sel" data-compare="${k}" aria-label="${esc(t('deb.7.pick', { n: k + 1 }))}">${teams.map((tm) => `<option value="${esc(tm.id)}" ${tm.id === cmp[k].id ? 'selected' : ''}>${esc(MC.teamName(tm))}</option>`).join('')}</select>`).join(`<span class="muted">${esc(t('deb.7.vs'))}</span>`)}</div>
        ${MC.chart('cmp', { title: t('deb.7.title'), xs, yPct: true, yFmt: (x) => fmtPct(x, 2), lines: cmp.map((tm) => ({ name: MC.teamName(tm), short: MC.teamName(tm), color: MC.teamColor(tm), values: [0].concat(tm.history.map((h) => h.adoption)) })) })}
        <div class="debrief-grid">${cmp.map((tm) => `<div class="stack"><h4>${esc(MC.teamName(tm))}</h4><div class="tbl-wrap">${MC.decisionTable(tm)}</div></div>`).join('')}</div>
        <p class="question"><b>${esc(t('debrief.discuss'))}</b> ${esc(t('deb.7.q'))}</p></section>
      <section class="card stack"><h3>${esc(t('guide.title'))}</h3><ol class="guide">${fq.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></section>`;
  }

  // ---------------- runs ----------------
  function runsTab() {
    const v = S.view, s = v.session, R = s.settings.rounds;
    const curRound = v.allTeams && v.allTeams[0] ? Math.min(v.allTeams[0].state.round, R) : 1;
    const opts = []; for (let r = 1; r <= Math.min(curRound, R); r++) opts.push(r);
    return `<div class="card stack"><h3>${esc(t('runs.title'))}</h3><p class="small muted">${esc(t('runs.body'))}</p>
        <div class="tbl-wrap"><table class="data"><thead><tr><th>${esc(t('runs.run'))}</th><th>${esc(t('runs.from'))}</th><th>${esc(t('runs.played'))}</th><th>${esc(t('runs.type'))}</th><th></th></tr></thead><tbody>
        ${v.runs.map((r) => `<tr><td>${esc(t('runs.label', { n: r.id }))}${r.idx === s.run.idx ? ` <span class="pill teal">${esc(t('runs.active'))}</span>` : ''}${r.idx === v.scoredRun ? ` <span class="pill gold">${esc(t('runs.scored'))}</span>` : ''}</td>
          <td>${r.fromRound}</td><td>${r.rounds}</td><td>${esc(r.practice ? t('runs.practice') : t('runs.real'))}</td>
          <td>${isOwner() ? `<button class="btn ghost small" data-act="run-practice" data-idx="${r.idx}" data-v="${r.practice ? 0 : 1}">${esc(r.practice ? t('runs.markScored') : t('runs.markPractice'))}</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
      ${isOwner() ? `<form class="card stack" id="rewind-form"><h3>${esc(t('runs.rewindTitle'))}</h3><p class="small muted">${esc(t('runs.rewindBody'))}</p>
        <div class="row"><label for="rw-round" class="small">${esc(t('runs.toStart'))}</label><select class="sel" id="rw-round" data-rwround="1">${opts.map((r) => `<option value="${r}" ${r === (S.ui.rewindRound || curRound) ? 'selected' : ''}>${esc(t('kpi.year'))} ${r}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" id="rw-practice" data-rwpractice="1" ${S.ui.rewindPractice === false ? '' : 'checked'}><span>${esc(t('runs.asPractice'))}</span></label>
          <button class="btn" type="submit">${esc(S.ui.confirm === 'rewind' ? t('runs.rewindConfirm') : t('runs.rewind'))}</button></div></form>` : ''}
      <div class="card stack"><h3>${esc(t('export.title'))}</h3><p class="small muted">${esc(t('export.classBody'))}</p>
        <div class="row"><a class="btn glow" href="/api/sessions/${esc(s.id)}/export.csv?lang=${MC.lang}">${esc(t('export.csv'))}</a>
        ${isOwner() ? `<a class="btn" href="/api/sessions/${esc(s.id)}/audit.json" target="_blank" rel="noopener">${esc(t('export.audit'))}</a>` : ''}
        <button class="btn" data-act="go-debrief">${esc(t('export.pdfDebrief'))}</button></div></div>
      ${isOwner() ? `<div class="card stack"><h3>${esc(t('runs.danger'))}</h3><div class="row"><button class="btn ghost" data-act="delete-session">${esc(S.ui.confirm === 'delete' ? t('runs.deleteConfirm') : t('runs.delete'))}</button></div></div>` : ''}`;
  }

  // ---------------- staff ----------------
  function staffTab() {
    const v = S.view;
    return `<div class="card stack"><h3>${esc(t('staff.title'))}</h3><p class="small muted">${esc(t('staff.body'))}</p>
      ${(v.tas || []).length ? `<ul class="members">${v.tas.map((x) => `<li><span>${esc(x.email)} <span class="tag">${esc(x.canPace ? t('staff.pace') : t('staff.view'))}</span></span>${isOwner() ? `<button class="btn ghost small" data-act="ta-remove" data-email="${esc(x.email)}">${esc(t('common.remove'))}</button>` : ''}</li>`).join('')}</ul>` : `<p class="muted small">${esc(t('staff.none'))}</p>`}
      ${isOwner() ? `<form class="row" id="ta-form"><input class="input" id="ta-email" type="email" placeholder="ta@example.com" style="max-width:300px">
        <label class="check"><input type="checkbox" id="ta-pace"><span>${esc(t('staff.allowPace'))}</span></label><button class="btn" type="submit">${esc(t('staff.add'))}</button></form>` : ''}</div>`;
  }

  // ---------------- interactions ----------------
  MC.onStaffAct = async function (a, el) {
    const v = S.view;
    const confirm = (key, fn) => { if (S.ui.confirm !== key) { S.ui.confirm = key; MC.render(); setTimeout(() => { if (S.ui.confirm === key) { S.ui.confirm = null; MC.render(); } }, 5000); return; } S.ui.confirm = null; fn(); };
    switch (a) {
      case 'stab': S.ui.staffTab = el.dataset.tab; S.ui.confirm = null; if (el.dataset.tab !== 'settings') { S.ui.setup = null; S.ui.setupFor = null; } MC.render(); break;
      case 'copy-code': MC.copy(MC.fmtCode(v.session.code), t('staff.codeCopied')); break;
      case 'start': { const r = await MC.act('ins:start'); if (r.ok) { S.ui.staffTab = 'live'; MC.render(); } break; }
      case 'pause': MC.act('ins:pause', { on: true }); break;
      case 'resume': MC.act('ins:pause', { on: false }); break;
      case 'extend1': MC.act('ins:extend', { minutes: 1 }, t('live.extended', { n: 1 })); break;
      case 'extend2': MC.act('ins:extend', { minutes: 2 }, t('live.extended', { n: 2 })); break;
      case 'run': { el.disabled = true; const r = await MC.act('ins:run'); if (!r.ok) el.disabled = false; break; }
      case 'next': MC.act('ins:next'); break;
      case 'end': confirm('end', () => MC.act('ins:end')); break;
      case 'make-captain': MC.act('team:captain', { teamId: el.dataset.team, email: el.dataset.email }); break;
      case 'run-practice': MC.act('ins:runPractice', { idx: +el.dataset.idx, practice: el.dataset.v === '1' }); break;
      case 'ta-remove': MC.act('ins:ta:remove', { email: el.dataset.email }); break;
      case 'go-debrief': S.ui.staffTab = 'debrief'; MC.render(); setTimeout(() => window.print(), 400); break;
      case 'print': window.print(); break;
      case 'delete-session': confirm('delete', async () => { const r = await MC.emit('ins:delete'); if (r.ok) { MC.toast(t('runs.deleted')); MC.go('#/'); } }); break;
      default: break;
    }
  };
  MC.onStaffSubmit = async function (e) {
    const f = e.target;
    if (f.id === 'broadcast-form') { e.preventDefault(); const el = document.getElementById('bc-text'); const r = await MC.act('ins:broadcast', { text: el.value }, t('live.sent')); if (r.ok) el.value = ''; }
    else if (f.id === 'ta-form') { e.preventDefault(); MC.act('ins:ta:add', { email: document.getElementById('ta-email').value, canPace: document.getElementById('ta-pace').checked }, t('staff.added')); }
    else if (f.id === 'rewind-form') {
      e.preventDefault();
      if (S.ui.confirm !== 'rewind') { S.ui.confirm = 'rewind'; MC.renderKeepFocus(); return; }
      S.ui.confirm = null;
      const r = await MC.act('ins:rewind', { round: +document.getElementById('rw-round').value, practice: document.getElementById('rw-practice').checked }, t('runs.rewound'));
      if (r.ok) { S.ui.rewindRound = null; S.ui.rewindPractice = null; S.ui.staffTab = 'live'; MC.render(); }
    }
  };
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!S.view || S.view.role === 'player') return;
    if (el.dataset.assign != null) MC.act('ins:assign', { email: el.dataset.assign, teamId: el.value || null });
    else if (el.dataset.debteam) { S.ui.debriefTeam = el.value; MC.renderKeepFocus(); }
    else if (el.dataset.compare != null) { S.ui.compare[+el.dataset.compare] = el.value; MC.renderKeepFocus(); }
    else if (el.dataset.showbass) { S.ui.hideBass = !el.checked; MC.renderKeepFocus(); }
    else if (el.dataset.rwround) S.ui.rewindRound = +el.value;
    else if (el.dataset.rwpractice) S.ui.rewindPractice = el.checked;
  });
})();
