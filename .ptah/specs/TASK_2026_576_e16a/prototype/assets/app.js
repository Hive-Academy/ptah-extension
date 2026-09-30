// Shared prototype interaction script — plain JS, no build step, no backend.
(function () {
  function initToolbar() {
    var root = document.documentElement;
    var themeBtn = document.getElementById('themeToggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        var current = root.getAttribute('data-theme');
        root.setAttribute(
          'data-theme',
          current === 'anubis' ? 'anubis-light' : 'anubis',
        );
      });
    }
    var widthBtn = document.getElementById('widthToggle');
    var container = document.getElementById('prototypeContainer');
    if (widthBtn && container) {
      widthBtn.addEventListener('click', function () {
        if (container.classList.contains('viewport-wide')) {
          container.classList.remove('viewport-wide');
          container.classList.add('viewport-sidebar');
        } else {
          container.classList.remove('viewport-sidebar');
          container.classList.add('viewport-wide');
        }
      });
    }
    var stateSel = document.getElementById('stateSelector');
    if (stateSel) {
      stateSel.addEventListener('change', function (e) {
        var selected = e.target.value;
        document.querySelectorAll('.state-view').forEach(function (el) {
          el.classList.toggle('hidden', el.dataset.state !== selected);
        });
      });
    }
  }

  function initTabs() {
    document.querySelectorAll('[data-tablist]').forEach(function (list) {
      var tabs = list.querySelectorAll('[role="tab"]');
      tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
          var panelId = tab.getAttribute('aria-controls');
          tabs.forEach(function (t) {
            t.setAttribute('aria-selected', 'false');
            t.classList.remove('border-primary', 'text-primary');
            t.classList.add('border-transparent', 'text-base-content-muted');
          });
          tab.setAttribute('aria-selected', 'true');
          tab.classList.remove('border-transparent', 'text-base-content-muted');
          tab.classList.add('border-primary', 'text-primary');
          document.querySelectorAll('[data-tabpanel]').forEach(function (p) {
            p.classList.toggle('hidden', p.id !== panelId);
          });
        });
      });
    });
  }

  function initConflict() {
    var toggle = document.getElementById('conflictToggle');
    var banner = document.getElementById('conflictBanner');
    if (toggle && banner) {
      toggle.addEventListener('click', function () {
        banner.classList.toggle('hidden');
      });
    }
    var resolveToggle = document.getElementById('conflictResolvedToggle');
    if (resolveToggle && banner) {
      resolveToggle.addEventListener('click', function () {
        banner.querySelectorAll('.pre-resolve').forEach(function (el) {
          el.classList.toggle('hidden');
        });
        banner.querySelectorAll('.post-resolve').forEach(function (el) {
          el.classList.toggle('hidden');
        });
      });
    }
  }

  function initPopovers() {
    document
      .querySelectorAll('[data-popover-trigger]')
      .forEach(function (trigger) {
        var id = trigger.getAttribute('data-popover-trigger');
        var panel = document.getElementById(id);
        if (!panel) return;
        trigger.addEventListener('click', function (e) {
          e.stopPropagation();
          var isOpen = !panel.classList.contains('hidden');
          document.querySelectorAll('.popover-panel').forEach(function (p) {
            p.classList.add('hidden');
          });
          panel.classList.toggle('hidden', isOpen);
        });
      });
    document.addEventListener('click', function () {
      document.querySelectorAll('.popover-panel').forEach(function (p) {
        p.classList.add('hidden');
      });
    });
    document.querySelectorAll('.popover-panel').forEach(function (p) {
      p.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    });
  }

  // Dialog a11y (design-spec-review.md round 1, finding 3): Escape closes,
  // Tab/Shift+Tab trap focus inside the dialog, and focus returns to the
  // element that opened it. Angular implementation uses CDK Dialog/A11y
  // FocusTrap for the same contract (design-spec.md §2); this mirrors that
  // contract in the static prototype so reviewers can verify the behavior.
  function focusableEls(container) {
    return Array.prototype.slice
      .call(
        container.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      .filter(function (el) {
        return el.offsetParent !== null;
      });
  }

  function initDialogs() {
    var lastTrigger = null;

    function openDialog(dlg, trigger) {
      lastTrigger = trigger || null;
      dlg.classList.remove('hidden');
      var focusTarget =
        dlg.querySelector('[data-default-focus]') || focusableEls(dlg)[0];
      if (focusTarget) focusTarget.focus();
    }

    function closeDialog(dlg) {
      dlg.classList.add('hidden');
      if (lastTrigger && typeof lastTrigger.focus === 'function') {
        lastTrigger.focus();
      }
      lastTrigger = null;
    }

    document.querySelectorAll('[data-open-dialog]').forEach(function (btn) {
      var dlg = document.getElementById(btn.getAttribute('data-open-dialog'));
      if (!dlg) return;
      btn.addEventListener('click', function () {
        openDialog(dlg, btn);
      });
    });
    document.querySelectorAll('[data-close-dialog]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closeDialog(btn.closest('.hf-dialog-backdrop'));
      });
    });
    document.querySelectorAll('.hf-dialog-backdrop').forEach(function (dlg) {
      dlg.addEventListener('keydown', function (e) {
        if (dlg.classList.contains('hidden')) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          closeDialog(dlg);
          return;
        }
        if (e.key === 'Tab') {
          var focusable = focusableEls(dlg);
          if (!focusable.length) return;
          var first = focusable[0];
          var last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      });
    });
  }

  // Container-driven responsive layout (design-spec-review.md round 1,
  // finding 2). The Electron dock's own rendered width (its rail is
  // 160-480px, per rail-resize-handle.component.ts) is what must drive the
  // two-column-vs-stacked layout, not the browser/OS window's viewport
  // width — a `min-[521px]:` media query stays active even when the dock is
  // docked narrow inside a wide window, which is exactly the clipping bug
  // the review caught. A ResizeObserver on the element itself is the
  // browser-native equivalent of what the real Angular build should do
  // (either a container-query-aware directive or binding directly to the
  // already-tracked rail-width signal on `ElectronLayoutService` — see
  // design-spec.md §6.1). This function sets inline `grid-template-columns`
  // directly (not a Tailwind class swap) so it does not depend on classes
  // being present at content-scan time.
  function initResponsiveGrids() {
    if (typeof ResizeObserver === 'undefined') return;
    document.querySelectorAll('[data-responsive-grid]').forEach(function (el) {
      var threshold =
        parseInt(el.getAttribute('data-responsive-grid'), 10) || 520;
      var ro = new ResizeObserver(function (entries) {
        var width = entries[0].contentRect.width;
        el.style.gridTemplateColumns = width < threshold ? '1fr' : '220px 1fr';
      });
      ro.observe(el);
    });
  }

  function initCollapsibles() {
    document.querySelectorAll('[data-collapse-toggle]').forEach(function (btn) {
      var target = document.getElementById(
        btn.getAttribute('data-collapse-toggle'),
      );
      if (!target) return;
      btn.addEventListener('click', function () {
        target.classList.toggle('hidden');
        var chevron = btn.querySelector('.chevron');
        if (chevron) chevron.classList.toggle('rotate-90');
      });
    });
  }

  function initCommentDraft() {
    var addBtn = document.getElementById('addCommentDraft');
    var list = document.getElementById('commentDraftList');
    var counter = document.getElementById('commentDraftCount');
    var sendBtn = document.getElementById('sendCommentsBtn');
    var bar = document.getElementById('draftCommentBar');
    if (!addBtn || !list) return;
    var count = parseInt(counter.textContent, 10) || 0;
    function refresh() {
      counter.textContent = String(count);
      if (bar) bar.classList.toggle('hidden', count === 0);
      if (sendBtn) sendBtn.disabled = count === 0;
    }
    addBtn.addEventListener('click', function () {
      count += 1;
      var li = document.createElement('div');
      li.className =
        'flex items-center justify-between gap-2 px-2 py-1 text-[11px] border-b border-base-content/10 last:border-0';
      li.innerHTML =
        '<span class="font-mono truncate">src/app.ts:' +
        (40 + count) +
        ' — "consider extracting this"</span>' +
        '<button class="btn btn-ghost btn-xs" aria-label="Remove draft comment">✕</button>';
      li.querySelector('button').addEventListener('click', function () {
        li.remove();
        count -= 1;
        refresh();
      });
      list.appendChild(li);
      refresh();
    });
    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        list.innerHTML = '';
        count = 0;
        refresh();
        sendBtn.textContent = 'Sent ✓';
        setTimeout(function () {
          sendBtn.textContent = 'Send to agent';
        }, 1500);
      });
    }
    refresh();
  }

  document.addEventListener('DOMContentLoaded', function () {
    initToolbar();
    initTabs();
    initConflict();
    initPopovers();
    initDialogs();
    initCollapsibles();
    initCommentDraft();
    initResponsiveGrids();
  });
})();
