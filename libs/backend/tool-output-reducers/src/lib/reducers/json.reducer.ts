/**
 * JSON compactor (TASK_2026_559, User Decision 7).
 *
 * For an object or array document: drop empty fields, serialise without
 * pretty-printing, and render arrays of similar objects as pipe tables.
 *
 * Safety contract:
 * - input that `JSON.parse` rejects is returned byte-for-byte (`json-invalid`);
 * - a scalar document, a document that prunes to nothing, or one whose parse
 *   would lose information (a number that does not round-trip, a repeated
 *   key) is returned byte-for-byte (`json-unchanged`);
 * - only object fields whose value is `null`, `""`, `[]` or `{}` are dropped;
 *   array elements keep their positions, and `0`/`false` are never dropped;
 * - a table has one row per array element and one column per key, so two
 *   rows or two keys never share a cell.
 */
import type { OutputReducer, ReduceResult } from '../reducer.types';

type JsonObject = { [key: string]: JsonValue };
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

interface Table {
  readonly path: string;
  readonly rows: readonly JsonObject[];
  readonly keys: readonly string[];
}

const MIN_TABLE_ROWS = 3;
const MIN_SHARED_KEY_RATIO = 0.5;

const JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const JSON_NUMBER_WHOLE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const NUMBER_PARTS = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/** U+2028 / U+2029, built from char codes so no literal separator sits in source. */
const LINE_SEPARATORS = new RegExp(
  `[${String.fromCharCode(0x2028, 0x2029)}]`,
  'g',
);

export const reduceJson: OutputReducer = (input) => {
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(source) as JsonValue;
  } catch {
    // Not JSON (a log, Markdown, source code, a truncated payload): the
    // contract is to hand it back untouched.
    return { text: input, reducer: 'json-invalid' };
  }
  try {
    return compact(input, source, parsed);
  } catch (error) {
    // Only a pathologically deep document (JSON.parse is iterative, the
    // recursive walk below is not) exhausts the stack; keep the input.
    if (error instanceof RangeError) {
      return unchanged(input, 'nesting too deep to compact');
    }
    throw error;
  }
};

function compact(
  input: string,
  source: string,
  parsed: JsonValue,
): ReduceResult {
  if (!isContainer(parsed)) {
    return unchanged(input, 'scalar document');
  }
  const loss = parseLoss(source);
  if (loss !== undefined) {
    return unchanged(input, loss);
  }
  const counter = { dropped: 0 };
  const pruned = prune(parsed, counter);
  if (isEmpty(pruned)) {
    return unchanged(input, 'nothing left after dropping empty fields');
  }

  const tables: Table[] = [];
  const remainder = extractTables(pruned, '$', tables);
  const sections: string[] = [];
  if (remainder !== undefined) {
    sections.push(JSON.stringify(remainder));
  }
  for (const table of tables) {
    sections.push(renderTable(table));
  }
  const text = sections.join('\n');
  if (text.length >= input.length) {
    return unchanged(input, 'compaction would not shrink the input');
  }

  const notes: string[] = [];
  if (counter.dropped > 0) {
    notes.push(`dropped ${counter.dropped} empty field(s)`);
  }
  if (tables.length > 0) {
    notes.push(`rendered ${tables.length} array(s) of objects as tables`);
  }
  return { text, reducer: 'json-compact', notes };
}

function unchanged(input: string, note: string): ReduceResult {
  return { text: input, reducer: 'json-unchanged', notes: [note] };
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContainer(value: JsonValue): value is JsonObject | JsonValue[] {
  return typeof value === 'object' && value !== null;
}

function isEmpty(value: JsonValue): boolean {
  if (value === null || value === '') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return isObject(value) && Object.keys(value).length === 0;
}

/** A fresh object with no prototype, so a `__proto__` key stays plain data. */
function newObject(): JsonObject {
  return Object.create(null) as JsonObject;
}

/**
 * Drop empty object fields, recursively. Array elements are pruned inside but
 * never removed: removing one would shift every later index.
 */
function prune(value: JsonValue, counter: { dropped: number }): JsonValue {
  if (Array.isArray(value)) {
    return value.map((element) => prune(element, counter));
  }
  if (!isObject(value)) {
    return value;
  }
  const out = newObject();
  for (const [key, child] of Object.entries(value)) {
    const kept = prune(child, counter);
    if (isEmpty(kept)) {
      counter.dropped++;
    } else {
      out[key] = kept;
    }
  }
  return out;
}

/**
 * Move every table-shaped array reachable from the root through object
 * fields into `tables` (document order) and return what is left, or
 * `undefined` when nothing is. Arrays nested in arrays stay inline: lifting
 * them out would lose their position.
 */
function extractTables(
  value: JsonValue,
  path: string,
  tables: Table[],
): JsonValue | undefined {
  const table = asTable(value, path);
  if (table) {
    tables.push(table);
    return undefined;
  }
  if (!isObject(value)) {
    return value;
  }
  const out = newObject();
  let kept = 0;
  for (const [key, child] of Object.entries(value)) {
    const rest = extractTables(child, childPath(path, key), tables);
    if (rest !== undefined) {
      out[key] = rest;
      kept++;
    }
  }
  return kept > 0 ? out : undefined;
}

/**
 * An array of at least MIN_TABLE_ROWS objects whose keys present in every row
 * make up at least MIN_SHARED_KEY_RATIO of all keys.
 */
function asTable(value: JsonValue, path: string): Table | undefined {
  if (!Array.isArray(value) || value.length < MIN_TABLE_ROWS) {
    return undefined;
  }
  if (!value.every(isObject)) {
    return undefined;
  }
  const rows = value as JsonObject[];
  const keys: string[] = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const count = counts.get(key);
      if (count === undefined) {
        keys.push(key);
      }
      counts.set(key, (count ?? 0) + 1);
    }
  }
  const shared = keys.filter((key) => counts.get(key) === rows.length).length;
  if (keys.length === 0 || shared / keys.length < MIN_SHARED_KEY_RATIO) {
    return undefined;
  }
  return { path, rows, keys };
}

