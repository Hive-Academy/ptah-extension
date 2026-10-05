import type {
  PtahUiChartElement,
  PtahUiDocument,
  PtahUiElement,
  PtahUiParseResult,
  PtahUiParseFailure,
  PtahUiScalar,
  PtahUiSourceDefinition,
  PtahUiSourceName,
} from './ptah-ui.types';

export const PTAH_UI_SOURCES: Readonly<
  Record<PtahUiSourceName, PtahUiSourceDefinition>
> = {
  diff: {
    scalars: ['files', 'additions', 'deletions'],
    columns: ['path', 'status', 'additions', 'deletions'],
  },
  tests: {
    scalars: ['total', 'passed', 'failed', 'unknown'],
    columns: ['command', 'outcome'],
  },
  usage: { scalars: ['input', 'output', 'cost', 'duration'], columns: [] },
};

const MAX_BYTES = 8192;
const MAX_LINES = 200;

/** Parses one complete `ptah-ui` fence body. It returns grammar failures, never throws. */
export function parsePtahUi(body: string): PtahUiParseResult {
  if (utf8Bytes(body) > MAX_BYTES)
    return failure('too-large', 'ptah-ui body exceeds 8,192 bytes');
  const lines = splitLines(body);
  if (lines.length > MAX_LINES)
    return failure('too-many-lines', 'ptah-ui body exceeds 200 lines');
  if (lines.some((line) => hasControlCharacter(line)))
    return failure('syntax', 'control character in ptah-ui body');

  const state = {
    lines,
    index: 0,
    title: undefined as string | undefined,
    elements: [] as PtahUiElement[],
  };
  while (state.index < lines.length) {
    if (lines[state.index] === '') {
      state.index += 1;
      continue;
    }
    const line = lines[state.index];
    if (startsWithIndent(line))
      return failureAt('syntax', 'unexpected indented line', state.index + 1);
    const parsed = parseElement(state);
    if (!parsed.ok) return parsed;
  }
  const doc: PtahUiDocument =
    state.title === undefined
      ? { elements: state.elements }
      : { title: state.title, elements: state.elements };
  return { ok: true, doc };
}

type State = {
  lines: readonly string[];
  index: number;
  title: string | undefined;
  elements: PtahUiElement[];
};
type ParseFailure = {
  readonly ok: false;
  readonly failure: PtahUiParseFailure;
};
type Step = { readonly ok: true } | ParseFailure;
type ValueResult<T> = { readonly ok: true; readonly value: T } | ParseFailure;

function parseElement(state: State): Step {
  const line = state.lines[state.index];
  if (line.startsWith('title')) {
    if (state.title !== undefined || state.elements.length !== 0)
      return failureAt(
        'syntax',
        'title must be the first element',
        state.index + 1,
      );
    const text = headerText(line, 'title');
    if (text === undefined)
      return failureAt('syntax', 'title text is required', state.index + 1);
    state.title = text;
    state.index += 1;
    return { ok: true };
  }
  if (line === 'stats') return parseStats(state);
  if (line === 'table') return parseLiteralTable(state);
  if (line.startsWith('table')) return parseSourceTable(state);
  if (line === 'list') return parseLiteralList(state);
  if (line.startsWith('list')) return parseSourceList(state);
  if (line.startsWith('chart')) return parseChart(state);
  return failureAt(
    'syntax',
    `unknown element \`${line.split(' ')[0]}\``,
    state.index + 1,
  );
}

function parseStats(state: State): Step {
  const start = state.index;
  state.index += 1;
  const items: { label: string; value: string | PtahUiScalar }[] = [];
  while (
    state.index < state.lines.length &&
    startsWithIndent(state.lines[state.index])
  ) {
    if (items.length === 8)
      return failureAt(
        'syntax',
        'stats allows at most 8 lines',
        state.index + 1,
      );
    const cells = parseCells(state.lines[state.index], true);
    if (
      !cells.ok ||
      cells.value.length !== 2 ||
      cells.value[0] === '' ||
      cells.value[1] === ''
    )
      return failureAt(
        'syntax',
        'stats lines need two non-empty cells',
        state.index + 1,
      );
    const value = parseScalar(
      cells.value[1],
      cells.bareDollar[1],
      state.index + 1,
    );
    if (!value.ok) return value;
    items.push({ label: cells.value[0], value: value.value });
    state.index += 1;
  }
  if (items.length === 0)
    return failureAt('syntax', 'stats needs at least one line', start + 2);
  state.elements.push({ kind: 'stats', items });
  return { ok: true };
}

