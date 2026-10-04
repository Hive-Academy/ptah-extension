import { segmentPtahUi } from './ptah-ui-fence';

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
