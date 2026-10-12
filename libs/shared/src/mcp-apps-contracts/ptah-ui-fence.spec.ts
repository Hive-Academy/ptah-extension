import { segmentPtahUi } from './ptah-ui-fence';
import { SURFACE_LIMITS } from './surface-catalog';

describe('segmentPtahUi', () => {
  it('segments a closed ptah-ui fence and preserves its raw body', () => {
    expect(segmentPtahUi('Before\n```ptah-ui\ntitle Hi\n```\nAfter')).toEqual([
      { kind: 'markdown', key: 'markdown-0', text: 'Before\n' },
      {
        kind: 'fence',
        key: 'fence-0',
        ordinal: 0,
        raw: '```ptah-ui\ntitle Hi\n```\n',
        body: 'title Hi\n',
      },
      { kind: 'markdown', key: 'markdown-2', text: 'After' },
    ]);
  });

  it('accepts CRLF and trailing spaces on target fence lines', () => {
    const [segment] = segmentPtahUi('```ptah-ui   \r\ntitle Hi\r\n```   \r\n');
    expect(segment).toMatchObject({ kind: 'fence', body: 'title Hi\r\n' });
  });

  it('accepts a CommonMark-indented target closer without swallowing prose', () => {
    expect(segmentPtahUi('```ptah-ui\nstats\n  A | 1\n  ```\nafter\n')).toEqual(
      [
        {
          kind: 'fence',
          key: 'fence-0',
          ordinal: 0,
          raw: '```ptah-ui\nstats\n  A | 1\n  ```\n',
          body: 'stats\n  A | 1\n',
        },
        { kind: 'markdown', key: 'markdown-1', text: 'after\n' },
      ],
    );
  });

  it('does not accept a four-space-indented target closer', () => {
    const text = '```ptah-ui\nstats\n  A | 1\n    ```\nafter\n';
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });

  it('does not treat a target fence inside a backtick outer fence as a block', () => {
    const text = '````markdown\n```ptah-ui\ntitle Hi\n```\n````\n';
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });

  it('does not treat a target fence inside a tilde outer fence as a block', () => {
    const text = '~~~\n```ptah-ui\ntitle Hi\n```\n~~~\n';
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });

  it('does not treat a target fence inside a two-space indented outer fence as a block', () => {
    const text = '  ~~~\n```ptah-ui\ntitle Hi\n```\n  ~~~\n';
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });

  it('recognizes a three-space indented outer fence', () => {
    const text = '   ```\n```ptah-ui\ntitle Hi\n```\n   ```\n';
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });

  it('does not treat a four-space indented line as an outer opener', () => {
    const text = '    ```\n```ptah-ui\ntitle Hi\n```\n';
    expect(segmentPtahUi(text)).toMatchObject([
      { kind: 'markdown', text: '    ```\n' },
      { kind: 'fence', body: 'title Hi\n' },
    ]);
  });

  it('requires an outer close to use the opening marker and enough characters', () => {
    const text = '````\n~~~\n```ptah-ui\ntitle Hi\n```\n````\n';
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });

  it('keeps an unclosed ptah-ui fence as markdown for streaming', () => {
    const text = 'Start\n```ptah-ui\ntitle Still streaming\n';
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });
});

