/* TASK_2026_650 prototype: Setup Wizard landing (choice of independent workflows). Example data only. */
(function () {
  'use strict';
  const W = window.W; const { g, esc, ic } = W;
  const S = { get s() { return g('s', 'default'); }, get host() { return g('host', 'app'); } };
  const keep = () => { const q = new URLSearchParams(); for (const k of ['theme', 'w']) if (W.P.has(k)) q.set(k, W.P.get(k)); const t = q.toString(); return t ? '?' + t : ''; };
  const to = (page, extra) => { const q = new URLSearchParams(); for (const k of ['theme', 'w']) if (W.P.has(k)) q.set(k, W.P.get(k)); if (extra) for (const [k, v] of Object.entries(extra)) q.set(k, v); const t = q.toString(); return page + (t ? '?' + t : ''); };
  const hidden = new Set();

  const SAVED = [
    { id: 'a1', type: 'Angular + NestJS monorepo', phases: 4, date: '14 Oct 2026, 11:05', model: 'Claude Sonnet 4.5', dur: '3m 12s' },
    { id: 'a2', type: 'Angular + NestJS monorepo', phases: 4, date: '2 Oct 2026, 09:40', model: 'Claude Sonnet 4.5', dur: '3m 40s' },
    { id: 'a3', type: 'Node library', phases: 3, date: '21 Sep 2026, 16:18', model: 'Claude Opus 4.1', dur: '5m 02s' },
  ];

  function modelPicker() {
    return `<details class="pv" style="margin-top:8px"><summary>${ic('cpu', 'i-sm')}Provider and model for analysis<svg class="i i-sm chev" aria-hidden="true"><use href="#i-chevron-right"/></svg></summary><div class="pvb">
      <label class="fl" for="l-prov">Provider</label><select id="l-prov" class="field"><option>Anthropic</option><option>OpenRouter</option></select>
      <label class="fl" for="l-model" style="margin-top:8px">Analysis model</label><select id="l-model" class="field"><option>Claude Sonnet 4.5</option><option>Claude Opus 4.1</option></select>
      <p class="meta" style="margin:8px 0 0">Agent generation and project guidance have their own model choice in their tabs.</p></div></details>`;
  }

  function cards() {
    const s = S.s;
    const agentsRun = s === 'running-agents' || s === 'running-both';
    const guidRun = s === 'running-both';
    const agentCard = `<section class="wf ${agentsRun ? 'run' : ''}" aria-labelledby="wf-a"><div class="ico">${ic('bot', 'i-lg')}</div>
      <div><h3 id="wf-a">Generate agents</h3><p>Choose agents for your stack and write them to your workspace. Works without an analysis.</p>
        ${agentsRun ? `<p class="statusline" role="status" style="margin-top:8px"><span class="pulse"></span>Running in this workspace</p>` : ''}
        ${s === 'resume-agents' ? `<div class="status info" role="status" style="margin-top:10px" data-testid="resume-generation-banner"><span class="ic">${ic('refresh-cw', 'i-lg')}</span><div class="grow"><h3>Unfinished agent generation found</h3><p>5 selected agents were saved. Resume to continue where it stopped. Files already written are kept.</p></div></div>` : ''}
        ${s === 'blocked' ? `<div class="status warn" role="status" style="margin-top:10px"><span class="ic">${ic('triangle-alert', 'i-lg')}</span><div class="grow"><h3>Another workspace is generating agents</h3><p>${esc(W.OTHER_WS)} has an agent run in progress. Wait for it to finish, then start here.</p></div></div>` : ''}
      </div>
      <div class="go">${s === 'blocked'
        ? `<button class="btn btn-outline" aria-disabled="true" aria-describedby="blk-why">Generate agents</button><span class="meta" id="blk-why">Waiting for ${esc(W.OTHER_WS)}.</span>`
        : agentsRun ? `<a class="btn btn-outline" href="${to('agents.html', { s: 'running' })}">Open running tab${ic('arrow-right', 'i-sm')}</a>`
          : s === 'resume-agents' ? `<a class="btn btn-outline" href="${to('agents.html', { s: 'resume' })}" aria-label="Resume generation">${ic('circle-play', 'i-sm')}Resume generation</a>`
            : `<a class="btn btn-outline" href="${to('agents.html')}">Generate agents${ic('chevron-right', 'i-sm')}</a>`}</div></section>`;
    const guidCard = `<section class="wf ${guidRun ? 'run' : ''}" aria-labelledby="wf-g"><div class="ico">${ic('sparkles', 'i-lg')}</div>
      <div><h3 id="wf-g">Generate project guidance</h3><p>Write project-specific guidance that improves AI answers for this codebase. Works without an analysis.</p>
        ${guidRun ? `<p class="statusline" role="status" style="margin-top:8px"><span class="pulse"></span>Running in this workspace</p>` : ''}
        ${s === 'guidance-saved' ? `<p class="meta" style="margin:8px 0 0">${ic('circle-check', 'i-xs ic-ok')} Guidance saved 14 Oct 2026. Active for all sessions.</p>` : ''}</div>
      <div class="go">${guidRun ? `<a class="btn btn-outline" href="${to('guidance.html', { s: 'running' })}">Open running tab${ic('arrow-right', 'i-sm')}</a>`
        : s === 'guidance-saved' ? `<a class="btn btn-outline" href="${to('guidance.html', { s: 'existing' })}">Open project guidance${ic('chevron-right', 'i-sm')}</a>`
          : `<a class="btn btn-outline" href="${to('guidance.html')}">Generate project guidance${ic('chevron-right', 'i-sm')}</a>`}</div></section>`;
    const analysisCard = `<section class="wf" aria-labelledby="wf-s"><div class="ico">${ic('search', 'i-lg')}</div>
      <div><h3 id="wf-s">Workspace analysis <span class="badge badge-mute" style="vertical-align:middle;margin-left:4px">Optional</span></h3><p>Scan the project in four phases and review what was found. Agents and guidance use a current analysis when there is one, but never need it.</p>
        ${s === 'resume-analysis' ? `<div class="status info" role="status" style="margin-top:10px"><span class="ic">${ic('refresh-cw', 'i-lg')}</span><div class="grow"><h3>Unfinished analysis found</h3><p>The last analysis stopped after phase 2 of 4. Resume it, or start a new one.</p></div></div>` : ''}</div>
      <div class="go">${s === 'resume-analysis' ? `<button class="btn btn-outline" data-act="toast" data-msg="Opens the existing analysis progress page (unchanged).">${ic('circle-play', 'i-sm')}Resume analysis</button><button class="btn" data-act="toast" data-msg="Starts a new analysis on the existing scan page (unchanged).">Start a new analysis</button>`
        : `<button class="btn btn-outline" data-act="toast" data-msg="Opens the existing analysis scan page (unchanged).">Run analysis${ic('chevron-right', 'i-sm')}</button>`}</div>
      <div class="extra">${modelPicker()}</div></section>`;
    return agentCard + guidCard + analysisCard;
  }

  function savedList() {
    const s = S.s;
    let body;
    if (s === 'loading') body = `<div role="status" class="help">${ic('loader-circle', 'i-sm spin')} Loading previous analyses...</div><div class="skel"></div><div class="skel"></div>`;
    else if (s === 'list-error') body = `<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Previous analyses did not load</h3><p style="color:oklch(var(--bc))">Saved analyses could not be listed. Generation is not affected.</p><div class="acts"><button class="btn btn-outline">${ic('refresh-cw', 'i-sm')}Retry</button></div></div></div>`;
    else if (['saved', 'resume-analysis', 'resume-agents', 'running-agents', 'running-both', 'blocked', 'guidance-saved'].includes(s)) {
      body = SAVED.filter((a) => !hidden.has(a.id)).map((a) => `<div class="saved" data-id="${a.id}"><div style="min-width:0"><div class="t"><span>${esc(a.type)}</span> <span class="badge badge-ghost badge-sm">${a.phases} phases</span></div><div class="m"><span>${ic('clock', 'i-xs')} ${a.date}</span><span>${a.model}</span><span>${a.dur}</span></div></div>
        <div class="row-flex"><button class="btn btn-outline" aria-label="Use this analysis" data-act="toast" data-msg="Loads the saved analysis into the existing results page (unchanged). Agents and guidance still re-check freshness when they start.">Use This</button><button class="btn sq" aria-label="Hide this analysis from the list" title="Hide from this list. Files are not deleted." data-act="hide" data-id="${a.id}">${ic('eye-off', 'i-sm')}</button></div></div>`).join('')
        || `<p class="help" style="margin:0">All saved analyses are hidden from this list. Their files were not deleted.</p>`;
    } else body = `<p class="help" style="margin:0">No saved analyses yet. Generation works without one.</p>`;
    return `<div class="divl">Previous analyses</div>${body}<p class="sr-only" id="live" role="status" aria-live="polite"></p>`;
  }

  function render() {
    const panel = S.host === 'panel';
    return `<div class="page" data-sb="closed">
      <header class="hdr"><div class="hdr-l">${panel ? '' : `<a class="btn sq" href="${to('hub.html')}" aria-label="Back to Setup Hub">${ic('arrow-left')}</a>`}<h1>Setup Wizard</h1><span class="ws-chip" title="${esc(W.WS)}">${ic('folder', 'i-xs')}<span>${esc(W.WS)}</span></span></div>
      <div class="hdr-r">${panel ? `<button class="btn" aria-label="Close setup wizard">${ic('x', 'i-sm')}Close</button>` : ''}</div></header>
      <main class="land"><div class="land-in"><h2 class="lead">What do you want to set up?</h2>
        <p class="muted" style="margin:0 0 16px;font-size:13px">Each workflow runs on its own. Generation uses a current analysis when one exists and otherwise reads your workspace.</p>
        ${cards()}${savedList()}</div></main><div class="sr-only" id="toast" role="status" aria-live="polite"></div></div>`;
  }
  W.acts.toast = (b) => { const t = document.getElementById('toast'); t.textContent = b.dataset.msg; t.className = ''; t.style.cssText = 'position:absolute;left:50%;bottom:16px;transform:translateX(-50%);max-width:min(480px,90%);padding:8px 12px;border-radius:8px;background:var(--surface-3);border:1px solid var(--surface-border-strong);box-shadow:var(--elev-shadow-raised);font-size:12px;z-index:30'; clearTimeout(W.tt); W.tt = setTimeout(() => { t.removeAttribute('style'); t.className = 'sr-only'; }, 3500); };
  W.acts.hide = (b) => { hidden.add(b.dataset.id); b.closest('.saved').remove(); const l = document.getElementById('live'); if (l) l.textContent = 'Analysis hidden from this list. Its files were not deleted.'; };

  W.mount({
    page: 'Setup Wizard landing',
    controls: [
      { k: 's', label: 'State', opts: [['default', 'no analyses'], ['saved', 'saved analyses'], ['loading', 'loading list'], ['list-error', 'list failed'], ['resume-analysis', 'unfinished analysis'], ['resume-agents', 'unfinished agent run'], ['running-agents', 'agents running'], ['running-both', 'both running'], ['blocked', 'agents blocked: other workspace'], ['guidance-saved', 'guidance saved']] },
      { k: 'host', label: 'Host', opts: [['app', 'app route'], ['panel', 'VS Code panel']] },
    ],
    render,
  });
})();
