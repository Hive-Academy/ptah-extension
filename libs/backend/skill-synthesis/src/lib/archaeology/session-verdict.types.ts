/**
 * The session archaeologist's verdict — the wire shape of
 * `skill_session_verdicts` (migration `0034`) plus the `outputFormat` schema the
 * model's reply is constrained to.
 *
 * WHAT A VERDICT IS, AND WHAT IT IS NOT. This is the record of what the user
 * ACTUALLY WANTED and whether they got it. It is explicitly not a first-message
 * echo: `intent` is the analyzed goal, which frequently only becomes legible
 * several turns in, after the first attempt is corrected. The regex extractor it
 * replaces could only ever quote the opening message, which is why phase 2
 * demotes that path to a fallback rather than tuning it.
 *
 * THE NULLABILITY CONTRACT IS A CONTRACT, NOT AN OVERSIGHT. `intent`,
 * `outcome`, `evidenceClass` and `routine` are all nullable, and a verdict whose
 * `degradedReason` is non-null while `intent` is null is a FIRST-CLASS RECORD:
 * "this session was analyzed, there is no verdict, and here is why". It exists
 * so the drain does not re-attempt forever and so the UI can explain itself.
 * `null` from `findBySession` means something different — "never analyzed".
 * Collapsing those two states is the one mistake this file exists to prevent.
 *
 * TWO VOCABULARIES, TWO DIFFERENT ENFORCEMENT STORIES — deliberately:
 *
 *  * `EvidenceClass` is CLOSED and is enforced twice: by the TypeScript union
 *    here, by `SessionVerdictStore` on write, and by a SQLite `CHECK` in `0034`.
 *    It can be closed because phase 4's win-rate arithmetic partitions on these
 *    exact five names — `tests-green`, `user-accepted` and
 *    `explicit-confirmation` are wins, `unverified` is unknown, `no-correction`
 *    is neither (weak evidence, deliberately excluded from the numerator).
 *    Adding a sixth member changes that arithmetic, so it IS a schema break.
 *
 *  * `degradedReason` is OPEN — typed `string`, no union, no `CHECK`. Phase 2
 *    writes the two members named below; phases 3 and 4 will name failure modes
 *    that do not exist yet. Closing it would buy one class of typo at the price
 *    of a later phase having to widen a union AND a rebuild-only SQLite CHECK.
 *    `SESSION_VERDICT_DEGRADED_REASONS` documents the known members; it is NOT
 *    exhaustive and nothing validates against it.
 */

/**
 * How strongly the session's outcome is EVIDENCED. Ordered strongest-first;
 * member-for-member identical to `0034`'s `CHECK` — a drift here surfaces as a
 * constraint violation on a user's database, so the store spec pins both.
 */
export const EVIDENCE_CLASSES = [
  /** A test suite ran and passed after the work. The only self-verifying class. */
  'tests-green',
  /** The user acted on the result (kept the diff, merged, moved on to the next task). */
  'user-accepted',
  /** The user never corrected the assistant again. Weak: silence is not success. */
  'no-correction',
  /** The user said in words that it worked. */
  'explicit-confirmation',
  /** Nothing in the transcript settles it. Counted as `unknown`, never as a loss. */
  'unverified',
] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

/** Narrowing guard for a value read back from the database or a model reply. */
export function isEvidenceClass(value: unknown): value is EvidenceClass {
  return (EVIDENCE_CLASSES as readonly unknown[]).includes(value);
}

/** What kind of friction one turn represents. */
export const FRICTION_KINDS = [
  /** The user corrected the assistant's direction. */
  'correction',
  /** The same thing was attempted again after failing. */
  'retry',
  /** A line of attack was abandoned without being completed. */
  'dead-end',
] as const;

export type FrictionKind = (typeof FRICTION_KINDS)[number];

/**
 * One friction point, ADDRESSED BY TURN INDEX. The index is what makes the
 * friction map auditable rather than an opinion: a later phase can go back and
 * read turn 11. `turnIndex` is a zero-based integer into the session's turns —
 * `SessionVerdictStore` rejects a non-integer, because a fractional or negative
 * index cites nothing.
 */
export interface FrictionEntry {
  turnIndex: number;
  kind: FrictionKind;
  note: string;
}

/**
 * A transferable workflow candidate — the thing that may eventually become a
 * `SKILL.md`. `citations` are turn indices backing the routine, and a routine
 * with no citations is an unsupported claim, so the store requires at least one.
 */
export interface RoutineDraft {
  summary: string;
  steps: string[];
  citations: number[];
}

/**
 * Degradation reasons phase 2 writes today. NOT EXHAUSTIVE and NOT ENFORCED —
 * see the file header. Listed so a reader knows the established spellings and
 * does not invent `noQueryPath` beside `no-query-path`.
 */
export const SESSION_VERDICT_DEGRADED_REASONS = {
  /** No `INTERNAL_QUERY_SERVICE_TOKEN` in this host (CLI, e2e). */
  NO_QUERY_PATH: 'no-query-path',
  /** The lane declares `toolUse: 'none'`, so only a single pass was possible. */
  TOOL_USE_UNSUPPORTED: 'tool-use-unsupported',
} as const;

