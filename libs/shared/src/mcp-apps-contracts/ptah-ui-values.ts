/** Statline values and source references of the ptah-ui grammar (R3, R5.11). */
import {
  failureAt,
  isName,
  isNumber,
  parseCells,
  type Step,
  type ValueResult,
} from './ptah-ui-lexical';
import type {
  PtahUiScalar,
  PtahUiSourceDefinition,
  PtahUiSourceName,
  PtahUiSourceScope,
  PtahUiStatItem,
  PtahUiTrend,
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
  agents: {
    scalars: ['total', 'running', 'completed', 'failed', 'tokens', 'cost'],
    columns: ['name', 'status', 'tokens', 'cost', 'duration', 'context'],
  },
  limits: {
    scalars: ['lanes', 'atLimit', 'nearLimit', 'unknown'],
    columns: ['lane', 'window', 'used', 'state', 'reset'],
  },
};

/** The only source that takes the `session` scope (R5.11). */
const SCOPED_SOURCE: PtahUiSourceName = 'agents';
const SESSION: PtahUiSourceScope = 'session';

/** `statline = cell BAR value [ BAR trend [ BAR spark ] ]`: 2, 3 or 4 cells. */
export function parseStatLine(
  content: string,
  line: number,
): ValueResult<PtahUiStatItem> {
  const cells = parseCells(content, true);
  if (
    !cells.ok ||
    cells.value.length < 2 ||
    cells.value[0] === '' ||
    cells.value[1] === ''
  )
    return failureAt('syntax', 'stats lines need two non-empty cells', line);
  if (cells.value.length > 4)
    return failureAt(
      'syntax',
      'stats lines take at most a label, value, trend and spark',
      line,
    );
  const value = parseScalar(cells.value[1], cells.bareDollar[1], line);
  if (!value.ok) return value;
  const [label, , trendCell, sparkCell] = cells.value;
  if (cells.value.length === 2)
    return { ok: true, value: { label, value: value.value } };

  let trend: PtahUiTrend | undefined;
  if (trendCell !== '') {
    const parsedTrend = parseTrend(trendCell, line);
    if (!parsedTrend.ok) return parsedTrend;
    trend = parsedTrend.value;
  } else if (sparkCell === undefined)
    return failureAt(
      'syntax',
      'an empty trend is allowed only before a spark',
      line,
    );
  let spark: readonly number[] | undefined;
  if (sparkCell !== undefined) {
    const parsedSpark = parseSpark(sparkCell, line);
    if (!parsedSpark.ok) return parsedSpark;
    spark = parsedSpark.value;
  }
  return {
    ok: true,
    value: {
      label,
      value: value.value,
      ...(trend === undefined ? {} : { trend }),
      ...(spark === undefined ? {} : { spark }),
    },
  };
}

/** `trend = ( "+" | "-" ) udecimal [ "%" ] [ SPS polarity ]`. */
function parseTrend(cell: string, line: number): ValueResult<PtahUiTrend> {
  const match = cell.match(/^([+-])(\d+(?:\.\d+)?)(%?)(?: +(good|bad))?$/);
  if (match === null)
    return failureAt(
      'syntax',
      'trend must be a signed number, an optional % and good or bad',
      line,
    );
  const polarity = match[4] as 'good' | 'bad' | undefined;
  return {
    ok: true,
    value: {
      direction: match[1] === '+' ? 'up' : 'down',
      amount: Number(match[2]),
      percent: match[3] === '%',
      ...(polarity === undefined ? {} : { polarity }),
    },
  };
}

/** `spark = number SPS number { SPS number }`: at least two points. */
function parseSpark(
  cell: string,
  line: number,
): ValueResult<readonly number[]> {
  const points = cell === '' ? [] : cell.split(/ +/);
  if (points.length < 2 || !points.every(isNumber))
    return failureAt(
      'syntax',
      'spark needs at least two space-separated numbers',
      line,
    );
  return { ok: true, value: points.map(Number) };
}

/** `scalar = "$" name [ ".session" ] "." name`; `.session` only after `$agents`. */
function parseScalar(
  value: string,
  isBareDollar: boolean,
  line: number,
): ValueResult<string | PtahUiScalar> {
  if (!isBareDollar) return { ok: true, value };
  if (!value.startsWith('$'))
    return failureAt('syntax', 'bare dollar must start a source', line);
  const parts = value.slice(1).split('.');
  if (parts.length !== 2 && parts.length !== 3)
    return failureAt('syntax', 'stats source must be a scalar reference', line);
  const source = sourceName(parts[0], line);
  if (!source.ok) return source;
  const field = parts[parts.length - 1];
  if (parts.length === 3) {
    const scope = sessionScope(source.value, parts[1], line);
    if (!scope.ok) return scope;
  }
  if (!isName(field))
    return failureAt('syntax', 'stats source must be a scalar reference', line);
  if (!PTAH_UI_SOURCES[source.value].scalars.includes(field))
    return failureAt(
      'unknown-source',
      `unknown field \`${field}\` for $${source.value}`,
      line,
    );
  return {
    ok: true,
    value: {
      source: source.value,
      field,
      ...(parts.length === 3 ? { scope: SESSION } : {}),
    },
  };
}
/** `rowsource = "$" name [ SPS "session" ]`; `session` only after `$agents`. */
export function parseRowSource(
  value: string | undefined,
  line: number,
): ValueResult<{
  readonly source: PtahUiSourceName;
  readonly scope?: PtahUiSourceScope;
}> {
  if (value === undefined || !value.startsWith('$'))
    return failureAt('syntax', 'table or list requires a row source', line);
  const scoped = value.match(/^\$(\S+) +(\S+)$/);
  if (scoped !== null) {
    const source = sourceName(scoped[1], line);
    if (!source.ok) return source;
    const scope = sessionScope(source.value, scoped[2], line);
    if (!scope.ok) return scope;
    return { ok: true, value: { source: source.value, scope: SESSION } };
  }
  const source = sourceName(value.slice(1), line);
  if (!source.ok) return source;
  return { ok: true, value: { source: source.value } };
}
function sessionScope(
  source: PtahUiSourceName,
  scope: string,
  line: number,
): Step {
  if (scope !== SESSION || source !== SCOPED_SOURCE)
    return failureAt(
      'syntax',
      `scope \`${scope}\` is not valid after $${source}; only $agents takes session`,
      line,
    );
  return { ok: true };
}
export function scopeField(scope: PtahUiSourceScope | undefined): {
  readonly scope?: PtahUiSourceScope;
} {
  return scope === undefined ? {} : { scope };
}
function sourceName(
  value: string,
  line: number,
): ValueResult<PtahUiSourceName> {
  if (!Object.prototype.hasOwnProperty.call(PTAH_UI_SOURCES, value))
    return failureAt('unknown-source', `unknown source \`$${value}\``, line);
  return { ok: true, value: value as PtahUiSourceName };
}
