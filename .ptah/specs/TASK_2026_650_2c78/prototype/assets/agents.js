/* TASK_2026_650 prototype: Generate agents page (chat tab + sidebar). Example data only. */
(function () {
  'use strict';
  const { g, esc, ic, sec, sourceCard } = window.W;
  const W = window.W;

  const AG = [
    ['project-manager', 'Project Manager', 'planning', 96, 'Turns a request into scoped, testable requirements and acceptance criteria.', ['Monorepo with several libraries', 'Task folders under .ptah/specs']],
    ['software-architect', 'Software Architect', 'planning', 94, 'Designs component boundaries, contracts and the implementation plan.', ['Multiple processes and hosts', 'Shared libraries']],
    ['team-leader', 'Team Leader', 'planning', 88, 'Splits a plan into batches and verifies each one before commit.', ['Nx workspace']],
    ['backend-developer', 'Backend Developer', 'development', 92, 'Writes services, handlers and data access following repository patterns.', ['NestJS detected', 'Prisma detected']],
    ['frontend-developer', 'Frontend Developer', 'development', 95, 'Builds components, templates, view state and styling.', ['Angular 22 detected', 'Tailwind and DaisyUI detected']],
    ['devops-engineer', 'DevOps Engineer', 'development', 71, 'Maintains build, test and release pipelines.', ['GitHub Actions workflows']],
    ['senior-tester', 'Senior Tester', 'qa', 90, 'Writes and runs the tests that prove acceptance criteria hold.', ['Jest detected', 'Playwright detected']],
    ['code-style-reviewer', 'Code Style Reviewer', 'qa', 84, 'Reviews structure and consistency with this repository.', ['ESLint rules present']],
    ['code-logic-reviewer', 'Code Logic Reviewer', 'qa', 86, 'Reviews behavioural correctness and failure handling.', ['Async-heavy services']],
    ['researcher-expert', 'Researcher Expert', 'specialist', 78, 'Answers bounded technical questions with cited evidence.', ['Many third-party libraries']],
    ['modernization-detector', 'Modernization Detector', 'specialist', 64, 'Finds deprecated APIs and deferred upgrade work.', ['Mixed framework versions']],
    ['ui-ux-designer', 'UI/UX Designer', 'creative', 80, 'Produces design systems, specs and prototypes.', ['Design tokens present']],
    ['technical-content-writer', 'Technical Content Writer', 'creative', 58, 'Writes docs and marketing copy traced to the code.', ['Docs folder present']],
  ];
  const CATS = [['planning', 'Planning & Architecture'], ['development', 'Development'], ['qa', 'Quality Assurance'], ['specialist', 'Specialists'], ['creative', 'Creative']];
  const RUN_IDS = ['project-manager', 'software-architect', 'team-leader', 'backend-developer', 'frontend-developer', 'senior-tester', 'code-logic-reviewer'];
  const keep = () => { const q = new URLSearchParams(); for (const k of ['theme','w']) if (W.P.has(k)) q.set(k, W.P.get(k)); const t = q.toString(); return t ? '?' + t : ''; };
  const nm = (id) => AG.find((a) => a[0] === id)[1];

  /* Raw `s` values that are shorthands for a base state plus flags (kept so earlier links still work). */
  const ALIAS = {
    'done-flow': { s: 'done', flow: true },
    'partial-flow': { s: 'partial', flow: true },
    'done-flow-started': { s: 'done', flow: true, fs: 'started' },
    'done-flow-skipped': { s: 'done', flow: true, fs: 'skipped' },
    'stop-late': { s: 'done', late: true },
    'stop-failed': { s: 'running', stopFailed: true },
    'stop-unconfirmed': { s: 'running', stopUnconf: true },
    'stop-unknown': { s: 'running', stopUnknown: true },
  };
  const AL = () => ALIAS[g('s', 'setup')] || {};
  const S = {
    get s() { return AL().s || g('s', 'setup'); },
    /** Combined setup flow (started from the analysis hand-off). */
    get flow() { return AL().flow || g('flow', '0') === '1'; },
    /** Continuation card state in the combined flow: countdown, started or skipped. */
    get fs() { return AL().fs || g('fs', 'countdown'); },
    /** The stop arrived after the run had already finalized. */
    get late() { return !!AL().late; },
    /** The stop request failed: the run is still active. */
    get stopFailed() { return !!AL().stopFailed; },
    /** The stop response was lost: the page is re-reading the run state. */
    get stopUnconf() { return !!AL().stopUnconf; },
    /** The run state could not be re-read either. */
    get stopUnknown() { return !!AL().stopUnknown; },
    /** Model the project guidance tab will use (its own tab model, spec 2.9.3). */
    get gm() { return g('gm', 'same'); },
    get src() { return g('src', ['setup', 'loading', 'empty', 'confirm', 'confirm-loading', 'confirm-changed', 'confirm-error'].includes(g('s', 'setup')) ? 'unchecked' : 'no-analysis'); },
    get pk() { return g('pk', 'closed'); },
    get guid() { return g('guid', 'none'); },
    get prov() { return g('prov', 'ok'); },
  };
  let selected = null;
  const initSel = () => { selected = new Set(g('sel', 'some') === 'none' ? [] : RUN_IDS); };
  initSel();

  const PRE = ['setup', 'loading', 'empty', 'confirm', 'confirm-loading', 'confirm-changed', 'confirm-error', 'starting', 'rejected', 'tabmismatch', 'blocked', 'resume'];
  const ACTIVE = ['running', 'running-quiet', 'running-fail', 'retrying', 'cancelling'];
  const POST = ['cancelled', 'interrupted', 'partial', 'run-failed', 'done'];
  const DONE_LIKE = ['done'];
  const MODEL = () => `${W.MODEL.provider}, ${W.MODEL.model}`;
  const GMODEL = () => (g('gm', 'same') === 'diff' ? `${W.MODEL.provider}, Claude Opus 4.1` : MODEL());
  const MANY = ['Syncing the written agents to your other tools failed. The agent files are kept.', 'One generated section was rejected by validation and replaced with the authored template.', 'The completion marker could not be written.', 'A community pack index could not be refreshed.', 'The agent list could not be re-read after writing.', 'Cleaning up the working files failed. They can be removed safely.', 'A request to the model service timed out and was not repeated.'];
  const ERRS = () => g('err', '0') === 'many' ? MANY : (['partial', 'run-failed'].includes(S.s) || g('err', '0') === '1' ? (S.s === 'run-failed' ? ['The model service stopped responding before any item finished.', 'Output validation could not run.'] : ['Syncing the written agents to your other tools failed. The agent files are kept.', 'One generated section was rejected by validation and replaced with the authored template.']) : []);

  /* per-item status for the run (7 items) */
  function items() {
    const s = S.s; const r = RUN_IDS;
    const W_ = 'written', P_ = 'pending', U = 'unchanged';
    const map = {
      running: [W_, W_, W_, { st: 'progress', p: 60 }, P_, P_, P_],
      'running-quiet': [W_, W_, W_, { st: 'progress', p: 60 }, P_, P_, P_],
      'run-failed': [P_, P_, P_, P_, P_, P_, P_],
      'running-fail': [W_, W_, { st: 'error', err: 'The generated content was rejected by validation. Retry to generate it again.', left: 3 }, { st: 'progress', p: 35 }, P_, P_, P_],
      retrying: [W_, W_, { st: 'error', err: 'The generated content was rejected by validation. Retry to generate it again.', left: 2, wait: 2 }, { st: 'progress', p: 80 }, P_, P_, P_],
      cancelling: [W_, W_, { st: 'progress', p: 40 }, P_, P_, P_, P_],
      cancelled: [W_, W_, P_, P_, P_, P_, P_],
      interrupted: [W_, W_, P_, P_, P_, P_, P_],
      partial: [W_, W_, U, { st: 'error', err: 'The model did not return usable content.', left: 0 }, W_, { st: 'error', err: 'Writing the file failed. Check that the folder is writable.', left: 2 }, W_],
      done: [W_, W_, U, W_, W_, W_, W_],
    };
    return (map[s] || []).map((v, i) => Object.assign({ id: r[i], name: nm(r[i]) }, typeof v === 'string' ? { st: v } : v));
  }
  const counts = (it) => ({ written: it.filter((x) => x.st === 'written').length, unchanged: it.filter((x) => x.st === 'unchanged').length, failed: it.filter((x) => x.st === 'error').length, total: it.length });

  function itemHtml(x) {
    const ico = { pending: ['circle-dashed', 'ic-mute', 'Pending'], progress: ['loader-circle', 'ic-run spin', 'Generating'], written: ['circle-check', 'ic-ok', 'Written'], unchanged: ['check', 'ic-mute', 'Already current'], error: ['circle-alert', 'ic-err', 'Failed'] }[x.st];
    let extra = '';
    if (x.st === 'progress') extra = `<div class="bar"><div class="prog thin" role="progressbar" aria-label="${esc(x.name)} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${x.p}"><i style="width:${x.p}%"></i></div><span class="meta tnum">${x.p}%</span></div>`;
    if (x.st === 'error') {
      const rt = x.left === 0
        ? `<span class="meta" style="color:oklch(var(--bc))">${ic('ban', 'i-xs')} Max retries reached</span>`
        : x.wait
          ? `<button class="btn btn-outline" aria-disabled="true" aria-describedby="rt-${x.id}">${ic('rotate-cw', 'i-sm')}Retry</button><span class="meta" id="rt-${x.id}" role="status">Retrying in ${x.wait} s. ${x.left} attempts left.</span>`
          : `<button class="btn btn-outline" aria-label="Retry ${esc(x.name)} (${x.left} attempts remaining, uses ${W.MODEL.model})">${ic('rotate-cw', 'i-sm')}Retry</button><span class="meta">${x.left} attempts left. Uses ${W.MODEL.model}.</span>`;
      extra = `<p class="em">${ic('circle-alert', 'i-sm')}<span>${esc(x.err)}</span></p><div class="rt">${rt}</div>`;
    }
    return `<li class="item ${x.st === 'error' ? 'err' : ''}"><span class="${ico[1]}">${ic(ico[0], 'i-sm')}</span><span class="nm">${esc(x.name)}</span><span class="st">${ico[2]}</span>${extra}</li>`;
  }

  /* ---------- Run section ---------- */
  function guidanceHint() {
    if (S.guid === 'saved') return `<p class="meta" style="margin:10px 0 0">${ic('circle-check', 'i-xs ic-ok')} Project guidance is saved. This run will use it.</p>`;
    if (S.guid === 'none') return `<div class="status info" style="margin-top:10px;padding:8px 10px"><span class="ic">${ic('info', 'i-sm')}</span><div class="grow"><p style="margin:0">Want agents to use project guidance? Generate it first. Agents capture saved guidance when you start.</p><div class="acts" style="margin-top:6px"><a class="btn" href="guidance.html${keep()}">${ic('sparkles', 'i-sm')}Generate project guidance first</a></div></div></div>`;
    return '';
  }
  /* Combined-flow continuation (design-spec 2.9.2): countdown, started, skipped. Only after a committed result (done or partial). */
  function flowCard() {
    const keepTheme = W.P.get('theme') ? '&theme=' + W.P.get('theme') : '';
    const tail = S.s === 'partial' ? ' Failed items stay available to retry here.' : '';
    if (S.fs === 'started') return `<div class="status run" role="status" style="margin-top:8px"><span class="ic">${ic('sparkles', 'i-lg')}</span><div class="grow"><h3>Project guidance started</h3><p>It is running in its own Project Prompt tab with ${esc(GMODEL())}. To stop it, use Stop generation there. Skip is no longer available.${tail}</p><div class="acts"><a class="btn btn-outline" href="guidance.html?s=running&flow=1${S.gm === 'diff' ? '&gm=diff' : ''}${keepTheme}">Open tab${ic('arrow-right', 'i-sm')}</a></div></div></div>`;
    if (S.fs === 'skipped') return `<div class="status idle" role="status" style="margin-top:8px"><span class="ic">${ic('circle-dashed', 'i-lg')}</span><div class="grow"><h3>Project guidance skipped</h3><p>No guidance run was started. You can generate guidance any time from Next steps.</p></div></div>`;
    return `<div class="status run" style="margin-top:8px"><span class="ic">${ic('clock', 'i-lg')}</span><div class="grow"><h3>Project guidance starts next</h3><p>Setup continues with project guidance in its own tab. It starts in <span aria-hidden="true"><span class="cd" id="cd">5</span> s</span><span class="sr-only">5 seconds</span> and uses ${esc(GMODEL())}, ${g('gt', 'tab') === 'new' ? 'the default model for a new Project Prompt tab' : 'the model of the Project Prompt tab'}.${S.gm === 'diff' ? ` The agent run used ${esc(MODEL())}.` : ''}${tail}</p><p class="sr-only" role="status">Project guidance will start in 5 seconds. Skip guidance cancels it.</p><div class="acts"><button class="btn btn-outline" data-act="set" data-set="fs=skipped">Skip guidance</button><button class="btn btn-outline" data-act="set" data-set="fs=started">Start now</button></div></div></div>`;
  }
  function runSection() {
    const s = S.s; const n = selected.size; const it = items(); const c = counts(it);
    const effModel = `<p class="meta" style="margin:6px 0 0">Model: ${esc(MODEL())}</p>`;
    const stopAlert = () => S.stopFailed
      ? `<div class="status err" role="alert" style="margin-top:8px"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Could not stop the run</h3><p style="color:oklch(var(--bc))">The run is still active. Try stopping again.</p></div></div>`
      : S.stopUnconf ? `<div class="status warn" role="status" style="margin-top:8px"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><h3>Stop could not be confirmed</h3><p>We could not confirm whether the run stopped. Checking its state...</p></div></div>` : '';
    const stopRow = (busy, checking) => `<div class="acts-row">${W.stopBtn(busy || checking, checking ? 'Checking...' : undefined)}</div><p class="meta" style="margin:8px 0 0">Stop generation cancels the run. Files already written are kept. The chat Stop does the same.</p>`;
    const gen = (label, disabledWhy) => `<button class="btn btn-primary btn-wide" id="gen-btn" ${disabledWhy ? `aria-disabled="true" aria-describedby="gen-why"` : 'data-act="set" data-set="s=confirm"'} style="margin-top:12px">${ic('wand-sparkles', 'i-sm')}${label}</button>${disabledWhy ? `<p class="meta" id="gen-why" style="margin:6px 0 0">${disabledWhy}</p>` : effModel}`;
    let body = '';
    if (s === 'loading') {
      body = `<div class="status idle" role="status"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><h3>Loading the agent list</h3><p>This takes a moment.</p></div></div>${gen('Generate Agents', 'The agent list is still loading.')}`;
    } else if (s === 'empty') {
      body = `<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>The agent list could not be loaded</h3><p style="color:oklch(var(--bc))">No agents are available to choose from. Try again.</p><div class="acts"><button class="btn btn-outline">${ic('refresh-cw', 'i-sm')}Retry</button></div></div></div>`;
    } else if (S.prov === 'none' && PRE.includes(s)) {
      body = `<div class="status warn" role="status"><span class="ic">${ic('triangle-alert', 'i-lg')}</span><div class="grow"><h3>No provider is connected</h3><p>Connect a provider to generate agents.</p><div class="acts"><button class="btn btn-outline">${ic('settings', 'i-sm')}Open Settings</button></div></div></div>${gen('Generate Agents', 'Connect a provider first.')}`;
    } else if (s === 'resume') {
      body = `<div class="status info" role="status" data-testid="resume-generation-banner"><span class="ic">${ic('refresh-cw', 'i-lg')}</span><div class="grow"><h3>Unfinished agent generation found</h3><p>5 selected agents were saved. Resume to continue where it stopped. Files already written are kept.</p><p class="meta" style="margin:6px 0 0">Resume uses ${esc(MODEL())}, saved with the run. Change it in Provider and model below.</p>
        <div class="acts"><button class="btn btn-primary" aria-label="Resume generation" data-act="set" data-set="s=running">${ic('circle-play', 'i-sm')}Resume generation</button><button class="btn" data-act="set" data-set="s=setup">Not now</button></div></div></div>`;
    } else if (s === 'starting') {
      body = `<div class="status run" role="status"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><h3>Starting generation</h3><p>Checking the workspace and the context source. Model: ${esc(MODEL())}.</p></div></div>${stopRow(false)}`;
    } else if (s === 'rejected' || s === 'tabmismatch') {
      body = `<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Could not start generation</h3><p style="color:oklch(var(--bc))">The start was rejected before anything ran. Nothing was started and no files were written. See the context source below.${g('pend') === '1' ? ' Your stop request was dropped: nothing was running.' : ''}</p></div></div>${gen('Generate ' + n + ' Agent' + (n === 1 ? '' : 's'))}`;
    } else if (s === 'blocked') {
      body = `<div class="status warn" role="status"><span class="ic">${ic('triangle-alert', 'i-lg')}</span><div class="grow"><h3>Another workspace is generating agents</h3><p>${esc(W.OTHER_WS)} has an agent run in progress. Only one agent run can be active at a time. Wait for it to finish, then start here.${g('pend') === '1' ? ' Your stop request was dropped: nothing was running.' : ''}</p></div></div>${gen('Generate ' + n + ' Agents', 'Waiting for the run in ' + esc(W.OTHER_WS) + '.')}`;
    } else if (ACTIVE.includes(s)) {
      body = `<div class="status run" role="status"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><h3>${s === 'cancelling' ? 'Stopping generation' : 'Generating agents'}</h3><p>${s === 'cancelling' && g('pend') === '1' ? 'Your stop was received before the run began. It is applied as soon as the run starts, or dropped if the start is rejected.' : s === 'cancelling' ? 'Finishing the item in progress. Files already written are kept.' : `${c.written + c.unchanged} of ${c.total} items complete${c.failed ? `, ${c.failed} failed` : ''}.`}</p>${s === 'running-quiet' ? '<p class="meta" style="margin:6px 0 0">The chat is idle. The run is still working.</p>' : ''}</div></div>${stopAlert()}${S.stopUnknown ? '' : stopRow(s === 'cancelling', S.stopUnconf)}`;
      if (S.stopUnknown) body = `<div class="status warn" role="alert"><span class="ic">${ic('triangle-alert', 'i-lg')}</span><div class="grow"><h3>Run state could not be confirmed</h3><p>We could not confirm whether the run is still active or has ended. Check the agents folder in your workspace, then check again.</p><div class="acts"><button class="btn btn-outline" data-act="set" data-set="s=stop-unconfirmed">${ic('refresh-cw', 'i-sm')}Check again</button></div></div></div>`;
    } else if (s === 'cancelled') {
      body = `<div class="status warn" role="status"><span class="ic">${ic('circle-pause', 'i-lg')}</span><div class="grow"><h3>Generation cancelled</h3><p>2 items were written and kept. Resume to finish the rest.</p>
        <div class="acts"><button class="btn btn-primary" data-act="set" data-set="s=running">${ic('circle-play', 'i-sm')}Resume generation</button><button class="btn btn-outline" data-act="set" data-set="s=setup">Change selection</button></div></div></div>`;
    } else if (s === 'interrupted') {
      body = `<div class="status warn" role="status"><span class="ic">${ic('triangle-alert', 'i-lg')}</span><div class="grow"><h3>Generation was interrupted</h3><p>The run stopped before it finished. 2 items were written and kept.</p>
        <div class="acts"><button class="btn btn-primary" data-act="set" data-set="s=running">${ic('circle-play', 'i-sm')}Resume generation</button><button class="btn btn-outline" data-act="set" data-set="s=setup">Change selection</button></div></div></div>`;
    } else if (s === 'run-failed') {
      body = `<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Generation failed</h3><p style="color:oklch(var(--bc))">${g('ver', '1') === '0' ? 'The run stopped with a problem and the files it wrote could not be confirmed. Check the agents folder in your workspace before you try again. See the errors below.' : `The run stopped with errors before any item finished. ${c.written} written, ${c.failed} failed. Files already written, if any, are kept. See the errors below.`}</p><div class="acts"><button class="btn btn-primary" data-act="set" data-set="s=setup">${ic('rotate-cw', 'i-sm')}Try again</button></div></div></div>`;
    } else if (s === 'partial') {
      body = `<div class="status warn" role="status"><span class="ic">${ic('triangle-alert', 'i-lg')}</span><div class="grow"><h3>Finished with errors</h3><p>${c.written} written, ${c.unchanged} already current, ${c.failed} failed. Files written earlier are kept. Retry failed items below.</p></div></div>`;
    } else if (DONE_LIKE.includes(s)) {
      body = `<div class="status done" role="status"><span class="ic">${ic('circle-check', 'i-lg')}</span><div class="grow"><h3>Agents generated</h3><p>${c.written} written, ${c.unchanged} already current.</p>${S.late ? '<p class="meta" style="margin:6px 0 0">It finished before the stop took effect. The result below is final.</p>' : ''}</div></div>`;
    } else {
      // setup / confirm*
      body = n === 0
        ? `<div class="status idle"><span class="ic">${ic('bot', 'i-lg')}</span><div class="grow"><h3 id="run-h">Choose agents</h3><p id="run-p">Select at least one agent to continue.</p></div></div>${gen('Generate Agents', 'Select at least one agent.')}`
        : `<div class="status idle"><span class="ic">${ic('bot', 'i-lg')}</span><div class="grow"><h3 id="run-h">Ready to generate</h3><p id="run-p">${n} agent${n === 1 ? '' : 's'} selected.</p></div></div>${gen('Generate ' + n + ' Agent' + (n === 1 ? '' : 's'))}${guidanceHint()}`;
    }
    if (S.flow && (s === 'done' || s === 'partial')) body += flowCard();
    return sec('run', 'Run', '', body);
  }

  /* ---------- Generation (progress + result) ---------- */
  function errBlock() {
    const e = ERRS(); if (!e.length) return '';
    const kept = counts(items()).written > 0 && g('ver', '1') !== '0'; // the kept-files sentence only when written files are verified
    return `<div class="status err" role="alert" style="margin-top:8px"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Errors reported by the run <span class="meta tnum">(${e.length})</span></h3><ul class="warnlist" style="color:oklch(var(--bc))">${e.slice(0, 3).map((x) => `<li class="break-any">${esc(x)}</li>`).join('')}</ul>${e.length > 3 ? `<details class="why"><summary>${ic('chevron-right', 'i-xs')}Show ${e.length - 3} more</summary><ul class="warnlist" style="color:oklch(var(--bc))">${e.slice(3).map((x) => `<li class="break-any">${esc(x)}</li>`).join('')}</ul></details>` : ''}<p class="meta" style="margin:6px 0 0">These apply to the run as a whole, not to one agent.${kept ? ' Written files are kept.' : ''}</p></div></div>`;
  }
  function generationSection() {
    const s = S.s;
    if (!(ACTIVE.includes(s) || POST.includes(s))) return '';
    const it = items(); const c = counts(it); const done = c.written + c.unchanged;
    const pct = Math.round((done / c.total) * 100);
    let result = '';
    if (DONE_LIKE.includes(s) || s === 'partial' || s === 'run-failed') {
      const rej = s === 'partial' ? 1 : 0;
      const unverified = s === 'run-failed' && g('ver', '1') === '0'; // counts cannot be confirmed: print no counts (design-spec 2.9.4)
      result = unverified ? `<p class="meta" style="margin:0">Counts could not be confirmed.</p>${errBlock()}` : `<div class="stats" aria-label="Outcome counts"><span class="badge badge-ok">${ic('circle-check', 'i-xs')}${c.written} written</span><span class="badge badge-mute">${ic('check', 'i-xs')}${c.unchanged} already current</span>${c.failed ? `<span class="badge badge-err">${ic('circle-alert', 'i-xs')}${c.failed} failed</span>` : ''}${rej ? `<span class="badge badge-warn">${ic('triangle-alert', 'i-xs')}${rej} section rejected</span>` : ''}</div>
        ${rej ? `<p class="meta" style="margin:6px 0 0">A rejected section was replaced with the authored template.</p>` : ''}
        ${errBlock()}<dl class="dl dsd"><dt>Output</dt><dd><code class="mono break-any">.claude/agents/</code></dd><dt>Project guidance</dt><dd>${S.guid === 'saved' ? 'Used by this run' : 'Not used by this run'}</dd></dl>
        ${S.guid === 'late' ? `<p class="meta" style="margin:6px 0 0">Project guidance created after this run started was not used by it.</p>` : ''}`;
    }
    const head = s === 'run-failed' && g('ver', '1') === '0' ? '' : ACTIVE.includes(s) || s === 'cancelled' || s === 'interrupted' || s === 'run-failed'
      ? `<div class="prog ${s === 'done' ? 'done' : ''}" role="progressbar" aria-label="Overall generation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><p class="meta" style="margin:6px 0 0">${done} of ${c.total} items completed${c.failed ? `, ${c.failed} failed` : ''}</p>` : '';
    return sec('gen', 'Generation', s === 'run-failed' && g('ver', '1') === '0' ? '' : `<span class="tnum">${done} of ${c.total}</span>`, `${head}${S.stopUnknown ? '<p class="meta" style="margin:6px 0 0">Last known progress. The run state could not be confirmed.</p>' : ''}${result}${s === 'run-failed' && g('ver', '1') === '0' ? '' : `<ul class="items" aria-label="Agent files">${it.map(itemHtml).join('')}</ul>`}`);
  }

  /* ---------- Next steps (after a finished run) ---------- */
  function nextSection() {
    const s = S.s; if (!(DONE_LIKE.includes(s) || s === 'partial' || (s === 'run-failed' && S.flow))) return '';
    const gq = (extra) => { const q = new URLSearchParams(); for (const k of ['theme', 'w']) if (W.P.has(k)) q.set(k, W.P.get(k)); if (extra) q.set('flow', '1'); const t = q.toString(); return t ? '?' + t : ''; };
    const card = (title, text, btns) => `<div class="status info"><span class="ic">${ic('sparkles', 'i-lg')}</span><div class="grow"><h3>${title}</h3><p>${text}</p><div class="acts">${btns}</div></div></div>`;
    let guid;
    if (S.flow && s === 'run-failed') {
      guid = S.fs === 'skipped'
        ? `<div class="status idle" role="status"><span class="ic">${ic('circle-dashed', 'i-lg')}</span><div class="grow"><h3>Project guidance skipped</h3><p>No guidance run was started. You can generate guidance any time from this card.</p></div></div>`
        : card('Continue to project guidance', 'This run did not produce agents, so setup does not continue by itself. Continue now, or skip guidance.', `<a class="btn btn-outline" href="guidance.html${gq(true)}">Continue to project guidance</a><button class="btn" data-act="set" data-set="fs=skipped">Skip guidance</button>`);
    } else if (S.flow && S.fs !== 'skipped') {
      guid = ''; // countdown or started: the continuation card in the Run section owns the guidance step
    } else {
      guid = card('Project guidance', S.guid === 'saved' ? 'Guidance is saved for this workspace.' : 'Generate project-specific guidance as a separate step. It is not started for you.', `<a class="btn btn-outline" href="guidance.html${gq(false)}">${ic('sparkles', 'i-sm')}${S.guid === 'saved' ? 'Open project guidance' : 'Generate project guidance'}</a>`);
    }
    const qs = `<details class="pv" style="margin-top:8px"><summary>${ic('terminal', 'i-sm')}Quick start<svg class="i i-sm chev" aria-hidden="true"><use href="#i-chevron-right"/></svg></summary><div class="pvb">
      <p><strong>1. Start a development workflow</strong></p><pre class="viewer mono" tabindex="0" aria-label="Command example">/orchestrate Add user authentication</pre><p class="muted">The orchestrator will analyze your task and coordinate specialized agents.</p>
      <p style="margin-top:8px"><strong>2. Available workflow types</strong></p><div class="wrap"><span class="badge badge-outline">FEATURE</span><span class="badge badge-outline">BUGFIX</span><span class="badge badge-outline">REFACTORING</span><span class="badge badge-outline">DOCS</span><span class="badge badge-outline">RESEARCH</span><span class="badge badge-outline">DEVOPS</span></div>
      <p style="margin-top:8px"><strong>3. Example commands</strong></p><pre class="viewer mono" tabindex="0" aria-label="Example commands">/orchestrate Fix login form validation   # BUGFIX
/orchestrate Refactor UserService        # REFACTORING
/orchestrate Create API docs             # DOCUMENTATION</pre><p style="margin-top:8px"><strong>Continue existing tasks</strong></p><pre class="viewer mono" tabindex="0" aria-label="Continue an existing task">/orchestrate TASK_2025_XXX               # Resumes from checkpoint</pre>
      <p style="margin-top:8px"><strong>Pro tips</strong></p><ul class="warnlist"><li>Use <code class="mono">@agent-name</code> to invoke specific agents</li><li>Progress saved in <code class="mono">.ptah/specs/</code></li></ul></div></details>`;
    return sec('next', 'Next steps', '', guid + qs);
  }

  /* ---------- Source ---------- */
  function sourceSection() {
    const reason = S.s === 'rejected' ? 'rejected' : S.s === 'tabmismatch' ? 'tab-mismatch' : S.src;
    const recorded = !PRE.includes(S.s) && !['unchecked', 'checking'].includes(reason);
    return sec('src', 'Context source', '', sourceCard(reason, { recorded, noActions: ACTIVE.includes(S.s) }));
  }

  /* ---------- Model ---------- */
  function modelSection() {
    const s = S.s; const active = ACTIVE.includes(s) || s === 'starting';
    const chatNote = g('cm', 'same') === 'diff' ? `<p class="meta" style="margin:6px 0 0">Chat replies currently use Claude Opus 4.1. This does not change the run.</p>` : '';
    if (active) {
      return sec('model', 'Provider and model', '', `<dl class="dl"><dt>Provider</dt><dd>${W.MODEL.provider}</dd><dt>Model</dt><dd>${W.MODEL.model}</dd></dl><p class="meta" style="margin:8px 0 0">Running with this model. Retries use it. It cannot change while the run is active.</p>${chatNote}`);
    }
    if (['partial', 'run-failed'].includes(s) || DONE_LIKE.includes(s)) {
      return sec('model', 'Provider and model', '', `<dl class="dl"><dt>Provider</dt><dd>${W.MODEL.provider}</dd><dt>Model</dt><dd>${W.MODEL.model}</dd></dl><p class="meta" style="margin:8px 0 0">Used for this run and saved with it. Retries use it. Choose Change selection to start a new run with another model.</p>${chatNote}`);
    }
    const none = S.prov === 'none';
    const resumeLike = ['resume', 'cancelled', 'interrupted'].includes(s);
    return sec('model', 'Provider and model', '', `<label class="fl" for="prov-sel">Provider</label>
      <select id="prov-sel" class="field" ${none ? 'disabled' : ''}>${none ? '<option>No provider connected</option>' : '<option>Anthropic</option><option>OpenRouter</option>'}</select>
      <label class="fl" for="model-sel" style="margin-top:8px">Model</label>
      <select id="model-sel" class="field" ${none ? 'disabled' : ''}>${none ? '<option>-</option>' : '<option>Claude Sonnet 4.5</option><option>Claude Opus 4.1</option>'}</select>
      <p class="meta" style="margin:8px 0 0">${none ? 'Connect a provider in Settings to choose a model.' : resumeLike ? `Resume uses ${esc(MODEL())}, saved with the run. Change it here to resume with another model.` : `This run will use ${esc(MODEL())}. The composer's model selector shows the same value.`}</p>${chatNote}`);
  }

  /* ---------- Agents (selection) ---------- */
  function agentsSection() {
    const s = S.s; const withScore = S.src === 'ok';
    if (ACTIVE.includes(s) || POST.includes(s)) {
      return sec('agents', 'Agents', `<span class="tnum">${RUN_IDS.length} in this run</span>`, `<p class="help">${ACTIVE.includes(s) ? 'The selection is locked while a run is active.' : 'These agents were part of the last run.'}</p><button class="btn btn-outline" ${ACTIVE.includes(s) ? 'aria-disabled="true"' : 'data-act="set" data-set="s=setup"'}>Change selection</button>`);
    }
    if (s === 'loading') return sec('agents', 'Agents', '', '<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>');
    if (s === 'empty') return sec('agents', 'Agents', '', `<div class="status idle"><span class="ic">${ic('users', 'i-lg')}</span><div class="grow"><h3>No agents to show</h3><p>The list could not be loaded. Use Retry in the Run section.</p></div></div>`);
    const rec = AG.filter((a) => a[3] >= 75).length;
    const cats = CATS.map(([k, label]) => {
      const rows = AG.filter((a) => a[2] === k);
      return `<div class="cat" role="group" aria-labelledby="cat-${k}"><div class="cat-h"><span class="label" id="cat-${k}">${label}</span><span class="meta">${rows.length}</span></div>${rows.map((a) => {
        const on = selected.has(a[0]);
        const score = withScore ? `<span class="badge ${a[3] >= 75 ? 'badge-ok' : 'badge-mute'}" aria-label="Relevance ${a[3]} percent${a[3] >= 75 ? ', recommended' : ''}">${a[3]}%</span>` : '';
        return `<div class="ag ${on ? 'on' : ''}" data-row="${a[0]}"><input class="cb" type="checkbox" id="ag-${a[0]}" data-id="${a[0]}" ${on ? 'checked' : ''} aria-label="Select ${esc(a[1])}"><label class="nm" for="ag-${a[0]}">${esc(a[1])}</label><span>${score}</span><p class="ds">${esc(a[4])}</p>
          ${withScore && a[5].length ? `<details class="why"><summary>${ic('chevron-right', 'i-xs')}Why recommended</summary><ul>${a[5].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}</div>`;
      }).join('')}</div>`;
    }).join('');
    const n = selected.size;
    return sec('agents', 'Agents', '', `<div class="row-flex" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><div class="wrap"><button class="btn btn-outline" data-act="sel-rec">${ic('check', 'i-sm')}Select Recommended</button><button class="btn" data-act="sel-none">Deselect All</button></div>
      <div class="wrap"><span class="badge badge-ghost" id="cnt-sel">${ic('check', 'i-xs')}${n} selected</span>${withScore ? `<span class="badge badge-outline" id="cnt-rec">${rec} recommended</span>` : ''}</div></div>
      ${withScore ? '' : `<p class="help" style="margin:8px 0 0">Catalog list. Every agent is shown without a workspace score.</p>`}${cats}`);
  }

  /* ---------- Community packs ---------- */
  function packsSection() {
    const pk = S.pk;
    const meta = '<span>2 installed</span>';
    let body = '';
    if (pk === 'closed') body = `<p class="help">Install extra agents shared by the community. They are added to your workspace right away.</p><button class="btn btn-outline" data-act="packs">${ic('globe', 'i-sm')}Browse community packs</button>`;
    else if (pk === 'loading') body = `<div role="status" class="help">${ic('loader-circle', 'i-sm spin')} Loading community packs...</div><div class="skel"></div><div class="skel"></div>`;
    else if (pk === 'error') body = `<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Community packs did not load</h3><p style="color:oklch(var(--bc))">Failed to load community packs: Network request failed. Check your internet connection.</p><div class="acts"><button class="btn btn-outline" data-act="packs">${ic('refresh-cw', 'i-sm')}Retry</button></div></div></div>`;
    else if (pk === 'empty') body = `<div class="status idle"><span class="ic">${ic('globe', 'i-lg')}</span><div class="grow"><h3>No Community Packs</h3><p>No community agent packs are available at the moment.</p></div></div>`;
    else {
      const rows = [['Release captain', 'Plans releases and writes changelogs.', 'installed'], ['Docs scribe', 'Keeps README and guides in step with code.', 'idle'], ['Migration planner', 'Plans database migrations safely.', 'error'], ['Perf profiler', 'Finds hot paths and suggests fixes.', 'installing']];
      const act = (st) => ({ installed: `<span class="badge badge-ok">${ic('check', 'i-xs')}Installed</span>`, installing: `<span class="meta" role="status">${ic('loader-circle', 'i-sm spin')}<span class="sr-only">Installing</span></span>`, error: `<button class="btn btn-outline" data-act="install">${ic('rotate-cw', 'i-sm')}Retry</button>`, idle: `<button class="btn btn-outline" data-act="install">Install</button>` }[st]);
      body = `<div class="pack"><button class="pack-h" aria-expanded="true">${ic('package', 'i-sm')}<span style="flex:1;min-width:0"><span class="act-t" style="display:block">Ptah Community</span><span class="act-d" style="display:block">Agents shared by the Ptah community.</span></span><span class="meta tnum">4 agents</span>${ic('chevron-down', 'i-sm')}</button>
        <div class="pack-b"><div class="row-flex" style="justify-content:flex-end;margin-bottom:4px"><button class="btn btn-outline" data-act="install">Install All</button></div>${rows.map(([n, d, st]) => `<div class="pa"><div style="flex:1;min-width:0"><div class="nm">${n}</div><p class="ds">${d}</p>${st === 'error' ? `<p class="err-t">${ic('circle-alert', 'i-xs')}Install failed.</p>` : ''}</div><div>${act(st)}</div></div>`).join('')}</div></div>
        <div class="pack"><button class="pack-h" aria-expanded="false">${ic('package', 'i-sm')}<span style="flex:1;min-width:0"><span class="act-t" style="display:block">Solo SaaS Pack</span><span class="act-d" style="display:block">Agents for one-person SaaS teams.</span></span><span class="meta tnum">3 agents</span>${ic('chevron-right', 'i-sm')}</button></div>`;
    }
    return sec('packs', 'Community packs', meta, body);
  }

  /* ---------- chat ---------- */
  function chatHtml() {
    const s = S.s; const stop = ['starting', 'running', 'running-fail', 'retrying', 'cancelling'].includes(s) && !S.stopUnknown;
    const quiet = s === 'running-quiet';
    let t = '';
    const ctx = S.src === 'ok' ? 'Using the verified analysis from 14 Oct 2026.' : 'No analysis in use. Reading the workspace: package.json, nx.json, tsconfig, folder layout.';
    if (PRE.includes(s) && s !== 'starting') t = `<div class="work" style="margin:auto;text-align:center;flex-direction:column"><span class="muted t13">New tab. Generation output streams here once you start.</span></div>`;
    else if (s === 'starting') t = W.work('Starting generation');
    else {
      t += W.msgA(`<p>${ctx}</p><ul><li>Detected Angular 22, Nx monorepo, Tailwind and DaisyUI.</li><li>Writing agent files to <code class="mono">.claude/agents/</code>.</li></ul>`);
      if (s !== 'run-failed') t += W.msgA(`<ul><li>project-manager: written</li><li>software-architect: written</li>${['running', 'running-fail', 'retrying', 'cancelling'].includes(s) ? '<li>team-leader: ' + (s === 'running' ? 'written' : s === 'cancelling' ? 'in progress' : 'failed validation') + '</li>' : ''}</ul>`);
      if (stop) t += W.work(s === 'cancelling' ? 'Stopping' : 'Working: generating backend-developer');
      if (quiet) t += W.msgA('<p>backend-developer is still being generated in the background. The chat reply has finished.</p>');
      if (s === 'cancelled') t += W.msgA('<p>Generation stopped by you. 2 of 7 items were written and kept.</p>');
      if (s === 'run-failed') t += W.msgA('<p>The run stopped with errors before any item finished.</p>');
      if (s === 'interrupted') t += W.msgA('<p>The connection closed before the run finished. 2 of 7 items were written and kept.</p>');
      if (s === 'partial') t += W.msgA('<p>Finished: 4 written, 1 already current, 2 failed. You can ask me about any failure.</p>');
      if (DONE_LIKE.includes(s)) t += W.msgA('<p>Done. 6 agents written and 1 already current. Ask me to explain any of them.</p>');
    }
    return W.chat({ thread: t, stop, model: g('cm', 'same') === 'diff' && (ACTIVE.includes(s) || POST.includes(s)) ? 'Claude Opus 4.1' : undefined });
  }

  /* ---------- dialog ---------- */
  function dialog() {
    const s = S.s; if (!s.startsWith('confirm')) return '';
    const sel = [...selected]; const list = sel.length ? sel : RUN_IDS;
    let body = '';
    if (s === 'confirm-loading') body += `<p role="status" class="muted t12">Checking generation targets...</p>`;
    if (s === 'confirm-changed') body += `<div class="status warn" role="alert" style="margin-bottom:10px"><span class="ic">${ic('triangle-alert', 'i-sm')}</span><div class="grow"><p style="margin:0;color:oklch(var(--bc))">Targets changed since preview. Review the new list and confirm again.</p></div></div>`;
    if (s === 'confirm-error') body += `<div class="status warn" role="alert" style="margin-bottom:10px"><span class="ic">${ic('triangle-alert', 'i-sm')}</span><div class="grow"><p style="margin:0;color:oklch(var(--bc))">Preview unavailable: the workspace folders could not be read. You can still generate without a preview.</p></div></div>`;
    if (s !== 'confirm-loading' && s !== 'confirm-error') {
      body += `<div class="status warn" role="alert" style="margin-bottom:10px"><span class="ic">${ic('triangle-alert', 'i-sm')}</span><div class="grow"><p style="margin:0;color:oklch(var(--bc))">2 files already exist and will be overwritten.</p></div></div>`;
      body += list.map((id, i) => `<section style="margin-bottom:12px"><h3 style="margin:0 0 4px;font-size:12px;font-weight:600" class="mono">${id}</h3><ul style="list-style:none;margin:0;padding:0;font-size:12px"><li style="padding:2px 0"><code class="mono break-any">.claude/agents/${id}.md</code>${i === 2 || i === 4 ? ` <span class="badge badge-warn badge-sm">will overwrite</span>` : ''}</li></ul>
        ${i === 0 ? `<div style="border-top:1px solid var(--surface-border);margin-top:6px;padding-top:6px;font-size:12px" data-testid="conditional-files"><span class="muted">May also write, if CLAUDE.md has no agent section</span><br><code class="mono break-any">CLAUDE.md</code> <span class="badge badge-warn badge-sm">will overwrite if written</span></div>` : ''}</section>`).join('');
    }
    const confirmLabel = s === 'confirm-error' ? 'Generate without preview' : 'Confirm Generate';
    const busy = s === 'confirm-loading';
    return W.dialog({ wide: true, title: 'Preview agent generation', body: `<p class="muted t12" style="margin:0 0 4px">Files this run will write in ${esc(W.WS)}.</p><p class="muted t12" style="margin:0 0 10px">Model: ${esc(MODEL())}</p>${body}`,
      buttons: `<button class="btn btn-outline" id="dlg-cancel" data-act="close-dlg">Cancel</button><button class="btn btn-primary" ${busy ? 'aria-disabled="true" aria-busy="true"' : 'data-act="set" data-set="s=starting"'} id="dlg-ok">${busy ? ic('loader-circle', 'i-sm spin') : ''}${confirmLabel}</button>` });
  }

  /* ---------- page ---------- */
  function peekStatus() {
    const s = S.s;
    if (s === 'blocked' || s === 'rejected' || s === 'tabmismatch') return { cls: 'err', icon: 'circle-alert', text: 'Cannot start' };
    if (s === 'resume') return { cls: 'run', icon: 'refresh-cw', text: 'Resume available' };
    if (S.stopUnknown) return { cls: 'need', icon: 'triangle-alert', text: 'Unconfirmed' };
    if (ACTIVE.includes(s) || s === 'starting') return { cls: 'run', icon: 'loader-circle', text: s === 'cancelling' ? 'Stopping' : s === 'starting' ? 'Starting' : 'Running' };
    if (s === 'run-failed') return { cls: 'err', icon: 'circle-alert', text: 'Failed' };
    if (s === 'cancelled' || s === 'interrupted' || s === 'partial') return { cls: 'need', icon: 'triangle-alert', text: 'Needs attention' };
    if (DONE_LIKE.includes(s)) return { cls: 'ok', icon: 'circle-check', text: 'Done' };
    if (selected.size > 0 && s === 'setup') return { cls: 'ok', icon: 'circle-check', text: 'Ready to generate' };
    return null;
  }
  function summary() {
    const s = S.s; const c = counts(items());
    if (s === 'run-failed' && g('ver', '1') === '0') return 'result not confirmed';
    if (ACTIVE.includes(s) || POST.includes(s)) return `${c.written + c.unchanged} of ${c.total} complete`;
    return `${selected.size} of ${AG.length} selected`;
  }
  function render() {
    const sbOpen = W.sbInit() === 'open';
    const dot = ACTIVE.includes(S.s) ? 'run' : DONE_LIKE.includes(S.s) ? 'done' : S.s === 'run-failed' ? 'err' : ['partial', 'cancelled', 'interrupted'].includes(S.s) ? 'need' : '';
    return `<div class="page" data-sb="${sbOpen ? 'open' : 'closed'}" ${S.s.startsWith('confirm') ? 'data-dialog="open"' : ''}>
      ${W.tabbar([{ name: 'Chat 1' }, { name: 'Agent Generation', on: true, dot }])}
      ${W.header({ title: 'Generate agents', workflow: 'Agent Generation', summary: summary(), sbOpen, toggleName: 'agent generation' })}
      ${W.peek({ label: 'Agent generation', meta: summary(), status: peekStatus(), sbOpen, stop: S.s === 'cancelling' || S.stopUnconf ? 'busy' : S.stopUnknown ? false : ['starting', 'running', 'running-quiet', 'running-fail', 'retrying'].includes(S.s) })}
      <div class="body"><div class="chatcol" id="chatcol" data-inert-with-dialog>${chatHtml()}</div>
      ${W.sidebar({ name: 'Agent generation', summary: summary(), sections: [runSection(), generationSection(), nextSection(), sourceSection(), modelSection(), agentsSection(), packsSection()] })}</div>
      ${dialog()}</div>`;
  }

  /* interactions */
  function refreshCounts() {
    const n = selected.size;
    const set = (id, t) => { const el = document.getElementById(id); if (el) el.innerHTML = t; };
    set('cnt-sel', `${ic('check', 'i-xs')}${n} selected`);
    const rp = document.getElementById('run-p'); if (rp) rp.textContent = n === 0 ? 'Select at least one agent to continue.' : `${n} agent${n === 1 ? '' : 's'} selected.`;
    const rh = document.getElementById('run-h'); if (rh) rh.textContent = n === 0 ? 'Choose agents' : 'Ready to generate';
    const gb = document.getElementById('gen-btn');
    if (gb && S.s === 'setup') { gb.innerHTML = ic('wand-sparkles', 'i-sm') + 'Generate ' + (n === 0 ? 'Agents' : n + ' Agent' + (n === 1 ? '' : 's')); if (n === 0) { gb.setAttribute('aria-disabled', 'true'); gb.removeAttribute('data-act'); } else { gb.removeAttribute('aria-disabled'); gb.dataset.act = 'set'; gb.dataset.set = 's=confirm'; } }
    const sm = summary(); for (const el of document.querySelectorAll('.hdr .summary, #peek .meta, .sb-head .meta')) el.textContent = sm;
    for (const r of document.querySelectorAll('.ag')) r.classList.toggle('on', r.querySelector('input').checked);
  }
  W.acts['sel-rec'] = () => { selected = new Set(AG.filter((a) => a[3] >= 75 || S.src !== 'ok').map((a) => a[0])); for (const i of document.querySelectorAll('.ag input')) i.checked = selected.has(i.dataset.id); refreshCounts(); };
  W.acts['sel-none'] = () => { selected = new Set(); for (const i of document.querySelectorAll('.ag input')) i.checked = false; refreshCounts(); };
  W.acts.packs = () => { W.setParam('pk', 'loading'); W.render(); setTimeout(() => { W.setParam('pk', 'list'); W.render(); }, 700); };
  W.acts.install = (b) => { const w = b.parentElement; b.outerHTML = `<span class="meta" role="status">${ic('loader-circle', 'i-sm spin')}<span class="sr-only">Installing</span></span>`; setTimeout(() => { const sp = w.querySelector('.meta'); if (sp) sp.outerHTML = `<span class="badge badge-ok">${ic('check', 'i-xs')}Installed</span>`; }, 700); };

  let cdTimer = null;
  function startCountdown() { clearInterval(cdTimer); if (!(S.flow && S.fs === 'countdown' && (S.s === 'done' || S.s === 'partial'))) return; let n = 5; cdTimer = setInterval(() => { n -= 1; const el = document.getElementById('cd'); if (!el) { clearInterval(cdTimer); return; } if (n <= 0) { clearInterval(cdTimer); W.setParam('fs', 'started'); W.render(); } else el.textContent = String(n); }, 1000); }
  W.mount({
    page: 'Generate agents',
    dialogCancelTo: 'setup',
    controls: [
      { k: 's', label: 'State', opts: [['setup', 'setup'], ['loading', 'loading'], ['empty', 'list unavailable'], ['resume', 'resume offer'], ['confirm', 'confirm targets'], ['confirm-loading', 'confirm: checking'], ['confirm-changed', 'confirm: targets changed'], ['confirm-error', 'confirm: preview unavailable'], ['starting', 'starting'], ['rejected', 'rejected: foreign analysis'], ['tabmismatch', 'rejected: wrong workspace'], ['blocked', 'blocked: other workspace'], ['running', 'running'], ['running-quiet', 'running, chat idle'], ['running-fail', 'running, item failed'], ['retrying', 'retry waiting'], ['cancelling', 'stopping'], ['stop-failed', 'stop refused, run still active'], ['stop-unconfirmed', 'stop unconfirmed, checking'], ['stop-unknown', 'run state unknown'], ['cancelled', 'cancelled'], ['stop-late', 'finished before the stop'], ['interrupted', 'interrupted'], ['run-failed', 'run failed (no item)'], ['partial', 'finished with errors'], ['partial-flow', 'finished with errors, setup flow'], ['done', 'done'], ['done-flow', 'done, guidance starts in 5 s'], ['done-flow-started', 'done, guidance started'], ['done-flow-skipped', 'done, guidance skipped']] },
      { k: 'src', label: 'Source', opts: [['', 'by state'], ['ok', 'fresh analysis'], ['no-analysis', 'no-analysis'], ['unreadable', 'unreadable'], ['legacy-v3', 'legacy-v3'], ['incomplete', 'incomplete'], ['expired', 'expired'], ['workspace-changed', 'workspace-changed'], ['output-mismatch', 'output-mismatch'], ['not-latest', 'not the latest'], ['failed', 'lookup failed'], ['checking', 'checking'], ['unchecked', 'not checked yet']] },
      { k: 'pk', label: 'Packs', opts: [['closed', 'closed'], ['loading', 'loading'], ['list', 'list'], ['empty', 'empty'], ['error', 'error']] },
      { k: 'guid', label: 'Guidance', opts: [['none', 'none yet'], ['saved', 'saved before run'], ['late', 'created after run']] },
      { k: 'prov', label: 'Provider', opts: [['ok', 'connected'], ['none', 'none connected']] },
      { k: 'cm', label: 'Chat model', opts: [['same', 'same as run'], ['diff', 'chat uses another']] },
      { k: 'err', label: 'Run errors', opts: [['0', 'none'], ['1', 'show list'], ['many', '7 errors']] },
      { k: 'gt', label: 'Guidance tab', opts: [['tab', 'already open'], ['new', 'none yet (created at start)']] },
      { k: 'gm', label: 'Guidance tab model', opts: [['same', 'same as agent run'], ['diff', 'guidance tab uses another']] },
      { k: 'ver', label: 'Outcome check', opts: [['1', 'verified'], ['0', 'could not be confirmed']] },
      { k: 'flow', label: 'Setup flow', opts: [['0', 'independent'], ['1', 'part of setup']] },
      { k: 'sel', label: 'Selection', opts: [['some', '7 selected'], ['none', 'none selected']] },
    ],
    render: () => { initSelOnce(); setTimeout(startCountdown, 0); return render(); },
    onChange: (e) => { const i = e.target.closest('.ag input'); if (i) { i.checked ? selected.add(i.dataset.id) : selected.delete(i.dataset.id); refreshCounts(); } },
  });
  function initSelOnce() { /* selection survives re-render; changing the Selection control resets it */ }
  document.addEventListener('change', (e) => { if (e.target.matches('select[data-ctl="sel"]')) { initSel(); W.render(); } });
})();
