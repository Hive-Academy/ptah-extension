import { CanvasRailFlip, visualOpacity } from './canvas-rail-flip';

describe('visualOpacity', () => {
  it('keeps 0 from a fade that just started, and falls back to 1 only for no value', () => {
    // One element per case: jsdom caches an element's computed style.
    const withOpacity = (value: string): HTMLElement => {
      const element = document.createElement('div');
      element.style.opacity = value;
      return element;
    };
    expect(visualOpacity(withOpacity('0'))).toBe(0);
    expect(visualOpacity(withOpacity('0.4'))).toBeCloseTo(0.4);
    expect(visualOpacity(withOpacity(''))).toBe(1);
  });
});

/** jsdom lays nothing out: give an element one client rect, as a rendered box has. */
function rendered<T extends HTMLElement>(element: T, top = 0): T {
  Object.defineProperty(element, 'getClientRects', { value: () => ({ length: 1 }) });
  element.getBoundingClientRect = () => ({ top }) as DOMRect;
  return element;
}

function card(tabId: string, top = 0): HTMLLIElement {
  const element = rendered(document.createElement('li'), top);
  element.dataset.railCard = '';
  element.dataset.tabId = tabId;
  return element;
}

describe('CanvasRailFlip', () => {
  it('matches a recreated card by tab id and slides by its on-screen delta', () => {
    const container = document.createElement('div');
    const firstCard = card('session-1', 140);
    container.append(firstCard);
    const flip = new CanvasRailFlip(container);
    const first = flip.capture();

    // A clamped or anchored scroll between capture and measure is part of
    // the on-screen move, so the delta is in viewport space.
    const replacement = card('session-1', 180);
    firstCard.replaceWith(replacement);

    expect(first.get('card:session-1')).toEqual({ top: 140, opacity: 1 });
    expect(flip.measure(first)).toEqual([
      { element: replacement, delta: -40, fresh: false, opacity: 1 },
    ]);
  });

  it('cancels a running slide on the same card before it starts the next', () => {
    const container = document.createElement('div');
    const element = card('session-1', 0);
    container.append(element);
    const cancels: string[] = [];
    let count = 0;
    Object.defineProperty(element, 'animate', {
      value: () => {
        const id = `a${++count}`;
        return { cancel: () => cancels.push(id), onfinish: null };
      },
    });
    const original = Element.prototype.animate;
    Object.defineProperty(Element.prototype, 'animate', { value: () => undefined, configurable: true });
    try {
      const flip = new CanvasRailFlip(container);
      flip.play([{ element, delta: 30, fresh: false, opacity: 1 }]);
      flip.play([{ element, delta: 10, fresh: false, opacity: 1 }]);
      expect(cancels).toEqual(['a1']);
      flip.cancel();
      expect(cancels).toEqual(['a1', 'a2']);
    } finally {
      Object.defineProperty(Element.prototype, 'animate', { value: original, configurable: true });
    }
  });

  it('marks new cards for entry and tolerates browsers without animate', () => {
    const container = document.createElement('div');
    container.append(card('new'));
    const flip = new CanvasRailFlip(container);
    const moves = flip.measure(new Map());
    expect(moves[0].fresh).toBe(true);
    expect(() => flip.play(moves)).not.toThrow();
  });

  it('skips cards that are not rendered, such as the folded finished list', () => {
    const container = document.createElement('div');
    const hidden = document.createElement('li');
    hidden.dataset.railCard = '';
    hidden.dataset.tabId = 'folded';
    // No mock: jsdom, like display: none, returns an empty rect list.
    container.append(hidden);
    const flip = new CanvasRailFlip(container);
    expect(flip.capture().has('card:folded')).toBe(false);
    expect(flip.measure(new Map())).toEqual([]);
  });

  it('animates only a section header, never a button nested in a card', () => {
    const container = document.createElement('div');
    const section = document.createElement('section');
    section.dataset.railGroup = 'running';
    const list = document.createElement('ul');
    const item = card('session-1');
    item.append(rendered(document.createElement('button')));
    list.append(item);
    section.append(list);
    container.append(section);
    const flip = new CanvasRailFlip(container);

    expect([...flip.capture().keys()]).toEqual(['card:session-1']);

    const header = rendered(document.createElement('h2'));
    section.prepend(header);
    const moves = flip.measure(new Map());
    expect(moves.map((move) => move.element)).toEqual([item, header]);
  });
});
