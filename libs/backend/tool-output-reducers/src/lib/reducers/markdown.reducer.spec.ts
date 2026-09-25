import { Lexer, getDefaults, type Token } from 'marked';
import { countTokens } from '../token-measure';
import type { ReduceResult } from '../reducer.types';
import { reduceMarkdown } from './markdown.reducer';

/** The notes the reducer may add; every other output block must come from the input. */
const NOTE =
  /^\((?:(?:code block|table|list|block quote), \d+ lines, omitted|\d+ lines omitted|section text omitted, \d+ lines)\)$/;

const BOM = String.fromCharCode(0xfeff);

/** The reducer's own view of the text: LF line endings, no BOM. */
function normalise(text: string): string {
  const lf = text.replace(/\r\n?/g, '\n');
  return lf.startsWith(BOM) ? lf.slice(1) : lf;
}

function lex(text: string): Token[] {
  return new Lexer({ ...getDefaults(), gfm: true, pedantic: false }).blockTokens(
    normalise(text),
    [],
  );
}

function headingsOf(text: string): Array<[number, string]> {
  return lex(text).flatMap((token) =>
    token.type === 'heading'
      ? [[token.depth as number, token.text as string]]
      : [],
  );
}

const trimEnd = (raw: string): string => raw.replace(/\n+$/, '');

/**
 * Structural oracle: lexed with the same Lexer, the output has exactly the
 * input's top-level headings (depth and text, in order), and every other
 * top-level output block that is not an omission note has the raw of some
 * input block — nothing was split, merged, promoted or rewritten.
 */
function expectStructurePreserved(output: string, input: string): void {
  expect(headingsOf(output)).toEqual(headingsOf(input));
  const sourceRaws = new Set(lex(input).map((token) => trimEnd(token.raw)));
  for (const token of lex(output)) {
    const raw = trimEnd(token.raw);
    if (token.type === 'space' || (token.type === 'paragraph' && NOTE.test(raw))) {
      continue;
    }
    if (!sourceRaws.has(raw)) {
      throw new Error(`output block is not an input block: ${JSON.stringify(raw)}`);
    }
  }
}

/**
 * Every reduction in this file goes through here: a reduced result must pass
 * the structural oracle; an unchanged result must be byte-identical.
 */
function reduce(input: string, budgetTokens: number): ReduceResult {
  const result = reduceMarkdown(input, { budgetTokens });
  expectValidResult(result, input);
  return result;
}

function expectValidResult(result: ReduceResult, input: string): void {
  expect(result.text.length).toBeGreaterThan(0);
  if (result.reducer === 'markdown-unchanged') {
    expect(result.text).toBe(input);
  } else {
    expect(result.reducer).toBe('markdown-outline');
    expectStructurePreserved(result.text, input);
  }
}

/**
 * Every output line that is neither empty nor a note equals an input line,
 * and those input lines appear in increasing input order.
 */
function expectVerbatimSubsequence(output: string, input: string): void {
  const source = normalise(input).split('\n');
  let cursor = 0;
  for (const line of normalise(output).split('\n')) {
    if (line === '' || NOTE.test(line)) {
      continue;
    }
    while (cursor < source.length && source[cursor] !== line) {
      cursor++;
    }
    if (cursor === source.length) {
      throw new Error(
        `output line is not a verbatim input line in order: ${JSON.stringify(line)}`,
      );
    }
    cursor++;
  }
}

/** Exactly 30 repetitions of one prose line (the review r2 `F`). */
const F = Array.from({ length: 30 }, () => 'body line more prose text').join(
  '\n',
);

const bodyLines = (n: number): string[] =>
  Array.from({ length: n }, () => 'body line more prose text');

/** An over-budget Python module whose `# ` comments look like ATX headings. */
function pythonModule(): string {
  const lines = [
    '#!/usr/bin/env python3',
    '# Module: data loader',
    'import os',
    '',
  ];
  for (let s = 0; s < 20; s++) {
    lines.push(
      `# Section ${s}: helpers`,
      `def helper_${s}(value, items):`,
      `    """Return the weighted total for batch ${s}."""`,
      '    total = 0',
      '    for item in items:',
      `        # accumulate item ${s}`,
      `        total += item * ${s} + len(os.sep)`,
      '    return total + value',
      '',
    );
  }
  return lines.join('\n');
}

