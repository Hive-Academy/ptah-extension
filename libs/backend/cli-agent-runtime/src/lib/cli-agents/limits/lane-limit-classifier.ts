/**
 * Lane limit classifier (TASK_2026_596, Component 10; Req 3.3-3.5, 3.9).
 *
 * Decides whether a failed lane failed because its plan quota ran out, from
 * the text the CLI left behind. Pure: no clock, no I/O, no logging. The caller
 * passes the observation instant and logs the match at debug level.
 *
 * One pattern per wording, and each CLI is only checked against its own
 * wordings, so a lane that merely printed another vendor's message (a grep
 * over this very repository, for instance) is not misread as limited:
 *
 * - Claude      "5-hour limit reached ∙ resets 2am"
 * - Codex       "usage limit … try again at 5:05 PM"
 * - Antigravity "RESOURCE_EXHAUSTED … reset after 144h24m50s" (provisional)
 * - OpenCode    "Free usage exceeded" (provisional)
 * - Ollama      HTTP 429 with a limit wording (provisional)
 * - Grok        "subscription:free-usage-exhausted" (the `-32003` data), or
 *               "reached your free Grok Build usage limit" (`grok -p`)
 *
 * A Ptah CLI lane is checked against its provider's wordings (Claude for
 * `anthropic`, Ollama for `ollama-cloud`) once its owner names the provider,
 * and against the Claude wording only while the provider is unknown.
 *
 * `MODEL_CAPACITY_EXHAUSTED` (the provider is out of capacity, not the
 * owner out of quota), timeouts and authentication failures are never quota.
 */
import {
  resolveClockTimeReset,
  resolveRelativeReset,
  windowKindFromDuration,
  type OwnerLimitEvidence,
  type PlanLimitWindow,
  type PlanWindowKey,
} from '@ptah-extension/shared';

/** Codex wording. Shared with `sdk-error-summary.ts`, whose output it drives. */
export const USAGE_LIMIT_REGEX = /usage limit/i;

/** Codex retry hint. Shared with `sdk-error-summary.ts`. */
export const RETRY_AT_REGEX = /try again at\s+([^\n.)]+)/i;

/** Claude: "<window> limit reached ∙ resets <clock>[ (<IANA zone>)]". */
const CLAUDE_LIMIT_REGEX =
  /([^\n]{0,60})\blimit reached\b[^\n]{0,40}?\bresets\s+([^\n]{1,80})/i;

/** Antigravity: the duration after "reset after", on the same line. */
const ANTIGRAVITY_LIMIT_REGEX =
  /RESOURCE_EXHAUSTED\b[^\n]{0,500}?\breset after\s+((?:\d+d)?\s*(?:\d+h)?\s*(?:\d+m)?\s*(?:\d+(?:\.\d+)?s)?)/i;

const OPENCODE_LIMIT_REGEX = /Free usage exceeded/i;

/** Ollama: a 429 next to a limit wording; a bare "429" is too common in output. */
const OLLAMA_LIMIT_REGEX =
  /\b429\b[^\n]{0,80}?\b(?:too many requests|usage limit|quota)\b/i;

/**
 * Grok free-usage exhaustion. ACP carries the code in the `-32003` "Rate
 * limited" error's `data` (string, or the `body_preview` object's `code`);
 * `grok -p` prints the second wording, whose apostrophes may be curly. The
 * window is a rolling 24 hours with no reset instant, so none is derived.
 */
const GROK_LIMIT_REGEX =
  /subscription:free-usage-exhausted|reached your free Grok Build usage limit/i;

/** Capacity, not quota (Req 3.9). A text carrying it is never classified. */
const MODEL_CAPACITY_REGEX = /MODEL_CAPACITY_EXHAUSTED/i;

/** A calendar date the clock-time parser would silently drop. */
const DATE_HINT_REGEX =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\d{4}-\d{2}-\d{2}|\b\d{1,2}\/\d{1,2}\b/i;

