/* TASK_2026_650 prototype: Setup Hub excerpt. CONTENT AND WIRING ILLUSTRATION ONLY, not a pixel-accurate Hub layout: the Hub keeps its design (649 D10/D12). This page shows only that the two new
   starts reuse the existing Hub card recipe (the Workspace Analysis card: icon tile, title, text, one outline button) and that the
   grid reflows. Example data only. */
(function () {
  'use strict';
  const W = window.W; const { g, ic } = W;
  const hub = g('hub', 'default');
  const to = (page, extra) => { const q = new URLSearchParams(); for (const k of ['theme', 'w']) if (W.P.has(k)) q.set(k, W.P.get(k)); if (extra) for (const [k, v] of Object.entries(extra)) q.set(k, v); const t = q.toString(); return page + (t ? '?' + t : ''); };
  const card = (icon, title, text, cta, href, state) => `<div class="hcard"><div style="display:flex;justify-content:space-between;align-items:flex-start"><div class="ico">${ic(icon, 'i-lg')}</div>${state ? `<span class="statusline"><span class="pulse"></span>${state}</span>` : ''}</div>
    <div><h2>${title}</h2><p>${text}</p></div><a class="btn btn-outline btn-wide" style="margin-top:auto" href="${href}">${cta}${ic('chevron-right', 'i-sm')}</a></div>`;
  function render() {
    return `<div class="page" data-sb="closed"><div class="hub"><header class="hub-h"><div class="row-flex"><button class="btn sq" aria-label="Back to chat">${ic('arrow-left')}</button><h1>Setup Hub</h1></div><button class="btn">${ic('refresh-cw', 'i-sm')}Refresh</button></header>
      <main class="hub-m"><p class="muted" style="margin:0;font-size:14px">Your workspace <strong style="color:oklch(var(--bc))">${W.WS}</strong> is configured. Pick up where you left off, or start something new.</p>
      <div class="status info" style="margin-top:12px"><span class="ic">${ic('info', 'i-lg')}</span><div class="grow"><h3>Content and wiring illustration, not a pixel-accurate Hub</h3><p>The Hub home keeps its design and this excerpt is not a Hub layout or a new grid rule. It shows only the labels and wiring of the two new cards (Generate Agents, Generate Project Guidance), which the implementation clones from the real Workspace Analysis card markup. The real Hub card styling (gradient border, progress ring) is unchanged and not redrawn here.</p></div></div>
      <div class="grid">
        ${card('search', 'Workspace Analysis', 'Analyze your project and configure agents with AI-powered recommendations.', 'Reconfigure', to('landing.html'))}
        ${card('bot', 'Generate Agents', 'Choose agents for your stack and write them to your workspace. Works without an analysis.', hub === 'blocked' ? 'Generate Agents' : hub === 'running' ? 'Open running tab' : 'Generate Agents', to('agents.html', hub === 'running' ? { s: 'running' } : {}), hub === 'running' ? 'Running' : '')}
        ${card('sparkles', 'Generate Project Guidance', 'Write project-specific guidance that improves AI answers for this codebase. Works without an analysis.', 'Generate Guidance', to('guidance.html'))}
        ${card('wand-sparkles', 'AI Team Builder', 'Design your agents, skills, prompts and MCP servers with an AI planner.', 'Create / Edit AI Team', '#')}
        ${card('rocket', 'New Project', 'Plan and scaffold a brand-new SaaS workspace with a generated roadmap and its own AI team.', 'Start New Project', '#')}
      </div></main></div></div>`;
  }
  W.mount({ page: 'Setup Hub (reference excerpt)', controls: [{ k: 'hub', label: 'State', opts: [['default', 'default'], ['running', 'agents running']] }], render });
})();