describe('segmentPtahUi display openers (R2.1)', () => {
  it('marks a closed `ptah-ui display` fence as a display target without an id', () => {
    expect(segmentPtahUi('```ptah-ui display\ntitle Hi\n```\n')).toEqual([
      {
        kind: 'fence',
        key: 'fence-0',
        ordinal: 0,
        raw: '```ptah-ui display\ntitle Hi\n```\n',
        body: 'title Hi\n',
        target: 'display',
      },
    ]);
  });

  it('carries the id of a closed `ptah-ui display <id>` fence', () => {
    const [segment] = segmentPtahUi(
      '```ptah-ui display review.summary_1-a\nnote info Hi\n```',
    );
    expect(segment).toEqual({
      kind: 'fence',
      key: 'fence-0',
      ordinal: 0,
      raw: '```ptah-ui display review.summary_1-a\nnote info Hi\n```',
      body: 'note info Hi\n',
      target: 'display',
      displayId: 'review.summary_1-a',
    });
  });

  it('keeps an inline fence free of target fields', () => {
    const [segment] = segmentPtahUi('```ptah-ui\ntitle Hi\n```\n');
    expect(segment).not.toHaveProperty('target');
    expect(segment).not.toHaveProperty('displayId');
  });

  it('accepts CRLF and trailing spaces on a display opener', () => {
    const [segment] = segmentPtahUi(
      '```ptah-ui display panel-1   \r\ntitle Hi\r\n```  \r\n',
    );
    expect(segment).toMatchObject({
      kind: 'fence',
      target: 'display',
      displayId: 'panel-1',
      body: 'title Hi\r\n',
    });
  });

  it('accepts an id of exactly the maximum surface id length', () => {
    const id = 'a'.repeat(SURFACE_LIMITS.maxSurfaceIdLength);
    const [segment] = segmentPtahUi(
      `\`\`\`ptah-ui display ${id}\ntitle Hi\n\`\`\`\n`,
    );
    expect(segment).toMatchObject({ kind: 'fence', displayId: id });
  });

  it('accepts the reserved-looking `ptah.` id for the pipeline to reject', () => {
    const [segment] = segmentPtahUi(
      '```ptah-ui display ptah.turn\ntitle Hi\n```\n',
    );
    expect(segment).toMatchObject({
      target: 'display',
      displayId: 'ptah.turn',
    });
  });

  it('numbers inline and display fences in one ordinal sequence', () => {
    const segments = segmentPtahUi(
      '```ptah-ui\ntitle A\n```\nmid\n```ptah-ui display x\ntitle B\n```\n```ptah-ui display\ntitle C\n```\n',
    );
    expect(
      segments
        .filter((segment) => segment.kind === 'fence')
        .map((segment) =>
          segment.kind === 'fence'
            ? [segment.ordinal, segment.target ?? 'inline', segment.displayId]
            : [],
        ),
    ).toEqual([
      [0, 'inline', undefined],
      [1, 'display', 'x'],
      [2, 'display', undefined],
    ]);
  });

  it.each([
    ['an unknown target', '```ptah-ui sidebar'],
    ['two ids', '```ptah-ui display a b'],
    ['two spaces before display', '```ptah-ui  display'],
    ['two spaces before the id', '```ptah-ui display  a'],
    ['an uppercase keyword', '```ptah-ui Display'],
    ['a glued keyword', '```ptah-uidisplay'],
    ['a glued id', '```ptah-ui displaya'],
    ['an id starting with a dot', '```ptah-ui display .a'],
    ['an id with a slash', '```ptah-ui display a/b'],
    ['an id with a colon', '```ptah-ui display v1:a'],
    [
      'an id one over the maximum length',
      `\`\`\`ptah-ui display ${'a'.repeat(SURFACE_LIMITS.maxSurfaceIdLength + 1)}`,
    ],
    ['an indented opener', ' ```ptah-ui display'],
    ['a tilde opener', '~~~ptah-ui display'],
  ])('keeps %s as an ordinary code block', (_name, opener) => {
    const text = `${opener}\ntitle Hi\n\`\`\`\nafter\n`;
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });

  it('keeps an unclosed display fence as markdown while streaming', () => {
    const text = 'Start\n```ptah-ui display live\nstats\n  A | 1\n';
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });

  it('yields the block once the closing fence arrives, and only then', () => {
    const streaming = 'Intro\n```ptah-ui display live\nnote ok Done\n';
    expect(segmentPtahUi(streaming).some((s) => s.kind === 'fence')).toBe(
      false,
    );
    expect(segmentPtahUi(`${streaming}\`\`\`\nMore text`)).toMatchObject([
      { kind: 'markdown', text: 'Intro\n' },
      { kind: 'fence', ordinal: 0, displayId: 'live', body: 'note ok Done\n' },
      { kind: 'markdown', text: 'More text' },
    ]);
  });

  it('keeps a closed block and an unclosed display fence after it apart', () => {
    const text =
      '```ptah-ui display a\ntitle A\n```\n```ptah-ui display a\ntitle B\n';
    expect(segmentPtahUi(text)).toMatchObject([
      { kind: 'fence', ordinal: 0, displayId: 'a', body: 'title A\n' },
      { kind: 'markdown', text: '```ptah-ui display a\ntitle B\n' },
    ]);
  });

  it('does not treat a display fence inside an outer fence as a block', () => {
    const text = '````markdown\n```ptah-ui display x\ntitle Hi\n```\n````\n';
    expect(segmentPtahUi(text)).toEqual([
      { kind: 'markdown', key: 'markdown-0', text },
    ]);
  });
});
