/**
 * The product graph the funnel ports drive: the services one container
 * resolves, the timer capture, the lane-runner instrumentation and the child
 * product container (see `funnel-host-port.ts` for what each override is and
 * why it is sanctioned).
 *
 * Host-only: value-imports the skill-synthesis and persistence barrels.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SKILL_SYNTHESIS_TOKENS,
  SkillMdGenerator,
  registerSkillSynthesisServices,
  type DrainTier,
  type LaneRunRequest,
  type LaneRunResult,
  type SessionVerdictStore,
  type SkillCandidateRow,
  type SkillCandidateStore,
  type SkillCuratorService,
  type SkillDrainService,
  type SkillPromotionService,
  type SkillRegistryStore,
  type SkillSuggestionStore,
  type SkillSynthesisService,
  type SkillTriggerService,
} from '@ptah-extension/skill-synthesis';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { DependencyContainer, InjectionToken } from 'tsyringe';
import { z } from 'zod';

import { CassetteMissError } from '../../doubles/cassette-store';
import type { LaneRunnerDouble } from '../../doubles/recorded-lane-runner';
import { classifyBodyShape } from '../../labelling/select-rubric-sample';
import type {
  FunnelBacklogPort,
  FunnelClock,
  FunnelCandidateView,
  FunnelDrainTick,
  FunnelFeedEvent,
  FunnelLaneStats,
  FunnelQueueRowView,
  FunnelSessionFile,
  SeedSkillInput,
} from './funnel-port';

/** `harness-sync` `HARNESS_SYNC_TOKENS.PROPAGATION` (`di/tokens.ts:30`), interned. */
export const HARNESS_PROPAGATION_TOKEN = Symbol.for('HarnessSyncPropagation');
/** The frequent drain cron, every 15 minutes (`thoth-runtime/src/lib/skill-drain-jobs.ts:47`). */
export const FREQUENT_TICK_MS = 15 * 60_000;
/** One simulated day of frequent ticks bounds a drain cycle. */
export const MAX_FREQUENT_TICKS = 96;
/** `DRAIN_TIER_STAGES.frequent` (`skill-drain.service.ts:400-407`). */
export const FREQUENT_STAGES = [
  'prefilter',
  'synthesis',
  'embedding',
  'clustering',
  'cluster-synthesis',
  'judge',
] as const;
/** `skillSynthesis.triggers.idleMs` (`skill-trigger-config.ts:9`, default 600 000). */
export const IDLE_MS_KEY = 'skillSynthesis.triggers.idleMs';
export const IDLE_MS_DEFAULT = 600_000;
/** `skill-retirement.service.ts:43-48`; the product default is 30 days each (K2). */
export const DORMANT_AFTER_DAYS_KEY =
  'skillSynthesis.retirement.dormantAfterDays';
export const RETIRE_AFTER_DORMANT_DAYS_KEY =
  'skillSynthesis.retirement.retireAfterDormantDays';
export const RETIREMENT_DAYS_DEFAULT = 30;
/** Event-loop turns a fire-and-forget product callback gets to settle. */
export const SETTLE_TURNS = 5_000;
/** Simulated time between two scripted trigger operations. */
export const OPERATION_GAP_MS = 60_000;

export interface RetirementLike {
  run(
    origin: Record<string, unknown>,
    now: number,
  ): Promise<{
    readonly dormantSlugs: readonly string[];
    readonly retiredSlugs: readonly string[];
    readonly skippedReason?: string;
  }>;
}

export interface RecorderLike {
  recordSkillEvent(input: {
    slug: string;
    sessionId: string;
    workspaceRoot: string;
    contextId: string | null;
    succeeded: boolean;
    invokedAt: number;
    source: 'tool-use';
  }): void;
}

export interface NotifyRegistry<T> {
  notifyAll(payload: T): void;
}

export interface RpcHandlerLike {
  handleMessage(message: {
    method: string;
    params: unknown;
    correlationId: string;
  }): Promise<{ success: boolean; error?: string }>;
}

