/* TASK_2026_650 prototype: shared helpers (prototype chrome, header, peek bar, sheet behaviour, dialog, source status card,
   chat stand-in, example data). Example data only. Prototype code, not product code. */
(function () {
  'use strict';
  const P = new URLSearchParams(location.search);
  const g = (k, d) => (P.has(k) ? P.get(k) : d);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const W = { P, g, esc, ic, acts: {}, WS: 'acme-analytics', OTHER_WS: 'billing-api' };

  /* ---------- example data ---------- */
  W.MODEL = { provider: 'Anthropic', model: 'Claude Sonnet 4.5' };

  /* Freshness / source messages: EXACT strings from task-description.md "Freshness definition" table. */
  W.SOURCE_MSG = {
    ok: 'Using the latest verified workspace analysis.',
    'no-analysis': 'No saved analysis found. Gathering current workspace context.',
    unreadable: 'Saved analysis could not be read. Gathering current workspace context.',
    'legacy-v3': 'Saved analysis uses an older format. Gathering current workspace context.',
    incomplete: 'Saved analysis is incomplete. Gathering current workspace context.',
    expired: 'Saved analysis is too old. Gathering current workspace context.',
    'workspace-changed': 'Workspace changed since analysis. Gathering current context.',
    'output-mismatch': 'Saved analysis files no longer match. Gathering current workspace context.',
    'not-latest': 'Selected analysis is not the latest. Gathering current workspace context.',
    failed: 'Analysis status is unavailable. Gathering current workspace context.',
  };
  W.SOURCE_LABEL = {
    ok: 'ok (fresh)', 'no-analysis': 'no-analysis', unreadable: 'unreadable', 'legacy-v3': 'legacy-v3', incomplete: 'incomplete', expired: 'expired',
    'workspace-changed': 'workspace-changed', 'output-mismatch': 'output-mismatch', 'not-latest': 'requested analysis is not the latest run', failed: 'freshness lookup failed',
  };

  /* Source status card (design-spec section 6). opts.recorded = shown after the run started (source stored with the run). */
  W.sourceCard = function (reason, opts = {}) {
    const rec = opts.recorded ? `<p class="meta" style="margin:6px 0 0">Recorded for this run.</p>` : '';
    if (reason === 'checking') {
      return `<div class="status idle" role="status"><span class="ic">${ic('loader-circle', 'i-lg spin')}</span><div class="grow"><p class="src-m">Checking saved analysis...</p></div></div>`;
    }
    if (reason === 'unchecked') {
      return `<div class="status idle" role="status"><span class="ic">${ic('circle-dashed', 'i-lg')}</span><div class="grow"><p class="src-m">Checked when the run starts</p><p class="meta" style="margin:4px 0 0">A verified analysis is used when one is current. Otherwise the context comes from your workspace.</p></div></div>`;
    }
    if (reason === 'rejected') {
      return `<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><p class="src-m">Start rejected</p><p class="meta" style="margin:4px 0 0;color:oklch(var(--bc))">The selected analysis belongs to a different workspace. Nothing was started.</p></div></div>`;
    }
    if (reason === 'tab-mismatch') {
      return `<div class="status err" role="alert"><span class="ic">${ic('circle-alert', 'i-lg')}</span><div class="grow"><p class="src-m">Start rejected</p><p class="meta" style="margin:4px 0 0;color:oklch(var(--bc))">This tab is for ${esc(W.WS)}, but the app is connected to ${esc(W.OTHER_WS)}. Nothing was started.</p></div></div>`;
    }
    if (reason === 'ok') {
      return `<div class="status done" role="status"><span class="ic">${ic('circle-check', 'i-lg')}</span><div class="grow"><p class="src-m" style="color:oklch(var(--bc))">Verified analysis</p>
        <p class="meta" style="margin:2px 0 0;color:oklch(var(--bc))">${W.SOURCE_MSG.ok}</p>
        <dl class="dl dsd"><dt>Analysis run</dt><dd class="tnum">14 Oct 2026, 11:05</dd><dt>Phases</dt><dd>4 of 4 verified</dd></dl>${rec}
        ${opts.noActions ? '' : `<div class="acts" style="margin-top:10px"><button class="btn btn-outline">${ic('external-link', 'i-sm')}Open analysis</button></div>`}</div></div>`;
    }
    const msg = W.SOURCE_MSG[reason] || W.SOURCE_MSG['no-analysis'];
    return `<div class="status info" role="status"><span class="ic">${ic('scan-search', 'i-lg')}</span><div class="grow"><p class="src-m">Current workspace</p>
      <p class="meta" style="margin:2px 0 0;color:oklch(var(--bc))">${msg}</p>${rec}
      ${opts.noActions ? '' : `<div class="acts" style="margin-top:10px"><button class="btn">${ic('search', 'i-sm')}Run workspace analysis</button></div>`}</div></div>`;
  };

  /* ---------- section / header / peek / sidebar ---------- */
  W.sec = (id, label, meta, body) => `<section class="sec" aria-labelledby="h-${id}"><div class="sec-head"><h3 class="label" id="h-${id}">${label}</h3>${meta ? `<span class="meta">${meta}</span>` : ''}</div>${body}</section>`;
  W.header = ({ title, workflow, summary, sbOpen, toggleName }) => `<header class="hdr"><div class="hdr-l"><h1>${title}</h1>
    <span class="badge badge-ghost hide-narrow"><span class="sr-only">Workflow: </span>${workflow}</span><span class="compact-mark only-narrow muted" title="${workflow}"><span class="sr-only">Workflow: ${workflow}</span>${ic('workflow', 'i-sm')}</span>
    ${summary ? `<span class="summary muted">${summary}</span>` : ''}<span class="ws-chip" title="${esc(W.WS)}">${ic('folder', 'i-xs')}<span>${esc(W.WS)}</span></span></div>
    <div class="hdr-r"><button class="btn hide-narrow ${sbOpen ? 'on' : ''}" id="sb-toggle" data-act="toggle-sb" aria-expanded="${sbOpen}" aria-controls="wizard-sidebar" aria-label="${sbOpen ? 'Hide ' + toggleName + ' panel' : 'Show ' + toggleName + ' panel'}">${ic('panel-right', 'i-sm')}<span>${sbOpen ? 'Hide panel' : 'Show panel'}</span></button></div></header>`;
  W.peek = ({ label, meta, status, sbOpen, stop }) => `<div class="peekrow"><button class="peek" id="peek" data-act="toggle-sb" aria-expanded="${sbOpen}" aria-controls="wizard-sidebar"><span class="pl">${label}</span><span class="meta tnum">${meta || ''}</span>${status ? `<span class="ps ${status.cls}">${ic(status.icon, 'i-sm')}${status.text}</span>` : '<span class="ps"></span>'}${ic('chevron-down', 'i-sm pk-chev')}</button>${stop === 'busy' ? `<button class="btn sq peek-stop" aria-disabled="true" aria-busy="true" aria-label="Stopping generation" title="Stopping generation">${ic('loader-circle', 'i-sm spin')}</button>` : stop ? `<button class="btn sq peek-stop" data-act="stop" aria-label="Stop generation" title="Stop generation">${ic('square', 'i-sm ic-err')}</button>` : ''}</div>`;
  /* Stop generation: the run-bound cancel control (design-spec 2.3.2). Shown in the Run section and, under 720 px, next to the peek bar. */
  W.stopBtn = (busy, label) => busy ? `<button class="btn btn-outline" id="gen-stop" aria-disabled="true" aria-busy="true">${ic('loader-circle', 'i-sm spin')}${label || 'Stopping...'}</button>` : `<button class="btn btn-outline" id="gen-stop" data-act="stop" aria-label="Stop generation">${ic('square', 'i-sm ic-err')}Stop generation</button>`;
  W.sidebar = ({ name, summary, sections }) => `<div class="sb-wrap" id="wizard-sidebar-wrap"><aside class="sb" id="wizard-sidebar" aria-label="${name}">
    <div class="sb-head"><h2 id="sb-title">${ic('settings', 'i-sm')}${name}</h2><span class="meta">${summary || ''}</span></div>
    <div class="sb-scroll" id="sb-scroll">${sections.filter(Boolean).join('')}</div></aside></div>`;
  W.tabbar = (tabs) => `<div class="tabbar" aria-hidden="true">${tabs.map((t) => `<span class="tab ${t.on ? 'on' : ''}">${t.dot ? `<span class="tdot ${t.dot}"></span>` : ''}${esc(t.name)}</span>`).join('')}<span class="lbl">Main chat tab bar (stand-in)</span></div>`;

  /* ---------- chat stand-in ---------- */
  W.chat = ({ thread, placeholder, stop, model }) => `<div class="standin" style="display:flex;flex-direction:column;flex:1;min-height:0">
    <div class="thread" role="log" aria-label="Conversation transcript" tabindex="0">${thread}</div>
    <div class="composer"><div class="cbox"><div class="ph">${placeholder || 'Ask a question or describe a task...'}</div>
    <div class="crow"><button class="btn sq" aria-label="Attach files or images">${ic('paperclip')}</button>
    <button class="sel" aria-label="Select model">${model || W.MODEL.model} ${ic('chevron-down', 'i-xs')}</button><span class="sp"></span>
    ${stop ? `<button class="btn sq" aria-label="Stop generating" title="Stand-in for the chat's own Stop. On these tabs it cancels the run, the same as Stop generation (design-spec 2.9.1)" style="border-color:oklch(var(--bc)/.5)">${ic('square', 'i-sm')}</button>` : `<button class="btn btn-primary sq" aria-label="Send message">${ic('send', 'i-sm')}</button>`}</div></div></div></div>`;
  W.msgA = (html) => `<div class="msg-a">${html}</div>`;
  W.work = (text) => `<div class="work">${ic('loader-circle', 'i-sm spin')}${text}</div>`;

  /* ---------- dialog ---------- */
  W.dialog = ({ title, body, buttons, wide }) => `<div class="scrim" data-scrim data-act="dlg-scrim"><div class="dlg ${wide ? 'lg' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d" ${wide ? 'style="max-width:520px;max-height:calc(100% - 32px);overflow-y:auto"' : ''}>
    <h2 id="dlg-t">${title}</h2><div id="dlg-d">${body}</div><div class="btns">${buttons}</div></div></div>`;

  /* ---------- mount ---------- */
  W.mount = function (cfg) {
    const theme = g('theme', 'dark');
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'anubis-light' : 'anubis');
    const widthSel = g('w', 'fill');
    const root = document.getElementById('app');
    const sel = (k, label, opts) => `<label>${label}<select data-ctl="${k}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${v}" ${g(k, opts[0][0]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    root.innerHTML = `<div class="stage"><div class="proto" role="toolbar" aria-label="Prototype controls"><span class="tag">Prototype</span><a href="index.html">Index</a><strong>${cfg.page}</strong>
      ${(cfg.controls || []).map((c) => sel(c.k, c.label, c.opts)).join('')}
      ${sel('w', 'Width', [['fill', 'Fill'], ['960', '960'], ['720', '720'], ['400', '400'], ['360', '360']])}
      <button type="button" id="theme-toggle" aria-pressed="${theme === 'light'}">Theme: ${theme === 'light' ? 'light' : 'dark'}</button></div>
      <div class="frame-wrap ${widthSel !== 'fill' ? 'fixed' : ''}" id="frame-wrap"><div class="frame" id="frame" style="${widthSel !== 'fill' ? `--fw:${parseInt(widthSel, 10)}px` : ''}"></div></div></div>`;
    const frame = document.getElementById('frame');
    let ro = null; let ret = null;
    const page = () => frame.querySelector('.page');
    const isNarrow = () => { const p = page(); return p ? p.getBoundingClientRect().width < 720 : false; };
    W.sbInit = () => (P.has('sb') ? P.get('sb') : frame.clientWidth >= 720 ? 'open' : 'closed');
    W.isNarrow = isNarrow;
    function sync() {
      const p = page(); if (!p) return;
      const open = p.dataset.sb === 'open'; const narrow = isNarrow(); const dlg = !!p.querySelector('.dlg');
      const cc = document.getElementById('chatcol');
      if (cc) { cc.inert = (narrow && open) || dlg; cc.setAttribute('aria-hidden', String((narrow && open) || dlg)); }
      const t = document.getElementById('sb-toggle'); const pk = document.getElementById('peek');
      if (t) { const nm = t.getAttribute('aria-label').replace(/^(Hide|Show) /, '').replace(' panel', ''); t.setAttribute('aria-expanded', String(open)); t.setAttribute('aria-label', (open ? 'Hide ' : 'Show ') + nm + ' panel'); t.classList.toggle('on', open); t.querySelector('span').textContent = open ? 'Hide panel' : 'Show panel'; }
      if (pk) pk.setAttribute('aria-expanded', String(open));
    }
    function render() {
      if (ro) ro.disconnect();
      const keepScroll = document.getElementById('sb-scroll')?.scrollTop || 0;
      frame.innerHTML = cfg.render(W);
      const sc = document.getElementById('sb-scroll'); if (sc) sc.scrollTop = keepScroll;
      const p = page();
      if (p) { ro = new ResizeObserver(sync); ro.observe(p); }
      const dlg = frame.querySelector('.dlg');
      if (dlg) { for (const el of frame.querySelectorAll('.hdr, .peekrow, .body, .tabbar')) el.inert = true; frame.querySelector('.scrim').inert = false; (document.getElementById('dlg-cancel') || dlg.querySelector('button'))?.focus(); }
      sync();
      if (cfg.after) cfg.after(frame, W);
      document.body.dataset.ready = '1';
    }
    W.render = render;
    W.acts.stop = () => { if (g('s') === 'starting') W.setParam('pend', '1'); W.setParam('s', 'cancelling'); render(); document.getElementById('gen-stop')?.focus(); setTimeout(() => { if (g('s') === 'cancelling') { W.setParam('s', 'cancelled'); render(); const h = document.querySelector('#wizard-sidebar .status h3'); if (h) { h.tabIndex = -1; h.focus(); } } }, 1200); };
    W.setParam = (k, v) => { if (v == null || v === '') P.delete(k); else P.set(k, v); try { history.replaceState(null, '', location.pathname + '?' + P.toString()); } catch (e) { /* file:// */ } };
    for (const s of root.querySelectorAll('select[data-ctl]')) {
      s.addEventListener('change', () => {
        const k = s.dataset.ctl; const first = s.options[0].value;
        W.setParam(k, s.value === first && k !== 'w' ? '' : s.value);
        if (k === 'w') { const fw = document.getElementById('frame-wrap'); const fm = document.getElementById('frame'); if (s.value === 'fill') { fw.classList.remove('fixed'); fm.style.removeProperty('--fw'); W.setParam('w', ''); } else { fw.classList.add('fixed'); fm.style.setProperty('--fw', parseInt(s.value, 10) + 'px'); } P.delete('sb'); }
        render();
      });
    }
    document.getElementById('theme-toggle').addEventListener('click', (e) => {
      const next = (g('theme', 'dark') === 'light') ? 'dark' : 'light';
      W.setParam('theme', next === 'dark' ? '' : next);
      document.documentElement.setAttribute('data-theme', next === 'light' ? 'anubis-light' : 'anubis');
      e.currentTarget.textContent = 'Theme: ' + next; e.currentTarget.setAttribute('aria-pressed', String(next === 'light'));
    });
    function closeDlg() { W.setParam('s', cfg.dialogCancelTo || ''); render(); (ret || document.getElementById('gen-btn'))?.focus(); }
    frame.addEventListener('click', (e) => {
      const scrim = e.target.matches('[data-scrim]'); if (scrim) return closeDlg();
      const b = e.target.closest('[data-act]'); if (!b) return;
      const a = b.dataset.act; const p = page();
      if (a === 'toggle-sb') { const was = p.dataset.sb === 'open'; p.dataset.sb = was ? 'closed' : 'open'; sync(); if (isNarrow()) document.getElementById('peek').focus(); }
      else if (a === 'set') { ret = b; for (const kv of b.dataset.set.split(';')) { const [k, v] = kv.split('='); W.setParam(k, v === '' ? '' : v); } render(); }
      else if (a === 'close-dlg') closeDlg();
      else if (W.acts[a]) W.acts[a](b, e);
    });
    frame.addEventListener('change', (e) => { if (cfg.onChange) cfg.onChange(e, W); });
    document.addEventListener('keydown', (e) => {
      const p = page(); if (!p) return;
      const dlg = p.querySelector('.dlg');
      if (dlg) {
        if (e.key === 'Escape') { e.preventDefault(); return closeDlg(); }
        if (e.key === 'Tab') { const f = [...dlg.querySelectorAll('button:not([disabled]):not([aria-disabled="true"])')]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
        return;
      }
      if (e.key === 'Escape' && isNarrow() && p.dataset.sb === 'open') { p.dataset.sb = 'closed'; sync(); document.getElementById('peek')?.focus(); }
    });
    render();
  };
  window.W = W;
})();
