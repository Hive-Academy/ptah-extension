import { Marked } from 'marked';
import { StreamingMarkdownRenderer } from './streaming-markdown-renderer';
import { sanitizeFullMarkdownHtml } from './provide-markdown-rendering';
import { getMarkedExtensions } from './marked-extensions';

describe('StreamingMarkdownRenderer', () => {
  it('does not re-parse closed blocks when only the open tail changes', () => {
    const parse = jest.spyOn(Marked.prototype, 'parseMarkdown');
    const renderer = new StreamingMarkdownRenderer();
    renderer.render('## Closed\n\nopen');
    const afterFirst = parse.mock.calls.length;

    renderer.render('## Closed\n\nopen tail');

    expect(parse).toHaveBeenCalledTimes(afterFirst);
  });

  it('uses the full marked and sanitizer path when the message settles', () => {
    const source = '## Title\n\nA settled paragraph.\n\n';
    const fullMarked = new Marked();
    fullMarked.use(...getMarkedExtensions());
    const expected = sanitizeFullMarkdownHtml(fullMarked.parse(source));
    const renderer = new StreamingMarkdownRenderer();

    expect(renderer.render(source)).toBe(expected);
  });

  it('keeps completing blocks after the first closed code fence', () => {
    const renderer = new StreamingMarkdownRenderer();
    renderer.render('```ts\nconst a = 1;\n```\n');

    const html = renderer.render('```ts\nconst a = 1;\n```\n\n## After\n\n```js\nb()\n```\n\nopen');

    expect(html).toContain('<h2');
    expect(html).toContain('b()');
    expect(html).not.toContain('## After');
    expect(html).not.toContain('```js');
  });

  it('keeps an unclosed fence in the open tail', () => {
    const html = new StreamingMarkdownRenderer().render('intro\n\n```ts\nconst <b>x</b>');

    expect(html).toContain('intro');
    expect(html).toContain('```ts');
    expect(html).not.toContain('<b>');
  });

  it('never puts unsafe HTML from an open tail into the DOM', () => {
    const html = new StreamingMarkdownRenderer().render('<img src=x onerror=alert(1)>');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<img[^>]*onerror=/);
  });
});
