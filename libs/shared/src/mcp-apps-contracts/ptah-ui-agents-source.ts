import type { ContextCapacity } from '../lib/utils/pricing.utils';
import {
  formatDurationMs,
  formatUsdCost,
} from '../lib/utils/usage-format.utils';
import { SURFACE_LIMITS } from './surface-catalog';
import type { PtahUiSourceScope } from './ptah-ui.types';

/*
 * The `$agents` host source (R5, D6): one pure module that merges agent facts
 * into one row per logical agent, aggregates the scalars and derives the
 * `context` cell. Every fact type below is an allow-list: none has a field for
 * a task, description, prompt, summary, stdout, stderr, error or output file,
 * so no agent prompt or output can reach a surface (R5.1).
 */

/** An `ExecutionNode` of type `agent` (N), reduced to allow-listed fields. */
export interface AgentNodeFact {
  readonly id: string;
  readonly toolCallId?: string;
  readonly agentId?: string;
  readonly agentType?: string;
  /** Epoch milliseconds. */
  readonly startTime?: number;
  readonly tokens?: number;
  readonly cost?: number | null;
  readonly durationMs?: number;
  /** Raw store status; normalised by {@link normalizeAgentStatus}. */
  readonly status: string;
}

/** The agent facts of one transcript turn, in execution-tree order (D7). */
export interface TurnAgentFacts {
  /** Epoch milliseconds of the turn's user message. */
  readonly startedAt: number;
  readonly nodes: readonly AgentNodeFact[];
  /** Every `toolCallId` in the turn's trees (Task tool and agent nodes). */
  readonly spawnToolCallIds: readonly string[];
}

/** A `SubagentRecord` (R), reduced to allow-listed fields. In-memory only (D8). */
export interface SubagentFact {
  readonly parentToolUseId: string;
  readonly agentId?: string;
  readonly teammateName?: string;
  readonly agentType?: string;
  readonly status: string;
  readonly totalTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number | null;
  readonly durationMs?: number;
  /** The last request's context tokens (`subagentUsageView(R).contextTokens`). */
  readonly contextTokens?: number;
  /** The exact model id of the last request, matched against capacity evidence. */
  readonly model?: string;
}

/**
 * A CLI lane `MonitoredAgent` (M), reduced to allow-listed fields. It carries
 * no context figure: CLI lanes show `context` as "unavailable" in this task
 * (decisions.md #16).
 */
export interface CliLaneFact {
  readonly agentId: string;
  readonly cli: string;
  readonly displayName?: string;
  readonly status: string;
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly tokens?: number | null;
  readonly cost?: number | null;
  readonly durationMs?: number;
}

export interface PtahUiAgentsInput {
  /** Index into `turns` of the turn that owns the block. */
  readonly turnIndex: number;
  readonly turns: readonly TurnAgentFacts[];
  readonly records: readonly SubagentFact[];
  readonly lanes: readonly CliLaneFact[];
  /** Capacity evidence of the session; the only source of a context limit. */
  readonly capacities: readonly ContextCapacity[];
}

export type PtahUiAgentStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'stopped';

export interface PtahUiAgentContext {
  readonly tokens: number;
  /** One decimal place; `null` when no capacity evidence names the model. */
  readonly percent: number | null;
}

export interface PtahUiAgentRow {
  /** Union key: `sdk:`, `sdk-node:` or `cli:` (R5 merge rule). */
  readonly key: string;
  readonly name: string | null;
  readonly status: PtahUiAgentStatus;
  readonly tokens: number | null;
  readonly cost: number | null;
  readonly durationMs: number | null;
  readonly context: PtahUiAgentContext | null;
}

export interface PtahUiAgentsScalars {
  readonly total: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  /** `null` when any row's tokens are unavailable. */
  readonly tokens: number | null;
  /** `null` when any row's cost is unavailable (R5.3). */
  readonly cost: number | null;
}

export type PtahUiAgentsView =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'available';
      /** The first `SURFACE_LIMITS.maxTableRows` rows in R5.11 order. */
      readonly rows: readonly PtahUiAgentRow[];
      /** Rows in scope but past the row cap, announced as "+N more". */
      readonly omittedRows: number;
      /** Computed over every row in scope, displayed or not. */
      readonly scalars: PtahUiAgentsScalars;
    };

