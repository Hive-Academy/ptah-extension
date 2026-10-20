/**
 * Pure plan-tile view-model mapping.
 *
 * One compact, uniform tile per quota owner: a header, ONE primary bar for
 * the most constrained eligible window, compact chips for the other windows,
 * one secondary metric line and a status pill in the bar slot when no
 * window is eligible. Extracted from the former 838-line
 * `provider-account-card.component.ts`, which now keeps only owner
 * discovery, selection and refresh.
 *
 * Pure: `now` and the time options are parameters, so the mapping is
 * reproducible under test and re-evaluates on every shared-clock tick
 * without a per-tile timer. Never fabricates a value: an unknown used value
 * or reset is labelled, never rendered as 0.
 */
import {
  activeEstimatedExhaustion,
  activeWindowExhaustion,
  classifyWindow,
  formatLocalAbsolute,
  formatLocalWithRelative,
  formatRelative,
  formatUsed,
  formatToolResetText,
  FRESHNESS_MS,
  isActiveLimitEvidence,
  NEAR_LIMIT_PERCENT,
  ownerDisplayLabel,
  PLAN_LIMIT_SOURCE_LABELS,
  resetPassage,
  usedPercent,
  windowFieldSources,
  windowObservedAt,
  type LocalTimeOptions,
  type OwnerLimitEvidence,
  type PlanLimitOwnerSnapshot,
  type PlanLimitStatusReason,
  type PlanLimitUnavailableReason,
  type PlanLimitWindow,
  type PlanWindowState,
  type PlanModelUsage,
  type ProviderAccountUsageStatus,
} from '@ptah-extension/shared';

export type Tone = 'success' | 'error' | 'warning' | 'info' | 'neutral';

/** Bar fill tone per window state; every state not listed is neutral. */
const BAR_TONES: Readonly<Partial<Record<PlanWindowState, Tone>>> = {
  'limit-reached': 'error',
  'near-limit': 'warning',
  ok: 'success',
};

const STATE_CHIPS: Readonly<Record<PlanWindowState, { glyph: string; text: string; tone: Tone } | null>> = {
  'limit-reached': { glyph: '■', text: 'Limit reached', tone: 'error' },
  'near-limit': { glyph: '▲', text: 'Near limit', tone: 'warning' },
  aged: { glyph: '◷', text: 'Aged', tone: 'neutral' },
  'usage-unknown': { glyph: '?', text: 'Usage unknown', tone: 'neutral' },
  'not-confirmed': { glyph: '?', text: 'Not confirmed', tone: 'neutral' },
  'reset-usage-unknown': {
    glyph: '↻',
    text: 'Reset · usage unknown',
    tone: 'neutral',
  },
  'estimate-only': { glyph: '~', text: 'Estimate only', tone: 'neutral' },
  ok: null,
};

/** One sentence per failure status (design §4); `stale` has its own notice. */
const STATUS_SENTENCES: Partial<Record<ProviderAccountUsageStatus, string>> = {
  'unsupported-auth':
    'No plan windows: this account signs in with an API key, which has no subscription limits.',
  'unsupported-config':
    'Usage cannot be read: the provider is not configured for a usage read.',
  'provider-unsupported':
    'Usage cannot be read: this provider has no usage source.',
  'cli-unavailable': 'Usage cannot be read: the provider CLI was not found.',
  'cli-version-unsupported':
    'Usage cannot be read: the installed provider CLI version does not report usage.',
  'service-unavailable':
    'Usage unavailable: the provider’s usage service did not return a readable response. No values are shown.',
};

/**
 * Plain action text for one typed status reason — the single map the tile
 * asks; the backend extends only data, never UI. One entry for every
 * `PlanLimitStatusReason` in the shared DTO, so a new reason fails to
 * compile here until it gets its sentence.
 */
export const PLAN_LIMIT_REASON_LABELS: Readonly<
  Record<PlanLimitStatusReason, string>
> = {
  'no-oauth': 'Not signed in to Antigravity (OAuth)',
  'no-local-server': 'Antigravity app is not running',
  'cli-unavailable': 'Antigravity CLI usage unavailable',
  'cli-not-found': 'Antigravity CLI (agy) not found',
  'cli-timeout': 'Antigravity CLI did not respond in time',
  'cli-not-signed-in': 'Sign in to the Antigravity CLI (run agy once)',
  'cli-exit-error': 'Antigravity CLI exited with an error',
  'cli-parse-failed': 'Antigravity CLI usage output not recognized',
  'api-key-no-subscription-quota':
    'No subscription quota for API-key login; local usage only',
  'balance-unavailable':
    'Plan limits unavailable right now; showing request counts',
  'balance-auth-rejected':
    'API key cannot read plan limits; showing request counts',
  'usage-auth-rejected': 'API key cannot read request counts',
};

/** The one route-level unavailable reason: no session to read from. */
const NO_OPEN_SESSION_LABEL =
  'No open session to read this account’s usage from.';

