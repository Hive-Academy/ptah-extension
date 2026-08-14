/**
 * SessionArchaeologistService — the multi-pass analyzer that produces a
 * `SessionVerdict` for one session.
 *
 * ## ORCHESTRATED MULTI-PASS, NOT SDK TOOL CALLING (decision Q3)
 *
 * The model is never handed a tool set. `OneShotRunInput` carries no
 * `allowedTools` / `disallowedTools` and the one-shot path hardcodes the full
 * `claude_code` preset, so the only available choice would be giving an
 * unattended background job `Bash` and `Write`. Instead TYPESCRIPT HOLDS THE
 * READER: each pass replies with an optional `requestTurns` / `requestSearch`
 * pair (`SessionVerdictDraft`), and `TranscriptWindowReader` serves exactly
 * those on the next pass. Retrieval is orchestrated, not tool-called, and every
 * window is re-bounded by the lane's `maxInputChars`.
 *
 *  * **Pass 1** — a tail window ({@link ARCHAEOLOGY_TAIL_BUDGET_SHARE} of the
 *    budget) plus a head window ({@link ARCHAEOLOGY_HEAD_BUDGET_SHARE}).
 *    Tail-first because a session's outcome lives at its end.
 *  * **Passes 2..`maxPasses`** — exactly the ranges and probes the previous
 *    reply asked for, divided across the serve budget.
 *  * **Terminal** — a reply carrying no further requests, or the pass ceiling.
 *
 * ## R6 IS ONE EXPRESSION, AND IT NAMES NO PROVIDER
 *
 * `LaneRun.passesAllowed` is already `1` both when the lane DECLARES
 * `toolUse: 'none'` and when the endpoint is DISCOVERED to be unable to drive
 * the loop. So the collapse is:
 *
 * ```ts
 * passBudget = Math.min(passBudget, run.passesAllowed);
 * collapsed  = passBudget < configuredMaxPasses;
 * ```
 *
 * One code path, two configurations. Nothing below compares the lane's
 * `toolUse` field against anything, and no code path in this library names a
 * provider id — lanes differ only by their declared capability fields. The
 * spec pins the absence of that comparison with a source scan, because a
 * second code path here is where a provider branch would eventually grow.
 *
 * THE COLLAPSE IS NOT ITSELF A DEGRADATION. `collapsed` decides how many
 * passes may run; it does NOT decide whether the verdict is complete. A
 * collapsed run that reached a terminal verdict writes `degradedReason: null`.
 * Only a collapse that cut the analyst off MID-REQUEST writes a reason — see
 * the write site at the end of `analyze`, which is where that distinction is
 * argued in full.
 *
 * ## THE HEARTBEAT IS AN INVARIANT, NOT AN OPTIMISATION
 *
 * A multi-pass analysis is the longest-running stage in the library, so the
 * claim is heartbeaten BETWEEN every pair of passes. `request.touch` is the
 * drain's `SkillStageContext.touch`, which is literally
 * `SkillQueueStore.touchClaim(row.id)` (`skill-drain.service.ts:568`). A
 * `false` means `reapStale` already gave this row to somebody else: this worker
 * has LOST it and **stops writing immediately** — no verdict, no further
 * passes, `status: 'lost-claim'`. Continuing would race a second worker into
 * the same `session_id` primary key with a verdict built from a claim we no
 * longer hold.
 *
 * It arrives as a CALLBACK rather than as a `SkillQueueStore` + row id for one
 * reason: `ctx.touch()` is the seam the drain already publishes for exactly
 * this, and a second path to the same row would be a second owner of it.
 *
 * ## WHY THIS DOES NOT OPT THE LANE INTO THE REQUEUE WRITE
 *
 * `LaneRunRequest` carries an optional queue-row id, and supplying it opts the
 * run into `SkillQueueStore.requeue` on the two transport failures. This
 * analyzer deliberately does not supply it: the drain maps `SkillLaneFailure`
 * onto row transitions itself (`applyLaneFailure`), and doing BOTH
 * double-writes the row — harmless while `requeue` is idempotent, and a real
 * defect the moment the terminal ceiling fires, because the runner would
 * already have released the claim the terminal mark expects to hold. That seam
 * has exactly one owner, and P1-7 pins it with a SUBSTRING SCAN over every
 * production file (`skill-drain.failures.spec.ts`) — which is also why the
 * field is described here rather than named. The `failed` outcome below is how
 * the failure reaches the drain instead: verbatim, undecided, ready for
 * `SkillStageResult.lane-failed`.
 *
 * ## WHY A DEGRADED ROW IS A SUCCESS AND A LANE FAILURE IS NOT
 *
 * Three outcomes, deliberately not two:
 *
 *  * `ok` — a row was written. It may be a REAL verdict or a degraded one
 *    ("analyzed, no verdict, here is why"). Both stop the drain re-attempting
 *    the same session forever, which is the entire point of `recordDegraded`.
 *  * `failed` — the LANE failed (timeout, unresolvable auth, no parseable JSON
 *    after both rungs of the ladder). NOTHING ran to completion, so nothing is
 *    written on the first pass and the queue row stays re-eligible. A failure
 *    AFTER a good pass persists the draft we already paid for rather than
 *    throwing the tokens away — with `degradedReason` set to the failure kind,
 *    which is why `SkillLaneFailureKind` and the verdict's open reason
 *    vocabulary share the `tool-use-unsupported` spelling.
 *  * `lost-claim` — the heartbeat said stop.
 *
 * NOTHING here catches a non-lane error. A SQLite failure or a defect in the
 * window reader belongs in the drain's own catch, not buried in a
 * `degradedReason` a user has to read.
 */
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import type { LaneRunnerService } from '../lanes/lane-runner.service';
import type { SkillLaneConfig, SkillLaneFailure } from '../lanes/lane.types';
import { readSkillLane } from '../lanes/skill-lane-config';
import type { SessionVerdictStore } from './session-verdict.store';
import {
  FRICTION_KINDS,
  SESSION_VERDICT_DEGRADED_REASONS,
  SESSION_VERDICT_JSON_SCHEMA,
  isEvidenceClass,
  type EvidenceClass,
  type FrictionEntry,
  type FrictionKind,
  type RoutineDraft,
  type SessionVerdict,
} from './session-verdict.types';
import {
  TranscriptWindowReader,
  type TranscriptJsonlReader,
  type TranscriptWindow,
} from './transcript-window.reader';