const UNAVAILABLE = 'unavailable';

const STATUS_MAP: Readonly<Record<string, PtahUiAgentStatus>> = {
  pending: 'pending',
  running: 'running',
  streaming: 'running',
  resumed: 'running',
  paused: 'running',
  background: 'running',
  complete: 'completed',
  completed: 'completed',
  background_completed: 'completed',
  error: 'failed',
  failed: 'failed',
  interrupted: 'stopped',
  stopped: 'stopped',
  killed: 'stopped',
  timeout: 'stopped',
};

/** R5.2 status vocabulary. An unknown status maps to `pending`. */
export function normalizeAgentStatus(status: string): PtahUiAgentStatus {
  return Object.hasOwn(STATUS_MAP, status) ? STATUS_MAP[status] : 'pending';
}

/**
 * Resolves `$agents` (turn scope) or `$agents session` (turns `0..turnIndex`).
 * A missing input, or a turn index with no facts, is "unavailable" rather than
 * an invalid block.
 */
export function resolvePtahUiAgents(
  input: PtahUiAgentsInput | null | undefined,
  scope?: PtahUiSourceScope,
): PtahUiAgentsView {
  if (
    input === null ||
    input === undefined ||
    !Number.isInteger(input.turnIndex) ||
    input.turnIndex < 0 ||
    input.turnIndex >= input.turns.length
  )
    return { kind: 'unavailable' };
  const firstTurn = scope === 'session' ? 0 : input.turnIndex;
  const rows = orderedRows(input, firstTurn, input.turnIndex);
  return {
    kind: 'available',
    rows: rows.slice(0, SURFACE_LIMITS.maxTableRows),
    omittedRows: Math.max(0, rows.length - SURFACE_LIMITS.maxTableRows),
    scalars: aggregate(rows),
  };
}

/** The value of `$agents[.session].<field>`; never 0 for a missing figure. */
export function agentsScalarValue(
  view: PtahUiAgentsView,
  field: string,
): string | number {
  if (view.kind === 'unavailable') return UNAVAILABLE;
  const { scalars } = view;
  switch (field) {
    case 'total':
    case 'running':
    case 'completed':
    case 'failed':
      return scalars[field];
    case 'tokens':
      return scalars.tokens ?? UNAVAILABLE;
    case 'cost':
      return formatUsdCost(scalars.cost) ?? UNAVAILABLE;
    default:
      return UNAVAILABLE;
  }
}

/** Table cells for the requested `$agents` columns, one array per row. */
export function agentsRowValues(
  rows: readonly PtahUiAgentRow[],
  columns: readonly string[],
): readonly (readonly (string | number)[])[] {
  return rows.map((row) => columns.map((column) => agentCell(row, column)));
}

function agentCell(row: PtahUiAgentRow, column: string): string | number {
  switch (column) {
    case 'name':
      return row.name ?? UNAVAILABLE;
    case 'status':
      return row.status;
    case 'tokens':
      return row.tokens ?? UNAVAILABLE;
    case 'cost':
      return formatUsdCost(row.cost) ?? UNAVAILABLE;
    case 'duration':
      return row.durationMs === null || !isTerminal(row.status)
        ? UNAVAILABLE
        : formatDurationMs(row.durationMs);
    case 'context':
      return agentContextText(row.context);
    default:
      return UNAVAILABLE;
  }
}

/** Cell text: "50,000 · 25%", "50,000" with no known limit, or "unavailable". */
export function agentContextText(context: PtahUiAgentContext | null): string {
  if (context === null) return UNAVAILABLE;
  const tokens = formatCount(context.tokens);
  return context.percent === null ? tokens : `${tokens} · ${context.percent}%`;
}

/** Accessible text stating both parts in words (R5.10). */
export function agentContextAccessibleText(
  context: PtahUiAgentContext | null,
): string {
  if (context === null) return 'context unavailable';
  const tokens = `${formatCount(context.tokens)} context tokens`;
  return context.percent === null
    ? tokens
    : `${tokens}, ${context.percent} percent of the context window`;
}

/** Sort key for the `context` column: tokens, with unavailable (`null`) last. */
export function agentContextSortKey(row: PtahUiAgentRow): number | null {
  return row.context?.tokens ?? null;
}

