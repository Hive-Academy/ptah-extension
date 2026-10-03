/**
 * Shared vocabulary of the measurement tool M (TASK_2026_597, component 10).
 *
 * Every reader (Codex rollouts, OpenCode `opencode.db`, Claude transcripts)
 * turns one session into a {@link LaneMetrics} row. The arithmetic that makes
 * those rows comparable across vendors lives here, once:
 *
 * - "first" is the input size of the session's first request, "peak" the
 *   largest single request, "total" the sum over every request. A request's
 *   input is everything the model was sent, cached or not, because every tool
 *   call resends the whole thread.
 * - A Ptah lane is recognised by the completion contract that
 *   `buildTaskPrompt` (`cli-adapter.utils.ts`) always appends to a lane's task
 *   prompt. Codex lanes must also carry `originator=codex_sdk_ts` and
 *   `source=exec` in `session_meta` (R1.2).
 *
 * - Limit: OpenCode and Claude lanes are recognised by the marker alone (no
 *   origin field exists there), and the contract landed on 2026-09-21
 *   (`lane-reporting-contract.ts`, TASK_2026_515). A lane started before that
 *   date, or by a spawn path that does not append the contract, is invisible
 *   to M. `--lanes` prints the first date the marker is seen in the window.
 * - Start times are UTC ISO-8601 instants for every vendor. Codex names its
 *   rollouts in local time; the Codex reader converts that to an instant.
 *
 * No prompt text leaves a reader: the readers test for the marker while they
 * parse and keep only the boolean.
 */

/**
 * The heading `renderLaneCompletionContract`
 * (`libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-reporting-contract.ts`)
 * opens its block with. `lane-metrics.spec.ts` pins it against the real
 * function, so a reworded contract fails a test instead of silently making
 * every lane invisible to M.
 */
export const LANE_CONTRACT_MARKER = '## Before you exit';

/** The `session_meta` values the Ptah Codex spawn path writes (R1.2). */
export const PTAH_CODEX_ORIGINATOR = 'codex_sdk_ts';
export const PTAH_CODEX_SOURCE = 'exec';

export type Vendor = 'codex' | 'opencode' | 'claude';

/**
 * True when the text holds `heading` at the start of a line. A heading quoted
 * inline (`see "## Before you exit"`) does not count.
 */
export function hasHeadingAtLineStart(text: string, heading: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(heading, from);
    if (at === -1) return false;
    if (at === 0 || text[at - 1] === '\n') return true;
    from = at + 1;
  }
}

/** True when any of the given texts holds the lane completion contract. */
export function hasLaneContractMarker(texts: readonly string[]): boolean {
  return texts.some((text) =>
    hasHeadingAtLineStart(text, LANE_CONTRACT_MARKER),
  );
}

/**
 * The header `renderRoleBlock` (`cli-adapter.utils.ts`) opens every role block
 * with: `## Role: <name>`. Codex receives the block as
 * `developer_instructions`; other CLIs get it inside the task prompt.
 * `codex-rollout.reader.spec.ts` pins it against the renderer's source.
 */
export const ROLE_BLOCK_HEADER = '## Role: ';

/** True when the text opens (or holds, at a line start) a Ptah role block. */
export function hasRoleBlockHeader(text: string): boolean {
  return hasHeadingAtLineStart(text, ROLE_BLOCK_HEADER);
}

/** R1.2: originator AND source AND the contract marker in the first request. */
export function isPtahCodexLane(input: {
  readonly originator: string | null;
  readonly source: string | null;
  readonly hasLaneMarker: boolean;
}): boolean {
  return (
    input.originator === PTAH_CODEX_ORIGINATOR &&
    input.source === PTAH_CODEX_SOURCE &&
    input.hasLaneMarker
  );
}

export interface RequestStats {
  readonly requests: number;
  readonly firstInput: number;
  readonly peakInput: number;
  readonly totalInput: number;
}

/**
 * First, peak and total over per-request input sizes in arrival order.
 * Non-positive sizes are not requests (a `token_count` event with no usage),
 * so they are skipped rather than counted as a zero-sized request.
 */