/** Share of `maxInputChars` pass 1 spends on the newest turns. */
export const ARCHAEOLOGY_TAIL_BUDGET_SHARE = 0.4;

/** Share of `maxInputChars` pass 1 spends on the opening turns. */
export const ARCHAEOLOGY_HEAD_BUDGET_SHARE = 0.1;

/**
 * Share of `maxInputChars` a follow-up pass spends serving what the model
 * asked for. The remainder carries the framing and the verdict-so-far, so the
 * built prompt stays under the budget the runner would otherwise clip.
 */
export const ARCHAEOLOGY_SERVE_BUDGET_SHARE = 0.6;

/**
 * How many of a reply's requests one pass will serve. Model output is
 * untrusted: a reply asking for forty ranges would otherwise divide the serve
 * budget into forty empty windows and burn a pass reading nothing.
 */
export const ARCHAEOLOGY_MAX_REQUESTS_PER_PASS = 6;

/**
 * The reasons this analyzer writes.
 *
 * The verdict's `degradedReason` vocabulary is OPEN by design
 * (`session-verdict.types.ts` header): typed `string`, no union, no `CHECK`.
 * The two members phase 2 declared centrally are re-exported BY REFERENCE
 * rather than re-spelled, so `no-query-path` cannot drift into `noQueryPath`;
 * the three added here are this file's own and are named the same way.
 */
export const ARCHAEOLOGY_DEGRADED_REASONS = {
  /** No `INTERNAL_QUERY_SERVICE_TOKEN` in this host (CLI, e2e). */
  NO_QUERY_PATH: SESSION_VERDICT_DEGRADED_REASONS.NO_QUERY_PATH,
  /**
   * The pass budget collapsed AND the last pass still wanted to read more, so
   * evidence the analyst explicitly asked for was never served. NOT written for
   * a collapsed lane that reached a terminal verdict — that one is complete.
   */
  TOOL_USE_UNSUPPORTED: SESSION_VERDICT_DEGRADED_REASONS.TOOL_USE_UNSUPPORTED,
  /** The session's JSONL could not be located or read. */
  TRANSCRIPT_UNREADABLE: 'transcript-unreadable',
  /** The JSONL was readable and contained no role-bearing turns. */
  EMPTY_TRANSCRIPT: 'empty-transcript',
  /** The lane answered, and the answer carried no usable verdict object. */
  NO_VERDICT_IN_REPLY: 'no-verdict-in-reply',
} as const;

