import { SURFACE_LIMITS } from './surface-catalog';
import {
  decodeText,
  depthFailure,
  failure,
  failureAt,
  hasControlCharacter,
  headerText,
  includes,
  isName,
  isUnsignedDecimal,
  isNumber,
  leadingSpaces,
  limitFailureAt,
  parseCells,
  splitLines,
  utf8Bytes,
  type ParseFailure,
  type Step,
  type ValueResult,
} from './ptah-ui-lexical';
import {
  PTAH_UI_SOURCES,
  parseRowSource,
  parseStatLine,
  scopeField,
} from './ptah-ui-values';
import type {
  PtahUiAvatarElement,
  PtahUiBadgeElement,
  PtahUiChartElement,
  PtahUiContainerElement,
  PtahUiDocument,
  PtahUiNode,
  PtahUiNoteElement,
  PtahUiNoteTone,
  PtahUiParseResult,
  PtahUiProgressElement,
  PtahUiStatItem,
  PtahUiTone,
} from './ptah-ui.types';

export { PTAH_UI_SOURCES } from './ptah-ui-values';

const MAX_BYTES = 8192;
const MAX_LINES = 200;
/** Spaces per depth level (`IND(d)` = 2·d spaces). */
const INDENT = 2;
const NOTE_TONES: readonly PtahUiNoteTone[] = ['info', 'ok', 'warn', 'error'];
const TONES: readonly PtahUiTone[] = ['neutral', ...NOTE_TONES];

/**
 * Parses one complete `ptah-ui` fence body: the TASK_2026_610 grammar with
 * the R3 depth-relative nesting delta. A depth-d item's header sits at 2·d
 * spaces and element body lines at 2·(d+1), so every valid 610 block parses
 * to the same document. It returns grammar failures, never throws.
 */
export function parsePtahUi(body: string): PtahUiParseResult {
  if (utf8Bytes(body) > MAX_BYTES)
    return failure('too-large', 'ptah-ui body exceeds 8,192 bytes');
  const lines = splitLines(body);
  if (lines.length > MAX_LINES)
    return failure('too-many-lines', 'ptah-ui body exceeds 200 lines');
  if (lines.some((line) => hasControlCharacter(line)))
    return failure('syntax', 'control character in ptah-ui body');

  const state: State = {
    lines,
    index: 0,
    title: undefined,
    components: 0,
  };
  const elements: PtahUiNode[] = [];
  const parsed = parseItems(state, 0, elements);
  if (!parsed.ok) return parsed;
  const doc: PtahUiDocument =
    state.title === undefined ? { elements } : { title: state.title, elements };
  return { ok: true, doc };
}

type State = {
  readonly lines: readonly string[];
  index: number;
  title: string | undefined;
  /** Converted component count so far (stats expand one per statline). */
  components: number;
};
type ItemResult = ValueResult<PtahUiNode | undefined>;

/**
 * Reads sibling items at `depth` into `out` until a line at a lower depth
 * (which ends the enclosing container) or the end of the body. Blank lines
 * between items are skipped.
 */
function parseItems(state: State, depth: number, out: PtahUiNode[]): Step {
  while (state.index < state.lines.length) {
    const line = state.lines[state.index];
    if (line === '') {
      state.index += 1;
      continue;
    }
    const indent = leadingSpaces(line);
    if (indent % INDENT !== 0)
      return depthFailure(
        'indentation must be a multiple of two spaces',
        state.index + 1,
        depth,
      );
    const lineDepth = indent / INDENT;
    if (lineDepth < depth) return { ok: true };
    if (lineDepth > depth)
      return depthFailure('unexpected indented line', state.index + 1, depth);
    if (depth + 1 > SURFACE_LIMITS.maxTreeDepth)
      return limitFailure('maxTreeDepth', SURFACE_LIMITS.maxTreeDepth, state);
    const item = parseItem(state, depth, line.slice(indent), out.length);
    if (!item.ok) return item;
    if (item.value !== undefined) out.push(item.value);
  }
  return { ok: true };
}