/**
 * The label for a typed reason, or `null` when the reason is not known.
 * Covers `PlanLimitStatusReason` and `PlanLimitUnavailableReason`; a runtime
 * value the map does not know falls back to `null`, never to a fabricated
 * sentence.
 */
export function planLimitReasonLabel(
  reason: PlanLimitStatusReason | PlanLimitUnavailableReason | undefined,
): string | null {
  if (reason === undefined) return null;
  if (reason === 'no-open-session') return NO_OPEN_SESSION_LABEL;
  return Object.hasOwn(PLAN_LIMIT_REASON_LABELS, reason)
    ? PLAN_LIMIT_REASON_LABELS[reason]
    : null;
}

/**
 * The header's two lines: the name with the
 * key suffix on line 1, the label's parenthesized qualifiers ("(owner
 * unknown)", "(key unavailable)") on a smaller muted second line, so the
 * meaningful part is never truncated away. A label without parentheses has
 * one line and `null` qualifiers. Whitespace the removal leaves behind is
 * collapsed away.
 */
export function tileTitleLines(
  label: string,
): { name: string; qualifier: string | null } {
  const qualifierParts = label.match(/\([^()]*\)/g);
  if (qualifierParts === null) return { name: label, qualifier: null };
  const name = label
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, qualifier: qualifierParts.join(' ') };
}

// ---------------------------------------------------------------------------
// Compact number formatting
// ---------------------------------------------------------------------------

const COMPACT_FORMAT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const EXACT_FORMAT = new Intl.NumberFormat('en-US');
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * A compact count: exact with separators below 10,000 ("2,588"), compact
 * above ("7.3B"), so small request counts keep their precision while large
 * token counts stay short.
 */
export function compactCount(value: number): string {
  if (!Number.isFinite(value)) return 'unknown';
  return Math.abs(value) < 10_000
    ? EXACT_FORMAT.format(value)
    : COMPACT_FORMAT.format(value);
}

/**
 * A compact token figure from a number or a decimal string (Codex reports
 * `lifetimeTokens` as a string, which can exceed the safe integer range).
 * Integer strings beyond the safe range are formatted through BigInt —
 * never through an unsafe `Number` coercion.
 */
export function compactTokens(value: number | string): string {
  if (typeof value === 'number') return compactCount(value);
  const raw = value.trim();
  if (!/^\d+$/.test(raw)) {
    // A decimal string is coerced only when it fits a safe number.
    if (!/^\d+(\.\d+)?$/.test(raw)) return 'unknown';
    const parsed = Number(raw);
    return Number.isFinite(parsed) && BigInt(Math.trunc(parsed)) <= MAX_SAFE
      ? compactCount(parsed)
      : 'unknown';
  }
  const big = BigInt(raw);
  return big <= MAX_SAFE ? compactCount(Number(big)) : COMPACT_FORMAT.format(big);
}

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

/** The ONE primary bar: the most constrained eligible window. */
export interface PlanTileBarView {
  /** Window label; also the accessible progressbar name base. */
  readonly name: string;
  /** Fill width, clamped to 0..100. */
  readonly percent: number;
  readonly roundedPercent: number;
  /** Accessible value ("94% used"); unknown is never a fabricated 0. */
  readonly valueText: string;
  readonly barTone: Tone;
  /** "Limit reached — resets …" headline when the window is exhausted. */
  readonly limitLine: string | null;
  /** Reset fact for the line under the bar. */
  readonly resetText: string;
  /** Full tooltip: value, resets, notes and sources. */
  readonly title: string;
}

/** One compact chip for a window that is not the primary bar. */
export interface PlanTileChipView {
  readonly key: string;
  readonly label: string;
  /** Compact used value: "73%", "$3.20 of $50.00" or "unknown". */
  readonly valueText: string;
  /** Compact reset: "in 5h 18m", "40m ago" or "reset unknown". */
  readonly resetText: string;
  /** `warning` at or above the near-limit percent, `error` when exhausted. */
  readonly tone: Tone;
  /** Full tooltip: state, reset facts, notes and sources. */
  readonly title: string;
}

/** Status pill that reserves the bar slot when no window is eligible. */
export interface PlanTileStatusPillView {
  readonly text: string;
  readonly tone: Tone;
}

/** The one secondary metric line (tokens/cost/requests/activity). */
export interface PlanTileSecondaryView {
  readonly text: string;
  readonly title: string;
  /** Screen-reader equivalent of tooltip-only detail (per-model counts). */
  readonly accessibleText: string | null;
}

/** An owner-level notice (evidence, cooldown), truncated with its tooltip. */
export interface PlanTileNoticeView {
  readonly key: string;
  readonly text: string;
  readonly tone: Tone;
  readonly title: string;
}

/**
 * One inline action on a tile, wired only to navigation that already
 * exists: `open-session` goes to the chat surface, `add-key` opens Settings
 * on the Providers tab focused on this provider.
 */
export interface PlanTileActionView {
  readonly kind: 'open-session' | 'add-key';
  readonly label: string;
  readonly providerId: string;
}