/** What the caller hands over. `sessionId` + `workspaceRoot` locate the JSONL. */
export interface SessionArchaeologyRequest {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  /** Read this exact file instead of resolving by session id (subagent runs). */
  readonly transcriptPath?: string;
  /**
   * Heartbeat the queue claim — the drain's `SkillStageContext.touch`, i.e.
   * `SkillQueueStore.touchClaim(row.id)`.
   *
   * `false` means the row was reclaimed and this worker must stop writing.
   * Omitted by a caller that has no row (the user-initiated analyze), in which
   * case there is no claim to lose and nothing to heartbeat.
   */
  readonly touch?: () => boolean;
  /** The drain's tick signal. */
  readonly signal?: AbortSignal;
  /** The row's `attempt_count`; drives the lane's timeout backoff only. */
  readonly attempt?: number;
}

/**
 * Three outcomes. `ok` covers a degraded row as well as a real verdict — both
 * are rows, and a row is what stops the drain re-attempting forever.
 */
export type SessionArchaeologyResult =
  | { readonly status: 'ok'; readonly verdict: SessionVerdict }
  | {
      readonly status: 'failed';
      readonly failure: SkillLaneFailure;
      /** The draft persisted from an earlier good pass, or `null`. */
      readonly verdict: SessionVerdict | null;
    }
  | { readonly status: 'lost-claim' };

/**
 * The FIXED instructions. They travel as `systemPromptAppend`, which the lane
 * does NOT clip — putting a rubric in the clippable half lets `maxInputChars`
 * silently eat the "reply with ONLY JSON" line off the end and makes every call
 * on that lane come back unparseable.
 */
const ARCHAEOLOGY_RUBRIC = [
  `You are a session archaeologist. You read a transcript of an AI coding session and report WHAT THE USER ACTUALLY WANTED, whether they got it, and how strongly the transcript EVIDENCES that.`,
  ``,
  `Reply with ONLY a JSON object. No preamble, no code fences.`,
  ``,
  `intent: one sentence. Do NOT echo the opening message — the real goal usually only becomes legible several turns in, after the first attempt is corrected. null if the transcript does not settle it.`,
  `outcome: one or two sentences on what actually happened by the end. null if undeterminable.`,
  `evidenceClass: how the outcome is EVIDENCED, not how confident you feel. Prefer "unverified" over guessing.`,
  `frictionMap: every turn where the work went wrong or went backwards, each citing the integer turn index. Empty array if the session ran clean.`,
  `routine: a workflow another session could reuse, with at least one citation, or null. null is a good answer — most sessions are one-offs.`,
  ``,
  `YOU HAVE NO TOOLS. Every window you are served labels each turn "[#<index> <role>]"; cite those integers. To read more of the transcript, name what you need and it will be served on the next pass:`,
  `  requestTurns: [{"from": <index>, "to": <index>}]  — inclusive turn ranges.`,
  `  requestSearch: ["<literal text>"]                 — literal substrings, not regular expressions.`,
  ``,
  `OMIT requestTurns and requestSearch ENTIRELY once the verdict above is final. A reply carrying neither ends the analysis.`,
].join('\n');

/**
 * Tolerant reading of the reply. Every field is optional and nullable at this
 * edge because a model that must be able to SAY "I could not determine the
 * intent" will also, sometimes, omit the key instead. The two closed
 * vocabularies and every turn index are re-checked below rather than trusted
 * from the schema — `SESSION_VERDICT_JSON_SCHEMA` is a request, not a
 * guarantee, and a lane declaring `structuredOutput: 'parse'` never had one.
 */
const ReplySchema = z.object({
  intent: z.string().nullish(),
  outcome: z.string().nullish(),
  evidenceClass: z.string().nullish(),
  frictionMap: z.array(z.unknown()).nullish(),
  routine: z.unknown().nullish(),
  requestTurns: z.array(z.unknown()).nullish(),
  requestSearch: z.array(z.unknown()).nullish(),
});

const FrictionItemSchema = z.object({
  turnIndex: z.number(),
  kind: z.string(),
  note: z.string(),
});

