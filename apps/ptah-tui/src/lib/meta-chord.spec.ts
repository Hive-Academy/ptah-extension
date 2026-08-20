import {
  ESCAPE_PREFIX_WINDOW_MS,
  isEscapePrefixed,
  isMetaChord,
  noteEscape,
  resetEscapePrefix,
} from './meta-chord.js';

/** A fixed origin, so every case reads as an offset rather than a wall clock. */
const T0 = 1_000_000;

describe('split Alt chord reassembly', () => {
  beforeEach(() => {
    resetEscapePrefix();
  });

  describe('isEscapePrefixed', () => {
    it('is false with no Escape pending — plain typing stays plain', () => {
      expect(isEscapePrefixed('l', T0)).toBe(false);
    });

    it('claims a letter that lands inside the window', () => {
      // The live defect: Ink flushes a dangling ESC after 20ms and delivers the
      // letter on its own, so `Alt+L` typed an `l` and never opened the
      // sessions panel.
      noteEscape(T0);
      expect(isEscapePrefixed('l', T0 + 25)).toBe(true);
    });

    it('releases the letter once the window has passed', () => {
      // Esc then l as two deliberate presses is two keys, not a chord.
      noteEscape(T0);
      expect(isEscapePrefixed('l', T0 + ESCAPE_PREFIX_WINDOW_MS + 1)).toBe(
        false,
      );
    });

    it('ignores a paste, however soon it arrives', () => {
      // A paste is one `input` of many characters. Re-reading it as a chord
      // would swallow the whole thing.
      noteEscape(T0);
      expect(isEscapePrefixed('sessions', T0 + 5)).toBe(false);
    });

    it('ignores a named key, which reports no input at all', () => {
      noteEscape(T0);
      expect(isEscapePrefixed('', T0 + 5)).toBe(false);
    });

    it('forgets the prefix after a reset', () => {
      noteEscape(T0);
      resetEscapePrefix();
      expect(isEscapePrefixed('l', T0 + 5)).toBe(false);
    });
  });

  describe('isMetaChord', () => {
    it('trusts a keypress that already carries meta', () => {
      // The fast delivery — both bytes in one read. This is the only case the
      // app used to handle, which is why the binding worked when idle and
      // failed under load.
      expect(isMetaChord({ meta: true }, 'm', T0)).toBe(true);
    });

    it('reassembles the slow delivery from the Escape before it', () => {
      noteEscape(T0);
      expect(isMetaChord({ meta: false }, 'm', T0 + 25)).toBe(true);
    });

    it('leaves an unprefixed letter alone', () => {
      expect(isMetaChord({ meta: false }, 'm', T0)).toBe(false);
    });

    it('does not read the Escape itself as its own chord', () => {
      // Escape reports an empty `input`, so noting it and testing it in the
      // same keypress must not produce a chord.
      noteEscape(T0);
      expect(isMetaChord({ escape: true }, '', T0)).toBe(false);
    });
  });
});