export interface HarnessPropagationLike {
  propagate(cwd: string, reason: string): Promise<unknown>;
}

/** What the host or a spec supplies. */
export interface FunnelHostInput {
  readonly container: DependencyContainer;
  /** The isolated home: transcripts go under its `.claude/projects`. */
  readonly home: string;
  /** The instance the container resolves for `LANE_RUNNER_SERVICE`. */
  readonly laneRunner: LaneRunnerDouble;
}

// ------------------------------------------------------------------ helpers

export function resolveRequired<T>(
  container: DependencyContainer,
  token: InjectionToken<T>,
): T {
  if (!container.isRegistered(token, true)) {
    const name =
      typeof token === 'symbol'
        ? (token.description ?? String(token))
        : typeof token === 'function'
          ? token.name
          : String(token);
    throw new Error(`the funnel container has no ${name}`);
  }
  return container.resolve<T>(token);
}

export function yieldTurn(): Promise<void> {
  return new Promise((done) => setImmediate(done));
}

/** Poll `predicate` across event-loop turns; throws naming `what` when it never holds. */
export async function settle(
  predicate: () => boolean,
  what: string,
): Promise<void> {
  for (let turn = 0; turn < SETTLE_TURNS; turn += 1) {
    if (predicate()) return;
    await yieldTurn();
  }
  if (!predicate()) throw new Error(`${what} did not settle`);
}

/** `~/.claude/projects/<escaped>` exactly as `JsonlReaderService` escapes it (`jsonl-reader.service.ts:334`). */
export function sessionsDirectoryFor(
  home: string,
  workspaceRoot: string,
): string {
  return join(
    home,
    '.claude',
    'projects',
    workspaceRoot.replace(/[:\\/]/g, '-'),
  );
}

export interface CapturedTimer {
  readonly ms: number;
  readonly fire: () => void;
  cleared: boolean;
}

/**
 * Run `fn` with `setTimeout`/`clearTimeout` replaced for its synchronous
 * extent only: every timer it arms is captured, never scheduled. The caller
 * fires the ones it means to; the rest are dropped. Handles are inert objects,
 * so a later real `clearTimeout(handle)` is a no-op.
 */
export function captureTimers(fn: () => void): CapturedTimer[] {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const timers: CapturedTimer[] = [];
  const fakeSet = (
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    const handle = {
      ms: ms ?? 0,
      fire: () => callback(...args),
      cleared: false,
      ref: () => handle,
      unref: () => handle,
      hasRef: () => false,
      refresh: () => handle,
    };
    timers.push(handle);
    return handle;
  };
  const fakeClear = (handle: unknown) => {
    const captured = timers.find((timer) => timer === handle);
    if (captured) captured.cleared = true;
    else realClear(handle as NodeJS.Timeout);
  };
  globalThis.setTimeout = fakeSet as unknown as typeof setTimeout;
  globalThis.clearTimeout = fakeClear as unknown as typeof clearTimeout;
  try {
    fn();
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
  return timers;
}

/**
 * Count the lane runner's calls and cassette misses by shadowing `run` on the
 * instance every product service holds. `restore` removes the shadow.
 */
export function instrumentLaneRunner(runner: LaneRunnerDouble): {
  stats: () => FunnelLaneStats;
  restore: () => void;
} {
  let calls = 0;
  let misses = 0;
  const original = runner.run.bind(runner);
  Object.defineProperty(runner, 'run', {
    configurable: true,
    writable: true,
    value: async (req: LaneRunRequest): Promise<LaneRunResult> => {
      calls += 1;
      try {
        return await original(req);
      } catch (error: unknown) {
        if (error instanceof CassetteMissError) misses += 1;
        throw error;
      }
    },
  });
  return {
    stats: () => ({ calls, misses }),
    restore: () => {
      delete (runner as { run?: unknown }).run;
    },
  };
}

/**
 * A fresh product graph over the same database: the production registration
 * into a child container, with `LANE_RUNNER_SERVICE` re-bound to `laneRunner`
 * (registration binds the real runner, which must never be reached).
 */
export function childProductContainer(
  parent: DependencyContainer,
  laneRunner: LaneRunnerDouble,
  overrides: (child: DependencyContainer) => void = () => undefined,
): DependencyContainer {
  const child = parent.createChildContainer();
  registerSkillSynthesisServices(
    child,
    resolveRequired<Logger>(parent, TOKENS.LOGGER),
  );
  child.register(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE, {
    useValue: laneRunner,
  });
  overrides(child);
  if (
    child.resolve(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE) !== laneRunner
  ) {
    throw new Error(
      'child container does not resolve the recorded lane runner',
    );
  }
  return child;
}

export const queueRowSchema = z.object({
  session_id: z.string(),
  stage: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  enqueued_at: z.number(),
  finished_at: z.number().nullable(),
  candidate_id: z.string().nullable(),
  payload: z.string(),
});
export const idRowSchema = z.object({
  id: z.string(),
  source_session_ids: z.string(),
});
export const countSchema = z.object({ n: z.number() });
export const payloadSchema = z.object({ candidateId: z.string().optional() });
export const suggestionRowSchema = z.object({
  id: z.string(),
  member_session_ids: z.string(),
});
export const stringArraySchema = z.array(z.string());

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A corrupt JSON column reads as "nothing there"; the view says so.
    return null;
  }
}

