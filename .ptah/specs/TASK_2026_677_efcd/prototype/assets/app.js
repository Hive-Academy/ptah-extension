/* Prototype behaviour only. Mock data, no network. State lives in the query string so every screenshot is a URL.
   Params (round 2: fail=card is an alias of qcard=missing): theme=dark|light  t1=collapsed|expanded  t2=ref|streaming|answered|done  insp=open|closed
           body=full|partial|empty|loading|error  width=wide|sidebar  ask=lane|lane-open|multi|question|none
           host=electron|rail  parity=0|1  fail=1  bare=1  reduce=1  replay=0|1  sel=1
   Round 1 additions: request routing (Review / Answer / +N more, success / error / closed), overlay focus
   management (entry, inert background, trap, return on every close path), partial / unknown section states.
   Round 2 additions: lane=<id> (lane view in the main area), qcard=present|missing (question-card failure + Retry),
   automatic close on docked->overlay resize and on session switch, live line bound to the shared needs-you count. */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var shell = $('#shell'), main = $('#mainRegion'), insp = $('#inspector'), toggle = $('#inspToggle');
  var P = new URLSearchParams(location.search);
  var state = {
    theme: P.get('theme') === 'light' ? 'light' : 'dark',
    t1: P.get('t1') || 'collapsed', t2: P.get('t2') || 'ref', insp: P.get('insp') || 'open',
    body: P.get('body') || 'full', task: P.get('task') || 'linked', width: P.get('width') || 'wide',
    ask: P.get('ask') || 'lane', host: P.get('host') || 'rail', parity: P.get('parity') || '0',
    lane: P.get('host') === 'electron' ? '' : (P.get('lane') || ''), qcard: (P.get('qcard') === 'missing' || P.get('fail') === 'card') ? 'missing' : 'present'
  };
  var qCardEl = $('#qCard');
  var ui = { taskMore: false, taskDocs: false, taskOpenErr: null, taskLive: false, taskBusy: false, open: null, more: {}, usage: true, panel: {}, last: {}, selected: P.get('sel') === '1' ? 'arch' : null, fail: P.get('fail') === '1', qerr: {}, opener: null };

  /* ---------------- mock data ---------------- */
  /* Delta 2: sub-agents carry a lucide role icon (role), CLI lanes a provider mark (mark = sprite id m-<id>, today's lane types only),
     the orchestrator carries the SESSION provider mark with the gold hairline, but ONLY when an authoritative session provider id exists.
     The frontend has no such field today (design-spec architect check 1), so the neutral lucide `Workflow` glyph is the explicit fallback
     (PM-14, requirement 18.5): never a guessed vendor mark, never `Bot`, never a monogram. This mock DECLARES a Claude session
     (sessionProvider 'claude-cli', default) so the Claude mark may show; `?prov=unknown` shows the unknown-provider neutral glyph state. */
  var SESSION_PROVIDER = P.get('prov') === 'unknown' ? null : 'claude-cli'; // mock declaration: authoritative provider id, or null = unknown
  var PROVIDER_MARK = { 'claude-cli': 'claude' }; // provider id -> sprite mark id (m-<id>); an id without artwork is treated as unknown
  var AG = [
    { id: 'fe', name: 'frontend-developer', kind: 'Sub-agent', group: 'sub', role: 'layout-template', status: 'running', dur: '2m 13s', act: 'Read session-context.token.ts' },
    { id: 'codex', name: 'Codex', kind: 'CLI lane', group: 'cli', mark: 'codex', status: 'running', dur: '1m 50s', act: 'Fixing a failing assertion' },
    { id: 'antigravity', name: 'Antigravity', kind: 'CLI lane', group: 'cli', mark: 'antigravity', status: 'running', dur: '33s', act: 'Running npx nx lint chat' },
    { id: 'bg', name: 'nx test chat', kind: 'Background', group: 'bg', role: 'square-terminal', status: 'running', dur: '1m 51s', act: 'npx nx test chat --parallel=1' },
    { id: 'arch', name: 'software-architect', kind: 'Sub-agent', group: 'sub', role: 'drafting-compass', status: 'done', dur: '2m 41s', act: 'Wrote implementation-plan.md' }
  ];
  var ORCH = { id: 'orch', name: 'Orchestrator', kind: 'Orchestrator', group: 'main', sessionProvider: SESSION_PROVIDER, mark: (SESSION_PROVIDER && PROVIDER_MARK[SESSION_PROVIDER]) || null, status: 'running', dur: '6m 05s', act: 'Delegating to 4 agents' };
  var TODOS = [
    ['done', 'Map current shell and stores'], ['done', 'Write implementation plan'], ['run', 'Build desktop shell behind a flag'],
    ['run', 'Session Inspector panel'], ['pending', 'Settings toggle and e2e smoke test']
  ];
  function mkReqs(kind) {
    var g1 = { key: 'lane:antigravity:r1', kind: 'permission', owner: 'antigravity', tool: 'Bash', cmd: 'npx nx lint chat' };
    var g2 = { key: 'lane:antigravity:r2', kind: 'permission', owner: 'antigravity', tool: 'Bash', cmd: 'git diff --stat origin/main...HEAD' };
    var g3 = { key: 'lane:antigravity:r3', kind: 'permission', owner: 'antigravity', tool: 'Write', cmd: 'apps/ptah-electron/src/renderer/app.html' };
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
      var qe = ui.qerr[r.key], qid = r.key.replace(/:/g, '-');
      return '<div class="req">' + icon('message-circle-question-mark', 'ico--12') +
        '<span class="txt"><b>Asked you:</b> ' + esc(t) + '</span>' +
        '<button type="button" class="btn-sm" data-act="answer" data-key="' + r.key + '"' + (qe === 'err' ? ' aria-describedby="qerr-' + qid + '"' : '') + ' aria-label="Answer question from ' + esc(who) + ': ' + esc(r.text) + '">Answer</button></div>' +
        (qe === 'wait' ? '<p class="req-msg" role="status">Opening the question...</p>' : '') +
        (qe === 'err' ? '<p class="req-msg req-msg--err" id="qerr-' + qid + '" role="alert" tabindex="-1">' + icon('triangle-alert', 'ico--12') + '<span>Could not find the question in the conversation. The request is still waiting.</span><button type="button" class="link-btn" data-act="retry-answer" data-key="' + r.key + '">Retry</button></p>' : '');
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
    var st = done ? 'idle · ready for the next turn' : orchReq ? 'needs you' : (active('antigravity').length || active('codex').length ? 'waiting on 4 agents' : 'working · 4 agents running');
    var h = '<section class="insp-sec st-r" style="--i:1" aria-label="Orchestrator">' +
      '<div class="orch-top" tabindex="-1"><span class="' + dot + '" aria-hidden="true"></span><span class="orch-name">Orchestrator</span></div>' +
      '<div class="orch-sub muted"><span id="orchState">' + st + '</span></div>' + reqHTML('orch');
    return h + '</section>';
  }
  function agentsHTML(partial) {
    var rows = AG.slice().sort(function (a, b) {
      var rank = function (x) { var s = statusOf(x); return s === 'waiting' ? 0 : s === 'done' ? 2 : 1; };
      return rank(a) - rank(b);
    });
    var act = rows.filter(function (a) { return statusOf(a) !== 'done'; }).length, fin = rows.length - act;
    var h = '<section class="insp-sec insp-sec--agents st-r" style="--i:2" aria-labelledby="agentsH"' + (partial ? ' data-partial="true"' : '') + '>' +
      '<div class="sec-head"><h3 class="sec-label" id="agentsH">Agents</h3><span class="sec-meta">' + act + ' active · ' + fin + ' finished' + (partial ? ' · <span title="Restored session: some durations and activity are not stored">partial</span>' : '') + '</span></div>' + D3.trayLine(rows, statusOf) +
      '<ul class="agent-list" id="agentList">';
    rows.forEach(function (a, i) {
      var s = statusOf(a), dur = (partial && (a.kind === 'Sub-agent' || a.id === 'codex')) ? '' : a.dur;
      var actLine = (partial && a.id !== 'bg') ? '' : (s === 'waiting' && active(a.id).length ? '' : a.act);
      var label = a.name + ', ' + a.kind.toLowerCase().replace('cli lane', 'CLI lane') + ', ' + s + (dur ? ' ' + words(dur) : '') + '.' + (actLine ? ' ' + actLine : '');
      // delta 2 tile: avatar 32 (status ring + corner glyph) | line 1 name + status word + duration | line 2 kind badge + activity
      h += '<li class="agent' + (s === 'done' ? ' agent--finished' : '') + (D3.hasMenu(a.id) ? ' agent--menu' : '') + ' st-r" style="--i:' + (i + 3) + '" data-agent="' + a.id + '"' + (ui.selected === a.id ? ' aria-current="true"' : '') + '>' +
        '<button type="button" class="agent__main" data-act="select" data-agent="' + a.id + '" aria-label="' + esc(label) + '">' + av(a, 32, s) +
        '<span class="agent__body"><span class="agent__l1"><span class="agent__name" title="' + esc(a.name) + '">' + esc(a.name) + '</span>' +
        '<span class="agent__stat"><span class="w ' + WORD[s] + '">' + s + '</span>' + (dur ? ' <span class="t">' + dur + '</span>' : '') + '</span></span>' +
        '<span class="agent__l2"><span class="kind">' + a.kind + '</span>' + (actLine ? '<span class="agent__act">' + esc(actLine) + '</span>' : '') + '</span></span></button>' + D3.menuBtn(a) + D3.steerRow(a) + reqHTML(a.id) + '</li>';
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

  /* ---------------- TASK section (design-spec 4.6, decisions D27-D33). Param: task=linked|multi|live|loading|error|partial|notfound|openfail|none ---------------- */
  var TASK_LABEL = { backlog: 'Backlog', in_progress: 'In Progress', in_review: 'In Review', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' };
  var TASK_INK = { backlog: 'muted', in_progress: 's-run', in_review: 's-need', blocked: 's-err', done: 's-done', cancelled: 'muted' };
  var STAGE_LADDER = [['Requirements', ['task-description.md']], ['Design', ['design-spec.md', 'visual-design-specification.md', 'design-handoff.md']], ['Plan', ['implementation-plan.md']],
    ['Build', ['batches.md', 'tasks.md']], ['Review', ['code-style-review.md', 'code-logic-review.md', 'visual-review.md']], ['Test', ['test-report.md']]];
  function taskStage(files) { var s = ''; STAGE_LADDER.forEach(function (st) { if (st[1].some(function (f) { return files.indexOf(f) >= 0; })) s = st[0]; }); return s; } /* furthest present step; '' = not derivable -> row omitted (D31) */
  var TASKS = {
    lead: { id: 'TASK_2026_677_efcd', title: 'Clean session view', status: 'in_progress',
      files: ['task.md', 'task-description.md', 'design-spec.md', 'parity-inventory.md', 'decisions.md', 'design-spec-review-r1.md', 'task-description-review-r1.md', 'handoff-1.md', 'handoff-2.md'] },
    related: [{ id: 'TASK_2026_671_a3f1', title: 'Canvas board rail details', status: 'in_review' }, { id: 'TASK_2026_664_09bc', title: 'Queue persistence', status: 'done' }]
  };
  var DOCS_AT_REST = 6;
  function tpill(s) { return '<span class="task-pill ' + TASK_INK[s] + '">' + TASK_LABEL[s] + '</span>'; }
  function taskSec(inner, extra) { return '<section class="insp-sec st-r" style="--i:7" aria-labelledby="taskH" id="taskSec"' + (extra || '') + '><div class="sec-head"><h3 class="sec-label" id="taskH">Task</h3></div>' + inner + '</section>'; }
  function taskIdRow(id) { return '<div class="task-id">' + icon('folder-kanban') + '<code>' + id + '</code></div>'; }
  function taskHTML() {
    var m = state.task;
    if (m === 'none') return ''; /* D27: no linked task (or link unresolved) -> section not rendered at all */
    var L = TASKS.lead;
    if (m === 'loading') return taskSec('<div role="status" aria-label="Loading task"><div class="sk" style="height:12px;width:160px;margin-bottom:8px"></div><div class="sk" style="height:16px;width:224px;margin-bottom:8px"></div><div class="sk" style="height:20px;width:96px;margin-bottom:12px"></div><div class="sk" style="height:24px;margin-bottom:4px"></div><div class="sk" style="height:24px"></div></div>', ' aria-busy="true"');
    if (m === 'error') return taskSec(taskIdRow(L.id) + '<div class="err-row" role="alert">' + icon('triangle-alert') + '<span>Could not load the task</span><button type="button" class="retry" data-act="task-retry" aria-label="Retry loading task"' + (ui.taskBusy ? ' aria-busy="true"' : '') + '>' + (ui.taskBusy ? icon('loader-circle', 'ico--12 spin') : '') + 'Retry</button></div>');
    if (m === 'notfound') return taskSec(taskIdRow(L.id) + '<p class="task-muted">Task folder not found</p>');
    var status = (m === 'live' && ui.taskLive) ? 'in_review' : L.status;
    var files = m === 'partial' ? [] : L.files, stage = taskStage(files);
    var h = taskIdRow(L.id) + '<h4 class="task-title" id="taskTitle" tabindex="-1" title="' + esc(L.title) + '">' + esc(L.title) + '</h4>';
    h += '<div class="task-line3"><span id="taskStat">' + tpill(status) + '</span>' + (stage ? '<span class="task-stage" title="Derived from the documents in the task folder">Stage: ' + stage + '</span>' : '') + '</div>';
    h += '<p class="task-doclabel">Documents</p>';
    if (m === 'partial') h += '<p class="task-muted" role="status">No documents yet</p>';
    else {
      var shown = ui.taskDocs ? files : files.slice(0, DOCS_AT_REST), extra = files.length - DOCS_AT_REST;
      h += '<ul class="task-files" aria-label="Task documents">';
      shown.forEach(function (f) { h += '<li><button type="button" class="task-file" data-act="task-open" data-file="' + f + '" aria-label="Open ' + f + '">' + icon('file-text', 'ico--12') + '<span class="task-file__n" title="' + f + '">' + f + '</span>' + icon('external-link', 'ico--12 task-file__x') + '</button></li>'; });
      h += '</ul>';
      if (extra > 0) h += '<button type="button" class="task-more" data-act="task-more" aria-expanded="' + !!ui.taskDocs + '" aria-label="' + (ui.taskDocs ? 'Show fewer documents' : 'Show ' + extra + ' more documents') + '">' + (ui.taskDocs ? 'Show fewer documents' : '+' + extra + ' more documents') + '</button>';
    }
    if (m === 'multi') {
      var n = TASKS.related.length;
      h += '<button type="button" class="task-more" data-act="task-rel" aria-expanded="' + !!ui.taskMore + '" aria-controls="taskOthers" aria-label="' + (ui.taskMore ? 'Hide related tasks' : 'Show ' + n + ' related tasks') + '">' + (ui.taskMore ? 'Hide related tasks' : '+' + n + ' related tasks') + '</button>';
      h += '<ul class="task-others" id="taskOthers"' + (ui.taskMore ? '' : ' hidden') + ' aria-label="Related tasks">';
      TASKS.related.forEach(function (o) { h += '<li class="task-other"><code>' + o.id + '</code><div class="task-other__t"><span class="task-other__n" title="' + esc(o.title) + '">' + esc(o.title) + '</span>' + tpill(o.status) + '</div></li>'; }); /* non-interactive on purpose (D30) */
      h += '</ul>';
    }
    if (ui.taskOpenErr) h += '<div class="err-row task-openerr" role="alert">' + icon('triangle-alert') + '<span>Could not open ' + ui.taskOpenErr + '</span><button type="button" class="retry" data-act="task-open-retry">Retry</button></div>';
    return taskSec(h);
  }
  function taskRetry() {
    ui.taskBusy = true; renderInspector('.retry');
    setTimeout(function () { ui.taskBusy = false; state.task = 'linked'; renderInspector('#taskTitle'); sync(); }, 700);
  }
  function taskFlip() { /* mock of the tasks:changed push: the pill updates in place after 2 s, silently (D32: no announcement, no animation) */
    clearTimeout(taskFlip.t); ui.taskLive = false;
    if (state.task !== 'live') return;
    taskFlip.t = setTimeout(function () { ui.taskLive = true; var s = $('#taskStat'); if (s) s.innerHTML = tpill('in_review'); }, 2000);
  }
  function taskProtoHint(name) { /* PROTOTYPE DEVICE ONLY: the product shows no toast (4.6); the editor opens the file */
    var old = $('#taskToast'); if (old) old.remove();
    var d = document.createElement('div'); d.id = 'taskToast'; d.className = 'proto-out task-proto-hint'; d.setAttribute('aria-hidden', 'true');
    d.textContent = 'Prototype only: the editor opens ' + name + ' here. The product shows nothing in the chat (no toast, no announcement).';
    document.body.appendChild(d); clearTimeout(taskProtoHint.t); taskProtoHint.t = setTimeout(function () { d.remove(); }, 3200);
  }
  function gitHTML(mode) {
    var head = function (link) { return '<div class="sec-head"><h3 class="sec-label" id="gitH">Git</h3>' + (link ? '<a href="#" class="link-gold" id="reviewLink">Review changes</a>' : '') + '</div>'; };
    if (mode === 'error') return '<section class="insp-sec st-r" style="--i:9" aria-labelledby="gitH" id="gitSec">' + head(false) + '<div class="err-row" role="alert">' + icon('triangle-alert') + '<span>Could not read git status</span><button type="button" class="link-btn" id="retryGit" data-act="retry-git">Retry</button></div></section>';
    if (mode === 'partial') return '<section class="insp-sec st-r" style="--i:9" aria-labelledby="gitH" id="gitSec">' + head(false) + '<div class="git-row">' + icon('git-branch') + '<span class="br">feat/desktop-shell</span></div><p class="note" style="margin-top:6px">Changes for this session are not available. The branch is the workspace branch.</p></section>';
    return '<section class="insp-sec st-r" style="--i:9" aria-labelledby="gitH" id="gitSec">' + head(true) + '<div class="git-row">' + icon('git-branch') + '<span class="br">feat/desktop-shell</span><span class="df"><span class="a">+400</span><span class="d">−3</span></span></div></section>';
  }
  var EMPTY = {
    orch: '<div class="orch-top"><span class="dot" aria-hidden="true"></span><span class="orch-name">Orchestrator</span></div><div class="orch-sub muted">idle</div>',
    agents: '<div class="sec-head"><h3 class="sec-label">Agents</h3><span class="sec-meta">none yet</span></div><div class="empty"><div class="ring">' + icon('bot', 'ico--16') + '</div><b>No agents yet</b>Sub-agents, CLI lanes and background commands appear here while the orchestrator delegates.</div>',
    todos: '<div class="sec-head"><h3 class="sec-label">Todos</h3><span class="sec-meta">none</span></div><div class="empty" style="padding:6px 0 4px;text-align:left">No todos for this session. The orchestrator lists its plan here.</div>',
    git: '<div class="sec-head"><h3 class="sec-label">Git</h3></div><div class="git-row muted">' + icon('git-branch') + '<span>Not a git repository</span></div>'
  };
  function renderInspector(focusSel) {
    var body = $('#inspBody'), b = state.body, keep = body.scrollTop, html = '';
    if (b === 'full' || b === 'error' || b === 'partial') {
      var p = b === 'partial';
      html = orchHTML(p) + D3.sessionHTML(b) + agentsHTML(p) + D3.planHTML(b) + D3.laneHTML(b) + taskHTML() + todosHTML(p) + gitHTML(b === 'error' ? 'error' : p ? 'partial' : 'full');
    } else if (b === 'empty') {
      html = '<section class="insp-sec" aria-label="Orchestrator">' + EMPTY.orch + '</section>' + D3.sessionHTML('empty') + '<section class="insp-sec insp-sec--agents" aria-labelledby="agentsH">' + EMPTY.agents + '</section><section class="insp-sec">' + EMPTY.todos + '</section><section class="insp-sec">' + EMPTY.git + '</section>';
    } else {
      html = D3.sessionHTML('loading') + '<section class="insp-sec" aria-busy="true" aria-label="Loading orchestrator"><div class="sk" style="height:14px;width:45%;margin-bottom:8px"></div><div class="sk" style="height:10px;width:70%;margin-bottom:16px"></div><div class="sk" style="height:4px;width:100%;margin-bottom:16px"></div><div style="display:flex;gap:24px"><div class="sk" style="height:28px;width:56px"></div><div class="sk" style="height:28px;width:56px"></div><div class="sk" style="height:28px;width:56px"></div></div></section><section class="insp-sec insp-sec--agents" aria-busy="true" aria-label="Loading agents"><div class="sec-head"><h3 class="sec-label">Agents</h3></div>' + sk() + sk() + sk() + '</section><section class="insp-sec" aria-busy="true" aria-label="Loading todos and git"><div class="sk" style="height:10px;width:35%;margin-bottom:10px"></div><div class="sk" style="height:12px;width:75%;margin-bottom:8px"></div><div class="sk" style="height:12px;width:60%"></div></section>';
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
    D3.syncToggle(n, state.insp === 'open', state.body);
    var q = reqs.filter(function (r) { return r.kind === 'question' && !r.closed; })[0];
    var card = $('#qCard');
    if (card) card.hidden = !q || !live() || isDone();
    if (q && card) { $('#qTitle').textContent = ownerName(q.owner) + ' asks'; $('#qText').textContent = q.text; }
    $('#liveLabel').textContent = n > 0 ? 'Waiting for you' : 'Orchestrating'; // same aggregate as the header count, in every state
  }
  function renderChips() {
    $$('.chip[data-agent]').forEach(function (c) {
      var a = AG.filter(function (x) { return x.id === c.dataset.agent; })[0]; if (!a) return;
      var s = statusOf(a), st = $('.st', c);
      st.textContent = s; st.className = 'st ' + WORD[s];
      c.setAttribute('aria-label', a.name + ', ' + (a.kind === 'Background' ? 'background command' : a.kind === 'CLI lane' ? 'CLI lane' : 'sub-agent') + ', ' + s + (state.host === 'electron' ? '.' : '. Open lane'));
    });
  }
  /* ---------------- lane view (main area) ---------------- */
  var LANE_LOG = {
    fe: [['Read', 'session-context.token.ts'], ['Edit', 'session-context.token.ts'], ['Read', 'chat-view.component.ts']],
    codex: [['Bash', 'npx nx test chat --parallel=1'], ['Edit', 'chat-view.component.spec.ts']],
    antigravity: [['Bash', 'npx nx lint chat'], ['Read', 'libs/frontend/chat/eslint.config.mjs']],
    bg: [['Bash', 'npx nx test chat --parallel=1']],
    arch: [['Read', 'design-spec.md'], ['Write', 'implementation-plan.md']]
  };
  function agentById(id) { return AG.filter(function (a) { return a.id === id; })[0]; }
  function renderLane() {
    var a = agentById(state.lane), on = !!a && state.host !== 'electron';
    main.dataset.view = on ? 'lane' : 'session';
    $('#laneView').hidden = !on;
    if (!on) return;
    var s = statusOf(a), pend = active(a.id)[0];
    $('#laneTitle').textContent = a.name;
    $('#laneKind').textContent = a.kind;
    $('#laneStat').innerHTML = '<span class="w ' + WORD[s] + '">' + s + '</span>' + (a.dur ? ' <span class="muted tnum">· ' + a.dur + '</span>' : '');
    var h = '<p class="lane-note">Mock transcript. The product reuses the existing lane view here.</p>';
    (LANE_LOG[a.id] || []).forEach(function (l) { h += '<div class="lane-line">' + icon('terminal', 'ico--12') + '<span class="who">' + l[0] + '</span><code>' + esc(l[1]) + '</code></div>'; });
    if (pend) h += '<div class="lane-wait" role="status">' + icon('shield-alert', 'ico--12') + '<span><b>Needs permission:</b> <code>' + esc(pend.cmd || pend.text) + '</code>. Answer it in This session.</span></div>';
    $('#laneBody').innerHTML = h;
  }
  /* ---------------- avatar (delta 2): circle tile + status ring + corner glyph ---------------- */
  var RING = { running: 'run', waiting: 'need', done: 'done', failed: 'err', stopped: 'idle' };
  var GLYPH = { run: 'loader-circle', need: 'hand', done: 'check', err: 'circle-alert', idle: 'circle-pause' };
  function lu(name, cls) { return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#d-' + name + '"/></svg>'; }
  function avInner(a) {
    if (a.mark) return '<svg class="mk"' + (a.mark === 'codex' ? ' data-departure="codex-brand-mark"' : '') + ' viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#m-' + a.mark + '"/></svg>';
    if (a.id === 'orch') return lu('workflow', 'ic'); // unknown session provider: neutral orchestrator glyph (lucide Workflow), never a vendor mark or Bot
    return lu(a.role || 'bot', 'ic'); // sub-agent role icon; Bot is the default for any other type
  }
  function av(a, size, s) {
    var st = RING[s || statusOf(a)], W = size + 8, c = W / 2, r = W / 2 - 1.5;
    var ring = '<svg class="av__ring" viewBox="0 0 ' + W + ' ' + W + '" aria-hidden="true" focusable="false">' +
      ['trk', 'halo', 'arc'].map(function (k) { return '<circle class="' + k + '" cx="' + c + '" cy="' + c + '" r="' + r + '" pathLength="100"/>'; }).join('') + '</svg>';
    var badge = '<span class="av__badge" aria-hidden="true">' + lu(GLYPH[st], 'i') + '</span>';
    return '<span class="av av--' + size + ' ast-' + st + (a.group === 'main' ? ' av--main' : '') + (a.group === 'bg' ? ' av--bgcmd' : '') + '"><span class="av__tile">' + avInner(a) + '</span>' + ring + badge + '</span>';
  }

  /* ---------------- agent dock (delta 2, option B): the main-view switch ---------------- */
  var DK = { open: false, focusKey: null, focusPop: false };
  var DK_GROUPS = [{ id: 'main', label: 'Orchestrator' }, { id: 'sub', label: 'Sub-agents' }, { id: 'cli', label: 'CLI lanes' }, { id: 'bg', label: 'Background' }];
  function dockAgents() {
    return [ORCH].concat(DK_GROUPS.slice(1).reduce(function (o, g) { return o.concat(AG.filter(function (a) { return a.group === g.id; })); }, []));
  }
  function dockSel() { return state.lane || 'orch'; }
  function dockLabel(a, s) {
    return a.name + ', ' + (a.kind === 'Background' ? 'background command' : a.kind.toLowerCase().replace('cli lane', 'CLI lane')) + ', ' + s + (a.dur ? ' ' + words(a.dur) : '') + (s === 'waiting' ? '. Click to view and answer' : '. Click to view');
  }
  function dockActivity(a, s) { var p = active(a.id)[0]; return s === 'waiting' && p ? 'Needs permission: ' + (p.cmd || p.text) : a.act; }
  function dockPrio(a, sel) { var s = statusOf(a); return a.id === 'orch' ? 0 : a.id === sel ? 1 : s === 'waiting' ? 2 : s === 'failed' ? 3 : s === 'running' ? 4 : 5; }
  function dockWorst(list) {
    return list.filter(function (a) { return statusOf(a) === 'waiting'; })[0] || list.filter(function (a) { return statusOf(a) === 'failed'; })[0] || null;
  }
  function dockPop(list, sel) {
    var h = '';
    DK_GROUPS.forEach(function (g) {
      var items = list.filter(function (a) { return a.group === g.id; }); if (!items.length) return;
      h += '<div role="group" aria-labelledby="dkg-' + g.id + '"><div class="dk-pop__g"><span class="dk-glbl" id="dkg-' + g.id + '">' + g.label + '</span><span class="dk-cnt">' + items.length + '</span></div>';
      items.forEach(function (a) {
        var s = statusOf(a);
        h += '<button type="button" role="menuitemradio" class="dk-pop__row" data-pick="' + a.id + '" aria-checked="' + (a.id === sel) + '" tabindex="-1">' + av(a, 24, s) +
          '<span class="dk-pop__name">' + esc(a.name) + '</span><span class="dk-pop__meta"><span class="w ' + WORD[s] + '">' + s + '</span><span class="dk-d tnum">' + a.dur + '</span></span></button>';
      });
      h += '</div>';
    });
    return h;
  }
  function dockHTML(list, sel) {
    var h = '<div class="dk-row"><div class="dk-dock" role="tablist" aria-label="Agent threads">';
    var prev = null;
    list.forEach(function (a) {
      var s = statusOf(a), on = a.id === sel, tid = 'dk-tip-' + a.id;
      if (prev && prev !== a.group) h += '<span class="dk-div" aria-hidden="true" data-g="' + a.group + '"></span>';
      prev = a.group;
      h += '<span class="dk-item" data-ik="' + a.id + '"><button type="button" role="tab" class="dk-chip" data-dk="' + a.id + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" aria-label="' + esc(dockLabel(a, s)) + '" aria-describedby="' + tid + '">' +
        av(a, 28, s) + (on ? '<span class="dk-chip__txt"><b>' + esc(a.name) + '</b><small><span class="w ' + WORD[s] + '">' + s + '</span> <span class="dk-d tnum">' + a.dur + '</span></small></span>' : '') + '</button>' +
        '<span class="dk-tip" id="' + tid + '" role="tooltip"><span class="dk-tip__card"><span class="dk-tip__top">' + av(a, 32, s) + '<span class="dk-tip__id"><b>' + esc(a.name) + '</b><span class="kind">' + a.kind + '</span></span></span>' +
        '<span class="dk-tip__st"><span class="w ' + WORD[s] + '">' + s + '</span><span class="dk-d tnum">' + a.dur + '</span></span><span class="dk-tip__act">' + esc(dockActivity(a, s)) + '</span>' +
        '<span class="dk-tip__cta">' + (on ? 'Viewing this thread' : lu('mouse-pointer-click', 'i') + ' Click to view this thread') + '</span></span></span></span>';
    });
    h += '</div><button type="button" class="dk-all" data-dk-toggle aria-haspopup="menu" aria-expanded="' + DK.open + '" aria-controls="dk-pop"><span class="dk-pile"></span><span class="dk-all__t">' + list.length + ' agents</span><span class="dk-cnt dk-all__n">' + list.length + '</span>' + lu('chevron-right', 'i') + '</button></div>';
    h += '<div class="dk-pop" id="dk-pop" role="menu" aria-label="All agents"' + (DK.open ? '' : ' hidden') + '>' + dockPop(list, sel) + '<div class="dk-pop__foot">Arrow keys move, Enter views, Esc closes</div></div>';
    return h;
  }
  /* Overflow (strict priority): orchestrator, selected, waiting (the "needs you" priority), failed, running, rest. The rest go behind "N agents". */
  function dockFit(bar, list, sel) {
    var dock = $('.dk-dock', bar), btn = $('.dk-all', bar);
    var items = $$('.dk-item', dock), divs = $$('.dk-div', dock);
    items.concat(divs).forEach(function (e) { e.hidden = false; });
    var avail = dock.clientWidth - 6, w = {}, total = 0, shown = {}, used = 0, gu = {}, stop = false;
    items.forEach(function (i) { w[i.dataset.ik] = i.getBoundingClientRect().width + 4; total += w[i.dataset.ik]; });
    total += divs.length * 15;
    var order = list.slice().sort(function (a, b) { return dockPrio(a, sel) - dockPrio(b, sel) || list.indexOf(a) - list.indexOf(b); });
    if (total <= avail) list.forEach(function (a) { shown[a.id] = true; });
    else order.forEach(function (a) {
      var dd = (!gu[a.group] && a.group !== 'main') ? 15 : 0;
      if ((!stop && used + w[a.id] + dd <= avail) || a.id === 'orch' || a.id === sel) { shown[a.id] = true; used += w[a.id] + dd; gu[a.group] = true; } else stop = true;
    });
    function apply() {
      items.forEach(function (i) { i.hidden = !shown[i.dataset.ik]; });
      gu = {}; list.forEach(function (a) { if (shown[a.id]) gu[a.group] = true; });
      divs.forEach(function (d) { d.hidden = !gu[d.dataset.g]; });
    }
    apply();
    for (var guard = 20; guard-- > 0;) { // verify against the real layout (fonts, gaps): drop the lowest priority until nothing is clipped
      var vis = [].slice.call(dock.children).filter(function (c) { return !c.hidden; }), last = vis[vis.length - 1];
      if (!last || last.getBoundingClientRect().right <= dock.getBoundingClientRect().right + 0.5) break;
      var drop = order.slice().reverse().filter(function (a) { return shown[a.id] && a.id !== 'orch' && a.id !== sel; })[0];
      if (!drop) break; shown[drop.id] = false; apply();
    }
    var hid = list.filter(function (a) { return !shown[a.id]; }), wst = dockWorst(hid);
    $('.dk-pile', btn).innerHTML = hid.length ? hid.slice(0, 3).map(function (a) { return av(a, 20); }).join('') : lu('users', 'i');
    var dr = dock.getBoundingClientRect();
    items.forEach(function (i) { if (!i.hidden) { var r = i.getBoundingClientRect(); i.classList.toggle('tip-r', r.left + r.width / 2 - dr.left > (dr.width + btn.getBoundingClientRect().width) * 0.5); } });
    btn.setAttribute('aria-label', list.length + ' agents' + (hid.length ? ', ' + hid.length + ' not shown' : '') + (wst ? (statusOf(wst) === 'waiting' ? ', one waiting, needs you' : ', one failed') : '') + '. Open list');
    if (wst) { var pip = document.createElement('span'); pip.className = 'dk-pip ast-' + RING[statusOf(wst)]; pip.setAttribute('aria-hidden', 'true'); btn.appendChild(pip); }
    var pop = $('.dk-pop', bar), br = bar.getBoundingClientRect(), ar = btn.getBoundingClientRect(), pw = Math.min(380, br.width - 16);
    pop.style.width = pw + 'px'; pop.style.left = Math.max(8, Math.min(ar.right - br.left - pw, br.width - pw - 8)) + 'px';
  }
  function renderDock() {
    var bar = $('#dock'), on = state.host !== 'electron' && live();
    bar.hidden = !on; if (!on) { DK.open = false; return; }
    var fe = bar.contains(document.activeElement) ? document.activeElement : null;
    var keep = fe && (fe.dataset.dk ? 'k:' + fe.dataset.dk : fe.hasAttribute('data-dk-toggle') ? 't' : fe.dataset.pick ? 'p:' + fe.dataset.pick : null);
    var list = dockAgents(), sel = dockSel();
    bar.innerHTML = dockHTML(list, sel);
    dockFit(bar, list, sel);
    var f = null;
    if (DK.focusKey) f = $('[data-dk="' + DK.focusKey + '"]:not([hidden])', bar) || $('.dk-all', bar);
    else if (DK.focusPop) f = $('.dk-pop [aria-checked="true"]', bar) || $('.dk-pop [role="menuitemradio"]', bar);
    else if (keep) f = keep === 't' ? $('.dk-all', bar) : keep.indexOf('k:') === 0 ? ($('[data-dk="' + keep.slice(2) + '"]', bar) || $('.dk-all', bar)) : $('[data-pick="' + keep.slice(2) + '"]', bar);
    DK.focusKey = null; DK.focusPop = false;
    if (f && !f.closest('[hidden]')) f.focus({ preventScroll: true });
  }
  function dockSelect(id) { // automatic activation: switching a thread is cheap
    DK.focusKey = id; DK.open = false;
    if (id === 'orch') { if (state.lane) { state.lane = ''; renderAll(); sync(); } else renderDock(); }
    else openLane(id, { dock: true });
  }
  function dockToggle(open, refocus) {
    DK.open = open; DK.focusPop = open && refocus !== false;
    renderDock();
    if (!open && refocus) { var t = $('.dk-all', $('#dock')); if (t) t.focus({ preventScroll: true }); }
  }
  (function dockEvents() {
    var bar = $('#dock');
    bar.addEventListener('click', function (e) {
      var pick = e.target.closest('[data-pick]');
      if (pick) { dockSelect(pick.dataset.pick); return; }
      if (e.target.closest('[data-dk-toggle]')) { dockToggle(!DK.open, true); return; }
      var chip = e.target.closest('[data-dk]'); if (chip) dockSelect(chip.dataset.dk);
    });
    bar.addEventListener('keydown', function (e) {
      var tab = e.target.closest('[role="tab"]');
      if (tab) {
        var tabs = $$('[role="tab"]', bar).filter(function (t) { return !t.closest('[hidden]'); }), i = tabs.indexOf(tab), n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length]; else if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') n = tabs[0]; else if (e.key === 'End') n = tabs[tabs.length - 1];
        else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); dockToggle(true, true); return; }
        if (n) { e.preventDefault(); dockSelect(n.dataset.dk); }
        return;
      }
      var row = e.target.closest('[role="menuitemradio"]');
      if (row) {
        var rows = $$('[role="menuitemradio"]', bar), ri = rows.indexOf(row), nx = null;
        if (e.key === 'ArrowDown') nx = rows[(ri + 1) % rows.length]; else if (e.key === 'ArrowUp') nx = rows[(ri - 1 + rows.length) % rows.length];
        else if (e.key === 'Home') nx = rows[0]; else if (e.key === 'End') nx = rows[rows.length - 1];
        if (nx) { e.preventDefault(); nx.focus(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dockToggle(false, true); return; }
        if (e.key === 'Tab') { DK.open = false; $('.dk-pop', bar).hidden = true; $('.dk-all', bar).setAttribute('aria-expanded', 'false'); }
      }
    });
    bar.addEventListener('focusout', function (e) { var it = e.target.closest('.dk-item'); if (it) it.classList.remove('is-dismissed'); });
    bar.addEventListener('pointerout', function (e) { var it = e.target.closest('.dk-item'); if (it && !it.contains(e.relatedTarget) && !it.matches(':focus-within')) it.classList.remove('is-dismissed'); });
    // Hover card: Esc dismisses it (WCAG 1.4.13) while it is visible, before any other Esc handler sees the key.
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || DK.open) return;
      var shownTip = $$('.dk-item', bar).filter(function (it) { return getComputedStyle($('.dk-tip', it)).visibility === 'visible'; })[0];
      if (shownTip) { shownTip.classList.add('is-dismissed'); e.stopPropagation(); }
    }, true);
    document.addEventListener('click', function (e) { if (DK.open && e.composedPath().indexOf(bar) < 0) { DK.open = false; renderDock(); } }); // composedPath: the clicked node may already be re-rendered
    if (window.ResizeObserver) new ResizeObserver(function () { if (bar.__w !== bar.clientWidth) { bar.__w = bar.clientWidth; renderDock(); } }).observe(bar);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { renderDock(); });
  })();

  function renderAll(focusSel) { renderInspector(focusSel); renderNeeds(); renderChips(); renderLane(); renderDock(); }
  D3.rerender = function (sel) { renderAll(sel); };

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
  function visible(el) { return !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[hidden]'); }
  function openInsp() {
    ui.opener = (document.activeElement && document.activeElement !== document.body) ? document.activeElement : toggle;
    state.insp = 'open'; setInsp(); sync();
    if (overlayNow()) requestAnimationFrame(function () { $('#inspClose').focus(); }); // focus entry
  }
  function closeInsp(returnTo) {
    // Every close path (Esc, close button, scrim, action) lands here; focus never stays on a hidden element.
    ui.open = null; state.insp = 'closed'; renderInspector(); setInsp(); sync();
    (returnTo || toggle).focus();
  }
  // Automatic closes (resize into overlay width, session switch) use the same routine as every other path. Focus goes to the
  // opener when it is still connected and visible, else to the session title (spec 8.3 path 6). A session switch always
  // lands on the title because the old opener belongs to the previous session.
  function autoClose(reason) {
    if (state.insp !== 'open') return false;
    closeInsp(reason === 'resize' && visible(ui.opener) ? ui.opener : $('#sessTitle'));
    return true;
  }
  var band = null;
  function bandCheck() {
    var ov = shell.clientWidth < 960;
    if (band === null) { band = ov; applyModal(); return; }
    var toOverlay = ov && !band; band = ov;
    if (toOverlay && autoClose('resize')) return;
    applyModal();
  }
  function switchSession() {
    ui.open = null; ui.more = {}; ui.panel = {}; ui.qerr = {}; ui.selected = null; state.lane = '';
    autoClose('switch'); renderAll(); replay(); sync();
  }
  function openLane(id, o) {
    var a = agentById(id); if (!a || state.host === 'electron') return;
    if (o && o.dock) { state.lane = id; ui.selected = id; ui.open = null; renderAll(); sync(); return; } // from the dock: focus stays on the tab
    state.lane = id; ui.selected = id; ui.open = null; renderLane();
    var title = $('#laneTitle');
    if (overlayNow()) closeInsp(title); // common close routine; focus lands on the lane title
    else { renderAll(); title.focus(); sync(); }
    raf().then(function () { if (document.activeElement === title) announce('Opened the ' + a.name + ' lane.'); });
  }
  function leaveLane() { state.lane = ''; renderAll(); $('#sessTitle').focus(); sync(); }
  function answerFlow(key) {
    var r = reqByKey(key); if (!r) return;
    var t0 = Date.now(), btn = '[data-act="answer"][data-key="' + key + '"]';
    function done(card) {
      if (!card) {
        ui.qerr[key] = 'err'; renderAll(btn); // request and count stay; focus returns to that row's Answer button (described by the error)
        return;
      }
      delete ui.qerr[key];
      if (state.lane) { state.lane = ''; renderLane(); }
      var first = $('input', card);
      if (overlayNow()) { ui.open = null; state.insp = 'closed'; renderAll(); setInsp(); sync(); } else renderAll();
      card.scrollIntoView({ block: 'nearest' }); (first || card).focus();
    }
    if ($('#qCard')) { done($('#qCard')); return; }
    ui.qerr[key] = 'wait'; renderAll(btn);
    (function poll() {
      var c = $('#qCard');
      if (c || Date.now() - t0 >= 1000) done(c); else setTimeout(poll, 100);
    })();
  }
  function applyQCard() {
    var has = !!$('#qCard');
    if (state.qcard === 'missing' && has) qCardEl.remove();
    else if (state.qcard !== 'missing' && !has) main.insertBefore(qCardEl, $('.cs-composer-wrap'));
    renderNeeds();
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
      if (kv[0] === 'task') { ui.taskMore = false; ui.taskDocs = false; ui.taskBusy = false; ui.taskOpenErr = null; ui.taskOpenFixed = false; renderInspector(); taskFlip(); }
      if (kv[0] === 'width') setWidth();
      if (kv[0] === 'host' || kv[0] === 'lane') { if (state.host === 'electron') state.lane = ''; renderAll(); }
      if (kv[0] === 'qcard') applyQCard();
      if (kv[0] === 'parity') { setParity(); renderAll(); }
      if (kv[0] === 'ask') {
        reqs = mkReqs(state.ask); ui.panel = {}; ui.more = {}; ui.open = state.ask === 'lane-open' ? 'lane:antigravity:r1' : null;
        renderAll();
      }
      sync(); return;
    }
    var a = e.target.closest('[data-act]');
    if (a) {
      var act = a.dataset.act, key = a.dataset.key;
      if (act === 'task-open') { var fn = a.dataset.file; if (state.task === 'openfail' && !ui.taskOpenFixed) { ui.taskOpenErr = fn; renderInspector('[data-file="' + fn + '"]'); } else taskProtoHint(fn); return; }
      if (act === 'task-open-retry') { var ff = ui.taskOpenErr; ui.taskOpenFixed = true; ui.taskOpenErr = null; renderInspector('[data-file="' + ff + '"]'); taskProtoHint(ff); return; }
      if (act === 'task-more') { ui.taskDocs = !ui.taskDocs; renderInspector('[data-act=task-more]'); return; }
      if (act === 'task-rel') { ui.taskMore = !ui.taskMore; renderInspector('[data-act=task-rel]'); return; }
      if (act === 'task-retry') { taskRetry(); return; }
      if (act === 'select') {
        if (state.host === 'rail') { openLane(a.dataset.agent); return; }
        // Electron single chat view: no lane surface, so a row only marks the selection
        ui.selected = a.dataset.agent; $$('#agentList .agent').forEach(function (o) { o.removeAttribute('aria-current'); }); a.closest('.agent').setAttribute('aria-current', 'true'); return;
      }
      if (act === 'lane-back') { leaveLane(); return; }
      if (act === 'retry-answer') { delete ui.qerr[key]; answerFlow(key); return; }
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
      if (act === 'open-lane') { openLane(a.dataset.owner); return; }
      if (act === 'usage') { ui.usage = !ui.usage; renderAll('[data-act="usage"]'); return; }
      if (act === 'retry-git') { state.body = 'full'; renderAll(); sync(); return; }
      if (act === 'answer') { answerFlow(key); return; }
    }
    var chip = e.target.closest('.chip[data-agent]');
    if (chip) { if (state.host === 'rail') openLane(chip.dataset.agent); return; }
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
    if (e.target.closest('#replay')) { switchSession(); return; }
    if (e.target.closest('#qRestore')) { state.qcard = 'present'; applyQCard(); sync(); announce('Question card mounted.'); return; }
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
  if (window.ResizeObserver) new ResizeObserver(bandCheck).observe(shell);

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
  if (state.ask === 'lane-open') ui.open = 'lane:antigravity:r1';
  if (state.qcard === 'missing') qCardEl.remove();
  setTheme(); setT1(); setT2(); setParity(); shell.dataset.width = state.width; renderAll(); setInsp(); sync();
  taskFlip();
  var sc = $('#scroll'); sc.scrollTop = sc.scrollHeight; // pin to the newest content like the product
  if (P.get('replay') !== '0') replay(); else shell.classList.remove('is-entering');
})();
