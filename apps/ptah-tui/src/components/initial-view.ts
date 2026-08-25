/**
 * Opening-view policy for the TUI shell.
 *
 * Lives in its own ink-free module so it is unit-testable: `App.tsx` imports
 * `ink`, which is ESM-only and unresolvable under this project's Jest config.
 */

export type ActiveView = 'chat' | 'settings' | 'thoth';

/**
 * Decide which view the TUI opens on.
 *
 * Chat is a dead end before a provider is configured — there is nothing to
 * send a message to, and the only affordance was a one-line banner. When the
 * agent is not ready we open Settings instead; its first section is
 * Authentication, so the first screen the user sees is the one that fixes the
 * problem.
 *
 * Only the INITIAL view is derived from `authReady`. Once the user is inside,
 * navigation is theirs — a later auth transition must not yank the view.
 */
export function resolveInitialView(authReady: boolean): ActiveView {
  return authReady ? 'chat' : 'settings';
}
