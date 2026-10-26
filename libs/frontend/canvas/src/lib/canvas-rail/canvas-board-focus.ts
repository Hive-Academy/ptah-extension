import { afterNextRender, type Injector } from '@angular/core';

const SESSION_CONTROLS = '[role="group"][aria-label="Session controls"]';
const SIDEBARS = ['[data-inspector-rail]', '[data-inspector-dock]'];
/** Renders to wait for a deferred sidebar to mount before giving up. */
const MAX_RENDERS = 5;

/** Focus is lost when it sits on `<body>` or on a node a render removed. */
function focusLost(doc: Document): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body || !active.isConnected;
}

/**
 * The control that takes focus after a pane's own controls went away: the
 * pane's `⋯` while the split is still shown, otherwise the sidebar's session
 * controls (the view toggle, which is always present and harmless, before any
 * other enabled button), then the sidebar's expand or collapse button.
 */
export function survivingSessionControl(
  board: HTMLElement,
  side: 'left' | 'right',
): HTMLElement | null {
  const paneMenu = board.querySelector<HTMLElement>(
    `[data-pane-side="${side}"] [data-header-menu]`,
  );
  if (paneMenu) return paneMenu;
  const group = board.querySelector<HTMLElement>(
    SIDEBARS.map((sidebar) => `${sidebar} ${SESSION_CONTROLS}`).join(', '),
  );
  const control =
    group?.querySelector<HTMLElement>('[data-compact]') ??
    group?.querySelector<HTMLElement>('button:not([disabled])');
  return (
    control ??
    board.querySelector<HTMLElement>(
      '[data-inspector-rail] [data-inspector-expand], [data-inspector-dock] [data-inspector-close]',
    )
  );
}

/**
 * After the next render, move lost focus to the surviving session's control.
 * The sidebar sits in `@defer` blocks, so a missing target is retried on the
 * following renders (at most `MAX_RENDERS`). Focus that is still on a live
 * element (the header's own trigger, or a Details return) is left alone.
 */
export function restoreBoardFocus(
  board: HTMLElement,
  side: () => 'left' | 'right',
  injector: Injector,
  renders = MAX_RENDERS,
): void {
  afterNextRender(
    () => {
      if (!focusLost(board.ownerDocument)) return;
      const target = survivingSessionControl(board, side());
      if (target) target.focus();
      else if (renders > 1)
        restoreBoardFocus(board, side, injector, renders - 1);
    },
    { injector },
  );
}