const RoutineSchema = z.object({
  summary: z.string(),
  steps: z.array(z.string()).nullish(),
  citations: z.array(z.number()).nullish(),
});

const RangeSchema = z.object({ from: z.number(), to: z.number() });

/** One accepted reply, after sanitizing. */
interface VerdictDraft {
  readonly intent: string | null;
  readonly outcome: string | null;
  readonly evidenceClass: EvidenceClass | null;
  readonly frictionMap: FrictionEntry[];
  readonly routine: RoutineDraft | null;
}

/** What the model still wants to read, capped and de-duplicated. */
interface RetrievalRequest {
  readonly ranges: ReadonlyArray<{ from: number; to: number }>;
  readonly searches: readonly string[];
}

const NO_REQUEST: RetrievalRequest = { ranges: [], searches: [] };

@injectable()
export class SessionArchaeologistService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly jsonl: TranscriptJsonlReader,
    @inject(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE)
    private readonly laneRunner: LaneRunnerService,
    @inject(SKILL_SYNTHESIS_TOKENS.SESSION_VERDICT_STORE)
    private readonly verdicts: SessionVerdictStore,
  ) {}

  /**
   * Analyze one session and persist its verdict.
   *
   * Resolves in every degraded case — no query path in this host, an
   * unreadable transcript, a reply with no verdict in it. That is the contract
   * P2-3 pins: no exception, therefore no retry storm.
   */
  async analyze(
    req: SessionArchaeologyRequest,
  ): Promise<SessionArchaeologyResult> {
    const cfg = readSkillLane(this.workspace, 'archaeologist');

    let reader: TranscriptWindowReader;
    try {
      reader = await TranscriptWindowReader.open(
        this.jsonl,
        {
          sessionId: req.sessionId,
          workspaceRoot: req.workspaceRoot,
          transcriptPath: req.transcriptPath,
        },
        cfg.maxInputChars,
      );
    } catch (error: unknown) {
      this.logger.warn('[skill-archaeology] could not read the transcript', {
        sessionId: req.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.degrade(
        req,
        ARCHAEOLOGY_DEGRADED_REASONS.TRANSCRIPT_UNREADABLE,
        0,
        0,
        null,
      );
    }

    if (reader.totalTurns === 0) {
      return this.degrade(
        req,
        ARCHAEOLOGY_DEGRADED_REASONS.EMPTY_TRANSCRIPT,
        0,
        0,
        null,
      );
    }

    const configuredMaxPasses = Math.max(1, Math.floor(cfg.maxPasses));
    let passBudget = configuredMaxPasses;
    let passes = 0;
    let draft: VerdictDraft | null = null;
    let model: string | null = null;
    /**
     * Did the run END while the analyst still wanted to read more? Set only at
     * the two loop exits that can answer it; every other exit (an unusable
     * later reply, a host with no query path) leaves it `false`, because in
     * those the previous pass's requests HAD already been served.
     */
    let unservedRequests = false;
    let prompt = buildFirstPassPrompt(reader, cfg, passBudget);

    while (passes < passBudget) {
      // BETWEEN passes, never before the first: the caller has only just
      // claimed the row, and a heartbeat that precedes any work proves nothing.
      if (passes > 0 && !this.touch(req)) return { status: 'lost-claim' };

      const result = await this.laneRunner.run({
        laneId: 'archaeologist',
        prompt,
        systemPromptAppend: ARCHAEOLOGY_RUBRIC,
        outputSchema: SESSION_VERDICT_JSON_SCHEMA,
        signal: req.signal,
        attempt: req.attempt,
      });

      if (result.status === 'unavailable') {
        // Not a failure: a host that registers no query service has nothing
        // wrong with it, and a retry backoff would sit on a row that can never
        // succeed here. Leave the row that says so and let synthesis fall back
        // to the extractor path.
        this.logger.debug('[skill-archaeology] no analysis lane in this host', {
          sessionId: req.sessionId,
          reason: result.reason,
        });
        if (!draft) {
          return this.degrade(
            req,
            ARCHAEOLOGY_DEGRADED_REASONS.NO_QUERY_PATH,
            reader.totalTurns,
            passes,
            model,
          );
        }
        break;
      }

      if (result.status === 'failed') {
        this.logger.warn('[skill-archaeology] analysis lane failed', {
          sessionId: req.sessionId,
          kind: result.failure.kind,
          reason: result.failure.reason,
          passes,
        });
        return {
          status: 'failed',
          failure: result.failure,
          // Persist what we already paid for. Discarding a good pass-1 verdict
          // because pass 3 timed out spends the same tokens again next tick.
          verdict: draft
            ? this.persist(
                req,
                draft,
                reader.totalTurns,
                passes,
                model,
                result.failure.kind,
              )
            : null,
        };
      }

      const run = result.run;
      passes++;
      model = run.lane.model;
      // R6, and the whole of it. `passesAllowed` is 1 both for a lane that
      // DECLARES no tool use and for one DISCOVERED unable to drive the loop.
      passBudget = Math.min(passBudget, Math.max(1, run.passesAllowed));

      const parsed = this.readReply(run.json, req.sessionId);
      if (!parsed) {
        if (!draft) {
          this.logger.warn('[skill-archaeology] no verdict in the reply', {
            sessionId: req.sessionId,
            raw: run.text.slice(0, 200),
          });
          return this.degrade(
            req,
            ARCHAEOLOGY_DEGRADED_REASONS.NO_VERDICT_IN_REPLY,
            reader.totalTurns,
            passes,
            model,
          );
        }
        // A later pass that came back unusable does not invalidate the verdict
        // an earlier one produced.
        break;
      }

      draft = parsed.draft;
      const wantsMore =
        parsed.request.ranges.length > 0 || parsed.request.searches.length > 0;
      if (!wantsMore) {
        // TERMINAL. The analyst says it has everything it needs, so nothing was
        // left unread and the verdict is complete however few passes it took.
        unservedRequests = false;
        break;
      }
      if (passes >= passBudget) {
        // The ceiling ended it while the analyst still wanted evidence. THIS is
        // what makes a verdict incomplete — see the write site below.
        unservedRequests = true;
        break;
      }

      prompt = buildFollowUpPrompt(
        reader,
        cfg,
        draft,
        parsed.request,
        passBudget - passes,
      );
    }

    if (!draft) {
      // Only reachable when `passBudget` was satisfied without a single
      // accepted reply, which the branches above already cover; kept so the
      // write below never has to assert non-null.
      return this.degrade(
        req,
        ARCHAEOLOGY_DEGRADED_REASONS.NO_VERDICT_IN_REPLY,
        reader.totalTurns,
        passes,
        model,
      );
    }

    /**
     * DEGRADE ONLY WHEN THE PASS ACTUALLY WANTED MORE.
     *
     * The signal that matters is whether the ANALYST wanted more evidence, not
     * what the LANE was capable of. Writing the reason off the capability alone
     * used the collapse as a proxy for incompleteness, and on a clean
     * single-pass verdict that proxy is simply wrong: the analyst said it was
     * done, and a verdict it called final is complete however cheaply it was
     * produced.
     *
     * The cost of getting this backwards is the whole point of phase 2. A
     * `toolUse: 'none'` lane is exactly the cheap endpoint phase 1's provider
     * routing exists to move background work ONTO. Marking its every verdict
     * degraded makes `hasUsableVerdict` read `false` for all of them, so those
     * lanes would spend tokens nightly and have every result discarded — phase
     * 2 would buy nothing precisely where it was designed to pay off.
     *
     * So both halves must hold: the budget COLLAPSED below what was configured,
     * AND the terminating pass left requests unserved. A run that exhausts a
     * deliberately configured `maxPasses` is not written with this reason —
     * that lane's tool use was never in question, and naming it here would be a
     * lie in a field a user reads.
     */
    const collapsed = passBudget < configuredMaxPasses;
    const cutShortByCollapse = collapsed && unservedRequests;
    return {
      status: 'ok',
      verdict: this.persist(
        req,
        draft,
        reader.totalTurns,
        passes,
        model,
        cutShortByCollapse
          ? ARCHAEOLOGY_DEGRADED_REASONS.TOOL_USE_UNSUPPORTED
          : null,
      ),
    };
  }

  /**
   * Heartbeat the claim. `false` means `reapStale` handed the row to another
   * worker while we were mid-analysis and this one must stop writing.
   */
  private touch(req: SessionArchaeologyRequest): boolean {
    if (!req.touch) return true;
    const held = req.touch();
    if (!held) {
      this.logger.warn(
        '[skill-archaeology] lost the queue claim mid-analysis; stopping',
        { sessionId: req.sessionId },
      );
    }
    return held;
  }

  private persist(
    req: SessionArchaeologyRequest,
    draft: VerdictDraft,
    turnCount: number,
    passes: number,
    model: string | null,
    degradedReason: string | null,
  ): SessionVerdict {
    return this.verdicts.save({
      sessionId: req.sessionId,
      workspaceRoot: req.workspaceRoot,
      intent: draft.intent,
      outcome: draft.outcome,
      evidenceClass: draft.evidenceClass,
      frictionMap: draft.frictionMap,
      routine: draft.routine,
      turnCount,
      lane: 'archaeologist',
      model,
      passes,
      degradedReason,
    });
  }

  private degrade(
    req: SessionArchaeologyRequest,
    reason: string,
    turnCount: number,
    passes: number,
    model: string | null,
  ): SessionArchaeologyResult {
    return {
      status: 'ok',
      verdict: this.verdicts.recordDegraded(req.sessionId, reason, {
        workspaceRoot: req.workspaceRoot,
        turnCount,
        lane: 'archaeologist',
        model,
        passes,
      }),
    };
  }

  /**
   * The model's reply → a sanitized draft plus what it still wants to read, or
   * `null` when there is no usable object in it.
   *
   * Sanitizing is not defensive noise here: `SessionVerdictStore` THROWS on a
   * fractional turn index or a routine with no citations, and a throw out of
   * this analyzer is exactly the retry storm P2-3 forbids. A bad friction entry
   * is dropped and the rest of the verdict survives.
   */
  private readReply(
    json: unknown,
    sessionId: string,
  ): { draft: VerdictDraft; request: RetrievalRequest } | null {
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      return null;
    }
    const parsed = ReplySchema.safeParse(json);
    if (!parsed.success) return null;
    const reply = parsed.data;

    const evidenceClass =
      typeof reply.evidenceClass === 'string' &&
      isEvidenceClass(reply.evidenceClass)
        ? reply.evidenceClass
        : null;

    return {
      draft: {
        intent: nonEmpty(reply.intent),
        outcome: nonEmpty(reply.outcome),
        evidenceClass,
        frictionMap: readFriction(reply.frictionMap ?? []),
        routine: this.readRoutine(reply.routine, sessionId),
      },
      request: readRequest(reply.requestTurns ?? [], reply.requestSearch ?? []),
    };
  }

  /**
   * A routine whose citations do not survive sanitizing becomes `null` rather
   * than a routine with an empty `citations` array — the store rejects the
   * latter outright, and "a routine you cannot cite is a guess" is the rule it
   * is enforcing.
   */
  private readRoutine(value: unknown, sessionId: string): RoutineDraft | null {
    if (value === null || value === undefined) return null;
    const parsed = RoutineSchema.safeParse(value);
    if (!parsed.success) return null;
    const citations = readIndices(parsed.data.citations ?? []);
    if (citations.length === 0) {
      this.logger.debug('[skill-archaeology] dropped an uncited routine', {
        sessionId,
      });
      return null;
    }
    const summary = parsed.data.summary.trim();
    if (summary.length === 0) return null;
    return { summary, steps: parsed.data.steps ?? [], citations };
  }
}