export function parseStringArray(text: string): string[] {
  const parsed = stringArraySchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : [];
}

export function candidateView(row: SkillCandidateRow): FunnelCandidateView {
  let bodyShape: FunnelCandidateView['bodyShape'];
  try {
    bodyShape = classifyBodyShape(readFileSync(row.bodyPath, 'utf8'));
  } catch {
    // A missing or unreadable SKILL.md is reported as such, never guessed.
    bodyShape = 'unreadable';
  }
  return {
    id: row.id,
    name: row.name,
    sourceSessionIds: [...row.sourceSessionIds],
    status: row.status,
    rejectedReason: row.rejectedReason,
    successCount: row.successCount,
    bodyShape,
    judgeStatus: row.judgeStatus,
    judgePanelRationales: row.judgePanelRationales,
    replayConfidence: row.replayConfidence,
    createdAt: row.createdAt,
  };
}

export function descriptionOf(name: string): string {
  return `Use when running the ${name.replace(/-/g, ' ')} workflow.`;
}

/** The configured value; anything the product would not accept fails closed. */
export function readRetirementDays(
  workspace: IWorkspaceProvider,
  key: string,
): number {
  const value =
    workspace.getConfiguration<unknown>('ptah', key, RETIREMENT_DAYS_DEFAULT) ??
    RETIREMENT_DAYS_DEFAULT;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 3650
  ) {
    throw new Error(`unsupported retirement setting ${key}=${String(value)}`);
  }
  return value;
}

export function stageTranscripts(
  home: string,
  workspaceRoot: string,
  sessions: readonly FunnelSessionFile[],
): void {
  mkdirSync(workspaceRoot, { recursive: true });
  const dir = sessionsDirectoryFor(home, workspaceRoot);
  mkdirSync(dir, { recursive: true });
  for (const session of sessions) {
    writeFileSync(join(dir, `${session.id}.jsonl`), session.jsonl, 'utf8');
  }
}

/** The product services one container resolves, read lazily. */
export class ProductGraph {
  constructor(readonly container: DependencyContainer) {}

