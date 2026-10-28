/* Prototype behaviour: theme toggle, keep/replace radiogroup (with forced-keep rows),
   diff disclosure, bulk actions, target choice with reload/reset, dialog open/close with
   focus trap, tabs, Marketplace roving rows + inspector + search, uninstall pending/failure.
   Plain JS, no dependencies. */
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('proto-theme'); } catch (e) {}
  var q = new URLSearchParams(location.search).get('theme');
  setTheme(q || saved || 'anubis');

  function setTheme(t) {
    root.setAttribute('data-theme', t);
    root.setAttribute('data-theme-mode', t === 'anubis' ? 'dark' : 'light');
    try { localStorage.setItem('proto-theme', t); } catch (e) {}
    var b = document.getElementById('theme-toggle');
    if (b) {
      b.setAttribute('aria-pressed', t === 'anubis' ? 'false' : 'true');
      b.textContent = t === 'anubis' ? 'Theme: dark (switch to light)' : 'Theme: light (switch to dark)';
    }
  }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#theme-toggle')) setTheme(root.getAttribute('data-theme') === 'anubis' ? 'anubis-light' : 'anubis');
  });

  /* ---- keep / replace radiogroup (buttons with role=radio, roving tabindex) ---- */
  function enabled(r) { return r.getAttribute('aria-disabled') !== 'true'; }
  function select(group, btn) {
    if (!enabled(btn)) return;
    group.querySelectorAll('[role=radio]').forEach(function (r) {
      var on = r === btn;
      r.setAttribute('aria-checked', on ? 'true' : 'false');
      r.tabIndex = on ? 0 : -1;
    });
    summarise(group.closest('[data-files]'));
  }
  document.addEventListener('click', function (e) {
    var r = e.target.closest('.seg [role=radio]');
    if (r) select(r.parentElement, r);
  });
  document.addEventListener('keydown', function (e) {
    var r = e.target.closest('.seg [role=radio]');
    if (!r) return;
    var rs = $all('[role=radio]', r.parentElement).filter(enabled);
    var i = rs.indexOf(r), n = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = rs[(i + 1) % rs.length];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = rs[(i - 1 + rs.length) % rs.length];
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); select(r.parentElement, r); return; }
    if (n) { e.preventDefault(); n.focus(); select(r.parentElement, n); }
  });

  /* ---- diff disclosure ---- */
  document.addEventListener('click', function (e) {
    var d = e.target.closest('.disc');
    if (!d) return;
    var panel = document.getElementById(d.getAttribute('aria-controls'));
    var open = d.getAttribute('aria-expanded') === 'true';
    d.setAttribute('aria-expanded', open ? 'false' : 'true');
    if (panel) panel.hidden = open;
  });

  /* ---- bulk: forced-keep rows never change ---- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-bulk]');
    if (!b) return;
    var scope = b.closest('[data-files]');
    var want = b.getAttribute('data-bulk');
    $all('.seg', scope).forEach(function (g) {
      if (g.classList.contains('locked')) return;
      var btn = g.querySelector(want === 'keep' ? '.is-keep' : '.is-replace');
      if (btn) select(g, btn);
    });
  });

  /* context-specific confirm labels: data-tpl-keep (0 replacements) / data-tpl-rep with {n} and {files} */
  function summarise(scope) {
    if (!scope) return;
    var groups = $all('.seg', scope).filter(function (g) { return !g.closest('[hidden]'); });
    var rep = 0;
    groups.forEach(function (g) { if (g.querySelector('.is-replace[aria-checked=true]')) rep++; });
    var keep = groups.length - rep;
    var s = scope.querySelector('[data-summary]');
    if (s) s.textContent = keep + ' kept, ' + rep + ' to replace';
    var c = scope.querySelector('[data-confirm]');
    if (c) {
      var k = c.getAttribute('data-tpl-keep'), t = c.getAttribute('data-tpl-rep');
      c.textContent = rep ? t.replace('{n}', rep).replace('{files}', rep === 1 ? 'file' : 'files') : k;
    }
  }
  $all('[data-files]').forEach(summarise);

  /* ---- target choice: radiogroup of buttons; change reloads the comparison and resets decisions to Keep ---- */
  function applyTarget(scope, which, instant) {
    $all('[data-when-target]', scope).forEach(function (el) { el.hidden = el.getAttribute('data-when-target') !== which; });
    $all('[data-for-target]', scope).forEach(function (el) { el.hidden = el.getAttribute('data-for-target') !== which; });
    $all('.seg:not(.locked)', scope).forEach(function (g) { var k = g.querySelector('.is-keep'); if (k) select(g, k); });
    var line = scope.querySelector('[data-target-line]');
    var radio = scope.querySelector('.target[data-target="' + which + '"] code');
    if (line && radio) line.textContent = radio.textContent;
    summarise(scope.closest('[data-files]') || scope);
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('.target');
    if (!t || t.getAttribute('aria-checked') === 'true') return;
    var g = t.parentElement;
    $all('.target', g).forEach(function (x) {
      var on = x === t;
      x.setAttribute('aria-checked', on ? 'true' : 'false');
      x.tabIndex = on ? 0 : -1;
    });
    var scope = t.closest('[data-target-scope]');
    if (!scope) return;
    var view = scope.querySelector('[data-view]'), load = scope.querySelector('[data-loading]'), note = scope.querySelector('[data-reset-note]');
    if (view && load) {
      view.hidden = true; load.hidden = false; scope.setAttribute('aria-busy', 'true');
      var which = t.getAttribute('data-target');
      setTimeout(function () {
        applyTarget(scope, which);
        load.hidden = true; view.hidden = false; scope.removeAttribute('aria-busy');
        if (note) note.hidden = false;
      }, 600);
    } else { applyTarget(scope, t.getAttribute('data-target')); }
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target.closest('.target');
    if (!t) return;
    var ts = $all('.target', t.parentElement);
    var i = ts.indexOf(t), n = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = ts[(i + 1) % ts.length];
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = ts[(i - 1 + ts.length) % ts.length];
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); t.click(); return; }
    if (n) { e.preventDefault(); n.focus(); n.click(); }
  });

  /* ---- reveal / collapse (sidebar target "Change") ---- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-toggle]');
    if (!b) return;
    var p = document.getElementById(b.getAttribute('data-toggle'));
    var open = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', open ? 'false' : 'true');
    if (p) p.hidden = open;
    var lo = b.getAttribute('data-label-open'), lc = b.getAttribute('data-label-closed');
    if (lo && lc) b.textContent = open ? lc : lo;
  });

  /* ---- dialogs: opener, focus placement, Tab confinement, Escape, focus restore ---- */
  var openers = {};
  function focusables(box) {
    return $all('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex="0"]', box)
      .filter(function (el) { return !el.closest('[hidden]') && el.getAttribute('aria-disabled') !== 'true' && el.tabIndex >= 0; });
  }
  /* Scope the shared dialog to what the opener reported: pack vs one file (packs),
     or the installer family whose kept files are listed (repair prompt). */
  function scopeDialog(ov, opener) {
    var scope = opener.getAttribute('data-scope'), fam = opener.getAttribute('data-family');
    if (scope) {
      var file = opener.getAttribute('data-file') || '';
      ov.setAttribute('data-scope', scope);
      $all('[data-when-scope]', ov).forEach(function (el) { el.hidden = el.getAttribute('data-when-scope') !== scope; });
      $all('[data-file-name]', ov).forEach(function (el) { if (file) el.textContent = file; });
      var rows = $all('[data-sub-row]', ov), vis = 0;
      rows.forEach(function (r) { var ok = scope === 'pack' || r.getAttribute('data-file') === file; r.hidden = !ok; if (ok) vis++; });
      $all('[data-sub-none]', ov).forEach(function (el) { el.hidden = vis > 0; });
      $all('[data-sub-some]', ov).forEach(function (el) { el.hidden = vis === 0; });
      $all('[data-sub-list]', ov).forEach(function (el) { el.hidden = vis === 0; });
    }
    if (fam) {
      ov.setAttribute('data-family', fam);
      $all('[data-repair-for]', ov).forEach(function (r) { r.hidden = r.getAttribute('data-repair-for') !== fam; });
      $all('.seg:not(.locked)', ov).forEach(function (g) { var k = g.querySelector('.is-keep'); if (k) select(g, k); });
      var n = $all('.seg:not(.locked)', ov).filter(function (g) { return !g.closest('[hidden]'); }).length;
      var all = $all('.seg', ov).filter(function (g) { return !g.closest('[hidden]'); }).length;
      $all('[data-bulk-count]', ov).forEach(function (el) { el.textContent = n + (n === 1 ? ' file can' : ' files can') + ' be replaced' + (all > n ? ' (' + (all - n) + ' cannot be read)' : ''); });
      $all('[data-source-label]', ov).forEach(function (el) { el.textContent = opener.getAttribute('data-source-label') || ''; });
    }
    summarise(ov.querySelector('[data-files]') || ov.closest('[data-files]'));
  }
  function openDialog(ov, opener) {
    if (opener) scopeDialog(ov, opener);
    ov.hidden = false;
    if (opener) { openers[ov.id] = opener; }
    var box = ov.querySelector('[role=dialog]');
    var f = focusables(box);
    if (f.length) f[0].focus();
  }
  function closeDialog(ov) {
    ov.hidden = true;
    var o = openers[ov.id];
    if (o) o.focus();
  }
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]');
    if (o) { openDialog(document.getElementById(o.getAttribute('data-open')), o); return; }
    var c = e.target.closest('[data-close]');
    if (c) closeDialog(c.closest('.overlay'));
  });
  document.addEventListener('keydown', function (e) {
    var ov = e.target.closest('.overlay');
    if (!ov || ov.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeDialog(ov); return; }
    if (e.key !== 'Tab') return;
    var f = focusables(ov.querySelector('[role=dialog]'));
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---- tabs ---- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[role=tab]');
    if (!t) return;
    $all('[role=tab]', t.parentElement).forEach(function (x) {
      var on = x === t;
      x.setAttribute('aria-selected', on ? 'true' : 'false');
      var p = document.getElementById(x.getAttribute('aria-controls'));
      if (p) p.hidden = !on;
    });
  });

  /* ---- Marketplace installed view: roving rows, inspector, search ---- */
  document.addEventListener('keydown', function (e) {
    var a = e.target.closest('a.open');
    if (!a) return;
    var rows = $all('a.open').filter(function (x) { return !x.closest('[hidden]'); });
    var i = rows.indexOf(a), n = null;
    if (e.key === 'ArrowDown') n = rows[Math.min(i + 1, rows.length - 1)];
    if (e.key === 'ArrowUp') n = rows[Math.max(i - 1, 0)];
    if (e.key === 'Home') n = rows[0];
    if (e.key === 'End') n = rows[rows.length - 1];
    if (e.key === 'Escape') { var ins = document.getElementById('inspector'); if (ins && !ins.hidden) { ins.hidden = true; a.focus(); } }
    if (n) { e.preventDefault(); rows.forEach(function (x) { x.tabIndex = -1; }); n.tabIndex = 0; n.focus(); }
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a.open');
    if (a) {
      e.preventDefault();
      var ins = document.getElementById('inspector');
      if (!ins) return;
      $all('.row.is-open').forEach(function (r) { r.classList.remove('is-open'); });
      a.closest('.row').classList.add('is-open');
      $all('a.open[aria-current]').forEach(function (x) { x.removeAttribute('aria-current'); });
      a.setAttribute('aria-current', 'true');
      var h = document.getElementById('inspector-h');
      if (h) h.textContent = a.getAttribute('data-title');
      /* every fact, note and action follows the selected fixture item (window.PROTO_INSPECT) */
      var d = (window.PROTO_INSPECT || {})[a.getAttribute('data-title')];
      if (d) {
        var set = function (id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; };
        set('insp-desc', d.desc); set('insp-facts', d.facts); set('insp-names', d.names);
        set('insp-kept', d.kept); set('insp-sync', d.sync); set('insp-action', d.action);
        var nb = document.getElementById('insp-names-btn');
        if (nb) { nb.setAttribute('aria-expanded', 'true'); var np = document.getElementById('insp-names'); if (np) np.hidden = false; }
      }
      ins.hidden = false;
    }
    if (e.target.closest('[data-close-inspector]')) {
      var i2 = document.getElementById('inspector'); if (i2) i2.hidden = true;
      $all('.row.is-open').forEach(function (r) { r.classList.remove('is-open'); });
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'q') return;
    var v = e.target.value.trim().toLowerCase();
    $all('[data-group]').forEach(function (g) {
      var rows = $all('.row[data-name]', g), shown = 0;
      /* every query word must appear somewhere in name + description + source + kind (inventory: search semantics) */
      var words = v ? v.split(/\s+/) : [];
      rows.forEach(function (r) {
        var hay = (r.getAttribute('data-search') || r.getAttribute('data-name')).toLowerCase();
        var ok = words.every(function (w) { return hay.indexOf(w) >= 0; });
        r.hidden = !ok; if (ok) shown++;
      });
      var nm = g.querySelector('[data-nomatch]');
      if (nm) { nm.hidden = shown !== 0 || !rows.length; var s = nm.querySelector('[data-q]'); if (s) s.textContent = e.target.value; }
    });
  });

  /* ?open=<id> (screenshots only): open a dialog or inspector row as if its opener had been pressed */
  var openQ = new URLSearchParams(location.search).get('open');
  if (openQ) {
    var oe = document.querySelector('[data-open-key="' + openQ + '"]');
    if (oe) oe.click();
  }

  /* ---- remove / retry demo: pending -> failure shown as failure ---- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-uninstall]');
    if (!b) return;
    var label = b.textContent;
    b.disabled = true; b.textContent = 'Removing…';
    setTimeout(function () {
      b.disabled = false; b.textContent = label;
      var err = document.getElementById(b.getAttribute('data-uninstall'));
      if (err) err.hidden = false;
    }, 900);
  });
})();
