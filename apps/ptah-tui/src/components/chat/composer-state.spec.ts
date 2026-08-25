import {
  isComposerFocused,
  shouldComposerSubmit,
  shouldRollBackChord,
} from './composer-state.js';

const idle = {
  modalActive: false,
  overlayActive: false,
  isStreaming: false,
} as const;

describe('composer keyboard ownership', () => {
  describe('isComposerFocused — file search regression', () => {
    it('keeps focus while the @ file overlay is open', () => {
      // The live defect: `modalActive` and `overlayActive` were OR'd into one
      // prop, so opening the picker blurred the input and swallowed every
      // character after the `@`. The only query ever issued was the empty one,
      // so the list never narrowed — "file search is broken".
      expect(isComposerFocused({ ...idle, overlayActive: true })).toBe(true);
    });

    it('keeps focus while the / command overlay is open', () => {
      expect(isComposerFocused({ ...idle, overlayActive: true })).toBe(true);
    });

    it('blurs for a real modal', () => {
      expect(isComposerFocused({ ...idle, modalActive: true })).toBe(false);
    });

    it('blurs while streaming', () => {
      expect(isComposerFocused({ ...idle, isStreaming: true })).toBe(false);
    });

    it('is focused when idle', () => {
      expect(isComposerFocused(idle)).toBe(true);
    });
  });

  describe('shouldComposerSubmit', () => {
    it('yields Enter to the overlay while it is open', () => {
      // Otherwise one Enter both commits the highlighted file AND sends the
      // half-typed "@src/ma" line as a chat message.
      expect(shouldComposerSubmit({ ...idle, overlayActive: true })).toBe(
        false,
      );
    });

    it('submits when no overlay is open', () => {
      expect(shouldComposerSubmit(idle)).toBe(true);
    });

    it('does not submit while streaming', () => {
      expect(shouldComposerSubmit({ ...idle, isStreaming: true })).toBe(false);
    });

    it('does not submit behind a modal', () => {
      expect(shouldComposerSubmit({ ...idle, modalActive: true })).toBe(false);
    });
  });

  describe('shouldRollBackChord — ctrl chords leaking into the buffer', () => {
    it.each([['k'], ['n'], ['b'], ['e'], ['s'], ['q'], ['t'], ['r'], ['p']])(
      'rolls back the stray "%s" inserted by a Ctrl chord',
      (letter) => {
        expect(shouldRollBackChord(idle, { ctrl: true }, letter)).toBe(true);
      },
    );

    it('rolls back Meta chords too', () => {
      expect(shouldRollBackChord(idle, { meta: true }, 'k')).toBe(true);
    });

    it('leaves ordinary typing alone', () => {
      expect(shouldRollBackChord(idle, {}, 'a')).toBe(false);
    });

    it('does nothing when the composer is not focused', () => {
      expect(
        shouldRollBackChord(
          { ...idle, modalActive: true },
          { ctrl: true },
          's',
        ),
      ).toBe(false);
    });

    it('does nothing for a chord that produced no character', () => {
      expect(shouldRollBackChord(idle, { ctrl: true }, '')).toBe(false);
    });

    it('still rolls back while an overlay is open (composer keeps focus there)', () => {
      expect(
        shouldRollBackChord(
          { ...idle, overlayActive: true },
          { ctrl: true },
          's',
        ),
      ).toBe(true);
    });
  });
});