interface ScopedRow {
  readonly row: PtahUiAgentRow;
  readonly turn: number;
  readonly startTime: number | null;
}

function orderedRows(
  input: PtahUiAgentsInput,
  firstTurn: number,
  lastTurn: number,
): PtahUiAgentRow[] {
  const inScope = (turn: number | undefined): turn is number =>
    turn !== undefined && turn >= firstTurn && turn <= lastTurn;
  const recordTurns = recordTurnIndex(input.turns);
  const scopedRecords: {
    readonly record: SubagentFact;
    readonly turn: number;
  }[] = [];
  for (const record of input.records) {
    const turn = recordTurns.get(record.parentToolUseId);
    if (inScope(turn)) scopedRecords.push({ record, turn });
  }
  const records = scopedRecords.map((entry) => entry.record);
  const byParent = firstBy(records, (record) => record.parentToolUseId);
  const byAgentId = firstBy(records, (record) => record.agentId);
  const claimed = new Set<SubagentFact>();
  const scoped: ScopedRow[] = [];

  for (let turn = firstTurn; turn <= lastTurn; turn += 1) {
    for (const node of input.turns[turn].nodes) {
      const candidate =
        node.toolCallId !== undefined
          ? byParent.get(node.toolCallId)
          : node.agentId !== undefined
            ? byAgentId.get(node.agentId)
            : undefined;
      // Rule 5: an R already merged into an earlier N leaves this N on its own.
      const record =
        candidate === undefined || claimed.has(candidate)
          ? undefined
          : candidate;
      if (record !== undefined) claimed.add(record);
      scoped.push({
        row: nodeRow(node, record, input.capacities),
        turn,
        startTime: finiteOrNull(node.startTime),
      });
    }
  }
  for (const { record, turn } of scopedRecords) {
    if (claimed.has(record)) continue;
    // D7: an R start time is its matched N's; an unmatched R has none.
    scoped.push({
      row: recordRow(record, input.capacities),
      turn,
      startTime: null,
    });
  }
  for (const lane of input.lanes) {
    const turn = laneTurn(input.turns, lane.startedAt);
    if (inScope(turn))
      scoped.push({
        row: laneRow(lane),
        turn,
        startTime: finiteOrNull(lane.startedAt),
      });
  }
  return scoped.sort(compareScopedRows).map((entry) => entry.row);
}

/** R5.11 order: turn, then known start time, then key; unknown starts last. */
function compareScopedRows(a: ScopedRow, b: ScopedRow): number {
  if (a.turn !== b.turn) return a.turn - b.turn;
  if (a.startTime !== b.startTime) {
    if (a.startTime === null) return 1;
    if (b.startTime === null) return -1;
    return a.startTime - b.startTime;
  }
  return a.row.key < b.row.key ? -1 : a.row.key > b.row.key ? 1 : 0;
}

/** D7: an R belongs to the first turn whose trees hold its parent tool use. */
function recordTurnIndex(
  turns: readonly TurnAgentFacts[],
): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  turns.forEach((turn, turnIndex) => {
    for (const id of turn.spawnToolCallIds)
      if (!index.has(id)) index.set(id, turnIndex);
    for (const node of turn.nodes)
      if (node.toolCallId !== undefined && !index.has(node.toolCallId))
        index.set(node.toolCallId, turnIndex);
  });
  return index;
}

/** D7: `turn.startedAt <= M.startedAt < nextTurn.startedAt`. */
function laneTurn(
  turns: readonly TurnAgentFacts[],
  startedAt: number,
): number | undefined {
  if (!Number.isFinite(startedAt)) return undefined;
  for (let turn = turns.length - 1; turn >= 0; turn -= 1)
    if (turns[turn].startedAt <= startedAt) return turn;
  return undefined;
}

function firstBy(
  records: readonly SubagentFact[],
  keyOf: (record: SubagentFact) => string | undefined,
): ReadonlyMap<string, SubagentFact> {
  const map = new Map<string, SubagentFact>();
  for (const record of records) {
    const key = keyOf(record);
    if (key !== undefined && !map.has(key)) map.set(key, record);
  }
  return map;
}

