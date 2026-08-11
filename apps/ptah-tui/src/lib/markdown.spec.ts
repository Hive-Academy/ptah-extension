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

describe('terminal control sanitisation', () => {
  // Built with fromCharCode rather than written as literal bytes, so the
  // sequences survive copy/paste and are legible to a reader of this file.
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const CSI_RED = ESC + '[31m';
  // A real OSC 52 clipboard write: on emulators that honour it (iTerm2, kitty,
  // recent xterm, tmux with set-clipboard on) this sets the user's system
  // clipboard from within a printed string.
  const OSC_52_CLIPBOARD_WRITE = ESC + ']52;c;SGVsbG8=' + BEL;

  it('strips CSI sequences from inline text', () => {
    const text = spansToPlainText(parseInline('before ' + CSI_RED + 'after'));

    expect(text).toBe('before after');
    expect(text).not.toContain(ESC);
    expect(text).not.toContain('[31m');
  });

  it('strips an OSC 52 clipboard write from inline text', () => {
    const text = spansToPlainText(
      parseInline('hello ' + OSC_52_CLIPBOARD_WRITE + 'world'),
    );

    expect(text).toBe('hello world');
    expect(text).not.toContain(ESC);
    expect(text).not.toContain('52;c;');
  });

  it('strips control sequences from fenced code lines, which never reach parseInline', () => {
    // Code block content is pushed to `lines` verbatim and rendered by
    // `highlightLine`, bypassing InlineSpan entirely — so a strip that only
    // covered spans would leave this whole path exposed.
    const blocks = parseMarkdown(
      [
        '```sh',
        'echo ' + CSI_RED + 'pwned' + OSC_52_CLIPBOARD_WRITE,
        '```',
      ].join('\n'),
    );

    const code = blocks.find((block) => block.kind === 'code');
    expect(code).toBeDefined();
    const lines = code?.kind === 'code' ? code.lines : [];
    expect(lines).toEqual(['echo pwned']);
    expect(lines.join('')).not.toContain(ESC);
  });

  it('strips a bare carriage return, which overwrites the current line', () => {
    // CR on its own returns the cursor to column zero, so a model can repaint
    // a line it already emitted. It is a C0 control like TAB and LF, but
    // unlike those two the parser does not need it.
    expect(spansToPlainText(parseInline('ab\rc'))).toBe('abc');
  });

  it('strips C1 controls, the single-byte equivalents of ESC sequences', () => {
    // U+009B is CSI and U+009D is OSC in their 8-bit forms.
    const csi8 = String.fromCharCode(0x9b);
    const osc8 = String.fromCharCode(0x9d);
    expect(spansToPlainText(parseInline('a' + csi8 + '31mb'))).toBe('a31mb');
    expect(spansToPlainText(parseInline('a' + osc8 + '52;cb'))).toBe('a52;cb');
  });

  it('keeps tab and newline, which the block structure depends on', () => {
    // Both are C0 controls, and stripping them blindly would flatten every
    // list and merge every block. Tab feeds `depthFromIndent`; newline is what
    // the parser splits on.
    const blocks = parseMarkdown('# title\n\n\t- nested');

    expect(kinds(blocks)).toEqual(['heading', 'list-item']);
    const item = blocks[1];
    expect(item?.kind === 'list-item' ? item.depth : -1).toBe(1);
  });

  it('leaves ordinary prose and punctuation untouched', () => {
    const source = 'Costs $5 - see `a_b`, 100% of "cases" (really).';
    expect(spansToPlainText(parseInline(source))).toBe(
      'Costs $5 - see a_b, 100% of "cases" (really).',
    );
  });

  it('does not let an unterminated OSC leak into the transcript mid-stream', () => {
    // A streaming turn can be cut inside a sequence; the fragment must still
    // not reach the terminal.
    expect(spansToPlainText(parseInline('x' + ESC + ']52;c;SGVsbG'))).toBe('x');
  });
});
