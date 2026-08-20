import {
  highlightLine,
  resolveLanguageFamily,
  tokensToText,
  type CodeToken,
} from './code-highlight.js';

function kinds(tokens: readonly CodeToken[]): string[] {
  return tokens.map((token) => token.kind);
}

describe('resolveLanguageFamily', () => {
  it('maps aliases onto families', () => {
    expect(resolveLanguageFamily('ts')).toBe('c-like');
    expect(resolveLanguageFamily('TSX')).toBe('c-like');
    expect(resolveLanguageFamily('py')).toBe('python');
    expect(resolveLanguageFamily('bash')).toBe('shell');
    expect(resolveLanguageFamily('json')).toBe('json');
  });

  it('falls back to plain for an unknown or absent language', () => {
    expect(resolveLanguageFamily('')).toBe('plain');
    expect(resolveLanguageFamily('brainfuck')).toBe('plain');
  });
});

describe('highlightLine', () => {
  it('marks keywords, strings and numbers in a c-like line', () => {
    const tokens = highlightLine('const a = "hi" + 42;', 'ts');
    expect(kinds(tokens)).toEqual([
      'keyword',
      'plain',
      'string',
      'plain',
      'number',
      'plain',
    ]);
    expect(tokens[0]).toEqual({ kind: 'keyword', text: 'const' });
    expect(tokens[2]).toEqual({ kind: 'string', text: '"hi"' });
    expect(tokens[4]).toEqual({ kind: 'number', text: '42' });
  });

  it('takes a line comment to end of line', () => {
    const tokens = highlightLine('let x = 1; // trailing const "note"', 'ts');
    expect(tokens[tokens.length - 1]).toEqual({
      kind: 'comment',
      text: '// trailing const "note"',
    });
  });

  it('uses # comments for python and shell but not for c-like', () => {
    expect(kinds(highlightLine('# note', 'py'))).toEqual(['comment']);
    expect(kinds(highlightLine('# note', 'bash'))).toEqual(['comment']);
    expect(kinds(highlightLine('# note', 'ts'))).not.toContain('comment');
  });

  it('honours escaped quotes inside a string', () => {
    const tokens = highlightLine('a = "he said \\"hi\\"" ;', 'ts');
    expect(tokens.find((t) => t.kind === 'string')).toEqual({
      kind: 'string',
      text: '"he said \\"hi\\""',
    });
  });

  it('colours an unclosed quote to end of line rather than giving up', () => {
    const tokens = highlightLine('const s = "half written', 'ts');
    expect(tokens[tokens.length - 1]).toEqual({
      kind: 'string',
      text: '"half written',
    });
  });

  it('recognises python and shell keywords in their own families only', () => {
    expect(kinds(highlightLine('def f():', 'py'))[0]).toBe('keyword');
    expect(kinds(highlightLine('def f():', 'ts'))[0]).toBe('plain');
    expect(kinds(highlightLine('done', 'bash'))[0]).toBe('keyword');
  });

  it('leaves an unknown language as plain text with strings and numbers only', () => {
    const tokens = highlightLine('const a = 1', 'brainfuck');
    expect(kinds(tokens)).not.toContain('keyword');
    expect(kinds(tokens)).toContain('number');
  });

  it('never loses or reorders a character', () => {
    const samples: readonly [string, string][] = [
      ['const a = "hi" + 42; // note', 'ts'],
      ['def f(x): return x ** 2  # square', 'py'],
      ['echo "$HOME" && ls -la # list', 'bash'],
      ['{ "a": 1, "b": null }', 'json'],
      ['   ', 'ts'],
      ['', 'ts'],
      ['\\\\weird\\\\', 'brainfuck'],
    ];
    for (const [line, language] of samples) {
      expect(tokensToText(highlightLine(line, language))).toBe(line);
    }
  });

  it('produces no tokens for an empty line', () => {
    expect(highlightLine('', 'ts')).toEqual([]);
  });
});