function parseLiteralTable(state: State): Step {
  state.index += 1;
  const rows: string[][] = [];
  while (
    state.index < state.lines.length &&
    startsWithIndent(state.lines[state.index])
  ) {
    const cells = parseCells(state.lines[state.index]);
    if (!cells.ok) return failureAt('syntax', cells.message, state.index + 1);
    rows.push(cells.value);
    state.index += 1;
  }
  if (rows.length < 2)
    return failureAt(
      'syntax',
      'table needs a header and a row',
      state.index + 1,
    );
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width))
    return failureAt(
      'syntax',
      'table rows must have matching cell counts',
      state.index + 1,
    );
  state.elements.push({ kind: 'table', columns: rows[0], rows: rows.slice(1) });
  return { ok: true };
}

function parseSourceTable(state: State): Step {
  const source = parseRowSource(
    headerText(state.lines[state.index], 'table'),
    state.index + 1,
  );
  if (!source.ok) return source;
  state.index += 1;
  let columns: string[] | undefined;
  if (
    state.index < state.lines.length &&
    startsWithIndent(state.lines[state.index])
  ) {
    const line = state.lines[state.index];
    if (!line.startsWith('  cols '))
      return failureAt(
        'syntax',
        'only cols may follow a source table',
        state.index + 1,
      );
    const cells = parseCells(`  ${line.slice(7)}`);
    if (!cells.ok || cells.value.some((name) => !isName(name)))
      return failureAt(
        'syntax',
        'cols requires source column names',
        state.index + 1,
      );
    if (
      new Set(cells.value).size !== cells.value.length ||
      cells.value.some(
        (name) => !PTAH_UI_SOURCES[source.value].columns.includes(name),
      )
    )
      return failureAt(
        'syntax',
        'unknown or repeated cols name',
        state.index + 1,
      );
    columns = cells.value;
    state.index += 1;
  }
  state.elements.push({
    kind: 'table',
    source: source.value,
    ...(columns === undefined ? {} : { columns }),
  });
  return { ok: true };
}

function parseLiteralList(state: State): Step {
  state.index += 1;
  const items: string[] = [];
  while (
    state.index < state.lines.length &&
    startsWithIndent(state.lines[state.index])
  ) {
    const line = state.lines[state.index];
    if (!line.startsWith('  - '))
      return failureAt('syntax', 'list items start with "- "', state.index + 1);
    const text = decodeText(line.slice(4));
    if (text === undefined || text === '')
      return failureAt('syntax', 'list item text is required', state.index + 1);
    items.push(text);
    state.index += 1;
  }
  if (items.length === 0)
    return failureAt('syntax', 'list needs at least one item', state.index + 1);
  state.elements.push({ kind: 'list', items });
  return { ok: true };
}

function parseSourceList(state: State): Step {
  const source = parseRowSource(
    headerText(state.lines[state.index], 'list'),
    state.index + 1,
  );
  if (!source.ok) return source;
  state.index += 1;
  state.elements.push({ kind: 'list', source: source.value });
  return { ok: true };
}

