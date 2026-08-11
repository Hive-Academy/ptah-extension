import {
  parseInline,
  parseMarkdown,
  spansToPlainText,
  type MarkdownBlock,
} from './markdown.js';

function kinds(blocks: readonly MarkdownBlock[]): string[] {
  return blocks.map((block) => block.kind);
}

describe('parseInline', () => {
  it('returns a single text span for plain prose', () => {
    expect(parseInline('hello world')).toEqual([
      { kind: 'text', text: 'hello world' },
    ]);
  });

  it('parses bold before italic so ** is never two *', () => {
    expect(parseInline('a **b** c')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' c' },
    ]);
  });

  it('parses italic with either delimiter', () => {
    expect(parseInline('*a*')).toEqual([{ kind: 'italic', text: 'a' }]);
    expect(parseInline('_a_')).toEqual([{ kind: 'italic', text: 'a' }]);
  });

  it('parses inline code', () => {
    expect(parseInline('run `npm test` now')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'npm test' },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('lets code spans win over emphasis', () => {
    expect(parseInline('`**not bold**`')).toEqual([
      { kind: 'code', text: '**not bold**' },
    ]);
  });

  it('parses links', () => {
    expect(parseInline('see [docs](https://ptah.live)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'docs', href: 'https://ptah.live' },
    ]);
  });

  it('keeps an unterminated delimiter literal instead of eating the line', () => {
    expect(parseInline('a **b')).toEqual([{ kind: 'text', text: 'a **b' }]);
    expect(parseInline('a `b')).toEqual([{ kind: 'text', text: 'a `b' }]);
  });

  it('treats empty delimiter pairs as literal text', () => {
    expect(parseInline('****')).toEqual([{ kind: 'text', text: '****' }]);
  });

  it('never loses characters', () => {
    const source = 'mix **bold** and `code` and *it* and [l](u) tail';
    expect(spansToPlainText(parseInline(source))).toBe(
      'mix bold and code and it and l tail',
    );
  });
});

describe('parseMarkdown blocks', () => {
  it('parses headings with their level', () => {
    const blocks = parseMarkdown('# One\n### Three');
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, spans: [{ kind: 'text', text: 'One' }] },
      { kind: 'heading', level: 3, spans: [{ kind: 'text', text: 'Three' }] },
    ]);
  });

  it('parses unordered and ordered list items with depth', () => {
    const blocks = parseMarkdown('- top\n  - nested\n1. first');
    expect(blocks).toEqual([
      {
        kind: 'list-item',
        ordered: false,
        marker: '',
        depth: 0,
        spans: [{ kind: 'text', text: 'top' }],
      },
      {
        kind: 'list-item',
        ordered: false,
        marker: '',
        depth: 1,
        spans: [{ kind: 'text', text: 'nested' }],
      },
      {
        kind: 'list-item',
        ordered: true,
        marker: '1.',
        depth: 0,
        spans: [{ kind: 'text', text: 'first' }],
      },
    ]);
  });

  it('parses a fenced code block with its language badge', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\n```');
    expect(blocks).toEqual([
      { kind: 'code', language: 'ts', lines: ['const a = 1;'], closed: true },
    ]);
  });

  it('leaves an unterminated fence open instead of dropping it', () => {
    const blocks = parseMarkdown('text\n```py\nprint(1)');
    expect(kinds(blocks)).toEqual(['paragraph', 'code']);
    const code = blocks[1];
    expect(code).toEqual({
      kind: 'code',
      language: 'py',
      lines: ['print(1)'],
      closed: false,
    });
  });

  it('does not let a ~~~ line close a ``` block', () => {
    const blocks = parseMarkdown('```\n~~~\nstill code\n```');
    expect(blocks).toEqual([
      {
        kind: 'code',
        language: '',
        lines: ['~~~', 'still code'],
        closed: true,
      },
    ]);
  });

  it('parses block quotes and horizontal rules', () => {
    expect(kinds(parseMarkdown('> quoted\n\n---'))).toEqual(['quote', 'rule']);
  });

  it('joins wrapped paragraph lines and splits on blank lines', () => {
    const blocks = parseMarkdown('one\ntwo\n\nthree');
    expect(blocks).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'one two' }] },
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'three' }] },
    ]);
  });

  it('is total: every prefix of a streaming document parses', () => {
    const document =
      '# Title\n\nSome **bold** text.\n\n```ts\nconst x = 1;\n```\n\n- a\n- b\n';
    for (let i = 1; i <= document.length; i += 1) {
      expect(() => parseMarkdown(document.slice(0, i))).not.toThrow();
    }
  });

  it('renders plain prose as a paragraph, never as raw markdown', () => {
    const blocks = parseMarkdown('just a sentence');
    expect(blocks).toEqual([
      { kind: 'paragraph', spans: [{ kind: 'text', text: 'just a sentence' }] },
    ]);
  });

  it('produces no blocks for empty or whitespace-only input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });
});