  get synthesis(): SkillSynthesisService {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
    );
  }
  get trigger(): SkillTriggerService {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE,
    );
  }
  get drainService(): SkillDrainService {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE,
    );
  }
  get store(): SkillCandidateStore {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE,
    );
  }
  get verdicts(): SessionVerdictStore {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SESSION_VERDICT_STORE,
    );
  }
  get promotion(): SkillPromotionService {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_PROMOTION_SERVICE,
    );
  }
  get curator(): SkillCuratorService {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_CURATOR_SERVICE,
    );
  }
  get retirement(): RetirementLike {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_RETIREMENT_SERVICE,
    );
  }
  get recorder(): RecorderLike {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_INVOCATION_RECORDER,
    );
  }
  get registry(): SkillRegistryStore {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE,
    );
  }
  get suggestions(): SkillSuggestionStore {
    return resolveRequired(
      this.container,
      SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE,
    );
  }
  /** Registered by class (`di/register.ts:75`). */
  get md(): SkillMdGenerator {
    return resolveRequired(this.container, SkillMdGenerator);
  }
  get sqlite(): SqliteConnectionService {
    return resolveRequired(
      this.container,
      PERSISTENCE_TOKENS.SQLITE_CONNECTION,
    );
  }
  get workspace(): IWorkspaceProvider {
    return resolveRequired(this.container, PLATFORM_TOKENS.WORKSPACE_PROVIDER);
  }

  async drain(tier: DrainTier): Promise<FunnelDrainTick> {
    const summary = await this.drainService.drain({
      tier,
      signal: new AbortController().signal,
      onBattery: false,
      now: Date.now(),
    });
    return {
      tier,
      claimed: summary.claimed,
      done: summary.done,
      failed: summary.failed,
      unscored: summary.unscored,
      skippedItems: summary.skippedItems,
      skipReason: summary.reason ?? null,
      error: summary.error ?? null,
    };
  }

  queueRows(where: string, ...params: unknown[]): FunnelQueueRowView[] {
    return z
      .array(queueRowSchema)
      .parse(
        this.sqlite.db
          .prepare(
            `SELECT session_id, stage, status, reason, enqueued_at, finished_at, candidate_id, payload
               FROM skill_synthesis_queue WHERE ${where} ORDER BY enqueued_at, id`,
          )
          .all(...params),
      )
      .map((row) => {
        const payload = payloadSchema.safeParse(parseJson(row.payload));
        return {
          sessionId: row.session_id,
          stage: row.stage,
          status: row.status,
          reason: row.reason,
          enqueuedAt: row.enqueued_at,
          finishedAt: row.finished_at,
          candidateId: row.candidate_id,
          payloadCandidateId: payload.success
            ? (payload.data.candidateId ?? null)
            : null,
        };
      });
  }

  candidate(id: string): FunnelCandidateView | null {
    const row = this.store.findById(id as SkillCandidateRow['id']);
    return row === null ? null : candidateView(row);
  }

  /** Candidates whose source sessions include one `matches` accepts. */
  candidates(matches: (sessionId: string) => boolean): FunnelCandidateView[] {
    return z
      .array(idRowSchema)
      .parse(
        this.sqlite.db
          .prepare(
            'SELECT id, source_session_ids FROM skill_candidates ORDER BY created_at, id',
          )
          .all(),
      )
      .filter((row) => parseStringArray(row.source_session_ids).some(matches))
      .map((row) => this.candidate(row.id))
      .filter((row): row is FunnelCandidateView => row !== null);
  }

  count(sql: string, ...params: unknown[]): number {
    return countSchema.parse(this.sqlite.db.prepare(sql).get(...params)).n;
  }

  /** Events of the session set, oldest first (`recentEvents` is newest first). */
  feed(sessionIds: ReadonlySet<string>): FunnelFeedEvent[] {
    return [...this.synthesis.recentEvents(200)]
      .reverse()
      .filter(
        (event) =>
          event.sessionId !== undefined && sessionIds.has(event.sessionId),
      )
      .map((event) => ({
        kind: event.kind,
        sessionId: event.sessionId ?? null,
        reason: event.reason ?? null,
      }));
  }

  /** Start synthesis and the trigger service; the trigger's timers are captured and dropped. */
  async start(): Promise<void> {
    await this.synthesis.start();
    const trigger = this.trigger;
    captureTimers(() => trigger.start());
  }

  stop(): void {
    try {
      this.trigger.stop();
    } finally {
      this.synthesis.stop();
    }
  }

  seedCandidate(input: SeedSkillInput): string {
    const settings = this.synthesis.readSettings();
    const description = descriptionOf(input.name);
    const written = this.md.writeCandidate(
      { slug: input.name, description, body: input.body },
      settings.candidatesDir,
    );
    return this.store.registerCandidate({
      name: written.slug,
      description,
      bodyPath: written.filePath,
      sourceSessionIds: [...input.sessionIds],
      trajectoryHash: `bench-seed:${written.slug}`,
      embedding: null,
      createdAt: input.createdAt,
      workspaceRoot: null,
    }).candidate.id;
  }

  /** A promoted, materialized, `synth`-registered skill. */
  seedPromoted(
    input: SeedSkillInput & { readonly promotedAt: number },
  ): string {
    const description = descriptionOf(input.name);
    const materialized = this.md.promoteToActive({
      slug: input.name,
      description,
      body: input.body,
    });
    const { candidate } = this.store.registerCandidate({
      name: materialized.slug,
      description,
      bodyPath: materialized.filePath,
      sourceSessionIds: [...input.sessionIds],
      trajectoryHash: `bench-seed:${materialized.slug}`,
      embedding: null,
      createdAt: input.createdAt,
      workspaceRoot: null,
    });
    const promoted = this.store.promoteAtomically(candidate.id, {
      promotedAt: input.promotedAt,
      bodyPath: materialized.filePath,
      name: materialized.slug,
    });
    this.upsertSynth(materialized.slug, materialized.filePath, promoted.id);
    return promoted.id;
  }

  upsertSynth(
    slug: string,
    userPath: string,
    candidateId: string | null,
  ): void {
    this.registry.upsert({
      slug,
      kind: 'skill',
      userPath,
      originPluginId: null,
      originVersion: null,
      sourceHash: null,
      cloneStatus: 'synth',
      diverged: false,
      historyDir: null,
      lastEnhancedAt: null,
      candidateId,
      pendingSourceHash: null,
    });
  }
}

