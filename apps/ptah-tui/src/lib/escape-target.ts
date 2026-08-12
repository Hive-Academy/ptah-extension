/**
 * What Escape closes, and in what order.
 *
 * Escape used to do two things in one press — reset the view to chat AND hide
 * the sessions panel — so from the settings screen with a panel open a single
 * press discarded two pieces of navigation state and there was no way to close
 * only one. "Cancels the topmost surface" has to mean exactly one surface per
 * press, and the order has to be fixed rather than emergent.
 *
 * Z-order, outermost first: the transient panels float above whichever view is
 * mounted, and the view is the base layer. Modals are not in here — they are a
 * separate stack owned by `AppShell` and Escape never reaches this code while
 * one is up.
 *
 * Ink-free on purpose so it is unit-testable.
 */

export type ShellView = 'chat' | 'settings' | 'thoth';

export interface ShellSurfaces {
  readonly view: ShellView;
  readonly sidebarVisible: boolean;
  readonly agentPanelVisible: boolean;
}

export type EscapeTarget = 'sessions' | 'agents' | 'view' | 'none';

export function resolveEscapeTarget(state: ShellSurfaces): EscapeTarget {
  if (state.sidebarVisible) return 'sessions';
  if (state.agentPanelVisible) return 'agents';
  if (state.view !== 'chat') return 'view';
  return 'none';
}

export function applyEscape(state: ShellSurfaces): ShellSurfaces {
  switch (resolveEscapeTarget(state)) {
    case 'sessions':
      return { ...state, sidebarVisible: false };
    case 'agents':
      return { ...state, agentPanelVisible: false };
    case 'view':
      return { ...state, view: 'chat' };
    default:
      return state;
  }
}