/** Parses the item whose header is `content` (indentation removed). */
function parseItem(
  state: State,
  depth: number,
  content: string,
  siblingsBefore: number,
): ItemResult {
  const lineNumber = state.index + 1;
  if (content === 'title' || content.startsWith('title ')) {
    if (depth !== 0)
      return failureAt(
        'syntax',
        'title is only allowed at depth 0',
        lineNumber,
      );
    if (state.title !== undefined || siblingsBefore !== 0)
      return failureAt('syntax', 'title must be the first element', lineNumber);
    const text = headerText(content, 'title');
    if (text === undefined)
      return failureAt('syntax', 'title text is required', lineNumber);
    state.title = text;
    state.index += 1;
    return { ok: true, value: undefined };
  }
  const word = content.split(' ')[0];
  switch (word) {
    case 'row':
    case 'col':
    case 'grid':
    case 'card':
    case 'section':
    case 'accordion':
      return parseContainer(state, depth, content);
    case 'stats':
      if (content === 'stats') return parseStats(state, depth);
      break;
    case 'table':
      if (content === 'table') return parseLiteralTable(state, depth);
      return parseSourceTable(state, depth, content);
    case 'list':
      if (content === 'list') return parseLiteralList(state, depth);
      return parseSourceList(state, content);
    case 'chart':
      return parseChart(state, depth, content);
    case 'note':
      return parseNote(state, content);
    case 'badge':
      return parseBadge(state, content);
    case 'progress':
      return parseProgress(state, content);
    case 'avatar':
      return parseAvatar(state, content);
  }
  return failureAt('syntax', `unknown element \`${word}\``, lineNumber);
}

function parseContainer(
  state: State,
  depth: number,
  content: string,
): ItemResult {
  const header = state.index;
  const lineNumber = header + 1;
  const shape = containerHeader(content, lineNumber);
  if (!shape.ok) return shape;
  const counted = countComponents(state, 1);
  if (!counted.ok) return counted;
  state.index += 1;
  const children: PtahUiNode[] = [];
  const parsed = parseItems(state, depth + 1, children);
  if (!parsed.ok) return parsed;
  if (children.length === 0)
    return failureAt(
      'syntax',
      `${shape.value.kind} needs at least one child item`,
      lineNumber,
    );
  const childComponents = children.reduce(
    (total, child) => total + (child.kind === 'stats' ? child.items.length : 1),
    0,
  );
  if (childComponents > SURFACE_LIMITS.maxChildrenPerNode)
    return limitFailureAt(
      'maxChildrenPerNode',
      SURFACE_LIMITS.maxChildrenPerNode,
      lineNumber,
    );
  return { ok: true, value: { ...shape.value, children } };
}

type ContainerShape =
  | { readonly kind: 'row' | 'col' }
  | { readonly kind: 'grid'; readonly columns: number }
  | { readonly kind: 'card'; readonly title?: string }
  | { readonly kind: 'section' | 'accordion'; readonly title: string };

function containerHeader(
  content: string,
  line: number,
): ValueResult<ContainerShape> {
  if (content === 'row' || content === 'col')
    return { ok: true, value: { kind: content } };
  if (content.startsWith('row ') || content.startsWith('col '))
    return failureAt('syntax', `${content.slice(0, 3)} takes no text`, line);
  if (content === 'card') return { ok: true, value: { kind: 'card' } };
  if (content.startsWith('grid')) {
    const match = content.match(/^grid +(\d+)$/);
    if (match === null)
      return failureAt('syntax', 'grid needs a column count', line);
    const columns = Number(match[1]);
    if (columns > SURFACE_LIMITS.maxGridColumns)
      return limitFailureAt(
        'maxGridColumns',
        SURFACE_LIMITS.maxGridColumns,
        line,
      );
    if (columns < 1)
      return failureAt(
        'syntax',
        `grid columns must be 1 to ${SURFACE_LIMITS.maxGridColumns}`,
        line,
      );
    return { ok: true, value: { kind: 'grid', columns } };
  }
  const kind = content.split(' ')[0];
  if (kind !== 'card' && kind !== 'section' && kind !== 'accordion')
    return failureAt('syntax', `unknown element \`${kind}\``, line);
  const title = headerText(content, kind);
  if (title === undefined || title === '')
    return failureAt('syntax', `${kind} text is required`, line);
  return { ok: true, value: { kind, title } };
}

function parseStats(state: State, depth: number): ItemResult {
  const start = state.index;
  state.index += 1;
  const items: PtahUiStatItem[] = [];
  while (isBodyLine(state, depth)) {
    const body = bodyContent(state, depth);
    if (!body.ok) return body;
    if (items.length === 8)
      return failureAt(
        'syntax',
        'stats allows at most 8 lines',
        state.index + 1,
      );
    const item = parseStatLine(body.value, state.index + 1);
    if (!item.ok) return item;
    items.push(item.value);
    state.index += 1;
  }
  if (items.length === 0)
    return failureAt('syntax', 'stats needs at least one line', start + 2);
  const counted = countComponents(state, items.length);
  if (!counted.ok) return counted;
  return { ok: true, value: { kind: 'stats', items } };
}

