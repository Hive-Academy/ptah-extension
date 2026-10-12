const { chromium } = require('playwright-core');
exports.connect = async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const p = b.contexts()[0].pages()[0];
  return { b, p };
};
exports.gotoAnalytics = async (p) => {
  if (!(await p.locator('ptah-provider-account-row').count())) {
    await p.getByText('Analytics', { exact: true }).first().click();
    await p.waitForSelector('ptah-provider-account-row');
  }
};
// Inject FIXTURE rows (marked data-fixture) built from the row template markup.
exports.inject = async (p) =>
  p.evaluate(() => {
    if (document.querySelector('[data-fixture]')) return 'already';
    const ul = document.querySelector('ul.rows');
    const realRows = [...ul.querySelectorAll('li')];
    const sec = realRows[0].querySelector('section');
    const ngc = sec.getAttributeNames().find((n) => n.startsWith('_ngcontent-'));
    const markOf = (i) => realRows[i].querySelector('ptah-provider-mark').outerHTML;
    const markA = markOf(0),
      markB = markOf(1);
    const chipCls = {
      warning: 'border-warning bg-warning/15 font-semibold',
      error: 'border-error bg-error/15 font-semibold',
      neutral: 'border-dashed border-base-content/20',
      info: 'border-info bg-info/15',
    };
    const barCls = { success: 'bg-success', warning: 'bg-warning', error: 'bg-error', neutral: 'bg-base-content' };
    const win = (w) => `<div role="group" aria-label="${w.name}" class="win" data-testid="window-row">
    <div class="win-top"><span class="min-w-0"><span class="text-[13px] font-semibold">${w.name}</span>
    ${w.chip ? `<span class="text-[11px] px-1.5 rounded border whitespace-nowrap ${chipCls[w.chipTone]}" data-testid="state-chip"><span aria-hidden="true">${w.chip[0]} </span>${w.chip.slice(2)}</span>` : ''}</span>
    <span class="sr-only">${w.vt}</span>
    <span class="text-xs font-semibold tabular-nums break-words whitespace-nowrap" data-testid="window-value">${w.p === null ? 'Unknown' : w.p + '%'}</span></div>
    ${
      w.p === null
        ? `<div class="bar bar-unknown h-1.5 w-full rounded" aria-hidden="true" data-testid="window-unknown-bar"></div>`
        : `<div class="bar h-1.5 w-full overflow-hidden rounded bg-base-content/10" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${w.p}" aria-valuetext="${w.vt}" aria-label="${w.name} plan usage" data-testid="window-progress"><div class="h-full rounded ${barCls[w.tone]}" style="width:${w.p}%"></div><span class="bar-tick" aria-hidden="true" style="left:90%"></span></div>`
    }
    <div class="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-base-content-muted break-words">${w.resets.map((r, i) => `<span${i === 0 && r.startsWith('Resets in') ? ' class="font-semibold"' : ''}>${r}</span>`).join('')}</div></div>`;
    const local = (v) => `<div class="local" data-testid="local-usage-stat"><p class="text-[10px] uppercase tracking-wider text-base-content-muted">Local usage (7d)</p><p class="text-sm font-semibold tabular-nums">${v}</p><p class="text-[11px] text-base-content-muted">Local CLI accounting · not a plan percentage or reset</p></div>`;
    const row = (o) => `<li class="row" data-fixture="${o.id}"><ptah-provider-account-row><section class="surface-2 owner-row ${o.wins.length ? '' : 'owner-row--compact'}" style="--accent:${o.accent}" aria-label="${o.label} usage" data-testid="provider-account-section">
    <div class="identity min-w-0" data-testid="section-header"><span class="mark-box" aria-hidden="true">${o.mark}</span><div class="min-w-0"><h5 class="font-semibold text-sm break-words">${o.label}</h5>
    <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-1"><span class="text-[10px] text-base-content-muted break-words">${o.sub}</span>
    ${o.src ? `<span class="flex flex-wrap gap-1" aria-label="Usage source"><span class="text-[10px] px-1 rounded border border-base-content/20 text-base-content-muted" data-testid="source-chip">${o.src}</span></span>` : ''}
    ${o.badge ? `<span class="badge badge-sm whitespace-normal h-auto text-left ${o.badge[1]}" data-testid="status-chip">${o.badge[0]}</span>` : ''}</div></div></div>
    ${o.wins.length ? `<div class="mid"><div class="wins">${o.wins.map(win).join('')}</div></div>` : o.reason ? `<p role="status" class="mid text-xs ${o.reasonCls || 'text-base-content-muted'}" data-testid="compact-reason">${o.reason}</p>` : ''}
    ${o.local ? local(o.local) : ''}
    <div class="actions"><button type="button" class="btn btn-ghost btn-xs btn-square" aria-label="Refresh ${o.label} usage" title="Refresh usage"><span aria-hidden="true">↻</span></button></div>
    </section></ptah-provider-account-row></li>`;
    const fx = [
      {
        id: 'claude-full', label: 'Claude Max · ada@example.test · d525', sub: 'Max 20x', accent: '#d97757', mark: markA, src: 'Official API',
        wins: [
          { name: '5-hour', p: 42, tone: 'success', vt: '42% used', resets: ['Resets in 2h 10m', 'Mon 9:00 AM PDT'] },
          { name: 'Weekly', p: 92, tone: 'warning', chip: '▲ Near limit', chipTone: 'warning', vt: '92% used, near limit', resets: ['Resets in 3d', 'Fri 6:00 PM PDT'] },
          { name: 'Opus weekly', p: 100, tone: 'error', chip: '■ Limit reached', chipTone: 'error', vt: '100% used, limit reached', resets: ['Resets in 1d 4h', 'Tue 1:00 AM PDT'] },
          { name: 'Sonnet weekly', p: 97, tone: 'neutral', chip: '◷ Aged', chipTone: 'neutral', vt: '97% used, aged data', resets: ['Resets in 3d', 'Last seen 6h ago'] },
          { name: 'Design', p: 57, tone: 'neutral', chip: '? Not confirmed', chipTone: 'neutral', vt: '57% used, not confirmed', resets: ['Resets in 5d'] },
          { name: 'Overage credits', p: null, chip: '? Unknown', chipTone: 'neutral', vt: 'Usage unknown', resets: ['No reset reported'] },
        ],
      },
      {
        id: 'codex-two', label: 'OpenAI Codex · grace@example.test · 77ab', sub: 'Plus', accent: '#10a37f', mark: markB, src: 'Provider (unofficial)',
        wins: [
          { name: '5-hour', p: 12, tone: 'success', vt: '12% used', resets: ['Resets in 4h 50m'] },
          { name: 'Weekly', p: 89, tone: 'success', vt: '89% used', resets: ['Resets in 2d'] },
        ],
      },
      { id: 'opencode-local', label: 'OpenCode Zen · key 9c1f', sub: 'Pay as you go', accent: '#3b82f6', mark: markB, wins: [], reason: 'This provider does not report plan usage.', local: '1.24M tokens · $3.18 est.' },
      {
        id: 'long', label: 'Anthropic via a-very-long-custom-gateway-label-that-has-no-breaks-at-all-0123456789abcdefghijklmnopqrstuvwxyz · d00d',
        sub: 'Custom endpoint with long plan subtitle text that should wrap', accent: '#d97757', mark: markA, badge: ['Cached data', 'badge-warning'], wins: [],
        reason: 'Showing cached account data from 2 days ago; the account could not be reached.', reasonCls: 'rounded border px-2 py-1 border-warning',
      },
    ];
    for (const f of fx) ul.insertAdjacentHTML('beforeend', row(f));
    for (const el of ul.querySelectorAll('[data-fixture] *')) el.setAttribute(ngc, '');
    const liAttr = realRows[0].getAttributeNames().filter((n) => n.startsWith('_ngcontent-'));
    for (const li of ul.querySelectorAll('li[data-fixture]')) for (const a of liAttr) li.setAttribute(a, '');
    return 'injected ' + ngc + ' li:' + liAttr;
  });
