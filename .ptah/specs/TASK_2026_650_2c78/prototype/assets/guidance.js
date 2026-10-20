/* TASK_2026_650 prototype: Generate project guidance page (chat tab + sidebar). Example data only. */
(function () {
  'use strict';
  const W = window.W; const { g, esc, ic, sec, sourceCard } = W;
  /* Raw `s` shorthands: a base state plus a flag (stop-late: the stop arrived after the guidance was saved; stop-failed: the stop request failed, the run is still active). */
  const ALIAS = { 'stop-late': { s: 'complete', late: true }, 'stop-failed': { s: 'running', stopFailed: true }, 'stop-unconfirmed': { s: 'running', stopUnconf: true }, 'stop-unknown': { s: 'running', stopUnknown: true } };
  const AL = () => ALIAS[g('s', 'setup')] || {};
  const S = {
    get s() { return AL().s || g('s', 'setup'); },
    get late() { return !!AL().late; },
    get stopFailed() { return !!AL().stopFailed; },
    get stopUnconf() { return !!AL().stopUnconf; },
    get stopUnknown() { return !!AL().stopUnknown; },
    get src() { return g('src', ['setup', 'starting'].includes(g('s', 'setup')) ? 'unchecked' : 'no-analysis'); },
    get prev() { return g('prev', ['existing', 'complete', 'regenerating'].includes(S.s) ? 'saved' : 'none') === 'saved'; },
    get flow() { return g('flow', '0') === '1'; },
    get fb() { return g('fb', '0') === '1'; },
    get prov() { return g('prov', 'ok'); },
  };
  const ACTIVE = ['starting', 'running', 'running-quiet', 'regenerating', 'cancelling'];
  /* The tab model of this Project Prompt tab (spec 2.9.3). `gm=diff` = this tab already had another model selected, which is what a combined-flow start submits (spec 2.9.2). */
  const TAB_MODEL = () => (g('gm', 'same') === 'diff' ? 'Claude Opus 4.1' : W.MODEL.model);
  const OTHER_MODEL = () => (TAB_MODEL() === 'Claude Opus 4.1' ? W.MODEL.model : 'Claude Opus 4.1');
  const MODEL = () => `${W.MODEL.provider}, ${TAB_MODEL()}`;
  const STACK = ['Angular 22', 'TypeScript', 'Nx monorepo', 'Tailwind CSS', 'DaisyUI', 'NestJS', 'Jest'];
  const SECTIONS = [['Project overview', 182], ['Architecture', 240], ['Coding conventions', 210], ['Testing', 120], ['Build and run', 96], ['Common pitfalls', 144]];
  let enabled = true;

  const keep = () => { const q = new URLSearchParams(); for (const k of ['theme', 'w']) if (W.P.has(k)) q.set(k, W.P.get(k)); const t = q.toString(); return t ? '?' + t : ''; };

  function runSection() {
    const s = S.s;
    const genBtn = (label, set, aria) => `<button class="btn btn-primary btn-wide" id="gen-btn" ${aria ? `aria-label="${aria}"` : ''} data-act="set" data-set="${set}" style="margin-top:12px">${ic('wand-sparkles', 'i-sm')}${label}</button><p class="meta" style="margin:6px 0 0">Model: ${esc(MODEL())}</p>`;
    const stopAlert = () => S.stopFailed
      ? `<div class="status err" role="alert" style="margin-top:8px"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Could not stop the run</h3><p style="color:oklch(var(--bc))">The run is still active. Try stopping again.</p></div></div>`
      : S.stopUnconf ? `<div class="status warn" role="status" style="margin-top:8px"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><h3>Stop could not be confirmed</h3><p>We could not confirm whether the run stopped. Checking its state...</p></div></div>` : '';
    const stopRow = (busy, checking) => `<div class="acts-row">${W.stopBtn(busy || checking, checking ? 'Checking...' : undefined)}</div><p class="meta" style="margin:8px 0 0">Stop generation cancels the run. The last saved guidance stays as it is. The chat Stop does the same.</p>`;
    const flowNote = S.flow && ['setup', 'failed', 'trace-failed', 'ended', 'rejected', 'tabmismatch', 'blocked'].includes(s)
      ? `<div class="status info" style="margin-bottom:8px;padding:8px 10px"><span class="ic">${ic('workflow', 'i-sm')}</span><div class="grow"><p style="margin:0">Part of setup. Skip finishes setup without project guidance.</p><div class="acts" style="margin-top:6px"><button class="btn" data-act="set" data-set="s=skipped">Skip guidance</button></div></div></div>` : '';
    const lastNote = S.prev ? 'The last saved guidance stays in place until a new one is saved.' : '';
    let body = '';
    if (S.prov === 'none' && ['setup', 'skipped'].includes(s)) {
      body = `${flowNote}<div class="status warn" role="status"><span class="ic">${ic('triangle-alert', 'i-lg')}</span><div class="grow"><h3>No provider is connected</h3><p>Connect a provider to generate guidance.</p><div class="acts"><button class="btn btn-outline">${ic('settings', 'i-sm')}Open Settings</button></div></div></div><button class="btn btn-primary btn-wide" id="gen-btn" aria-disabled="true" aria-describedby="gen-why" style="margin-top:12px">${ic('wand-sparkles', 'i-sm')}Generate guidance</button><p class="meta" id="gen-why" style="margin:6px 0 0">Connect a provider first.</p>`;
    } else if (s === 'setup') {
      body = `${flowNote}<div class="status idle"><span class="ic">${ic('sparkles', 'i-lg')}</span><div class="grow"><h3>Ready to generate</h3><p>Guidance is written from your workspace: project type, stack, dependencies and configuration.</p></div></div>${genBtn('Generate guidance', 's=starting')}
        <p class="meta" style="margin:10px 0 0">Agents capture saved guidance when you start them. Generate guidance first if you want agents to use it.</p>`;
    } else if (s === 'skipped') {
      body = `<div class="status idle" role="status"><span class="ic">${ic('circle-dashed', 'i-lg')}</span><div class="grow"><h3>Project guidance skipped</h3><p>Setup is complete without it. You can generate guidance any time from this tab.</p></div></div>${genBtn('Generate guidance', 's=starting')}`;
    } else if (s === 'starting') {
      body = `<div class="status run" role="status"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><h3>Starting generation</h3><p>Checking the workspace and the context source. Model: ${esc(MODEL())}.</p></div></div>${stopRow(false)}`;
    } else if (s === 'running' || s === 'running-quiet' || s === 'regenerating') {
      body = `<div class="status run" role="status"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><h3>${s === 'regenerating' ? 'Regenerating project guidance' : 'Generating project guidance'}</h3><p>Reading the workspace and writing tailored guidance. This may take a minute.</p>${S.flow && s === 'running' ? '<p class="meta" style="margin:6px 0 0">Started from setup after agent generation.</p>' : ''}${s === 'running-quiet' ? '<p class="meta" style="margin:6px 0 0">The chat is idle. The run is still working.</p>' : ''}${S.prev || s === 'regenerating' ? '<p class="meta" style="margin:6px 0 0">The last saved guidance stays in place until the new one is saved.</p>' : ''}</div></div>${stopAlert()}${S.stopUnknown ? '' : stopRow(false, S.stopUnconf)}`;
      if (S.stopUnknown) body = `<div class="status warn" role="alert"><span class="ic">${ic('triangle-alert', 'i-lg')}</span><div class="grow"><h3>Run state could not be confirmed</h3><p>We could not confirm whether the run is still active or has ended. Open project guidance in Settings to see what was saved, then check again.</p><div class="acts"><button class="btn btn-outline" data-act="set" data-set="s=stop-unconfirmed">${ic('refresh-cw', 'i-sm')}Check again</button></div></div></div>`;
    } else if (s === 'cancelling') {
      body = `<div class="status run" role="status"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><h3>Stopping generation</h3><p>${g('pend') === '1' ? 'Your stop was received before the run began. It is applied as soon as the run starts, or dropped if the start is rejected.' : 'This run will not be marked complete.'}</p></div></div>${stopRow(true)}`;
    } else if (s === 'cancelled') {
      body = `<div class="status warn" role="status"><span class="ic">${ic('circle-pause', 'i-lg')}</span><div class="grow"><h3>Generation cancelled</h3><p>This run was cancelled and not marked complete. ${S.prev ? 'The last saved guidance is unchanged.' : 'No guidance has been saved yet.'}</p></div></div>${genBtn(S.prev ? 'Regenerate guidance' : 'Generate again', 's=regenerating')}`;
    } else if (s === 'complete') {
      body = `<div class="status done" role="status"><span class="ic">${ic('circle-check', 'i-lg')}</span><div class="grow"><h3>Project guidance generated</h3><p>Saved for this workspace. Agents started from now on can use it.</p>${S.late ? '<p class="meta" style="margin:6px 0 0">It finished before the stop took effect. The guidance was saved.</p>' : ''}</div></div>`;
    } else if (s === 'existing') {
      body = `<div class="status idle"><span class="ic">${ic('circle-check', 'i-lg ic-ok')}</span><div class="grow"><h3>Guidance saved</h3><p>Generated 14 Oct 2026, 11:20 from the current workspace. Opening this tab does not change it.</p></div></div>`;
    } else if (s === 'failed' || s === 'trace-failed' || s === 'ended') {
      const h = { failed: 'Project guidance failed', 'trace-failed': 'Guidance was not saved', ended: 'The run ended early' }[s];
      const p = { failed: 'The model did not return usable guidance. Try again.', 'trace-failed': 'The guidance was generated, but its record could not be written. This run was not marked complete.', ended: 'The connection closed before the result was saved. This run was not marked complete.' }[s];
      body = `${flowNote}<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>${h}</h3><p style="color:oklch(var(--bc))">${p} ${g('ver', '1') === '0' ? 'We could not confirm whether earlier guidance is intact. Open it in Settings to check, then retry.' : lastNote}</p></div></div>${genBtn('Retry', 's=starting', 'Retry project guidance generation').replace(ic('wand-sparkles', 'i-sm'), ic('rotate-cw', 'i-sm'))}`;
    } else if (s === 'rejected' || s === 'tabmismatch') {
      body = `${flowNote}<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Could not start generation</h3><p style="color:oklch(var(--bc))">The start was rejected before anything ran. Nothing was started and nothing was saved. See the context source below.${g('pend') === '1' ? ' Your stop request was dropped: nothing was running.' : ''}</p></div></div>${genBtn('Generate guidance', 's=starting')}`;
    } else if (s === 'blocked') {
      body = `${flowNote}<div class="status warn" role="status"><span class="ic">${ic('triangle-alert', 'i-lg')}</span><div class="grow"><h3>Another workspace is generating guidance</h3><p>${esc(W.OTHER_WS)} has a guidance run in progress. Only one guidance run can be active at a time. Wait for it to finish, then start here.${g('pend') === '1' ? ' Your stop request was dropped: nothing was running.' : ''}</p></div></div><button class="btn btn-primary btn-wide" id="gen-btn" aria-disabled="true" aria-describedby="gen-why" style="margin-top:12px">${ic('wand-sparkles', 'i-sm')}Generate guidance</button><p class="meta" id="gen-why" style="margin:6px 0 0">Waiting for the run in ${esc(W.OTHER_WS)}.</p>`;
    }
    return sec('run', 'Run', '', body);
  }

  function stackSection() {
    const s = S.s;
    let body;
    if (['setup', 'starting', 'skipped', 'rejected', 'tabmismatch', 'blocked'].includes(s) && !S.prev) body = `<p class="help" style="margin:0">Detected when the run starts.</p>`;
    else if (s === 'running' || s === 'regenerating' || s === 'cancelling') body = `<div class="wrap">${STACK.slice(0, 4).map((x) => `<span class="badge badge-outline">${x}</span>`).join('')}<span class="badge badge-mute">${ic('loader-circle', 'i-xs spin')}Detecting more</span></div>`;
    else if (['failed', 'trace-failed', 'ended', 'cancelled'].includes(s) && !S.prev) body = `<p class="help" style="margin:0">No stack was recorded for this run.</p>`;
    else body = `<div class="wrap">${STACK.map((x) => `<span class="badge badge-outline">${x}</span>`).join('')}</div>`;
    return sec('stack', 'Detected stack', '', body);
  }

  function guidanceSection() {
    const s = S.s;
    const has = S.prev || s === 'complete' || s === 'existing';
    if (!has) return '';
    const sections = SECTIONS.map(([n, w], i) => {
      const gen = !(S.fb && i === 4);
      return `<div style="display:flex;gap:6px;align-items:flex-start;padding:6px 8px;border:1px solid var(--surface-border);border-radius:6px;background:var(--surface-2);min-width:0">${gen ? ic('circle-check', 'i-sm ic-ok') : ic('circle-alert', 'i-sm ic-need')}<div style="min-width:0"><div class="t12" style="font-weight:500;overflow-wrap:anywhere">${n}</div><div class="meta">${gen ? w + ' words' : 'Not generated'}</div></div></div>`;
    }).join('');
    const genCount = SECTIONS.length - (S.fb ? 1 : 0);
    const busy = ACTIVE.includes(s);
    return sec('guid', 'Guidance', '<span class="tnum">Saved 14 Oct, 11:20</span>', `
      <div class="row-flex" style="justify-content:space-between;margin-bottom:8px"><span class="t13" style="font-weight:600">Generated guidance</span>${S.fb ? `<span class="badge badge-warn">${ic('triangle-alert', 'i-xs')}fallback</span>` : ''}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px" role="list" aria-label="Guidance sections">${sections}</div>
      <div class="row-flex" style="justify-content:space-between;margin-top:8px"><span class="meta">${genCount} of ${SECTIONS.length} sections generated</span><span class="badge badge-mute tnum">1,420 tokens</span></div>
      ${S.fb ? `<p class="meta" style="margin:6px 0 0">Some sections used the authored fallback because the model output was not usable.</p>` : ''}
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--surface-border)">
        <button class="sw" id="en-sw" role="switch" aria-checked="${enabled}" aria-describedby="en-d" data-act="en" ${busy ? 'aria-disabled="true"' : ''}><span class="trk"></span><span class="sl">Use project guidance</span></button>
        <p class="meta" id="en-d" style="margin:2px 0 0" aria-live="polite">${enabled ? 'On. Active for all sessions.' : 'Off. Standard system prompt.'}</p></div>
      <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-outline" ${busy ? 'aria-disabled="true"' : 'data-act="set" data-set="s=regenerating"'} aria-label="Regenerate with ${esc(TAB_MODEL())}">${ic('refresh-cw', 'i-sm')}Regenerate</button><button class="btn">${ic('external-link', 'i-sm')}Open in Settings</button></div>
      <p class="meta" style="margin:8px 0 0">This panel shows section names and sizes only. View or download the prompt in Settings.</p>`);
  }

  function sourceSection() {
    const reason = S.s === 'rejected' ? 'rejected' : S.s === 'tabmismatch' ? 'tab-mismatch' : S.src;
    const recorded = !['setup', 'starting', 'skipped', 'blocked', 'rejected', 'tabmismatch'].includes(S.s) && !['unchecked', 'checking'].includes(reason);
    return sec('src', 'Context source', '', sourceCard(reason, { recorded, noActions: ACTIVE.includes(S.s) }));
  }
  function modelSection() {
    const s = S.s; const chatNote = g('cm', 'same') === 'diff' ? `<p class="meta" style="margin:6px 0 0">Chat replies currently use ${OTHER_MODEL()}. This does not change the run.</p>` : '';
    if (ACTIVE.includes(s)) {
      return sec('model', 'Provider and model', '', `<dl class="dl"><dt>Provider</dt><dd>${W.MODEL.provider}</dd><dt>Model</dt><dd>${TAB_MODEL()}</dd></dl><p class="meta" style="margin:8px 0 0">Running with this model. It cannot change while the run is active.</p>${chatNote}`);
    }
    const none = S.prov === 'none';
    const next = ['complete', 'existing', 'cancelled', 'failed', 'trace-failed', 'ended'].includes(s) ? 'Regenerate' : 'This run';
    return sec('model', 'Provider and model', '', `<label class="fl" for="prov-sel">Provider</label><select id="prov-sel" class="field" ${none ? 'disabled' : ''}>${none ? '<option>No provider connected</option>' : '<option>Anthropic</option><option>OpenRouter</option>'}</select>
      <label class="fl" for="model-sel" style="margin-top:8px">Model</label><select id="model-sel" class="field" ${none ? 'disabled' : ''}>${none ? '<option>-</option>' : ['Claude Sonnet 4.5', 'Claude Opus 4.1'].map((m) => `<option${m === TAB_MODEL() ? ' selected' : ''}>${m}</option>`).join('')}</select>
      <p class="meta" style="margin:8px 0 0">${none ? 'Connect a provider in Settings to choose a model.' : `${next === 'This run' ? 'This run will use' : 'The next run will use'} ${esc(MODEL())}. The composer's model selector shows the same value.${s === 'existing' || s === 'complete' ? ' The saved guidance was made with ' + esc(MODEL()) + '.' : ''}`}</p>${chatNote}`);
  }
  function nextSection() {
    if (!['complete', 'existing'].includes(S.s)) return '';
    return sec('next', 'Next steps', '', `<div class="status info"><span class="ic">${ic('bot', 'i-lg')}</span><div class="grow"><h3>Generate agents</h3><p>Agents started now capture this guidance. Agent generation is a separate step and is not started for you.</p><div class="acts"><a class="btn btn-outline" href="agents.html${keep()}">${ic('bot', 'i-sm')}Generate agents</a></div></div></div>`);
  }

  function chatHtml() {
    const s = S.s; const stop = ['starting', 'running', 'regenerating', 'cancelling'].includes(s) && !S.stopUnknown; const quiet = s === 'running-quiet';
    let t = '';
    if (s === 'starting') t = W.work('Starting: checking the workspace and the context source');
    else if (['setup', 'skipped', 'rejected', 'tabmismatch', 'blocked'].includes(s) && !S.prev) t = `<div class="work" style="margin:auto;text-align:center;flex-direction:column"><span class="muted t13">New tab. Generation output streams here once you start.</span></div>`;
    else if (s === 'existing' || (s === 'setup' && S.prev)) t = W.msgA('<p>Project guidance was generated on 14 Oct 2026 and is saved. Ask me about it, or regenerate it from the panel.</p>');
    else {
      t += W.msgA(`<p>${S.src === 'ok' ? 'Using the verified analysis from 14 Oct 2026 plus a quick check of the workspace.' : 'No analysis in use. Reading the workspace: package.json, nx.json, tsconfig, lockfile, folder layout.'}</p><ul><li>Detected Angular 22, TypeScript, Nx, Tailwind CSS and DaisyUI.</li><li>Found a NestJS backend and Jest tests.</li></ul>`);
      if (stop) t += W.work(s === 'cancelling' ? 'Stopping' : 'Working: writing the guidance sections');
      if (quiet) t += W.msgA('<p>The guidance sections are still being written in the background. The chat reply has finished.</p>');
      if (s === 'cancelled') t += W.msgA('<p>Generation stopped by you. This run was not marked complete.</p>');
      if (s === 'complete') t += W.msgA('<p>Done. Six sections were written and saved. Ask me to explain any of them.</p>');
      if (s === 'failed') t += W.msgA('<p>I could not produce usable guidance from this run.</p>');
      if (s === 'trace-failed') t += W.msgA('<p>The guidance text was produced, but saving its record failed. It was not marked complete.</p>');
      if (s === 'ended') t += W.msgA('<p>The stream ended before the result was saved.</p>');
    }
    return W.chat({ thread: t, stop, model: g('cm', 'same') === 'diff' && (ACTIVE.includes(s) || ['cancelled', 'complete', 'failed', 'trace-failed', 'ended'].includes(s)) ? OTHER_MODEL() : TAB_MODEL() });
  }

  function peekStatus() {
    const s = S.s;
    if (['blocked', 'rejected', 'tabmismatch', 'failed', 'trace-failed', 'ended'].includes(s)) return { cls: 'err', icon: 'circle-alert', text: s === 'blocked' || s === 'rejected' || s === 'tabmismatch' ? 'Cannot start' : 'Failed' };
    if (S.stopUnknown) return { cls: 'need', icon: 'triangle-alert', text: 'Unconfirmed' };
    if (ACTIVE.includes(s)) return { cls: 'run', icon: 'loader-circle', text: s === 'cancelling' ? 'Stopping' : s === 'starting' ? 'Starting' : 'Generating' };
    if (s === 'cancelled') return { cls: 'need', icon: 'triangle-alert', text: 'Cancelled' };
    if (s === 'complete' || s === 'existing') return { cls: 'ok', icon: 'circle-check', text: s === 'existing' ? 'Saved' : 'Done' };
    if (s === 'skipped') return { cls: 'need', icon: 'circle-dashed', text: 'Skipped' };
    return { cls: 'ok', icon: 'circle-check', text: 'Ready to generate' };
  }
  const summary = () => ({ setup: 'not generated', skipped: 'skipped', starting: 'starting', running: 'generating', 'running-quiet': 'generating', regenerating: 'regenerating', cancelling: 'stopping', cancelled: 'cancelled', complete: 'saved', existing: 'saved', failed: 'failed', 'trace-failed': 'not saved', ended: 'not saved', rejected: 'not started', tabmismatch: 'not started', blocked: 'waiting' }[S.s] || '');

  function render() {
    const sbOpen = W.sbInit() === 'open';
    const dot = ACTIVE.includes(S.s) ? 'run' : ['complete', 'existing'].includes(S.s) ? 'done' : ['failed', 'trace-failed', 'ended'].includes(S.s) ? 'err' : '';
    return `<div class="page" data-sb="${sbOpen ? 'open' : 'closed'}">
      ${W.tabbar([{ name: 'Chat 1' }, { name: 'Project Prompt', on: true, dot }])}
      ${W.header({ title: 'Generate project guidance', workflow: 'Project Prompt', summary: summary(), sbOpen, toggleName: 'project guidance' })}
      ${W.peek({ label: 'Project guidance', meta: summary(), status: peekStatus(), sbOpen, stop: S.s === 'cancelling' || S.stopUnconf ? 'busy' : S.stopUnknown ? false : ['starting', 'running', 'running-quiet', 'regenerating'].includes(S.s) })}
      <div class="body"><div class="chatcol" id="chatcol">${chatHtml()}</div>
      ${W.sidebar({ name: 'Project guidance', summary: summary(), sections: [runSection(), stackSection(), guidanceSection(), nextSection(), sourceSection(), modelSection()] })}</div></div>`;
  }
  W.acts.en = (b) => { if (b.getAttribute('aria-disabled') === 'true') return; enabled = !enabled; b.setAttribute('aria-checked', String(enabled)); document.getElementById('en-d').textContent = enabled ? 'On. Active for all sessions.' : 'Off. Standard system prompt.'; };

  W.mount({
    page: 'Generate project guidance',
    controls: [
      { k: 's', label: 'State', opts: [['setup', 'setup'], ['rejected', 'rejected: foreign analysis'], ['tabmismatch', 'rejected: wrong workspace'], ['blocked', 'blocked: other workspace'], ['running', 'running'], ['running-quiet', 'running, chat idle'], ['starting', 'starting'], ['cancelling', 'stopping'], ['stop-failed', 'stop refused, run still active'], ['stop-unconfirmed', 'stop unconfirmed, checking'], ['stop-unknown', 'run state unknown'], ['cancelled', 'cancelled'], ['stop-late', 'finished before the stop'], ['complete', 'done'], ['existing', 'reopened with saved guidance'], ['regenerating', 'regenerating'], ['failed', 'failed'], ['trace-failed', 'failed: not saved'], ['ended', 'ended early'], ['skipped', 'skipped']] },
      { k: 'src', label: 'Source', opts: [['', 'by state'], ['ok', 'fresh analysis'], ['no-analysis', 'no-analysis'], ['unreadable', 'unreadable'], ['legacy-v3', 'legacy-v3'], ['incomplete', 'incomplete'], ['expired', 'expired'], ['workspace-changed', 'workspace-changed'], ['output-mismatch', 'output-mismatch'], ['not-latest', 'not the latest'], ['failed', 'lookup failed'], ['checking', 'checking'], ['unchecked', 'not checked yet']] },
      { k: 'prev', label: 'Saved guidance', opts: [['', 'by state'], ['saved', 'exists'], ['none', 'none']] },
      { k: 'flow', label: 'Setup flow', opts: [['0', 'independent'], ['1', 'part of setup']] },
      { k: 'ver', label: 'Outcome check', opts: [['1', 'verified'], ['0', 'could not be confirmed']] },
      { k: 'fb', label: 'Fallback', opts: [['0', 'no'], ['1', 'a section fell back']] },
      { k: 'gm', label: 'Tab model', opts: [['same', 'Sonnet 4.5 (same as the agent run)'], ['diff', 'Opus 4.1 (tab already had another)']] },
      { k: 'cm', label: 'Chat model', opts: [['same', 'same as run'], ['diff', 'chat uses another']] },
      { k: 'prov', label: 'Provider', opts: [['ok', 'connected'], ['none', 'none connected']] },
    ],
    render,
  });
})();