function parseLiteralTable(state: State, depth: number): ItemResult {
  state.index += 1;
  const rows: string[][] = [];
  while (isBodyLine(state, depth)) {
    const body = bodyContent(state, depth);
    if (!body.ok) return body;
    const cells = parseCells(body.value);
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
  const counted = countComponents(state, 1);
  if (!counted.ok) return counted;
  return {
    ok: true,
    value: { kind: 'table', columns: rows[0], rows: rows.slice(1) },
  };
}

function parseSourceTable(
  state: State,
  depth: number,
  content: string,
): ItemResult {
  const source = parseRowSource(headerText(content, 'table'), state.index + 1);
  if (!source.ok) return source;
  const name = source.value.source;
  if (PTAH_UI_SOURCES[name].columns.length === 0)
    return failureAt(
      'syntax',
      `source \`${name}\` has no columns`,
      state.index + 1,
    );
  state.index += 1;
  let columns: string[] | undefined;
  if (isBodyLine(state, depth)) {
    const body = bodyContent(state, depth);
    if (!body.ok) return body;
    if (!body.value.startsWith('cols '))
      return failureAt(
        'syntax',
        'only cols may follow a source table',
        state.index + 1,
      );
    const cells = parseCells(body.value.slice(5));
    if (!cells.ok || cells.value.some((column) => !isName(column)))
      return failureAt(
        'syntax',
        'cols requires source column names',
        state.index + 1,
      );
    if (
      new Set(cells.value).size !== cells.value.length ||
      cells.value.some(
        (column) => !PTAH_UI_SOURCES[name].columns.includes(column),
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
  const counted = countComponents(state, 1);
  if (!counted.ok) return counted;
  return {
    ok: true,
    value: {
      kind: 'table',
      source: name,
      ...(columns === undefined ? {} : { columns }),
      ...scopeField(source.value.scope),
    },
  };
}

function parseLiteralList(state: State, depth: number): ItemResult {
  state.index += 1;
  const items: string[] = [];
  while (isBodyLine(state, depth)) {
    const body = bodyContent(state, depth);
    if (!body.ok) return body;
    if (!body.value.startsWith('- '))
      return failureAt('syntax', 'list items start with "- "', state.index + 1);
    const text = decodeText(body.value.slice(2));
    if (text === undefined || text === '')
      return failureAt('syntax', 'list item text is required', state.index + 1);
    items.push(text);
    state.index += 1;
  }
  if (items.length === 0)
    return failureAt('syntax', 'list needs at least one item', state.index + 1);
  const counted = countComponents(state, 1);
  if (!counted.ok) return counted;
  return { ok: true, value: { kind: 'list', items } };
}

function parseSourceList(state: State, content: string): ItemResult {
  const source = parseRowSource(headerText(content, 'list'), state.index + 1);
  if (!source.ok) return source;
  const name = source.value.source;
  if (PTAH_UI_SOURCES[name].columns.length === 0)
    return failureAt(
      'syntax',
      `source \`${name}\` has no columns`,
      state.index + 1,
    );
  const counted = countComponents(state, 1);
  if (!counted.ok) return counted;
  state.index += 1;
  return {
    ok: true,
    value: { kind: 'list', source: name, ...scopeField(source.value.scope) },
  };
}

function parseChart(state: State, depth: number, content: string): ItemResult {
  const header = content.match(/^chart +(\S+)(?: +(.*))?$/);
  if (!header || (header[1] !== 'line' && header[1] !== 'bar'))
    return failureAt(
      'syntax',
      'chart kind must be line or bar',
      state.index + 1,
    );
  const title = decodeText(header[2]?.trim() ?? '');
  if (title === undefined || title === '')
    return failureAt('syntax', 'chart title is required', state.index + 1);
  const points: { label: string; value: number }[] = [];
  state.index += 1;
  while (isBodyLine(state, depth)) {
    const body = bodyContent(state, depth);
    if (!body.ok) return body;
    const cells = parseCells(body.value);
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
  const counted = countComponents(state, 1);
  if (!counted.ok) return counted;
  const chart: PtahUiChartElement = {
    kind: 'chart',
    chart: header[1],
    title,
    points,
  };
  return { ok: true, value: chart };
}

/** `note = "note" SPS ntone SPS text`; an unescaped pipe in text is literal. */
function parseNote(state: State, content: string): ItemResult {
  const line = state.index + 1;
  const match = content.match(/^note +(\S+) +(.+)$/);
  const tone = match?.[1] ?? '';
  if (match === null || !includes(NOTE_TONES, tone))
    return failureAt(
      'syntax',
      'note needs a tone (info, ok, warn or error) and text',
      line,
    );
  const text = decodeText(match[2]);
  if (text === undefined || text === '')
    return failureAt('syntax', 'note text is required', line);
  const note: PtahUiNoteElement = { kind: 'note', tone, text };
  return singleLineItem(state, note);
}

/** `badge = "badge" SPS tone SPS text`; an unescaped pipe in text is literal. */
function parseBadge(state: State, content: string): ItemResult {
  const line = state.index + 1;
  const match = content.match(/^badge +(\S+) +(.+)$/);
  const tone = match?.[1] ?? '';
  if (match === null || !includes(TONES, tone))
    return failureAt(
      'syntax',
      'badge needs a tone (neutral, info, ok, warn or error) and text',
      line,
    );
  const text = decodeText(match[2]);
  if (text === undefined || text === '')
    return failureAt('syntax', 'badge text is required', line);
  const badge: PtahUiBadgeElement = { kind: 'badge', tone, text };
  return singleLineItem(state, badge);
}

/** `progress = "progress" SPS cell BAR pct [ BAR tone ]`; literal only. */
function parseProgress(state: State, content: string): ItemResult {
  const line = state.index + 1;
  const match = content.match(/^progress +(.*)$/);
  const cells = match === null ? undefined : parseCells(match[1]);
  if (
    cells === undefined ||
    !cells.ok ||
    cells.value.length < 2 ||
    cells.value.length > 3 ||
    cells.value[0] === ''
  )
    return failureAt(
      'syntax',
      'progress needs a label, a percent and an optional tone',
      line,
    );
  const [label, pct, toneCell] = cells.value;
  if (!isUnsignedDecimal(pct) || Number(pct) > 100)
    return failureAt(
      'syntax',
      'progress percent must be a number from 0 to 100',
      line,
    );
  let tone: PtahUiTone | undefined;
  if (toneCell !== undefined) {
    if (!includes(TONES, toneCell))
      return failureAt(
        'syntax',
        'progress tone must be neutral, info, ok, warn or error',
        line,
      );
    tone = toneCell;
  }
  const progress: PtahUiProgressElement = {
    kind: 'progress',
    label,
    value: Number(pct),
    ...(tone === undefined ? {} : { tone }),
  };
  return singleLineItem(state, progress);
}

/** `avatar = "avatar" SPS cell [ BAR cell ]`; name non-empty, literal only. */
function parseAvatar(state: State, content: string): ItemResult {
  const line = state.index + 1;
  const match = content.match(/^avatar +(.*)$/);
  const cells = match === null ? undefined : parseCells(match[1]);
  if (
    cells === undefined ||
    !cells.ok ||
    cells.value.length > 2 ||
    cells.value[0] === ''
  )
    return failureAt(
      'syntax',
      'avatar needs a name and an optional subtitle',
      line,
    );
  const [name, subtitle] = cells.value;
  const avatar: PtahUiAvatarElement =
    subtitle === undefined || subtitle === ''
      ? { kind: 'avatar', name }
      : { kind: 'avatar', name, subtitle };
  return singleLineItem(state, avatar);
}

function singleLineItem(
  state: State,
  item: Exclude<PtahUiNode, PtahUiContainerElement>,
): ItemResult {
  const counted = countComponents(state, 1);
  if (!counted.ok) return counted;
  state.index += 1;
  return { ok: true, value: item };
}

/** Whether the current line belongs to the body of an element at `depth`. */
function isBodyLine(state: State, depth: number): boolean {
  return (
    state.index < state.lines.length &&
    leadingSpaces(state.lines[state.index]) >= (depth + 1) * INDENT
  );
}

/** A body line's content; body lines sit exactly one level below the header. */
function bodyContent(state: State, depth: number): ValueResult<string> {
  const line = state.lines[state.index];
  const indent = leadingSpaces(line);
  if (indent !== (depth + 1) * INDENT)
    return depthFailure(
      'body lines need exactly one more level of indentation',
      state.index + 1,
      depth + 1,
    );
  return { ok: true, value: line.slice(indent) };
}

function countComponents(state: State, added: number): Step {
  state.components += added;
  if (state.components > SURFACE_LIMITS.maxComponents)
    return limitFailure('maxComponents', SURFACE_LIMITS.maxComponents, state);
  return { ok: true };
}

function limitFailure(
  limit: string,
  value: number,
  state: State,
): ParseFailure {
  return limitFailureAt(limit, value, state.index + 1);
}
