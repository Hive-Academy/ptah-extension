import { resolveInitialView } from './initial-view.js';

/**
 * First-run routing guard.
 *
 * Regression: the TUI hard-coded `'chat'` as the opening view, so an
 * unconfigured first run landed in a chat panel that could not send anything,
 * with a single-line banner as the only hint. The opening view must be the
 * Settings panel (whose first section is Authentication) whenever the agent is
 * not ready.
 */
describe('resolveInitialView', () => {
  it('opens Settings when auth is not ready so the first screen is actionable', () => {
    expect(resolveInitialView(false)).toBe('settings');
  });

  it('opens chat when auth is ready', () => {
    expect(resolveInitialView(true)).toBe('chat');
  });
});