export interface PlanTileView {
  readonly key: string;
  readonly providerId: string;
  /** Generic label plus the short key suffix ("Claude account · a1b2"). */
  readonly label: string;
  /** Header line 1: the name with the key suffix, qualifiers removed. */
  readonly titleName: string;
  /** Header line 2: the label's parenthesized qualifiers, or `null`. */
  readonly titleQualifier: string | null;
  /** Header tooltip: the label plus the identity subtitle, when one exists. */
  readonly headerTitle: string;
  /** Plan badge text (e.g. "plus"), or `null` when no plan is known. */
  readonly planBadge: string | null;
  readonly bar: PlanTileBarView | null;
  readonly primaryValue: string | null;
  readonly primaryTone: Tone;
  readonly compactWindows: readonly PlanTileCompactWindow[];
  readonly shortReset: string | null;
  readonly accessibleLabel: string;
  readonly statusPill: PlanTileStatusPillView | null;
  readonly chips: readonly PlanTileChipView[];
  readonly secondary: PlanTileSecondaryView | null;
  readonly statusChip:
    | { icon: PlanTileStatusChipIcon; text: string; tone: Tone }
    | null;
  readonly statusNotice: string | null;
  readonly statusNoticeTone: Tone;
  readonly statusNoticeTitle: string | null;
  readonly action: PlanTileActionView | null;
  readonly evidence: readonly PlanTileNoticeView[];
  readonly cooldown: string | null;
  /** Windows hidden from the compact view, kept as tooltip lines. */
  readonly hiddenWindowNotes: readonly string[];
  readonly noUsageSource: boolean;
}

export interface PlanTileCompactWindow {
  readonly key: string;
  readonly label: string;
  readonly valueText: string;
  readonly percent: number | null;
  readonly tone: Tone;
  readonly title: string;
}

function shortWindowLabel(label: string): string {
  if (/^5[ -]?hour/i.test(label)) return '5h';
  if (/week/i.test(label)) return 'Wk';
  if (/month/i.test(label)) return 'Mo';
  return label;
}

// ---------------------------------------------------------------------------
// Per-window facts (shared by the bar and the chips)
// ---------------------------------------------------------------------------

interface WindowFacts {
  readonly state: PlanWindowState;
  readonly percent: number | undefined;
  readonly valueText: string;
  readonly limitLine: string | null;
  readonly resetLines: readonly string[];
  readonly note: string | null;
  readonly estimateNote: string | null;
  readonly sources: readonly string[];
}

function windowFacts(
  window: PlanLimitWindow,
  owner: PlanLimitOwnerSnapshot,
  now: number,
  time: LocalTimeOptions,
): WindowFacts {
  const state = classifyWindow(window, {
    now,
    nearLimitPercent: NEAR_LIMIT_PERCENT,
    freshnessMs: FRESHNESS_MS,
    status: owner.status,
  });
  const percent = usedPercent(window.used);
  const showValue = percent !== undefined && state !== 'reset-usage-unknown';
  const at = (instant: number) => formatLocalWithRelative(instant, now, time);

  let limitLine: string | null = null;
  let resetLines: string[] = [];
  let note: string | null = null;
  if (state === 'limit-reached') {
    const resetsAt = activeWindowExhaustion(window, now)?.resetsAt;
    limitLine =
      resetsAt !== undefined
        ? `Limit reached — resets ${at(resetsAt)}`
        : 'Limit reached — reset unknown';
  } else if (state === 'reset-usage-unknown') {
    const passage = resetPassage(window, now);
    if (passage !== undefined) {
      resetLines = [
        `Reset ${formatLocalAbsolute(passage.passedAt, now, time)} (${formatRelative(passage.passedAt, now)}) came after the last observation (${formatLocalAbsolute(passage.lastObservedAt, now, time)}): current usage unknown.`,
        passage.nextResetAt !== undefined
          ? `Next reset ${at(passage.nextResetAt)}`
          : 'Next reset unknown',
      ];
    }
  } else {
    resetLines = [resetText(window.resetsAt, now, time)];
    if (state === 'aged') {
      note = `${owner.status === 'stale' ? 'cached, ' : ''}observed ${formatRelative(windowObservedAt(window), now)}`;
    } else if (state === 'not-confirmed') {
      note = 'last reset unknown: freshness cannot be confirmed';
    }
  }

  const estimated = activeEstimatedExhaustion(window, now);
  return {
    state,
    percent,
    valueText: showValue ? `${formatUsed(window.used)} used` : 'Used: unknown',
    limitLine,
    resetLines,
    note,
    estimateNote:
      state !== 'limit-reached' && estimated !== undefined
        ? `Estimated limit hit (unconfirmed, informational) · ${resetPhrase(estimated.resetsAt, now, time)}`
        : null,
    sources: sourceLabels(window),
  };
}