function parseChart(state: State): Step {
  const words = state.lines[state.index].split(' ');
  if (words.length < 3 || (words[1] !== 'line' && words[1] !== 'bar'))
    return failureAt(
      'syntax',
      'chart kind must be line or bar',
      state.index + 1,
    );
  const title = decodeText(words.slice(2).join(' ').trim());
  if (title === undefined || title === '')
    return failureAt('syntax', 'chart title is required', state.index + 1);
  const points: { label: string; value: number }[] = [];
  state.index += 1;
  while (
    state.index < state.lines.length &&
    startsWithIndent(state.lines[state.index])
  ) {
    const cells = parseCells(state.lines[state.index]);
    if (
      !cells.ok ||
      cells.value.length !== 2 ||
      cells.value[0] === '' ||
      !isNumber(cells.value[1])
    )
      return failureAt(
        'syntax',
        'chart points need a label and a number',
        state.index + 1,
      );
    points.push({ label: cells.value[0], value: Number(cells.value[1]) });
    state.index += 1;
  }
  if (points.length === 0)
    return failureAt(
      'syntax',
      'chart needs at least one point',
      state.index + 1,
    );
  const chart: PtahUiChartElement = {
    kind: 'chart',
    chart: words[1],
    title,
    points,
  };
  state.elements.push(chart);
  return { ok: true };
}

function splitLines(body: string): string[] {
  const lines = body.split(/\r\n|\n/).map(removeTrailingSpaces);
  return body.endsWith('\n') ? lines.slice(0, -1) : lines;
}
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}
function removeTrailingSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === ' ') end -= 1;
  return value.slice(0, end);
}
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
function startsWithIndent(line: string): boolean {
  return line.startsWith('  ');
}
function headerText(line: string, keyword: string): string | undefined {
  if (!line.startsWith(`${keyword} `) || line.startsWith(`${keyword}  `))
    return undefined;
  return decodeText(line.slice(keyword.length + 1).trim());
}
function parseCells(
  line: string,
  allowSourceFinal = false,
):
  | { ok: true; value: string[]; bareDollar: boolean[] }
  | { ok: false; message: string } {
  if (!line.startsWith('  ') || line[2] === ' ')
    return {
      ok: false,
      message: 'body lines need exactly two spaces of indentation',
    };
  const cells: string[] = [];
  const bareDollar: boolean[] = [];
  let current = '';
  let hasBareDollar = false;
  for (let index = 2; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\') {
      const next = line[index + 1];
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
function decodeText(value: string): string | undefined {
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
function parseScalar(
  value: string,
  isBareDollar: boolean,
  line: number,
): ValueResult<string | PtahUiScalar> {
  if (!isBareDollar) return { ok: true, value };
  if (!value.startsWith('$'))
    return failureAt('syntax', 'bare dollar must start a source', line);
  const parts = value.slice(1).split('.');
  if (parts.length !== 2)
    return failureAt('syntax', 'stats source must be a scalar reference', line);
  const source = sourceName(parts[0], line);
  if (!source.ok) return source;
  if (!isName(parts[1]))
    return failureAt('syntax', 'stats source must be a scalar reference', line);
  if (!PTAH_UI_SOURCES[source.value].scalars.includes(parts[1]))
    return failureAt(
      'unknown-source',
      `unknown field \`${parts[1]}\` for $${source.value}`,
      line,
    );
  return { ok: true, value: { source: source.value, field: parts[1] } };
}
function parseRowSource(
  value: string | undefined,
  line: number,
): ValueResult<PtahUiSourceName> {
  if (value === undefined || !value.startsWith('$'))
    return failureAt('syntax', 'table or list requires a row source', line);
  return sourceName(value.slice(1), line);
}
function sourceName(
  value: string,
  line: number,
): ValueResult<PtahUiSourceName> {
  if (!Object.prototype.hasOwnProperty.call(PTAH_UI_SOURCES, value))
    return failureAt('unknown-source', `unknown source \`$${value}\``, line);
  return { ok: true, value: value as PtahUiSourceName };
}
function isName(value: string): boolean {
  return /^[a-z]+$/.test(value);
}
function isNumber(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}
function failure(
  code: 'too-large' | 'too-many-lines' | 'syntax' | 'unknown-source',
  message: string,
): ParseFailure {
  return { ok: false, failure: { code, message } };
}
function failureAt(
  code: 'syntax' | 'unknown-source',
  message: string,
  line: number,
): ParseFailure {
  return {
    ok: false,
    failure: { code, message: `${message} (line ${line})`, line },
  };
}