/** Pass 1: tail-first, plus the opening turns for context. */
function buildFirstPassPrompt(
  reader: TranscriptWindowReader,
  cfg: SkillLaneConfig,
  passBudget: number,
): string {
  const tail = reader.tail(
    reader.totalTurns,
    Math.floor(cfg.maxInputChars * ARCHAEOLOGY_TAIL_BUDGET_SHARE),
  );
  const head = reader.head(
    reader.totalTurns,
    Math.floor(cfg.maxInputChars * ARCHAEOLOGY_HEAD_BUDGET_SHARE),
  );
  return [
    describeSession(reader, passBudget - 1),
    ``,
    `=== opening turns ===`,
    renderWindow(head),
    ``,
    `=== most recent turns ===`,
    renderWindow(tail),
  ].join('\n');
}

/**
 * Passes 2..N: exactly what the previous reply asked for, each window given an
 * equal slice of the serve budget and re-bounded by the reader against the
 * lane's own `maxInputChars`.
 */
function buildFollowUpPrompt(
  reader: TranscriptWindowReader,
  cfg: SkillLaneConfig,
  draft: VerdictDraft,
  request: RetrievalRequest,
  passesLeft: number,
): string {
  const count = request.ranges.length + request.searches.length;
  const perWindow = Math.floor(
    (cfg.maxInputChars * ARCHAEOLOGY_SERVE_BUDGET_SHARE) / Math.max(1, count),
  );

  const served: string[] = [];
  for (const range of request.ranges) {
    served.push(`=== turns #${range.from}–#${range.to} ===`);
    served.push(renderWindow(reader.range(range.from, range.to, perWindow)));
    served.push('');
  }
  for (const probe of request.searches) {
    served.push(`=== turns containing "${probe}" ===`);
    served.push(renderWindow(reader.search(probe, perWindow)));
    served.push('');
  }

  return [
    describeSession(reader, passesLeft - 1),
    ``,
    `Your verdict so far:`,
    JSON.stringify(
      {
        intent: draft.intent,
        outcome: draft.outcome,
        evidenceClass: draft.evidenceClass,
        frictionMap: draft.frictionMap,
        routine: draft.routine,
      },
      null,
      2,
    ),
    ``,
    `Here is what you asked to read. Restate the WHOLE verdict, refined.`,
    ``,
    ...served,
  ].join('\n');
}

