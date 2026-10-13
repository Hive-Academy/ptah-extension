jest.mock('./provide-markdown-rendering', () => {
  const actual = jest.requireActual<typeof import('./provide-markdown-rendering')>(
    './provide-markdown-rendering',
  );
  return {
    ...actual,
    sanitizeFullMarkdownHtml: jest.fn(actual.sanitizeFullMarkdownHtml),
  };
});

import { Marked } from 'marked';
import {
  StreamingMarkdownRenderer,
  type StreamingMarkdownBlock,
} from './streaming-markdown-renderer';
import { sanitizeFullMarkdownHtml } from './provide-markdown-rendering';
import { getMarkedExtensions } from './marked-extensions';

const sanitize = sanitizeFullMarkdownHtml as jest.MockedFunction<
  typeof sanitizeFullMarkdownHtml
>;

function joined(blocks: readonly StreamingMarkdownBlock[]): string {
  return blocks.map((block) => block.html).join('');
}

/** Parses one block alone, as its own `[innerHTML]` host would. */
function activeContentIn(html: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = html;
  const found: string[] = [];
  for (const element of Array.from(host.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
      found.push(`<${tag}>`);
    }
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) found.push(`${tag}[${attribute.name}]`);
      if (/^\s*(java|vb)script:/i.test(attribute.value)) {
        found.push(`${tag}[${attribute.name}=${attribute.value}]`);
      }
    }
  }
  return found;
}