function factsTitle(facts: WindowFacts): string {
  const lines = [facts.valueText, ...facts.resetLines];
  const chip = STATE_CHIPS[facts.state];
  if (chip) lines.push(chip.text);
  if (facts.limitLine) lines.push(facts.limitLine);
  if (facts.note) lines.push(facts.note);
  if (facts.estimateNote) lines.push(facts.estimateNote);
  if (facts.sources.length > 0) {
    lines.push(`Sources: ${facts.sources.join(' · ')}`);
  }
  return lines.join('\n');
}

/** "resets <time> · in …", "reset passed <time> · … ago" or "reset unknown". */
function resetPhrase(
  resetsAt: number | undefined,
  now: number,
  time: LocalTimeOptions,
): string {
  if (resetsAt === undefined || !Number.isFinite(resetsAt)) {
    return 'reset unknown';
  }
  const when = formatLocalWithRelative(resetsAt, now, time);
  return resetsAt <= now ? `reset passed ${when}` : `resets ${when}`;
}

/** `resetPhrase` as the leading words of a line. */
function resetText(
  resetsAt: number | undefined,
  now: number,
  time: LocalTimeOptions,
): string {
  if (resetsAt !== undefined && Number.isFinite(resetsAt) && resetsAt > now) {
    return `Resets ${formatRelative(resetsAt, now)} (${formatLocalAbsolute(resetsAt, now, time)})`;
  }
  const phrase = resetPhrase(resetsAt, now, time);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Compact chip reset: "in 5h 18m", "40m ago" or "reset unknown". */
function chipResetText(window: PlanLimitWindow, now: number): string {
  const resetsAt = window.resetsAt;
  return resetsAt !== undefined && Number.isFinite(resetsAt)
    ? formatRelative(resetsAt, now)
    : 'reset unknown';
}

function sourceLabels(window: PlanLimitWindow): string[] {
  return windowFieldSources(window).map(
    ({ source, fields }) =>
      `${fields.length === 3 ? '' : `${fields.join(' · ')} `}${PLAN_LIMIT_SOURCE_LABELS[source]}`,
  );
}

// ---------------------------------------------------------------------------
// Primary selection
// ---------------------------------------------------------------------------

/**
 * The most constrained eligible window: finite used percentage and a known,
 * future reset. Highest percent, then nearest reset, then stable window key.
 * A `reset-usage-unknown` window is never eligible — its value was
 * invalidated by a reset and must not be shown as a bar.
 */
function selectPrimary(
  windows: readonly PlanLimitWindow[],
  states: ReadonlyMap<string, PlanWindowState>,
  now: number,
): PlanLimitWindow | null {
  let best: { window: PlanLimitWindow; percent: number; resetsIn: number } | null =
    null;
  for (const window of windows) {
    const state = states.get(window.key);
    if (state === undefined || state === 'reset-usage-unknown') continue;
    const percent = usedPercent(window.used);
    if (percent === undefined) continue;
    const resetsAt = window.resetsAt;
    if (
      resetsAt === undefined ||
      !Number.isFinite(resetsAt) ||
      resetsAt <= now
    ) {
      continue;
    }
    const resetsIn = resetsAt - now;
    if (
      best === null ||
      percent > best.percent ||
      (percent === best.percent &&
        (resetsIn < best.resetsIn ||
          (resetsIn === best.resetsIn && window.key < best.window.key)))
    ) {
      best = { window, percent, resetsIn };
    }
  }
  return best?.window ?? null;
}

/**
 * The Claude duplicate rule: when the generic weekly window is
 * `reset-usage-unknown` and a model-specific weekly window exists, the
 * generic one is hidden from the compact view (its reset/status stay in the
 * tile tooltip). Detected by window shape so both Claude provider ids
 * (`anthropic`, `claude-cli`) are covered.
 */
function hiddenGenericWeekly(
  windows: readonly PlanLimitWindow[],
  states: ReadonlyMap<string, PlanWindowState>,
): PlanLimitWindow | null {
  const generic = windows.find((window) => window.key === 'weekly');
  if (!generic || states.get('weekly') !== 'reset-usage-unknown') return null;
  const hasModelWeekly = windows.some(
    (window) =>
      window !== generic &&
      (window.kind === 'weekly_model' || window.key.startsWith('weekly_model:')),
  );
  return hasModelWeekly ? generic : null;
}

// ---------------------------------------------------------------------------
// Owner-level facts
// ---------------------------------------------------------------------------

function subtitleFor(owner: PlanLimitOwnerSnapshot): string {
  if (owner.owner.identityKind === 'unknown') {
    const reasons: Record<string, string> = {
      'missing-account-email': 'Signed in · account email not shared',
      'codex-not-read': 'Account not read yet',
      'unrouted-daemon': 'Local Ollama daemon',
      'missing-api-key': 'No API key configured',
      'unresolved-route': 'Account identity unavailable',
    };
    return reasons[owner.unknownReason ?? ''] ?? 'Account identity unavailable';
  }
  const base =
    owner.activity !== undefined
      ? 'Subscription quota and account activity'
      : 'Subscription quota';
  const plan = owner.account?.planType;
  return plan ? `${base} · Plan: ${plan}` : base;
}

/**
 * The semantic icon kind of the footer status chip: the tile maps each kind to a small icon component, replacing
 * the former plain "–" / "○" leading characters.
 */
export type PlanTileStatusChipIcon =
  | 'key'
  | 'cli'
  | 'cli-update'
  | 'off';

/** Short, human-readable status labels; diagnostic codes stay out of the UI. */
function statusChip(
  status: ProviderAccountUsageStatus,
  providerId: string,
): { icon: PlanTileStatusChipIcon; text: string; tone: Tone } | null {
  switch (status) {
    case 'available':
      return null;
    case 'no-usage-source':
      return { icon: 'off', text: 'No usage source', tone: 'neutral' };
    case 'stale':
      return null;
    case 'unsupported-auth':
      return {
        icon: 'key',
        text:
          providerId === 'ollama-cloud'
            ? 'API key rejected'
            : providerId === 'antigravity'
              ? 'Sign-in rejected'
              : providerId === 'opencode'
                ? 'Sign-in expired'
                : 'API key — no plan limits',
        tone: 'neutral',
      };
    case 'unsupported-config':
      return {
        icon: 'off',
        text:
          providerId === 'ollama-cloud'
            ? 'No API key configured'
            : 'No usage source',
        tone: 'neutral',
      };
    case 'provider-unsupported':
      return { icon: 'off', text: 'No usage source', tone: 'neutral' };
    case 'cli-unavailable':
      return { icon: 'cli', text: 'CLI unavailable', tone: 'warning' };
    case 'cli-version-unsupported':
      return { icon: 'cli-update', text: 'CLI update needed', tone: 'warning' };
    case 'service-unavailable':
      return { icon: 'off', text: 'Usage unavailable', tone: 'neutral' };
  }
}

function statusNoticeText(
  owner: PlanLimitOwnerSnapshot,
  hasData: boolean,
  now: number,
  time: LocalTimeOptions,
): { text: string; tone: Tone } | null {
  if (owner.status === 'stale') {
    const when =
      owner.staleSince !== undefined
        ? ` at ${formatLocalAbsolute(owner.staleSince, now, time)}`
        : '';
    return {
      text: `Showing cached account data; refresh failed${when}.`,
      tone: 'warning',
    };
  }
  // A typed statusReason beats every generic per-provider sentence for a
  // window-less owner (review defect 3): "Antigravity CLI usage output not
  // recognized" names the cause; "Open Antigravity" is only the fallback.
  const reason = planLimitReasonLabel(owner.statusReason);
  if (reason !== null) return { text: reason, tone: 'neutral' };
  const text =
    owner.status === 'service-unavailable'
      ? serviceUnavailableText(owner, hasData)
      : null;
  if (text !== null) return { text, tone: 'neutral' };
  if (
    owner.status === 'no-usage-source' &&
    owner.localUsage &&
    owner.windows.length === 0 &&
    owner.ownerEvidence.length === 0
  ) {
    return { text: 'Local usage only', tone: 'neutral' };
  }
  if (hasData) return null;
  const noDataText = noDataStatusText(owner);
  return noDataText === undefined ? null : { text: noDataText, tone: 'neutral' };
}

/**
 * A ledger-only owner arrives as `service-unavailable` (no live read was
 * made): its recorded evidence is past evidence, not a read failure.
 */
function serviceUnavailableText(
  owner: PlanLimitOwnerSnapshot,
  hasData: boolean,
): string | null {
  if (owner.unavailableReason === 'no-open-session') {
    return hasData
      ? 'No open session to read this account’s usage from; showing the last recorded limit evidence.'
      : 'No open session to read this account’s usage from.';
  }
  if (hasData) {
    return 'No live usage read; showing the last recorded limit evidence.';
  }
  // Fallback only: a typed statusReason has already won (statusNoticeText).
  if (owner.owner.providerId === 'antigravity') {
    return 'Open Antigravity to read local quota';
  }
  return null;
}

/** The tile's sentence for an owner with no windows, evidence or local usage. */
function noDataStatusText(owner: PlanLimitOwnerSnapshot): string | undefined {
  const providerId = owner.owner.providerId;
  switch (owner.status) {
    case 'available':
      return 'No plan limits reported';
    case 'unsupported-auth':
      if (providerId === 'ollama-cloud') {
        return 'API key rejected — check the key';
      }
      // The Antigravity keyring login was refused by Google (revoked or
      // expired): an authentication problem, not a missing local app.
      if (providerId === 'antigravity') {
        return 'Antigravity sign-in rejected — sign in to Antigravity again';
      }
      // OpenCode's stored login was rejected (401) or has expired.
      if (providerId === 'opencode') {
        return 'OpenCode sign-in expired — sign in to OpenCode again';
      }
      return 'No plan limits (API key)';
    case 'unsupported-config':
      if (providerId === 'ollama-cloud') return 'No API key configured';
      break;
    case 'no-usage-source':
      return providerId === 'opencode'
        ? 'Sign in to OpenCode Go'
        : 'No usage source available';
  }
  return STATUS_SENTENCES[owner.status];
}

/**
 * The status pill that reserves the bar slot: the precise cause of the
 * missing bar. Windows that exist but are ineligible name that fact; an
 * owner without windows names its typed reason first, then its status
 * notice or sentence.
 */
function statusPill(
  owner: PlanLimitOwnerSnapshot,
  windowsExist: boolean,
  hasData: boolean,
  notice: { text: string; tone: Tone } | null,
): PlanTileStatusPillView {
  if (windowsExist) {
    return {
      text: 'No plan window reports a known usage with a future reset',
      tone: pillTone(owner.status, notice),
    };
  }
  // A typed statusReason wins for every provider (review defect 3); the
  // notice and the per-status sentences are only fallbacks.
  const text =
    planLimitReasonLabel(owner.statusReason) ??
    notice?.text ??
    noDataStatusText(owner) ??
    planLimitReasonLabel(owner.unavailableReason) ??
    'Usage unavailable';
  return { text, tone: pillTone(owner.status, notice) };
}

function pillTone(
  status: ProviderAccountUsageStatus,
  notice: { tone: Tone } | null,
): Tone {
  if (notice && notice.tone !== 'info') return notice.tone;
  if (
    status === 'stale' ||
    status === 'cli-unavailable' ||
    status === 'cli-version-unsupported'
  ) {
    return 'warning';
  }
  return 'neutral';
}

/**
 * One inline action, wired only to navigation that already exists in the
 * webview: "Go to chat" for the no-open-session reason, "Add key" for
 * Ollama Cloud's missing key. Reasons without an existing handler stay
 * without an action.
 */
function tileAction(
  owner: PlanLimitOwnerSnapshot,
  hasData: boolean,
): PlanTileActionView | null {
  if (owner.windows.length > 0) return null;
  if (
    owner.status === 'service-unavailable' &&
    owner.unavailableReason === 'no-open-session'
  ) {
    return {
      kind: 'open-session',
      label: 'Go to chat',
      providerId: owner.owner.providerId,
    };
  }
  if (
    !hasData &&
    owner.status === 'unsupported-config' &&
    owner.owner.providerId === 'ollama-cloud'
  ) {
    return {
      kind: 'add-key',
      label: 'Add key',
      providerId: owner.owner.providerId,
    };
  }
  return null;
}

/**
 * "last 30 days" derived from the CLI's own "start – end" ISO range; the
 * exact range string stays in the stat's tooltip. A range that does not
 * parse, or runs backwards, falls back to the raw string.
 */
function localRangeLabel(range: string | undefined): string | null {
  if (range === undefined) return null;
  const parts = range.split(/\s[-–—]\s/);
  if (parts.length !== 2) return range;
  const start = Date.parse((parts[0] ?? '').trim());
  const end = Date.parse((parts[1] ?? '').trim());
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return range;
  }
  const days = Math.round((end - start) / 86_400_000);
  if (days < 1) return range;
  return days === 1 ? 'last 1 day' : `last ${days} days`;
}

