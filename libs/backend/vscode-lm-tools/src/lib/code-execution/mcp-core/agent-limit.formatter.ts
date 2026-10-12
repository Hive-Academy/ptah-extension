/**
 * Plan-limit text for the agent tools (TASK_2026_596, design §5).
 *
 * `ptah_agent_list` gets a `Limit state` column, a `### Plan limits` table and
 * an `### Alternatives by limit state` section; `ptah_agent_spawn` gets a
 * `**Limit state:**` line, an optional warning or estimate note, an optional
 * cooldown line and the alternatives section. Sentences follow design §5 and
 * the prototype's tool-text renderer. No static string names a vendor (R8).
 */
import {
  formatRelative,
  formatToolInstant,
  formatToolResetText,
  formatToolSourceText,
  formatToolUtc,
  formatUsed,
  groupAlternatives,
  usedPercent,
  windowObservedAt,
  type ClassifiedWindow,
  type CliDetectionResult,
  type LaneLimitState,
  type LaneStateReason,
  type OwnerLimitEvidence,
  type PlanLimitCooldown,
  type PlanWindowBlockingState,
  type PlanWindowState,
} from '@ptah-extension/shared';
import type { LaneLimitResult } from '@ptah-extension/cli-agent-runtime';

export type AgentLimit = LaneLimitResult<CliDetectionResult>;
export type AgentLimitTarget = Pick<CliDetectionResult, 'cli' | 'ptahCliId'>;

/** Stable lane key: two Ptah CLI agents differ by `ptahCliId`. */
export function targetRowKey(target: AgentLimitTarget): string {
  return `${target.cli}:${target.ptahCliId ?? ''}`;
}

export function findAgentLimit(
  limits: readonly AgentLimit[],
  target: AgentLimitTarget,
): AgentLimit | undefined {
  const key = targetRowKey(target);
  return limits.find((limit) => targetRowKey(limit.row) === key);
}

/**
 * The lane a spawn request names. A Ptah CLI id wins over `cli`, as it does in
 * `agent.spawn`; `undefined` when the CLI is auto-detected.
 */
export function spawnRequestTarget(request: {
  readonly cli?: CliDetectionResult['cli'];
  readonly ptahCliId?: string;
}): AgentLimitTarget | undefined {
  if (request.ptahCliId) {
    return { cli: 'ptah-cli', ptahCliId: request.ptahCliId };
  }
  return request.cli ? { cli: request.cli } : undefined;
}

/** Design §2.2 reason labels for a window that blocks confirmed room. */
const WINDOW_STATE_REASON: Readonly<Record<PlanWindowBlockingState, string>> = {
  'reset-usage-unknown': 'reset passed, usage unknown',
  'usage-unknown': 'usage unknown',
  'estimate-only': 'estimate only',
  aged: 'aged value',
  'not-confirmed': 'last reset unknown',
};

/** `### Plan limits` State cell per window state (design §5.1). */
const WINDOW_STATE_CELL: Readonly<Record<PlanWindowState, string>> = {
  'limit-reached': 'LIMIT REACHED',
  'near-limit': 'near limit',
  aged: 'aged',
  'not-confirmed': 'not confirmed (last reset unknown)',
  'usage-unknown': 'unknown',
  'reset-usage-unknown': 'reset passed, usage unknown',
  'estimate-only': 'estimate',
  ok: 'ok',
};

function reasonText(reason: LaneStateReason): string {
  switch (reason.kind) {
    case 'lookup-failed':
      return reason.failure === 'timed-out'
        ? 'limit lookup timed out'
        : 'limit lookup failed';
    case 'owner-limit':
      return 'at limit, window unknown';
    case 'window-limit':
      return `${reason.window.label}: limit reached`;
    case 'window-near-limit':
      return `${reason.window.label} ${formatUsed(reason.window.used)}`;
    case 'window-state':
      return `${reason.window.label}: ${WINDOW_STATE_REASON[reason.state]}`;
    case 'model-scope-unknown':
      return 'model scope unknown';
    case 'estimated-limit':
      return 'estimated limit';
    case 'cooldown-active':
      return 'cooldown active';
    case 'stale':
      return 'aged value';
    case 'no-usage-source':
      return 'no usage source';
    case 'no-snapshot':
      return 'limits not tracked';
    case 'no-windows':
      return 'no windows reported';
    case 'window-set-not-established':
      return 'window set not established, partial data';
    case 'status':
      return reason.status.replaceAll('-', ' ');
  }
}

