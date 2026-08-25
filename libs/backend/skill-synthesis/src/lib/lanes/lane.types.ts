/**
 * The lane contract — the declared-capability record every background LLM call
 * in this library runs against.
 *
 * ## Why lanes exist at all
 *
 * Before phase 1 every background call inherited the user's active chat
 * provider and its credentials, so synthesis spent foreground quota and every
 * stage shared one hardcoded timeout. A lane is the unit that fixes both: it
 * names WHERE a stage runs (`provider` / `model`) and WHAT that endpoint can
 * actually do (`structuredOutput`, `toolUse`, `timeoutMs`, `maxInputChars`,
 * `maxPasses`), and `LaneRunner` reads those fields instead of module
 * constants.
 *
 * ## No provider is privileged — the ONE invariant this file exists to hold
 *
 * There is deliberately not a single provider id literal in this file, and
 * there must never be one in any code path that consumes these types. Lanes
 * differ ONLY by their declared capability fields. That is not a style
 * preference: the moment a lane behaves differently because of WHO the
 * provider is rather than WHAT it declared, the registry stops being the
 * source of truth, a newly added provider inherits nobody's branch, and the
 * capability fields become decoration. Risk R6 ("a lane pointed at a
 * small-context or non-tool-use model loops to timeout") is mitigated by
 * `toolUse: 'none'` collapsing the pass loop — a capability guard — never by a
 * judgement about any vendor.
 */

/**
 * The four stages that call an LLM. `archaeologist` and `replay` are declared
 * here in phase 1 though their stages ship in phases 2 and 3, because the lane
 * settings tree and the picker UI are built once against this union.
 */
export type SkillLaneId = 'archaeologist' | 'synthesis' | 'judge' | 'replay';

export const SKILL_LANE_IDS: readonly SkillLaneId[] = [
  'archaeologist',
  'synthesis',
  'judge',
  'replay',
] as const;

/** Bare tier aliases. Resolved by the SDK, never by a hardcoded model id here. */
export type SkillLaneTier = 'haiku' | 'sonnet' | 'opus';

export interface SkillLaneConfig {
  readonly id: SkillLaneId;
  /**
   * Registry provider id, or `''` = inherit the active workspace provider.
   *
   * NEVER compared against a literal provider id, here or anywhere
   * downstream. The only questions this library asks of it are "is it empty?"
   * and "what does the resolver hand back for it?".
   */
  readonly provider: string;
  /** Concrete model id, a bare tier alias, or `''` = fall back (see `resolveLaneModel`). */
  readonly model: string;
  /** Bare tier used when `model` is `''` and a provider IS configured. */
  readonly defaultTier: SkillLaneTier;
  /**
   * Whether this lane's endpoint honours `outputFormat` (JSON-Schema
   * constrained output). `'parse'` means it does not and the manual JSON
   * extractors are the only path — which is why those extractors must never
   * be deleted as "dead code".
   */
  readonly structuredOutput: 'sdk' | 'parse';
  /**
   * Whether this lane may run the multi-pass retrieval loop. `'none'`
   * collapses it to a single pass rather than letting a model that cannot
   * drive tools burn the whole `timeoutMs` discovering that.
   */
  readonly toolUse: 'required' | 'none';
  /** Per-lane wall clock for one LLM call. Replaces the old module constants. */
  readonly timeoutMs: number;
  /** Prompt input budget in characters, applied per lane rather than globally. */
  readonly maxInputChars: number;
  /** Upper bound on retrieval passes. Only the archaeologist exceeds 1. */
  readonly maxPasses: number;
}

/**
 * Structural mirror of agent-sdk's `OneShotAuthOverride`. Declared locally for
 * the same reason `IInternalQuery` is (`internal-query.interface.ts:1-9`): no
 * circular dependency.
 *
 * ## `string | undefined` is LOAD-BEARING (risk R2)
 *
 * The resolver strips the chat provider's credential and tier keys by
 * ASSIGNING `undefined`, never by `delete`-ing them, because the consumer
 * rebuilds the subprocess env as `{ ...process.env, ...override }` — a
 * present-but-`undefined` key wins that last spread and blanks the ambient
 * value, whereas a deleted key simply is not in the spread and the foreground
 * credential survives. Typing this `Record<string, string>` is a defect, not a
 * tightening: it invites the exact operations that drop those keys (a JSON
 * round-trip, `structuredClone`, a Zod `.parse()`, a truthiness filter), each
 * of which re-leaks foreground credentials into background work with no type
 * error and no observable failure until the bill arrives.
 */
export interface LaneAuthOverride {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly baseUrl?: string;
}