/** Per-model request detail: at most this many lines, then "and N more". */
const MODEL_DETAIL_LIMIT = 5;

/**
 * Per-model request lines, most requests first: "glm-5.3 · 185 requests",
 * capped at {@link MODEL_DETAIL_LIMIT} plus one "and N more" line. The
 * accessible form joins the same lines for screen readers.
 */
function modelDetailLines(
  models: readonly PlanModelUsage[],
): { lines: string[]; accessible: string } {
  const ranked = [...models].sort(
    (a, b) => b.requests - a.requests || (a.model < b.model ? -1 : 1),
  );
  const shown = ranked.slice(0, MODEL_DETAIL_LIMIT);
  const lines = shown.map(
    (entry) =>
      `${entry.model} · ${compactCount(entry.requests)} ${entry.requests === 1 ? 'request' : 'requests'}`,
  );
  const rest = ranked.length - shown.length;
  if (rest > 0) lines.push(`and ${rest} more`);
  return { lines, accessible: `Top models: ${lines.join('; ')}` };
}

/** The one secondary metric line: local usage and/or lifetime activity. */
function secondaryLine(
  owner: PlanLimitOwnerSnapshot,
): PlanTileSecondaryView | null {
  const parts: string[] = [];
  const titleLines: string[] = [];
  let accessibleText: string | null = null;
  const usage = owner.localUsage;
  if (usage !== undefined) {
    if (usage.requests !== undefined) {
      parts.push(
        `${compactCount(usage.requests)} ${usage.requests === 1 ? 'request' : 'requests'}`,
      );
    } else {
      parts.push(
        `${compactCount(usage.tokens)} tokens · $${usage.estimatedCostUsd.toFixed(2)}`,
      );
    }
    titleLines.push(usage.label);
    if (usage.range !== undefined) {
      // The exact range stays in the tooltip; the compact label only
      // annotates it (the visible line has room for neither).
      const label = localRangeLabel(usage.range);
      titleLines.push(
        label !== null && label !== usage.range
          ? `Range: ${usage.range} (${label})`
          : `Range: ${usage.range}`,
      );
    }
    // The provenance decides the note: a provider API counts the whole
    // account, a local CLI only what it recorded on this machine.
    titleLines.push(
      usage.source === 'provider-api'
        ? usage.requests !== undefined
          ? 'Account request count from the provider · no plan percentage or reset'
          : 'Account usage from the provider · not a plan percentage or reset'
        : 'Local CLI accounting · not a plan percentage or reset',
    );
    if (usage.models !== undefined && usage.models.length > 0) {
      const detail = modelDetailLines(usage.models);
      titleLines.push('Top models:', ...detail.lines);
      accessibleText = detail.accessible;
    }
  }
  const lifetime = owner.activity?.lifetimeTokens;
  if (typeof lifetime === 'string' && lifetime.trim() !== '') {
    parts.push(`${compactTokens(lifetime)} lifetime tokens`);
    titleLines.push(
      'Activity is not remaining messages, credits, or billing.',
    );
  }
  if (parts.length === 0) return null;
  return {
    text: parts.join(' · '),
    title: titleLines.join('\n'),
    accessibleText,
  };
}