/** The lane name the tool text uses: the agent name for a Ptah CLI lane. */
export function rowName(limit: AgentLimit): string {
  return limit.row.cli === 'ptah-cli'
    ? (limit.row.ptahCliName ?? 'Unknown')
    : limit.row.cli;
}

function resetPhrase(resetsAt: number | undefined, now: number): string {
  return resetsAt === undefined
    ? 'reset unknown'
    : `resets ${formatToolInstant(resetsAt, now)}`;
}

/** Active, non-estimated owner-level evidence that put the lane at its limit. */
function ownerLimitEvidence(limit: AgentLimit): OwnerLimitEvidence | undefined {
  for (const reason of limit.state.reasons) {
    if (reason.kind === 'owner-limit') return reason.evidence;
  }
  return undefined;
}

function hasNoUsageSource(limit: AgentLimit): boolean {
  return limit.snapshot?.status === 'no-usage-source';
}

function activeCooldown(
  limit: AgentLimit,
  now: number,
): PlanLimitCooldown | undefined {
  const cooldown = limit.snapshot?.cooldown;
  return cooldown !== undefined && cooldown.until > now ? cooldown : undefined;
}

/**
 * Why a lane blocks a spawn. `window` and `owner` are the engine's own
 * at-limit hits; `cooldown` is an active retry delay; `full-window` is a fresh
 * reading of 100 % or more, which the engine files as near limit because it
 * carries no exhaustion evidence. `resetsAt` is absent when any hit has no
 * known reset.
 */
export interface LaneBlock {
  readonly kind: 'window' | 'owner' | 'cooldown' | 'full-window';
  readonly resetsAt?: number;
  readonly detail: string;
}

/** The latest reset of every hit, or `undefined` when any reset is unknown. */
function latestReset(
  resets: readonly (number | undefined)[],
): number | undefined {
  if (resets.length === 0) return undefined;
  let latest = -Infinity;
  for (const resetsAt of resets) {
    if (resetsAt === undefined) return undefined;
    latest = Math.max(latest, resetsAt);
  }
  return latest;
}

function atLimitBlock(limit: AgentLimit): LaneBlock {
  const evidence = ownerLimitEvidence(limit);
  const resets: (number | undefined)[] = [];
  const labels: string[] = [];
  for (const reason of limit.state.reasons) {
    if (reason.kind === 'owner-limit') resets.push(reason.evidence.resetsAt);
    if (reason.kind === 'window-limit') {
      resets.push(reason.window.resetsAt ?? reason.evidence.resetsAt);
      labels.push(reason.window.label);
    }
  }
  return {
    kind: evidence ? 'owner' : 'window',
    resetsAt: latestReset(resets),
    detail: evidence
      ? 'usage limit hit, window unknown'
      : `${labels.join(', ')} limit reached`,
  };
}

/** A fresh applicable window that reads 100 % used and has not reset yet. */
function fullWindow(
  limit: AgentLimit,
  now: number,
): ClassifiedWindow | undefined {
  return limit.state.windows.find(
    ({ window, state }) =>
      (state === 'near-limit' || state === 'ok') &&
      (usedPercent(window.used) ?? 0) >= 100 &&
      (window.resetsAt === undefined || window.resetsAt > now),
  );
}

/**
 * Whether the lane is at its limit for a spawn, and why. Pure: a lane with no
 * snapshot only blocks on the engine's own at-limit state.
 */