export function requestStats(inputs: readonly number[]): RequestStats {
  let requests = 0;
  let firstInput = 0;
  let peakInput = 0;
  let totalInput = 0;
  for (const size of inputs) {
    if (!(size > 0)) continue;
    if (requests === 0) firstInput = size;
    requests++;
    if (size > peakInput) peakInput = size;
    totalInput += size;
  }
  return { requests, firstInput, peakInput, totalInput };
}

export interface ToolOutputSize {
  readonly tool: string;
  readonly chars: number;
}

/** The larger of two tool outputs; the first wins a tie. */
export function largerToolOutput(
  current: ToolOutputSize | null,
  candidate: ToolOutputSize,
): ToolOutputSize {
  return current === null || candidate.chars > current.chars
    ? candidate
    : current;
}

/** One session, reduced to the numbers `--lanes` prints. */
export interface LaneMetrics {
  readonly vendor: Vendor;
  readonly id: string;
  /** Session start as a UTC ISO-8601 instant, or null when unknown. */
  readonly startedAt: string | null;
  readonly isPtahLane: boolean;
  readonly model: string;
  readonly effort: string;
  readonly requests: number;
  readonly firstInput: number;
  readonly peakInput: number;
  readonly totalInput: number;
  readonly cached: number;
  readonly output: number;
  readonly largestToolOutput: ToolOutputSize | null;
  readonly compactions: number;
}

/**
 * A store M looked for and could not use. A missing store or an unreadable
 * line never aborts the report; it is listed here and the report still prints.
 */
export interface SkippedSource {
  readonly vendor: Vendor;
  readonly location: string;
  readonly reason: string;
}

/** UTC ISO-8601 of an epoch-ms, or null when it is not a valid instant. */
export function isoInstant(epochMs: number): string | null {
  if (!Number.isFinite(epochMs)) return null;
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Lanes ordered by start instant; lanes without a start time go last. */
export function sortLanesByStart(lanes: readonly LaneMetrics[]): LaneMetrics[] {
  const key = (lane: LaneMetrics): number => {
    const ms = lane.startedAt === null ? NaN : Date.parse(lane.startedAt);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return [...lanes].sort((a, b) => key(a) - key(b));
}

/** `YYYY-MM-DD` of an epoch-ms in the machine's local time zone. */
export function localDate(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const formatMillions = (n: number): string => (n / 1e6).toFixed(2) + 'M';

export const percentOf = (part: number, whole: number): number =>
  Math.round((100 * part) / Math.max(1, whole));

/** One fixed-width line per lane; the header is {@link LANE_TABLE_HEADER}. */
export function formatLaneRow(lane: LaneMetrics): string {
  const tool = lane.largestToolOutput
    ? `${lane.largestToolOutput.chars}(${lane.largestToolOutput.tool})`
    : '-';
  // Display zone: UTC, `YYYY-MM-DD HH:MM`.
  const started = lane.startedAt
    ? lane.startedAt.slice(0, 16).replace('T', ' ')
    : '-';
  return [
    lane.vendor.padEnd(8),
    started.padEnd(16),
    lane.id.padEnd(24).slice(0, 24),
    (lane.model || '?').padEnd(22).slice(0, 22),
    (lane.effort || '-').padEnd(8).slice(0, 8),
    String(lane.firstInput).padStart(8),
    String(lane.peakInput).padStart(8),
    formatMillions(lane.totalInput).padStart(8),
    `${percentOf(lane.cached, lane.totalInput)}%`.padStart(5),
    String(lane.output).padStart(8),
    String(lane.requests).padStart(5),
    String(lane.compactions).padStart(4),
    ` ${tool}`,
  ].join(' ');
}

export const LANE_TABLE_HEADER = [
  'vendor'.padEnd(8),
  'started (UTC)'.padEnd(16),
  'session'.padEnd(24),
  'model'.padEnd(22),
  'effort'.padEnd(8),
  'first'.padStart(8),
  'peak'.padStart(8),
  'total'.padStart(8),
  'cache'.padStart(5),
  'output'.padStart(8),
  'reqs'.padStart(5),
  'cmpt'.padStart(4),
  ' largest tool output chars(tool)',
].join(' ');
