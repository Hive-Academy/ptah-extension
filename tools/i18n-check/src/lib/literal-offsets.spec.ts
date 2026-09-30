import * as ts from 'typescript';
import { decodeLiteral } from './literal-offsets';

/** The TypeScript scanner's decoded text for a literal written as `source`. */
const compilerText = (source: string): string => {
  const file = ts.createSourceFile(
    'l.ts',
    `x = ${source};`,
    ts.ScriptTarget.ESNext,
    true,
  );
  const statement = file.statements[0] as ts.ExpressionStatement;
  const literal = (statement.expression as ts.BinaryExpression).right as
    ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
  return literal.text;
};

describe('decodeLiteral', () => {
  it.each([
    ['plain text', '`<p>{{ a }}</p>`'],
    ['single-character escapes', String.raw`'a\nb\tc\\d\'e\"f\bg\fh\vi\rj'`],
    ['hex and unicode escapes', String.raw`'\x41\u0042\u{43}\u{1F600}'`],
    ['legacy octal and \\0', String.raw`'\0\101\7\48\8'`],
    ['identity escapes in a template', String.raw`${'`'}\$\`\{${'`'}`],
    ['a line continuation', "'a\\\nb'"],
    ['a CRLF line continuation', "'a\\\r\nb'"],
    ['CRLF and CR in a template', '`a\r\nb\rc`'],
    ['non-BMP characters', "'😀 x'"],
  ])('reproduces the compiler text for %s', (_name, source) => {
    const raw = source.slice(1, -1);
    const decoded = decodeLiteral(raw, 0);
    expect(decoded.text).toBe(compilerText(source));
    expect(decoded.offsets).toHaveLength(decoded.text.length + 1);
  });

  it('maps every decoded unit to the offset of the source that produced it', () => {
    const raw = String.raw`A\u0042C\nD`;
    const { text, offsets } = decodeLiteral(raw, 100);
    expect(text).toBe('ABC\nD');
    expect(offsets).toEqual([
      100, // A
      101, // B
      107, // C
      108, // \n
      110, // D
      111, // end
    ]);
  });

  it('maps both units of an escaped astral code point to the escape', () => {
    const { text, offsets } = decodeLiteral(String.raw`\u{1F600}x`, 0);
    expect(text).toBe('😀x');
    expect(offsets).toEqual([0, 0, 9, 10]);
  });

  it('decodes a line continuation to nothing', () => {
    const { text, offsets } = decodeLiteral('a\\\nb', 0);
    expect(text).toBe('ab');
    expect(offsets).toEqual([0, 3, 4]);
  });

  it('throws on a malformed escape instead of guessing', () => {
    expect(() => decodeLiteral(String.raw`\xZZ`, 0)).toThrow(/hex escape/);
    expect(() => decodeLiteral(String.raw`\u{41`, 0)).toThrow(/unterminated/);
    expect(() => decodeLiteral('a\\', 0)).toThrow(/unterminated escape/);
  });
});