export function laneBlock(
  limit: AgentLimit,
  now: number,
): LaneBlock | undefined {
  if (!limit.snapshot) return undefined;
  if (limit.state.state === 'at-limit') return atLimitBlock(limit);
  const cooldown = activeCooldown(limit, now);
  if (cooldown) {
    return {
      kind: 'cooldown',
      resetsAt: cooldown.until,
      detail: 'cooldown active',
    };
  }
  const full = fullWindow(limit, now);
  if (full) {
    return {
      kind: 'full-window',
      resetsAt: full.window.resetsAt,
      detail: `${full.window.label} ${formatUsed(full.window.used)}`,
    };
  }
  return undefined;
}

/**
 * The lane state the tool text and the spawn gate share: a lane that blocks a
 * spawn reads as at its limit even when the engine filed it otherwise.
 */
export function effectiveLaneState(
  limit: AgentLimit,
  now: number,
): LaneLimitState {
  return laneBlock(limit, now) ? 'at-limit' : limit.state.state;
}

/** Status words for a snapshot whose reader could not measure the lane. */
const UNKNOWN_STATUS_CAUSE: Readonly<
  Partial<Record<NonNullable<AgentLimit['snapshot']>['status'], string>>
> = {
  'no-usage-source': 'no usage source',
  stale: 'reader failed, aged value',
  'provider-unsupported': 'no reader for provider',
  'unsupported-config': 'credential missing',
  'unsupported-auth': 'API key, no plan',
  'cli-unavailable': 'cli unavailable',
  'cli-version-unsupported': 'cli version unsupported',
};

/**
 * The one short cause of an unknown lane state: why the limit could not be
 * read. It wins over the first engine reason for the column and the
 * alternatives detail.
 */
export function unknownCause(limit: AgentLimit): string {
  switch (limit.lookup) {
    case 'no-owner':
      return 'limits not tracked';
    case 'timeout':
      return 'limit lookup timed out';
    case 'failed':
      return 'limit lookup failed';
    default:
      break;
  }
  const snapshot = limit.snapshot;
  if (snapshot?.status === 'service-unavailable') {
    return snapshot.unavailableReason === 'no-open-session'
      ? 'no open session'
      : 'reader failed';
  }
  const statusCause = snapshot && UNKNOWN_STATUS_CAUSE[snapshot.status];
  if (statusCause) return statusCause;
  const first = limit.state.reasons[0];
  return first ? reasonText(first) : 'limits not tracked';
}

function blockedColumn(block: LaneBlock): string {
  if (block.kind === 'cooldown') {
    return `AT LIMIT (cooldown, retry after ${block.resetsAt === undefined ? 'an unknown time' : formatToolUtc(block.resetsAt)})`;
  }
  const reset =
    block.resetsAt === undefined
      ? 'reset unknown'
      : 'resets ' + formatToolUtc(block.resetsAt);
  return `AT LIMIT (${block.detail}, ${reset})`;
}

/** The list's `Limit state` cell and the spawn's `**Limit state:**` value. */
export function formatLimitColumn(limit: AgentLimit, now = Date.now()): string {
  const { state, reasons, windows } = limit.state;
  if (state === 'at-limit') {
    const evidence = ownerLimitEvidence(limit);
    if (evidence) {
      const noSource = hasNoUsageSource(limit) ? ' · no usage source' : '';
      return `AT LIMIT (window unknown, ${resetPhrase(evidence.resetsAt, now)}) [${evidence.source}]${noSource}`;
    }
    const hits = reasons.flatMap((reason) =>
      reason.kind === 'window-limit' ? [reason] : [],
    );
    return `AT LIMIT (${hits
      .map(({ window, evidence }) => {
        const resetsAt = window.resetsAt ?? evidence.resetsAt;
        return `${window.label}, ${resetsAt === undefined ? 'reset unknown' : `resets ${formatToolUtc(resetsAt)}`}`;
      })
      .join('; ')})`;
  }
  const block = laneBlock(limit, now);
  if (block) return blockedColumn(block);
  if (state === 'near-limit') {
    const near = windows.find((entry) => entry.state === 'near-limit');
    return near
      ? `near limit (${near.window.label} ${formatUsed(near.window.used)})`
      : 'near limit';
  }
  if (state === 'confirmed-room') return 'confirmed room';
  return `unknown (${unknownCause(limit)})`;
}

