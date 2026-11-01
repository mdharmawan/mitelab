/* Shared client helpers: language, formatting, charts, the market map. Exposes window.MC. */
(function () {
  'use strict';
  const E = window.ChasmEngine;
  const MC = (window.MC = window.MC || {});
  MC.S = MC.S || {}; // shared app state, filled in by main.js
  const { VERTICALS, CATEGORIES, NCELL, cellV, cellC, cellIdx } = E;

  // ---------------- language ----------------
  const LANGS = ['en', 'id'];
  const missing = new Set();
  MC.lang = 'en';
  MC.setLang = function (l) { MC.lang = LANGS.includes(l) ? l : 'en'; document.documentElement.lang = MC.lang; MC.resetTerms(); };
  // t('key', {var}) — Bahasa Indonesia falls back to English and the gap is logged (LANG-7)
  MC.t = function (key, vars) {
    const pack = (window.I18N || {})[MC.lang] || {};
    let s = pack[key];
    if (s == null) {
      s = ((window.I18N || {}).en || {})[key];
      if (MC.lang !== 'en' && !missing.has(key)) { missing.add(key); console.warn('[i18n] missing', MC.lang, key); }
      if (s == null) s = key;
    }
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  };
  MC.missingStrings = () => Array.from(missing);
  // Theory terms: in Bahasa Indonesia the first use on each screen shows the English original in brackets (LANG-4)
  const CORE_TERMS = ['chasm', 'wholeProduct', 'beachhead', 'bowling', 'sCurve', 'learning'];
  let termsShown = new Set();
  MC.resetTerms = () => { termsShown = new Set(); };
  MC.term = function (key) {
    const base = MC.t('term.' + key);
    if (MC.lang !== 'id') return base;
    const en = ((window.I18N || {}).en || {})['term.' + key];
    if (!CORE_TERMS.includes(key) || !en || en.toLowerCase() === base.toLowerCase() || termsShown.has(key)) return base;
    termsShown.add(key);
    return base + ' (' + en.toLowerCase() + ')';
  };

  // ---------------- formatting (LANG-6) ----------------
  const loc = () => (MC.lang === 'id' ? 'id-ID' : 'en-US');
  MC.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  MC.fmtN = (n) => Math.round(n || 0).toLocaleString(loc());
  MC.fmtDec = (n, d) => (n || 0).toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d });
  MC.fmtPct = (x, d) => MC.fmtDec((x || 0) * 100, d == null ? 1 : d) + '%';
  // Money stays in US dollars; units follow the language ($6.00M / US$6,00 jt)
  MC.fmtK = function (k) {
    k = k || 0;
    const neg = k < 0; k = Math.abs(k);
    let s;
    const id = MC.lang === 'id';
    if (k >= 1000) { const m = k / 1000; s = (id ? 'US$' : '$') + MC.fmtDec(m, m >= 100 ? 0 : m >= 10 ? 1 : 2) + (id ? ' jt' : 'M'); }
    else s = (id ? 'US$' : '$') + MC.fmtN(k) + (id ? ' rb' : 'K');
    return (neg ? '−' : '') + s;
  };
  MC.fmtUSD = (d) => (MC.lang === 'id' ? 'US$' : '$') + MC.fmtN(d);
  MC.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  MC.niceCeil = function (x) {
    if (x <= 0) return 1000;
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= x) return m * p;
    return 10 * p;
  };
  MC.vName = (v) => MC.t('vert.' + VERTICALS[v].id);
  MC.vShort = (v) => MC.t('vert.' + VERTICALS[v].id + '.short');
  MC.cName = (c) => MC.t('cat.' + CATEGORIES[c].id);
  MC.cellName = (i) => MC.vShort(cellV(i)) + ' · ' + MC.cName(cellC(i));
  MC.stageName = (st) => MC.t('stage.' + (st || 'introduction'));
  MC.teamName = (t) => (t && t.name) || MC.t('team.default', { n: t ? t.n : '?' });
  MC.teamColor = (t) => `var(--s${((t && t.color) || 0) + 1})`;

  // ---------------- toast and copy ----------------
  let toastTimer = null;
  MC.toast = function (msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
  };
  MC.copy = function (text, okMsg) {
    const done = () => MC.toast(okMsg || MC.t('common.copied'));
    try { navigator.clipboard.writeText(text).then(done, () => MC.toast(MC.t('common.copyFailed'))); } catch (e) { MC.toast(MC.t('common.copyFailed')); }
  };

  // ---------------- market map ----------------
  function hash(i) { let x = (i + 1) * 2654435761 >>> 0; x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995) >>> 0; return (x ^ (x >>> 15)) >>> 0; }
  MC.hash = hash;
  function mapGeometry(P) {
    const W = 1000, labelW = 128, top = 58, gap = 34, H = 480;
    const colW0 = CATEGORIES.map((c) => 0.5 * 0.2 + 0.5 * c.share);
    const usable = W - labelW - gap - 8;
    const colW = colW0.map((x) => x * usable);
    const xs = []; let x = labelW;
    for (let c = 0; c < 5; c++) { if (c === 2) x += gap; xs.push(x); x += colW[c]; }
    const rh0 = P.mV.map((m) => Math.sqrt(m)); const rs = rh0.reduce((a, b) => a + b, 0);
    const rowH = rh0.map((h) => Math.max(70, h / rs * (H - top - 8)));
    const ys = []; let y = top; for (let v = 0; v < 3; v++) { ys.push(y); y += rowH[v]; }
    return { W, H: y + 38, labelW, top, gap, colW, xs, rowH, ys, chasmX: xs[2] - gap };
  }
  // opts: P, N (own adopters), NR (rival adopters, optional), primary, secondary, interactive, rivalV
  MC.mapSVG = function (opts) {
    const P = opts.P;
    const G = mapGeometry(P);
    const N = opts.N || new Array(NCELL).fill(0);
    const NR = opts.NR || null;
    const prim = opts.primary, sec = opts.secondary || [];
    const sp = 13;
    let s = `<svg viewBox="0 0 ${G.W} ${G.H}" role="group" aria-label="${MC.esc(MC.t('map.aria'))}">`;
    CATEGORIES.forEach((C, c) => {
      const cx = G.xs[c] + G.colW[c] / 2;
      const nm = MC.cName(c);
      s += `<text x="${cx}" y="22" text-anchor="middle" font-size="${c === 0 || nm.length > 16 ? 14 : 18}" font-weight="700" fill="var(--ink)">${MC.esc(nm)}</text>`;
      s += `<text x="${cx}" y="42" text-anchor="middle" font-size="15" fill="var(--ink-3)" font-family="IBM Plex Mono, monospace">${MC.fmtDec(C.share * 100, C.share * 100 % 1 ? 1 : 0)}%</text>`;
    });
    const cx0 = G.chasmX, cy0 = G.top - 4, cy1 = G.ys[2] + G.rowH[2] + 4;
    let crack = `M ${cx0 + 6} ${cy0}`;
    for (let i = 1; i <= 14; i++) { const yy = cy0 + (cy1 - cy0) * i / 14; crack += ` L ${cx0 + 6 + (hash(i) % 22)} ${yy}`; }
    s += `<rect x="${cx0 + 2}" y="${cy0}" width="${G.gap - 4}" height="${cy1 - cy0}" rx="6" fill="var(--chasm)"/>`;
    s += `<path d="${crack}" stroke="var(--danger)" stroke-width="1.5" fill="none" opacity=".7"/>`;
    s += `<text x="${cx0 + G.gap / 2}" y="${cy1 + 24}" text-anchor="middle" font-size="16" font-weight="700" letter-spacing="2" fill="var(--danger)">${MC.esc(MC.t('map.chasm').toUpperCase())}</text>`;
    VERTICALS.forEach((V, v) => {
      const y = G.ys[v], h = G.rowH[v];
      s += `<text x="0" y="${y + 24}" font-size="19" font-weight="700" fill="var(--ink)">${MC.esc(MC.vShort(v))}</text>`;
      s += `<text x="0" y="${y + 46}" font-size="14" fill="var(--ink-3)" font-family="IBM Plex Mono, monospace">${MC.esc(MC.t('map.ksites', { n: MC.fmtN(P.mV[v] / 1000) }))}</text>`;
      if (opts.rivalV === v) s += `<g transform="translate(0 ${y + 58})"><rect width="104" height="26" rx="13" fill="var(--danger-soft)"/><text x="52" y="18" text-anchor="middle" font-size="14" font-weight="700" fill="var(--danger)">${MC.esc(MC.t('map.rival'))}</text></g>`;
      CATEGORIES.forEach((C, c) => {
        const i = cellIdx(v, c), x = G.xs[c], w = G.colW[c];
        const m = P.mV[v] * C.share;
        const pen = MC.clamp(N[i] / m, 0, 1), rpen = NR ? MC.clamp(NR[i] / m, 0, 1 - pen) : 0;
        const isP = prim === i, isS = sec.indexOf(i) >= 0;
        const cols = Math.max(1, Math.floor((w - 14) / sp)), rows = Math.max(1, Math.floor((h - 32) / sp));
        const count = cols * rows;
        let lit = Math.round(pen * count); if (N[i] >= 1 && lit === 0) lit = 1;
        let rlit = Math.round(rpen * count); if (NR && NR[i] >= 1 && rlit === 0) rlit = 1;
        const order = []; for (let k = 0; k < count; k++) order.push(k);
        order.sort((a, b) => hash(i * 4099 + a) - hash(i * 4099 + b));
        const litSet = new Set(order.slice(0, lit)), rivSet = new Set(order.slice(lit, lit + rlit));
        const label = MC.t('map.cellAria', { cell: MC.cellName(i), pct: MC.fmtPct(pen) }) + (isP ? ', ' + MC.t('map.primary') : isS ? ', ' + MC.t('map.secondary') : '');
        s += `<g class="cell" data-cell="${i}" ${opts.interactive ? `tabindex="0" role="button" aria-pressed="${isP || isS}"` : ''} aria-label="${MC.esc(label)}">`;
        s += `<rect class="cell-bg" x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="8" fill="${isP ? 'var(--teal-soft)' : 'var(--surface)'}" stroke="${isP || isS ? 'var(--teal)' : 'var(--line)'}" stroke-width="${isP ? 3 : isS ? 2 : 1}" ${isS ? 'stroke-dasharray="6 4"' : ''}/>`;
        const ox = x + (w - (cols - 1) * sp) / 2, oy = y + 28 + ((h - 32) - (rows - 1) * sp) / 2;
        let off = '', on = '', halo = '', riv = '';
        for (let k = 0; k < count; k++) {
          const dx = ox + (k % cols) * sp, dy = oy + Math.floor(k / cols) * sp;
          if (litSet.has(k)) { on += `M${dx - 2.8},${dy}a2.8,2.8 0 1,0 5.6,0a2.8,2.8 0 1,0 -5.6,0`; halo += `M${dx - 5.5},${dy}a5.5,5.5 0 1,0 11,0a5.5,5.5 0 1,0 -11,0`; }
          else if (rivSet.has(k)) riv += `M${dx - 2.4},${dy}a2.4,2.4 0 1,0 4.8,0a2.4,2.4 0 1,0 -4.8,0`;
          else off += `M${dx - 1.8},${dy}a1.8,1.8 0 1,0 3.6,0a1.8,1.8 0 1,0 -3.6,0`;
        }
        if (off) s += `<path d="${off}" fill="var(--node-off)"/>`;
        if (riv) s += `<path d="${riv}" fill="none" stroke="var(--rival)" stroke-width="1.4"/>`;
        if (halo) s += `<path d="${halo}" fill="var(--glow)" opacity=".22"/>`;
        if (on) s += `<path d="${on}" fill="var(--glow)"/>`;
        s += `<text x="${x + 9}" y="${y + 20}" font-size="${c === 0 ? 13 : 15}" font-family="IBM Plex Mono, monospace" font-weight="600" fill="var(--ink-2)">${pen > 0 ? MC.fmtPct(pen, pen < 0.1 ? 1 : 0) : '0%'}</text>`;
        if (isP || isS) {
          const lab = isP ? MC.t('map.primaryTag') : MC.t('map.secondaryTag');
          const wTag = 12 + lab.length * 8;
          s += `<g transform="translate(${x + w - 10} ${y + 13})"><rect x="${-wTag}" y="-9" width="${wTag}" height="19" rx="9.5" fill="var(--teal)"/><text x="${-wTag / 2}" y="5" text-anchor="middle" font-size="12" font-weight="700" fill="var(--surface)">${MC.esc(lab)}</text></g>`;
        }
        s += '</g>';
      });
    });
    s += '</svg>';
    return `<div class="map tbl-wrap"><div style="min-width:620px">${s}</div></div>`;
  };
  MC.mapLegend = (withRivals) => `<div class="map-legend"><span><i style="background:var(--glow)"></i>${MC.esc(MC.t('map.legendOwn'))}</span>${withRivals ? `<span><i class="ring"></i>${MC.esc(MC.t('map.legendRivals'))}</span>` : ''}<span><i style="background:var(--node-off)"></i>${MC.esc(MC.t('map.legendNone'))}</span></div>`;

  // ---------------- charts ----------------
  const CHARTS = {};
  MC.clearCharts = () => { for (const k in CHARTS) delete CHARTS[k]; };
  function niceTicks(min, max, n) {
    if (max === min) max = min + 1;
    const span = max - min, step0 = span / n, p = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= step0) || 10 * p;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const t = []; for (let v = lo; v <= hi + step * 0.001; v += step) t.push(+v.toFixed(10));
    return t;
  }
  function barPath(x, yTop, w, h, color) {
    if (h <= 0.5) return '';
    const r = Math.min(4, w / 2, h);
    return `<path d="M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${yTop + h} Z" fill="${color}"/>`;
  }
  // cfg: xs, yFmt, lines[{name, short, color, values, dash, width}], bars[{name,color,values}], barMode, marks[{i,label,color}], refs[{y,label,color}], height, yMax, title
  MC.chart = function (id, cfg) {
    const counts = {}; (cfg.marks || []).forEach((m) => { counts[m.i] = (counts[m.i] || 0) + 1; });
    const maxStack = Math.max(0, ...Object.values(counts));
    const endLabels = cfg.lines && cfg.lines.length && cfg.endLabels !== false;
    const W = 640, H = (cfg.height || 250) + Math.max(0, maxStack - 1) * 12, ml = 60, mr = endLabels ? 104 : 16, mt = maxStack ? 26 + (maxStack - 1) * 12 : 12, mb = 30;
    const n = cfg.xs.length;
    const all = [];
    (cfg.lines || []).forEach((l) => l.values.forEach((v) => v != null && all.push(v)));
    if (cfg.bars) for (let i = 0; i < n; i++) {
      if (cfg.barMode === 'group') cfg.bars.forEach((b) => all.push(b.values[i] || 0));
      else all.push(cfg.bars.reduce((s, b) => s + (b.values[i] || 0), 0));
    }
    (cfg.refs || []).forEach((r) => all.push(r.y));
    let yMin = Math.min(0, ...all), yMax = cfg.yMax != null ? cfg.yMax : Math.max(...all, 0) * 1.05;
    if (yMax <= yMin) yMax = yMin + 1;
    const ticks = niceTicks(yMin, yMax, 4);
    yMin = ticks[0]; yMax = ticks[ticks.length - 1];
    // Percent axes: enough decimals that no two ticks read the same
    if (cfg.yPct) {
      const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
      const dec = Math.max(0, Math.min(3, -Math.floor(Math.log10(step * 100) + 1e-9)));
      cfg.tickFmt = (v) => MC.fmtPct(v, dec);
      cfg.yFmt = cfg.yFmt || ((v) => MC.fmtPct(v, 2));
    }
    const tickFmt = cfg.tickFmt || cfg.yFmt;
    const pw = W - ml - mr, ph = H - mt - mb, band = pw / Math.max(1, n);
    const xc = (i) => cfg.bars ? ml + band * (i + 0.5) : ml + (n === 1 ? pw / 2 : pw * i / (n - 1));
    const y = (v) => mt + ph * (1 - (v - yMin) / (yMax - yMin));
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${MC.esc(cfg.title || id)}">`;
    s += '<g class="grid">' + ticks.map((t) => `<line x1="${ml}" x2="${W - mr}" y1="${y(t)}" y2="${y(t)}"/>`).join('') + '</g>';
    s += ticks.map((t) => `<text x="${ml - 8}" y="${y(t) + 4}" text-anchor="end">${MC.esc(tickFmt(t))}</text>`).join('');
    s += `<g class="axis"><line x1="${ml}" x2="${W - mr}" y1="${y(Math.max(yMin, 0))}" y2="${y(Math.max(yMin, 0))}"/></g>`;
    cfg.xs.forEach((lab, i) => { if (n <= 13 || i % 2 === 0) s += `<text x="${xc(i)}" y="${H - 10}" text-anchor="middle">${MC.esc(lab)}</text>`; });
    const stackAt = {};
    (cfg.marks || []).forEach((mk) => {
      const xx = xc(mk.i), k = stackAt[mk.i] = (stackAt[mk.i] || 0) + 1;
      if (k === 1) s += `<line x1="${xx}" x2="${xx}" y1="${mt - 4}" y2="${mt + ph}" stroke="${mk.color || 'var(--ink-3)'}" stroke-dasharray="3 3" stroke-width="1"/>`;
      s += `<text x="${xx}" y="${mt - 10 - (k - 1) * 12}" text-anchor="middle" font-size="10" font-weight="700" style="fill:${mk.color || 'var(--ink-2)'}">${MC.esc(mk.label)}</text>`;
    });
    (cfg.refs || []).forEach((r) => {
      s += `<line x1="${ml}" x2="${W - mr}" y1="${y(r.y)}" y2="${y(r.y)}" stroke="${r.color || 'var(--danger)'}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
      s += `<text x="${W - mr - 4}" y="${y(r.y) - 5}" text-anchor="end" font-size="10.5" font-weight="700" style="fill:${r.color || 'var(--danger)'}">${MC.esc(r.label)}</text>`;
    });
    if (cfg.bars) for (let i = 0; i < n; i++) {
      if (cfg.barMode === 'group') {
        const k = cfg.bars.length, bw = Math.min(22, (band * 0.7) / k);
        cfg.bars.forEach((b, j) => { const v = b.values[i] || 0; if (v > 0) s += barPath(xc(i) - (bw * k) / 2 + j * bw + 1, y(v), bw - 2, y(0) - y(v), b.color); });
      } else {
        let acc = 0; const bw = Math.min(30, band * 0.6);
        cfg.bars.forEach((b, j) => {
          const v = b.values[i] || 0; if (v <= 0) return;
          const top = y(acc + v), bot = y(acc);
          const isTop = cfg.bars.slice(j + 1).every((bb) => !(bb.values[i] > 0));
          s += isTop ? barPath(xc(i) - bw / 2, top, bw, bot - top, b.color) : `<rect x="${xc(i) - bw / 2}" y="${top + 1}" width="${bw}" height="${Math.max(0, bot - top - 2)}" fill="${b.color}"/>`;
          acc += v;
        });
      }
    }
    const ends = [];
    (cfg.lines || []).forEach((l) => {
      let d = '', started = false;
      l.values.forEach((v, i) => { if (v == null) { started = false; return; } d += (started ? 'L' : 'M') + xc(i).toFixed(1) + ',' + y(v).toFixed(1); started = true; });
      s += `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="${l.width || 2}" ${l.dash ? 'stroke-dasharray="6 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
      let li = l.values.length - 1; while (li > 0 && l.values[li] == null) li--;
      if (l.values[li] != null) {
        s += `<circle cx="${xc(li)}" cy="${y(l.values[li])}" r="4" fill="${l.color}" stroke="var(--surface)" stroke-width="2"/>`;
        ends.push({ y: y(l.values[li]), name: l.short || l.name });
      }
    });
    if (endLabels && ends.length) {
      ends.sort((a, b) => a.y - b.y);
      for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
      ends.forEach((e) => { s += `<text class="lbl-end" x="${W - mr + 8}" y="${e.y + 4}">${MC.esc(String(e.name).slice(0, 14))}</text>`; });
    }
    s += `<line class="xh" x1="0" x2="0" y1="${mt}" y2="${mt + ph}" stroke="var(--ink-3)" stroke-width="1" visibility="hidden"/>`;
    s += `<rect class="hit" x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
    CHARTS[id] = { cfg, xc, W, n };
    const series = [].concat(cfg.bars || [], cfg.lines || []);
    const legend = series.length > 1 ? `<div class="legend">${series.map((x) => `<span><i class="${cfg.bars && cfg.bars.includes(x) ? 'box' : ''}" style="background:${x.color}"></i>${MC.esc(x.name)}${x.dash ? ' ' + MC.esc(MC.t('chart.dashed')) : ''}</span>`).join('')}</div>` : '';
    let table = `<table class="data"><thead><tr><th>${MC.esc(cfg.xName || MC.t('common.year'))}</th>${series.map((x) => `<th>${MC.esc(x.name)}</th>`).join('')}</tr></thead><tbody>`;
    cfg.xs.forEach((x, i) => { table += `<tr><td>${MC.esc(x)}</td>${series.map((se) => `<td>${se.values[i] == null ? '–' : MC.esc((se.fmt || cfg.yFmt)(se.values[i]))}</td>`).join('')}</tr>`; });
    table += '</tbody></table>';
    return `<div class="chart" data-chart="${id}">${s}<div class="tt" hidden></div></div>${legend}
      <div class="row no-print" style="margin-top:6px"><button class="btn ghost small" data-act="toggle-table" data-target="tbl-${id}" aria-expanded="false">${MC.esc(MC.t('chart.showTable'))}</button></div>
      <div class="tbl-wrap" id="tbl-${id}" hidden>${table}</div>`;
  };
  function chartHover(e) {
    const el = e.target.closest('.chart'); if (!el) return;
    const ch = CHARTS[el.dataset.chart]; if (!ch) return;
    const svg = el.querySelector('svg'), tt = el.querySelector('.tt'), xh = svg.querySelector('.xh');
    const rect = svg.getBoundingClientRect();
    const vx = (e.clientX - rect.left) / rect.width * ch.W;
    let best = 0, bd = 1e9;
    for (let i = 0; i < ch.n; i++) { const d = Math.abs(ch.xc(i) - vx); if (d < bd) { bd = d; best = i; } }
    const cfg = ch.cfg;
    xh.setAttribute('x1', ch.xc(best)); xh.setAttribute('x2', ch.xc(best)); xh.setAttribute('visibility', 'visible');
    const rows = [].concat(cfg.bars || [], cfg.lines || []).filter((x) => x.values[best] != null)
      .map((x) => `<div class="r"><span><i style="background:${x.color}"></i>${MC.esc(x.name)}</span><b>${MC.esc((x.fmt || cfg.yFmt)(x.values[best]))}</b></div>`).join('');
    tt.innerHTML = `<div style="font-weight:700;margin-bottom:4px">${MC.esc(cfg.xs[best])}</div>${rows}`;
    tt.hidden = false;
    const px = ch.xc(best) / ch.W * rect.width, tw = tt.offsetWidth;
    let left = px + 12; if (left + tw > rect.width) left = px - tw - 12; if (left < 0) left = 0;
    tt.style.left = left + 'px'; tt.style.top = '8px';
  }
  function chartLeave(e) {
    const el = e.target.closest && e.target.closest('.chart'); if (!el) return;
    const tt = el.querySelector('.tt'); if (tt) tt.hidden = true;
    const xh = el.querySelector('.xh'); if (xh) xh.setAttribute('visibility', 'hidden');
  }
  document.addEventListener('pointermove', (e) => { if (e.target.closest && e.target.closest('.chart')) chartHover(e); });
  document.addEventListener('pointerout', (e) => { if (e.target.classList && e.target.classList.contains('hit')) chartLeave(e); });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act="toggle-table"]'); if (!t) return;
    const el = document.getElementById(t.dataset.target);
    if (el) { el.hidden = !el.hidden; t.textContent = el.hidden ? MC.t('chart.showTable') : MC.t('chart.hideTable'); t.setAttribute('aria-expanded', String(!el.hidden)); }
  });

  // ---------------- small pieces ----------------
  MC.logo = (size) => `<svg width="${size || 30}" height="${size || 30}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="var(--chasm)"/>
    <path d="M6 22 C 11 22, 12 10, 16 10 S 21 22, 26 22" stroke="var(--glow)" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <circle cx="16" cy="10" r="2.6" fill="var(--glow)"/><circle cx="6" cy="22" r="1.8" fill="var(--glow)"/><circle cx="26" cy="22" r="1.8" fill="var(--glow)"/></svg>`;
  MC.initials = (name) => String(name || '?').replace(/^(Prof\.|Dr\.)\s*/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  MC.stageClass = (st) => (st === 'administration' || st === 'chasm' ? 'danger' : st === 'tornado' || st === 'maturity' ? 'gold' : st === 'early_growth' ? 'teal' : '');

  // A team object the engine can evaluate in the browser (budget, events, unit cost)
  MC.teamG = function (team, session) {
    if (!team || !team.state) return null;
    const g = Object.assign({}, team.state, { P: team.P, settings: Object.assign({ failures: true, randomness: true }, session.settings), draws: [] });
    return g;
  };
})();