function evidenceNotice(
  evidence: OwnerLimitEvidence,
  now: number,
  time: LocalTimeOptions,
  index: number,
): PlanTileNoticeView {
  const key = `${evidence.source}:${evidence.observedAt}:${index}`;
  const scope = evidence.modelScope ? ` (${evidence.modelScope})` : '';
  const hit = formatLocalAbsolute(evidence.observedAt, now, time);
  const source = PLAN_LIMIT_SOURCE_LABELS[evidence.source];
  if (evidence.source === 'estimated') {
    const text = `Estimated limit hit${scope} ${hit} (unconfirmed, informational) · window unknown · ${resetPhrase(evidence.resetsAt, now, time)}`;
    return { key, text, tone: 'neutral', title: `${text} · Source: ${source}` };
  }
  if (isActiveLimitEvidence(evidence, now)) {
    const text = `Limit hit${scope} ${hit} · window unknown · ${resetPhrase(evidence.resetsAt, now, time)}`;
    return { key, text, tone: 'warning', title: `${text} · Source: ${source}` };
  }
  // Expired: only evidence with a known, passed reset reaches here.
  const text = `Limit hit${scope} ${hit} · window unknown · ${resetPhrase(evidence.resetsAt, now, time)} · expired`;
  return { key, text, tone: 'neutral', title: `${text} · Source: ${source}` };
}

