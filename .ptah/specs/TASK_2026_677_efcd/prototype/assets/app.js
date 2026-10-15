/* Prototype behaviour only. Mock data, no network. State lives in the query string so every screenshot is a URL.
   Params: theme=dark|light  t1=collapsed|expanded  t2=ref|streaming|answered|done  insp=open|closed
           body=full|empty|loading|error  width=wide|sidebar  bare=1  reduce=1  replay=1 */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var shell = $('#shell');
  var P = new URLSearchParams(location.search);
  var state = {
    theme: P.get('theme') === 'light' ? 'light' : 'dark',
    t1: P.get('t1') || 'collapsed', t2: P.get('t2') || 'ref', insp: P.get('insp') || 'open',
    body: P.get('body') || 'full', width: P.get('width') || 'wide'
  };
  var inspHTML = $('#inspBody').innerHTML; // populated markup kept for restore
  var origTxt = new Map();

  function sync() {
    var u = new URLSearchParams(location.search);
    Object.keys(state).forEach(function (k) { u.set(k, state[k]); });
    history.replaceState(null, '', '?' + u.toString());
    $$('.proto-bar [data-set]').forEach(function (b) {
      var kv = b.dataset.set.split('=');
      b.setAttribute('aria-pressed', String(state[kv[0]] === kv[1]));
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

  function fmt(s) { var m = Math.floor(s / 60), r = s % 60; return m + 'm ' + (r < 10 ? '0' : '') + r + 's'; }

  function setT1() {
    setOpen($('#turn1'), state.t1 === 'expanded');
  }

  function applyDoneTexts(done) {
    var scope = [shell];
    scope.forEach(function (root) {
      $$('.chip .st, #agentList .w', root).forEach(function (el) {
        if (!origTxt.has(el)) origTxt.set(el, { t: el.textContent, c: el.className });
        var o = origTxt.get(el);
        if (done) { el.textContent = 'done'; el.className = o.c.replace(/s-(run|need|done|err|idle)/, 's-done'); }
        else { el.textContent = o.t; el.className = o.c; }
      });
    });
    var od = $('.orch-top .dot'); if (od) od.className = (done || state.body === 'empty') ? 'dot' : 'dot dot--run';
    var perm = $('.agent__perm'); if (perm) perm.hidden = done;
    $('#needChip').hidden = done || state.body === 'empty';
    updateDot();
    if ($('#orchState')) $('#orchState').textContent = done ? 'idle · ready for the next turn' : 'waiting on 4 agents';
    var meta = $('#agentsMeta'); if (meta) meta.textContent = done ? '5 finished' : '4 active · 1 finished';
  }

  function setT2() {
    var t = $('#turn2'), worked = $('#worked2'), ans = $('#answer2'), agents = $('.cs-agents', t), actions = $('.cs-actions', t);
    var s = state.t2;
    t.dataset.state = s === 'done' ? 'done' : 'live';
    t.dataset.phase = s;
    var hasLog = s !== 'ref';
    t.dataset.noLog = String(!hasLog);
    worked.hidden = !hasLog;
    $('#worked2label').textContent = s === 'done' ? 'Worked for 6m 48s' : 'Working · ' + fmt(timer);
    ans.hidden = s === 'streaming';
    agents.hidden = s === 'streaming';
    actions.hidden = s !== 'done';
    $('#liveLabel').textContent = s === 'streaming' ? 'Orchestrating' : 'Orchestrating';
    setOpen(t, s === 'streaming');
    var caret = $('#streamText .caret'); if (caret) caret.hidden = s !== 'streaming';
    applyDoneTexts(s === 'done');
    if (s === 'streaming') {
      $$('#log2 .meta.s-run .ico').forEach(function (i) { i.classList.add('spin'); });
    }
    if (s === 'answered' || s === 'done') { ans.classList.remove('enter-fade'); void ans.offsetWidth; ans.classList.add('enter-fade'); }
  }

  function updateDot() {
    var need = state.insp === 'closed' && !$('#needChip').hidden;
    $('#needDot').hidden = !need;
  }

  function setInsp() {
    var open = state.insp === 'open';
    shell.dataset.inspector = open ? 'open' : 'closed';
    var b = $('#inspToggle');
    b.setAttribute('aria-pressed', String(open));
    b.setAttribute('aria-label', open ? 'Hide session details' : 'Show session details');
    if (open) { var ins = $('#inspector'); ins.classList.remove('insp-in'); void ins.offsetWidth; ins.classList.add('insp-in'); }
    updateDot();
  }

  var EMPTY = {
    orch: '<div class="orch-top"><span class="dot" aria-hidden="true"></span><span class="orch-name">Orchestrator</span></div><div class="orch-sub muted">Opus 5.5 · idle</div><div class="ctx-row"><span class="muted" id="ctxLabel">Context</span><span class="muted">—</span></div><progress class="ctx-bar" value="0" max="100" aria-labelledby="ctxLabel" aria-valuetext="Context usage unavailable"></progress><dl class="stats" style="margin-bottom:0"><div class="stat"><dt class="l">tokens</dt><dd class="v">0</dd></div><div class="stat"><dt class="l">cost</dt><dd class="v">$0.00</dd></div><div class="stat"><dt class="l">turns</dt><dd class="v">0</dd></div></dl>',
    agents: '<div class="sec-head"><h3 class="sec-label">Agents</h3><span class="sec-meta">none yet</span></div><div class="empty"><div class="ring"><svg class="ico ico--16" aria-hidden="true"><use href="#i-bot"/></svg></div><b>No agents yet</b>Sub-agents, CLI lanes and background commands appear here while the orchestrator delegates.</div>',
    todos: '<div class="sec-head"><h3 class="sec-label">Todos</h3><span class="sec-meta">none</span></div><div class="empty" style="padding:6px 0 4px;text-align:left">No todos for this session. The orchestrator lists its plan here.</div>',
    git: '<div class="sec-head"><h3 class="sec-label">Git</h3></div><div class="git-row muted"><svg class="ico" aria-hidden="true"><use href="#i-git-branch"/></svg><span>Not a git repository</span></div>'
  };
  function sk() { return '<div class="sk-row"><div class="sk" style="height:12px;width:55%"></div><div class="sk" style="height:10px;width:80%"></div></div>'; }

  function setBody() {
    var body = $('#inspBody'), b = state.body;
    if (b === 'full' || b === 'error') {
      body.innerHTML = inspHTML;
      bindAgents();
      if (b === 'error') {
        $('#gitSec').innerHTML = '<div class="sec-head"><h3 class="sec-label">Git</h3></div><div class="err-row" role="alert"><svg class="ico" aria-hidden="true"><use href="#i-triangle-alert"/></svg><span>Could not read git status</span><button type="button" id="retryGit">Retry</button></div>';
      }
    } else if (b === 'empty') {
      body.innerHTML = '<section class="insp-sec" aria-label="Orchestrator">' + EMPTY.orch + '</section><section class="insp-sec insp-sec--agents" aria-labelledby="agentsH">' + EMPTY.agents + '</section><section class="insp-sec">' + EMPTY.todos + '</section><section class="insp-sec">' + EMPTY.git + '</section>';
    } else {
      body.innerHTML = '<section class="insp-sec" aria-busy="true" aria-label="Loading orchestrator"><div class="sk" style="height:14px;width:45%;margin-bottom:8px"></div><div class="sk" style="height:10px;width:70%;margin-bottom:16px"></div><div class="sk" style="height:4px;width:100%;margin-bottom:16px"></div><div style="display:flex;gap:24px"><div class="sk" style="height:28px;width:56px"></div><div class="sk" style="height:28px;width:56px"></div><div class="sk" style="height:28px;width:56px"></div></div></section><section class="insp-sec insp-sec--agents" aria-busy="true" aria-label="Loading agents"><div class="sec-head"><h3 class="sec-label">Agents</h3></div>' + sk() + sk() + sk() + '</section><section class="insp-sec" aria-busy="true"><div class="sk" style="height:10px;width:35%;margin-bottom:10px"></div><div class="sk" style="height:12px;width:75%;margin-bottom:8px"></div><div class="sk" style="height:12px;width:60%"></div></section>';
    }
    $('#needChip').hidden = b === 'empty' || state.t2 === 'done';
    applyDoneTexts(state.t2 === 'done');
    updateDot();
  }

  function bindAgents() {
    $$('#agentList .agent').forEach(function (li) {
      var btn = $('.agent__main', li);
      btn.addEventListener('click', function () {
        $$('#agentList .agent').forEach(function (o) { o.removeAttribute('aria-current'); });
        li.setAttribute('aria-current', 'true');
      });
    });
    if (P.get('sel') === '1') { var a = $('#agentArchitect'); if (a) { a.setAttribute('aria-current', 'true'); } }
    var rv = $('#reviewLink'); if (rv) rv.addEventListener('click', function (e) { e.preventDefault(); });
  }

  function setWidth() { shell.dataset.width = state.width; }

  function replay() {
    shell.classList.remove('is-entering'); void shell.offsetWidth; shell.classList.add('is-entering');
    clearTimeout(replay.t); replay.t = setTimeout(function () { shell.classList.remove('is-entering'); }, 1000);
  }

  // timers
  var timer = 127;
  setInterval(function () {
    if (state.t2 === 'done') return;
    timer++;
    var s = fmt(timer);
    $('#liveTimer').textContent = s;
    if (state.t2 !== 'done') $('#worked2label').textContent = 'Working · ' + s;
  }, 1000);

  // events
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-set]');
    if (t) {
      var kv = t.dataset.set.split('='); state[kv[0]] = kv[1];
      if (kv[0] === 'theme') setTheme();
      if (kv[0] === 't1') setT1();
      if (kv[0] === 't2') { setT2(); setBody(); var s2 = $('#scroll'); s2.scrollTo({ top: s2.scrollHeight, behavior: 'smooth' }); }
      if (kv[0] === 'insp') setInsp();
      if (kv[0] === 'body') setBody();
      if (kv[0] === 'width') setWidth();
      sync(); return;
    }
    var w = e.target.closest('.cs-worked');
    if (w) { var turn = w.closest('.cs-turn'); setOpen(turn, turn.dataset.open !== 'true'); return; }
    if (e.target.closest('#inspToggle')) { state.insp = state.insp === 'open' ? 'closed' : 'open'; setInsp(); sync(); return; }
    if (e.target.closest('#inspClose') || e.target.closest('#scrim')) { state.insp = 'closed'; setInsp(); sync(); return; }
    if (e.target.closest('#replay')) { replay(); return; }
    if (e.target.closest('#reduce')) { var on = document.body.dataset.reduce !== 'true'; document.body.dataset.reduce = String(on); e.target.closest('#reduce').setAttribute('aria-pressed', String(on)); return; }
    if (e.target.closest('#retryGit')) { state.body = 'full'; setBody(); sync(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.insp === 'open' && shell.getBoundingClientRect().width < 960) { state.insp = 'closed'; setInsp(); sync(); $('#inspToggle').focus(); }
  });

  document.body.dataset.bare = P.get('bare') === '1' ? 'true' : 'false';
  if (P.get('reduce') === '1') { document.body.dataset.reduce = 'true'; $('#reduce').setAttribute('aria-pressed', 'true'); }
  setTheme(); setT1(); setWidth(); bindAgents(); setBody(); setT2(); setInsp(); sync();
  var sc = $('#scroll'); sc.scrollTop = sc.scrollHeight; // pin to the newest content like the product
  if (P.get('replay') !== '0') replay(); else shell.classList.remove('is-entering');
})();
