/**
 * Variant A ("Talk-to / Does-work split") prototype behaviour.
 * Static mock only — no backend, no persistence beyond the page's memory.
 */

/* ---------------------------------------------------------------------- */
/* Prototype toolbar: theme + frame toggle                                */
/* ---------------------------------------------------------------------- */
(function initToolbar() {
  const root = document.documentElement;
  const themeBtn = document.getElementById('protoThemeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'anubis' ? 'anubis-light' : 'anubis';
      root.setAttribute('data-theme', next);
      themeBtn.textContent = next === 'anubis' ? 'Theme: anubis (dark)' : 'Theme: anubis-light';
    });
  }
  const frameBtn = document.getElementById('protoFrameToggle');
  const frameEl = document.getElementById('pageFrame');
  if (frameBtn && frameEl) {
    frameBtn.addEventListener('click', () => {
      frameEl.classList.toggle('frame-1024');
      frameBtn.textContent = frameEl.classList.contains('frame-1024')
        ? 'Frame: 1024x768 (on)'
        : 'Frame: 1024x768 (off)';
    });
  }
})();

/* ---------------------------------------------------------------------- */
/* Toast + Undo                                                           */
/* ---------------------------------------------------------------------- */
function showToast(message, undoFn) {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const item = document.createElement('div');
  item.className = 'toast-item';
  item.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  item.appendChild(text);
  if (undoFn) {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'btn btn-ghost btn-xs';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => {
      undoFn();
      item.remove();
    });
    item.appendChild(undoBtn);
  }
  stack.appendChild(item);
  setTimeout(() => item.remove(), 5000);
}
window.showToast = showToast;

/* ---------------------------------------------------------------------- */
/* Generic popover: anchored to a trigger element, closes on Esc/outside  */
/* ---------------------------------------------------------------------- */
let activePopover = null;

function closePopover() {
  if (activePopover) {
    activePopover.el.remove();
    activePopover.trigger.setAttribute('aria-expanded', 'false');
    activePopover.trigger.focus();
    activePopover = null;
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('keydown', onPopoverKeydown, true);
  }
}
function onOutsideClick(e) {
  if (activePopover && !activePopover.el.contains(e.target) && e.target !== activePopover.trigger) {
    closePopover();
  }
}
function onPopoverKeydown(e) {
  if (e.key === 'Escape') closePopover();
}
function openPopover(trigger, buildContent, opts) {
  opts = opts || {};
  if (activePopover && activePopover.trigger === trigger) {
    closePopover();
    return;
  }
  closePopover();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.setAttribute('role', 'dialog');
  pop.appendChild(buildContent(closePopover));
  document.body.appendChild(pop);
  const rect = trigger.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + 6;
  let left = rect.left + window.scrollX;
  if (opts.align === 'right') {
    left = rect.right + window.scrollX - pop.offsetWidth;
  }
  pop.style.top = top + 'px';
  pop.style.left = Math.max(8, left) + 'px';
  trigger.setAttribute('aria-expanded', 'true');
  activePopover = { el: pop, trigger };
  setTimeout(() => {
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', onPopoverKeydown, true);
    const firstFocusable = pop.querySelector('button, input, [tabindex]');
    if (firstFocusable) firstFocusable.focus();
  }, 0);
}
window.openPopover = openPopover;
window.closePopover = closePopover;

function el(tag, props, children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  });
  (children || []).forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}
window.el = el;

/* ---------------------------------------------------------------------- */
/* Modal (catalog / wizard) with focus trap + role=dialog                 */
/* ---------------------------------------------------------------------- */
let activeModal = null;
function closeModal() {
  if (activeModal) {
    activeModal.overlay.remove();
    document.removeEventListener('keydown', onModalKeydown, true);
    if (activeModal.returnFocus) activeModal.returnFocus.focus();
    activeModal = null;
  }
}
function onModalKeydown(e) {
  if (!activeModal) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key === 'Tab') {
    const focusables = activeModal.panel.querySelectorAll('button, input, select, a[href], [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
function openModal(buildPanel, opts) {
  opts = opts || {};
  closeModal();
  const overlay = el('div', { class: 'modal-overlay' }, []);
  const panel = el('div', { class: 'modal-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label || 'Dialog' }, []);
  panel.appendChild(buildPanel(closeModal));
  overlay.appendChild(panel);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  activeModal = { overlay, panel, returnFocus: document.activeElement };
  document.addEventListener('keydown', onModalKeydown, true);
  const firstFocusable = panel.querySelector('button, input, select, a[href]');
  if (firstFocusable) firstFocusable.focus();
  return { close: closeModal, panel };
}
window.openModal = openModal;
window.closeModal = closeModal;

/* ---------------------------------------------------------------------- */
/* Right-side drawer                                                      */
/* ---------------------------------------------------------------------- */
let activeDrawer = null;
function closeDrawer() {
  if (activeDrawer) {
    activeDrawer.overlay.remove();
    document.removeEventListener('keydown', onDrawerKeydown, true);
    if (activeDrawer.returnFocus) activeDrawer.returnFocus.focus();
    activeDrawer = null;
  }
}
function onDrawerKeydown(e) {
  if (!activeDrawer) return;
  if (e.key === 'Escape') closeDrawer();
}
function openDrawer(buildPanel, opts) {
  opts = opts || {};
  closeDrawer();
  const overlay = el('div', { class: 'drawer-overlay' }, []);
  const panel = el('div', { class: 'drawer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.label || 'Details' }, []);
  panel.appendChild(buildPanel(closeDrawer));
  overlay.appendChild(panel);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeDrawer(); });
  document.body.appendChild(overlay);
  activeDrawer = { overlay, panel, returnFocus: document.activeElement };
  document.addEventListener('keydown', onDrawerKeydown, true);
  const firstFocusable = panel.querySelector('button, input, select');
  if (firstFocusable) firstFocusable.focus();
  return { close: closeDrawer, panel };
}
window.openDrawer = openDrawer;
window.closeDrawer = closeDrawer;