export interface ResolvedSkillLane {
  readonly config: SkillLaneConfig;
  /**
   * `undefined` ⇒ ride the active provider. Two distinct situations produce
   * it and neither is an error: no provider is configured for the lane, or
   * the configured provider IS the active one (the resolver returns `null`).
   */
  readonly auth: LaneAuthOverride | undefined;
  /** Value handed to `IInternalQuery.execute({ model })`. */
  readonly model: string;
}

export type SkillLaneFailureKind =
  | 'auth-unresolvable'
  /**
   * The lane's resolved provider is rate-limited and still cooling down.
   *
   * Deliberately NOT `timeout`, which is what an exhausted subscription used to
   * be recorded as. The two are indistinguishable from inside this library —
   * the CLI subprocess absorbs the upstream 429 and retries internally, so the
   * only signal a lane ever saw was its own wall clock — and treating them the
   * same gets the backoff wrong in the expensive direction: `timeout` climbs
   * the `2^attempt × 60s` transport ladder, which knows nothing about when the
   * quota actually refills, while the row keeps re-paying a full lane timeout
   * to rediscover the same dead endpoint. Quota carries the PROVIDER's own
   * cooldown instead (`retry-after` when the upstream sent one, otherwise
   * {@link LANE_QUOTA_RETRY_MS}), and the gate fires BEFORE dispatch, so the
   * second and later rows cost nothing upstream at all.
   */
  | 'quota-exhausted'
  | 'structured-output-unsupported'
  | 'tool-use-unsupported'
  | 'timeout';

/**
 * The failure kinds that mean NOTHING RAN.
 *
 * The split is "did the endpoint answer at all", not "how bad was it". A
 * transport failure requeues the row behind its own backoff; a CAPABILITY
 * failure (`structured-output-unsupported`, `tool-use-unsupported`) means the
 * endpoint answered and we cannot use the answer, which is `unscored` — the
 * JUDGE's verdict, "we ran and we do not know".
 *
 * Exported as ONE set because three places ask the question — `LaneRunner.fail`
 * (whether to write `requeue`), `SkillDrainService.applyLaneFailure` (which row
 * transition), and the reader of either. It used to be an inline
 * two-name comparison in each, and a new union member falls straight through
 * such a comparison into `markUnscored`: it compiles, it type-checks, and it
 * lands a stall that never ran as a judge verdict on the Activity surface.
 * Adding a kind here is the deliberate act; forgetting to is the bug.
 */
export const TRANSPORT_LANE_FAILURE_KINDS: ReadonlySet<SkillLaneFailureKind> =
  new Set<SkillLaneFailureKind>([
    'timeout',
    'auth-unresolvable',
    'quota-exhausted',
  ]);

/** Whether `kind` means the endpoint never answered. See the set above. */
export function isTransportLaneFailure(kind: SkillLaneFailureKind): boolean {
  return TRANSPORT_LANE_FAILURE_KINDS.has(kind);
}

export interface SkillLaneFailure {
  readonly kind: SkillLaneFailureKind;
  /** SHORT and user-facing. Written verbatim to `skill_synthesis_queue.reason`. */
  readonly reason: string;
  /** How long before the queue row becomes eligible again. */
  readonly retryAfterMs: number;
}

export type SkillLaneResolution =
  | { readonly ok: true; readonly lane: ResolvedSkillLane }
  | { readonly ok: false; readonly failure: SkillLaneFailure };

/**
 * Backoff applied when a lane's configured provider is present but unusable.
 *
 * Q2: unresolvable lane auth STALLS. The queue row returns to `queued` with
 * this delay and a surfaced reason; it never silently falls back to the active
 * provider. That divergence from the memory curator (which does fall back) is
 * deliberate — falling back here would put background work straight onto the
 * foreground quota, the exact defect phase 1 exists to remove.
 */
export const LANE_AUTH_RETRY_MS = 30 * 60_000;

/**
 * Backoff applied when a lane's resolved provider is rate-limited and the
 * upstream sent no `retry-after` to honour.
 *
 * Deliberately SHORTER than {@link LANE_AUTH_RETRY_MS}, and the reason is the
 * fault's nature rather than its severity: quota refills on a clock, a
 * misconfigured provider does not. Waiting 30 minutes for auth costs nothing
 * because nothing changes until the user acts; waiting 30 minutes for quota
 * throws away background work the provider would already have served.
 *
 * A fallback and not the usual answer where a header exists: the resolver's
 * `ProviderQuotaError` carries the honoured `retry-after` when the upstream
 * sent one, and the lane resolver prefers it. Every rate-limit line in the run
 * that produced this constant was bare, so in practice this IS the value —
 * which is why it is argued rather than copied from its neighbour.
 *
 * A module constant, not a settings key. Revisit if 15 minutes proves wrong in
 * the field; do not pre-emptively make it configurable.
 */
export const LANE_QUOTA_RETRY_MS = 15 * 60_000;