describe('StreamingMarkdownRenderer', () => {
  beforeEach(() => {
    sanitize.mockClear();
    sanitize.mockImplementation(
      jest.requireActual<typeof import('./provide-markdown-rendering')>(
        './provide-markdown-rendering',
      ).sanitizeFullMarkdownHtml,
    );
  });

  it('does not re-parse closed blocks when only the open tail changes', () => {
    const parse = jest.spyOn(Marked.prototype, 'parseMarkdown');
    const renderer = new StreamingMarkdownRenderer();
    renderer.render('## Closed\n\nopen');
    const afterFirst = parse.mock.calls.length;

    renderer.render('## Closed\n\nopen tail');

    expect(parse).toHaveBeenCalledTimes(afterFirst);
    parse.mockRestore();
  });

  it('uses the full marked and sanitizer path when the message settles', () => {
    const source = '## Title\n\nA settled paragraph.\n\n';
    const fullMarked = new Marked();
    fullMarked.use(...getMarkedExtensions());
    const renderer = new StreamingMarkdownRenderer();

    const { blocks, tail } = renderer.render(source);

    expect(joined(blocks)).toBe(
      sanitizeFullMarkdownHtml(fullMarked.parse(source, { async: false })),
    );
    expect(tail).toBe('');
  });

  it('keeps completing blocks after the first closed code fence', () => {
    const renderer = new StreamingMarkdownRenderer();
    renderer.render('```ts\nconst a = 1;\n```\n');

    const { blocks, tail } = renderer.render(
      '```ts\nconst a = 1;\n```\n\n## After\n\n```js\nb()\n```\n\nopen',
    );
    const html = joined(blocks);

    expect(html).toContain('<h2');
    expect(html).toContain('b()');
    expect(html).not.toContain('## After');
    expect(html).not.toContain('```js');
    expect(tail).toBe('open');
  });

  it('keeps an unclosed fence in the open tail', () => {
    const { blocks, tail } = new StreamingMarkdownRenderer().render(
      'intro\n\n```ts\nconst <b>x</b>',
    );

    expect(joined(blocks)).toContain('intro');
    expect(joined(blocks)).not.toContain('<b>');
    expect(tail).toBe('```ts\nconst <b>x</b>');
  });

  it('never puts unsafe HTML from an open tail into the DOM', () => {
    const source = '<img src=x onerror=alert(1)>';

    const { blocks, tail } = new StreamingMarkdownRenderer().render(source);

    expect(blocks).toEqual([]);
    expect(tail).toBe(source);
    expect(sanitize).not.toHaveBeenCalled();
  });

  it('sanitizes each completed block exactly once', () => {
    const renderer = new StreamingMarkdownRenderer();
    renderer.render('First paragraph.\n\nsecond');
    expect(sanitize).toHaveBeenCalledTimes(1);

    renderer.render('First paragraph.\n\nsecond grows');
    renderer.render('First paragraph.\n\nsecond grows more');
    renderer.render('First paragraph.\n\nsecond grows more and more');
    expect(sanitize).toHaveBeenCalledTimes(1);

    renderer.render('First paragraph.\n\nsecond grows more and more\n\nthird');
    expect(sanitize).toHaveBeenCalledTimes(2);
    const lastInput = sanitize.mock.calls[1][0];
    expect(lastInput).toContain('second grows more and more');
    expect(lastInput).not.toContain('First paragraph.');
  });

  it('returns the same blocks array when only the tail changes', () => {
    const renderer = new StreamingMarkdownRenderer();
    const first = renderer.render('One.\n\ntail');
    const second = renderer.render('One.\n\ntail grows');

    expect(second.blocks).toBe(first.blocks);

    const third = renderer.render('One.\n\ntail grows\n\nnext');
    expect(third.blocks).not.toBe(first.blocks);
    expect(third.blocks).toHaveLength(2);
    expect(third.blocks[0]).toBe(first.blocks[0]);
  });

  it.each([
    '<img src=x\n\nonerror=alert(1)>',
    '<a href="java\n\nscript:alert(1)">x</a>\n\n',
    '<svg>\n\n<script>alert(1)</script>\n\n</svg>\n\n',
  ])('a payload split across a block boundary never yields active content: %j', (payload) => {
    const renderer = new StreamingMarkdownRenderer();
    const source = `${payload}\n\n`;
    for (let end = 1; end <= source.length; end++) {
      const { blocks } = renderer.render(source.slice(0, end));
      for (const block of blocks) {
        expect(activeContentIn(block.html)).toEqual([]);
      }
    }
  });

  it('a non-prefix source resets with fresh ids', () => {
    const renderer = new StreamingMarkdownRenderer();
    const first = renderer.render('Alpha.\n\nBeta.\n\n');
    const ids = first.blocks.map((block) => block.id);

    const replaced = renderer.render('Gamma.\n\n');

    expect(replaced.blocks).toHaveLength(1);
    expect(replaced.blocks[0].html).toContain('Gamma.');
    expect(ids).not.toContain(replaced.blocks[0].id);
  });

  it('keeps a slice in the tail when sanitizing it throws, and retries next render', () => {
    const renderer = new StreamingMarkdownRenderer();
    sanitize.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const failed = renderer.render('Para.\n\nopen');
    expect(failed.blocks).toEqual([]);
    expect(failed.tail).toBe('Para.\n\nopen');

    const retried = renderer.render('Para.\n\nopen');
    expect(retried.blocks).toHaveLength(1);
    expect(retried.tail).toBe('open');
    expect(failed.failed).toBe(false);
    expect(retried.failed).toBe(false);
  });

  it('stops incremental rendering after a boundary fails twice, and reports it once', () => {
    const renderer = new StreamingMarkdownRenderer();
    const good = renderer.render('Good block.\n\n');
    expect(good.blocks).toHaveLength(1);
    sanitize.mockClear();
    sanitize.mockImplementation(() => {
      throw new Error('boom');
    });

    let source = 'Good block.\n\n';
    let failures = 0;
    let last = good;
    for (let frame = 0; frame < 50; frame++) {
      source += `Paragraph ${frame}.\n\n`;
      last = renderer.render(source);
      if (last.failed) failures++;
    }

    expect(sanitize.mock.calls.length).toBeLessThanOrEqual(2);
    expect(failures).toBe(1);
    expect(last.blocks).toBe(good.blocks);
    expect(last.tail).toBe(source.slice('Good block.\n\n'.length));
  });

  it('a non-prefix change after a stop renders incrementally again', () => {
    const renderer = new StreamingMarkdownRenderer();
    sanitize.mockImplementation(() => {
      throw new Error('boom');
    });
    renderer.render('One.\n\n');
    expect(renderer.render('One.\n\nTwo.\n\n').failed).toBe(true);
    sanitize.mockImplementation(
      jest.requireActual<typeof import('./provide-markdown-rendering')>(
        './provide-markdown-rendering',
      ).sanitizeFullMarkdownHtml,
    );

    const fresh = renderer.render('Other.\n\n');

    expect(fresh.blocks).toHaveLength(1);
    expect(fresh.tail).toBe('');
  });
});
