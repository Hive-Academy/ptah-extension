import { WROTE_SCAN_MAX_CHARS, parseWroteLines } from './wrote-lines.parser';

const EM = '\u2014';

describe('parseWroteLines', () => {
  it('reads absolute and relative paths and keeps first-seen order', () => {
    const message = [
      'finished the task',
      'WROTE: /abs/file.md',
      'WROTE: rel/file.md',
      'WROTE: /abs/file.md',
    ].join('\n');
    expect(parseWroteLines(message)).toEqual({
      paths: ['/abs/file.md', 'rel/file.md'],
    });
  });

  it('reads the same paths split by CRLF', () => {
    expect(
      parseWroteLines('WROTE: /abs/a.md\r\nWROTE: rel/b.md\r\n'),
    ).toEqual({ paths: ['/abs/a.md', 'rel/b.md'] });
  });

  it('cuts an em-dash suffix and stops an unwrapped path at whitespace', () => {
    expect(parseWroteLines(`WROTE: /abs/file.md ${EM} headline`)).toEqual({
      paths: ['/abs/file.md'],
    });
    expect(parseWroteLines(`WROTE: /abs/file.md ${EM} one ${EM} two`)).toEqual({
      paths: ['/abs/file.md'],
    });
    expect(parseWroteLines('WROTE: /abs/file.md - stays')).toEqual({
      paths: ['/abs/file.md'],
    });
  });

  it('drops a prose suffix and keeps spaces only inside a wrapper', () => {
    expect(
      parseWroteLines(
        'WROTE: /abs/path/batches.md. Verdict: DECOMPOSITION COMPLETE, ...',
      ),
    ).toEqual({ paths: ['/abs/path/batches.md'] });
    expect(parseWroteLines('WROTE: /abs/a.md + one-line verdict')).toEqual({
      paths: ['/abs/a.md'],
    });
    expect(parseWroteLines('WROTE: /abs/a.md - 5 components')).toEqual({
      paths: ['/abs/a.md'],
    });
    expect(parseWroteLines('WROTE: /abs/a.md (revised)')).toEqual({
      paths: ['/abs/a.md'],
    });
    expect(
      parseWroteLines(`WROTE: \`/abs/My Folder/a.md\` ${EM} ok`),
    ).toEqual({ paths: ['/abs/My Folder/a.md'] });
  });

  it('strips one wrapping backtick or quote pair', () => {
    expect(parseWroteLines('WROTE: `/abs/back.md`')).toEqual({
      paths: ['/abs/back.md'],
    });
    expect(parseWroteLines('`WROTE: /abs/line.md`')).toEqual({
      paths: ['/abs/line.md'],
    });
    expect(
      parseWroteLines(`\`WROTE: /abs/both.md ${EM} headline\``),
    ).toEqual({ paths: ['/abs/both.md'] });
    expect(parseWroteLines('WROTE: "/abs/double.md"')).toEqual({
      paths: ['/abs/double.md'],
    });
    expect(parseWroteLines("WROTE: '/abs/single.md'")).toEqual({
      paths: ['/abs/single.md'],
    });
    expect(
      parseWroteLines(`WROTE: "/abs/quoted.md" ${EM} headline`),
    ).toEqual({ paths: ['/abs/quoted.md'] });
  });

  it('collapses duplicates and ignores a lowercase prefix', () => {
    expect(
      parseWroteLines('WROTE: /a\nWROTE: "/a"\nWROTE: /b\nWROTE: /a\nwrote: /c'),
    ).toEqual({ paths: ['/a', '/b'] });
    expect(parseWroteLines('wrote: /only')).toEqual({ refusal: 'none' });
  });

  it('returns none when no line matches', () => {
    expect(parseWroteLines('')).toEqual({ refusal: 'none' });
    expect(parseWroteLines('team leader returned prose')).toEqual({
      refusal: 'none',
    });
    expect(parseWroteLines('- WROTE: /not-at-start')).toEqual({
      refusal: 'none',
    });
  });

  it('returns too-many for 21 distinct paths and accepts 20', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `WROTE: /p/${i}`);
    expect(parseWroteLines(twenty.join('\n'))).toEqual({
      paths: twenty.map((_, i) => `/p/${i}`),
    });
    expect(
      parseWroteLines([...twenty, 'WROTE: /p/20'].join('\n')),
    ).toEqual({ refusal: 'too-many' });
    const repeated = Array.from({ length: 21 }, () => 'WROTE: /same');
    expect(parseWroteLines(repeated.join('\n'))).toEqual({ paths: ['/same'] });
  });

  it('returns malformed for an empty path, a NUL, or more than 1024 characters', () => {
    const max = `/${'a'.repeat(1023)}`;
    const over = `/${'a'.repeat(1024)}`;
    expect(max).toHaveLength(1024);
    expect(over).toHaveLength(1025);
    expect(parseWroteLines(`WROTE: ${max}`)).toEqual({ paths: [max] });
    expect(parseWroteLines(`WROTE: ${over}`)).toEqual({ refusal: 'malformed' });
    expect(parseWroteLines('WROTE:')).toEqual({ refusal: 'malformed' });
    expect(parseWroteLines('WROTE:    ')).toEqual({ refusal: 'malformed' });
    expect(parseWroteLines('WROTE: /tmp/a\0b')).toEqual({ refusal: 'malformed' });
    expect(parseWroteLines('WROTE: /ok\nWROTE: \nWROTE: /also')).toEqual({
      refusal: 'malformed',
    });
  });

  it('ignores a WROTE line that ends before the scan window', () => {
    const kept = 'WROTE: /inside';
    const filler = 'x'.repeat(WROTE_SCAN_MAX_CHARS);
    const message = `WROTE: /before-window\n${filler}\n${kept}`;
    expect(message.length).toBeGreaterThan(WROTE_SCAN_MAX_CHARS);
    expect(parseWroteLines(message)).toEqual({ paths: ['/inside'] });
    const onlyBefore = `WROTE: /before-window\n${'y'.repeat(WROTE_SCAN_MAX_CHARS)}`;
    expect(parseWroteLines(onlyBefore)).toEqual({ refusal: 'none' });
  });
});