/** One row of `skill_session_verdicts`, camel-cased. */
export interface SessionVerdict {
  sessionId: string;
  /** Round-robin/feed key. `''` when the host could not resolve a workspace. */
  workspaceRoot: string;
  /** What the user actually wanted. `null` ⇒ degraded run; read `degradedReason`. */
  intent: string | null;
  /** What actually happened, in the analyst's words. */
  outcome: string | null;
  evidenceClass: EvidenceClass | null;
  /** Always an array — `0034` defaults the column to `'[]'`, never NULL. */
  frictionMap: FrictionEntry[];
  /** `null` is a real verdict: "nothing transferable here", not "not measured". */
  routine: RoutineDraft | null;
  /** Turns the analyzed session had. Drives the "re-analyze once it grew" check. */
  turnCount: number;
  /** Which lane ran the analysis. Capability-named, never a provider id. */
  lane: string | null;
  model: string | null;
  /** Passes the multi-pass loop actually took. `0` on a fully degraded run. */
  passes: number;
  /** Non-null ⇒ the null-degradation path was taken. Open vocabulary. */
  degradedReason: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * What the caller supplies. Everything the archaeologist may not know is
 * optional; `sessionId` is the only required field, because the degraded write
 * path legitimately knows nothing else.
 */
export interface SessionVerdictInput {
  sessionId: string;
  workspaceRoot?: string;
  intent?: string | null;
  outcome?: string | null;
  evidenceClass?: EvidenceClass | null;
  frictionMap?: FrictionEntry[];
  routine?: RoutineDraft | null;
  turnCount?: number;
  lane?: string | null;
  model?: string | null;
  passes?: number;
  degradedReason?: string | null;
}

/**
 * The model's reply, one pass. It carries the verdict-so-far AND, optionally,
 * what it still wants to read — that pair is what makes the multi-pass loop work
 * without SDK tool calling: retrieval is driven from TypeScript by
 * `TranscriptWindowReader`, and the model only asks.
 *
 * A reply with neither `requestTurns` nor `requestSearch` is TERMINAL.
 */
export interface SessionVerdictDraft {
  intent: string | null;
  outcome: string | null;
  evidenceClass: EvidenceClass | null;
  frictionMap: FrictionEntry[];
  routine: RoutineDraft | null;
  /** Turn ranges the model wants served on the next pass. Inclusive. */
  requestTurns?: Array<{ from: number; to: number }>;
  /** Regex/literal probes the model wants run over the transcript. */
  requestSearch?: string[];
}

/**
 * The `outputFormat` JSON schema for the archaeologist's reply.
 *
 * ONE SCHEMA FOR EVERY PASS, on purpose. Pass 1 and the terminal pass differ
 * only in whether the reply carries requests, so a single schema keeps the loop
 * to one code path — the same "one code path, two configurations" rule that lets
 * a `toolUse: 'none'` lane run the analyzer with `maxPasses = 1`.
 *
 * Nullable fields are typed `['string','null']` rather than omitted, because the
 * model must be able to SAY "I could not determine the intent" instead of
 * inventing one. That is the same failure the judge's fabricated `score: 10`
 * was, in a different costume.
 *
 * `Record<string, unknown>` (not a `const` object) matches
 * `buildAnalysisJsonSchema`'s established return type
 * (`agent-generation/.../analysis-schema.ts`) and the `outputFormat.schema`
 * field it feeds.
 */
export const SESSION_VERDICT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    intent: {
      type: ['string', 'null'],
      description:
        'What the user ACTUALLY wanted, in one sentence, judged across the whole session. Do NOT echo the first message — the real goal often only becomes clear after the first attempt is corrected. null if the transcript does not settle it.',
    },
    outcome: {
      type: ['string', 'null'],
      description:
        'What actually happened by the end of the session, in one or two sentences. null if undeterminable.',
    },
    evidenceClass: {
      type: ['string', 'null'],
      enum: [...EVIDENCE_CLASSES, null],
      description:
        "How the outcome is EVIDENCED, not how confident you feel. 'tests-green' only if a suite ran and passed; 'user-accepted' if the user acted on the result; 'explicit-confirmation' if they said it worked; 'no-correction' if they simply never pushed back; 'unverified' if nothing settles it. Prefer 'unverified' over guessing.",
    },
    frictionMap: {
      type: 'array',
      description:
        'Every turn where the work went wrong or backwards. Empty array if the session ran clean.',
      items: {
        type: 'object',
        properties: {
          turnIndex: {
            type: 'integer',
            minimum: 0,
            description:
              'Zero-based index of the turn, as numbered in the transcript window you were served.',
          },
          kind: { type: 'string', enum: [...FRICTION_KINDS] },
          note: {
            type: 'string',
            description: 'One short sentence on what went wrong at that turn.',
          },
        },
        required: ['turnIndex', 'kind', 'note'],
      },
    },
    routine: {
      type: ['object', 'null'],
      description:
        'A transferable workflow another session could reuse, or null if this session contains nothing generalizable. null is a perfectly good answer — most sessions are one-offs.',
      properties: {
        summary: { type: 'string' },
        steps: { type: 'array', items: { type: 'string' } },
        citations: {
          type: 'array',
          items: { type: 'integer', minimum: 0 },
          description:
            'Turn indices that demonstrate the routine. At least one — a routine you cannot cite is a guess.',
        },
      },
      required: ['summary', 'steps', 'citations'],
    },
    requestTurns: {
      type: 'array',
      description:
        'Turn ranges you still need to read before you can finish. Omit or leave empty when the verdict above is final.',
      items: {
        type: 'object',
        properties: {
          from: { type: 'integer', minimum: 0 },
          to: { type: 'integer', minimum: 0 },
        },
        required: ['from', 'to'],
      },
    },
    requestSearch: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Literal strings to search the transcript for. Omit or leave empty when the verdict above is final.',
    },
  },
  required: ['intent', 'outcome', 'evidenceClass', 'frictionMap', 'routine'],
};