function describeSession(
  reader: TranscriptWindowReader,
  requestsLeft: number,
): string {
  const budget =
    requestsLeft > 0
      ? `You may ask to read more at most ${requestsLeft} more time(s).`
      : `This is your LAST pass — omit requestTurns and requestSearch and give your final verdict.`;
  return [
    `The session has ${reader.totalTurns} turns, numbered 0 to ${reader.totalTurns - 1}.`,
    budget,
  ].join('\n');
}

/** An empty window is stated rather than rendered as blank space. */
function renderWindow(window: TranscriptWindow): string {
  return window.text.length > 0 ? window.text : '(no turns matched)';
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/** Model-supplied turn indices → non-negative integers, de-duplicated, ascending. */
function readIndices(values: readonly number[]): number[] {
  const out = new Set<number>();
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const index = Math.floor(value);
    if (index < 0) continue;
    out.add(index);
  }
  return [...out].sort((a, b) => a - b);
}

function readFriction(entries: readonly unknown[]): FrictionEntry[] {
  const out: FrictionEntry[] = [];
  for (const raw of entries) {
    const parsed = FrictionItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (!Number.isFinite(parsed.data.turnIndex)) continue;
    const turnIndex = Math.floor(parsed.data.turnIndex);
    if (turnIndex < 0) continue;
    if (!isFrictionKind(parsed.data.kind)) continue;
    out.push({ turnIndex, kind: parsed.data.kind, note: parsed.data.note });
  }
  return out;
}