/** An IANA zone in parentheses after a reset clock, e.g. `(Europe/Berlin)`. */
const IANA_ZONE_REGEX = /\(([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)\)/;

const FIVE_HOUR_REGEX = /\b5[- ]hour\b/i;
const WEEKLY_REGEX = /\bweekly\b/i;
const CLAUDE_FAMILY_REGEX = /\b(opus|sonnet|haiku)\b/i;

const WEEKLY_MODEL_PREFIX = 'weekly_model:';
const FIVE_HOUR_MINUTES = 300;
const WEEKLY_MINUTES = 10_080;

/** Which wording matched. Carried for the caller's debug log only. */
export type LaneLimitPattern =
  | 'claude-limit-reached'
  | 'codex-usage-limit'
  | 'antigravity-resource-exhausted'
  | 'opencode-free-usage'
  | 'ollama-429'
  | 'grok-free-usage';

export interface LaneLimitClassification {
  readonly failureKind: 'quota';
  /** Present only when the message named the window. */
  readonly windowKey?: PlanWindowKey;
  /** Model family of a model-scoped window (`weekly_model:<scope>`). */
  readonly modelScope?: string;
  /** Absent when the message gave no reset, or one that cannot be resolved. */
  readonly resetsAt?: number;
  readonly resetSource: 'error-derived';
  readonly pattern: LaneLimitPattern;
}

export interface LaneLimitInput {
  /** A `CliType` (`codex`, `ptah-cli`, …) or a provider id (`ollama-cloud`). */
  readonly cliOrProvider: string;
  /** Candidate texts, most specific first (error segments, then output tail). */
  readonly texts: readonly string[];
  readonly observedAt: number;
  /** IANA zone for clock times without one; the host zone when absent. */
  readonly tz?: string;
}

type PatternMatcher = (
  text: string,
  observedAt: number,
  tz: string | undefined,
) => LaneLimitClassification | null;

const matchClaude: PatternMatcher = (text, observedAt, tz) => {
  const match = CLAUDE_LIMIT_REGEX.exec(text);
  if (!match) return null;
  const [, prefix, resetText] = match;
  const zone = IANA_ZONE_REGEX.exec(resetText)?.[1] ?? tz;
  return quota('claude-limit-reached', {
    ...claudeWindow(prefix),
    resetsAt: resolveClockTimeReset(resetText, observedAt, zone),
  });
};

const matchCodex: PatternMatcher = (text, observedAt, tz) => {
  if (!USAGE_LIMIT_REGEX.test(text)) return null;
  const retryAt = RETRY_AT_REGEX.exec(text)?.[1];
  // "try again at Oct 5th, 2025 5:05 PM" names a day the clock parser cannot
  // place; an unknown reset is honest, a reset on the wrong day is not.
  const resetsAt =
    retryAt && !DATE_HINT_REGEX.test(retryAt)
      ? resolveClockTimeReset(retryAt, observedAt, tz)
      : undefined;
  return quota('codex-usage-limit', { resetsAt });
};

const matchAntigravity: PatternMatcher = (text, observedAt) => {
  const match = ANTIGRAVITY_LIMIT_REGEX.exec(text);
  if (!match || match[1].trim().length === 0) return null;
  return quota('antigravity-resource-exhausted', {
    resetsAt: resolveRelativeReset(match[1], observedAt),
  });
};

const matchOpenCode: PatternMatcher = (text) =>
  OPENCODE_LIMIT_REGEX.test(text) ? quota('opencode-free-usage', {}) : null;

const matchOllama: PatternMatcher = (text) =>
  OLLAMA_LIMIT_REGEX.test(text) ? quota('ollama-429', {}) : null;

const matchGrok: PatternMatcher = (text) =>
  GROK_LIMIT_REGEX.test(text) ? quota('grok-free-usage', {}) : null;

/**
 * Wordings per CLI or provider. A Ptah CLI lane is classified by its provider
 * when its recorded owner names one ({@link laneLimitWording}). With no
 * provider known it gets the Claude wording only: the Ollama "429 … too many
 * requests" wording is also what an Anthropic rate limit prints, so matching
 * it on an unknown provider would misread a plain rate limit as quota.
 */
const MATCHERS: Readonly<Record<string, readonly PatternMatcher[]>> = {
  codex: [matchCodex],
  antigravity: [matchAntigravity],
  opencode: [matchOpenCode],
  grok: [matchGrok],
  'ptah-cli': [matchClaude],
  anthropic: [matchClaude],
  'ollama-cloud': [matchOllama],
};

/** Owner providers whose own wordings a Ptah CLI lane is classified by. */
const PTAH_CLI_WORDING_PROVIDERS: ReadonlySet<string> = new Set([
  'anthropic',
  'ollama-cloud',
]);

/**
 * The `cliOrProvider` a lane is classified under: a Ptah CLI lane's owner
 * provider when it has its own wordings, otherwise the CLI itself.
 */
export function laneLimitWording(
  cli: string,
  ownerProviderId: string | undefined,
): string {
  return cli === 'ptah-cli' &&
    ownerProviderId !== undefined &&
    PTAH_CLI_WORDING_PROVIDERS.has(ownerProviderId)
    ? ownerProviderId
    : cli;
}

/**
 * Classify a lane failure. Returns `null` when no quota wording of this CLI
 * appears, which leaves the run a plain failure (Req 3.9).
 */
export function classifyLaneLimit(
  input: LaneLimitInput,
): LaneLimitClassification | null {
  const matchers = MATCHERS[input.cliOrProvider];
  if (!matchers) return null;
  for (const text of input.texts) {
    if (text.length === 0 || MODEL_CAPACITY_REGEX.test(text)) continue;
    for (const matcher of matchers) {
      const result = matcher(text, input.observedAt, input.tz);
      if (result) return result;
    }
  }
  return null;
}

/** Ledger evidence for a classification: a window when one was named. */
export type LaneLimitEvidence =
  | { readonly kind: 'window'; readonly window: PlanLimitWindow }
  | { readonly kind: 'owner'; readonly evidence: OwnerLimitEvidence };

export function laneLimitEvidence(
  classification: LaneLimitClassification,
  observedAt: number,
): LaneLimitEvidence {
  const reset =
    classification.resetsAt !== undefined
      ? {
          resetsAt: classification.resetsAt,
          resetSource: classification.resetSource,
        }
      : {};
  const scope =
    classification.modelScope !== undefined
      ? { modelScope: classification.modelScope }
      : {};
  const exhaustion: OwnerLimitEvidence = {
    observedAt,
    source: 'error-derived',
    ...reset,
    ...scope,
  };
  if (classification.windowKey === undefined) {
    return { kind: 'owner', evidence: exhaustion };
  }
  return {
    kind: 'window',
    window: {
      ...laneWindowDescriptor(
        classification.windowKey,
        classification.modelScope,
      ),
      ...scope,
      ...reset,
      exhaustion,
      observedAt,
    },
  };
}

function quota(
  pattern: LaneLimitPattern,
  fields: Pick<
    LaneLimitClassification,
    'windowKey' | 'modelScope' | 'resetsAt'
  >,
): LaneLimitClassification {
  return {
    failureKind: 'quota',
    ...(fields.windowKey !== undefined && { windowKey: fields.windowKey }),
    ...(fields.modelScope !== undefined && { modelScope: fields.modelScope }),
    ...(fields.resetsAt !== undefined && { resetsAt: fields.resetsAt }),
    resetSource: 'error-derived',
    pattern,
  };
}

/** The window a Claude message names in the words before "limit reached". */
function claudeWindow(
  prefix: string,
): Pick<LaneLimitClassification, 'windowKey' | 'modelScope'> {
  if (FIVE_HOUR_REGEX.test(prefix)) return { windowKey: 'five_hour' };
  if (!WEEKLY_REGEX.test(prefix)) return {};
  const family = CLAUDE_FAMILY_REGEX.exec(prefix)?.[1]?.toLowerCase();
  return family
    ? { windowKey: `weekly_model:${family}`, modelScope: family }
    : { windowKey: 'weekly' };
}

/**
 * Kind and label of a window a lane names, matching the labels the ledger
 * gives the same keys.
 */
export function laneWindowDescriptor(
  key: PlanWindowKey,
  modelScope: string | undefined,
): Pick<PlanLimitWindow, 'key' | 'kind' | 'label'> {
  if (key === 'five_hour') return windowKindFromDuration(FIVE_HOUR_MINUTES, 0);
  if (key === 'weekly') return windowKindFromDuration(WEEKLY_MINUTES, 0);
  if (key === 'monthly') return { key, kind: 'monthly', label: 'Monthly' };
  if (key === 'overage') return { key, kind: 'overage', label: 'Overage' };
  if (!key.startsWith(WEEKLY_MODEL_PREFIX)) {
    return { key, kind: 'other', label: 'Other' };
  }
  const scope = modelScope ?? key.slice(WEEKLY_MODEL_PREFIX.length);
  return {
    key,
    kind: 'weekly_model',
    label: `Weekly · ${scope.charAt(0).toUpperCase()}${scope.slice(1)}`,
  };
}
