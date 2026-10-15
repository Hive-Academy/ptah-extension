/*
 * Orchestra Canvas — mission-control prototypes.
 *
 * One simulated event store feeds every page. It models the split proposed for
 * the real canvas:
 *   - onRaw():    every stream event (token deltas, tool calls). Only LIVE views
 *                 subscribe, so the cost scales with the number of live views.
 *   - onSample(): dirty session ids, flushed every SAMPLE_MS. Cards, rails,
 *                 inspector and attention queue subscribe here.
 */
(function () {
  'use strict';

  const SAMPLE_MS = 500;
  const TICK_MS = 60;

  const TOOL_LINES = [
    ['Read', 'session-context.token.ts'],
    ['Read', 'canvas-tile.component.ts'],
    ['Edit', 'canvas-workspace-grid.component.ts'],
    ['Grep', 'SESSION_VISIBLE'],
    ['Bash', 'npx nx test chat --maxWorkers=2'],
    ['Edit', 'chat-transcript.component.ts'],
    ['Write', 'implementation-plan.md'],
    ['Read', 'canvas.store.ts'],
    ['Bash', 'npx nx lint canvas'],
    ['Edit', 'tile-agent-indicator.component.ts'],
    ['Read', 'rpc.types.ts'],
    ['Edit', 'session-summary.selector.ts'],
    ['Bash', 'git diff --stat'],
    ['Read', 'render-window.ts'],
  ];
  const PERMISSION_CMDS = [
    'npx nx lint chat',
    'npx nx test canvas --maxWorkers=2',
    'git push origin feat/desktop-shell',
    'npm install @floating-ui/dom',
    'rm -rf tmp/replay-cache',
  ];
  const TASKS = {
    sub: ['Implement batch 2 of the plan', 'Write specs for the sampler', 'Review the selector for stale state', 'Design the inspector contract'],
    cli: ['Fix the failing assertion in canvas.store.spec.ts', 'Lint and fix the chat lib', 'Port the router handlers', 'Draft the migration'],
    bg: ['jest · watch the changed specs', 'tsc · typecheck the project'],
  };
  const ERRORS = [
    'jest: 3 failed, 209 passed — canvas.store.spec.ts',
    'tsc: TS2345 in session-summary.selector.ts:41',
    'Codex lane exited with code 1',
  ];
  const PROSE = (
    'The summary selector reads the events that the store already holds, so the card needs no extra stream. ' +
    'I moved the agent roster into a computed signal and sampled it at two hertz. ' +
    'The focused tile keeps the full transcript and the render window limits it to eighteen messages. ' +
    'Next I will wire the attention queue to the permission events and add a spec for the sampler. ' +
    'The lint target passes. Two specs still fail because the fixture uses the old tile height. '
  ).split(' ');

  const SEEDS = [
    { title: 'Desktop shell redesign', branch: 'feat/desktop-shell', model: 'Opus 5.5',
      agents: [['software-architect', 'sub', 'done'], ['frontend-developer', 'sub'], ['Codex', 'cli'], ['Gemini', 'cli'], ['nx test chat', 'bg']],
      todos: ['Map current shell and stores', 'Write implementation plan', 'Build desktop shell behind a flag', 'Session inspector panel', 'Settings toggle and e2e smoke test'], doneTodos: 2,
      permission: { agent: 'Gemini', cmd: 'npx nx lint chat' } },
    { title: 'Canvas summary selector', branch: 'perf/canvas-cards', model: 'Opus 5.5',
      agents: [['backend-developer', 'sub'], ['senior-tester', 'sub'], ['Codex', 'cli'], ['Cursor', 'cli'], ['code-logic-reviewer', 'sub'], ['code-style-reviewer', 'sub'], ['nx typecheck chat', 'bg']],
      todos: ['Selector contract', 'Sampler', 'Unmount card tiles', 'Specs'], doneTodos: 1 },
    { title: 'License server — Paddle webhooks', branch: 'fix/paddle-retry', model: 'Sonnet 5.5',
      agents: [['backend-developer', 'sub'], ['Codex', 'cli'], ['nx test license-server', 'bg']],
      todos: ['Reproduce duplicate event', 'Idempotency key', 'Regression test'], doneTodos: 1 },
    { title: 'Docs — CLI quick start', branch: 'docs/cli-quickstart', model: 'Haiku 5.5',
      agents: [['technical-content-writer', 'sub', 'done'], ['Gemini', 'cli', 'done']],
      todos: ['Outline', 'Draft', 'Fact-check'], doneTodos: 3, finished: true },
    { title: 'Tribunal — router split', branch: 'refactor/cli-router', model: 'Opus 5.5',
      agents: [['software-architect', 'sub'], ['Codex', 'cli'], ['Gemini', 'cli'], ['Cursor', 'cli'], ['Claude', 'cli']],
      todos: ['Inventory handlers', 'Split by domain', 'Judge attempts', 'Merge winner'], doneTodos: 2 },
    { title: 'Telegram gateway voice', branch: 'feat/tg-voice', model: 'Sonnet 5.5',
      agents: [['backend-developer', 'sub'], ['nx test messaging', 'bg']],
      todos: ['Download pipeline', 'Transcribe', 'Reply'], doneTodos: 0,
      error: 'jest: 3 failed, 209 passed — voice.service.spec.ts' },
    { title: 'Landing hero 3D', branch: 'feat/hero-scene', model: 'Opus 5.5',
      agents: [['frontend-developer', 'sub'], ['ui-ux-designer', 'sub', 'done']],
      todos: ['Scene spec', 'Build scene', 'Perf pass'], doneTodos: 1 },
    { title: 'Prisma 7 migration', branch: 'chore/prisma-7', model: 'Sonnet 5.5',
      agents: [['devops-engineer', 'sub'], ['Codex', 'cli']],
      todos: ['Bump', 'Migrate', 'Verify'], doneTodos: 2 },
    { title: 'Webview a11y sweep', branch: 'fix/a11y-focus', model: 'Haiku 5.5',
      agents: [['visual-reviewer', 'sub', 'done'], ['frontend-developer', 'sub', 'done']],
      todos: ['Audit', 'Fix focus rings'], doneTodos: 2, finished: true },
  ];

  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);

  function makeSession(seed, i) {
    const now = Date.now();
    const agents = seed.agents.map(([name, kind, status], j) => {
      const t = rnd(TOOL_LINES);
      const startedAt = now - rand(20, 260) * 1000;
      return {
        id: `s${i + 1}-a${j}`, name, kind, status: status || 'running',
        line: status === 'done' ? `Wrote ${t[1]}` : `${t[0]} ${t[1]}`,
        startedAt, endedAt: status === 'done' ? startedAt + rand(60, 180) * 1000 : null,
        task: rnd(TASKS[kind]),
        log: seedLog(),
      };
    });
    const s = {
      id: `s${i + 1}`, title: seed.title, branch: seed.branch, model: seed.model,
      tokens: Math.round(rand(18, 140) * 1000), cost: 0, turns: Math.round(rand(3, 14)),
      startedAt: now - rand(120, 900) * 1000,
      todos: seed.todos.map((text, k) => ({ text, done: k < seed.doneTodos, active: k === seed.doneTodos })),
      agents, permission: null, error: seed.error || null, finished: !!seed.finished,
      git: { add: Math.round(rand(10, 420)), del: Math.round(rand(0, 60)), ahead: Math.round(rand(0, 4)) },
      stream: '', wordIx: Math.floor(rand(0, PROSE.length)), state: 'running',
      prompt: rnd([
        'Build the change behind a flag. Plan first, then hand the batches to the team.',
        'Find the root cause and add a regression test. Keep the public API.',
        'Split this file by responsibility. Behaviour must not change.',
      ]),
    };
    s.cost = s.tokens * 0.0000225;
    if (seed.permission) {
      const a = agents.find((x) => x.name === seed.permission.agent);
      a.status = 'waiting';
      s.permission = { agentId: a.id, agent: a.name, cmd: seed.permission.cmd, at: now };
    }
    if (s.error) {
      const a = agents.find((x) => x.status === 'running');
      if (a) { a.status = 'error'; a.line = 'Exited with failures'; }
    }
    for (let k = 0; k < 60; k++) s.stream += nextWord(s);
    deriveState(s);
    return s;
  }

  /** A few past entries so a lane tab is not empty when it opens. */
  function seedLog() {
    const log = [];
    for (let k = 0; k < 6; k++) {
      const [verb, file] = rnd(TOOL_LINES);
      log.push({ t: 'tool', verb, file });
      log.push({ t: 'text', text: PROSE.slice(Math.floor(rand(0, PROSE.length - 14))).slice(0, 12).join(' ') + ' ' });
    }
    return log;
  }

  function pushLog(a, entry) {
    const last = a.log[a.log.length - 1];
    if (entry.t === 'text' && last && last.t === 'text' && last.text.length < 400) last.text += entry.text;
    else a.log.push(entry);
    if (a.log.length > 150) a.log.splice(0, a.log.length - 150);
  }

  function nextWord(s) {
    s.wordIx = (s.wordIx + 1) % PROSE.length;
    return PROSE[s.wordIx] + ' ';
  }

  function deriveState(s) {
    if (s.permission) s.state = 'needs';
    else if (s.error) s.state = 'error';
    else if (s.finished || !s.agents.some((a) => a.status === 'running' || a.status === 'waiting')) {
      s.state = 'done';
      s.finished = true;
    } else s.state = 'running';
  }

  const STATE_RANK = { needs: 0, error: 1, running: 2, done: 3 };

  function createStore({ count = 6 } = {}) {
    // Counts above SEEDS.length wrap around with a numbered title (prototype-only, up to 12).
    const sessions = Array.from({ length: count }, (_, i) => {
      const seed = SEEDS[i % SEEDS.length];
      return makeSession(i < SEEDS.length ? seed : { ...seed, title: `${seed.title} (${Math.floor(i / SEEDS.length) + 1})` }, i);
    });
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const rawSubs = new Set();
    const sampleSubs = new Set();
    const dirty = new Set();
    const counters = { raw: 0, patches: 0 };
    const rates = { raw: 0, patches: 0 };

    function emitRaw(s, evt) {
      counters.raw++;
      dirty.add(s.id);
      rawSubs.forEach((f) => f(s, evt));
    }

    function tick() {
      for (const s of sessions) {
        if (s.state === 'done') continue;
        const running = s.agents.filter((a) => a.status === 'running');
        if (!running.length) { deriveState(s); dirty.add(s.id); continue; }
        // Several events per tick per session: token deltas dominate, as in reality.
        const burst = 1 + Math.floor(Math.random() * 3);
        for (let b = 0; b < burst; b++) {
          const a = rnd(running);
          const r = Math.random();
          if (r < 0.72) {
            const w = nextWord(s);
            const t = Math.round(rand(8, 60));
            s.tokens += t;
            s.cost += t * 0.0000225;
            // Half the text is the orchestrator's own reply, half is lane output.
            const orchestrator = r < 0.3;
            if (orchestrator) s.stream = (s.stream + w).slice(-3000);
            else pushLog(a, { t: 'text', text: w });
            emitRaw(s, { type: 'delta', text: w, agent: a, orchestrator });
          } else if (r < 0.95) {
            const [verb, file] = rnd(TOOL_LINES);
            a.line = `${verb} ${file}`;
            pushLog(a, { t: 'tool', verb, file });
            if (verb === 'Edit' || verb === 'Write') s.git.add += Math.round(rand(1, 14));
            if (verb === 'Edit') s.git.del += Math.round(rand(0, 4));
            emitRaw(s, { type: 'tool', verb, file, agent: a });
          } else if (r < 0.962 && running.length > 1) {
            a.status = 'done';
            a.endedAt = Date.now();
            a.line = `Finished — ${a.line}`;
            emitRaw(s, { type: 'agent-done', agent: a });
          } else if (r < 0.975) {
            const ix = s.todos.findIndex((t) => !t.done);
            if (ix >= 0 && ix < s.todos.length - 1) {
              s.todos[ix].done = true;
              s.todos[ix].active = false;
              s.todos[ix + 1].active = true;
              s.turns++;
              emitRaw(s, { type: 'todo' });
            }
          } else if (r < 0.9758 && !s.permission && !s.error) {
            a.status = 'waiting';
            s.permission = { agentId: a.id, agent: a.name, cmd: rnd(PERMISSION_CMDS), at: Date.now() };
            emitRaw(s, { type: 'permission', agent: a });
          } else if (r < 0.9761 && !s.permission && !s.error) {
            a.status = 'error';
            a.line = 'Exited with failures';
            s.error = rnd(ERRORS);
            emitRaw(s, { type: 'error', agent: a });
          }
        }
        deriveState(s);
      }
    }

    setInterval(tick, TICK_MS);
    setInterval(() => {
      if (!dirty.size) return;
      const ids = [...dirty];
      dirty.clear();
      sampleSubs.forEach((f) => f(ids));
    }, SAMPLE_MS);
    setInterval(() => {
      rates.raw = counters.raw;
      rates.patches = counters.patches;
      counters.raw = 0;
      counters.patches = 0;
    }, 1000);

    function touch(s) { deriveState(s); dirty.add(s.id); }

    return {
      sessions,
      get: (id) => byId.get(id),
      onRaw(f) { rawSubs.add(f); return () => rawSubs.delete(f); },
      onSample(f) { sampleSubs.add(f); return () => sampleSubs.delete(f); },
      notePatch(n = 1) { counters.patches += n; },
      rates,
      attention() {
        return sessions
          .filter((s) => s.permission || s.error)
          .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state]);
      },
      sorted(mode) {
        if (mode !== 'attention') return sessions.slice();
        return sessions.slice().sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.id.localeCompare(b.id, undefined, { numeric: true }));
      },
      allow(id) {
        const s = byId.get(id);
        if (!s || !s.permission) return;
        const a = s.agents.find((x) => x.id === s.permission.agentId);
        if (a) { a.status = 'running'; a.line = `Bash ${s.permission.cmd}`; }
        s.permission = null;
        s.finished = false;
        touch(s);
      },
      deny(id) {
        const s = byId.get(id);
        if (!s || !s.permission) return;
        const a = s.agents.find((x) => x.id === s.permission.agentId);
        if (a) { a.status = 'stopped'; a.line = 'Permission denied by you'; }
        s.permission = null;
        touch(s);
      },
      stopLane(id, agentId) {
        const s = byId.get(id);
        const a = s && s.agents.find((x) => x.id === agentId);
        if (!a) return;
        if (s.permission && s.permission.agentId === agentId) s.permission = null;
        a.status = 'stopped';
        a.endedAt = Date.now();
        a.line = 'Stopped by you';
        touch(s);
      },
      retry(id) {
        const s = byId.get(id);
        if (!s || !s.error) return;
        const a = s.agents.find((x) => x.status === 'error');
        if (a) { a.status = 'running'; a.line = 'Retry — npx nx test'; }
        s.error = null;
        s.finished = false;
        touch(s);
      },
    };
  }

  // ---------- Formatting ----------
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function fmtElapsed(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
  }
  const fmtTokens = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const fmtCost = (n) => `$${n.toFixed(2)}`;
  const ctxPct = (s) => Math.min(97, Math.round((s.tokens / 200000) * 100));
  const STATE_LABEL = { running: 'running', needs: 'needs you', error: 'error', done: 'done' };
  const KIND_LABEL = { sub: 'Sub-agent', cli: 'CLI lane', bg: 'Background' };
  const KIND_ICON = { sub: '◇', cli: '›_', bg: '≋' };

  function agentElapsed(a) {
    return fmtElapsed((a.endedAt || Date.now()) - a.startedAt);
  }
  function activeAgents(s) {
    return s.agents.filter((a) => a.status === 'running' || a.status === 'waiting' || a.status === 'error');
  }
  /** Agents for a card: attention first, then running, newest first. */
  function cardAgents(s) {
    const rank = { waiting: 0, error: 1, running: 2, done: 3, stopped: 4 };
    return s.agents.slice().sort((a, b) => rank[a.status] - rank[b.status] || b.startedAt - a.startedAt);
  }
  function currentActivity(s) {
    if (s.state === 'done') return `<b>Finished</b> · ${s.todos.filter((t) => t.done).length}/${s.todos.length} todos`;
    const a = cardAgents(s).find((x) => x.status === 'running');
    if (!a) return 'Orchestrator waiting';
    return `<b>${esc(a.name)}</b> · ${esc(a.line)}`;
  }
  function lastMessage(s, n = 240) {
    const t = s.stream.trim();
    return t.length > n ? '…' + t.slice(-n) : t;
  }

  // ---------- Card renderer (Card + Peek fidelity) ----------
  /**
   * Card body as one HTML string. Re-rendered at sample rate (2 Hz) only for
   * dirty sessions, so a card never sees raw stream events.
   */
  function cardHtml(s, { maxAgents = 3, showBranch = true } = {}) {
    const doneTodos = s.todos.filter((t) => t.done).length;
    const agents = cardAgents(s);
    const shown = agents.slice(0, maxAgents);
    const hidden = agents.length - shown.length;
    const active = activeAgents(s).length;
    let callout = '';
    if (s.permission) {
      callout = `<div class="callout need"><div><b>${esc(s.permission.agent)}</b> asks to run <code>${esc(s.permission.cmd)}</code></div>
        <div class="actions"><button class="btn btn-allow" data-act="allow">Allow</button><button class="btn btn-deny" data-act="deny">Deny</button><button class="btn" data-act="focus">Open</button></div></div>`;
    } else if (s.error) {
      callout = `<div class="callout err"><div class="truncate">${esc(s.error)}</div>
        <div class="actions"><button class="btn" data-act="retry">Retry</button><button class="btn" data-act="focus">Open</button></div></div>`;
    }
    return `
      <div class="card-h"><span class="dot"></span><span class="title truncate">${esc(s.title)}</span>
        <span class="pill ${s.state}">${STATE_LABEL[s.state]}</span>
        <button class="icon-btn" data-act="pin" title="Pin as live tile" aria-label="Pin ${esc(s.title)} as live tile">⧉</button></div>
      ${showBranch ? `<div class="sub mono truncate">${esc(s.branch)} · ${esc(s.model)} · ${active} active</div>` : ''}
      <div class="activity truncate">${currentActivity(s)}</div>
      ${callout || `<ul class="agents">${shown.map((a) => `<li><span class="dot ${a.status}"></span><span class="name truncate">${esc(a.name)}</span><span class="kind">${KIND_LABEL[a.kind]}</span><span class="line truncate">${esc(a.line)}</span><span class="el">${agentElapsed(a)}</span></li>`).join('')}</ul>
      ${hidden > 0 ? `<div class="more">+${hidden} more agents</div>` : ''}`}
      <div class="card-f">
        <span title="Todos">☑ ${doneTodos}/${s.todos.length} <i class="mini-bar"><b style="width:${(doneTodos / s.todos.length) * 100}%"></b></i></span>
        <span title="Context">ctx <i class="mini-bar ctx"><b style="width:${ctxPct(s)}%"></b></i> ${ctxPct(s)}%</span>
        <span>${fmtCost(s.cost)}</span>
        <span class="mono"><span class="git-add">+${s.git.add}</span> <span class="git-del">−${s.git.del}</span></span>
      </div>
      <div class="peek"><div class="lbl">Last message · plain text</div><div class="peek-text"></div></div>`;
  }

  function createCard(s, store, opts = {}) {
    const el = document.createElement('article');
    el.className = `card st-${s.state}`;
    el.dataset.id = s.id;
    el.tabIndex = 0;
    let hoverTimer = 0;
    let pressing = false;
    let pending = false;
    // A re-render between pointerdown and pointerup would swallow the click.
    el.addEventListener('pointerdown', () => { pressing = true; });
    const release = () => {
      pressing = false;
      if (pending) { pending = false; setTimeout(render, 0); }
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    const render = () => {
      if (pressing) { pending = true; return; }
      const cur = store.get(s.id);
      el.className = `card st-${cur.state}${el.classList.contains('peeking') ? ' peeking' : ''}${opts.extraClass ? ' ' + opts.extraClass : ''}`;
      el.innerHTML = cardHtml(cur, opts);
      if (el.classList.contains('peeking')) el.querySelector('.peek-text').textContent = lastMessage(cur);
      store.notePatch();
    };
    el.addEventListener('mouseenter', () => {
      hoverTimer = setTimeout(() => {
        el.classList.add('peeking');
        el.querySelector('.peek-text').textContent = lastMessage(store.get(s.id));
      }, 450);
    });
    el.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); el.classList.remove('peeking'); release(); });
    render();
    return { el, update: render, destroy() { clearTimeout(hoverTimer); el.remove(); } };
  }

  // ---------- Live renderer (Live fidelity) ----------
  /**
   * Full transcript. Subscribes to raw events and appends DOM per event, like
   * the real streaming transcript does. Use only for the focused/pinned tile.
   */
  function createLive(container, s, store, { compact = false, composer = true } = {}) {
    const root = document.createElement('div');
    root.className = 'live';
    const doneAgents = s.agents.filter((a) => a.status === 'done');
    root.innerHTML = `
      <div class="transcript">
        <div class="msg-user">${esc(s.prompt)}</div>
        <div class="worked">Worked for ${fmtElapsed(Date.now() - s.startedAt)} ›</div>
        <div class="msg-ai"><p>${esc(lastMessage(s, 320))}</p>
          ${doneAgents.length ? `<p>The finished agents wrote their reports:</p><div class="agent-chips">${doneAgents.map((a) => `<span class="agent-chip">${KIND_ICON[a.kind]} ${esc(a.name)} <span class="s-done">done</span></span>`).join('')}</div>` : ''}
        </div>
        <div class="msg-user">Go. Keep the old shell untouched.</div>
        <div class="msg-ai"><p>Started the workers. I will merge each batch when its tests pass.</p>
          <div class="agent-chips" data-chips></div></div>
        <div class="msg-ai stream-host"><p class="stream"></p></div>
      </div>
      ${composer ? `<div class="composer">
        <div class="ctx"><span>▢ ptah-extension</span><span class="mono">⑂ ${esc(s.branch)}</span></div>
        <div class="input">Ask the orchestrator to plan, build or review…</div>
        <div class="bar"><span>＋</span><span style="color:var(--need)">⛉ Auto-edit</span><span class="spacer"></span><span>${esc(s.model)} · High ⌄</span><button class="send" aria-label="Send">↑</button></div>
      </div>` : ''}`;
    container.appendChild(root);
    const transcript = root.querySelector('.transcript');
    const streamHost = root.querySelector('.stream-host');
    const chips = root.querySelector('[data-chips]');
    let streamP = streamHost.querySelector('.stream');
    let nodes = 0;
    let toolGroup = null;
    let wordsSinceGroup = 0;
    const MAX_NODES = compact ? 160 : 320;

    const renderChips = () => {
      const cur = store.get(s.id);
      chips.innerHTML = cur.agents
        .filter((a) => a.status !== 'done')
        .map((a) => `<span class="agent-chip">${KIND_ICON[a.kind]} ${esc(a.name)} <span class="s-${a.status}">${a.status}</span></span>`)
        .join('');
    };
    renderChips();

    const nearBottom = () => transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
    const off = store.onRaw((sess, evt) => {
      if (sess.id !== s.id) return;
      if (evt.type === 'delta' && !evt.orchestrator) return; // lane text lives in the lane tab
      const stick = nearBottom();
      if (evt.type === 'delta') {
        // One node per delta: this mirrors incremental markdown rendering cost.
        const span = document.createElement('span');
        span.textContent = evt.text;
        streamP.appendChild(span);
        wordsSinceGroup++;
        nodes++;
      } else if (evt.type === 'tool') {
        // Consecutive tool calls collapse into one group: newest row + a count.
        // A new group starts only after a real run of prose.
        if (!toolGroup || wordsSinceGroup > 24) {
          toolGroup = document.createElement('div');
          toolGroup.className = 'tool-row';
          toolGroup.dataset.n = '0';
          streamHost.appendChild(toolGroup);
          streamP = document.createElement('p');
          streamP.className = 'stream';
          streamHost.appendChild(streamP);
          wordsSinceGroup = 0;
          nodes += 2;
        }
        const n = Number(toolGroup.dataset.n) + 1;
        toolGroup.dataset.n = String(n);
        toolGroup.innerHTML = `▸ <b>${esc(evt.agent.name)}</b> · ${esc(evt.verb)} ${esc(evt.file)}${n > 1 ? ` <span class="faint">· ${n} tool calls</span>` : ''}`;
      } else {
        renderChips();
      }
      if (nodes > MAX_NODES) {
        for (let k = 0; k < 40 && streamHost.firstChild; k++) streamHost.firstChild.remove();
        if (toolGroup && !streamHost.contains(toolGroup)) toolGroup = null;
        if (!streamHost.contains(streamP)) {
          streamP = document.createElement('p');
          streamP.className = 'stream';
          streamHost.appendChild(streamP);
        }
        nodes -= 40;
      }
      store.notePatch();
      if (stick) transcript.scrollTop = transcript.scrollHeight;
    });
    const offSample = store.onSample((ids) => { if (ids.includes(s.id)) renderChips(); });
    requestAnimationFrame(() => { transcript.scrollTop = transcript.scrollHeight; });
    return { el: root, destroy() { off(); offSample(); root.remove(); } };
  }

  // ---------- Board card v2 (aligned zones, lanes table) ----------
  const LANE_ORDER = { sub: 0, cli: 1, bg: 2 };
  function laneSummary(s) {
    const c = { running: 0, waiting: 0, error: 0, done: 0, stopped: 0 };
    s.agents.forEach((a) => c[a.status]++);
    return [c.running && `${c.running} running`, c.waiting && `${c.waiting} waiting`, c.error && `${c.error} failed`, c.done && `${c.done} done`].filter(Boolean).join(' · ');
  }
  /**
   * Fixed zones in a fixed order, so the eye finds the same field in the same
   * place on every card: header → now → lanes → metrics.
   */
  function boardCardHtml(s, { maxLanes = 3 } = {}) {
    const doneTodos = s.todos.filter((t) => t.done).length;
    const lanes = cardAgents(s);
    // The callout takes the lane rows' space; the lane summary line stays.
    const lanesShown = s.permission || s.error ? 0 : maxLanes;
    const shown = lanes.slice(0, lanesShown);
    const hidden = lanes.length - shown.length;
    let callout = '';
    if (s.permission) {
      callout = `<div class="callout need"><div class="truncate"><b>${esc(s.permission.agent)}</b> asks to run <code>${esc(s.permission.cmd)}</code></div>
        <div class="actions"><button class="btn btn-allow" data-act="allow">Allow</button><button class="btn btn-deny" data-act="deny">Deny</button></div></div>`;
    } else if (s.error) {
      callout = `<div class="callout err"><div class="truncate">${esc(s.error)}</div>
        <div class="actions"><button class="btn" data-act="retry">Retry</button><button class="btn" data-act="lane" data-lane="${esc((s.agents.find((a) => a.status === 'error') || {}).id || '')}">Show output</button></div></div>`;
    }
    return `
      <div class="z-head"><span class="dot"></span><span class="title truncate">${esc(s.title)}</span>
        <span class="pill ${s.state}">${STATE_LABEL[s.state]}</span>
        <button class="icon-btn expand-btn" data-act="expand" title="Expand in place" aria-label="Expand ${esc(s.title)}">⤢</button></div>
      <div class="z-sub mono truncate">${esc(s.branch)} · ${esc(s.model)} · ${fmtElapsed(Date.now() - s.startedAt)}</div>
      <div class="z-now truncate"><span class="z-label">Now</span>${currentActivity(s)}</div>
      ${callout}
      <div class="z-lanes">
        <div class="z-lanes-h"><span class="z-label">Lanes</span><span>${laneSummary(s)}</span></div>
        <ul class="lane-table">${shown.map((a) => `<li data-act="lane" data-lane="${a.id}" title="Open ${esc(a.name)} output">
          <span class="faint">${KIND_ICON[a.kind]}</span><span class="truncate">${esc(a.name)}</span>
          <span class="kind">${KIND_LABEL[a.kind]}</span><span class="s-${a.status}"><span class="dot ${a.status}"></span> ${a.status}</span>
          <span class="el">${agentElapsed(a)}</span></li>`).join('')}</ul>
        ${hidden > 0 ? `<button class="more-btn" data-act="expand">${shown.length ? `+${hidden} more lanes` : `Show ${hidden} lanes`}</button>` : ''}
      </div>
      <div class="z-foot">
        <span title="Todos">☑ ${doneTodos}/${s.todos.length} <i class="mini-bar"><b style="width:${(doneTodos / s.todos.length) * 100}%"></b></i></span>
        <span title="Context">ctx ${ctxPct(s)}%</span>
        <span>${fmtCost(s.cost)}</span>
        <span class="mono"><span class="git-add">+${s.git.add}</span> <span class="git-del">−${s.git.del}</span></span>
      </div>`;
  }

  // ---------- Lane view (one CLI agent / sub-agent / background task) ----------
  /**
   * Output of one lane. Subscribes to raw events for this agent only, so an
   * open lane tab costs the same as one live transcript, and closed tabs cost nothing.
   */
  function createLaneView(container, s, agentId, store) {
    const root = document.createElement('div');
    root.className = 'lane-view';
    root.innerHTML = `<div class="lane-head"></div><div class="lane-log mono" role="log" aria-live="off"></div>`;
    container.appendChild(root);
    const head = root.querySelector('.lane-head');
    const logEl = root.querySelector('.lane-log');
    let textEl = null;
    const agent = () => store.get(s.id).agents.find((a) => a.id === agentId);

    const renderHead = () => {
      const a = agent();
      const cur = store.get(s.id);
      const asking = cur.permission && cur.permission.agentId === agentId;
      head.innerHTML = `<div class="lane-title"><span class="faint">${KIND_ICON[a.kind]}</span><b>${esc(a.name)}</b><span class="kind">${KIND_LABEL[a.kind]}</span>
          <span class="s-${a.status}"><span class="dot ${a.status}"></span> ${a.status}</span><span class="faint">· ${agentElapsed(a)}</span>
          <span style="flex:1"></span>${a.status === 'running' || a.status === 'waiting' ? '<button class="btn" data-act="stop-lane">Stop lane</button>' : ''}</div>
        <div class="lane-task"><span class="z-label">Task</span>${esc(a.task)}</div>
        ${asking ? `<div class="callout need"><div><b>${esc(a.name)}</b> asks to run <code>${esc(cur.permission.cmd)}</code></div><div class="actions"><button class="btn btn-allow" data-act="allow">Allow</button><button class="btn btn-deny" data-act="deny">Deny</button></div></div>` : ''}`;
      store.notePatch();
    };
    const appendEntry = (e) => {
      if (e.t === 'tool') {
        const row = document.createElement('div');
        row.className = 'log-tool';
        row.innerHTML = `<span class="faint">▸</span> <b>${esc(e.verb)}</b> ${esc(e.file)}`;
        logEl.appendChild(row);
        textEl = null;
      } else {
        if (!textEl) { textEl = document.createElement('div'); textEl.className = 'log-text'; logEl.appendChild(textEl); }
        textEl.appendChild(document.createTextNode(e.text));
      }
      while (logEl.childNodes.length > 220) logEl.firstChild.remove();
    };
    agent().log.slice(-80).forEach(appendEntry);
    renderHead();
    const nearBottom = () => logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60;
    const offRaw = store.onRaw((sess, evt) => {
      if (sess.id !== s.id || !evt.agent || evt.agent.id !== agentId) return;
      const stick = nearBottom();
      if (evt.type === 'delta' && !evt.orchestrator) appendEntry({ t: 'text', text: evt.text });
      else if (evt.type === 'tool') appendEntry({ t: 'tool', verb: evt.verb, file: evt.file });
      else return;
      store.notePatch();
      if (stick) logEl.scrollTop = logEl.scrollHeight;
    });
    const offSample = store.onSample((ids) => { if (ids.includes(s.id)) renderHead(); });
    const timer = setInterval(renderHead, 1000);
    requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight; });
    return { el: root, destroy() { offRaw(); offSample(); clearInterval(timer); root.remove(); } };
  }

  // ---------- Inspector ----------
  function inspectorHtml(s, opts = {}) {
    const closable = !!opts.closable;
    const doneTodos = s.todos.filter((t) => t.done).length;
    const active = s.agents.filter((a) => a.status === 'running' || a.status === 'waiting').length;
    const finished = s.agents.filter((a) => a.status === 'done').length;
    const pct = ctxPct(s);
    return `
      ${opts.noHeader ? '' : `<div class="insp-h">This session ${closable ? '<button class="icon-btn" data-act="close-inspector" aria-label="Close inspector">✕</button>' : ''}</div>`}
      <div class="insp-sec">
        <div style="display:flex;gap:8px;align-items:flex-start"><span class="dot ${s.state === 'needs' ? 'needs' : s.state}" style="margin-top:5px"></span>
          <div><div style="font-weight:600">${esc(s.title)}</div><div class="muted" style="font-size:12px">${esc(s.model)} · ${s.state === 'done' ? 'finished' : `waiting on ${active} agents`}</div></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:12px" class="muted"><span>Context</span><span>${pct}% of 200k</span></div>
        <div class="ctx-bar"><b style="width:${pct}%"></b></div>
        <div class="kpis"><div><strong>${fmtTokens(s.tokens)}</strong><span>tokens</span></div><div><strong>${fmtCost(s.cost)}</strong><span>cost</span></div><div><strong>${s.turns}</strong><span>turns</span></div></div>
      </div>
      ${opts.hideAgents ? '' : `<div class="insp-sec"><h3>Agents <span>${active} active · ${finished} finished</span></h3>
        ${cardAgents(s).map((a) => `<div class="insp-agent"><div class="r1"><span class="faint" style="width:12px">${KIND_ICON[a.kind]}</span><span class="name truncate">${esc(a.name)}</span><span class="kind">${KIND_LABEL[a.kind]}</span>
          <span class="right"><span class="s-${a.status}">${a.status}</span> <span class="faint">· ${agentElapsed(a)}</span></span></div>
          <div class="r2 truncate ${a.status === 'waiting' ? 'warn' : ''}">${a.status === 'waiting' && s.permission ? `Needs permission: ${esc(s.permission.cmd)}` : esc(a.line)}</div></div>`).join('')}
      </div>`}
      <div class="insp-sec"><h3>Todos <span>${doneTodos} of ${s.todos.length}</span></h3>
        ${s.todos.map((t) => `<div class="todo ${t.done ? 'done' : ''} ${t.active ? 'active' : ''}"><span class="box">${t.done ? '✓' : ''}</span>${esc(t.text)}</div>`).join('')}
      </div>
      <div class="insp-sec"><h3>Git <span style="color:var(--gold);cursor:pointer">Review changes</span></h3>
        <div class="mono" style="font-size:12px">⑂ ${esc(s.branch)} <span class="faint">↑${s.git.ahead} ↓0</span> <span class="git-add">+${s.git.add}</span> <span class="git-del">−${s.git.del}</span></div>
      </div>`;
  }

  function createInspector(container, store, opts = {}) {
    let id = null;
    const render = () => {
      if (!id) return;
      container.innerHTML = inspectorHtml(store.get(id), opts);
      store.notePatch();
    };
    const off = store.onSample((ids) => { if (id && ids.includes(id)) render(); });
    // Elapsed timers tick without new events.
    const timer = setInterval(render, 1000);
    return { set(nextId) { id = nextId; render(); }, destroy() { off(); clearInterval(timer); } };
  }

  // ---------- Attention queue ----------
  function createAttention(host, store, { onOpen } = {}) {
    host.classList.add('attention');
    host.innerHTML = `<button class="attention-btn" aria-haspopup="true" aria-expanded="false"><span class="dot"></span><span data-count></span></button><div class="attention-pop" role="dialog" aria-label="Sessions that need you"></div>`;
    const btn = host.querySelector('.attention-btn');
    const pop = host.querySelector('.attention-pop');
    let pressing = false;
    pop.addEventListener('pointerdown', () => { pressing = true; });
    document.addEventListener('pointerup', () => { pressing = false; });
    const render = () => {
      if (pressing) return;
      const items = store.attention();
      const needs = items.filter((s) => s.permission).length;
      const errs = items.length - needs;
      btn.classList.toggle('hot', items.length > 0);
      btn.querySelector('.dot').className = `dot ${needs ? 'needs' : errs ? 'error' : 'done'}`;
      btn.querySelector('[data-count]').textContent = items.length
        ? `${needs ? `${needs} need${needs === 1 ? 's' : ''} you` : ''}${needs && errs ? ' · ' : ''}${errs ? `${errs} error${errs === 1 ? '' : 's'}` : ''}`
        : 'All clear';
      pop.innerHTML = items.length
        ? items.map((s) => `<div class="att-item" data-id="${s.id}">
            <div class="row"><span class="dot ${s.state}"></span><b class="truncate" style="flex:1">${esc(s.title)}</b><span class="faint" style="font-size:11px">${s.permission ? fmtElapsed(Date.now() - s.permission.at) + ' ago' : ''}</span></div>
            <div class="muted" style="font-size:12px">${s.permission ? `<b style="color:var(--text)">${esc(s.permission.agent)}</b> asks to run <code class="mono">${esc(s.permission.cmd)}</code>` : esc(s.error)}</div>
            <div class="row">${s.permission ? '<button class="btn btn-allow" data-act="allow">Allow</button><button class="btn btn-deny" data-act="deny">Deny</button>' : '<button class="btn" data-act="retry">Retry</button>'}<button class="btn" data-act="open">Open session</button></div>
          </div>`).join('')
        : '<div class="att-empty">No session needs you.</div>';
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !host.classList.contains('open');
      host.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => { if (!host.contains(e.target)) host.classList.remove('open'); });
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.closest('[data-id]').dataset.id;
      const act = b.dataset.act;
      if (act === 'allow') store.allow(id);
      if (act === 'deny') store.deny(id);
      if (act === 'retry') store.retry(id);
      if (act === 'open') { host.classList.remove('open'); onOpen && onOpen(id); }
      render();
    });
    store.onSample(render);
    render();
    return { render };
  }

  // ---------- Perf HUD ----------
  function createHud(store, extra = () => ({})) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.setAttribute('aria-label', 'Prototype performance counters');
    el.title = 'Click to minimize';
    document.body.appendChild(el);
    el.addEventListener('click', () => el.classList.toggle('min'));
    const render = () => {
      const nodes = document.getElementsByTagName('*').length;
      const x = extra();
      const cls = (v, warn, bad) => (v > bad ? 'bad' : v > warn ? 'warn' : '');
      el.innerHTML = `<span class="title">Simulated load</span>
        <span>DOM nodes</span><b class="${cls(nodes, 2500, 6000)}">${nodes.toLocaleString()}</b>
        <span>Stream events/s</span><b>${store.rates.raw}</b>
        <span>UI patches/s</span><b class="${cls(store.rates.patches, 60, 200)}">${store.rates.patches}</b>
        <span>Live views</span><b>${x.live ?? '—'}</b>`;
    };
    setInterval(render, 1000);
    render();
  }

  window.Proto = {
    createStore, createCard, createLive, createInspector, createAttention, createHud,
    boardCardHtml, createLaneView, laneSummary, LANE_ORDER,
    cardHtml, esc, fmtElapsed, fmtTokens, fmtCost, ctxPct, agentElapsed, cardAgents, activeAgents,
    currentActivity, lastMessage, STATE_LABEL, KIND_LABEL, KIND_ICON, SAMPLE_MS,
  };
})();
