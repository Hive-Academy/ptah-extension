/* Prototype behaviour only. Mock data, no network. State lives in the query string so every screenshot is a URL.
   Params: theme=dark|light  t1=collapsed|expanded  t2=ref|streaming|answered|done  insp=open|closed
           body=full|partial|empty|loading|error  width=wide|sidebar  ask=lane|lane-open|multi|question|none
           host=electron|rail  parity=0|1  fail=1  bare=1  reduce=1  replay=0|1  sel=1
   Round 1 additions: request routing (Review / Answer / +N more, success / error / closed), overlay focus
   management (entry, inert background, trap, return on every close path), partial / unknown section states. */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var shell = $('#shell'), main = $('#mainRegion'), insp = $('#inspector'), toggle = $('#inspToggle');
  var P = new URLSearchParams(location.search);
  var state = {
    theme: P.get('theme') === 'light' ? 'light' : 'dark',
    t1: P.get('t1') || 'collapsed', t2: P.get('t2') || 'ref', insp: P.get('insp') || 'open',
    body: P.get('body') || 'full', width: P.get('width') || 'wide',
    ask: P.get('ask') || 'lane', host: P.get('host') || 'rail', parity: P.get('parity') || '0'
  };
  var ui = { open: null, more: {}, usage: true, panel: {}, last: {}, selected: P.get('sel') === '1' ? 'arch' : null, fail: P.get('fail') === '1' };

  /* ---------------- mock data ---------------- */
  var AG = [
    { id: 'fe', name: 'frontend-developer', kind: 'Sub-agent', icon: 'bot', status: 'running', dur: '2m 13s', act: 'Read session-context.token.ts' },
    { id: 'codex', name: 'Codex', kind: 'CLI lane', mark: 'codex', status: 'running', dur: '1m 50s', act: 'Fixing a failing assertion' },
    { id: 'gemini', name: 'Gemini', kind: 'CLI lane', icon: 'terminal', status: 'running', dur: '33s', act: 'Running npx nx lint chat' },
    { id: 'bg', name: 'nx test chat', kind: 'Background', icon: 'layers', status: 'running', dur: '1m 51s', act: 'npx nx test chat --parallel=1' },
    { id: 'arch', name: 'software-architect', kind: 'Sub-agent', icon: 'bot', status: 'done', dur: '2m 41s', act: 'Wrote implementation-plan.md' }
  ];
  var TODOS = [
    ['done', 'Map current shell and stores'], ['done', 'Write implementation plan'], ['run', 'Build desktop shell behind a flag'],
    ['run', 'Session Inspector panel'], ['pending', 'Settings toggle and e2e smoke test']
  ];
  function mkReqs(kind) {
    var g1 = { key: 'lane:gemini:r1', kind: 'permission', owner: 'gemini', tool: 'Bash', cmd: 'npx nx lint chat' };
    var g2 = { key: 'lane:gemini:r2', kind: 'permission', owner: 'gemini', tool: 'Bash', cmd: 'git diff --stat origin/main...HEAD' };
    var g3 = { key: 'lane:gemini:r3', kind: 'permission', owner: 'gemini', tool: 'Write', cmd: 'apps/ptah-electron/src/renderer/app.html' };
    var op = { key: 'perm:p1', kind: 'permission', owner: 'orch', tool: 'Edit', cmd: 'libs/frontend/chat/src/lib/components/templates/chat-view.component.ts' };
    var q1 = { key: 'q:q1', kind: 'question', owner: 'codex', text: 'Base the batches on main or on feat/desktop-shell?' };
    if (kind === 'lane' || kind === 'lane-open') return [g1];
    if (kind === 'multi') return [g1, g2, g3, op, q1];
    if (kind === 'question') return [q1];
    return [];
  }
  var reqs = mkReqs(state.ask);

  /* ---------------- helpers ---------------- */
  function icon(id, cls) { return '<svg class="ico ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }
  function mark(id) { return '<svg class="mark"' + (id === 'codex' ? ' data-departure="codex-brand-mark"' : '') + ' aria-hidden="true"><use href="#m-' + id + '"/></svg>'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmt(s) { var m = Math.floor(s / 60), r = s % 60; return m + 'm ' + (r < 10 ? '0' : '') + r + 's'; }
  function words(d) {
    var m = /(?:(\d+)m )?(\d+)s/.exec(d || ''); if (!m) return '';
    var out = []; if (m[1]) out.push(m[1] + (m[1] === '1' ? ' minute' : ' minutes')); out.push(m[2] + (m[2] === '1' ? ' second' : ' seconds'));
    return out.join(' ');
  }
  function isDone() { return state.t2 === 'done'; }
  function live() { return state.body !== 'empty' && state.body !== 'loading'; }
  function active(owner) { return reqs.filter(function (r) { return r.owner === owner && !r.closed; }); }
  function needCount() { return (!live() || isDone()) ? 0 : reqs.filter(function (r) { return !r.closed; }).length; }
  function statusOf(a) {
    if (isDone()) return 'done';
    if (active(a.id).length) return 'waiting';
    return a.status;
  }
  var WORD = { running: 's-run', waiting: 's-need', done: 's-done', failed: 's-err', stopped: 's-idle' };
  function announce(msg) { var a = $('#announce'); a.textContent = ''; setTimeout(function () { a.textContent = msg; }, 30); }
  function ownerName(o) { return o === 'orch' ? 'Orchestrator' : (AG.filter(function (a) { return a.id === o; })[0] || {}).name || o; }

  /* ---------------- request UI (inspector rows) ---------------- */
  function panelHTML(r) {
    var st = ui.panel[r.key] || 'idle';
    var who = ownerName(r.owner);
    var busy = st === 'sending';
    var dis = busy ? ' disabled' : '';
    var h = '<div class="req-panel" id="panel-' + r.key.replace(/:/g, '-') + '" role="group" tabindex="-1" aria-label="Permission request from ' + esc(who) + '" aria-busy="' + busy + '">';
    if (r.closed) {
      h += '<p class="req-msg" role="status">This request is no longer pending. It was answered elsewhere or the lane ended.</p>' +
        '<div class="req-actions"><button type="button" class="btn-sm" data-act="dismiss" data-key="' + r.key + '">Close</button></div></div>';
      return h;
    }
    h += '<div class="req-cap">' + esc(who) + ' wants to use <b>' + esc(r.tool) + '</b></div><code class="req-cmd">' + esc(r.cmd) + '</code>';
    h += '<div class="req-actions">' +
      '<button type="button" class="btn-sm btn-sm--allow" data-act="decide" data-d="allow" data-key="' + r.key + '"' + dis + '>' + (r.owner === 'orch' ? 'Allow once' : 'Allow') + '</button>' +
      (r.owner === 'orch' ? '<button type="button" class="btn-sm btn-sm--allow" data-act="decide" data-d="always" data-key="' + r.key + '"' + dis + '>Always allow</button>' : '') +
      '<button type="button" class="btn-sm btn-sm--deny" data-act="decide" data-d="deny" data-key="' + r.key + '"' + dis + '>Deny</button>' +
      (state.host === 'rail' && r.owner !== 'orch' ? '<button type="button" class="link-btn" data-act="open-lane" data-owner="' + r.owner + '">Open lane</button>' : '') +
      '</div>';
    if (busy) h += '<p class="req-msg" role="status">Sending your answer...</p>';
    if (st === 'error') h += '<p class="req-msg req-msg--err" role="alert">' + icon('triangle-alert', 'ico--12') + '<span>Could not send your answer. The request is still waiting.</span><button type="button" class="link-btn" data-act="retry" data-key="' + r.key + '">Retry</button></p>';
    return h + '</div>';
  }
  function lineHTML(r) {
    var who = ownerName(r.owner);
    var open = ui.open === r.key;
    var ctl = 'panel-' + r.key.replace(/:/g, '-');
    if (r.kind === 'question') {
      var t = r.text.length > 60 ? r.text.slice(0, 60) + '…' : r.text;
      return '<div class="req">' + icon('message-circle-question-mark', 'ico--12') +
        '<span class="txt"><b>Asked you:</b> ' + esc(t) + '</span>' +
        '<button type="button" class="btn-sm" data-act="answer" data-key="' + r.key + '" aria-label="Answer question from ' + esc(who) + ': ' + esc(r.text) + '">Answer</button></div>';
    }
    var short = r.cmd.length > 60 ? r.cmd.slice(0, 60) + '…' : r.cmd;
    return '<div class="req">' + icon('shield-alert', 'ico--12') +
      '<span class="txt"><b>Needs permission:</b> <code>' + esc(short) + '</code></span>' +
      '<button type="button" class="btn-sm" data-departure="review-button" data-act="review" data-key="' + r.key + '" aria-expanded="' + open + '" aria-controls="' + ctl + '" aria-label="Review permission request from ' + esc(who) + ': ' + esc(r.cmd) + '">Review</button></div>' +
      (open ? panelHTML(r) : '');
  }
  function reqHTML(owner) {
    var list = reqs.filter(function (r) { return r.owner === owner && (!r.closed || ui.open === r.key); });
    if (!list.length) return '';
    var first = list[0], rest = list.slice(1);
    var h = lineHTML(first);
    if (rest.length) {
      var openMore = !!ui.more[owner];
      h += '<button type="button" class="more" data-act="more" data-owner="' + owner + '" aria-expanded="' + openMore + '" aria-controls="more-' + owner + '">' +
        (openMore ? 'Hide ' + rest.length + ' more' : '+' + rest.length + ' more') + '</button>';
      h += '<ul class="req-more" id="more-' + owner + '"' + (openMore ? '' : ' hidden') + '>' + rest.map(function (r) { return '<li>' + lineHTML(r) + '</li>'; }).join('') + '</ul>';
    }
    return '<div class="req-wrap">' + h + '</div>';
  }

  /* ---------------- inspector sections ---------------- */
  function sk() { return '<div class="sk-row"><div class="sk" style="height:12px;width:55%"></div><div class="sk" style="height:10px;width:80%"></div></div>'; }
  function orchHTML(partial) {
    var done = isDone(), orchReq = active('orch').length > 0;
    var dot = done ? 'dot' : orchReq ? 'dot dot--need' : 'dot dot--run';
    var st = done ? 'idle · ready for the next turn' : orchReq ? 'needs you' : (active('gemini').length || active('codex').length ? 'waiting on 4 agents' : 'working · 4 agents running');
    var ctxLabel = partial ? '—' : '41% of 200k';
    var h = '<section class="insp-sec st-r" style="--i:1" aria-label="Orchestrator">' +
      '<div class="orch-top" tabindex="-1"><span class="' + dot + '" aria-hidden="true"></span><span class="orch-name">Orchestrator</span></div>' +
      '<div class="orch-sub muted">Opus 5.5 · <span id="orchState">' + st + '</span></div>' + reqHTML('orch') +
      '<div class="ctx-row"><span class="muted" id="ctxLabel">Context</span><span class="muted tnum">' + ctxLabel + '</span></div>' +
      '<progress class="ctx-bar" id="ctxBar" value="' + (partial ? 0 : 41) + '" max="100" aria-labelledby="ctxLabel" aria-valuetext="' + (partial ? 'Context usage unavailable' : '41% of the 200k token window') + '"></progress>' +
      '<dl class="stats"><div class="stat"><dt class="l">tokens</dt><dd class="v">82.4k</dd></div><div class="stat"><dt class="l">cost</dt><dd class="v">$1.84</dd></div><div class="stat"><dt class="l">turns</dt><dd class="v">6</dd></div></dl>';
    if (state.parity === '1' && !partial) {
      h += '<button type="button" class="disc-btn disc-btn--block" data-act="usage" aria-expanded="' + ui.usage + '" aria-controls="usage"><span>Usage and limits</span>' + icon('chevron-right', 'ico--12 chev12') + '</button>' +
        '<div class="usage" id="usage"' + (ui.usage ? '' : ' hidden') + '>' +
        '<div class="u-row"><span class="muted">Compactions</span><span class="tnum">2</span></div>' +
        '<div class="u-row"><span class="muted" id="uB">Budget</span><span class="tnum">$1.84 of $5.00</span></div><progress class="ctx-bar" value="37" max="100" aria-labelledby="uB" aria-valuetext="37% of the session budget"></progress>' +
        '<div class="u-row"><span class="muted" id="uL">5-hour limit</span><span class="tnum">62%</span></div><progress class="ctx-bar" value="62" max="100" aria-labelledby="uL" aria-valuetext="62% of the 5-hour limit"></progress>' +
        '<div class="u-row"><span class="muted" id="uW">Weekly limit</span><span class="tnum">18%</span></div><progress class="ctx-bar" value="18" max="100" aria-labelledby="uW" aria-valuetext="18% of the weekly limit"></progress></div>';
    }
    return h + '</section>';
  }
  function agentsHTML(partial) {
    var rows = AG.slice().sort(function (a, b) {
      var rank = function (x) { var s = statusOf(x); return s === 'waiting' ? 0 : s === 'done' ? 2 : 1; };
      return rank(a) - rank(b);
    });
    var act = rows.filter(function (a) { return statusOf(a) !== 'done'; }).length, fin = rows.length - act;
    var h = '<section class="insp-sec insp-sec--agents st-r" style="--i:2" aria-labelledby="agentsH"' + (partial ? ' data-partial="true"' : '') + '>' +
      '<div class="sec-head"><h3 class="sec-label" id="agentsH">Agents</h3><span class="sec-meta">' + act + ' active · ' + fin + ' finished' + (partial ? ' · <span title="Restored session: some durations and activity are not stored">partial</span>' : '') + '</span></div>' +
      '<ul class="agent-list" id="agentList">';
    rows.forEach(function (a, i) {
      var s = statusOf(a), dur = (partial && (a.kind === 'Sub-agent' || a.id === 'codex')) ? '' : a.dur;
      var actLine = (partial && a.id !== 'bg') ? '' : (s === 'waiting' && active(a.id).length ? '' : a.act);
      var label = a.name + ', ' + a.kind.toLowerCase().replace('cli lane', 'CLI lane') + ', ' + s + (dur ? ' ' + words(dur) : '') + '.' + (actLine ? ' ' + actLine : '');
      h += '<li class="agent' + (s === 'done' ? ' agent--finished' : '') + ' st-r" style="--i:' + (i + 3) + '" data-agent="' + a.id + '"' + (ui.selected === a.id ? ' aria-current="true"' : '') + '>' +
        '<button type="button" class="agent__main" data-act="select" data-agent="' + a.id + '" aria-label="' + esc(label) + '">' +
        '<span class="agent__l1">' + (a.mark ? mark(a.mark) : icon(a.icon)) + '<span class="agent__name" title="' + esc(a.name) + '">' + esc(a.name) + '</span><span class="kind">' + a.kind + '</span>' +
        '<span class="agent__stat"><span class="w ' + WORD[s] + '">' + s + '</span>' + (dur ? ' <span class="t">· ' + dur + '</span>' : '') + '</span></span>' +
        (actLine ? '<span class="agent__act">' + esc(actLine) + '</span>' : '') + '</button>' + reqHTML(a.id) + '</li>';
    });
    return h + '</ul></section>';
  }
  function todosHTML(partial) {
    if (partial) {
      return '<section class="insp-sec st-r" style="--i:8" aria-labelledby="todosH" id="todosSec"><div class="sec-head"><h3 class="sec-label" id="todosH">Todos</h3><span class="sec-meta">unknown</span></div>' +
        '<p class="note" role="status">Could not read the todo list for this session. It may be stored in an older format.</p></section>';
    }
    var done = TODOS.filter(function (t) { return t[0] === 'done'; }).length;
    var h = '<section class="insp-sec st-r" style="--i:8" aria-labelledby="todosH" id="todosSec"><div class="sec-head"><h3 class="sec-label" id="todosH">Todos</h3><span class="sec-meta tnum">' + done + ' of ' + TODOS.length + '</span></div><ul class="todo-list">';
    TODOS.forEach(function (t) {
      var chk = '<svg class="ico ico--12" style="width:10px;height:10px;stroke-width:3.5" aria-hidden="true"><use href="#i-check"/></svg>';
      if (t[0] === 'done') h += '<li class="todo todo--done"><span class="cb cb--done" aria-hidden="true">' + chk + '</span><span class="sr-only">Done: </span><span class="tx">' + t[1] + '</span></li>';
      else if (t[0] === 'run') h += '<li class="todo todo--run"><span class="cb cb--run" aria-hidden="true"></span><span class="sr-only">In progress: </span><span class="tx">' + t[1] + '</span></li>';
      else h += '<li class="todo"><span class="cb" aria-hidden="true"></span><span class="sr-only">Pending: </span><span class="tx">' + t[1] + '</span></li>';
    });
    return h + '</ul></section>';
  }
  function gitHTML(mode) {
    var head = function (link) { return '<div class="sec-head"><h3 class="sec-label" id="gitH">Git</h3>' + (link ? '<a href="#" class="link-gold" id="reviewLink">Review changes</a>' : '') + '</div>'; };
    if (mode === 'error') return '<section class="insp-sec st-r" style="--i:9" aria-labelledby="gitH" id="gitSec">' + head(false) + '<div class="err-row" role="alert">' + icon('triangle-alert') + '<span>Could not read git status</span><button type="button" class="link-btn" id="retryGit" data-act="retry-git">Retry</button></div></section>';
    if (mode === 'partial') return '<section class="insp-sec st-r" style="--i:9" aria-labelledby="gitH" id="gitSec">' + head(false) + '<div class="git-row">' + icon('git-branch') + '<span class="br">feat/desktop-shell</span></div><p class="note" style="margin-top:6px">Changes for this session are not available. The branch is the workspace branch.</p></section>';
    return '<section class="insp-sec st-r" style="--i:9" aria-labelledby="gitH" id="gitSec">' + head(true) + '<div class="git-row">' + icon('git-branch') + '<span class="br">feat/desktop-shell</span><span class="df"><span class="a">+400</span><span class="d">−3</span></span></div></section>';
  }
  var EMPTY = {
    orch: '<div class="orch-top"><span class="dot" aria-hidden="true"></span><span class="orch-name">Orchestrator</span></div><div class="orch-sub muted">Opus 5.5 · idle</div><div class="ctx-row"><span class="muted" id="ctxLabel">Context</span><span class="muted">—</span></div><progress class="ctx-bar" value="0" max="100" aria-labelledby="ctxLabel" aria-valuetext="Context usage unavailable"></progress><dl class="stats"><div class="stat"><dt class="l">tokens</dt><dd class="v">0</dd></div><div class="stat"><dt class="l">cost</dt><dd class="v">$0.00</dd></div><div class="stat"><dt class="l">turns</dt><dd class="v">0</dd></div></dl>',
    agents: '<div class="sec-head"><h3 class="sec-label">Agents</h3><span class="sec-meta">none yet</span></div><div class="empty"><div class="ring">' + icon('bot', 'ico--16') + '</div><b>No agents yet</b>Sub-agents, CLI lanes and background commands appear here while the orchestrator delegates.</div>',
    todos: '<div class="sec-head"><h3 class="sec-label">Todos</h3><span class="sec-meta">none</span></div><div class="empty" style="padding:6px 0 4px;text-align:left">No todos for this session. The orchestrator lists its plan here.</div>',
    git: '<div class="sec-head"><h3 class="sec-label">Git</h3></div><div class="git-row muted">' + icon('git-branch') + '<span>Not a git repository</span></div>'
  };
  function renderInspector(focusSel) {
    var body = $('#inspBody'), b = state.body, keep = body.scrollTop, html = '';
    if (b === 'full' || b === 'error' || b === 'partial') {
      var p = b === 'partial';
      html = orchHTML(p) + agentsHTML(p) + todosHTML(p) + gitHTML(b === 'error' ? 'error' : p ? 'partial' : 'full');
    } else if (b === 'empty') {
      html = '<section class="insp-sec" aria-label="Orchestrator">' + EMPTY.orch + '</section><section class="insp-sec insp-sec--agents" aria-labelledby="agentsH">' + EMPTY.agents + '</section><section class="insp-sec">' + EMPTY.todos + '</section><section class="insp-sec">' + EMPTY.git + '</section>';
    } else {
      html = '<section class="insp-sec" aria-busy="true" aria-label="Loading orchestrator"><div class="sk" style="height:14px;width:45%;margin-bottom:8px"></div><div class="sk" style="height:10px;width:70%;margin-bottom:16px"></div><div class="sk" style="height:4px;width:100%;margin-bottom:16px"></div><div style="display:flex;gap:24px"><div class="sk" style="height:28px;width:56px"></div><div class="sk" style="height:28px;width:56px"></div><div class="sk" style="height:28px;width:56px"></div></div></section><section class="insp-sec insp-sec--agents" aria-busy="true" aria-label="Loading agents"><div class="sec-head"><h3 class="sec-label">Agents</h3></div>' + sk() + sk() + sk() + '</section><section class="insp-sec" aria-busy="true" aria-label="Loading todos and git"><div class="sk" style="height:10px;width:35%;margin-bottom:10px"></div><div class="sk" style="height:12px;width:75%;margin-bottom:8px"></div><div class="sk" style="height:12px;width:60%"></div></section>';
    }
    body.innerHTML = html;
    body.scrollTop = keep;
    if (focusSel) { var f = $(focusSel, body); if (f) f.focus({ preventScroll: false }); }
  }

  /* ---------------- shell-level mirrors of the same request list ---------------- */
  function renderNeeds() {
    var n = needCount(), chip = $('#needChip');
    chip.hidden = n === 0;
    chip.textContent = n + (n === 1 ? ' needs you' : ' need you');
    $('#needDot').hidden = !(state.insp === 'closed' && n > 0);
    var q = reqs.filter(function (r) { return r.kind === 'question' && !r.closed; })[0];
    var card = $('#qCard');
    card.hidden = !q || !live() || isDone();
    if (q) { $('#qTitle').textContent = ownerName(q.owner) + ' asks'; $('#qText').textContent = q.text; }
    $('#liveLabel').textContent = (n > 0 && state.t2 !== 'ref') ? 'Waiting for you' : 'Orchestrating';
  }
  function renderChips() {
    $$('.chip[data-agent]').forEach(function (c) {
      var a = AG.filter(function (x) { return x.id === c.dataset.agent; })[0]; if (!a) return;
      var s = statusOf(a), st = $('.st', c);
      st.textContent = s; st.className = 'st ' + WORD[s];
      c.setAttribute('aria-label', a.name + ', ' + (a.kind === 'Background' ? 'background command' : a.kind === 'CLI lane' ? 'CLI lane' : 'sub-agent') + ', ' + s + '. Open lane');
    });
  }
  function renderAll(focusSel) { renderInspector(focusSel); renderNeeds(); renderChips(); }

  /* ---------------- theme, turns, motion ---------------- */
  function sync() {
    var u = new URLSearchParams(location.search);
    Object.keys(state).forEach(function (k) { u.set(k, state[k]); });
    history.replaceState(null, '', '?' + u.toString());
    $$('.proto-bar [data-set]').forEach(function (b) {
      var kv = b.dataset.set.split('=');
      var cur = state[kv[0]];
      if (kv[0] === 'ask' && state.ask !== 'lane-open' && kv[1] === 'lane-open') cur = '';
      b.setAttribute('aria-pressed', String(cur === kv[1]));
    });
  }
  function setTheme() {
    var light = state.theme === 'light';
    document.documentElement.dataset.theme = light ? 'anubis-light' : 'anubis';
    document.documentElement.dataset.themeMode = light ? 'light' : 'dark';
  }
  function setOpen(turn, open) {
    var btn = $('.cs-worked', turn);
    turn.dataset.open = String(open);
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }
  function setT1() { setOpen($('#turn1'), state.t1 === 'expanded'); }
  function setT2() {
    var t = $('#turn2'), worked = $('#worked2'), ans = $('#answer2'), agents = $('.cs-agents', t), actions = $('.cs-actions', t);
    var s = state.t2;
    t.dataset.state = s === 'done' ? 'done' : 'live';
    t.dataset.phase = s;
    var hasLog = s !== 'ref';
    t.dataset.noLog = String(!hasLog);
    worked.hidden = !hasLog;
    $('#worked2label').textContent = s === 'done' ? 'Worked for 6m 48s' : 'Working · ' + fmt(timer);
    $('#worked2meta').textContent = s === 'done' ? '9 tools · 11 files' : '4 tools';
    ans.hidden = s === 'streaming';
    agents.hidden = s === 'streaming';
    actions.hidden = s !== 'done';
    setOpen(t, s === 'streaming');
    var caret = $('#streamText .caret'); if (caret) caret.hidden = s !== 'streaming';
    if (s === 'streaming') $$('#log2 .meta.s-run .ico').forEach(function (i) { i.classList.add('spin'); });
    if (s === 'answered' || s === 'done') { ans.classList.remove('enter-fade'); void ans.offsetWidth; ans.classList.add('enter-fade'); }
  }
  function setParity() {
    var on = state.parity === '1';
    document.body.dataset.parity = String(on);
    $$('.only-parity').forEach(function (el) { el.hidden = !on; });
  }
  function setWidth() { shell.dataset.width = state.width; applyModal(); }
  function replay() {
    shell.classList.remove('is-entering'); void shell.offsetWidth; shell.classList.add('is-entering');
    clearTimeout(replay.t); replay.t = setTimeout(function () { shell.classList.remove('is-entering'); }, 1000);
  }
  var timer = 127;
  setInterval(function () {
    if (state.t2 === 'done') return;
    timer++;
    $('#liveTimer').textContent = fmt(timer);
    if (state.t2 !== 'done') $('#worked2label').textContent = 'Working · ' + fmt(timer);
  }, 1000);

  /* ---------------- overlay inspector: focus entry, inert background, trap, return ---------------- */
  function overlayNow() { return state.insp === 'open' && shell.clientWidth < 960; }
  function applyModal() {
    var ov = overlayNow();
    main.inert = ov;
    if (ov) { insp.setAttribute('role', 'dialog'); insp.setAttribute('aria-modal', 'true'); $('#scrim').setAttribute('aria-hidden', 'true'); }
    else { insp.removeAttribute('role'); insp.removeAttribute('aria-modal'); }
  }
  function setInsp() {
    var open = state.insp === 'open';
    shell.dataset.inspector = open ? 'open' : 'closed';
    toggle.setAttribute('aria-pressed', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide session details' : 'Show session details');
    if (open) { insp.classList.remove('insp-in'); void insp.offsetWidth; insp.classList.add('insp-in'); }
    applyModal();
    renderNeeds();
  }
  function openInsp() {
    state.insp = 'open'; setInsp(); sync();
    if (overlayNow()) requestAnimationFrame(function () { $('#inspClose').focus(); }); // focus entry
  }
  function closeInsp(returnTo) {
    // Every close path (Esc, close button, scrim, action) lands here; focus never stays on a hidden element.
    ui.open = null; state.insp = 'closed'; renderInspector(); setInsp(); sync();
    (returnTo || toggle).focus();
  }
  function focusables(root) {
    return $$('a[href],button:not([disabled]),input:not([disabled]),textarea,select,[tabindex]:not([tabindex="-1"])', root).filter(function (el) {
      return el.getClientRects().length > 0 && !el.closest('[hidden]') && !el.closest('[inert]');
    });
  }
  function labelOf(el) { return (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 60); }

  /* ---------------- request actions ---------------- */
  function reqByKey(k) { return reqs.filter(function (r) { return r.key === k; })[0]; }
  function rowMain(owner) { return '.agent[data-agent="' + owner + '"] .agent__main'; }
  function decide(key, d) {
    var r = reqByKey(key); if (!r) return;
    ui.last[key] = d; ui.panel[key] = 'sending'; renderAll();
    var p = $('#panel-' + key.replace(/:/g, '-')); if (p) p.focus();
    setTimeout(function () {
      if (r.closed) { ui.panel[key] = 'idle'; renderAll(); return; }
      if (ui.fail) { ui.panel[key] = 'error'; renderAll(); var q = $('#panel-' + key.replace(/:/g, '-')); if (q) q.focus(); announce('Could not send your answer to ' + ownerName(r.owner) + '. The request is still waiting.'); return; }
      reqs = reqs.filter(function (x) { return x.key !== key; });
      ui.open = null; delete ui.panel[key];
      var next = reqs.filter(function (x) { return x.owner === r.owner && !x.closed; })[0];
      var verb = d === 'deny' ? 'Denied' : 'Allowed';
      renderAll(next ? '[data-act="review"][data-key="' + next.key + '"]' : (r.owner === 'orch' ? '.orch-top' : rowMain(r.owner)));
      var n = needCount();
      announce(verb + ' ' + r.cmd + '. ' + (n === 0 ? 'Nothing needs you.' : n + (n === 1 ? ' request needs you.' : ' requests need you.')));
    }, 520);
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-set]');
    if (t) {
      var kv = t.dataset.set.split('='); state[kv[0]] = kv[1];
      if (kv[0] === 'theme') setTheme();
      if (kv[0] === 't1') setT1();
      if (kv[0] === 't2') { setT2(); renderAll(); var s2 = $('#scroll'); s2.scrollTo({ top: s2.scrollHeight, behavior: 'smooth' }); }
      if (kv[0] === 'insp') setInsp();
      if (kv[0] === 'body') renderAll();
      if (kv[0] === 'width') setWidth();
      if (kv[0] === 'host') renderAll();
      if (kv[0] === 'parity') { setParity(); renderAll(); }
      if (kv[0] === 'ask') {
        reqs = mkReqs(state.ask); ui.panel = {}; ui.more = {}; ui.open = state.ask === 'lane-open' ? 'lane:gemini:r1' : null;
        renderAll();
      }
      sync(); return;
    }
    var a = e.target.closest('[data-act]');
    if (a) {
      var act = a.dataset.act, key = a.dataset.key;
      if (act === 'select') { ui.selected = a.dataset.agent; $$('#agentList .agent').forEach(function (o) { o.removeAttribute('aria-current'); }); a.closest('.agent').setAttribute('aria-current', 'true'); return; }
      if (act === 'review') {
        if (ui.open === key) { ui.open = null; renderAll('[data-act="review"][data-key="' + key + '"]'); }
        else { ui.open = key; renderAll(); var pn = $('#panel-' + key.replace(/:/g, '-')); if (pn) pn.focus(); }
        return;
      }
      if (act === 'decide') { decide(key, a.dataset.d); return; }
      if (act === 'retry') { decide(key, ui.last[key] || 'allow'); return; }
      if (act === 'dismiss') {
        var own = (reqByKey(key) || {}).owner;
        reqs = reqs.filter(function (x) { return x.key !== key; }); ui.open = null; delete ui.panel[key];
        renderAll(own === 'orch' ? '.orch-top' : rowMain(own)); announce('Closed.'); return;
      }
      if (act === 'more') { ui.more[a.dataset.owner] = !ui.more[a.dataset.owner]; renderAll('[data-act="more"][data-owner="' + a.dataset.owner + '"]'); return; }
      if (act === 'open-lane') { ui.selected = a.dataset.owner; ui.open = null; renderAll(rowMain(a.dataset.owner)); announce('Opened the ' + ownerName(a.dataset.owner) + ' lane.'); return; }
      if (act === 'usage') { ui.usage = !ui.usage; renderAll('[data-act="usage"]'); return; }
      if (act === 'retry-git') { state.body = 'full'; renderAll(); sync(); return; }
      if (act === 'answer') {
        var qc = $('#qCard'), first = $('input', qc);
        if (overlayNow()) { ui.open = null; state.insp = 'closed'; renderInspector(); setInsp(); sync(); }
        qc.scrollIntoView({ block: 'nearest' }); (first || qc).focus();
        return;
      }
    }
    var w = e.target.closest('.cs-worked');
    if (w && !w.closest('.cs-turn--cont')) { var turn = w.closest('.cs-turn'); setOpen(turn, turn.dataset.open !== 'true'); return; }
    var d = e.target.closest('.disc-btn:not([data-act]), .act-toggle, .log-item > .log-tool, .cs-turn--cont .cs-worked');
    if (d) {
      var ex = d.getAttribute('aria-expanded') !== 'true';
      d.setAttribute('aria-expanded', String(ex));
      var tg = document.getElementById(d.getAttribute('aria-controls')); if (tg) tg.hidden = !ex;
      var art = d.closest('.cs-turn--cont'); if (art) art.dataset.open = String(ex);
      return;
    }
    if (e.target.closest('#inspToggle')) { if (state.insp === 'open') closeInsp(toggle); else openInsp(); return; }
    if (e.target.closest('#inspClose')) { closeInsp(toggle); return; }
    if (e.target.closest('#scrim')) { closeInsp(toggle); return; }
    if (e.target.closest('#qSend')) {
      var qr = reqs.filter(function (r) { return r.kind === 'question'; })[0];
      if (qr) { reqs = reqs.filter(function (r) { return r !== qr; }); renderAll(); var n2 = needCount(); announce('Answer sent to ' + ownerName(qr.owner) + '. ' + (n2 === 0 ? 'Nothing needs you.' : n2 + ' still need you.')); $('#composer-input').focus(); }
      return;
    }
    if (e.target.closest('#replay')) { replay(); return; }
    if (e.target.closest('#failToggle')) { ui.fail = !ui.fail; e.target.closest('#failToggle').setAttribute('aria-pressed', String(ui.fail)); return; }
    if (e.target.closest('#laneEnds')) {
      reqs.forEach(function (r) { if (ui.open === r.key) r.closed = true; });
      reqs = reqs.filter(function (r) { return r.closed; });
      var op = ui.open; renderAll(op ? '#panel-' + op.replace(/:/g, '-') : null);
      announce(op ? 'The request is no longer pending.' : 'Nothing needs you.'); return;
    }
    if (e.target.closest('#reduce')) { var on = document.body.dataset.reduce !== 'true'; document.body.dataset.reduce = String(on); e.target.closest('#reduce').setAttribute('aria-pressed', String(on)); return; }
    if (e.target.closest('#checkFocus')) { runChecks(); return; }
    if (e.target.closest('#reviewLink')) e.preventDefault();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      // innermost layer first: an open request panel closes before the sheet does
      if (ui.open && insp.contains(document.activeElement)) { var k = ui.open; ui.open = null; renderAll('[data-act="review"][data-key="' + k + '"]'); return; }
      if (overlayNow()) { e.preventDefault(); closeInsp(toggle); }
      return;
    }
    if (e.key === 'Tab' && overlayNow()) {
      var f = focusables(insp); if (!f.length) return;
      var firstEl = f[0], lastEl = f[f.length - 1];
      if (!insp.contains(document.activeElement)) { e.preventDefault(); firstEl.focus(); return; }
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    }
  });
  if (window.ResizeObserver) new ResizeObserver(function () { applyModal(); }).observe(shell);

  /* ---------------- in-page focus-path check (button "Check focus paths") ---------------- */
  function raf() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
  function runChecks() {
    var out = $('#checkOut'), lines = [], prev = { width: state.width, insp: state.insp, ask: state.ask }; out.hidden = false;
    function ok(c, m) { lines.push((c ? 'PASS  ' : 'FAIL  ') + m); }
    (async function () {
      state.width = 'sidebar'; setWidth(); state.insp = 'closed'; setInsp(); await raf();
      ok(shell.clientWidth < 960, 'overlay mode active (shell ' + shell.clientWidth + ' px < 960)');
      var paths = ['Esc', 'Close button', 'Scrim click', 'Answer action'];
      for (var i = 0; i < paths.length; i++) {
        if (paths[i] === 'Answer action') { state.ask = 'question'; reqs = mkReqs('question'); renderAll(); }
        toggle.focus(); toggle.click(); await raf();
        ok(state.insp === 'open', paths[i] + ': sheet opens from the toggle');
        ok(document.activeElement === $('#inspClose'), paths[i] + ': focus enters the sheet (close button)');
        ok(main.inert === true && insp.getAttribute('aria-modal') === 'true', paths[i] + ': background inert, sheet is aria-modal');
        if (i === 0) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        if (i === 1) $('#inspClose').click();
        if (i === 2) $('#scrim').click();
        if (i === 3) $('[data-act="answer"]').click();
        await raf();
        ok(state.insp === 'closed' && main.inert === false, paths[i] + ': sheet closed, background live again');
        var want = i === 3 ? $('#qCard input') : toggle;
        ok(document.activeElement === want, paths[i] + ': focus returns to ' + (i === 3 ? 'the question card' : 'the toggle') + ' (now: ' + labelOf(document.activeElement) + ')');
      }
      state.ask = 'multi'; reqs = mkReqs('multi'); renderAll(); state.insp = 'closed'; setInsp(); toggle.focus(); toggle.click(); await raf();
      lines.push('Tab order in the sheet (' + focusables(insp).length + ' stops): ' + focusables(insp).map(labelOf).join(' > '));
      lines.push('Focusable outside the sheet while open: ' + focusables(main).length + ' (main is inert)');
      closeInsp(toggle);
      state.width = prev.width; state.insp = prev.insp; state.ask = prev.ask; reqs = mkReqs(prev.ask); setWidth(); setInsp(); renderAll(); sync();
      out.textContent = lines.join('\n'); window.__focusCheck = lines;
    })();
  }
  window.__runFocusChecks = runChecks;

  /* ---------------- init ---------------- */
  document.body.dataset.bare = P.get('bare') === '1' ? 'true' : 'false';
  if (P.get('reduce') === '1') { document.body.dataset.reduce = 'true'; $('#reduce').setAttribute('aria-pressed', 'true'); }
  if (ui.fail) $('#failToggle').setAttribute('aria-pressed', 'true');
  if (state.ask === 'lane-open') ui.open = 'lane:gemini:r1';
  setTheme(); setT1(); setT2(); setParity(); shell.dataset.width = state.width; renderAll(); setInsp(); sync();
  var sc = $('#scroll'); sc.scrollTop = sc.scrollHeight; // pin to the newest content like the product
  if (P.get('replay') !== '0') replay(); else shell.classList.remove('is-entering');
})();
