import {
  isInTypingScope,
  isTypeToExpandKey,
  type ComposerTypingScope,
} from './composer-type-to-expand';

function makeDom() {
  document.body.innerHTML = `
    <section id="view">
      <button id="btn">Copy</button>
      <input id="field" />
      <div role="listbox"><div id="option" role="option" tabindex="0">A</div></div>
    </section>
    <section id="other"><button id="otherBtn">Other</button></section>
  `;
  const view = document.getElementById('view') as HTMLElement;
  return { view, by: (id: string) => document.getElementById(id) as Element };
}

function keydown(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('composer type-to-expand', () => {
  it('accepts printable keys typed on a non-editable element in the view', () => {
    const { view, by } = makeDom();
    const scope: ComposerTypingScope = { view, ownsDocumentFocus: false };
    expect(isTypeToExpandKey(keydown(by('btn'), 'a'), scope)).toBe(true);
    expect(isTypeToExpandKey(keydown(by('btn'), '/'), scope)).toBe(true);
  });

  it('ignores shortcuts, Space, named keys and composition', () => {
    const { view, by } = makeDom();
    const scope: ComposerTypingScope = { view, ownsDocumentFocus: false };
    const btn = by('btn');
    expect(isTypeToExpandKey(keydown(btn, 'c', { ctrlKey: true }), scope)).toBe(
      false,
    );
    expect(isTypeToExpandKey(keydown(btn, 'k', { metaKey: true }), scope)).toBe(
      false,
    );
    expect(isTypeToExpandKey(keydown(btn, ' '), scope)).toBe(false);
    expect(isTypeToExpandKey(keydown(btn, 'Enter'), scope)).toBe(false);
    expect(isTypeToExpandKey(keydown(btn, 'a', { isComposing: true }), scope)).toBe(
      false,
    );
  });

  it('leaves editable fields and type-ahead widgets alone', () => {
    const { view, by } = makeDom();
    const scope: ComposerTypingScope = { view, ownsDocumentFocus: true };
    expect(isTypeToExpandKey(keydown(by('field'), 'a'), scope)).toBe(false);
    expect(isTypeToExpandKey(keydown(by('option'), 'a'), scope)).toBe(false);
  });

  it('ignores keys from another view', () => {
    const { view, by } = makeDom();
    const scope: ComposerTypingScope = { view, ownsDocumentFocus: true };
    expect(isTypeToExpandKey(keydown(by('otherBtn'), 'a'), scope)).toBe(false);
  });

  describe('focused wrapper around the chat view (canvas tile)', () => {
    function makeCanvas() {
      document.body.innerHTML = `
        <main id="grid" tabindex="-1">
          <div id="tileA" tabindex="-1">
            <div id="embedA"><ptah-chat-view id="viewA"><p id="textA">x</p></ptah-chat-view></div>
          </div>
          <div id="tileB" tabindex="-1">
            <ptah-chat-view id="viewB"></ptah-chat-view>
          </div>
          <div role="grid"><div id="gridTile" tabindex="-1">
            <ptah-chat-view id="viewC"></ptah-chat-view>
          </div></div>
        </main>
      `;
      return (id: string) => document.getElementById(id) as Element;
    }

    it('expands when the focused target wraps only this chat view', () => {
      const by = makeCanvas();
      const scope: ComposerTypingScope = {
        view: by('viewA'),
        ownsDocumentFocus: false,
      };
      expect(isTypeToExpandKey(keydown(by('tileA'), 'a'), scope)).toBe(true);
      expect(isTypeToExpandKey(keydown(by('embedA'), '/'), scope)).toBe(true);
      expect(isInTypingScope(by('tileA'), scope)).toBe(true);
    });

    it('ignores a shared ancestor that holds several chat views', () => {
      const by = makeCanvas();
      for (const id of ['viewA', 'viewB', 'viewC']) {
        const scope: ComposerTypingScope = {
          view: by(id),
          ownsDocumentFocus: true,
        };
        expect(isTypeToExpandKey(keydown(by('grid'), 'a'), scope)).toBe(false);
      }
    });

    it("ignores another tile's wrapper", () => {
      const by = makeCanvas();
      const scope: ComposerTypingScope = {
        view: by('viewA'),
        ownsDocumentFocus: true,
      };
      expect(isTypeToExpandKey(keydown(by('tileB'), 'a'), scope)).toBe(false);
    });

    it('keeps the exclusions on a wrapper target', () => {
      const by = makeCanvas();
      const scopeA: ComposerTypingScope = {
        view: by('viewA'),
        ownsDocumentFocus: false,
      };
      expect(
        isTypeToExpandKey(keydown(by('tileA'), 'a', { ctrlKey: true }), scopeA),
      ).toBe(false);
      expect(
        isTypeToExpandKey(keydown(by('tileA'), 'a', { isComposing: true }), scopeA),
      ).toBe(false);
      const scopeC: ComposerTypingScope = {
        view: by('viewC'),
        ownsDocumentFocus: false,
      };
      expect(isTypeToExpandKey(keydown(by('gridTile'), 'a'), scopeC)).toBe(
        false,
      );
    });

    it('takes no keys from an ancestor of the fallback host (a div holding divs)', () => {
      document.body.innerHTML = `
        <div id="wrapper" tabindex="-1">
          <div id="host"><div class="card"></div></div>
        </div>
      `;
      const host = document.getElementById('host') as Element;
      const wrapper = document.getElementById('wrapper') as Element;
      expect(
        isInTypingScope(wrapper, { view: host, ownsDocumentFocus: true }),
      ).toBe(false);
    });
  });

  it('takes keys typed with nothing focused only when it owns the document', () => {
    const { view } = makeDom();
    expect(
      isInTypingScope(document.body, { view, ownsDocumentFocus: true }),
    ).toBe(true);
    expect(
      isInTypingScope(document.body, { view, ownsDocumentFocus: false }),
    ).toBe(false);
  });
});
