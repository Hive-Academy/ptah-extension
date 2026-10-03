/**
 * TASK_2026_555 — Variant B shared prototype behavior. Vanilla JS, no backend.
 * Used by index.html (Providers) and orchestration.html (Agent Orchestration).
 */
(function () {
  'use strict';

  /* ---------- toast (save feedback + Undo) ---------- */
  var toastHost = document.getElementById('toastHost');

  function toast(msg, undoFn) {
    if (!toastHost) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (undoFn) {
      var b = document.createElement('button');
      b.className = 'btn btn-ghost btn-xs';
      b.type = 'button';
      b.textContent = 'Undo';
      b.addEventListener('click', function () { undoFn(); el.remove(); });
      el.appendChild(b);
    }
    toastHost.appendChild(el);
    setTimeout(function () { el.remove(); }, 6000);
  }

  /* ---------- prototype toolbar: theme + 1024x768 frame ---------- */
  var themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'anubis' ? 'anubis-light' : 'anubis';
      document.documentElement.setAttribute('data-theme', next);
      themeBtn.textContent = 'Theme: ' + next;
    });
  }
  var frame = document.getElementById('frame');
  var frameBtn = document.getElementById('frameToggle');
  if (frame && frameBtn) {
    frameBtn.addEventListener('click', function () {
      var on = frame.classList.toggle('proto-frame--1024');
      frameBtn.textContent = on ? '1024×768 frame: on' : '1024×768 frame: off';
      frameBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------- master–detail selection ---------- */
  function selectPane(paneId) {
    document.querySelectorAll('.md-row[data-pane]').forEach(function (r) {
      r.setAttribute('aria-selected', r.getAttribute('data-pane') === paneId ? 'true' : 'false');
    });
    document.querySelectorAll('.detail-pane').forEach(function (p) {
      p.classList.toggle('is-hidden', p.id !== paneId);
    });
  }

  /* ---------- popovers ---------- */
  function closePopovers() {
    document.querySelectorAll('.popover:not(.is-hidden)').forEach(function (p) {
      p.classList.add('is-hidden');
    });
  }

  /* ---------- modal (focus trap + Esc) ---------- */
  function openModal(m) {
    m.classList.remove('is-hidden');
    m.__prevFocus = document.activeElement;
    var f = m.querySelector('button, input, [href]');
    if (f) f.focus();
  }
  function closeModal(m) {
    m.classList.add('is-hidden');
    if (m.__prevFocus && m.__prevFocus.focus) m.__prevFocus.focus();
  }

  document.addEventListener('keydown', function (e) {
    var m = document.querySelector('.modal-backdrop:not(.is-hidden)');
    if (e.key === 'Escape') {
      if (document.querySelector('.popover:not(.is-hidden)')) { closePopovers(); return; }
      if (m) { closeModal(m); return; }
    }
    if (e.key === 'Tab' && m) {
      var f = m.querySelectorAll('button, input, select, [href]');
      var vis = Array.prototype.filter.call(f, function (el) {
        return el.offsetParent !== null && !el.disabled;
      });
      if (!vis.length) return;
      var first = vis[0], last = vis[vis.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- wizard steps ---------- */
  function showStep(n) {
    document.querySelectorAll('[data-wiz-step]').forEach(function (s) {
      s.classList.toggle('is-hidden', s.getAttribute('data-wiz-step') !== n);
    });
    var m = document.querySelector('.modal-backdrop:not(.is-hidden)');
    if (m) {
      var f = m.querySelector('[data-wiz-step]:not(.is-hidden) input, [data-wiz-step]:not(.is-hidden) button');
      if (f) f.focus();
    }
  }

  /* ---------- one delegated click handler for everything ---------- */
  document.addEventListener('click', function (e) {
    var t;

    /* master list row -> select pane (toggles inside a row are skipped) */
    if (e.target.closest('input, .toggle, [data-stop]')) {
      if (!e.target.closest('[data-eye], [data-pop], [data-toggle-form]')) return;
    }
    t = e.target.closest('.md-row[data-pane]');
    if (t) { selectPane(t.getAttribute('data-pane')); return; }

    /* open/close popovers */
    t = e.target.closest('[data-pop]');
    if (t) {
      var pop = document.querySelector(t.getAttribute('data-pop'));
      if (pop) {
        var willOpen = pop.classList.contains('is-hidden');
        closePopovers();
        if (willOpen) {
          pop.classList.remove('is-hidden');
          var sf = pop.querySelector('input[type="search"], button');
          if (sf) sf.focus();
        }
      }
      return;
    }
    if (!e.target.closest('.popover')) {
      if (document.querySelector('.popover:not(.is-hidden)')) closePopovers();
    }

    /* save-on-select choice inside a popover: save at once + toast + Undo */
    t = e.target.closest('[data-set]');
    if (t) {
      var ctrl = document.querySelector(t.getAttribute('data-set'));
      var label = (t.getAttribute('data-label') || t.textContent).trim();
      var prev = ctrl ? ctrl.textContent.trim() : '';
      var msg = t.getAttribute('data-msg');
      if (ctrl) ctrl.textContent = label;
      var p = t.closest('.popover');
      if (p) {
        p.querySelectorAll('[data-set]').forEach(function (s) {
          s.setAttribute('aria-checked', s === t ? 'true' : 'false');
        });
      }
      closePopovers();
      toast(msg || ('Saved: ' + label), function () {
        if (ctrl) ctrl.textContent = prev;
      });
      return;
    }

    /* generic toast button (delete key, disconnect, sign out, re-detect...) */
    t = e.target.closest('[data-toast]');
    if (t) { toast(t.getAttribute('data-toast')); return; }

    /* "Use for main agent" from a connection pane (2 clicks, saves at once) */
    t = e.target.closest('[data-use-main]');
    if (t) {
      var name = t.getAttribute('data-use-main');
      var sub = document.getElementById('mainRowSub');
      var prevSub = sub ? sub.textContent : '';
      if (sub) sub.textContent = name + ' · Default · medium';
      toast('Main provider set to ' + name + ' (applies to the next request)', function () {
        if (sub) sub.textContent = prevSub;
      });
      return;
    }

    /* modal open / close */
    t = e.target.closest('[data-modal-open]');
    if (t) {
      var m = document.querySelector(t.getAttribute('data-modal-open'));
      if (m) openModal(m);
      return;
    }
    if (e.target.closest('[data-modal-close]') || e.target.classList.contains('modal-backdrop')) {
      var mm = e.target.closest('.modal-backdrop');
      if (mm) closeModal(mm);
      return;
    }

    /* catalog tile for an already-connected provider -> jump to its pane */
    t = e.target.closest('[data-goto-pane]');
    if (t) {
      var gm = t.closest('.modal-backdrop');
      if (gm) closeModal(gm);
      selectPane(t.getAttribute('data-goto-pane'));
      return;
    }

    /* wizard navigation */
    t = e.target.closest('[data-wiz-goto]');
    if (t) { showStep(t.getAttribute('data-wiz-goto')); return; }

    /* catalog tile for a not-configured provider -> remember name + auth kinds */
    t = e.target.closest('[data-wiz-provider]');
    if (t) {
      var pname = t.getAttribute('data-wiz-provider');
      var auths = t.getAttribute('data-auth') || 'key';
      document.querySelectorAll('[data-wiz-name]').forEach(function (n) { n.textContent = pname; });
      document.querySelectorAll('[data-auth-kind]').forEach(function (r) {
        r.classList.toggle('is-hidden', auths.indexOf(r.getAttribute('data-auth-kind')) === -1);
      });
      var helpEl = document.getElementById('wizHelp');
      if (helpEl) {
        var help = t.getAttribute('data-help');
        helpEl.classList.toggle('is-hidden', !help);
        if (help) helpEl.setAttribute('href', help);
      }
      showStep('2');
      return;
    }

    /* auth method card -> credential form for that kind */
    t = e.target.closest('[data-wiz-auth]');
    if (t) {
      var kind = t.getAttribute('data-wiz-auth');
      document.querySelectorAll('[data-cred]').forEach(function (c) {
        c.classList.toggle('is-hidden', c.getAttribute('data-cred') !== kind);
      });
      showStep('3');
      return;
    }

    /* simulated connection check: passes after ~0.9 s, enables the gated save */
    t = e.target.closest('[data-check]');
    if (t) {
      var btn = t;
      var old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Checking…';
      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = old;
        var tgt = btn.getAttribute('data-check-enable');
        if (tgt) {
          var el2 = document.querySelector(tgt);
          if (el2) el2.disabled = false;
        }
        toast(btn.getAttribute('data-check-msg') || 'Connection check passed');
      }, 900);
      return;
    }

    /* "Retry" on a failed connection: flips the status to Connected in place */
    t = e.target.closest('[data-retry]');
    if (t) {
      var rBtn = t;
      rBtn.disabled = true;
      rBtn.textContent = 'Checking…';
      setTimeout(function () {
        rBtn.disabled = false;
        rBtn.textContent = 'Retry';
        ['data-retry-dot', 'data-retry-text', 'data-retry-rowdot', 'data-retry-rowtext'].forEach(function (attr) {
          var sel = rBtn.getAttribute(attr);
          if (!sel) return;
          var el3 = document.querySelector(sel);
          if (!el3) return;
          if (attr.indexOf('dot') !== -1) el3.className = 'dot dot-success';
          else el3.textContent = 'Connected';
        });
        toast('Connection check passed — status updated');
      }, 900);
      return;
    }

    /* show/hide a stored or newly typed key */
    t = e.target.closest('[data-eye]');
    if (t) {
      var el = document.querySelector(t.getAttribute('data-eye'));
      if (!el) return;
      if (el.tagName === 'INPUT') {
        var show = el.type === 'password';
        el.type = show ? 'text' : 'password';
        t.setAttribute('aria-label', show ? 'Hide value' : 'Show value');
      } else {
        var shown = el.getAttribute('data-shown') === '1';
        el.setAttribute('data-shown', shown ? '0' : '1');
        el.textContent = shown ? el.getAttribute('data-masked') : el.getAttribute('data-full');
      }
      var onIco = t.querySelector('.eye-on'), offIco = t.querySelector('.eye-off');
      var inputShown = el.tagName === 'INPUT' ? el.type === 'text' : el.getAttribute('data-shown') === '1';
      if (onIco && offIco) {
        onIco.classList.toggle('is-hidden', !inputShown);
        offIco.classList.toggle('is-hidden', inputShown);
      }
      return;
    }

    /* reveal an inline sub-form (Replace key, edit endpoint, ...) */
    t = e.target.closest('[data-toggle-form]');
    if (t) {
      var form = document.querySelector(t.getAttribute('data-toggle-form'));
      if (form) form.classList.toggle('is-hidden');
      return;
    }

    /* inline GitHub sign-in (Copilot CLI agent) */
    t = e.target.closest('[data-signin]');
    if (t) {
      t.disabled = true;
      t.textContent = 'Waiting for GitHub…';
      setTimeout(function () {
        var wrap = document.getElementById('copilotAuthState');
        if (wrap) wrap.innerHTML = '<span class="dot dot-success"></span> Signed in as dev@example.com · OAuth session';
        var out = document.getElementById('copilotSignOut');
        if (out) out.classList.remove('is-hidden');
        var tg = document.getElementById('copilotToggle');
        if (tg) { tg.disabled = false; tg.checked = true; }
        var rowDot = document.getElementById('rowDotCopilot');
        if (rowDot) rowDot.className = 'dot dot-success';
        var rowSub = document.getElementById('rowSubCopilot');
        if (rowSub) rowSub.textContent = 'On · provider default';
        toast('Signed in to GitHub Copilot');
      }, 1000);
      return;
    }

    /* save the wizard: close modal, add a connected row, open its pane */
    t = e.target.closest('[data-connect-new]');
    if (t) {
      var nameEl = document.querySelector('[data-wiz-name]');
      var newName = nameEl ? nameEl.textContent : 'New provider';
      var cm = t.closest('.modal-backdrop');
      if (cm) closeModal(cm);
      var group = document.getElementById('connectionsGroup');
      if (group) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'md-row';
        row.setAttribute('data-pane', 'pane-dynamic');
        row.innerHTML =
          '<span class="dot dot-success"></span>' +
          '<span class="flex-1 min-w-0"><span class="block truncate font-medium"></span>' +
          '<span class="sub block truncate">Connected</span></span>';
        row.querySelector('.font-medium').textContent = newName;
        group.appendChild(row);
      }
      document.querySelectorAll('#pane-dynamic [data-fill="name"]').forEach(function (n) { n.textContent = newName; });
      selectPane('pane-dynamic');
      toast('Connected ' + newName + ' — key saved on this machine');
      return;
    }

    /* drag-order up/down buttons (Policy pane) */
    t = e.target.closest('[data-move]');
    if (t) {
      var li = t.closest('[data-order-item]');
      if (!li) return;
      if (t.getAttribute('data-move') === 'up' && li.previousElementSibling) {
        li.parentNode.insertBefore(li, li.previousElementSibling);
      } else if (t.getAttribute('data-move') === 'down' && li.nextElementSibling) {
        li.parentNode.insertBefore(li.nextElementSibling, li);
      }
      toast('Preferred agent order updated');
      return;
    }
  });

  /* ---------- delegated input/change handling ---------- */
  document.addEventListener('input', function (e) {
    /* search filters: data-filter targets a selector of filterable items */
    var s = e.target.closest('[data-filter]');
    if (s) {
      var q = s.value.toLowerCase();
      document.querySelectorAll(s.getAttribute('data-filter')).forEach(function (item) {
        var hay = (item.getAttribute('data-name') || item.textContent).toLowerCase();
        item.classList.toggle('is-hidden', hay.indexOf(q) === -1);
      });
    }
    /* range slider live label */
    var r = e.target.closest('input[type="range"][data-range-label]');
    if (r) {
      var l = document.querySelector(r.getAttribute('data-range-label'));
      if (l) l.textContent = r.value + ' agents';
    }
  });

  document.addEventListener('change', function (e) {
    /* list-row toggles: toast the new state, never switch the pane */
    var tg = e.target.closest('input[data-toast-msg]');
    if (tg) {
      toast(tg.getAttribute('data-toast-msg').replace('%s', tg.checked ? 'on' : 'off'));
    }
  });

  /* ---------- preferred-order drag reorder (Policy pane) ---------- */
  var dragList = document.querySelector('[data-drag-list]');
  if (dragList) {
    var dragged = null;
    dragList.addEventListener('dragstart', function (e) {
      var li = e.target.closest('[data-order-item]');
      if (!li) return;
      dragged = li;
      li.style.opacity = '0.5';
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', ''); } catch (err) { /* IE quirk */ }
      }
    });
    dragList.addEventListener('dragend', function (e) {
      var li = e.target.closest('[data-order-item]');
      if (li) li.style.opacity = '';
      dragged = null;
    });
    dragList.addEventListener('dragover', function (e) {
      if (!dragged) return;
      e.preventDefault();
      var li = e.target.closest('[data-order-item]');
      if (!li || li === dragged) return;
      var rect = li.getBoundingClientRect();
      var after = (e.clientY - rect.top) > rect.height / 2;
      dragList.insertBefore(dragged, after ? li.nextSibling : li);
    });
  }
})();