function isFrictionKind(value: string): value is FrictionKind {
  return (FRICTION_KINDS as readonly string[]).includes(value);
}

/**
 * The reply's requests, capped at {@link ARCHAEOLOGY_MAX_REQUESTS_PER_PASS}.
 * Ranges come first because a named range is a stronger signal than a probe:
 * the model saw that index in a window it was served.
 */
function readRequest(
  turns: readonly unknown[],
  searches: readonly unknown[],
): RetrievalRequest {
  const ranges: Array<{ from: number; to: number }> = [];
  for (const raw of turns) {
    if (ranges.length >= ARCHAEOLOGY_MAX_REQUESTS_PER_PASS) break;
    const parsed = RangeSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (
      !Number.isFinite(parsed.data.from) ||
      !Number.isFinite(parsed.data.to)
    ) {
      continue;
    }
    ranges.push({
      from: Math.floor(parsed.data.from),
      to: Math.floor(parsed.data.to),
    });
  }

  const probes: string[] = [];
  for (const raw of searches) {
    if (ranges.length + probes.length >= ARCHAEOLOGY_MAX_REQUESTS_PER_PASS) {
      break;
    }
    if (typeof raw !== 'string') continue;
    const probe = raw.trim();
    if (probe.length === 0 || probes.includes(probe)) continue;
    probes.push(probe);
  }

  if (ranges.length === 0 && probes.length === 0) return NO_REQUEST;
  return { ranges, searches: probes };
}
