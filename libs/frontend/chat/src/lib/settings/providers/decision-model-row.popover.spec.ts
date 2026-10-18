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

    it('keeps a usable minimum in a very short window', () => {
      expect(decisionEditorMaxHeight({ top: 60, bottom: 82 }, 200)).toBe(160);
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