interface Fixture {
  readonly text: string;
  /** Number of sections (one heading each). */
  readonly sections: number;
  /** The first block (a one-line paragraph) under each heading. */
  readonly firstBlocks: string[];
}

/** A ~40 KB document with 30 sections, code blocks and one setext heading. */
function largeDoc(): Fixture {
  const lines: string[] = [];
  const firstBlocks: string[] = [];
  const sentence = (s: number, p: number): string =>
    `Paragraph ${p} of section ${s} explains how the reducer keeps the head of every section while the budget lasts, in document order.`;
  for (let s = 0; s < 30; s++) {
    const heading =
      s === 0
        ? ['Reducer guide', '=============']
        : [`${'#'.repeat(1 + (s % 3))} Section ${s}: topic ${s}`];
    const first = `Section ${s} begins here with its summary line.`;
    firstBlocks.push(first);
    lines.push(...heading, '', first, '');
    for (let p = 0; p < 4; p++) {
      lines.push(sentence(s, p));
    }
    const fence = s % 2 === 0 ? '````' : '```';
    lines.push('', `${fence}ts`);
    for (let c = 0; c < 12; c++) {
      lines.push(`const value${c} = compute(${s}, ${c}); // line ${c}`);
    }
    if (fence === '````') {
      lines.push('```', '# not a heading inside a four-backtick block', '```');
    }
    lines.push(fence, '');
    for (let p = 4; p < 6; p++) {
      lines.push(sentence(s, p));
    }
    lines.push('');
  }
  return { text: lines.join('\n'), sections: 30, firstBlocks };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('reduceMarkdown — review r2 inputs', () => {
  const d1b = '# Top\nBody paragraph.\n\nReal heading\n---\n' + F;

  it('d1b: keeps the blank line between a paragraph and a setext heading', () => {
    const result = reduce(d1b, 70);
    expect(result.text).toBe(
      '# Top\nBody paragraph.\n\nReal heading\n---\n\n(30 lines omitted)',
    );
    expect(result.text).toContain('\n\nReal heading\n---\n');
  });

  it('d1b at budget 1 keeps both headings, still separate', () => {
    expect(reduce(d1b, 1).text).toBe(
      '# Top\nReal heading\n---\n\n(section text omitted, 31 lines)',
    );
  });

  it('d2: a top-level fence after a list continuation stays code; # Next stays a heading', () => {
    const doc =
      '# Top\n1. Install:\n\n   ```bash\n   echo ok\n```\n# still code\n```\n# Next\n' +
      F;
    const fence = '```\n# still code\n```\n';
    for (let budgetTokens = 1; budgetTokens <= 80; budgetTokens++) {
      const result = reduce(doc, budgetTokens);
      const headings = headingsOf(result.text).map(([, text]) => text);
      expect(headings).toEqual(['Top', 'Next']);
      expect(headings).not.toContain('still code');
      // The fenced block is kept whole, replaced by its typed note, or inside
      // one merged note; never partly emitted.
      if (!result.text.includes(fence)) {
        expect(result.text).not.toContain('# still code');
      }
    }
    expect(reduce(doc, 30).text).toBe(
      '# Top\n\n(7 lines omitted)\n\n# Next\n\n(30 lines omitted)',
    );
    expect(reduce(doc, 40).text).toBe(
      '# Top\n1. Install:\n\n   ```bash\n   echo ok\n\n(code block, 3 lines, omitted)\n\n# Next\n\n(30 lines omitted)',
    );
  });
});

describe('reduceMarkdown — block HTML is never outlined (User Decision 10)', () => {
  const htmlInputs: Array<[string, string]> = [
    [
      'r2 d1a: an HTML block before a setext heading',
      '# Top\n<div>\nhtml\n</div>\n\nReal heading\n---\n' + F,
    ],
    [
      'r2 d3: a <details> wrapper around blank-separated Markdown',
      '# Top\n<details>\n<summary>Dangerous example</summary>\n\n# delete production\n\n</details>\n' +
        F,
    ],
    [
      'r2 d3 variant: nested <div>s around a blank-separated heading',
      '# Top\n<div><div>\ninner\n</div>\n\n# Heading\n\n</div>\n' + F,
    ],
    [
      'r3 D1: tags inside comments beside a real <details> wrapper',
      '# Top\n<details>\n<!-- </details> -->\n\n# delete production\n\n</details><!-- <details> -->\n' +
        F,
    ],
    [
      'r3: an attribute value holding a closing tag',
      '# Top\n<div title="</div>">\n\n# delete production\n\n</div><p title="<div>"></p>\n' +
        F,
    ],
    [
      'r3: an unclosed comment next to a wrapper',
      '# Top\n<details>\n<!-- </details>\n\n# delete production\n\n--> </details><!-- <details> -->\n' +
        F,
    ],
    [
      'r3: raw text (<textarea>) around a wrapper tag',
      '# Top\n<div>\n<textarea></div>\n\n# delete production\n\n</textarea></div><div>\n' +
        F,
    ],
    [
      'r4 D1: a comment opener inside a quoted attribute',
      '# Top\n<img title="<!--">\n<details>\n-->\n\n# delete production\n\n<img title="<!--">\n</details>\n-->\n' +
        F,
    ],
    [
      'r4 D2: counter-tags inside inline code spans',
      '# Top\ntext <details> `</details>`\n\n# delete production\n\ntext </details> `<details>`\n\n' +
        F,
    ],
    [
      'r4 D3: counter-tags inside iframe raw text',
      '# Top\n<details><iframe></details></iframe>\n\n# delete production\n\n<iframe><details></iframe></details>\n' +
        F,
    ],
    [
      'a block tag inside one paragraph code span',
      '# Top\nUse `<div>` here.\n\n' + F,
    ],
    ['an HTML block holding a heading line', '# Top\n<div>\n# x\n</div>\n' + F],
    ['a <script> block', '# Top\n<script>\n# x\n</script>\n' + F],
    ['an unterminated HTML comment', '# Top\n<!--\n# x\n' + F],
    [
      'a standalone comment (any HTML block declines)',
      '# A\n\n<!-- prettier-ignore -->\n\nfirst line\n\n' + F,
    ],
    ...['pre', 'script', 'style', 'textarea'].map((name): [string, string] => [
      `r5 D1: a paragraph-level <${name}> wrapper`,
      `# Top\ntext <${name}>\n\n# delete production\n\ntext </${name}>\n\n` + F,
    ]),
    [
      'r5 D2: an abruptly closed <!--> comment before a hidden span',
      '# Top\n<!--><span hidden> -->\n\n# delete production\n\ntext </span>\n\n' +
        F,
    ],
    [
      'r5 D2: a --!> comment end before a hidden span',
      '# Top\n<!-- --!><span hidden> -->\n\n# delete production\n\ntext </span>\n\n' +
        F,
    ],
  ];

  it.each(htmlInputs)('%s: returns the input unchanged', (_label, doc) => {
    for (const budgetTokens of [1, 30, 400]) {
      expect(reduce(doc, budgetTokens)).toEqual({
        text: doc,
        reducer: 'markdown-unchanged',
        notes: ['HTML blocks present; not outlined'],
      });
    }
  });

  /** Block names beyond the first Decision 10 list: CommonMark 0.31.2 type 6, then type 1. */
  const addedNames = [
    'base', 'basefont', 'col', 'frame', 'hr', 'link', 'param', 'track',
    'pre', 'script', 'style', 'textarea',
  ];

  it.each(
    addedNames.flatMap((name) => [
      [`<${name}>`, `# Top\n\ntext <${name}> here\n\n` + F],
      [`</${name}>`, `# Top\n\ntext </${name}> here\n\n` + F],
      [`<${name.toUpperCase()} x="1">`, `# Top\n\ntext <${name.toUpperCase()} x="1"> here\n\n` + F],
    ]),
  )('a paragraph holding %s returns the input unchanged', (_tag, doc) => {
    expect(reduce(doc, 1)).toEqual({
      text: doc,
      reducer: 'markdown-unchanged',
      notes: ['HTML blocks present; not outlined'],
    });
  });

  it('still reduces a paragraph with inline-only tags (<kbd>, <br>)', () => {
    const doc = '# A\n\nPress <kbd>Enter</kbd><br> to go on.\n\n' + F;
    const result = reduce(doc, 40);
    expect(result.reducer).toBe('markdown-outline');
    expect(result.text).toBe(
      '# A\n\nPress <kbd>Enter</kbd><br> to go on.\n\n(30 lines omitted)',
    );
  });
});

describe('reduceMarkdown — review r3 inputs', () => {
  it.each([
    ['1,000 levels', `${BOM}${'> '.repeat(1000)}x`],
    ['66 prefix chars', `${BOM}${'> '.repeat(33)}x`],
  ])('D3: a BOM does not hide a deep first-line prefix (%s)', (_label, doc) => {
    const lexed = jest.spyOn(Lexer.prototype, 'blockTokens');
    expect(reduce(doc, 1)).toEqual({
      text: doc,
      reducer: 'markdown-unchanged',
      notes: ['container nesting too deep to outline safely'],
    });
    expect(lexed).not.toHaveBeenCalled();
  });
});

describe('reduceMarkdown — input the lexer cannot represent', () => {
  it('returns duplicate link definitions unchanged (tokens do not reproduce the input)', () => {
    const doc = '# A\n\n[a]: http://x\n[a]: http://y\n\n' + F;
    expect(reduce(doc, 5)).toEqual({
      text: doc,
      reducer: 'markdown-unchanged',
      notes: ['lexer tokens do not reproduce the input'],
    });
  });

  it('returns the input unchanged when the lexer throws', () => {
    jest.spyOn(Lexer.prototype, 'blockTokens').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    const doc = '# A\n\n' + F;
    expect(reduceMarkdown(doc, { budgetTokens: 5 })).toEqual({
      text: doc,
      reducer: 'markdown-unchanged',
      notes: ['markdown lexer failed: RangeError'],
    });
  });

  it('returns input larger than 256 KiB unchanged, quickly', () => {
    const doc = '# A\n' + 'x'.repeat(262_144 - 3);
    expect(doc.length).toBe(262_145);
    const start = performance.now();
    const result = reduce(doc, 5);
    expect(performance.now() - start).toBeLessThan(250);
    expect(result.notes).toEqual(['input larger than 256 KiB; not outlined']);
  });

  it('returns input with a container prefix longer than 64 chars unchanged', () => {
    const prefix = '> - '.repeat(17).slice(0, 65);
    const doc = `# A\n${prefix}deep\n\n${F}`;
    expect(reduce(doc, 5).notes).toEqual([
      'container nesting too deep to outline safely',
    ]);
    // 64 prefix chars are still outlined.
    const shallow = `# A\n${prefix.slice(0, 64)}deep\n\n${F}`;
    expect(reduce(shallow, 5).reducer).toBe('markdown-outline');
  });

  it('does not count a pure-whitespace indent as container nesting', () => {
    const doc = `# A\n\n${' '.repeat(100)}indented code\n\n${F}`;
    expect(reduce(doc, 5).reducer).toBe('markdown-outline');
  });
});

describe('reduceMarkdown — line endings and BOM', () => {
  const d1b = '# Top\nBody paragraph.\n\nReal heading\n---\n' + F;

  it('reduces CRLF input to the same output as LF input', () => {
    const crlf = d1b.replace(/\n/g, '\r\n');
    expect(reduce(crlf, 70).text).toBe(reduce(d1b, 70).text);
  });

  it('returns CRLF input byte-for-byte on an unchanged path', () => {
    const crlf = '# A\r\n\r\ntext\r\n\r\n## B\r\n\r\nmore';
    const result = reduce(crlf, 2000);
    expect(result.reducer).toBe('markdown-unchanged');
    expect(result.text).toBe(crlf);
  });

  it('keeps a leading BOM and still reads the first heading', () => {
    const doc = `${BOM}# A\n\nfirst\n\n${F}`;
    const result = reduce(doc, 20);
    expect(result.reducer).toBe('markdown-outline');
    expect(result.text.startsWith(`${BOM}# A`)).toBe(true);
    expect(headingsOf(result.text)).toEqual([[1, 'A']]);
    expect(reduce(doc, 1).text.startsWith(`${BOM}# A\n`)).toBe(true);
  });
});

describe('reduceMarkdown — off-kind input (misdetected Python)', () => {
  const input = pythonModule();

  it('is over budget', () => {
    expect(countTokens(input)).toBeGreaterThan(600);
  });

  it('emits only verbatim input lines, in order, plus omission notes', () => {
    const result = reduce(input, 300);
    expect(result.reducer).toBe('markdown-outline');
    expectVerbatimSubsequence(result.text, input);
  });

  it('keeps indentation byte-for-byte on the lines it keeps', () => {
    const kept = reduce(input, 600).text.split('\n');
    expect(kept).toContain('    """Return the weighted total for batch 0."""');
    expectVerbatimSubsequence(kept.join('\n'), input);
  });

  it('never returns empty text, even for a zero budget', () => {
    const result = reduce(input, 0);
    expect(result.text.trim().length).toBeGreaterThan(0);
    expectVerbatimSubsequence(result.text, input);
  });
});

describe('reduceMarkdown — never empty', () => {
  const lines = Array.from(
    { length: 50 },
    (_, i) => `Line ${i} of plain text with no heading at all.`,
  );

  it('returns plain text unchanged when no block fits', () => {
    const prose = lines.join('\n\n');
    const result = reduce(prose, 0);
    expect(result.text).toBe(prose);
    expect(result.reducer).toBe('markdown-unchanged');
  });

  it('keeps the head of text without headings when some blocks fit', () => {
    const prose = lines.join('\n\n');
    const result = reduce(prose, 60);
    expect(result.reducer).toBe('markdown-outline');
    expect(result.text.startsWith('Line 0 of plain text')).toBe(true);
    expect(result.text).toMatch(/\n\n\(\d+ lines omitted\)$/);
    expectVerbatimSubsequence(result.text, prose);
  });

  it('never splits one paragraph: a single over-budget paragraph is returned unchanged', () => {
    const prose = lines.join('\n');
    expect(reduce(prose, 60)).toEqual({
      text: prose,
      reducer: 'markdown-unchanged',
      notes: ['budget too small for any line'],
    });
  });

  it('returns under-budget input unchanged', () => {
    const doc = '# A\n\ntext\n\n## B\n\nmore';
    expect(reduce(doc, 2000)).toEqual(
      expect.objectContaining({ text: doc, reducer: 'markdown-unchanged' }),
    );
  });

  it('returns a document of headings only unchanged', () => {
    const doc = '# A\n## B\n### C';
    expect(reduce(doc, 1)).toEqual({
      text: doc,
      reducer: 'markdown-unchanged',
      notes: ['no section text to omit'],
    });
  });
});

describe('reduceMarkdown — headings', () => {
  const body = (n: number): string =>
    Array.from(
      { length: n },
      (_, i) => `body line ${i} with several words in it`,
    ).join('\n');

  const doc = [
    'Title',
    '=====',
    body(20),
    '## Second',
    body(20),
    // Blank line: otherwise the body paragraph joins the setext heading (CommonMark).
    '',
    'Sub heading',
    '-----------',
    body(20),
    '###### Sixth level',
    body(20),
    '#hashtag is not a heading',
    '    # indented code is not a heading',
  ].join('\n');

  it('keeps ATX and setext headings in order with their levels', () => {
    const result = reduce(doc, 60);
    expect(headingsOf(result.text)).toEqual([
      [1, 'Title'],
      [2, 'Second'],
      [2, 'Sub heading'],
      [6, 'Sixth level'],
    ]);
  });

  it('keeps headings only at budget 1; # lines inside paragraphs are not headings', () => {
    expect(reduce(doc, 1).text).toBe(
      [
        'Title',
        '=====',
        '## Second',
        'Sub heading',
        '-----------',
        '###### Sixth level',
        '',
        '(section text omitted, 82 lines)',
      ].join('\n'),
    );
  });

  it('does not treat a list item or a thematic break as a setext heading', () => {
    const list = ['# Real', '- item', '---', body(40), '', '---', body(40)].join(
      '\n',
    );
    expect(reduce(list, 1).text.split('\n')).toEqual([
      '# Real',
      '',
      expect.stringMatching(NOTE),
    ]);
  });

  it('keeps every heading and returns when the headings alone exceed the budget', () => {
    const headings = Array.from(
      { length: 40 },
      (_, i) => `## Heading number ${i} of the outline`,
    );
    const many = headings.map((h) => `${h}\n${body(3)}`).join('\n');
    const result = reduce(many, 50);
    const lines = result.text.split('\n');
    expect(lines.slice(0, 40)).toEqual(headings);
    expect(lines).toHaveLength(42);
    expect(lines[40]).toBe('');
    expect(lines[41]).toMatch(NOTE);
    expectVerbatimSubsequence(result.text, many);
  });
});

describe('reduceMarkdown — fenced code blocks', () => {
  const code = Array.from(
    { length: 20 },
    (_, i) => `  call(${i}); // inside the block`,
  );
  const filler = Array.from(
    { length: 30 },
    (_, i) => `after line ${i} of prose text`,
  ).join('\n');

  it('keeps a four-backtick block containing a triple-backtick line as one block', () => {
    const block = ['````md', '```', '# not a heading', '```', ...code, '````'];
    const doc = [
      '# Top',
      'intro line',
      ...block,
      filler,
      '# Next',
      'next line',
    ].join('\n');
    const result = reduce(doc, 80);
    expect(result.text.split('\n')).not.toContain('# not a heading');
    expect(headingsOf(result.text)).toEqual([
      [1, 'Top'],
      [1, 'Next'],
    ]);
  });

  it('replaces a code block that does not fit by its typed note and continues the section', () => {
    const block = ['````md', '```', '# not a heading', '```', ...code, '````'];
    const doc = ['# Top', 'intro line', ...block, '', 'tail line', '', filler].join(
      '\n',
    );
    expect(reduce(doc, 60).text).toBe(
      '# Top\nintro line\n\n(code block, 25 lines, omitted)\n\ntail line\n\n(30 lines omitted)',
    );
  });

  it('keeps a block whole, inner fences included, when it fits', () => {
    const block = ['````md', '```', '# not a heading', '```', '````'];
    const doc = ['# Top', 'intro line', ...block, filler].join('\n');
    const result = reduce(doc, 120);
    expect(result.text).toContain(block.join('\n'));
  });

  it('does not close a fence on another character, a shorter run, or a run with text after it', () => {
    const block = [
      '```',
      '~~~',
      '``',
      '``` not a close',
      '# still code',
      ...code,
      '```',
    ];
    const doc = ['# Top', ...block, '', 'tail'].join('\n');
    expect(reduce(doc, 60).text).toBe(
      '# Top\n\n(code block, 26 lines, omitted)\n\ntail',
    );
  });

  it('treats an unclosed fence as running to the end, so later # lines are code', () => {
    const doc = ['# Top', 'intro', '```', '# inside', filler].join('\n');
    const result = reduce(doc, 30);
    expect(headingsOf(result.text)).toEqual([[1, 'Top']]);
    expectVerbatimSubsequence(result.text, doc);
  });
});

describe('reduceMarkdown — block structure (review r1 inputs)', () => {
  it('S1: keeps the whole paragraph of a multi-line setext heading', () => {
    const doc = '# Intro\nDO NOT\ndelete production\n---\nbody';
    expect(reduce(doc, 1).text).toBe(
      '# Intro\nDO NOT\ndelete production\n---\n\n(section text omitted, 1 lines)',
    );
  });

  it('S2: a four-space-indented fence run does not close a top-level fence', () => {
    const run = ['```', 'code', '    ```', '# still code', '```'];
    const doc = ['# Top', ...run, '# Next', ...bodyLines(30)].join('\n');
    expect(reduce(doc, 30).text).toBe(
      '# Top\n\n(code block, 5 lines, omitted)\n\n# Next\n\n(30 lines omitted)',
    );
    expect(reduce(doc, 60).text).toContain(`# Top\n${run.join('\n')}\n# Next`);
  });

  it('S3: a fence opened on a list-item line stays inside the list', () => {
    const doc = [
      '# Top',
      '- ```',
      '  code',
      '  ```',
      '# Next',
      ...bodyLines(30),
    ].join('\n');
    expect(reduce(doc, 30).text).toBe(
      '# Top\n\n(list, 3 lines, omitted)\n\n# Next\n\n(30 lines omitted)',
    );
  });

  it('S4: a document with an HTML comment block is returned unchanged', () => {
    const doc = [
      '# Top',
      '<!--',
      '# NOT a heading',
      '-->',
      ...bodyLines(30),
      '# Next',
      'next',
    ].join('\n');
    for (const budgetTokens of [1, 30, 60, 400]) {
      expect(reduce(doc, budgetTokens)).toEqual({
        text: doc,
        reducer: 'markdown-unchanged',
        notes: ['HTML blocks present; not outlined'],
      });
    }
  });

  it('(a) does not promote a paragraph containing a list line before ---', () => {
    const doc = [
      '# Real',
      'intro text',
      '- item',
      '---',
      ...bodyLines(40),
    ].join('\n');
    expect(reduce(doc, 1).text.split('\n')).toEqual([
      '# Real',
      '',
      expect.stringMatching(NOTE),
    ]);
  });

  it.each([
    ['four spaces', '    ```'],
    ['a tab', '\t```'],
  ])('(e) keeps a fence indented by %s as indented code', (_label, fence) => {
    const doc = [
      '# Top',
      'intro',
      '',
      fence,
      '# x',
      fence,
      ...bodyLines(30),
    ].join('\n');
    for (const budgetTokens of [1, 30, 400]) {
      reduce(doc, budgetTokens);
    }
  });

  it('(f) keeps a fence at indent 2 with a less-indented content line as one block', () => {
    const doc = [
      '# Top',
      '  ```',
      'code',
      '# x',
      '  ```',
      ...bodyLines(30),
    ].join('\n');
    for (const budgetTokens of [1, 30, 400]) {
      expect(headingsOf(reduce(doc, budgetTokens).text)).toEqual([
        [1, 'Top'],
      ]);
    }
  });

  it('(g) keeps an indented fence under a list item as one unit', () => {
    const block = ['   ```bash', '   # comment', '   ```'];
    const doc = [
      '# Top',
      '1. Install:',
      '',
      ...block,
      ...bodyLines(30),
      '# Next',
      'next',
    ].join('\n');
    expect(reduce(doc, 1).text.split('\n')).toEqual([
      '# Top',
      '# Next',
      '',
      expect.stringMatching(NOTE),
    ]);
    for (const budgetTokens of [30, 60, 400]) {
      const text = reduce(doc, budgetTokens).text;
      if (text.includes(block[0])) {
        expect(text).toContain(block.join('\n'));
      } else {
        expect(text).not.toContain(block[1]);
      }
      expectVerbatimSubsequence(text, doc);
    }
  });
});

describe('reduceMarkdown — size and preserved content', () => {
  const doc = largeDoc();
  const budgetTokens = 2000;

  it('is a ~40 KB document with 30 sections', () => {
    expect(doc.text.length).toBeGreaterThan(36_000);
    expect(doc.text.length).toBeLessThan(46_000);
    expect(headingsOf(doc.text)).toHaveLength(doc.sections);
  });

  it('SIZE: fits the token budget', () => {
    const result = reduce(doc.text, budgetTokens);
    expect(result.reducer).toBe('markdown-outline');
    expect(countTokens(result.text)).toBeLessThanOrEqual(budgetTokens);
  });

  it('PRESERVED: every heading, and the first block under it, in order', () => {
    const result = reduce(doc.text, budgetTokens);
    const tokens = lex(result.text).filter((token) => token.type !== 'space');
    const headingAt = tokens.flatMap((token, i) =>
      token.type === 'heading' ? [i] : [],
    );
    expect(headingAt).toHaveLength(doc.sections);
    headingAt.forEach((at, s) => {
      expect(trimEnd(tokens[at + 1].raw)).toBe(doc.firstBlocks[s]);
    });
    expectVerbatimSubsequence(result.text, doc.text);
  });
});

describe('reduceMarkdown — cost on crafted input', () => {
  const n = 65_000;
  /** Crafted ~65,000-char lines; `true` when the container-prefix guard must stop them. */
  const crafted: Array<[string, string, boolean]> = [
    // A backtick in the rest makes each of these a plain line, not an opener.
    ['a backtick run then `x', '`'.repeat(n) + '`x', false],
    ['a fence, 65,000 spaces, then `x', '```' + ' '.repeat(n) + '`x', false],
    // `.` stops at U+2028 and a lone CR, so a `(.*)$` after the run would
    // backtrack through all 65,000 backticks (the Batch 2a r3 finding).
    [
      'a backtick run then U+2028',
      '`'.repeat(n) + String.fromCharCode(0x2028) + '`',
      false,
    ],
    ['a backtick run then a lone CR', '`'.repeat(n) + '\r`', false],
    ['65,000 spaces then x', ' '.repeat(n) + 'x', false],
    ['65,000 spaces then a fence run', ' '.repeat(n) + '```', false],
    ['a hash run then x', '#'.repeat(n) + 'x', false],
    ['an = underline run', 'paragraph\n' + '='.repeat(n) + 'x', false],
    [
      'a long tilde fence closed by a longer run',
      '~'.repeat(n) + ' info\ncode\n' + '~'.repeat(n + 3),
      false,
    ],
    ['a - underline run', 'paragraph\n' + '-'.repeat(n) + 'x', true],
    ['a list marker then 65,000 spaces', '- ' + ' '.repeat(n), true],
  ];

  it.each(crafted)('handles %s quickly', (_label, line, guarded) => {
    const doc = ['# Start', 'intro', line, '## End', 'outro'].join('\n');
    expect(doc.length).toBeLessThanOrEqual(262_144);
    const lexed = jest.spyOn(Lexer.prototype, 'blockTokens');
    countTokens('warm up the encoder');
    const start = performance.now();
    const result = reduce(doc, 4000);
    const elapsed = performance.now() - start;
    expect(lexed.mock.calls.length > 0).toBe(!guarded);
    expect(
      (result.notes ?? []).includes(
        'container nesting too deep to outline safely',
      ),
    ).toBe(guarded);
    expectVerbatimSubsequence(result.text, doc);
    expect(elapsed).toBeLessThan(250);
  });

  it('returns every crafted line in one document unchanged by the size cap, quickly', () => {
    const doc = ['# Start', 'intro', ...crafted.map(([, line]) => line)].join(
      '\n',
    );
    expect(doc.length).toBeGreaterThan(262_144);
    const start = performance.now();
    const result = reduce(doc, 4000);
    expect(performance.now() - start).toBeLessThan(250);
    expect(result.notes).toEqual(['input larger than 256 KiB; not outlined']);
  });

  /**
   * Bound for one reduction at the size cap. The slowest lexed family, the
   * 16-level list below, measured (Node 24, this machine, unspied) 363-469 ms
   * per run when idle and 746-1,093 ms under parallel load; lexing alone was
   * 327-439 ms idle. With the fastest of three runs this leaves about 2x over
   * the loaded minimum and 4x over the idle one.
   */
  const MAX_CAP_MS = 1500;

  /**
   * The fastest of three unspied runs: one slow run under a loaded machine
   * (the parallel Nx targets) or a recursive `blockTokens` spy says nothing
   * about the reducer, while three slow runs do.
   */
  function timedReduce(doc: string): { result: ReduceResult; elapsed: number } {
    countTokens('warm up the encoder');
    let elapsed = Infinity;
    let result: ReduceResult | undefined;
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      result = reduceMarkdown(doc, { budgetTokens: 2000 });
      elapsed = Math.min(elapsed, performance.now() - start);
    }
    return { result: result as ReduceResult, elapsed };
  }

  it('lexes a 256 KiB list-heavy document within the cap bound', () => {
    const line = '- '.repeat(16) + 'x\n';
    const doc = '# Top\n\n' + line.repeat(Math.floor((262_144 - 7) / line.length));
    expect(doc.length).toBeLessThanOrEqual(262_144);
    expect(doc.length).toBeGreaterThan(262_144 - line.length);
    const { result, elapsed } = timedReduce(doc);
    // An outline can only come from the lexed tokens.
    expectValidResult(result, doc);
    expect(result.reducer).toBe('markdown-outline');
    expect(elapsed).toBeLessThan(MAX_CAP_MS);
  });

  const lazyQuoteNote = 'block quote continuation too costly to outline safely';
  /** [label, first lines, repeated unit, whether the lazy-quote guard stops it] */
  const families: Array<[string, string, string, boolean]> = [
    ['lazy block quote', '# A\n', '> x\nx\n', true],
    ['lazy nested block quote', '# A\n', '> > x\n> x\n', true],
    // Each `- ` line is a new top-level item, which ends the quote before it.
    ['block quote with lazy text in each list item', '# A\n', '- > x\n  x\n', false],
    ['lazy list in a block quote', '# A\n', '> - x\nx\n', true],
    ['plain block quote', '# A\n', '> x\n', false],
    ['list with lazy continuation', '# A\n', '- x\nx\n', false],
    ['nested quote-list', '# A\n', '> - x\n', false],
    ['one long paragraph', '# A\n', 'x\n', false],
    ['table rows', '# A\n| a | b |\n| - | - |\n', '| a | b |\n', false],
  ];

  it.each(families)(
    'finishes a %s at the size cap within the cap bound',
    (_label, head, unit, guarded) => {
      const doc =
        head + unit.repeat(Math.floor((262_144 - head.length) / unit.length));
      expect(doc.length).toBeLessThanOrEqual(262_144);
      expect(doc.length).toBeGreaterThan(262_144 - unit.length);
      const { result, elapsed } = timedReduce(doc);
      expectValidResult(result, doc);
      if (guarded) {
        expect(result.notes).toEqual([lazyQuoteNote]);
        const lexed = jest.spyOn(Lexer.prototype, 'blockTokens');
        reduceMarkdown(doc, { budgetTokens: 2000 });
        expect(lexed).not.toHaveBeenCalled();
      } else {
        expect(result.reducer).toBe('markdown-outline');
      }
      expect(elapsed).toBeLessThan(MAX_CAP_MS);
    },
  );
});