/**
 * Dispose what a child container constructed. A disposed container refuses
 * every later call, so its registrations need no separate reset.
 */
export async function disposeChild(child: DependencyContainer): Promise<void> {
  await child.dispose();
}

/** `skill.backlog.drain`: copied transcripts enqueued, drain ticks per tier. */
export class HostBacklogPort implements FunnelBacklogPort {
  private readonly graph: ProductGraph;
  private readonly lane: ReturnType<typeof instrumentLaneRunner>;
  private readonly workspaceRoot: string;
  private readonly templates = new Map<string, string>();
  private started = false;

  constructor(private readonly input: FunnelHostInput) {
    this.graph = new ProductGraph(input.container);
    this.lane = instrumentLaneRunner(input.laneRunner);
    this.workspaceRoot = join(input.home, 'funnel-backlog-workspace');
  }

  async begin(
    sessions: readonly FunnelSessionFile[],
    clock: FunnelClock,
  ): Promise<void> {
    void clock;
    for (const session of sessions)
      this.templates.set(session.id, session.jsonl);
    stageTranscripts(this.input.home, this.workspaceRoot, []);
    this.started = true;
    await this.graph.synthesis.start();
  }

  async enqueueCopy(templateId: string, sessionId: string): Promise<void> {
    const jsonl = this.templates.get(templateId);
    if (jsonl === undefined)
      throw new Error(`no backlog template ${templateId}`);
    stageTranscripts(this.input.home, this.workspaceRoot, [
      { id: sessionId, jsonl },
    ]);
    await this.graph.synthesis.enqueueAnalyze(sessionId, this.workspaceRoot, {
      source: 'session-end',
    });
  }

  drainTick(tier: DrainTier): Promise<FunnelDrainTick> {
    return this.graph.drain(tier);
  }

  queueRows(sessionPrefix: string): FunnelQueueRowView[] {
    return this.graph.queueRows('session_id LIKE ?', `${sessionPrefix}%`);
  }

  candidate(id: string): FunnelCandidateView | null {
    return this.graph.candidate(id);
  }

  laneStats(): FunnelLaneStats {
    return this.lane.stats();
  }

  async close(): Promise<void> {
    try {
      if (this.started) this.graph.synthesis.stop();
    } finally {
      this.lane.restore();
    }
  }
}
