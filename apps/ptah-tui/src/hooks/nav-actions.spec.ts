import { resolveNavAction } from './nav-actions.js';

/**
 * The hook itself is an Ink `useInput` binding and this workspace has no React
 * renderer, so the key → action resolution is exercised directly (the same
 * approach `use-push-events.spec.ts` takes).
 */
describe('resolveNavAction', () => {
  describe('escape reachability (overlay deadlock regression)', () => {
    it('resolves escape even when the list is empty', () => {
      // The live defect: the `itemCount === 0` guard ran first, so a file
      // picker that matched nothing swallowed Escape. With the app shell gated
      // off by `overlayActive` and Ctrl+C disabled, that left NO reachable
      // binding anywhere in the TUI.
      expect(resolveNavAction({ escape: true }, 0, 0, false)).toEqual({
        kind: 'escape',
      });
    });

    it('resolves escape when the list has items', () => {
      expect(resolveNavAction({ escape: true }, 2, 5, false)).toEqual({
        kind: 'escape',
      });
    });
  });

  describe('empty list', () => {
    it.each([
      ['upArrow', { upArrow: true }],
      ['downArrow', { downArrow: true }],
      ['pageUp', { pageUp: true }],
      ['pageDown', { pageDown: true }],
      ['return', { return: true }],
    ])('ignores %s when there is nothing to navigate', (_label, key) => {
      expect(resolveNavAction(key, 0, 0, false)).toEqual({ kind: 'none' });
    });
  });

  describe('movement', () => {
    it('moves up within bounds', () => {
      expect(resolveNavAction({ upArrow: true }, 3, 5, false)).toEqual({
        kind: 'move',
        index: 2,
      });
    });

    it('clamps at the top without wrap', () => {
      expect(resolveNavAction({ upArrow: true }, 0, 5, false)).toEqual({
        kind: 'move',
        index: 0,
      });
    });

    it('wraps to the end from the top when wrap is on', () => {
      expect(resolveNavAction({ upArrow: true }, 0, 5, true)).toEqual({
        kind: 'move',
        index: 4,
      });
    });

    it('moves down within bounds', () => {
      expect(resolveNavAction({ downArrow: true }, 1, 5, false)).toEqual({
        kind: 'move',
        index: 2,
      });
    });

    it('clamps at the bottom without wrap', () => {
      expect(resolveNavAction({ downArrow: true }, 4, 5, false)).toEqual({
        kind: 'move',
        index: 4,
      });
    });

    it('wraps to the start from the bottom when wrap is on', () => {
      expect(resolveNavAction({ downArrow: true }, 4, 5, true)).toEqual({
        kind: 'move',
        index: 0,
      });
    });

    it('pages up by ten, clamped to zero', () => {
      expect(resolveNavAction({ pageUp: true }, 4, 50, false)).toEqual({
        kind: 'move',
        index: 0,
      });
    });

    it('pages down by ten, clamped to the last index', () => {
      expect(resolveNavAction({ pageDown: true }, 45, 50, false)).toEqual({
        kind: 'move',
        index: 49,
      });
    });
  });

  it('resolves return to select', () => {
    expect(resolveNavAction({ return: true }, 2, 5, false)).toEqual({
      kind: 'select',
    });
  });

  it('resolves an unrelated key to none', () => {
    expect(resolveNavAction({}, 2, 5, false)).toEqual({ kind: 'none' });
  });

  it('prefers escape over every other key in the same event', () => {
    expect(
      resolveNavAction(
        { escape: true, downArrow: true, return: true },
        0,
        5,
        false,
      ),
    ).toEqual({ kind: 'escape' });
  });
});
