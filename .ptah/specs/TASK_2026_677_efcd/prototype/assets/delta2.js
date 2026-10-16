/* Delta 2 prototype logic (TASK_2026_677_efcd): agent avatars/tiles + three thread-switcher options. Vanilla JS, not product code. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ data */
  // Role icon per agent type (lucide-angular names, verified in lucide-icons.d.ts). Fallback: bot.
  var ROLE_ICON = {
    'frontend-developer': 'layout-template', 'backend-developer': 'server-cog', 'software-architect': 'drafting-compass',
    'team-leader': 'users', 'project-manager': 'clipboard-list', 'ui-ux-designer': 'palette', 'senior-tester': 'flask-conical',
    'code-logic-reviewer': 'search-check', 'code-style-reviewer': 'scan-eye', 'researcher-expert': 'telescope',
    'devops-engineer': 'container', 'technical-content-writer': 'scroll-text', 'modernization-detector': 'sparkles',
    'visual-reviewer': 'eye'
  };
  var ROLE_LUCIDE = {
    'layout-template': 'LayoutTemplate', 'server-cog': 'ServerCog', 'drafting-compass': 'DraftingCompass', 'users': 'Users',
    'clipboard-list': 'ClipboardList', 'palette': 'Palette', 'flask-conical': 'FlaskConical', 'search-check': 'SearchCheck',
    'scan-eye': 'ScanEye', 'telescope': 'Telescope', 'container': 'Container', 'scroll-text': 'ScrollText', 'sparkles': 'Sparkles',
    'eye': 'Eye', 'bot': 'Bot', 'workflow': 'Workflow', 'square-terminal': 'SquareTerminal'
  };
  var STATUS = {
    run: { word: 'Running', glyph: 'loader-circle' }, done: { word: 'Done', glyph: 'check' }, err: { word: 'Error', glyph: 'circle-alert' },
    need: { word: 'Needs you', glyph: 'hand' }, idle: { word: 'Stopped', glyph: 'circle-pause' }
  };
  var KIND = { main: 'Orchestrator', sub: 'Sub-agent', cli: 'CLI lane', bg: 'Background' };
  var GROUPS = [{ id: 'main', label: 'Orchestrator' }, { id: 'sub', label: 'Sub-agents', short: 'Sub' }, { id: 'cli', label: 'CLI lanes', short: 'CLI' }, { id: 'bg', label: 'Background', short: 'Bg' }];
  var PI_PATH = 'M5 7 L19 7 M8 7 L8 18 M14 7 L14 18';
  var PTAH_PATH = 'M8 21 L8 3 L14.5 3 C17.5 3 19.5 5 19.5 8 C19.5 11 17.5 13 14.5 13 L8 13';

  function sub(type, st, dur, act, name) { return { k: type, name: name || type, group: 'sub', icon: ROLE_ICON[type] || 'bot', st: st, dur: dur, act: act, kind: 'sub' }; }
  var CORE = [
    { k: 'orchestrator', name: 'Orchestrator', group: 'main', icon: 'workflow', st: 'run', dur: 842, act: 'Delegating to 4 agents', kind: 'main' },
    sub('frontend-developer', 'run', 133, 'Edit canvas-lane-tabs.component.ts'),
    sub('software-architect', 'done', 281, 'Wrote implementation-plan.md'),
    { k: 'codex', name: 'Codex', group: 'cli', mark: 'm-codex', st: 'run', dur: 68, act: 'Running npx jest canvas', kind: 'cli' },
    { k: 'cursor', name: 'Cursor', group: 'cli', mark: 'm-cursor', st: 'err', dur: 32, act: 'Exited with code 1', kind: 'cli' },
    { k: 'claude', name: 'Claude', group: 'cli', mark: 'm-claude', st: 'done', dur: 380, act: 'Review finished, 3 findings', kind: 'cli' },
    { k: 'gemini', name: 'Gemini', group: 'cli', mono: 'G', st: 'need', dur: 51, act: 'Needs permission: rm -rf dist', kind: 'cli', cmd: 'rm -rf dist' },
    { k: 'bg-nx', name: 'nx test canvas', group: 'bg', icon: 'square-terminal', st: 'run', dur: 24, act: 'PASS libs/frontend/canvas', kind: 'bg' }
  ];
  var EXTRA_SUB = [
    sub('backend-developer', 'run', 97, 'Edit agent-monitor.store.ts'),
    sub('senior-tester', 'done', 205, 'Wrote 14 specs'),
    sub('code-logic-reviewer', 'run', 61, 'Reading lane-owner.ts'),
    sub('code-style-reviewer', 'done', 148, 'Review written'),
    sub('researcher-expert', 'done', 322, 'research-report.md'),
    sub('ui-ux-designer', 'done', 410, 'design-spec.md')
  ];
  function roster(n) {
    if (n <= 8) return CORE.slice();
    var out = CORE.slice(0, 3).concat(EXTRA_SUB, CORE.slice(3));
    return out;
  }

  /* --------------------------------------------------------------- helpers */
  var T0 = Date.now();
  function elapsed() { return Math.floor((Date.now() - T0) / 1000); }
  function dur(a) { return a.st === 'run' ? a.dur + elapsed() : a.dur; }
  function fmt(s) { var m = Math.floor(s / 60); var r = s % 60; return m + 'm ' + (r < 10 ? '0' : '') + r + 's'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function use(id, cls) { return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#' + id + '"/></svg>'; }
  function lu(name, cls) { return use('d-' + name, cls); }
  function inner(a) {
    if (a.mark) return '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#' + a.mark + '"/></svg>';
    if (a.strk) return '<svg class="strk" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + a.strk + '"/></svg>';
    if (a.mono) return '<span class="mono-g" aria-hidden="true">' + a.mono + '</span>';
    return lu(a.icon || 'bot', 'ic');
  }
  /* avatar: circle tile + status ring + corner glyph badge. size in px. */
  function av(a, size) {
    size = size || 24;
    var W = size + 8, r = W / 2 - 1.5;
    var ring = '<svg class="av__ring" viewBox="0 0 ' + W + ' ' + W + '" aria-hidden="true" focusable="false">' +
      '<circle class="trk" cx="' + W / 2 + '" cy="' + W / 2 + '" r="' + r + '" pathLength="100"/>' +
      '<circle class="halo" cx="' + W / 2 + '" cy="' + W / 2 + '" r="' + r + '" pathLength="100"/>' +
      '<circle class="arc" cx="' + W / 2 + '" cy="' + W / 2 + '" r="' + r + '" pathLength="100"/></svg>';
    var badge = '<span class="av__badge" aria-hidden="true">' + lu(STATUS[a.st].glyph, 'i') + '</span>';
    var cls = 'av av--' + size + ' st-' + a.st + (a.group === 'main' ? ' av--main' : '') + (a.group === 'bg' ? ' av--bgcmd' : '');
    return '<span class="' + cls + '"><span class="av__tile">' + inner(a) + '</span>' + ring + badge + '</span>';
  }
  function durSpan(a) { return '<span class="d tnum" data-dk="' + a.k + '">' + fmt(dur(a)) + '</span>'; }
  function statusHtml(a) { return '<span class="stw">' + STATUS[a.st].word + '</span> ' + durSpan(a); }
  function label(a) {
    return a.name + ', ' + KIND[a.kind].toLowerCase() + ', ' + STATUS[a.st].word.toLowerCase() + ' ' + fmt(dur(a)) + (a.st === 'need' ? '. Click to view and answer' : '. Click to view');
  }
  function byGroup(list) { return GROUPS.map(function (g) { return { g: g, items: list.filter(function (a) { return a.group === g.id; }) }; }).filter(function (x) { return x.items.length; }); }
  function worst(list) { // hidden agents: the loudest status wins the "pip"
    return list.find(function (a) { return a.st === 'need'; }) || list.find(function (a) { return a.st === 'err'; }) || null;
  }
  function priority(a, sel) {
    if (a.k === 'orchestrator') return 0; if (a.k === sel) return 1; if (a.st === 'need') return 2; if (a.st === 'err') return 3; if (a.st === 'run') return 4; return 5;
  }

  /* ----------------------------------------------------- popup list (A,B,C) */
  function popupHTML(list, sel, mode, id, activeKey) {
    var rows = '';
    byGroup(list).forEach(function (grp) {
      var gid = id + '-g-' + grp.g.id;
      rows += '<div role="group" aria-labelledby="' + gid + '"><div class="pop__g"><span class="glbl" id="' + gid + '">' + grp.g.label + '</span><span class="cnt">' + grp.items.length + '</span></div>';
      grp.items.forEach(function (a) {
        var selected = a.k === sel;
        var meta = '<span class="pop__meta"><span class="stw">' + STATUS[a.st].word + '</span>' + durSpan(a) + '</span>';
        if (mode === 'listbox') {
          rows += '<div role="option" id="' + id + '-o-' + a.k + '" class="pop__row' + (a.k === activeKey ? ' is-active' : '') + '" data-pick="' + a.k + '" aria-selected="' + selected + '">' + av(a, 24) + '<span class="pop__name">' + esc(a.name) + '</span>' + meta + '</div>';
        } else {
          rows += '<button type="button" role="menuitemradio" class="pop__row" data-pick="' + a.k + '" aria-checked="' + selected + '" tabindex="-1">' + av(a, 24) + '<span class="pop__name">' + esc(a.name) + '</span>' + meta + '</button>';
        }
      });
      rows += '</div>';
    });
    return rows;
  }

  /* ----------------------------------------------------------- the instance */
  var SEQ = 0;
  function mount(host, cfg) {
    var uid = 'i' + (++SEQ);
    var S = { sel: cfg.sel, open: !!cfg.open, activeKey: cfg.sel, focusKey: null, focusPop: false, buf: '', bufT: 0 };
    var agents = roster(cfg.n);
    host.classList.add('inst', cfg.w >= 700 ? 'inst--wide' : 'inst--narrow');
    if (cfg.reduce) host.classList.add('reduce');
    if (cfg.pad) host.style.paddingBottom = cfg.pad + 'px';

    function get(k) { return agents.find(function (a) { return a.k === k; }); }
    function selAgent() { return get(S.sel); }

    /* ---- option A ---- */
    function barA() {
      var h = '<div class="a-bar"><div class="a-strip" role="tablist" aria-label="Agent threads">';
      byGroup(agents).forEach(function (grp) {
        if (grp.g.id !== 'main') h += '<span class="a-grp" role="presentation" data-g="' + grp.g.id + '"><span class="glbl" title="' + grp.g.label + '"><span class="gl-l">' + grp.g.label + '</span><span class="gl-s">' + grp.g.short + '</span><span class="cnt">' + grp.items.length + '</span></span></span>';
        grp.items.forEach(function (a) {
          var on = a.k === S.sel;
          h += '<button type="button" role="tab" class="a-tab" data-k="' + a.k + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" aria-label="' + esc(label(a)) + '" title="' + esc(a.name + ' (' + STATUS[a.st].word + ')') + '">' +
            av(a, 24) + '<span class="a-tab__name">' + esc(a.name) + '</span>' + (on ? '<span class="a-tab__st">' + statusHtml(a) + '</span>' : '') + '</button>';
        });
      });
      h += '</div><button type="button" class="a-more" data-act="toggle" aria-haspopup="menu" aria-expanded="' + S.open + '" aria-controls="' + uid + '-pop"><span class="a-more__t"></span></button></div>';
      h += '<div class="pop a-menu" id="' + uid + '-pop" role="menu" aria-label="All agents" ' + (S.open ? '' : 'hidden') + '>' + popupHTML(agents, S.sel, 'menu', uid) + '<div class="pop__foot">Arrow keys move, Enter views, Esc closes</div></div>';
      return h;
    }
    function fitA(bar) {
      var strip = bar.querySelector('.a-strip'); var more = bar.querySelector('.a-more');
      var tabs = [].slice.call(strip.querySelectorAll('.a-tab')); var seps = [].slice.call(strip.querySelectorAll('.a-grp'));
      tabs.concat(seps).forEach(function (e) { e.hidden = false; });
      more.querySelector('.a-more__t').textContent = 'All ' + agents.length;
      var avail = strip.clientWidth;
      var w = {}; tabs.forEach(function (t) { w[t.dataset.k] = t.getBoundingClientRect().width; });
      var sw = {}; seps.forEach(function (s) { sw[s.dataset.g] = s.getBoundingClientRect().width + 4; });
      var order = agents.slice().sort(function (a, b) { return priority(a, S.sel) - priority(b, S.sel) || agents.indexOf(a) - agents.indexOf(b); });
      var shown = {}, used = 0, grpUsed = {}, stopA = false;
      var total = 0; agents.forEach(function (a) { total += w[a.k]; }); Object.keys(sw).forEach(function (g) { total += sw[g]; });
      var fitsAll = total <= avail;
      if (!fitsAll) {
        avail -= 4;
        order.forEach(function (a) {
          var add = w[a.k] + (a.group !== 'main' && !grpUsed[a.group] ? sw[a.group] : 0);
          if (!stopA && used + add <= avail || a.k === 'orchestrator' || a.k === S.sel) { shown[a.k] = true; used += add; if (a.group !== 'main') grpUsed[a.group] = true; } else stopA = true;
        });
      } else agents.forEach(function (a) { shown[a.k] = true; grpUsed[a.group] = true; });
      function apply() {
        tabs.forEach(function (t) { t.hidden = !shown[t.dataset.k]; });
        grpUsed = {}; agents.forEach(function (a) { if (shown[a.k]) grpUsed[a.group] = true; });
        seps.forEach(function (s) { s.hidden = !grpUsed[s.dataset.g]; });
      }
      apply();
      // verify against the real layout (fonts, gaps): drop the lowest-priority shown tab until nothing is clipped
      var guard = 20;
      while (guard-- > 0) {
        var vis = [].slice.call(strip.children).filter(function (c) { return !c.hidden; });
        var last = vis[vis.length - 1]; if (!last || last.getBoundingClientRect().right <= strip.getBoundingClientRect().right + 0.5) break;
        var drop = order.slice().reverse().find(function (a) { return shown[a.k] && a.k !== 'orchestrator' && a.k !== S.sel; });
        if (!drop) break; shown[drop.k] = false; apply();
      }
      var first = seps.find(function (s) { return !s.hidden; }); if (first && !strip.querySelector('.a-tab[data-k="orchestrator"]:not([hidden])')) first.setAttribute('data-first', '');
      var hid = agents.filter(function (a) { return !shown[a.k]; });
      if (hid.length) {
        var wst = worst(hid);
        more.querySelector('.a-more__t').textContent = '+' + hid.length;
        more.setAttribute('aria-label', hid.length + ' more agents' + (wst ? ', ' + (wst.st === 'need' ? 'one needs you' : 'one has an error') : '') + '. Open list of all ' + agents.length + ' agents');
        if (wst) { var pip = document.createElement('span'); pip.className = 'pipd st-' + wst.st; pip.setAttribute('aria-hidden', 'true'); more.appendChild(pip); }
      } else more.setAttribute('aria-label', 'All ' + agents.length + ' agents. Open list');
    }

    /* ---- option B ---- */
    function barB() {
      var h = '<div class="b-bar"><div class="b-dock" role="tablist" aria-label="Agent threads">';
      byGroup(agents).forEach(function (grp, gi) {
        if (gi) h += '<span class="b-div" aria-hidden="true" data-g="' + grp.g.id + '"></span>';
        grp.items.forEach(function (a) {
          var on = a.k === S.sel; var tid = uid + '-tip-' + a.k;
          h += '<span class="b-item' + (cfg.tip === a.k ? ' is-tip' : '') + '" data-ik="' + a.k + '"><button type="button" role="tab" class="b-chip" data-k="' + a.k + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" aria-label="' + esc(label(a)) + '" aria-describedby="' + tid + '">' +
            av(a, 28) + (on ? '<span class="b-chip__txt"><b>' + esc(a.name) + '</b><small>' + statusHtml(a) + '</small></span>' : '') + '</button>' +
            '<span class="b-tip" id="' + tid + '" role="tooltip"><span class="b-tip__card"><span class="b-tip__top">' + av(a, 32) + '<span style="min-width:0;display:flex;flex-direction:column;gap:3px"><b>' + esc(a.name) + '</b><span class="kind" style="align-self:flex-start">' + KIND[a.kind] + '</span></span></span>' +
            '<span class="b-tip__st"><span class="stw">' + STATUS[a.st].word + '</span>' + durSpan(a) + '</span><span class="b-tip__act">' + esc(a.act) + '</span>' +
            '<span class="b-tip__cta">' + (on ? 'Viewing this thread' : lu('mouse-pointer-click', 'i') + ' Click to view this thread') + '</span></span></span></span>';
        });
      });
      h += '</div><button type="button" class="b-all" data-act="toggle" aria-haspopup="menu" aria-expanded="' + S.open + '" aria-controls="' + uid + '-pop"><span class="b-pile"></span><span class="b-all__t">' + agents.length + ' agents</span><span class="cnt b-all__n">' + agents.length + '</span>' + lu('chevron-right', 'i') + '</button></div>';
      h += '<div class="pop b-pop" id="' + uid + '-pop" role="menu" aria-label="All agents" ' + (S.open ? '' : 'hidden') + '>' + popupHTML(agents, S.sel, 'menu', uid) + '<div class="pop__foot">Arrow keys move, Enter views, Esc closes</div></div>';
      return h;
    }
    function fitB(bar) {
      var dock = bar.querySelector('.b-dock'); var btn = bar.querySelector('.b-all');
      var items = [].slice.call(dock.querySelectorAll('.b-item')); var divs = [].slice.call(dock.querySelectorAll('.b-div'));
      items.concat(divs).forEach(function (e) { e.hidden = false; });
      btn.querySelector('.b-pile').innerHTML = agents.slice(0, 3).map(function (a) { return av(a, 20); }).join('');
      var avail = dock.clientWidth - 6;
      var w = {}; items.forEach(function (i) { w[i.dataset.ik] = i.getBoundingClientRect().width + 4; });
      var dw = {}; divs.forEach(function (d) { dw[d.dataset.g] = 15; });
      var total = 0; Object.keys(w).forEach(function (k) { total += w[k]; }); Object.keys(dw).forEach(function (k) { total += dw[k]; });
      var shown = {}, used = 0, gu = {}, stopB = false;
      var order = agents.slice().sort(function (a, b) { return priority(a, S.sel) - priority(b, S.sel) || agents.indexOf(a) - agents.indexOf(b); });
      if (total <= avail) agents.forEach(function (a) { shown[a.k] = true; gu[a.group] = true; });
      else order.forEach(function (a) {
        var add = w[a.k] + (a.group !== 'sub' || true ? 0 : 0);
        var dd = (!gu[a.group] && dw[a.group]) ? dw[a.group] : 0;
        if (!stopB && used + add + dd <= avail || a.k === 'orchestrator' || a.k === S.sel) { shown[a.k] = true; used += add + dd; gu[a.group] = true; } else stopB = true;
      });
      function applyB() {
        items.forEach(function (i) { i.hidden = !shown[i.dataset.ik]; });
        gu = {}; agents.forEach(function (a) { if (shown[a.k]) gu[a.group] = true; });
        divs.forEach(function (d) { d.hidden = !gu[d.dataset.g]; });
      }
      applyB();
      var guardB = 20;
      while (guardB-- > 0) {
        var visB = [].slice.call(dock.children).filter(function (c) { return !c.hidden; });
        var lastB = visB[visB.length - 1]; if (!lastB || lastB.getBoundingClientRect().right <= dock.getBoundingClientRect().right + 0.5) break;
        var dropB = order.slice().reverse().find(function (a) { return shown[a.k] && a.k !== 'orchestrator' && a.k !== S.sel; });
        if (!dropB) break; shown[dropB.k] = false; applyB();
      }
      var hid = agents.filter(function (a) { return !shown[a.k]; });
      var pileSrc = hid.length ? hid : agents.filter(function (a) { return a.st === 'run' && a.k !== 'orchestrator'; });
      btn.querySelector('.b-pile').innerHTML = hid.length ? hid.slice(0, 3).map(function (a) { return av(a, 20); }).join('') : lu('users', 'i');
      var dr = dock.getBoundingClientRect(); items.forEach(function (i) { if (!i.hidden) { var r = i.getBoundingClientRect(); i.classList.toggle('tip-r', r.left + r.width / 2 - dr.left > (dr.width + btn.getBoundingClientRect().width) * 0.5); } });
      var wst = worst(hid);
      btn.setAttribute('aria-label', agents.length + ' agents' + (hid.length ? ', ' + hid.length + ' not shown' : '') + (wst ? (wst.st === 'need' ? ', one needs you' : ', one has an error') : '') + '. Open list');
      if (wst) { var pip = document.createElement('span'); pip.className = 'pipd st-' + wst.st; pip.setAttribute('aria-hidden', 'true'); btn.appendChild(pip); }
    }

    /* ---- option C ---- */
    function liveList() { return agents.filter(function (a) { return a.k !== 'orchestrator' && (a.st === 'run' || a.st === 'need'); }); }
    function barC() {
      var orch = get('orchestrator'); var sa = selAgent(); var onOrch = S.sel === 'orchestrator';
      var delegated = agents.filter(function (a) { return a.k !== 'orchestrator'; });
      var needs = delegated.filter(function (a) { return a.st === 'need'; }).length;
      var running = delegated.filter(function (a) { return a.st === 'run'; }).length;
      var h = '<div class="c-bar">';
      h += '<button type="button" class="c-orch" data-k="orchestrator" aria-pressed="' + onOrch + '" aria-label="' + esc(label(orch)) + '">' + av(orch, 28) + '<b>Orchestrator</b></button><span class="c-sep" aria-hidden="true"></span><span class="c-vlbl" id="' + uid + '-lbl">Viewing</span>';
      h += '<div class="c-combo"><button type="button" role="combobox" class="c-trig" id="' + uid + '-trig" data-act="toggle" data-trig="1" aria-haspopup="listbox" aria-expanded="' + S.open + '" aria-controls="' + uid + '-pop" aria-labelledby="' + uid + '-lbl ' + uid + '-val" ' + (S.open ? 'aria-activedescendant="' + uid + '-o-' + S.activeKey + '"' : '') + ' data-has-sel="' + !onOrch + '">';
      if (onOrch) {
        h += '<span class="av av--28 st-idle"><span class="av__tile dash-tile">' + lu('users', 'ic') + '</span></span><span class="c-trig__t" id="' + uid + '-val"><b>Delegated agents</b><small><span class="d">' + running + ' running' + (needs ? ', ' : '') + '</span>' + (needs ? '<span class="stw st-need">' + needs + ' needs you</span>' : '') + '</small></span>';
      } else {
        h += av(sa, 28) + '<span class="c-trig__t" id="' + uid + '-val"><b>' + esc(sa.name) + '</b><small>' + statusHtml(sa) + '</small></span>';
      }
      h += '<span class="cnt">' + agents.length + '</span>' + lu('chevron-down', 'chev') + '</button></div>';
      var live = liveList();
      h += '<div class="c-live" role="group" aria-label="Running and waiting agents"><span class="glbl"><span class="d2-anim" aria-hidden="true" style="width:6px;height:6px;border-radius:50%;background:var(--state-ink-run);display:inline-block"></span>Live</span>';
      live.slice(0, 3).forEach(function (a) { h += '<button type="button" class="c-live__btn" data-k="' + a.k + '" aria-pressed="' + (a.k === S.sel) + '" aria-label="Jump to ' + esc(label(a).replace('. Click to view', '').replace('. Click to view and answer', '')) + '">' + av(a, 24) + '</button>'; });
      if (live.length > 3) h += '<button type="button" class="c-livecnt c-live__more" data-act="toggle" aria-label="' + (live.length - 3) + ' more live agents. Open list">+' + (live.length - 3) + '</button>';
      h += '<button type="button" class="c-livecnt c-live__sum" data-act="toggle" aria-label="' + live.length + ' agents live. Open list"><span aria-hidden="true" style="width:7px;height:7px;border-radius:50%;background:var(--state-ink-run);display:inline-block"></span>' + live.length + ' live</button>';
      h += '</div></div>';
      h += '<div class="pop c-pop" id="' + uid + '-pop" role="listbox" aria-labelledby="' + uid + '-lbl" ' + (S.open ? '' : 'hidden') + '>' + popupHTML(agents, S.sel, 'listbox', uid, S.activeKey) + '<div class="pop__foot">Type to jump, arrows move, Enter views, Esc closes</div></div>';
      return h;
    }

    /* ---- shell ---- */
    function render() {
      var a = selAgent();
      var bar = cfg.opt === 'A' ? barA() : cfg.opt === 'B' ? barB() : barC();
      host.innerHTML = '<div class="stage"><div class="bar">' + bar + '</div><div class="stub" aria-hidden="true"><div class="stub__h">' + av(a, 20) + '<span><b>' + esc(a.name) + '</b> thread</span><span class="stw st-' + a.st + '">' + STATUS[a.st].word + '</span></div><div class="stub__l"></div><div class="stub__l"></div><div class="stub__l"></div></div></div>';
      var barEl = host.querySelector('.bar');
      if (cfg.opt === 'A') fitA(barEl); else if (cfg.opt === 'B') fitB(barEl);
      placePop(barEl);
      if (cfg.hover) { var he = host.querySelector('[data-k="' + cfg.hover + '"]') || host.querySelector('[data-hover-slot]'); if (he) he.classList.add('is-hover'); }
      if (cfg.focus) { var fe = cfg.focus === '$trigger' ? host.querySelector('[data-trig]') : host.querySelector('[data-k="' + cfg.focus + '"]'); if (fe) fe.classList.add('is-focus'); }
      if (cfg.hoverTrig) { var te = host.querySelector('[data-trig]'); if (te) te.classList.add('is-hover'); }
      if (S.focusKey) { var f = host.querySelector('[data-k="' + S.focusKey + '"]:not([hidden])'); if (f) f.focus({ preventScroll: true }); S.focusKey = null; }
      if (S.open && S.focusPop && cfg.opt !== 'C') { var r = host.querySelector('.pop [aria-checked="true"]') || host.querySelector('.pop [role="menuitemradio"]'); if (r) r.focus({ preventScroll: true }); S.focusPop = false; }
      if (S.open && cfg.opt === 'C' && S.restoreTrig !== false) { var tr = host.querySelector('[data-trig]'); if (tr && S.focusTrig) { tr.focus({ preventScroll: true }); S.focusTrig = false; } }
    }
    function placePop(bar) {
      var pop = bar.parentNode.querySelector('.pop'); if (!pop) return;
      var barRect = bar.getBoundingClientRect(); var W = barRect.width;
      var width = Math.min(cfg.opt === 'C' ? 400 : 380, W - 16);
      pop.style.width = width + 'px';
      pop.style.top = (bar.offsetHeight + 4) + 'px';
      var anchor = cfg.opt === 'A' ? bar.querySelector('.a-more') : cfg.opt === 'B' ? bar.querySelector('.b-all') : bar.querySelector('.c-combo');
      var ar = anchor.getBoundingClientRect();
      var left = cfg.opt === 'C' ? ar.left - barRect.left : ar.right - barRect.left - width;
      left = Math.max(8, Math.min(left, W - width - 8));
      pop.style.left = left + 'px'; pop.style.right = 'auto';
    }
    function setOpen(v, opts) {
      S.open = v; S.activeKey = S.sel; S.focusPop = v && !!(opts && opts.focus);
      if (cfg.opt === 'C' && v) S.focusTrig = true;
      var trig = null;
      render();
      if (!v && opts && opts.refocus) { trig = host.querySelector('[data-act="toggle"][aria-haspopup]'); if (trig) trig.focus({ preventScroll: true }); }
    }
    function select(k, keepFocus) {
      S.sel = k; S.open = false; S.activeKey = k; S.focusKey = keepFocus ? k : null; render();
    }

    /* ---- events ---- */
    host.addEventListener('click', function (e) {
      var pick = e.target.closest('[data-pick]');
      if (pick) { S.sel = pick.dataset.pick; S.open = false; S.focusKey = null; render(); var t = host.querySelector('[data-act="toggle"][aria-haspopup]') || host.querySelector('[data-trig]'); var cur = host.querySelector('[data-k="' + S.sel + '"]:not([hidden])'); (cfg.opt === 'C' ? t : (cur || t)).focus({ preventScroll: true }); return; }
      var tog = e.target.closest('[data-act="toggle"]');
      if (tog) { setOpen(!S.open, { focus: cfg.opt !== 'C', refocus: S.open }); return; }
      var k = e.target.closest('[data-k]');
      if (k) { select(k.dataset.k, true); }
    });
    host.addEventListener('keydown', function (e) {
      var tab = e.target.closest('[role="tab"]');
      if (tab && (cfg.opt === 'A' || cfg.opt === 'B')) {
        var tabs = [].slice.call(host.querySelectorAll('[role="tab"]')).filter(function (t) { return !t.closest('[hidden]'); });
        var i = tabs.indexOf(tab); var n = null;
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length]; else if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') n = tabs[0]; else if (e.key === 'End') n = tabs[tabs.length - 1];
        else if (e.key === 'Escape' && cfg.opt === 'B') { var it = tab.closest('.b-item'); if (it) it.classList.add('is-dismissed'); return; }
        else if (e.key === 'ArrowDown' && S.open === false && e.altKey) { setOpen(true, { focus: true }); return; }
        if (n) { e.preventDefault(); select(n.dataset.k, true); return; }
      }
      var row = e.target.closest('[role="menuitemradio"]');
      if (row) {
        var rows = [].slice.call(host.querySelectorAll('[role="menuitemradio"]')); var ri = rows.indexOf(row);
        var nx = null;
        if (e.key === 'ArrowDown') nx = rows[(ri + 1) % rows.length]; else if (e.key === 'ArrowUp') nx = rows[(ri - 1 + rows.length) % rows.length];
        else if (e.key === 'Home') nx = rows[0]; else if (e.key === 'End') nx = rows[rows.length - 1];
        if (nx) { e.preventDefault(); nx.focus(); return; }
        if (e.key === 'Escape') { e.preventDefault(); setOpen(false, { refocus: true }); return; }
        if (e.key === 'Tab') { S.open = false; render(); return; }
      }
      var trig = e.target.closest('[data-trig]');
      if (trig && cfg.opt === 'C') {
        var vis = agents.map(function (a) { return a.k; });
        if (!S.open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); return; }
        if (S.open) {
          var ci = vis.indexOf(S.activeKey);
          if (e.key === 'ArrowDown') { e.preventDefault(); S.activeKey = vis[Math.min(vis.length - 1, ci + 1)]; }
          else if (e.key === 'ArrowUp') { e.preventDefault(); S.activeKey = vis[Math.max(0, ci - 1)]; }
          else if (e.key === 'Home') { e.preventDefault(); S.activeKey = vis[0]; }
          else if (e.key === 'End') { e.preventDefault(); S.activeKey = vis[vis.length - 1]; }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.sel = S.activeKey; S.open = false; S.focusTrig = true; render(); host.querySelector('[data-trig]').focus({ preventScroll: true }); return; }
          else if (e.key === 'Escape') { e.preventDefault(); S.open = false; render(); host.querySelector('[data-trig]').focus({ preventScroll: true }); return; }
          else if (e.key.length === 1 && /\S/.test(e.key)) {
            var now = Date.now(); S.buf = (now - S.bufT > 700 ? '' : S.buf) + e.key.toLowerCase(); S.bufT = now;
            var hit = agents.find(function (a) { return a.name.toLowerCase().indexOf(S.buf) === 0; }); if (hit) S.activeKey = hit.k; else return;
          } else return;
          render(); host.querySelector('[data-trig]').focus({ preventScroll: true });
          var ao = host.querySelector('.is-active'); if (ao) ao.scrollIntoView({ block: 'nearest' });
        }
      }
    });
    host.addEventListener('mouseover', function (e) { var r = e.target.closest('[role="option"]'); if (r && cfg.opt === 'C' && r.dataset.pick !== S.activeKey) { host.querySelectorAll('.is-active').forEach(function (x) { x.classList.remove('is-active'); }); r.classList.add('is-active'); } });
    document.addEventListener('click', function (e) { if (S.open && !host.contains(e.target) && !cfg.open) { S.open = false; render(); } });
    document.addEventListener('keydown', function (e) { if (S.open && e.key === 'Escape' && !host.contains(document.activeElement) && !cfg.open) { S.open = false; render(); } });
    new ResizeObserver(function () { if (host.__w !== host.clientWidth) { host.__w = host.clientWidth; render(); } }).observe(host);
    render();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { render(); });
  }

  /* ----------------------------------------------------------- tiles list */
  function tileList(host, items, selK) {
    var running = items.filter(function (a) { return a.st === 'run' || a.st === 'need'; }).length; var fin = items.length - running;
    var h = '<section class="tiles" aria-label="Agents"><div class="tiles__h"><span class="l">Agents</span><span class="r">' + running + ' active · ' + fin + ' finished</span></div><ul>';
    var order = { need: 0, run: 1, err: 2, done: 3, idle: 4 };
    items.slice().sort(function (a, b) { return order[a.st] - order[b.st]; }).forEach(function (a) {
      if (a.k === 'orchestrator') return;
      h += '<li class="tile st-' + a.st + (a.k === selK ? ' is-sel' : '') + '"><button type="button" class="tile__main" ' + (a.k === selK ? 'aria-current="true"' : '') + ' aria-label="' + esc(label(a)) + '">' + av(a, 32) +
        '<span class="tile__body"><span class="tile__l1"><span class="tile__name">' + esc(a.name) + '</span><span class="tile__r"><span class="stw">' + STATUS[a.st].word + '</span>' + durSpan(a) + '</span></span><span class="tile__l2"><span class="kind">' + KIND[a.kind] + '</span><span class="tile__act">' + esc(a.act) + '</span></span></span></button>';
      if (a.cmd) h += '<div class="tile__perm">' + use('i-shield-alert', 'i') + '<span style="flex:1;min-width:0"><b style="font-weight:600">Needs permission:</b> <code class="mono">' + esc(a.cmd) + '</code></span><button type="button" class="btn" aria-label="Review permission request from ' + esc(a.name) + ': ' + esc(a.cmd) + '">Review</button></div>';
      h += '</li>';
    });
    host.innerHTML = h + '</ul></section>';
  }
  function legend(host) {
    var cli = [
      { n: 'Codex', id: 'codex', a: { mark: 'm-codex' }, s: 'vendored (codex)' }, { n: 'Cursor', id: 'cursor', a: { mark: 'm-cursor' }, s: 'vendored (cursor)' },
      { n: 'Copilot', id: 'copilot', a: { mark: 'm-copilot' }, s: 'vendored (github-copilot)' }, { n: 'Antigravity', id: 'antigravity', a: { mark: 'm-antigravity' }, s: 'vendored (antigravity-google)' },
      { n: 'OpenCode', id: 'opencode', a: { mark: 'm-opencode' }, s: 'vendored (opencode)' }, { n: 'Grok', id: 'grok', a: { mark: 'm-grok' }, s: 'vendored (grok)' },
      { n: 'Claude', id: 'claude-cli', a: { mark: 'm-claude' }, s: 'vendored via id claude-cli' }, { n: 'Pi', id: 'pi', a: { strk: PI_PATH }, s: 'stroke table (pi)' },
      { n: 'Ptah CLI', id: 'ptah-cli', a: { strk: PTAH_PATH }, s: 'stroke table (ptah-cli)' }, { n: 'Gemini', id: 'gemini', a: { mono: 'G' }, s: 'no mark: monogram tile' }
    ];
    var h = '<div class="legend"><div><h4>CLI lane marks (ptah-provider-mark; fallback = monogram)</h4><div class="lg-grid">';
    cli.forEach(function (c) { h += '<div class="lg-it">' + av(Object.assign({ st: 'done', group: 'cli' }, c.a), 28).replace(/<span class="av__badge[\s\S]*?<\/span><\/span>$/, '</span>') + '<span><b>' + c.n + '</b><small>' + c.s + '</small></span></div>'; });
    h += '</div></div><div><h4>Sub-agent roles (lucide-angular)</h4><div class="lg-grid">';
    Object.keys(ROLE_ICON).concat(['generic']).forEach(function (r) {
      var ic = ROLE_ICON[r] || 'bot';
      h += '<div class="lg-it">' + av({ icon: ic, st: 'done', group: 'sub' }, 24).replace(/<span class="av__badge[\s\S]*?<\/span><\/span>$/, '</span>') + '<span><b>' + (r === 'generic' ? 'any other type' : r) + '</b><small>' + ROLE_LUCIDE[ic] + '</small></span></div>';
    });
    h += '<div class="lg-it">' + av({ icon: 'workflow', st: 'done', group: 'main' }, 24).replace(/<span class="av__badge[\s\S]*?<\/span><\/span>$/, '</span>') + '<span><b>orchestrator</b><small>Workflow, gold hairline</small></span></div>';
    h += '<div class="lg-it">' + av({ icon: 'square-terminal', st: 'done', group: 'bg' }, 24).replace(/<span class="av__badge[\s\S]*?<\/span><\/span>$/, '</span>') + '<span><b>background command</b><small>SquareTerminal, dashed</small></span></div>';
    h += '</div></div><div><h4>Status: ring + corner glyph + word (never colour alone)</h4><div class="lg-row">';
    ['run', 'need', 'err', 'done', 'idle'].forEach(function (s) {
      var a = { icon: 'bot', st: s, group: 'sub' };
      h += '<div class="lg-st st-' + s + '">' + av(a, 32) + '<span class="stw">' + STATUS[s].word + '</span><span style="color:var(--muted)">' + lucideOf(STATUS[s].glyph) + '</span></div>';
    });
    h += '</div></div></div>';
    host.innerHTML = h;
  }
  function lucideOf(g) { return g.split('-').map(function (p) { return p[0].toUpperCase() + p.slice(1); }).join(''); }

  /* ------------------------------------------------------------------ page */
  var SCN = function (opt) {
    var a = opt === 'A', b = opt === 'B';
    return [
      { cap: '<b>Wide 760 px, 8 agents, Codex selected.</b> Live: click, arrow keys, Tab, Enter.', w: 760, n: 8, sel: 'codex' },
      { cap: '<b>Forced states.</b> ' + (a ? 'Hover on frontend-developer, focus-visible ring on Cursor (error).' : b ? 'Hover card on frontend-developer (tooltip), focus-visible ring on Cursor (error).' : 'Hover on the frontend-developer quick jump, focus-visible ring on the combobox.'),
        w: 760, n: 8, sel: 'codex', hover: 'frontend-developer', focus: a || b ? 'cursor' : '$trigger', tip: b ? 'frontend-developer' : null, pad: b ? 150 : 0 },
      { cap: '<b>List open, 14 agents, 760 px.</b> ' + (a ? 'Strip overflows to "+N"; the pip on +N says someone needs you.' : b ? 'Popover from "N agents".' : 'Listbox from the Viewing combobox, option focus tracked with aria-activedescendant.'), w: 760, n: 14, sel: 'codex', open: true, pad: 330 },
      { cap: '<b>Narrow 400 px (VS Code sidebar), 8 agents.</b>', w: 400, n: 8, sel: 'codex' },
      { cap: '<b>Narrow 400 px, 14 agents, list open, reduced motion</b> (spinner arc static, no halo), Gemini (needs you) selected.', w: 400, n: 14, sel: 'gemini', open: true, reduce: true, pad: 330 }
    ];
  };
  var OPTS = {
    A: 'Option A: Avatar tab strip (tablist, grouped, +N menu)',
    B: 'Option B: Agent dock (avatar pills, hover card, "N agents" popover)',
    C: 'Option C: Split switcher (Orchestrator + Viewing combobox + live jumps)'
  };
  function build() {
    var themes = [['anubis', 'Dark (anubis)'], ['anubis-light', 'Light (anubis-light)']];
    ['A', 'B', 'C'].forEach(function (opt) {
      var sec = document.getElementById('opt' + opt); var pair = sec.querySelector('.pair');
      themes.forEach(function (th) {
        var box = document.createElement('div'); box.className = 'themebox'; box.setAttribute('data-theme', th[0]); box.id = 'box-' + opt + '-' + (th[0] === 'anubis' ? 'dark' : 'light');
        box.innerHTML = '<span class="themebox__tag">' + th[1] + '</span>';
        SCN(opt).forEach(function (s) {
          var cap = document.createElement('p'); cap.className = 'cap'; cap.innerHTML = s.cap; box.appendChild(cap);
          var host = document.createElement('div'); box.appendChild(host);
          mount(host, Object.assign({ opt: opt }, s));
        });
        pair.appendChild(box);
      });
    });
    var tp = document.getElementById('tilesPair');
    themes.forEach(function (th) {
      var box = document.createElement('div'); box.className = 'themebox'; box.setAttribute('data-theme', th[0]); box.id = 'box-tiles-' + (th[0] === 'anubis' ? 'dark' : 'light');
      box.innerHTML = '<span class="themebox__tag">' + th[1] + '</span><div class="split"><div class="tl"></div><div class="lg"></div></div>';
      tileList(box.querySelector('.tl'), CORE, 'codex'); legend(box.querySelector('.lg'));
      tp.appendChild(box);
    });
    var rb = document.getElementById('reduceBtn');
    rb.addEventListener('click', function () { var on = rb.getAttribute('aria-pressed') !== 'true'; rb.setAttribute('aria-pressed', on); document.querySelectorAll('.themebox').forEach(function (b) { b.classList.toggle('reduce', on); }); });
    setInterval(function () {
      document.querySelectorAll('[data-dk]').forEach(function (s) { var a = CORE.concat(EXTRA_SUB).find(function (x) { return x.k === s.dataset.dk; }); if (a) s.textContent = fmt(dur(a)); });
    }, 1000);
    document.documentElement.setAttribute('data-ready', '1');
  }
  document.addEventListener('DOMContentLoaded', build);
})();
