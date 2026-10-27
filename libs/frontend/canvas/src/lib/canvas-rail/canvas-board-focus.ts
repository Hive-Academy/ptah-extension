import { afterNextRender, type Injector } from '@angular/core';
import { focusRailSelectButton } from './canvas-rail-keyboard';

/** Renders to wait for a deferred or re-rendered target before giving up. */
const MAX_RENDERS = 5;

/** Focus is lost when it sits on `<body>` or on a node a render removed. */
function focusLost(doc: Document): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body || !active.isConnected;
}

/** The Sessions rail card of `tabId`, or undefined. */
function railCard(board: HTMLElement, tabId: string | null): HTMLElement | undefined {
  if (!tabId) return undefined;
  return [...board.querySelectorAll<HTMLElement>('[data-rail-card]')].find(
    (card) => card.dataset['tabId'] === tabId,
  );
}

/**
 * The control that takes focus after a pane's own controls went away: the
 * pane's `⋯` while the split is still shown, otherwise the surviving
 * session's card `Session actions` button in the Sessions rail (or the card's
 * select button), then the sidebar's expand or collapse button.
 */
export function survivingSessionControl(
  board: HTMLElement,
  side: 'left' | 'right',
  survivorId: string | null,
): HTMLElement | null {
  const paneMenu = board.querySelector<HTMLElement>(
    `[data-pane-side="${side}"] [data-header-menu]`,
  );
  if (paneMenu) return paneMenu;
  const card = railCard(board, survivorId);
  const control =
    card?.querySelector<HTMLElement>('.rail-actions-trigger') ??
    card?.querySelector<HTMLElement>('.rc-select, .rail-collapsed');
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
 * element (the pane menu's own trigger, or a Details return) is left alone.
 */
export function restoreBoardFocus(
  board: HTMLElement,
  side: () => 'left' | 'right',
  survivorId: () => string | null,
  injector: Injector,
  renders = MAX_RENDERS,
): void {
  afterNextRender(
    () => {
      if (!focusLost(board.ownerDocument)) return;
      const target = survivingSessionControl(board, side(), survivorId());
      if (target) target.focus();
      else if (renders > 1)
        restoreBoardFocus(board, side, survivorId, injector, renders - 1);
    },
    { injector },
  );
}

/**
 * After a session closed from its card menu, lost focus moves to the
 * neighbouring card's select button, so the keyboard stays in the Sessions rail.
 * With no neighbour left (the last session closed) it moves to the empty
 * board's New session button, else the Sessions footer's New session button.
 */
export function focusNeighbourCard(
  board: HTMLElement,
  neighbourId: string | null,
  injector: Injector,
): void {
  afterNextRender(
    () => {
      if (!focusLost(board.ownerDocument)) return;
      const card = railCard(board, neighbourId);
      if (card) focusRailSelectButton(card);
      else
        (
          board.querySelector<HTMLElement>('[data-testid="canvas-hero-new-session"]') ??
          board.querySelector<HTMLElement>('[data-testid="canvas-footer-new-session"]')
        )?.focus();
    },
    { injector },
  );
}
