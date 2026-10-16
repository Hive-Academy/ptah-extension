/* TASK_2026_649 prototype: renders the builder page (index.html) from query-string state. Example data only. */
(function () {
  const P = new URLSearchParams(location.search);
  const g = (k, d) => (P.has(k) ? P.get(k) : d);
  const S = {
    theme: g('theme', 'dark'), kind: g('kind', 'configure'), chat: g('chat', 'streaming'), apply: g('apply', 'partial'),
    init: g('init', 'ok'), hydr: g('hydr', 'ok'), sb: g('sb', ''), pin: g('pin', '0'), dlg: g('dlg', ''), ai: g('ai', 'idle'),
    aside: g('aside', ''), health: g('health', 'ok'), preset: g('preset', ''), sess: g('sess', ''), stack: g('stack', 'warn'),
    notice: g('notice', ''), draft: g('draft', '0'), launch: g('launch', ''), empty: g('empty', '0'), files: g('files', 'short'), page: g('page', ''),
  };
  document.documentElement.setAttribute('data-theme', S.theme === 'light' ? 'anubis-light' : 'anubis');
  const NP = S.kind === 'newproject';
  const ic = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

  const title = NP ? 'New Project Setup' : 'AI Team Builder';
  const wf = NP ? 'New Project' : 'Configure Harness';
  const ws = NP ? 'invoice-tracker' : 'acme-analytics';
  const hasCfg = S.empty !== '1' && S.hydr !== 'unavailable' && S.hydr !== 'loading' && S.hydr !== 'failed';
  const complete = ['ready', 'blocked', 'applying', 'applied', 'error', 'changed'].includes(S.apply);
  const processing = S.chat === 'streaming' || S.apply === 'blocked';
  const cfgSummary = hasCfg ? (NP ? '3 agents, 5 skills' : '4 agents, 3 skills') : '';

  /* ---------------- chat stand-in ---------------- */
  function chatHtml() {
    const u1 = NP
      ? 'New project: Invoice tracker for freelancers\nAudience: freelancers, 1-5 clients\nPlatform: Web app\nStack: .NET + Angular\nConstraints: EU hosting, GDPR'
      : 'I run a small B2B analytics SaaS on my own. I need agents for code review, releases and docs, and I use GitHub + Postgres.';
    let t = '';
    if (S.chat === 'empty') {
      t = `<div class="work" style="margin:auto;text-align:center;flex-direction:column"><span class="muted t13">New session. Your first message starts the builder.</span></div>`;
    } else {
      t += `<div class="msg-u">${esc(u1)}</div>`;
      t += `<div class="msg-a"><p>${NP ? 'Good start. I enabled the SaaS and .NET plugins and checked your toolchain. Before I pick a layout, one question.' : 'Thanks. I will plan this with you, then propose a team. First, how do you ship today?'}</p>${NP ? '' : '<ul><li>Code review: reviewer agent with your lint rules</li><li>Releases: release captain + changelog skill</li></ul>'}</div>`;
      if (S.chat === 'ask') {
        t += `<div class="card need" role="group" aria-label="Question from the agent"><h3>${NP ? 'Which database should the API use?' : 'Which CI do you use?'}</h3><button class="opt">${NP ? 'PostgreSQL' : 'GitHub Actions'}</button><button class="opt">${NP ? 'SQL Server' : 'GitLab CI'}</button><button class="opt">Something else</button></div>`;
        t += `<div class="card need" role="group" aria-label="Permission request"><h3>Allow the agent to search the skills registry?</h3><div class="muted t12">ptah_harness_search_skills - query: "release notes"</div><div class="acts"><button class="btn btn-outline">Allow</button><button class="btn btn-outline">Deny</button></div></div>`;
      } else if (S.chat === 'streaming') {
        t += `<div class="work"><svg class="i i-sm spin" aria-hidden="true"><use href="#i-loader-circle"/></svg>Working: proposing a configuration</div>`;
      }
    }
    const stop = S.chat === 'streaming';
    return `<div class="standin chatcol-in" style="display:flex;flex-direction:column;flex:1;min-height:0">
      <div class="thread" role="log" aria-label="Conversation transcript" tabindex="0">${t}</div>
      <div class="composer"><div class="cbox"><div class="ph">${S.chat === 'empty' ? 'Ask a question or describe a task...' : 'Reply to the agent...'}</div>
        <div class="crow"><button class="btn sq" aria-label="Attach files or images">${ic('paperclip')}</button>
        <button class="sel" aria-label="Select model">Sonnet 4.5 ${ic('chevron-down', 'i-xs')}</button><button class="sel" aria-label="Select reasoning effort level">Medium ${ic('chevron-down', 'i-xs')}</button><span class="sp"></span>
        ${stop ? `<button class="btn sq" aria-label="Stop generating" style="border-color:oklch(var(--bc)/.5)">${ic('square', 'i-sm')}</button>` : `<button class="btn btn-primary sq" aria-label="Send message">${ic('send', 'i-sm')}</button>`}</div></div></div></div>`;
  }

  /* ---------------- sidebar sections ---------------- */
  const applyTarget = `<p class="meta" style="margin:8px 0 0">Writes into <strong>${ws}</strong>${S.pin === '1' ? ' (where this build started)' : ''}</p>`;
  const paths = NP
    ? ['CLAUDE.md', '.claude/agents/architect.md', '.claude/agents/dotnet-api-developer.md', '.claude/agents/angular-ui-developer.md', '.claude/skills/ef-core-migrations/SKILL.md', '.ptah/harness/presets/invoice-tracker.json', '.mcp.json']
    : ['CLAUDE.md', '.claude/agents/architect.md', '.claude/agents/release-captain.md', '.claude/agents/docs-scribe.md', '.claude/skills/release-notes/SKILL.md', '.ptah/harness/presets/solo-saas-developer.json', '.mcp.json'];
  function applySection() {
    if (S.init === 'loading') return '';
    if (S.init === 'error') return '';
    if (!hasCfg && !['applied', 'error'].includes(S.apply)) return '';
    const head = `<div class="sec-head"><h3 class="label" id="h-apply">Apply</h3></div>`;
    const btn = (label, cls = 'btn-primary', extra = '') => `<button class="btn ${cls} btn-wide" ${extra}>${label}</button>`;
    let b = '';
    switch (S.apply) {
      case 'none': return '';
      case 'partial':
        b = `<p class="help">The preview is partial. You can apply what is here now, or keep chatting to finish it.</p>${btn('Apply to Workspace', 'btn-outline')}${applyTarget}`; break;
      case 'ready':
        b = `<div class="status done"><span class="ic">${ic('circle-check', 'i-lg')}</span><div class="grow"><h3>Configuration looks ready</h3><p>Review the preview, then apply it to the workspace.</p></div></div><div style="margin-top:10px">${btn('Apply to Workspace')}</div>${applyTarget}`; break;
      case 'blocked':
        b = `<div class="status info"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><h3>Waiting for the agent</h3><p id="blk">Apply is available when the agent finishes its turn.</p></div></div><div style="margin-top:10px">${btn('Apply to Workspace', 'btn-outline', 'aria-disabled="true" aria-describedby="blk"')}</div>`; break;
      case 'applying':
        b = `<div role="status" class="meta" style="margin-bottom:8px">Applying the configuration...</div>${btn('<svg class="i i-sm spin" aria-hidden="true"><use href="#i-loader-circle"/></svg>Applying...', 'btn-primary', 'aria-disabled="true" aria-busy="true"')}`; break;
      case 'changed':
        b = `<div class="status info"><span class="ic">${ic('info', 'i-lg')}</span><div class="grow"><h3>Preview changed since the last apply</h3><p>7 files were written at 14:02. Apply again to update them.</p></div></div><div style="margin-top:10px">${btn('Apply to Workspace')}</div>${applyTarget}`; break;
      case 'error':
        b = `<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Apply failed</h3><p>Could not write .claude/agents/architect.md: the folder is read-only.</p><div class="acts"><button class="btn btn-outline">Dismiss</button></div></div></div><div style="margin-top:10px">${btn('Try again')}</div>`; break;
      case 'applied': {
        const shown = S.files === 'all' ? paths : paths.slice(0, 5);
        b = `<div class="status done" role="status"><span class="ic">${ic('circle-check', 'i-lg')}</span><div class="grow"><h3>Applied to ${ws}</h3><p>${paths.length} files written.</p></div></div>
          <ul class="files" aria-label="Files written">${shown.map((p) => `<li class="mono break-any">${ic('file-check', 'i-xs')}<span>${esc(p)}</span></li>`).join('')}</ul>
          <div class="row-flex" style="margin-top:8px;justify-content:space-between">${S.files === 'all' ? '<span class="meta">All 7 shown</span>' : `<button class="btn" style="padding:0 8px">Show all ${paths.length}</button>`}<button class="btn" aria-label="Copy the list of written files">${ic('copy', 'i-sm')}Copy list</button></div>
          <div class="status warn" role="status" style="margin-top:10px">${'<span class="ic">' + ic('triangle-alert', 'i-lg') + '</span>'}<div class="grow"><h3>2 warnings</h3><ul class="warnlist"><li>CLAUDE.md already existed. Your Ptah section was merged, nothing else changed.</li><li>MCP server "postgres" needs DATABASE_URL before it can start.</li></ul></div></div>
          ${healthLine()}
          <div class="row-flex" style="margin-top:10px"><button class="btn">Dismiss result</button></div>`;
        break; }
    }
    return `<section class="sec" aria-labelledby="h-apply">${head}${b}</section>`;
  }
  function healthLine() {
    const h = S.health;
    if (h === 'none') return '';
    const body = h === 'loading' ? `<span class="act-s run" style="margin:0"><svg class="i i-sm spin" aria-hidden="true"><use href="#i-loader-circle"/></svg>Checking harness health...</span>`
      : h === 'issues' ? `<span style="color:var(--state-ink-need)">${ic('triangle-alert', 'i-sm')}</span><span><strong>Health: 2 issues need repair</strong> <button class="btn" style="min-height:24px;padding:0 6px;text-decoration:underline">Open in Dashboard</button></span>`
        : `<span style="color:var(--state-ink-done)">${ic('heart-pulse', 'i-sm')}</span><span><strong>Health: all checks pass</strong> <span class="muted">checked just now</span></span>`;
    return `<div class="row-flex t12" role="status" style="margin-top:10px;align-items:flex-start;gap:6px">${body}</div>`;
  }

  function stackSection() {
    if (!NP) return '';
    const tcOk = S.stack === 'ok';
    const tc = tcOk
      ? `<div class="tc"><span style="color:var(--state-ink-done)">${ic('circle-check', 'i-sm')}</span><div><strong>.NET SDK 9.0.100</strong> <span class="muted">meets 8.0+</span><div class="mono muted t11">dotnet --version</div></div></div>`
      : `<div class="tc"><span style="color:var(--state-ink-need)">${ic('triangle-alert', 'i-sm')}</span><div><strong>.NET SDK 7.0.20</strong> <span class="muted">older than the 8.0 minimum</span><div class="mono muted t11">dotnet --version</div><div class="t12" style="margin-top:2px">Install .NET SDK 8 or newer from dotnet.microsoft.com/download.</div></div></div>`;
    return `<section class="sec" aria-labelledby="h-stack"><div class="sec-head"><h3 class="label" id="h-stack">Stack profile</h3><span class="meta">from project setup</span></div>
      ${S.hydr === 'stackgone' ? `<div class="status info" role="status"><span class="ic">${ic('info', 'i-lg')}</span><div class="grow"><p style="margin:0">Setup details are not available for this session. The agent still has them.</p></div></div>` : `<dl class="dl">
        <dt>Plugins on</dt><dd class="wrap"><span class="badge-outline badge">${ic('check', 'i-xs')}ptah-nx-saas</span><span class="badge-outline badge">${ic('check', 'i-xs')}ptah-dotnet</span></dd>
        <dt>Not installed</dt><dd class="wrap"><span class="badge-outline badge warn" title="Marketplace dotnet/skills, plugin dotnet-agent-skills">${ic('triangle-alert', 'i-xs')}dotnet/skills: dotnet-agent-skills</span></dd>
        <dt>Skills</dt><dd><span class="tnum">14 available</span><div class="wrap" style="margin-top:4px"><span class="badge-outline badge">nx-workspace-architect</span><span class="badge-outline badge">angular-frontend-patterns</span><span class="badge-outline badge">ef-core-migrations</span><button class="btn" style="min-height:24px;padding:0 6px">+11 more</button></div></dd>
        <dt>Toolchain</dt><dd>${tc}</dd></dl>`}</section>`;
  }

  function previewSection() {
    const head = `<div class="sec-head"><h3 class="label" id="h-prev">Preview</h3><span class="meta">${S.hydr === 'restored' ? `<span role="status">${ic('history', 'i-xs')} Restored after reload</span>` : cfgSummary}</span></div>`;
    let b = '';
    if (S.init === 'loading' || S.hydr === 'loading') {
      b = `<div role="status" aria-busy="true"><span class="sr-only">Restoring configuration</span><div class="skel"></div><div class="skel"></div><div class="skel"></div></div><p class="meta" style="margin:8px 0 0">${S.hydr === 'loading' ? 'Restoring the configuration from your last session...' : 'Initializing AI Team Builder...'}</p>`;
    } else if (S.hydr === 'unavailable') {
      b = `<div class="status info" role="status"><span class="ic">${ic('info', 'i-lg')}</span><div class="grow"><h3>Saved configuration unavailable</h3><p>The configuration saved for this session has expired or was cleared, so the preview is empty. Your conversation is intact.</p><div class="acts"><button class="btn btn-outline">Ask the agent to propose it again</button></div></div></div>`;
    } else if (S.hydr === 'failed') {
      b = `<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Could not restore the configuration</h3><p>Something went wrong while loading it. Your conversation is not affected.</p><div class="acts"><button class="btn btn-outline">Retry</button></div></div></div>`;
    } else if (!hasCfg) {
      b = `<p class="help" style="text-align:center;padding:12px 0 4px">No configuration yet. ${NP ? 'Answer the agent in the chat; the plan' : 'Start by telling the agent what you are building in the chat: who the team is for and which tools you use. The agents, skills, prompt and MCP servers'} will appear here as the agent proposes them.</p>`;
    } else {
      const open = (x) => (x ? 'open' : '');
      b = `<details class="pv" ${open(1)}><summary>${ic('user', 'i-sm ico-p')}Persona${ic('chevron-right', 'i-sm chev')}</summary><div class="pvb"><p><strong>${NP ? 'Solo founder, invoicing SaaS' : 'Solo SaaS developer'}</strong></p><p class="muted">${NP ? 'Builds and runs the product alone; needs speed and an audit trail.' : 'Builds and ships a B2B analytics product alone; needs review, release and docs help.'}</p><ul class="goals muted"><li>Ship weekly</li><li>Keep CI green</li><li>Document decisions</li></ul></div></details>
        <details class="pv"><summary>${ic('bot', 'i-sm ico-p')}${NP ? 3 : 4} Agents <span class="badge-outline badge badge-sm">+2 custom</span>${ic('chevron-right', 'i-sm chev')}</summary><div class="pvb wrap"><span class="badge-outline badge">architect</span><span class="badge-outline badge">${NP ? 'dotnet-api-developer' : 'backend-developer'}</span><span class="badge-outline badge">${NP ? 'angular-ui-developer' : 'senior-tester'}</span>${NP ? '' : '<span class="badge-outline badge">code-reviewer</span>'}</div></details>
        <details class="pv"><summary>${ic('sparkles', 'i-sm ico-p')}${NP ? 5 : 3} Skills ${NP ? '' : '<span class="badge-outline badge badge-sm">1 custom</span>'}${ic('chevron-right', 'i-sm chev')}</summary><div class="pvb wrap"><span class="badge-outline badge">${NP ? 'ef-core-migrations' : 'release-notes'}</span><span class="badge-outline badge">nx-workspace-architect</span><span class="badge-outline badge">technical-content-writer</span></div></details>
        <details class="pv"><summary>${ic('file-text', 'i-sm ico-p')}System Prompt${ic('chevron-right', 'i-sm chev')}</summary><div class="pvb muted">You are the engineering partner for a one-person analytics SaaS. Prefer small reviewed changes, keep CI green...</div></details>
        <details class="pv"><summary>${ic('server', 'i-sm ico-p')}2 MCP Servers${ic('chevron-right', 'i-sm chev')}</summary><div class="pvb wrap"><span class="badge-outline badge">github</span><span class="badge-outline badge">postgres</span></div></details>`;
    }
    return `<section class="sec" aria-labelledby="h-prev">${head}${b}</section>`;
  }

  function aiRow(id, t, d, o) {
    const dis = o.disabled;
    const st = o.state;
    let status = '', body = '';
    if (st === 'busy') status = `<span class="act-s run" role="status"><svg class="i i-sm spin" aria-hidden="true"><use href="#i-loader-circle"/></svg>Working...</span>`;
    if (st === 'result') status = `<span class="act-s done">${ic('circle-check', 'i-sm')}Ready</span>`;
    if (st === 'error') status = `<span class="act-s" style="color:var(--state-ink-err)">${ic('circle-alert', 'i-sm')}<span style="color:oklch(var(--bc))">Failed</span></span>`;
    if (dis) body = '';
    if (st === 'busy') body = `<div class="act-body"><p class="muted" style="margin:0">${o.busyText}</p></div>`;
    if (st === 'result') body = `<div class="act-body">${o.result}<div class="acts">${o.add ? '<button class="btn btn-outline">Add to preview</button>' : ''}${o.copy ? `<button class="btn btn-outline" aria-label="Copy ${esc(t)} result">${ic('copy', 'i-sm')}Copy</button>` : ''}<button class="btn">Dismiss</button></div></div>`;
    if (st === 'error') body = `<div class="act-body"><div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>${esc(t)} failed</h3><p>${o.err}</p><div class="acts"><button class="btn btn-outline">Try again</button><button class="btn">Dismiss</button></div></div></div></div>`;
    if (st === 'input') body = `<div class="act-body"><label class="fl" for="in-${id}">Describe the product or paste a PRD</label><textarea id="in-${id}" class="field" placeholder="e.g. A multi-tenant invoicing app for agencies..."></textarea><div class="acts"><button class="btn btn-outline">Analyze</button><button class="btn">Cancel</button></div></div>`;
    const desc = dis ? `<span class="act-d" id="d-${id}">${o.reason}</span>` : `<span class="act-d">${d}</span>`;
    return `<div class="act" ${st === 'busy' ? 'aria-busy="true"' : ''}><button class="act-btn" ${dis || ['busy'].includes(st) ? 'aria-disabled="true"' : ''} ${dis ? `aria-describedby="d-${id}"` : ''} ${['result', 'error', 'input', 'busy'].includes(st) ? 'aria-expanded="true"' : ''}><span class="ico-p">${ic(o.icon, 'i-lg')}</span><span><span class="act-t" style="display:block">${t}</span>${desc}</span>${status}</button>${body}</div>`;
  }
  function aiSection() {
    if (S.init === 'loading') return `<section class="sec" aria-labelledby="h-ai"><div class="sec-head"><h3 class="label" id="h-ai">AI helpers</h3></div><p class="help">Available once the builder has loaded.</p></section>`;
    const m = S.ai;
    const nop = m === 'nopersona';
    const dis = (reason) => ({ disabled: true, reason });
    const rows = [
      aiRow('suggest', 'Suggest from persona', 'Agents, skills, MCP servers and a prompt', nop ? { ...dis('Needs a persona. Describe who this is for in the chat first.'), icon: 'wand-sparkles' } : { icon: 'wand-sparkles', state: m === 'mixed' ? 'result' : 'idle', add: true, result: '<p style="margin:0 0 4px"><strong>5 agents, 4 skills, 2 MCP servers</strong> and a system prompt.</p><p class="muted" style="margin:0">Reasoning: a solo SaaS developer benefits most from review, release and docs automation.</p>' }),
      aiRow('intent', 'Analyze intent', 'Turn a description or PRD into a full blueprint', { icon: 'brain', state: m === 'mixed' ? 'busy' : 'idle', busyText: 'Analyzing your description. This can take up to 3 minutes; you can keep chatting.' }),
      aiRow('subagents', 'Design subagents', 'A custom subagent fleet for the persona', nop ? { ...dis('Needs a persona. Describe who this is for in the chat first.'), icon: 'bot' } : { icon: 'bot', state: m === 'mixed' ? 'error' : 'idle', err: 'The model took too long to answer. Nothing was changed.' }),
      aiRow('skills', 'Generate skill specs', 'Specialised skills for the persona', nop ? { ...dis('Needs a persona. Describe who this is for in the chat first.'), icon: 'sparkles' } : { icon: 'sparkles', state: 'idle' }),
      aiRow('doc', 'Generate document', 'A requirements document from the preview', { icon: 'file-text', state: m === 'doc' ? 'result' : 'idle', copy: true, result: '<pre class="viewer mono" tabindex="0" aria-label="Generated document">1. Overview\nAcme Analytics is a B2B analytics SaaS built and run by one developer...\n\n2. Goals\n- Ship weekly\n- Keep CI green\n\n3. Agents\n- architect, release-captain, docs-scribe...</pre>' }),
    ].join('');
    const more = `<details style="margin-top:10px"><summary class="btn" style="list-style:none;min-height:32px;padding:0 4px;display:flex;justify-content:flex-start">${ic('chevron-right', 'i-sm')}More helpers</summary>
      <div style="margin-top:6px">${[['MCP suggestions', 'MCP servers found for this workspace', 'plug'], ['Generate prompt', 'A system prompt from persona, agents and skills', 'file-pen'], ['CLAUDE.md preview', 'See the CLAUDE.md that Apply would write', 'file-text']].map(([t, d, i]) => aiRow(t.replace(/\W/g, ''), t, d, { icon: i, state: 'idle' })).join('')}</div></details>`;
    return `<section class="sec" aria-labelledby="h-ai"><div class="sec-head"><h3 class="label" id="h-ai">AI helpers</h3><span class="meta">one at a time</span></div>
      <p class="help">One-off helpers. Results go into the preview only when you choose Add to preview.</p>
      <div role="status" class="sr-only">${m === 'mixed' ? 'Analyzing intent. This can take up to 3 minutes.' : ''}</div>${rows}${more}</section>`;
  }

  function presetSection() {
    const dis = S.init !== 'ok';
    const saveOpen = ['open', 'saved', 'error'].includes(S.preset);
    const savedMsg = S.preset === 'saved' ? `<div class="status done" role="status" style="margin-top:10px"><span class="ic">${ic('circle-check', 'i-lg')}</span><div class="grow"><h3>Saved "Solo SaaS developer"</h3><p>You can start from it in any workspace.</p></div></div>` : '';
    const errMsg = S.preset === 'error' ? `<div class="status err" role="alert" style="margin-top:10px"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Could not save the preset</h3><p>The presets folder is not writable. Nothing was saved.</p></div></div>` : '';
    return `<section class="sec" aria-labelledby="h-pre"><div class="sec-head"><h3 class="label" id="h-pre">Presets</h3><span class="meta">3 saved</span></div>
      <label class="fl" for="preset-pick">Start from a preset</label>
      <div class="row-flex"><select id="preset-pick" class="field" style="flex:1;min-width:0" ${dis ? 'disabled' : ''}><option>Choose a preset...</option><option ${S.preset === 'loaded' ? 'selected' : ''}>Solo SaaS developer (4 agents, 3 skills)</option><option>Agency delivery team (7 agents, 5 skills)</option><option>Docs-first OSS maintainer (3 agents, 2 skills)</option></select><button class="btn btn-outline" ${dis ? 'aria-disabled="true"' : ''}>Load</button></div>
      ${S.preset === 'loaded' ? `<div class="status info" role="status" style="margin-top:10px"><span class="ic">${ic('info', 'i-lg')}</span><div class="grow"><h3>Loaded "Solo SaaS developer"</h3><p>It is in the preview now. A note was added to your message box so the agent knows; edit it and send when ready.</p></div></div>` : '<p class="help" style="margin:6px 0 0">Loads the preset into the preview. Existing preview items are kept where they do not conflict.</p>'}
      <div style="margin-top:14px"><button class="disc" aria-expanded="${saveOpen}" aria-controls="save-form"><span class="chev">${ic('chevron-right', 'i-sm')}</span><span class="t13" style="font-weight:500">Save as preset</span></button>
      ${saveOpen ? `<form id="save-form" style="margin-top:8px" onsubmit="return false"><p class="help">Saves the current preview as a reusable preset. Nothing is written to the workspace until you apply.</p>
        <label class="fl" for="pn">Name <span class="muted" style="font-weight:400">(required)</span></label><input id="pn" class="field" value="${S.preset === 'open' ? '' : 'Solo SaaS developer'}" ${S.preset === 'open' ? 'aria-invalid="true" aria-describedby="pn-e"' : ''}>
        ${S.preset === 'open' ? `<div class="err-t" id="pn-e" role="alert">${ic('circle-alert', 'i-xs')}Enter a name for the preset.</div>` : ''}
        <label class="fl" for="pd" style="margin-top:10px">Description <span class="muted" style="font-weight:400">(optional)</span></label><textarea id="pd" class="field" style="min-height:56px">${S.preset === 'open' ? '' : 'Review, release and docs for a one-person SaaS.'}</textarea>
        <div class="row-flex" style="margin-top:10px"><button class="btn btn-outline" ${hasCfg ? '' : 'aria-disabled="true"'}>Save preset</button></div></form>${savedMsg}${errMsg}` : ''}</div></section>`;
  }

  function sessionSection() {
    const open = S.sess === 'open';
    return `<section class="sec" aria-labelledby="h-ses"><button class="disc" aria-expanded="${open}" aria-controls="ses-b"><span class="chev">${ic('chevron-right', 'i-sm')}</span><h3 class="label" id="h-ses" style="flex:1">Session</h3><span class="meta tnum">Context 41% · $0.31</span></button>
      ${open ? `<div id="ses-b" style="margin-top:8px"><div class="muted t11" style="margin-bottom:6px">Existing session stats summary (unchanged component, example values)</div><dl class="dl"><dt>Context</dt><dd class="tnum">82.4k of 200k tokens (41%)</dd><dt>Cost</dt><dd class="tnum">$0.31</dd><dt>Time</dt><dd class="tnum">6m 12s</dd><dt>Models</dt><dd>Sonnet 4.5</dd></dl></div>` : ''}</section>`;
  }

  function initErrSection() {
    if (S.init !== 'error') return '';
    return `<section class="sec" aria-labelledby="h-init"><div class="sec-head"><h3 class="label" id="h-init">Builder setup</h3></div>
      <div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Could not load workspace details</h3><p>Apply and the AI helpers need them. You can keep chatting meanwhile.</p><div class="acts"><button class="btn btn-outline">Retry</button></div></div></div></section>`;
  }

  function sidebarHtml(narrow) {
    return `<div class="sb-wrap" id="builder-sidebar-wrap"><aside class="sb" id="builder-sidebar" aria-label="Configuration">
      <div class="sb-head"><h2 id="sb-title">${ic('settings', 'i-sm')}Configuration</h2><span class="meta">${cfgSummary}</span></div>
      <div class="sb-scroll" id="sb-scroll">${initErrSection()}${applySection()}${stackSection()}${previewSection()}${aiSection()}${presetSection()}${sessionSection()}</div></aside></div>`;
  }

  /* ---------------- header / peek / notices / dialog ---------------- */
  function peekStatus() {
    if (S.chat === 'ask') return `<span class="ps" style="color:var(--state-ink-need)">${ic('hand', 'i-sm')}Needs your answer</span>`;
    if (S.apply === 'applied') return `<span class="ps" style="color:var(--state-ink-done)">${ic('circle-check', 'i-sm')}Applied</span>`;
    if (S.apply === 'error') return `<span class="ps" style="color:var(--state-ink-err)">${ic('circle-alert', 'i-sm')}<span style="color:oklch(var(--bc))">Apply failed</span></span>`;
    if (S.apply === 'ready') return `<span class="ps" style="color:var(--state-ink-done)">${ic('circle-check', 'i-sm')}Ready to apply</span>`;
    return '<span class="ps"></span>';
  }
  function headerHtml(sbOpen) {
    return `<header class="hdr"><div class="hdr-l"><h1 id="pg-title">${title}</h1>
      <span class="badge badge-ghost hide-narrow"><span class="sr-only">Workflow: </span>${wf}</span><span class="compact-mark only-narrow muted" title="${wf}"><span class="sr-only">Workflow: ${wf}</span>${ic('workflow', 'i-sm')}</span>
      ${cfgSummary ? `<span class="summary muted">${cfgSummary}</span>` : ''}
      ${S.pin === '1' ? `<span class="badge badge-warn" role="status" title="You switched workspaces mid-build. This configuration will still be applied to the workspace this build started in.">${ic('pin', 'i-xs')}Targeting ${ws}</span>` : ''}</div>
      <div class="hdr-r"><button class="btn hide-narrow ${sbOpen ? 'on' : ''}" id="sb-toggle" data-act="toggle-sb" aria-expanded="${sbOpen}" aria-controls="builder-sidebar" aria-label="${sbOpen ? 'Hide configuration panel' : 'Show configuration panel'}">${ic('panel-right', 'i-sm')}<span>${sbOpen ? 'Hide panel' : 'Show panel'}</span>${!sbOpen && S.apply === 'ready' ? '<span class="dot dot-done" title="Configuration ready"></span>' : ''}</button>
      <button class="btn" id="start-over" data-act="open-dlg" aria-label="Start over: leave this workflow">${ic('rotate-ccw', 'i-sm')}<span class="hide-narrow">Start over</span></button>
      <button class="btn sq" aria-label="Back to chat. This session keeps running.">${ic('x')}</button></div></header>`;
  }
  function noticeHtml() {
    if (S.launch === 'err') return `<div class="status err" role="alert" style="margin:0;border-radius:0;border-width:0 0 1px;padding:10px 16px"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>The builder instructions could not be loaded</h3><p>The agent does not know it is configuring a team yet. Retry, or start over.</p><div class="acts"><button class="btn btn-outline">Retry</button><button class="btn">Start over</button></div></div></div>`;
    if (S.notice === 'resumed') return `<div class="status info" role="status" style="margin:0;border-radius:0;border-width:0 0 1px;padding:10px 16px"><span class="ic">${ic('info', 'i-lg')}</span><div class="grow"><h3>Draft resumed</h3><p>The agent is paused. Send a message to continue.</p></div><button class="btn sq" aria-label="Dismiss notice">${ic('x')}</button></div>`;
    return '';
  }
  const DLG = {
    'start-over': { t: NP ? 'Leave New Project Setup?' : 'Leave AI Team Builder?', d: (run) => `Save this session as a draft to pick it up later from Setup Hub, or discard it.${run ? ' The agent is running and will be stopped either way.' : ''}`, ok: 'Save as draft' },
    'new-project': { t: 'Start the New Project?', d: () => 'An AI Team Builder session is open in this workspace. Save it as a draft to come back to later, or discard it. Starting a new project stops its agent.', ok: 'Save as draft' },
    switch: { t: 'Open the AI Team Builder?', d: () => 'A New Project session is open in this workspace. Save it as a draft to come back to later, or discard it. Opening the builder stops its agent.', ok: 'Save as draft' },
    resume: { t: 'Resume this draft?', d: () => 'Your current session becomes the draft, and the draft you picked opens in its place. Or discard the current session instead.', ok: 'Save as draft' },
  };
  function dialogHtml(kind, variant) {
    const c = DLG[kind];
    if (!c) return '';
    const run = variant !== 'idle';
    const pending = variant === 'pending', busy = variant === 'busy', err = variant === 'error';
    const draftNote = S.draft === '1' ? `<div class="note">${ic('info', 'i-sm')}<span>You already have a saved draft from 14 Oct, 11:05. Saving replaces it. The older session stays in your session history.</span></div>` : '';
    return `<div class="scrim" data-scrim><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d" ${busy ? 'aria-busy="true"' : ''}>
      <h2 id="dlg-t">${c.t}</h2><p id="dlg-d">${c.d(run)}</p>${draftNote}
      ${pending ? `<div class="note" id="pend">${ic('loader-circle', 'i-sm spin')}<span>Waiting for the chat session to start. Save as draft is available once the session exists.</span></div>` : ''}
      ${err ? `<div class="dlg-err" role="alert">${ic('circle-alert', 'i-sm')}<span>The draft could not be saved, so nothing changed. Try again, or discard.</span></div>` : ''}
      <div class="btns"><button class="btn btn-outline" data-act="close-dlg" id="dlg-cancel" ${busy ? 'disabled' : ''}>Cancel</button>
        <button class="btn btn-danger" ${busy ? 'disabled' : ''}>${ic('trash-2', 'i-sm')}Discard</button>
        <button class="btn btn-primary" ${pending ? 'aria-disabled="true" aria-describedby="pend"' : ''} ${busy ? 'aria-busy="true" disabled' : ''}>${busy ? '<svg class="i i-sm spin" aria-hidden="true"><use href="#i-loader-circle"/></svg>Saving...' : err ? 'Try again' : c.ok}</button></div></div></div>`;
  }

  /* ---------------- mount ---------------- */
  const narrowStart = innerWidth < 720;
  const sbInit = S.sb || (narrowStart ? 'closed' : 'open');
  const dlgKind = S.dlg ? S.dlg.split('.')[0] : '';
  const dlgVar = S.dlg ? (S.dlg.split('.')[1] || (processing ? 'running' : 'idle')) : '';
  const root = document.getElementById('app');
  if (S.page === 'wrongkind') {
    root.innerHTML = `<div class="page" style="align-items:center;justify-content:center"><div class="status info" role="status" style="max-width:420px;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:24px;background:var(--surface-1);border-color:oklch(var(--b3))"><h2 style="margin:0;font-size:16px">This session is not an AI Team Builder session.</h2><p style="font-size:13px;margin:0">It is open as a normal chat.</p><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn btn-primary">Open in chat</button><button class="btn btn-outline">${ic('arrow-left', 'i-sm')}Back to Setup Hub</button></div></div></div>`;
    document.body.dataset.ready = '1'; return;
  }
  if (S.page === 'missing') {
    root.innerHTML = `<div class="page" style="align-items:center;justify-content:center"><div class="status info" role="status" style="max-width:420px;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:24px;background:var(--surface-1);border-color:oklch(var(--b3))"><h2 style="margin:0;font-size:16px">This builder session is no longer open.</h2><p style="font-size:13px;margin:0">It was closed from the tab bar, or there was nothing to restore after a reload.</p><button class="btn btn-primary">${ic('arrow-left', 'i-sm')}Back to Setup Hub</button></div></div>`;
    document.body.dataset.ready = '1'; return;
  }
  root.innerHTML = `<div class="page" data-sb="${sbInit}" ${dlgKind ? 'data-dialog="open"' : ''}>
    ${headerHtml(sbInit === 'open')}${noticeHtml()}
    <button class="peek" id="peek" data-act="toggle-sb" aria-expanded="${sbInit === 'open'}" aria-controls="builder-sidebar"><span class="pl">Configuration</span><span class="meta tnum">${cfgSummary || 'empty'}</span>${peekStatus()}${ic('chevron-down', 'i-sm pk-chev')}</button>
    <div class="body"><div class="chatcol" id="chatcol" data-inert-with-dialog>${chatHtml()}</div>${sidebarHtml()}</div>
    ${dlgKind ? dialogHtml(dlgKind, dlgVar) : ''}</div>`;
  if (S.aside === 'full') { document.querySelector('.page').style.height = 'auto'; document.querySelector('.page').style.overflow = 'visible'; document.querySelector('.body').style.overflow = 'visible'; const sb = document.querySelector('.sb'); sb.style.height = 'auto'; document.getElementById('sb-scroll').style.overflow = 'visible'; document.querySelector('.chatcol').style.display = 'none'; document.querySelector('.hdr').style.display = 'none'; document.querySelector('.peek').style.display = 'none';  document.querySelector('.page').style.minHeight = '0'; }

  /* ---------------- behaviour: sheet inert, dialog focus trap, Escape, focus return ---------------- */
  const page = root.querySelector('.page');
  const chatcol = document.getElementById('chatcol');
  const isNarrow = () => page.getBoundingClientRect().width < 720;
  function backdrop(on) { for (const el of page.querySelectorAll('.hdr, .peek, .body, [role="status"].notice')) el.inert = on; }
  function sync() {
    if (page.querySelector('.dlg')) return;
    const open = page.dataset.sb === 'open';
    const narrow = isNarrow();
    chatcol.inert = narrow && open;
    chatcol.setAttribute('aria-hidden', String(narrow && open));
    const t = document.getElementById('sb-toggle'); const pk = document.getElementById('peek');
    if (t) { t.setAttribute('aria-expanded', String(open)); t.setAttribute('aria-label', open ? 'Hide configuration panel' : 'Show configuration panel'); t.classList.toggle('on', open); t.querySelector('span').textContent = open ? 'Hide panel' : 'Show panel'; }
    if (pk) pk.setAttribute('aria-expanded', String(open));
  }
  let ret = null;
  function openDlg(kind, variant, from) { ret = from; const h = document.createElement('div'); h.innerHTML = dialogHtml(kind, variant); page.appendChild(h.firstElementChild); page.dataset.dialog = 'open'; backdrop(true); document.getElementById('dlg-cancel').focus(); }
  function closeDlg() { page.querySelector('[data-scrim]')?.remove(); delete page.dataset.dialog; backdrop(false); sync(); (ret || document.getElementById('start-over'))?.focus(); }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); const scrim = e.target.matches('[data-scrim]');
    if (scrim) return closeDlg();
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'toggle-sb') { const wasOpen = page.dataset.sb === 'open'; page.dataset.sb = wasOpen ? 'closed' : 'open'; sync(); if (isNarrow()) document.getElementById('peek').focus(); }
    if (a === 'open-dlg') openDlg('start-over', processing ? 'running' : 'idle', b);
    if (a === 'close-dlg') closeDlg();
  });
  document.addEventListener('keydown', (e) => {
    const dlg = page.querySelector('.dlg');
    if (dlg) {
      if (e.key === 'Escape') { e.preventDefault(); return closeDlg(); }
      if (e.key === 'Tab') { const f = [...dlg.querySelectorAll('button:not([disabled])')]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
      return;
    }
    if (e.key === 'Escape' && isNarrow() && page.dataset.sb === 'open') { page.dataset.sb = 'closed'; sync(); document.getElementById('peek').focus(); }
  });
  new ResizeObserver(sync).observe(page);
  sync();
  const dlgEl = page.querySelector('.dlg'); if (dlgEl) { backdrop(true); document.getElementById('dlg-cancel')?.focus(); }
  document.body.dataset.ready = '1';
})();
