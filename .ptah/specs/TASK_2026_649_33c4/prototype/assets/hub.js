/* TASK_2026_649 prototype: Setup Hub excerpt. Example data only. ?hub=draft|resume|conflict|resumeconflict|delete|abortwarn|none, &theme=light */
(function () {
  const P = new URLSearchParams(location.search);
  const g = (k, d) => (P.has(k) ? P.get(k) : d);
  const hub = g('hub', 'draft'), theme = g('theme', 'dark');
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'anubis-light' : 'anubis');
  const ic = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const draft = hub === 'draft' || hub === 'draftmissing' || hub === 'delete' || hub === 'resumeconflict' || hub === 'abortwarn';
  const npActive = hub === 'resume' || hub === 'resumeconflict' || hub === 'relay';
  const cfgActive = hub === 'conflict';

  const draftCard = draft ? `<section class="hcard draft" aria-labelledby="dr-t" style="margin-top:16px"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div style="min-width:0"><div class="label" style="margin-bottom:4px">Draft</div><h2 id="dr-t" style="font-size:16px">AI Team Builder draft</h2>
      <div class="meta-row"><span>${ic('folder', 'i-xs')} acme-analytics</span><span>Last activity 14 Oct, 11:05</span><span>Saved 14 Oct, 11:06</span><span class="tnum">12 turns</span></div></div>
      <div class="acts">${hub === 'draftmissing' ? `<button class="btn btn-primary">${ic('refresh-cw', 'i-sm')}Retry</button>` : `<button class="btn btn-primary">${ic('circle-play', 'i-sm')}Resume draft</button>`}<button class="btn btn-outline" aria-label="Delete the AI Team Builder draft">${ic('trash-2', 'i-sm')}Delete draft</button></div></div>${hub === 'draftmissing' ? `<div class="status err" role="alert" style="margin-top:12px"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>This draft's chat session could not be found</h3><p>The transcript cannot be restored. Nothing was started.</p></div></div>` : ''}</section>` : '';
  const banners = hub === 'openfailed' ? `<div class="status err" role="alert" style="margin-bottom:12px"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><h3>Could not open the builder</h3><p>Nothing was started. Try again.</p></div><button class="btn btn-outline">Retry</button></div>` : hub === 'relay' ? `<div class="status info" role="status" style="margin-bottom:12px"><span class="ic">${ic('info', 'i-lg')}</span><div class="grow"><h3>A New Project session is already open</h3><p>Use the cards below to choose what happens to it.</p></div></div>` : '';
  const warn = hub === 'abortwarn' ? `<div class="banner" role="status"><span>${ic('triangle-alert')}</span><div class="grow"><strong>The workflow was closed, but the agent may still be running</strong><div class="muted t12" style="color:oklch(var(--bc))">Stopping it failed. Check the session list and stop it there if it keeps going.</div></div><button class="btn sq" aria-label="Dismiss warning">${ic('x')}</button></div>` : '';
  const cfgCard = `<div class="hcard"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="ico">${ic('bot', 'i-lg')}</div>${cfgActive ? `<span class="statusline"><span class="pulse"></span>Running</span>` : ''}</div>
      <div><h2>AI Team Builder</h2><p>${cfgActive ? 'A session is running in this workspace. Opening the builder picks it up where you left off.' : 'Design your agents, skills, prompts and MCP servers with an AI planner.'}</p></div>
      <button class="btn btn-outline btn-wide" style="margin-top:auto">${cfgActive ? 'Resume AI Team Builder' : 'Create / Edit AI Team'}${ic('chevron-right', 'i-sm')}</button></div>`;
  const npCard = `<div class="hcard"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="ico">${ic('rocket', 'i-lg')}</div>${npActive ? `<span class="statusline"><span class="pulse"></span>In progress</span>` : ''}</div>
      <div><h2>New Project</h2><p>${npActive ? 'A New Project session is already open in this workspace. Pick up where you left off; starting again would replace it.' : 'Plan and scaffold a brand-new SaaS workspace with a generated roadmap and its own AI team.'}</p></div>
      <button class="btn btn-outline btn-wide" style="margin-top:auto" id="np-btn">${npActive ? ic('circle-play', 'i-sm') + 'Resume New Project' : 'Start New Project' + ic('chevron-right', 'i-sm')}</button></div>`;
  const other = (i, t, d) => `<div class="hcard"><div class="ico">${ic(i, 'i-lg')}</div><div><h2>${t}</h2><p>${d}</p></div></div>`;

  const dlgTitle = { conflict: 'Start the New Project?', resumeconflict: 'Resume this draft?' };
  const dlgBody = { conflict: 'An AI Team Builder session is open in this workspace. Save it as a draft to come back to later, or discard it. Starting a new project stops its agent.', resumeconflict: 'Your current New Project session becomes the draft, and the draft you picked opens in its place. Or discard the current session instead.' };
  const note = hub === 'conflict' ? '' : '';
  let dlg = '';
  if (hub === 'conflict' || hub === 'resumeconflict') {
    dlg = `<div class="scrim" data-scrim><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d"><h2 id="dlg-t">${dlgTitle[hub]}</h2><p id="dlg-d">${dlgBody[hub]}</p>
      ${hub === 'resumeconflict' ? `<div class="note">${ic('info', 'i-sm')}<span>You already have a saved draft from 14 Oct, 11:05. Saving replaces it. The older session stays in your session history.</span></div>` : ''}
      <div class="btns"><button class="btn btn-outline" id="dlg-cancel">Cancel</button><button class="btn btn-danger">${ic('trash-2', 'i-sm')}Discard</button><button class="btn btn-primary">Save as draft</button></div></div></div>`;
  } else if (hub === 'delete') {
    dlg = `<div class="scrim" data-scrim><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d" style="max-width:380px"><h2 id="dlg-t">Delete this draft?</h2><p id="dlg-d">The draft is removed from Setup Hub. The session stays in your session history, and nothing in the workspace changes.</p>
      <div class="btns"><button class="btn btn-outline" id="dlg-cancel">Cancel</button><button class="btn btn-danger">${ic('trash-2', 'i-sm')}Delete draft</button></div></div></div>`;
  }
  document.getElementById('app').innerHTML = `<div class="hub"><header class="hub-h"><div class="row-flex"><button class="btn sq" aria-label="Back to chat">${ic('arrow-left')}</button><h1>Setup Hub</h1></div><button class="btn">${ic('refresh-cw', 'i-sm')}Refresh</button></header>
    <main class="hub-m" ${dlg ? 'inert' : ''}>${warn}${banners}<p class="muted" style="margin:0;font-size:14px">Your workspace <strong style="color:oklch(var(--bc))">acme-analytics</strong> is configured. Pick up where you left off, or start something new.</p>
      ${draftCard}<div class="grid">${cfgCard}${npCard}${other('search', 'Workspace Analysis', 'Scan the project and see what is configured.')}${other('layers', 'Saved Presets', '3 presets. Solo SaaS developer, Agency delivery team and 1 more.')}</div></main>${dlg}</div>`;
  document.getElementById('dlg-cancel')?.focus();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelector('[data-scrim]')?.remove(); });
})();