function renderTable(table: Table): string {
  const lines = [
    `${table.path} (${table.rows.length} rows):`,
    tableRow(table.keys.map(renderString)),
    `|${'---|'.repeat(table.keys.length)}`,
  ];
  for (const row of table.rows) {
    lines.push(
      tableRow(
        table.keys.map((key) =>
          Object.prototype.hasOwnProperty.call(row, key)
            ? renderCell(row[key])
            : '',
        ),
      ),
    );
  }
  return lines.join('\n');
}

/**
 * `|a|b|` without padding: a third fewer tokens than `| a | b |`. A delimiter
 * is exactly a `|` not preceded by `\`, because every pipe inside a cell is
 * escaped and no cell ends with a backslash.
 */
function tableRow(cells: readonly string[]): string {
  return `|${cells.join('|')}|`;
}

/**
 * A cell is compact JSON, except that a string that cannot be mistaken for
 * anything else is shown without quotes. A pipe is escaped as `\|`, so a
 * value never spills into the next cell.
 */
function renderCell(value: JsonValue): string {
  if (typeof value === 'string') {
    return renderString(value);
  }
  return escapePipes(JSON.stringify(value));
}

function renderString(value: string): string {
  return isBareString(value) ? value : escapePipes(quote(value));
}

/**
 * Bare means: non-empty, no surrounding whitespace, no pipe or line-breaking
 * character, no trailing backslash (it would escape the delimiter), and not
 * readable as a number, a literal, a quoted string or a nested value.
 */
function isBareString(value: string): boolean {
  if (value.length === 0 || value !== value.trim() || value.endsWith('\\')) {
    return false;
  }
  if (
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    JSON_NUMBER_WHOLE.test(value)
  ) {
    return false;
  }
  const first = value[0];
  if (first === '"' || first === '[' || first === '{') {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (
      code === 0x7c /* | */ ||
      code < 0x20 ||
      code === 0x7f ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return false;
    }
  }
  return true;
}

/** JSON string literal that also escapes U+2028/U+2029 (JSON.stringify does not). */
function quote(value: string): string {
  return JSON.stringify(value).replace(
    LINE_SEPARATORS,
    (char) => `\\u${char.charCodeAt(0).toString(16)}`,
  );
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function childPath(path: string, key: string): string {
  return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${quote(key)}]`;
}

/**
 * Why `JSON.parse` + `JSON.stringify` would change what the document says, or
 * `undefined` when it would not: a repeated object key (parse keeps the last),
 * or a number whose value does not survive the round trip (precision loss,
 * overflow to Infinity). One linear pass over a document parse accepted.
 */
function parseLoss(source: string): string | undefined {
  const frames: Array<{ keys?: Set<string>; expectKey: boolean }> = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '"') {
      const end = stringEnd(source, i);
      const top = frames[frames.length - 1];
      if (top?.keys && top.expectKey) {
        const key = JSON.parse(source.slice(i, end)) as string;
        if (top.keys.has(key)) {
          return `repeated key ${quote(key)}`;
        }
        top.keys.add(key);
        top.expectKey = false;
      }
      i = end;
      continue;
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      JSON_NUMBER.lastIndex = i;
      const token = JSON_NUMBER.exec(source)?.[0] ?? char;
      if (!roundTrips(token)) {
        return `number ${token.slice(0, 40)} does not round-trip`;
      }
      i += token.length;
      continue;
    }
    if (char === '{') {
      frames.push({ keys: new Set(), expectKey: true });
    } else if (char === '[') {
      frames.push({ expectKey: false });
    } else if (char === '}' || char === ']') {
      frames.pop();
    } else if (char === ',') {
      const top = frames[frames.length - 1];
      if (top?.keys) {
        top.expectKey = true;
      }
    }
    i++;
  }
  return undefined;
}

/** Index just past the closing quote of the string literal opening at `start`. */
function stringEnd(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
    } else if (char === '"') {
      return i + 1;
    } else {
      i++;
    }
  }
  return source.length;
}

/** Whether re-serialising the parsed number yields the same decimal value. */
function roundTrips(token: string): boolean {
  const value = Number(token);
  if (!Number.isFinite(value)) {
    return false;
  }
  return decimalKey(token) === decimalKey(JSON.stringify(value));
}

/**
 * Canonical `sign digits e exponent` form of a JSON number literal, so `1.0`,
 * `1e0` and `1` compare equal and `12345678901234567890` vs `12345678901234567000`
 * do not. Zero is sign-insensitive (`-0` serialises as `0`).
 */
function decimalKey(literal: string): string {
  const parts = NUMBER_PARTS.exec(literal);
  if (!parts) {
    return literal;
  }
  const [, sign, whole, fraction = '', exponent = '0'] = parts;
  let digits = whole + fraction;
  let start = 0;
  while (start < digits.length && digits[start] === '0') {
    start++;
  }
  let end = digits.length;
  while (end > start && digits[end - 1] === '0') {
    end--;
  }
  if (start === end) {
    return '0';
  }
  const scale = Number(exponent) - fraction.length + (digits.length - end);
  digits = digits.slice(start, end);
  return `${sign}${digits}e${scale}`;
}
