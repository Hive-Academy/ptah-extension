/* TASK_2026_650 prototype: context source status component gallery (every state, both themes via the toggle). */
(function () {
  'use strict';
  const W = window.W; const { ic } = W;
  function render() {
    const keys = ['unchecked', 'checking', 'ok', 'no-analysis', 'unreadable', 'legacy-v3', 'incomplete', 'expired', 'workspace-changed', 'output-mismatch', 'not-latest', 'failed', 'rejected', 'tab-mismatch'];
    const cap = { unchecked: 'Before the run starts (no status yet)', checking: 'Status lookup in flight', ok: 'ok (fresh)', rejected: 'Start rejected: foreign analysis directory', 'tab-mismatch': 'Start rejected: tab workspace differs from host workspace', failed: 'Freshness lookup failed', 'not-latest': 'Requested analysis is not the latest run' };
    return `<div class="page" data-sb="closed" style="overflow:auto"><header class="hdr"><div class="hdr-l"><h1>Context source status component</h1></div></header>
      <div class="gal">${keys.map((k) => `<figure><figcaption><code class="mono">${k}</code>: ${cap[k] || k}</figcaption><div class="cell">${W.sourceCard(k)}</div></figure>`).join('')}
      <figure><figcaption><code class="mono">no-analysis</code> with run recorded (after start)</figcaption><div class="cell">${W.sourceCard('no-analysis', { recorded: true })}</div></figure>
      <figure><figcaption><code class="mono">ok</code> with run recorded, no actions (while running)</figcaption><div class="cell">${W.sourceCard('ok', { recorded: true, noActions: true })}</div></figure></div></div>`;
  }
  W.mount({ page: 'Source status component', render });
})();
