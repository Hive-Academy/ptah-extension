import {
  decisionEditorMaxHeight,
  wrapEditorTab,
} from './decision-model-row.popover';

describe('decision-model-row.popover (P4 visual 1, 2, 5)', () => {
  describe('decisionEditorMaxHeight', () => {
    it('caps the editor to the room below the cell when there is enough, so it opens and grows downward', () => {
      // Row centred in a 983 px window: 459 px below the cell, 32 px of popover chrome.
      expect(decisionEditorMaxHeight({ top: 470, bottom: 492 }, 983)).toBe(459);
    });

    it('uses the room above when the cell is near the bottom, so the top stays on screen', () => {
      expect(decisionEditorMaxHeight({ top: 800, bottom: 822 }, 983)).toBe(768);
    });

    it('keeps a 120 px usable floor in a very short window, below the old 160 px that overflowed', () => {
      // The panel (120 + 16 padding) fits the 184 px between the 8 px edges, where keepInViewport shifts it.
      // 86 px below (200 - 82 - 32), 28 px above.
      expect(decisionEditorMaxHeight({ top: 60, bottom: 82 }, 200)).toBe(120);
    });

    it('never returns 0 or NaN: zero, negative, non-finite room and a tiny viewport get the clamped floor', () => {
      // Zero room: the cell fills the window less the chrome on both sides.
      expect(decisionEditorMaxHeight({ top: 32, bottom: 168 }, 200)).toBe(120);
      // Negative room on both sides.
      expect(decisionEditorMaxHeight({ top: 10, bottom: 190 }, 200)).toBe(120);
      expect(decisionEditorMaxHeight({ top: NaN, bottom: NaN }, 983)).toBe(120);
      expect(decisionEditorMaxHeight({ top: 470, bottom: 492 }, NaN)).toBe(120);
      expect(decisionEditorMaxHeight({ top: 470, bottom: 492 }, Infinity)).toBe(
        120,
      );
      // The whole panel (cap + 16 px padding) must fit inside 8 px edges: 200 - 32 = 168, so 168 is the most.
      expect(decisionEditorMaxHeight({ top: 0, bottom: 0 }, 200)).toBe(168);
      // A 32 px window has no room for any panel within the edges: the cap is clamped to 1 px, never 0.
      expect(decisionEditorMaxHeight({ top: 8, bottom: 24 }, 32)).toBe(1);
      expect(decisionEditorMaxHeight({ top: 8, bottom: 24 }, 48)).toBe(16);
    });
  });

  describe('wrapEditorTab', () => {
    let panel: HTMLElement;
    let editor: HTMLElement;
    let first: HTMLButtonElement;
    let middle: HTMLInputElement;
    let last: HTMLButtonElement;
    let outside: HTMLButtonElement;

    beforeEach(() => {
      panel = document.createElement('div');
      panel.tabIndex = -1;
      editor = document.createElement('div');
      first = document.createElement('button');
      middle = document.createElement('input');
      last = document.createElement('button');
      const disabled = document.createElement('button');
      disabled.disabled = true;
      editor.append(first, middle, last, disabled);
      panel.append(editor);
      outside = document.createElement('button');
      document.body.append(panel, outside);
    });

    afterEach(() => {
      panel.remove();
      outside.remove();
    });

    const press = (
      target: HTMLElement,
      init: KeyboardEventInit,
    ): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        cancelable: true,
        bubbles: true,
        ...init,
      });
      target.addEventListener('keydown', (e) => wrapEditorTab(e, editor), {
        once: true,
      });
      target.dispatchEvent(event);
      return event;
    };

    it('wraps Tab from the last enabled control to the first', () => {
      const event = press(last, { key: 'Tab' });
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(first);
    });

    it('wraps Shift+Tab from the first control, or from the panel, to the last', () => {
      expect(
        press(first, { key: 'Tab', shiftKey: true }).defaultPrevented,
      ).toBe(true);
      expect(document.activeElement).toBe(last);
      expect(
        press(panel, { key: 'Tab', shiftKey: true }).defaultPrevented,
      ).toBe(true);
      expect(document.activeElement).toBe(last);
    });

    it('wraps Shift+Tab from the dialog itself (the initial focus target) to the last enabled control', () => {
      editor.tabIndex = -1;
      editor.focus();
      expect(
        press(editor, { key: 'Tab', shiftKey: true }).defaultPrevented,
      ).toBe(true);
      expect(document.activeElement).toBe(last);
    });

    it('leaves Tab between inner controls, other keys and targets outside the panel alone', () => {
      expect(press(middle, { key: 'Tab' }).defaultPrevented).toBe(false);
      expect(press(last, { key: 'Enter' }).defaultPrevented).toBe(false);
      expect(press(outside, { key: 'Tab' }).defaultPrevented).toBe(false);
    });
  });
});
