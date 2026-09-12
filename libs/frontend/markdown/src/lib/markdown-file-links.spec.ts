import {
  DOCUMENT,
  EnvironmentInjector,
  createEnvironmentInjector,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MARKDOWN_FILE_LINK_HANDLER,
  MARKDOWN_FILE_LINKS_OPT_IN_ATTR,
  provideMarkdownFileLinks,
  type MarkdownFileLinkHandler,
} from './markdown-file-links';

type MockHandler = MarkdownFileLinkHandler & {
  handleMarkdownFileLink: jest.Mock;
};

describe('provideMarkdownFileLinks', () => {
  let doc: Document;
  let handler: MockHandler;
  let liveInjectors: EnvironmentInjector[];
  /** `defaultPrevented` as seen when the event bubbles to <body>. */
  let preventedAtBubble: boolean[];

  const recordAndSuppressNavigation = (event: Event): void => {
    preventedAtBubble.push(event.defaultPrevented);
    // jsdom does not implement navigation; keep it from trying.
    event.preventDefault();
  };

  beforeEach(() => {
    doc = TestBed.inject(DOCUMENT);
    handler = { handleMarkdownFileLink: jest.fn() };
    liveInjectors = [];
    preventedAtBubble = [];
    doc.body.addEventListener('click', recordAndSuppressNavigation);
    doc.body.addEventListener('auxclick', recordAndSuppressNavigation);
  });

  afterEach(() => {
    for (const injector of liveInjectors) injector.destroy();
    doc.body.removeEventListener('click', recordAndSuppressNavigation);
    doc.body.removeEventListener('auxclick', recordAndSuppressNavigation);
    doc.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  function install(
    withHandler: MarkdownFileLinkHandler = handler,
  ): EnvironmentInjector {
    const injector = createEnvironmentInjector(
      [
        { provide: MARKDOWN_FILE_LINK_HANDLER, useValue: withHandler },
        provideMarkdownFileLinks(),
      ],
      TestBed.inject(EnvironmentInjector),
    );
    liveInjectors.push(injector);
    return injector;
  }

  function destroy(injector: EnvironmentInjector): void {
    injector.destroy();
    liveInjectors = liveInjectors.filter((live) => live !== injector);
  }

  /** `<section [data-ptah-file-links]><markdown>html</markdown></section>` */
  function renderMarkdown(
    html: string,
    options: { optIn?: boolean; hostTag?: 'markdown' | 'div' } = {},
  ): HTMLElement {
    const surface = doc.createElement('section');
    if (options.optIn ?? true) {
      surface.setAttribute(MARKDOWN_FILE_LINKS_OPT_IN_ATTR, '');
    }
    const host = doc.createElement(options.hostTag ?? 'markdown');
    if (options.hostTag === 'div') host.setAttribute('markdown', '');
    host.innerHTML = html;
    surface.appendChild(host);
    doc.body.appendChild(surface);
    return host;
  }

  function press(
    element: Element,
    type: 'click' | 'auxclick' = 'click',
    button = type === 'auxclick' ? 1 : 0,
  ): boolean {
    element.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button }),
    );
    return preventedAtBubble[preventedAtBubble.length - 1];
  }

  function anchorIn(root: ParentNode): HTMLAnchorElement {
    const anchor = root.querySelector('a');
    if (!anchor) throw new Error('fixture has no anchor');
    return anchor;
  }

  const fileLink = (target: string, text = 'open'): string =>
    `<p><a href="#" data-ptah-file-href="${target}" class="ptah-file-link">${text}</a></p>`;

  it('installs one capture listener per event type, however many renders happen', () => {
    const addSpy = jest.spyOn(doc, 'addEventListener');
    install();

    const host = renderMarkdown(fileLink('src/a.ts:1'));
    for (let render = 2; render <= 5; render++) {
      host.innerHTML = fileLink(`src/a.ts:${render}`);
    }

    const captureCalls = (type: string) =>
      addSpy.mock.calls.filter(
        ([name, , capture]) => name === type && capture === true,
      );
    expect(captureCalls('click')).toHaveLength(1);
    expect(captureCalls('auxclick')).toHaveLength(1);

    expect(press(anchorIn(host))).toBe(true);
    expect(handler.handleMarkdownFileLink).toHaveBeenCalledTimes(1);
    expect(handler.handleMarkdownFileLink).toHaveBeenCalledWith(
      { path: 'src/a.ts', line: 5 },
      anchorIn(host),
    );
  });

  it('keeps intercepting after streaming replaces the rendered HTML', () => {
    install();
    const host = renderMarkdown(fileLink('src/a.ts'));
    press(anchorIn(host));

    host.innerHTML = fileLink('C:\\repo\\b.ts:12:3');
    const replaced = anchorIn(host);
    expect(press(replaced)).toBe(true);

    expect(handler.handleMarkdownFileLink).toHaveBeenCalledTimes(2);
    expect(handler.handleMarkdownFileLink).toHaveBeenLastCalledWith(
      { path: 'C:\\repo\\b.ts', line: 12, column: 3 },
      replaced,
    );
  });

  it('routes a click on an element nested inside the anchor', () => {
    install();
    const host = renderMarkdown(
      fileLink('src/a.ts', '<strong><em>open</em></strong>'),
    );
    const em = host.querySelector('em');
    if (!em) throw new Error('fixture has no <em>');

    expect(press(em)).toBe(true);
    expect(handler.handleMarkdownFileLink).toHaveBeenCalledWith(
      { path: 'src/a.ts' },
      anchorIn(host),
    );
  });

  it('reads a raw-HTML anchor href when there is no data attribute', () => {
    install();
    const host = renderMarkdown('<a href="src/b.ts#L4">b</a>');

    expect(press(anchorIn(host))).toBe(true);
    expect(handler.handleMarkdownFileLink).toHaveBeenCalledWith(
      { path: 'src/b.ts', line: 4 },
      anchorIn(host),
    );
  });

  it('supports an attribute-selector markdown host', () => {
    install();
    const host = renderMarkdown(fileLink('src/a.ts'), { hostTag: 'div' });

    expect(press(anchorIn(host))).toBe(true);
    expect(handler.handleMarkdownFileLink).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pre > code', `<pre><code>${fileLink('src/a.ts')}</code></pre>`],
    ['inline code', `<code><a href="src/a.ts">a</a></code>`],
  ])('ignores anchors inside %s', (_label, html) => {
    install();
    const host = renderMarkdown(html);

    expect(press(anchorIn(host))).toBe(false);
    expect(handler.handleMarkdownFileLink).not.toHaveBeenCalled();
  });

  it('lets http links navigate as before', () => {
    install();
    const host = renderMarkdown('<a href="https://example.com/a.ts">docs</a>');

    expect(press(anchorIn(host))).toBe(false);
    expect(handler.handleMarkdownFileLink).not.toHaveBeenCalled();
  });

  it('intercepts a middle-button auxclick and ignores a right-button one', () => {
    install();
    const host = renderMarkdown(fileLink('src/a.ts'));

    expect(press(anchorIn(host), 'auxclick', 2)).toBe(false);
    expect(handler.handleMarkdownFileLink).not.toHaveBeenCalled();

    expect(press(anchorIn(host), 'auxclick', 1)).toBe(true);
    expect(handler.handleMarkdownFileLink).toHaveBeenCalledTimes(1);
  });

  it('logs a throwing handler and keeps default navigation prevented', () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const failure = new Error('boom');
    handler.handleMarkdownFileLink.mockImplementation(() => {
      throw failure;
    });
    install();
    const host = renderMarkdown(fileLink('src/a.ts'));

    expect(press(anchorIn(host))).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MarkdownFileLinks]'),
      failure,
    );
  });

  it('logs a rejected async handler', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const failure = new Error('async boom');
    handler.handleMarkdownFileLink.mockRejectedValue(failure);
    install();
    const host = renderMarkdown(fileLink('src/a.ts'));

    expect(press(anchorIn(host))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MarkdownFileLinks]'),
      failure,
    );
  });

  it('logs a rejected NON-native thenable, as Zone.js and cross-realm handlers return', async () => {
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const failure = new Error('thenable boom');
    // Deliberately NOT a Promise of this realm: `instanceof Promise` is false,
    // so an identity check would drop this rejection on the floor.
    const thenable = {
      then(
        _onFulfilled?: ((value: void) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ): void {
        setTimeout(() => onRejected?.(failure), 0);
      },
    };
    expect(thenable).not.toBeInstanceOf(Promise);
    handler.handleMarkdownFileLink.mockReturnValue(thenable);
    install();
    const host = renderMarkdown(fileLink('src/a.ts'));

    expect(press(anchorIn(host))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MarkdownFileLinks]'),
      failure,
    );
  });

  it('does not stop propagation', () => {
    install();
    const host = renderMarkdown(fileLink('src/a.ts'));
    const outer = jest.fn();
    doc.addEventListener('click', outer);

    press(anchorIn(host));
    doc.removeEventListener('click', outer);

    expect(preventedAtBubble).toEqual([true]);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  describe('opt-in marker', () => {
    it('ignores markdown with no marked ancestor', () => {
      install();
      const host = renderMarkdown(fileLink('src/a.ts'), { optIn: false });

      expect(press(anchorIn(host))).toBe(false);
      expect(handler.handleMarkdownFileLink).not.toHaveBeenCalled();
    });

    it('ignores a marker placed inside the rendered markdown', () => {
      install();
      const host = renderMarkdown(
        `<div ${MARKDOWN_FILE_LINKS_OPT_IN_ATTR}>${fileLink('src/a.ts')}</div>`,
        { optIn: false },
      );

      expect(press(anchorIn(host))).toBe(false);
      expect(handler.handleMarkdownFileLink).not.toHaveBeenCalled();
    });

    it('ignores a marker on the markdown host itself', () => {
      install();
      const host = renderMarkdown(fileLink('src/a.ts'), { optIn: false });
      host.setAttribute(MARKDOWN_FILE_LINKS_OPT_IN_ATTR, '');

      expect(press(anchorIn(host))).toBe(false);
      expect(handler.handleMarkdownFileLink).not.toHaveBeenCalled();
    });

    it('ignores file anchors in a marked surface that are not inside markdown', () => {
      install();
      const surface = doc.createElement('section');
      surface.setAttribute(MARKDOWN_FILE_LINKS_OPT_IN_ATTR, '');
      surface.innerHTML = fileLink('src/a.ts');
      doc.body.appendChild(surface);

      expect(press(anchorIn(surface))).toBe(false);
      expect(handler.handleMarkdownFileLink).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('removes both listeners when the injector is destroyed', () => {
      const removeSpy = jest.spyOn(doc, 'removeEventListener');
      const injector = install();
      const host = renderMarkdown(fileLink('src/a.ts'));

      destroy(injector);

      const captureRemovals = (type: string) =>
        removeSpy.mock.calls.filter(
          ([name, , capture]) => name === type && capture === true,
        );
      expect(captureRemovals('click')).toHaveLength(1);
      expect(captureRemovals('auxclick')).toHaveLength(1);

      expect(press(anchorIn(host))).toBe(false);
      expect(handler.handleMarkdownFileLink).not.toHaveBeenCalled();
    });

    it('installs once when provided twice and keeps listening until the last installer is destroyed', () => {
      const addSpy = jest.spyOn(doc, 'addEventListener');
      const first = install();
      const second = install({ handleMarkdownFileLink: jest.fn() });
      const host = renderMarkdown(fileLink('src/a.ts'));

      expect(
        addSpy.mock.calls.filter(([name]) => name === 'click'),
      ).toHaveLength(1);

      destroy(first);
      expect(press(anchorIn(host))).toBe(true);
      expect(handler.handleMarkdownFileLink).toHaveBeenCalledTimes(1);

      destroy(second);
      expect(press(anchorIn(host))).toBe(false);
      expect(handler.handleMarkdownFileLink).toHaveBeenCalledTimes(1);
    });
  });
});