// ---------------------------------------------------------------------------
// The tile mapping
// ---------------------------------------------------------------------------

/** The compact uniform tile view for one owner snapshot. */
export function buildPlanTile(
  owner: PlanLimitOwnerSnapshot,
  now: number,
  time: LocalTimeOptions,
): PlanTileView {
  const states = new Map<string, PlanWindowState>();
  for (const window of owner.windows) {
    states.set(window.key, classifyWindow(window, {
      now,
      nearLimitPercent: NEAR_LIMIT_PERCENT,
      freshnessMs: FRESHNESS_MS,
      status: owner.status,
    }));
  }
  const hidden = hiddenGenericWeekly(owner.windows, states);
  const primary = selectPrimary(owner.windows, states, now);
  const hasData =
    owner.windows.length > 0 ||
    owner.ownerEvidence.length > 0 ||
    owner.localUsage !== undefined;
  const notice = statusNoticeText(owner, hasData, now, time);
  const label = ownerDisplayLabel(owner.owner);
  const title = tileTitleLines(label);
  const subtitle = subtitleFor(owner);
  const badge = owner.account?.planType ?? null;

  const chips: PlanTileChipView[] = [];
  for (const window of owner.windows) {
    if (window === primary || window === hidden) continue;
    const facts = windowFacts(window, owner, now, time);
    const percent = facts.percent;
    chips.push({
      key: window.key,
      label: window.label,
      valueText:
        percent !== undefined && facts.state !== 'reset-usage-unknown'
          ? formatUsed(window.used)
          : 'unknown',
      resetText: chipResetText(window, now),
      tone:
        facts.state === 'limit-reached'
          ? 'error'
          : percent !== undefined && percent >= NEAR_LIMIT_PERCENT
            ? 'warning'
            : 'neutral',
      title: factsTitle(facts),
    });
  }
  if (chips.length > 3) {
    const hiddenChips = chips.splice(3);
    chips.push({
      key: '__more-windows',
      label: `+${hiddenChips.length} more`,
      valueText: '',
      resetText: '',
      tone: 'neutral',
      title: hiddenChips.map((chip) => `${chip.label}: ${chip.valueText}, ${chip.resetText}. ${chip.title}`).join('\n'),
    });
  }

  const bar: PlanTileBarView | null = primary === null ? null : (() => {
    const facts = windowFacts(primary, owner, now, time);
    const percent = facts.percent ?? 0;
    return {
      name: primary.label,
      percent: Math.max(0, Math.min(100, percent)),
      roundedPercent: Math.round(percent),
      valueText: facts.valueText,
      barTone: BAR_TONES[facts.state] ?? 'neutral',
      limitLine: facts.limitLine,
      resetText: facts.resetLines[0] ?? resetText(primary.resetsAt, now, time),
      title: factsTitle(facts),
    };
  })();

  const displayPrimary = primary ?? owner.windows[0] ?? null;
  const visibleWindows = owner.windows.filter((window) => window !== hidden);
  const compactWindows: PlanTileCompactWindow[] = visibleWindows
    .slice(0, 3)
    .map((window) => {
      const facts = windowFacts(window, owner, now, time);
      const percent = facts.state === 'reset-usage-unknown' ? undefined : facts.percent;
      return {
        key: window.key,
        label: shortWindowLabel(window.label),
        valueText: facts.state === 'reset-usage-unknown' ? 'unknown' : formatUsed(window.used),
        percent: percent === undefined ? null : Math.max(0, Math.min(100, percent)),
        tone: BAR_TONES[facts.state] ?? 'neutral',
        title: `${window.label}: ${factsTitle(facts)}\n${formatToolResetText(window, now)}`,
      };
    });
  const primaryValue = displayPrimary === null ? null
    : states.get(displayPrimary.key) === 'reset-usage-unknown' ? 'unknown'
    : formatUsed(displayPrimary.used);
  const primaryState = displayPrimary === null ? undefined : states.get(displayPrimary.key);
  const primaryTone = primaryState === undefined ? 'neutral' : BAR_TONES[primaryState] ?? 'neutral';
  const shortReset = displayPrimary === null ? null : (() => {
    const reset = formatToolResetText(displayPrimary, now);
    const relative = reset.match(/\(([^)]+)\)/)?.[1];
    if (relative === undefined) return reset;
    return reset.startsWith('resets ')
      ? `resets ${relative.replace(/^in /, '')}`
      : `reset passed ${relative}`;
  })();
  const accessibleLabel = [label, primaryValue, ...owner.windows.map((window) =>
    `${window.label} ${states.get(window.key) === 'reset-usage-unknown' ? 'unknown' : formatUsed(window.used)}, ${formatToolResetText(window, now)}`), shortReset].filter(Boolean).join(', ');

  const hiddenWindowNotes = hidden === null ? [] : (() => {
    const facts = windowFacts(hidden, owner, now, time);
    const lines = [`${hidden.label} (hidden from the compact view):`, ...facts.resetLines];
    const chip = STATE_CHIPS[facts.state];
    if (chip) lines.push(chip.text);
    return [lines.join(' ')];
  })();
  const overflowWindows = visibleWindows.slice(3);
  if (overflowWindows.length > 0) {
    hiddenWindowNotes.push(`+${overflowWindows.length} more: ${overflowWindows.map((window) => {
      const facts = windowFacts(window, owner, now, time);
      return `${window.label}: ${facts.valueText}, ${formatToolResetText(window, now)}. ${factsTitle(facts)}`;
    }).join('\n')}`);
  }

  const pill = bar === null
    ? statusPill(owner, owner.windows.length > 0, hasData, notice)
    : null;
  // A windowless pill already names the status cause.
  const chip =
    pill !== null && owner.windows.length === 0
      ? null
      : statusChip(owner.status, owner.owner.providerId);
  const statusNotice = notice?.text === pill?.text ? null : (notice?.text ?? null);
  const evidence = owner.ownerEvidence.map((e, index) => evidenceNotice(e, now, time, index));
  if (evidence.length > 2) {
    const hiddenEvidence = evidence.splice(2);
    evidence.push({
      key: '__more-evidence',
      text: `+${hiddenEvidence.length} more`,
      tone: 'neutral',
      title: hiddenEvidence.map((item) => item.title).join('\n'),
    });
  }
  return {
    key: owner.owner.key,
    providerId: owner.owner.providerId,
    label,
    titleName: title.name,
    titleQualifier: title.qualifier,
    headerTitle:
      subtitle === '' ? label : `${label} — ${subtitle}`,
    planBadge: badge,
    bar,
    primaryValue,
    primaryTone,
    compactWindows,
    shortReset,
    accessibleLabel,
    statusPill: pill,
    chips,
    secondary: secondaryLine(owner),
    statusChip: chip,
    statusNotice,
    statusNoticeTone: notice?.tone ?? 'neutral',
    statusNoticeTitle: statusNotice,
    action: tileAction(owner, hasData),
    evidence,
    cooldown:
      owner.cooldown !== undefined && owner.cooldown.until > now
        ? `Retrying after ${formatLocalAbsolute(owner.cooldown.until, now, time)} (${formatRelative(owner.cooldown.until, now)}) · a retry delay, not a plan reset`
        : null,
    hiddenWindowNotes,
    noUsageSource: owner.status === 'no-usage-source',
  };
}
