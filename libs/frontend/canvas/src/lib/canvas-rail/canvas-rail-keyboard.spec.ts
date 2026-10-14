import { handleCanvasRailKeydown, railMoveKey, type CanvasRailKeyboardContext } from './canvas-rail-keyboard';

describe('handleCanvasRailKeydown', () => {
  const focus = jest.fn();
  const focusSelectButton = jest.fn();
  const ctx: CanvasRailKeyboardContext = {
    surfaceActive: true, orderedIds: ['a', 'b', 'c'], focusedId: 'b',
    focus, focusSelectButton, focusInnerButtons: true,
  };
  beforeEach(() => jest.clearAllMocks());

  function dispatch(target: HTMLElement, key: string, context = ctx): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.addEventListener('keydown', (e) => handleCanvasRailKeydown(e, context), { once: true });
    target.dispatchEvent(event);
    return event;
  }

  it.each([
    ['ArrowUp', 'a'], ['ArrowDown', 'c'], ['Home', 'a'], ['End', 'c'],
  ])('moves and activates %s from a card button', (key, id) => {
    const card = document.createElement('li'); card.dataset['railCard'] = ''; card.dataset['tabId'] = 'b';
    const inner = document.createElement('button'); card.append(inner);
    expect(dispatch(inner, key).defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledWith(id);
    expect(focusSelectButton).toHaveBeenCalledWith(id);
  });

  it('steps with wrap outside cards and returns on Escape without selecting', () => {
    const target = document.createElement('section');
    dispatch(target, 'ArrowRight', { ...ctx, focusedId: 'c' });
    expect(focus).toHaveBeenCalledWith('a');
    focus.mockClear();
    expect(dispatch(target, 'Escape').defaultPrevented).toBe(true);
    expect(focusSelectButton).toHaveBeenCalledWith('b');
    expect(focus).not.toHaveBeenCalled();
  });

  it('returns from an inner button and ignores inputs, menus and tablists', () => {
    const card = document.createElement('li'); card.dataset['railCard'] = ''; card.dataset['tabId'] = 'b';
    const inner = document.createElement('button'); card.append(inner);
    expect(dispatch(inner, 'Escape').defaultPrevented).toBe(true);
    expect(focusSelectButton).toHaveBeenCalledWith('b');
    focusSelectButton.mockClear();
    for (const target of ['input', '[role="menu"]', '[role="dialog"]', '[role="tablist"]']) {
      const el = target === 'input' ? document.createElement('input') : document.createElement('div');
      if (target !== 'input') el.setAttribute('role', target.slice(7, -2));
      dispatch(el, 'ArrowRight');
    }
    expect(focus).not.toHaveBeenCalled();
    const prevented = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    prevented.preventDefault();
    handleCanvasRailKeydown(prevented, ctx);
    expect(focus).not.toHaveBeenCalled();
  });
  it.each([
    ['ArrowUp', { altKey: true, shiftKey: true }, 'up'],
    ['ArrowDown', { altKey: true, shiftKey: true }, 'down'],
    ['ArrowUp', {}, null],
    ['ArrowDown', { shiftKey: true }, null],
    ['ArrowDown', { altKey: true }, null],
    ['ArrowUp', { altKey: true, shiftKey: true, ctrlKey: true }, null],
    ['ArrowUp', { altKey: true, shiftKey: true, metaKey: true }, null],
    ['Home', { altKey: true, shiftKey: true }, null],
  ] as const)('reads %s %o as a move of %s', (key, mods, expected) => {
    expect(railMoveKey(new KeyboardEvent('keydown', { key, ...mods }))).toBe(expected);
  });

  it('leaves Alt+Shift arrows to the card and keeps plain arrows moving focus', () => {
    const card = document.createElement('li'); card.dataset['railCard'] = ''; card.dataset['tabId'] = 'b';
    const select = document.createElement('button'); select.className = 'rc-select'; card.append(select);
    for (const key of ['ArrowUp', 'ArrowDown']) {
      const event = new KeyboardEvent('keydown', { key, altKey: true, shiftKey: true, bubbles: true, cancelable: true });
      select.addEventListener('keydown', (e) => handleCanvasRailKeydown(e, ctx), { once: true });
      select.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(focus).not.toHaveBeenCalled();
    expect(focusSelectButton).not.toHaveBeenCalled();
    expect(dispatch(select, 'ArrowDown').defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledWith('c');
  });
});
