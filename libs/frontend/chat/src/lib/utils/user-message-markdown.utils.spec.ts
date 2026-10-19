import { marked } from 'marked';
import { toUserMessageMarkdown } from './user-message-markdown.utils';

const render = (text: string): string =>
  marked.parse(toUserMessageMarkdown(text), { async: false });

describe('toUserMessageMarkdown', () => {
  it('shows a <Tag> as literal text instead of HTML', () => {
    const html = render('app.tsx renders <App/> inside <Root>;');
    expect(html).toContain('&lt;App/&gt;');
    expect(html).toContain('&lt;Root&gt;');
    expect(html).not.toContain('<App');
  });

  it('keeps every backslash of a Windows path', () => {
    expect(render('open C:\\Users\\me\\.ptah\\x_y')).toContain(
      'C:\\Users\\me\\.ptah\\x_y',
    );
  });

  it('turns a single newline into a line break', () => {
    expect(render('first line\nsecond line')).toBe(
      '<p>first line<br>second line</p>\n',
    );
  });

  it('keeps paragraphs, lists and bold', () => {
    const html = render('Intro **bold**\n\n- one\n- two');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toMatch(/<li>one\s*<\/li>/);
    expect(html).toContain('<li>two</li>');
    expect(html).toContain('<p>Intro <strong>bold</strong></p>');
  });

  it('leaves inline code unchanged', () => {
    expect(toUserMessageMarkdown('run `a\\b <c>` now <d>')).toBe(
      'run `a\\b <c>` now &lt;d>',
    );
  });

  it('leaves fenced code unchanged', () => {
    const text = 'see:\n```ts\nconst p = "C:\\\\x";\nif (a < b) {}\n```\nafter <x>';
    expect(toUserMessageMarkdown(text)).toBe(
      'see:\n```ts\nconst p = "C:\\\\x";\nif (a < b) {}\n```\nafter &lt;x>',
    );
  });

  it('leaves indented code after a blank line unchanged', () => {
    const text = 'trace:\n\n    at f (C:\\a\\b.ts:1)\n    at <anonymous>';
    expect(toUserMessageMarkdown(text)).toBe(text);
  });
});
