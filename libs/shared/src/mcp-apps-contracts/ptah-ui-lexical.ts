/** Lexical rules of the ptah-ui grammar: lines, cells, escapes, numbers, names and failures. */
import type {
  PtahUiParseFailure,
  PtahUiParseFailureCode,
} from './ptah-ui.types';

export type ParseFailure = {
  readonly ok: false;
  readonly failure: PtahUiParseFailure;
};
export type Step = { readonly ok: true } | ParseFailure;
export type ValueResult<T> =
  { readonly ok: true; readonly value: T } | ParseFailure;

export function splitLines(body: string): string[] {
  const lines = body.split(/\r\n|\n/).map(removeTrailingSpaces);
  return body.endsWith('\n') ? lines.slice(0, -1) : lines;
}
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}
function removeTrailingSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === ' ') end -= 1;
  return value.slice(0, end);
}
export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
export function leadingSpaces(line: string): number {
  let count = 0;
  while (line[count] === ' ') count += 1;
  return count;
}
export function headerText(line: string, keyword: string): string | undefined {
  if (!line.startsWith(`${keyword} `) || line.startsWith(`${keyword}  `))
    return undefined;
  return decodeText(line.slice(keyword.length + 1).trim());
}
/** Splits indentation-free `content` on unescaped pipes. */
export function parseCells(
  content: string,
  allowSourceFinal = false,
):
  | { ok: true; value: string[]; bareDollar: boolean[] }
  | { ok: false; message: string } {
  const cells: string[] = [];
  const bareDollar: boolean[] = [];
  let current = '';
  let hasBareDollar = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '\\') {
      const next = content[index + 1];
      if (next !== '|' && next !== '\\' && next !== '$')
        return { ok: false, message: 'invalid escape sequence' };
      current += next;
      index += 1;
    } else if (char === '|') {
      cells.push(current.trim());
      bareDollar.push(hasBareDollar);
      current = '';
      hasBareDollar = false;
    } else if (char === '$') {
      if (allowSourceFinal && current.trim() === '') hasBareDollar = true;
      current += char;
    } else current += char;
  }
  cells.push(current.trim());
  bareDollar.push(hasBareDollar);
  return { ok: true, value: cells, bareDollar };
}
export function decodeText(value: string): string | undefined {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\\') {
      output += value[index];
      continue;
    }
    const next = value[index + 1];
    if (next !== '|' && next !== '\\' && next !== '$') return undefined;
    output += next;
    index += 1;
  }
  return output;
}
export function includes<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return (values as readonly string[]).includes(value);
}
/** A source field or column name: lowercase start, camelCase (`atLimit`). */
export function isName(value: string): boolean {
  return /^[a-z][A-Za-z]*$/.test(value);
}
export function isNumber(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}
export function isUnsignedDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}
export function failure(
  code: 'too-large' | 'too-many-lines' | 'syntax',
  message: string,
): ParseFailure {
  return { ok: false, failure: { code, message } };
}
export function failureAt(
  code: PtahUiParseFailureCode,
  message: string,
  line: number,
): ParseFailure {
  return {
    ok: false,
    failure: { code, message: `${message} (line ${line})`, line },
  };
}
/** An indentation failure naming the line and the depth the parser expected. */
export function depthFailure(
  message: string,
  line: number,
  expectedDepth: number,
): ParseFailure {
  return {
    ok: false,
    failure: {
      code: 'depth',
      message: `${message} (line ${line}, expected depth ${expectedDepth})`,
      line,
    },
  };
}
/** A budget failure in the validator's limit words, e.g. `maxTreeDepth (8) exceeded`. */
export function limitFailureAt(
  limit: string,
  value: number,
  line: number,
): ParseFailure {
  return failureAt('limit', `${limit} (${value}) exceeded`, line);
}
