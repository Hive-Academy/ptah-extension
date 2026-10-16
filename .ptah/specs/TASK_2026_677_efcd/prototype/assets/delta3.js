/* Delta 3 (design-spec.md "Delta 3 - session stats in the inspector"): SESSION, PLAN LIMITS and LANES sections, the AGENTS tray
   actions, and the closed-inspector toggle ring / dot. Mock data only; shapes follow stats-limit-view-model.types.ts and the strip
   template (session-stats-summary.component.html). Loaded before app.js; app.js calls window.D3.* and sets D3.rerender. */
(function () {
  'use strict';
  var P = new URLSearchParams(location.search);
  var V = P.get('stats') || 'full'; // full | at | none | single | ctx | lane | unk | more   (partial / empty / loading follow ?body=)
  var CIRC = 2 * Math.PI * 18;

  // lucide icons the shared sprite does not carry yet (same path data as lucide-angular)
  (function sprite() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('width', '0'); s.setAttribute('height', '0'); s.setAttribute('aria-hidden', 'true'); s.style.position = 'absolute';
    var a = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    s.innerHTML =
      '<symbol id="i-eye" ' + a + '><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></symbol>' +
      '<symbol id="i-info" ' + a + '><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></symbol>' +
      '<symbol id="i-gauge" ' + a + '><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></symbol>' +
      '<symbol id="i-message-square-text" ' + a + '><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/></symbol>' +
      '<symbol id="i-arrow-down-to-line" ' + a + '><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></symbol>';
    document.body.appendChild(s);
  })();

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ic(id, cls) { return '<svg class="ico ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }

  /* ---------------- mock data (frontend-only fields, as in the strip and the plan-limit view model) ---------------- */
  function data() {
    var ctx = V === 'ctx' ? 91.4 : 15.3;
    var weekly = V === 'at'
      ? { pct: 100, chip: { tone: 'error', text: 'At limit', glyph: '!' }, level: 'crit' }
      : V === 'lane'
        ? { pct: 40, chip: null, level: 'ok' } /* lane-only: the session window is healthy, only a lane is near its limit */
        : { pct: 85, chip: { tone: 'warning', text: 'Near limit', glyph: '!' }, level: 'warn' };
    return {
      ctxKnown: V !== 'unk', ctx: ctx, ctxTok: V === 'ctx' ? '914.0k' : '152.9k', compactions: 2,
      estimate: true, tokens: '19.1M', tokBudget: V === 'more' ? '' : 'of 50.0M budget', tokPct: 38, cost: '$8.87', costCap: 'known subtotal $0.00',
      costBudget: V === 'more' ? { cap: 'of $20.00 budget', pct: 44, vt: '44% of the $20.00 cost budget' } : null,
      time: '15m 59s', turns: '6 turns', agents: 4,
      models: V === 'single' ? [{ name: 'Opus 5.5', id: 'claude-opus-5-5', cost: '$8.87', i: '15.5k', o: '79.9k', cr: '12.0M', cc: '506k' }]
        : [{ name: 'Opus 5.5', id: 'claude-opus-5-5', cost: '$7.41', i: '12.4k', o: '61.2k', cr: '9.8M', cc: '410k' },
           { name: 'Sonnet 5', id: 'claude-sonnet-5', cost: '$1.46', i: '3.1k', o: '18.7k', cr: '2.2M', cc: '96k' }],
      totalCost: '$8.87',
      plan: V === 'none' ? [] : [
        { id: 'weekly', label: 'Weekly', pct: weekly.pct, chip: weekly.chip, level: weekly.level, used: weekly.pct + '% used',
          reset: 'resets Fri 16 Oct 16:00 GMT+3 · in 23h 32m',
          facts: ['Next reset: Fri 16 Oct 16:00 GMT+3 (in 23h 32m)', 'Last reset: Fri 9 Oct 16:00 GMT+3'], note: weekly.pct >= 100 ? 'Requests are refused until the reset.' : '', src: ['Provider API'] },
        { id: 'h5', label: '5-hour', pct: 32, level: 'ok', used: '32% used', reset: 'resets today 20:10 · in 3h 42m',
          facts: ['Next reset: today 20:10 (in 3h 42m)'], note: '', src: ['Provider API'] }],
      extraPlan: V === 'more' ? [
        { id: 'status', label: 'Antigravity', chip: { tone: 'neutral', glyph: '◷', text: 'Stale' }, line: 'No usage source for this account', lines: ['No usage source is connected for this account.', 'Shown as unknown, never as room.'] },
        { id: 'evidence', label: 'Local usage evidence', chip: { tone: 'info', glyph: '~', text: 'Estimate only' }, line: 'A local estimate suggests a limit, not confirmed', lines: ['Observed on this device at 17:02.', 'Not confirmed by the provider.'] },
        { id: 'cooldown', label: 'Cooldown', chip: { tone: 'info', text: 'Cooldown' }, line: 'Retry after today 18:30 · in 1h 12m', lines: ['The provider asked to wait before the next request.', 'Next attempt: today 18:30 (in 1h 12m).'] }] : [],
      provenance: 'Claude account', tail: '721c', provSrc: 'Provider API',
      lanes: (V === 'none' || V === 'single') ? [] : [{
        id: 'lane:codex:software-architect', cli: 'codex', label: 'Codex CLI · software-architect', run: 'Completed', tokens: '2.7M tokens', cost: 'cost unknown', runs: '2 runs',
        limit: V === 'lane' ? { tone: 'warning', glyph: '▲', text: 'Near limit' } : { tone: 'success', glyph: '✓', text: 'Room' }, src: 'Provider API', level: 'ok',
        sub: { heading: 'Codex CLI · gpt-5-codex', owner: 'Different owner', ownerText: 'OpenAI account, not the session account', state: 'Room',
          runsRows: [['Run 1 · software-architect', 'Completed', '1.6M tokens', 'cost unknown'], ['Run 2 · software-architect', 'Completed', '1.1M tokens', 'cost unknown']],
          win: { label: '5-hour', pct: 18, used: '18% used', reset: 'resets today 21:40 · in 4h 12m', level: 'ok' },
          evidence: 'Observed from the provider API at 17:28', note: 'Lane usage is not part of the session totals above.' } }],
      subtotal: (V === 'none' || V === 'single') ? null : { caption: 'Subtotal', tokens: '2.7M tokens known', summary: '$0.00 known cost · 1 lane · 2 runs · 2 cost unknown' },
      alert: (V === 'none' || V === 'lane') ? null : (weekly.pct >= 100 ? { tone: 'crit', text: 'Weekly plan limit reached' } : { tone: 'warn', text: 'Weekly plan limit is near' })
    };
  }
  /* The session limit summary (design-spec D3.7): worst of the session window indicator AND every lane's limit state (at before near). */
  function limitSummary(d) {
    var c = [];
    if (d.alert) c.push({ rank: d.alert.tone === 'crit' ? 2 : 1, text: d.alert.text, source: 'session' });
    d.lanes.forEach(function (l) {
      if (l.limit.text === 'At limit' || l.limit.text === 'Near limit') c.push({ rank: l.limit.text === 'At limit' ? 2 : 1, text: l.label + ' · ' + l.limit.text, source: 'lane' });
    });
    if (!c.length) return { state: 'none' };
    var best = c.reduce(function (b, x) { return x.rank > b.rank ? x : b; }, c[0]);
    return { state: best.rank === 2 ? 'at' : 'near', text: best.text + (c.length > 1 ? ' (+' + (c.length - 1) + ' more)' : ''), source: best.source, extra: c.length - 1 };
  }
  var EST = 'Live estimate while the turn runs; final figures replace it when it ends.';
  var BUDGET_TAIL = 'At 50% Ptah lowers auto-compact; at 80% you can ask the agent to wrap up and hand off.';
  function detailsFor(key, d) {
    var L = [];
    if (key === 'ctx') {
      if (!d.ctxKnown) return 'Context unknown: the latest main request or its verified capacity is unavailable.';
      L = ['Context used (latest main request): 152,900 tokens', 'Context Window: 1,000,000 tokens', 'Usage: 15.3%'];
      if (d.compactions) L.push('Number of context compactions during this session: ' + d.compactions);
      return L.join('\n');
    }
    if (key === 'tok') {
      if (d.estimate) L.push(EST, '');
      L.push('Input (uncached): 15,500', 'Output: 79,900', 'Cache Read: 18,498,600', 'Cache Creation: 506,000', 'Total: 19,100,000');
      if (!d.costBudget) L.push('', 'Session budget: 38% used (19.1M of 50.0M). ' + BUDGET_TAIL);
      return L.join('\n');
    }
    if (key === 'cost') {
      if (d.estimate) L.push(EST);
      if (d.costBudget) L.push('', 'Session budget: 44% used ($8.87 of $20.00). ' + BUDGET_TAIL);
      if (d.costCap) L.push('', 'Only part of this session has a known price. This is the sum of the priced part, not the session total.');
      return L.join('\n').replace(/^\n+/, '');
    }
    if (key === 'agents') return 'Unique subagents this session has run, over its whole lifetime.';
    return '';
  }
  function ctxLevel(p) { return p >= 95 ? 'crit' : p >= 80 ? 'warn' : 'ok'; }
  var ui = { open: {}, models: false, menu: null, steer: null, steerText: '', announce: '' };

  /* ---------------- primitives ---------------- */
  function bar(pct, level, label, valuetext, cls) {
    return '<span class="bar bar--' + level + ' ' + (cls || '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '" aria-label="' + esc(label) +
      '" aria-valuetext="' + esc(valuetext) + '"><span class="bar__f" style="width:' + Math.min(100, pct) + '%"></span></span>';
  }
  function ring(pct, level, labelledby, valuetext) {
    var off = CIRC * (1 - Math.min(100, pct) / 100);
    return '<svg class="ring ring--' + level + '" width="44" height="44" viewBox="0 0 44 44" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) +
      '" aria-labelledby="' + labelledby + '" aria-valuetext="' + esc(valuetext) + '"><circle class="ring__t" cx="22" cy="22" r="18"/><circle class="ring__a" cx="22" cy="22" r="18" stroke-dasharray="' + CIRC.toFixed(1) +
      '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 22 22)"/></svg>';
  }
  function chip(c) { return '<span class="schip schip--' + c.tone + '"><span aria-hidden="true">' + esc(c.glyph || '') + '</span>' + (c.glyph ? ' ' : '') + esc(c.text) + '</span>'; }
  function srcChip(t) { return '<span class="srcchip">' + esc(t) + '</span>'; }
  function head(id, label, meta, metaAttr) { return '<div class="sec-head"><h3 class="sec-label" id="' + id + '" tabindex="-1">' + label + '</h3>' + (meta ? '<span class="sec-meta"' + (metaAttr || '') + '>' + meta + '</span>' : '') + '</div>'; }
  function tilde(on) { return on ? '<span aria-hidden="true">~</span><span class="sr-only">estimated </span>' : ''; }
  function isOpen(k) { return !!ui.open[k]; }
  function disc(k) { return ' data-d3="tile" data-k="' + k + '" aria-expanded="' + isOpen(k) + '" aria-controls="pn-' + k.replace(/[^a-z0-9]/gi, '-') + '"'; }
  function pnid(k) { return 'pn-' + k.replace(/[^a-z0-9]/gi, '-'); }

  /* ---------------- SESSION ---------------- */
  function sessionHTML(body) {
    var d = data(), i = 2;
    if (body === 'loading') {
      return '<section class="insp-sec" aria-busy="true" aria-label="Loading session stats"><div class="sk" style="height:10px;width:30%;margin-bottom:10px"></div><div class="d3-grid">' +
        '<div class="tile" style="grid-column:span 2"><div class="sk" style="height:44px"></div></div><div class="tile"><div class="sk" style="height:34px"></div></div><div class="tile"><div class="sk" style="height:34px"></div></div></div></section>';
    }
    var empty = body === 'empty', partial = body === 'partial';
    var h = '<section class="insp-sec d3-sec st-r" style="--i:' + i + '" aria-labelledby="sessH">' + head('sessH', 'Session', d.estimate && !empty && !partial ? '<span aria-hidden="true">~</span> = estimate' : '');
    var sum = limitSummary(d);
    if (sum.state !== 'none' && !empty && !partial) {
      h += '<p class="d3-alert d3-alert--' + (sum.state === 'at' ? 'crit' : 'warn') + '" data-testid="limits-alert">' + ic('triangle-alert', 'ico--14') + '<span>' + esc(sum.text) + '</span>' +
        '<button type="button" class="link-btn d3-alert__go" data-d3="goto-' + (sum.source === 'lane' ? 'lanes' : 'plan') + '">' + (sum.source === 'lane' ? 'Lanes' : 'Plan limits') + '</button></p>';
    }
    h += '<div class="d3-grid">';
    // a tile with details gets ONE 28 x 28 info button (keyboard reachable disclosure) and an in-tile region; the tile content stays static so its progressbars keep their semantics
    function dtile(key, label, cls, inner, text) {
      if (!text) return '<div class="tile ' + cls + '">' + inner + '</div>';
      var k = 's:' + key, open = isOpen(k), id = 'sd-' + key;
      return '<div class="tile tile--d ' + cls + (open ? ' is-open' : '') + '" data-tile-d="' + key + '">' + inner +
        '<button type="button" class="tile__info" data-d3="sdet" data-k="' + k + '" aria-expanded="' + open + '" aria-controls="' + id + '" aria-label="' + label + ' details" data-testid="sdet-' + key + '">' + ic('info', 'ico--14') + '</button>' +
        '<div class="tile__det" id="' + id + '" role="region" aria-label="' + label + ' details"' + (open ? '' : ' hidden') + '>' + esc(text) + '</div></div>';
    }
    // Context tile. Unknown window (hasKnownContextWindow() false, and body=partial): em dash, no ring, no used-token count, caption Window unknown. No data: em dash + No data yet.
    var cp = d.ctx, ctxInner;
    if (empty) {
      h += dtile('ctx', 'Context', 'tile--ctx', '<div class="tile__txt"><span class="tl" id="ctxL">Context</span><span class="tv tv--lg">\u2014</span><span class="tc">No data yet</span></div>', '');
    } else if (partial || !d.ctxKnown) {
      h += dtile('ctx', 'Context', 'tile--ctx', '<div class="tile__txt"><span class="tl" id="ctxL">Context</span><span class="tv tv--lg" data-testid="stats-context">\u2014</span><span class="tc">Window unknown</span></div>', detailsFor('ctx', { ctxKnown: false }));
    } else {
      ctxInner = ring(cp, ctxLevel(cp), 'ctxL', cp.toFixed(1) + '% of the context window, ' + d.ctxTok + ' tokens used') +
        '<div class="tile__txt"><span class="tl" id="ctxL">Context</span><span class="tv tv--lg tnum" data-testid="stats-context">' + cp.toFixed(1) + '%</span><span class="tc tnum">' + d.ctxTok + ' tokens</span></div>' +
        (d.compactions ? '<span class="tc tile__end"><span data-testid="stats-compactions">' + d.compactions + '</span> compactions</span>' : '');
      h += dtile('ctx', 'Context', 'tile--ctx', ctxInner, detailsFor('ctx', d));
    }
    // Tokens
    var tokV = empty ? '0' : partial ? '\u2014' : d.tokens;
    h += dtile('tok', 'Tokens', '', '<span class="tl">Tokens</span><span class="tv tnum" data-testid="stats-tokens">' + (empty || partial ? '' : tilde(d.estimate)) + tokV + '</span>' +
      (empty || partial || !d.tokBudget ? '' : '<span class="tc">' + d.tokBudget + '</span>' + bar(d.tokPct, 'ok', 'Token budget', d.tokPct + '% of the 50.0M token budget', 'bar--s')), empty || partial ? '' : detailsFor('tok', d));
    // Cost
    var cb = !empty && !partial && d.costBudget;
    h += dtile('cost', 'Cost', '', '<span class="tl">Cost</span><span class="tv tnum" data-testid="stats-cost">' + (empty ? '$0.00' : partial ? '\u2014' : tilde(d.estimate) + d.cost) + '</span>' +
      (empty || partial ? '' : cb ? '<span class="tc tnum">' + d.costBudget.cap + '</span>' + bar(d.costBudget.pct, 'ok', 'Cost budget', d.costBudget.vt, 'bar--s') : '<span class="tc tnum">' + d.costCap + '</span>'), empty || partial ? '' : detailsFor('cost', d));
    // Time (static, no details) + Agents
    if (!empty) {
      h += '<div class="tile"><span class="tl">Time</span><span class="tv tnum" data-testid="stats-duration">' + (partial ? '\u2014' : d.time) + '</span>' + (partial ? '' : '<span class="tc">' + d.turns + '</span>') + '</div>';
      h += dtile('agents', 'Agents', '', '<span class="tl">Agents</span><span class="tv tnum" data-testid="stats-agents">' + (partial ? '\u2014' : d.agents) + '</span>', partial ? '' : detailsFor('agents', d));
    }
    // Models
    if (!empty && !partial) {
      var m = d.models;
      if (m.length > 1) {
        h += '<button type="button" class="tile tile--row tile--btn" data-d3="models" data-testid="stats-models-toggle" aria-expanded="' + ui.models + '" aria-controls="modelsPanel" title="' + (ui.models ? 'Hide' : 'Show') + ' per-model breakdown">' +
          '<span class="tl">Models</span><span class="tile__names">' + esc(m.map(function (x) { return x.name; }).join(', ')) + '</span><span class="tv tnum tile__cnt">' + m.length + '</span>' + ic('chevron-right', 'ico--12 chev12') + '</button>';
        h += '<div class="d3-models" id="modelsPanel" role="list" aria-label="Per-model usage" data-testid="model-usage-table"' + (ui.models ? '' : ' hidden') + '>';
        m.forEach(function (x) {
          h += '<div class="mrow" role="listitem"><div class="mrow__l1"><b title="' + esc(x.id) + '">' + esc(x.name) + '</b><span class="tnum">' + x.cost + '</span></div>' +
            '<dl class="mrow__l2"><div><dt title="Uncached input tokens">In</dt><dd class="tnum">' + x.i + '</dd></div><div><dt title="Output tokens">Out</dt><dd class="tnum">' + x.o + '</dd></div>' +
            '<div><dt title="Cache read tokens">Cache read</dt><dd class="tnum">' + x.cr + '</dd></div><div><dt title="Cache creation tokens">Cache creation</dt><dd class="tnum">' + x.cc + '</dd></div></dl></div>';
        });
        h += '<div class="mrow mrow--tot"><span>Total</span><span class="tnum">' + d.totalCost + '</span></div></div>';
      } else {
        h += '<div class="tile tile--row"><span class="tl">Model</span><span class="tile__names" title="' + esc(m[0].id) + '">' + esc(m[0].name) + '</span></div>';
      }
    }
    return h + '</div></section>';
  }

  /* ---------------- PLAN LIMITS ---------------- */
  function windowDetail(w) {
    var h = '<dl class="wdl"><div><dt>Used</dt><dd>' + esc(w.used) + '</dd></div>';
    (w.facts || []).forEach(function (f) { h += '<div><dt>Resets</dt><dd>' + esc(f) + '</dd></div>'; });
    if (w.note) h += '<div><dt>Note</dt><dd>' + esc(w.note) + '</dd></div>';
    h += '<div><dt>Source</dt><dd>' + (w.src || ['Provider API']).map(srcChip).join(' ') + '</dd></div></dl>';
    return h;
  }
  function planHTML(body) {
    var d = data();
    if (body === 'loading' || body === 'empty' || !d.plan.length) return '';
    var h = '<section class="insp-sec d3-sec st-r" style="--i:4" aria-labelledby="planH" id="planSec">' + head('planH', 'Plan limits', '');
    h += '<p class="prov"><span class="prov__mark">' + ic('m-claude', 'ico--14').replace('#i-m-claude', '#m-claude') + '</span><span class="prov__cap" title="' + esc(d.provenance + ' · ' + d.tail) + '"><span class="prov__lead">' + esc(d.provenance) + '</span><span>&nbsp;·&nbsp;' + esc(d.tail) + '</span></span>' + srcChip(d.provSrc) + '</p>';
    if (body === 'partial') h += '<p class="d3-note" role="status" data-testid="limits-refresh-failed">Refresh failed. Showing the last observed data.</p>';
    h += '<div class="tiles">';
    d.plan.forEach(function (w) {
      var tone = w.level === 'crit' ? 'err' : w.level === 'warn' ? 'warn' : 'neutral', k = 'plan:' + w.id;
      h += '<div class="tile tile--win tile--' + tone + '" data-tile-id="' + k + '"><button type="button" class="tile__btn"' + disc(k) + ' data-testid="plan-limit-tile">' +
        '<span class="tile__l1"><span class="tl2">' + esc(w.label) + '</span>' + (w.chip ? chip(w.chip) : '') + ic('chevron-down', 'ico--12 chev12') + '</span>' +
        '<span class="tile__l2">' + bar(w.pct, w.level, w.label + ' plan usage', w.label + ': ' + w.used + ', ' + w.reset) + '<span class="tv2 tnum">' + esc(w.used) + '</span></span>' +
        '<span class="tile__l3">' + esc(w.reset) + '</span></button><div class="tile__panel" id="' + pnid(k) + '"' + (isOpen(k) ? '' : ' hidden') + '>' + windowDetail(w) + '</div></div>';
    });
    (d.extraPlan || []).forEach(function (x) {
      var k = 'plan:' + x.id;
      h += '<div class="tile tile--win tile--neutral" data-tile-id="' + k + '"><button type="button" class="tile__btn"' + disc(k) + ' data-testid="plan-limit-tile-' + x.id + '">' +
        '<span class="tile__l1"><span class="tl2">' + esc(x.label) + '</span>' + chip(x.chip) + ic('chevron-down', 'ico--12 chev12') + '</span>' +
        '<span class="tile__l3">' + esc(x.line) + '</span></button><div class="tile__panel" id="' + pnid(k) + '"' + (isOpen(k) ? '' : ' hidden') + '><dl class="wdl">' +
        x.lines.map(function (t) { return '<div><dt>Detail</dt><dd>' + esc(t) + '</dd></div>'; }).join('') + '</dl></div></div>';
    });
    return h + '</div></section>';
  }

  /* ---------------- LANES ---------------- */
  function laneHTML(body) {
    var d = data();
    if (body === 'loading' || body === 'empty' || (!d.lanes.length && !d.subtotal)) return '';
    var h = '<section class="insp-sec d3-sec st-r" style="--i:5" aria-labelledby="lanesH">' + head('lanesH', 'Lanes', '1 lane · 2 runs', ' aria-label="1 lane, 2 runs"');
    h += '<p class="lane-cap">' + ic('info', 'ico--12') + '<span>lane · not in totals</span></p><div class="tiles">';
    d.lanes.forEach(function (l) {
      var k = l.id, s = l.sub;
      h += '<div class="tile tile--lane" data-tile-id="' + k + '"><button type="button" class="tile__btn"' + disc(k) + ' data-testid="lane-usage-tile">' +
        '<span class="tile__l1"><span class="prov__mark prov__mark--20"><svg class="ico" aria-hidden="true"><use href="#m-codex"/></svg></span><span class="tl2 tl2--trunc" title="' + esc(l.label) + '">' + esc(l.label) + '</span><span class="schip schip--success" data-run>' + esc(l.run) + '</span>' + ic('chevron-down', 'ico--12 chev12') + '</span>' +
        '<span class="tile__l2b"><b class="tnum">' + esc(l.tokens) + '</b><span class="tc">' + esc(l.cost) + '</span><span class="tc">' + esc(l.runs) + '</span></span>' +
        '<span class="tile__l3b">' + chip(l.limit) + srcChip(l.src) + '</span></button>' +
        '<div class="tile__panel" id="' + pnid(k) + '"' + (isOpen(k) ? '' : ' hidden') + '><div class="sub"><div class="sub__h"><b>' + esc(s.heading) + '</b>' + chip(l.limit) + '</div>' +
        '<p class="sub__own"><b>' + esc(s.owner) + '</b> · ' + esc(s.ownerText) + '</p><ul class="sub__runs">' +
        s.runsRows.map(function (r) { return '<li><span class="r1">' + esc(r[0]) + '</span><span class="tc">' + esc(r[1]) + ' · ' + esc(r[2]) + ' · ' + esc(r[3]) + '</span></li>'; }).join('') + '</ul>' +
        '<div class="sub__win"><span class="tl2">' + esc(s.win.label) + '</span><span class="tile__l2">' + bar(s.win.pct, s.win.level, s.win.label + ' plan usage, Codex', s.win.label + ': ' + s.win.used + ', ' + s.win.reset) + '<span class="tv2 tnum">' + esc(s.win.used) + '</span></span><span class="tc">' + esc(s.win.reset) + '</span></div>' +
        '<p class="tc">' + esc(s.evidence) + '</p><p class="d3-note d3-note--info">' + esc(s.note) + '</p></div></div></div>';
    });
    if (d.subtotal) {
      h += '<div class="subtotal" data-testid="lane-subtotal"><span class="tc">' + d.subtotal.caption + '</span><b class="tnum">' + esc(d.subtotal.tokens) + '</b><span class="tc">' + esc(d.subtotal.summary) + '</span></div>';
    }
    return h + '</div></section>';
  }

  /* ---------------- AGENTS additions (tray) ---------------- */
  var MENU = {
    fe: ['transcript', 'steer', 'background', 'stop'],
    bg: ['steer', 'stop'],
    arch: ['transcript']
  };
  var ITEMS = {
    transcript: ['eye', 'View transcript'], steer: ['message-square-text', 'Steer'], background: ['arrow-down-to-line', 'Send to background'], stop: ['square', 'Stop']
  };
  function hasMenu(id) { return !!MENU[id]; }
  function menuBtn(a) {
    if (!MENU[a.id]) return '';
    var o = ui.menu === a.id;
    return '<button type="button" class="icon-btn agent__menu" data-d3="menu" data-id="' + a.id + '" aria-haspopup="menu" aria-expanded="' + o + '" aria-label="Actions for agent ' + esc(a.name) + '">' + ic('ellipsis', 'ico--16') + '</button>' +
      (o ? '<div class="amenu" role="menu" aria-label="Actions for ' + esc(a.name) + '">' + MENU[a.id].map(function (k) {
        return '<button type="button" role="menuitem" class="amenu__i' + (k === 'stop' ? ' amenu__i--stop' : '') + '" data-d3="act" data-act3="' + k + '" data-id="' + a.id + '" tabindex="-1">' + ic(ITEMS[k][0], 'ico--14') + '<span>' + ITEMS[k][1] + '</span></button>';
      }).join('') + '</div>' : '');
  }
  function steerRow(a) {
    if (ui.steer !== a.id) return '';
    return '<div class="steer"><label class="sr-only" for="steer-' + a.id + '">Steer ' + esc(a.name) + '</label><input id="steer-' + a.id + '" class="steer__in" type="text" placeholder="Steer ' + esc(a.name) + '..." value="' + esc(ui.steerText) + '" />' +
      '<button type="button" class="btn-sm btn-sm--solid" data-d3="steer-send" data-id="' + a.id + '">Send</button><button type="button" class="btn-sm" data-d3="steer-cancel" data-id="' + a.id + '">Cancel</button></div>';
  }
  function trayLine(rows, statusOf) {
    var tray = rows.filter(function (a) { return (a.kind === 'Sub-agent' || a.kind === 'Background') && statusOf(a) !== 'done'; });
    if (!tray.length) return '';
    var fg = tray.filter(function (a) { return a.kind === 'Sub-agent'; }).length, bg = tray.length - fg, run = tray.filter(function (a) { return statusOf(a) === 'running'; }).length;
    var parts = []; if (bg) parts.push(bg + ' background'); if (fg) parts.push(fg + ' foreground'); if (run) parts.push(run + ' running');
    var fin = rows.filter(function (a) { return (a.kind === 'Sub-agent' || a.kind === 'Background') && statusOf(a) === 'done'; }).length; if (fin) parts.push(fin + ' done');
    return '<p class="tray-line" data-testid="tray-summary">' + parts.join(' · ') + '</p>';
  }

  /* ---------------- header toggle: ring + dot + description ---------------- */
  function syncToggle(needN, inspOpen, body) {
    var d = data(), ringEl = document.getElementById('togRing'), dot = document.getElementById('needDot'), desc = document.getElementById('togDesc');
    if (!ringEl) return;
    var known = body === 'full' || body === 'error', parts = [];
    var sm = limitSummary(d), lim = sm.state === 'none' ? 'none' : sm.state;
    if (known) parts.push(d.ctxKnown ? 'Context ' + Math.round(d.ctx) + '%' : 'Context unknown');
    if (lim !== 'none') parts.push(sm.text);
    if (needN) parts.push(needN + (needN === 1 ? ' needs you' : ' need you'));
    desc.textContent = parts.join('. ') + (parts.length ? '.' : '');
    var showRing = !inspOpen && known && d.ctxKnown;
    ringEl.style.display = showRing ? '' : 'none';
    if (showRing) {
      var c = ringEl.querySelector('.ring__a'), len = 2 * Math.PI * 12;
      c.setAttribute('stroke-dasharray', len.toFixed(1)); c.setAttribute('stroke-dashoffset', (len * (1 - d.ctx / 100)).toFixed(1));
      ringEl.setAttribute('class', 'tog-ring ring--' + ctxLevel(d.ctx));
    }
    var kind = needN > 0 ? 'need' : lim === 'at' ? 'err' : lim === 'near' ? 'need' : null;
    var lc = document.getElementById('limChip');
    lc.hidden = inspOpen || lim === 'none';
    if (!lc.hidden) { lc.className = 'hchip hchip--lim hchip--lim-' + lim; lc.title = sm.text; lc.innerHTML = '<svg class="ico ico--12" aria-hidden="true"><use href="#i-triangle-alert"/></svg><span>' + (lim === 'at' ? 'At limit' : 'Limit near') + '</span><span class="sr-only">: ' + esc(sm.text) + '</span>'; }
    dot.hidden = inspOpen || !kind;
    dot.className = 'badge-dot' + (kind === 'err' ? ' badge-dot--err' : '');
  }

  /* ---------------- events ---------------- */
  function rerender(sel) { if (D3.rerender) D3.rerender(sel); }
  function say(t) { var a = document.getElementById('announce'); if (a) { a.textContent = ''; setTimeout(function () { a.textContent = t; }, 30); } }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-d3]');
    if (!t) { if (ui.menu && !e.target.closest('.amenu')) { ui.menu = null; rerender(); } return; }
    var a = t.dataset.d3;
    if (a === 'models') { ui.models = !ui.models; rerender('[data-d3="models"]'); }
    else if (a === 'tile') { ui.open[t.dataset.k] = !isOpen(t.dataset.k); rerender('[data-d3="tile"][data-k="' + t.dataset.k + '"]'); }
    else if (a === 'sdet') { ui.open[t.dataset.k] = !isOpen(t.dataset.k); rerender('[data-d3="sdet"][data-k="' + t.dataset.k + '"]'); }
    else if (a === 'goto-lanes') { var hl = document.getElementById('lanesH'); if (hl) { hl.scrollIntoView({ block: 'start' }); hl.focus(); } }
    else if (a === 'goto-plan') { var h = document.getElementById('planH'); if (h) { h.scrollIntoView({ block: 'start' }); h.focus(); } }
    else if (a === 'menu') {
      var id = t.dataset.id; ui.menu = ui.menu === id ? null : id; rerender(ui.menu ? '.amenu__i' : '[data-d3="menu"][data-id="' + id + '"]');
    } else if (a === 'act') {
      var k = t.dataset.act3, id2 = t.dataset.id; ui.menu = null;
      if (k === 'steer') { ui.steer = id2; ui.steerText = ''; rerender('#steer-' + id2); }
      else { say(ITEMS[k][1] + ' requested for ' + id2 + '.'); rerender('[data-d3="menu"][data-id="' + id2 + '"]'); }
    } else if (a === 'steer-cancel') { ui.steer = null; rerender('[data-d3="menu"][data-id="' + t.dataset.id + '"]'); }
    else if (a === 'steer-send') { ui.steer = null; say('Steer message sent.'); rerender('[data-d3="menu"][data-id="' + t.dataset.id + '"]'); }
  });
  document.addEventListener('input', function (e) { if (e.target.classList && e.target.classList.contains('steer__in')) ui.steerText = e.target.value; });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && e.target.closest && e.target.closest('[data-d3="sdet"]') && isOpen(e.target.dataset.k)) { e.stopPropagation(); ui.open[e.target.dataset.k] = false; rerender('[data-d3="sdet"][data-k="' + e.target.dataset.k + '"]'); return; }
    if (!ui.menu) { if (e.key === 'Escape' && ui.steer) { e.stopPropagation(); var s = ui.steer; ui.steer = null; rerender('[data-d3="menu"][data-id="' + s + '"]'); } return; }
    var items = [].slice.call(document.querySelectorAll('.amenu__i')), i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopPropagation(); var id = ui.menu; ui.menu = null; rerender('[data-d3="menu"][data-id="' + id + '"]'); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Tab') { ui.menu = null; rerender(); }
  }, true);

  var D3 = window.D3 = { sessionHTML: sessionHTML, planHTML: planHTML, laneHTML: laneHTML, menuBtn: menuBtn, steerRow: steerRow, hasMenu: hasMenu, trayLine: trayLine, syncToggle: syncToggle, data: data, summary: limitSummary, ui: ui, rerender: null, variant: V };
})();