function nodeRow(
  node: AgentNodeFact,
  record: SubagentFact | undefined,
  capacities: readonly ContextCapacity[],
): PtahUiAgentRow {
  if (record === undefined)
    return {
      key: `sdk-node:${node.id}`,
      name: nonEmpty(node.agentType),
      status: normalizeAgentStatus(node.status),
      tokens: amountOrNull(node.tokens),
      cost: amountOrNull(node.cost),
      durationMs: amountOrNull(node.durationMs),
      context: null,
    };
  const fromRecord = recordRow(record, capacities);
  const recordStatus = fromRecord.status;
  return {
    key: fromRecord.key,
    name: fromRecord.name ?? nonEmpty(node.agentType),
    status: isTerminal(recordStatus)
      ? normalizeAgentStatus(node.status)
      : recordStatus,
    tokens: amountOrNull(node.tokens) ?? fromRecord.tokens,
    cost: amountOrNull(node.cost) ?? fromRecord.cost,
    durationMs: amountOrNull(node.durationMs) ?? fromRecord.durationMs,
    context: fromRecord.context,
  };
}

function recordRow(
  record: SubagentFact,
  capacities: readonly ContextCapacity[],
): PtahUiAgentRow {
  return {
    key: `sdk:${record.parentToolUseId}`,
    name: nonEmpty(record.teammateName) ?? nonEmpty(record.agentType),
    status: normalizeAgentStatus(record.status),
    tokens: recordTokens(record),
    cost: amountOrNull(record.cost),
    durationMs: amountOrNull(record.durationMs),
    context: recordContext(record, capacities),
  };
}

function laneRow(lane: CliLaneFact): PtahUiAgentRow {
  return {
    key: `cli:${lane.agentId}`,
    name: nonEmpty(lane.displayName) ?? nonEmpty(lane.cli),
    status: normalizeAgentStatus(lane.status),
    tokens: amountOrNull(lane.tokens),
    cost: amountOrNull(lane.cost),
    durationMs: amountOrNull(lane.durationMs),
    // decisions.md #16: CLI lanes report no context figure in this task.
    context: null,
  };
}

/** R tokens are usage input + output, else the last reported total. */
function recordTokens(record: SubagentFact): number | null {
  const input = amountOrNull(record.inputTokens);
  const output = amountOrNull(record.outputTokens);
  if (input !== null && output !== null) return input + output;
  return amountOrNull(record.totalTokens);
}

function recordContext(
  record: SubagentFact,
  capacities: readonly ContextCapacity[],
): PtahUiAgentContext | null {
  const tokens = amountOrNull(record.contextTokens);
  if (tokens === null) return null;
  const limit =
    record.model === undefined ? null : knownLimit(capacities, record.model);
  return {
    tokens,
    percent: limit === null ? null : Math.round((tokens / limit) * 1000) / 10,
  };
}

/**
 * The limit is known only from capacity evidence for the exact model id whose
 * source is `sdk-native`, or `provider-catalog` with a non-empty provider, and
 * whose tokens are positive and finite. This restates the header badge rule
 * (`session-live-stats.util.ts`); no model-family or pricing window is used.
 */
function knownLimit(
  capacities: readonly ContextCapacity[],
  model: string,
): number | null {
  for (const capacity of capacities) {
    if (
      capacity.model === model &&
      (capacity.source === 'sdk-native' ||
        (capacity.source === 'provider-catalog' &&
          typeof capacity.providerId === 'string' &&
          capacity.providerId.length > 0)) &&
      typeof capacity.tokens === 'number' &&
      Number.isFinite(capacity.tokens) &&
      capacity.tokens > 0
    )
      return capacity.tokens;
  }
  return null;
}

function aggregate(rows: readonly PtahUiAgentRow[]): PtahUiAgentsScalars {
  let running = 0;
  let completed = 0;
  let failed = 0;
  let tokens: number | null = 0;
  let cost: number | null = 0;
  for (const row of rows) {
    if (row.status === 'running') running += 1;
    else if (row.status === 'completed') completed += 1;
    else if (row.status === 'failed') failed += 1;
    tokens =
      tokens === null || row.tokens === null ? null : tokens + row.tokens;
    cost = cost === null || row.cost === null ? null : cost + row.cost;
  }
  return { total: rows.length, running, completed, failed, tokens, cost };
}

function isTerminal(status: PtahUiAgentStatus): boolean {
  return status !== 'pending' && status !== 'running';
}

function amountOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value.trim().length === 0 ? null : value;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