function table(headers: readonly string[], rows: readonly string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function planLimitRows(limit: AgentLimit, now: number): string[][] {
  const name = rowName(limit);
  const { windows, reasons } = limit.state;
  if (windows.length > 0) {
    return windows.map(({ window, state }) => [
      name,
      window.label,
      window.used === undefined || state === 'reset-usage-unknown'
        ? 'unknown'
        : formatUsed(window.used),
      WINDOW_STATE_CELL[state],
      formatToolResetText(window, now),
      formatToolSourceText(window),
    ]);
  }
  const evidence = ownerLimitEvidence(limit);
  const noSource = hasNoUsageSource(limit);
  if (evidence || noSource) {
    return [
      [
        name,
        '(none)',
        noSource ? 'no usage source' : 'no windows reported',
        evidence ? 'AT LIMIT (owner level, window unknown)' : 'unknown',
        evidence ? resetPhrase(evidence.resetsAt, now) : '-',
        evidence ? evidence.source : '-',
      ],
    ];
  }
  return [
    [
      name,
      '(none)',
      'unknown',
      reasons[0] ? reasonText(reasons[0]) : 'unknown',
      '-',
      '-',
    ],
  ];
}

/**
 * The `### Plan limits` rows, one per lane per window (or one `(none)` row),
 * in list order. Cells: Agent, Window, Used, State, Reset, Source. The list's
 * table and the `$limits` host read both use this one implementation, so the
 * two never drift; missing values keep the list's own words ("unknown",
 * "reset unknown", "-").
 */
export function formatPlanLimitRows(
  limits: readonly AgentLimit[],
  now = Date.now(),
): string[][] {
  return limits.flatMap((limit) => planLimitRows(limit, now));
}

export function formatPlanLimitsSection(
  limits: readonly AgentLimit[],
  now = Date.now(),
): string {
  const rows = formatPlanLimitRows(limits, now);
  return `### Plan limits\n\n${table(['Agent', 'Window', 'Used', 'State', 'Reset', 'Source'], rows)}`;
}

function windowFlag({ window, state }: ClassifiedWindow, now: number): string {
  switch (state) {
    case 'aged':
      return ` (aged, observed ${formatRelative(windowObservedAt(window), now)})`;
    case 'near-limit':
      return ' (near limit)';
    case 'limit-reached':
      return ' (LIMIT REACHED)';
    case 'not-confirmed':
      return ' (not confirmed, last reset unknown)';
    case 'estimate-only':
      return ' (estimate)';
    default:
      return '';
  }
}

/** One window inside an alternatives line: every known reset is printed. */
function windowLine(entry: ClassifiedWindow, now: number): string {
  const { window, state } = entry;
  const source = formatToolSourceText(window);
  const tag = source === '-' ? '' : ` [${source}]`;
  const reset = formatToolResetText(window, now);
  if (state === 'reset-usage-unknown') {
    return `${window.label} usage unknown, ${reset}${tag}`;
  }
  const used =
    window.used === undefined ? 'used unknown' : formatUsed(window.used);
  return `${window.label} ${used}${windowFlag(entry, now)}, ${reset}${tag}`;
}

/** What an alternatives line says for a lane with no applicable window. */
function noWindowsDetail(limit: AgentLimit): string {
  const first = limit.state.reasons[0];
  if (first?.kind === 'lookup-failed') {
    return `${reasonText(first)}; no windows known`;
  }
  if (limit.lookup === 'no-owner' || first?.kind === 'no-snapshot') {
    return 'limits not tracked, no limit recorded';
  }
  if (hasNoUsageSource(limit)) {
    return 'no usage source, no limit recorded';
  }
  if (first === undefined || first.kind === 'no-windows') {
    return 'no windows reported';
  }
  return `${unknownCause(limit)}; no windows reported`;
}

function alternativeLine(limit: AgentLimit, now: number): string {
  const { windows } = limit.state;
  const parts: string[] = [];
  const evidence = ownerLimitEvidence(limit);
  if (evidence) {
    parts.push(
      `at limit, window unknown, ${resetPhrase(evidence.resetsAt, now)} [${evidence.source}]`,
    );
  }
  if (windows.length > 0) {
    parts.push(windows.map((entry) => windowLine(entry, now)).join('; '));
  } else if (!evidence) {
    parts.push(noWindowsDetail(limit));
  } else if (hasNoUsageSource(limit)) {
    parts[0] += ' · no usage source';
  }
  const cooldown = activeCooldown(limit, now);
  if (cooldown) {
    parts.push(
      `cooldown until ${formatToolInstant(cooldown.until, now)}, a retry delay, not a plan reset`,
    );
  }
  if (effectiveLaneState(limit, now) === 'unknown' && windows.length > 0) {
    parts.unshift(`not confirmed: ${unknownCause(limit)}`);
  }
  return `- ${rowName(limit)}: ${parts.join('. ')}`;
}

const NO_LANES_GROUPS = [
  '**Confirmed room:** none',
  '**Near limit:** none',
  '**Unknown:** none',
  '**At limit:** none',
];

export function formatAlternatives(
  limits: readonly AgentLimit[],
  options: { targetRowKey?: string; now?: number } = {},
): string {
  const now = options.now ?? Date.now();
  const hasTarget = options.targetRowKey !== undefined;
  const rows = hasTarget
    ? limits.filter((limit) => targetRowKey(limit.row) !== options.targetRowKey)
    : limits;
  if (rows.length === 0) {
    const who = hasTarget ? 'No other lanes are' : 'No lanes are';
    return [
      `### Alternatives by limit state\n${who} available to list. This does not mean any lane is at its limit.`,
      ...NO_LANES_GROUPS,
    ].join('\n\n');
  }
  const groups = groupAlternatives(
    rows.map((limit) => ({ limit, state: effectiveLaneState(limit, now) })),
  );
  const who = hasTarget ? 'other lane' : 'lane';
  const intro =
    groups.confirmedRoom.length > 0
      ? undefined
      : groups.nearLimit.length === 0 && groups.unknown.length === 0
        ? `No ${who} has room: every ${who} is at its limit. Known resets are listed below.`
        : `No ${who} has confirmed room. Near-limit and unknown lanes may still work; every known reset is listed below.`;
  const section = (
    name: string,
    entries: readonly { readonly limit: AgentLimit }[],
  ): string =>
    entries.length === 0
      ? `**${name}:** none`
      : `**${name}:**\n${entries.map(({ limit }) => alternativeLine(limit, now)).join('\n')}`;
  return [
    `### Alternatives by limit state${intro ? `\n${intro}` : ''}`,
    section('Confirmed room', groups.confirmedRoom),
    section('Near limit', groups.nearLimit),
    section('Unknown', groups.unknown),
    section('At limit', groups.atLimit),
  ].join('\n\n');
}

/** A WARNING for an at-limit or near-limit lane; never for an estimate. */
function spawnWarning(
  limit: AgentLimit,
  outcome: string,
  now: number,
): string | undefined {
  const evidence = ownerLimitEvidence(limit);
  if (evidence) {
    return `> WARNING: ${rowName(limit)} hit a usage limit at ${formatToolUtc(evidence.observedAt)} [${evidence.source}]. Window unknown, ${resetPhrase(evidence.resetsAt, now)}. ${outcome}`;
  }
  const { state, windows } = limit.state;
  if (state !== 'at-limit' && state !== 'near-limit') return undefined;
  const flagged = state === 'at-limit' ? 'limit-reached' : 'near-limit';
  const details = windows
    .filter((entry) => entry.state === flagged)
    .map(({ window, state: windowState }) => {
      const used = window.used
        ? `${formatUsed(window.used)} used`
        : 'at its limit';
      const reached = windowState === 'limit-reached' ? ' (limit reached)' : '';
      return `${window.label} is ${used}${reached}; ${formatToolResetText(window, now)} [${formatToolSourceText(window)}]`;
    });
  return `> WARNING: ${details.join('. ')}. ${outcome}`;
}

/** A WARNING for a lane the gate blocks but the engine did not file at limit. */
function blockWarning(
  limit: AgentLimit,
  block: LaneBlock,
  outcome: string,
  now: number,
): string {
  const detail =
    block.kind === 'cooldown'
      ? 'is in a cooldown, a retry delay'
      : `is at its plan limit (${block.detail}); ${resetPhrase(block.resetsAt, now)}`;
  return `> WARNING: ${rowName(limit)} ${detail}. ${outcome}`;
}

/**
 * The estimate note for a lane that is neither at nor near its limit. Every
 * window and reason is checked: `classifyLaneState` lists estimated limits
 * after the lookup, status, window-set, scope and cooldown reasons.
 */
function estimateNote(limit: AgentLimit, now: number): string | undefined {
  const estimated = limit.state.windows.find(
    (entry) => entry.state === 'estimate-only',
  );
  if (estimated) {
    const { window } = estimated;
    return `> Note (estimate, not a warning): ${window.label} estimated at ${formatUsed(window.used)} used [estimated]; no provider confirmation.`;
  }
  for (const reason of limit.state.reasons) {
    if (reason.kind === 'estimated-limit') {
      return `> Note (estimate, not a warning): estimated limit reached, ${resetPhrase(reason.evidence.resetsAt, now)} [estimated]; no provider confirmation.`;
    }
  }
  return undefined;
}

/**
 * The spawn's limit block. `target` is the lane the spawn ran on (success) or
 * the lane the request named (failure, `attempted`); both resolve to the same
 * row, so a failed spawn shows the same `Limit state` as a successful one.
 */
export function formatSpawnLimitBlock(
  limits: readonly AgentLimit[],
  target: AgentLimitTarget | undefined,
  attempted: boolean,
  now = Date.now(),
  options: { readonly forced?: boolean } = {},
): string {
  const alternatives = formatAlternatives(limits, {
    targetRowKey: target ? targetRowKey(target) : undefined,
    now,
  });
  const limit = target ? findAgentLimit(limits, target) : undefined;
  if (!limit) {
    return [
      '**Limit state:** unknown (limit lookup failed)',
      alternatives,
    ].join('\n\n');
  }
  let outcome = 'The spawn was still started.';
  if (options.forced) outcome = 'The spawn was forced past the limit gate.';
  else if (attempted) outcome = 'The spawn was still attempted.';
  const lines = [`**Limit state:** ${formatLimitColumn(limit, now)}`];
  const block = laneBlock(limit, now);
  let notice: string | undefined;
  if (limit.state.state === 'at-limit' || limit.state.state === 'near-limit') {
    notice = spawnWarning(limit, outcome, now);
  } else if (block) {
    notice = blockWarning(limit, block, outcome, now);
  } else {
    notice = estimateNote(limit, now);
  }
  if (notice) lines.push(notice);
  if (!block && limit.state.state === 'unknown') {
    lines.push(
      `> Note: limit state unknown (${unknownCause(limit)}); ${attempted ? 'attempted' : 'spawned'} without a limit check.`,
    );
  }
  const cooldown = activeCooldown(limit, now);
  if (cooldown) {
    lines.push(
      `**Cooldown:** retrying after ${formatToolInstant(cooldown.until, now)}. This is a retry delay, not a plan reset.`,
    );
  }
  return [...lines, alternatives].join('\n\n');
}
