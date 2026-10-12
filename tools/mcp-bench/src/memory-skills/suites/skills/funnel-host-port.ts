/**
 * The product side of the skills funnel suites: {@link FunnelPorts} over a
 * container that carries the production skill-synthesis registration
 * (`registerSkillSynthesisServices`): the booted bench host container, or the
 * production-DI container a spec builds.
 *
 * What runs is product code, entered through product entry points:
 *  - triggers: `SessionEndCallbackRegistry.notifyAll`, `SessionActivityRegistry`
 *    plus the trigger service's own idle timer, `PostToolUseCallbackRegistry`
 *    (Skill tool use) and the RPC method `skillSynthesis:analyzeNow`;
 *  - the queue: `SkillSynthesisService.start` (stage handlers) and
 *    `SkillDrainService.drain` per tier;
 *  - promotion, retirement and the curator's reconcile through their services.
 *
 * Overrides, each one the design names (benchmark-design.md 4.4):
 *  - the record/replay lane runner the host installed for `LANE_RUNNER_SERVICE`
 *    is shadowed on the instance to count calls and cassette misses; the race
 *    case puts a pause gate in front of it in a child container;
 *  - observation-only hooks on a product store instance (they log and call
 *    through): the cap read and the compare-and-set in the race case, and the
 *    re-read in the retirement commit-time case, where the hook records one
 *    real invocation event through the product recorder before calling through;
 *  - a never-resolving `SKILL_REPROPAGATION_TOKEN` in a child container for the
 *    reconcile-timeout case only;
 *  - the injected clock: `Date.now` is simulated; trigger timers armed in
 *    `start()` or one activity notification are captured, never real-timed.
 *
 * Host-only: value-imports the skill-synthesis, agent-sdk and persistence
 * barrels. The suites import its types only (`funnel-port.ts`).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  SKILL_REPROPAGATION_TOKEN,
  type DrainTier,
  type SkillCandidateRow,
} from '@ptah-extension/skill-synthesis';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { DependencyContainer } from 'tsyringe';
import { z } from 'zod';

import type { LaneRunnerDouble } from '../../doubles/recorded-lane-runner';
import type {
  FunnelCandidateView,
  FunnelClock,
  FunnelDeliveryObservation,
  FunnelDrainTick,
  FunnelFeedEvent,
  FunnelLaneStats,
  FunnelLifecyclePort,
  FunnelLifecycleSettings,
  ManualAnalyzeOutcome,
  FunnelPorts,
  FunnelRaceObservation,
  FunnelRaceSchedule,
  FunnelRetireObservation,
  FunnelRunPort,
  FunnelSessionFile,
  FunnelSnapshot,
  FunnelVerdictView,
  SeedSkillInput,
} from './funnel-port';
import {
  DORMANT_AFTER_DAYS_KEY,
  FREQUENT_STAGES,
  FREQUENT_TICK_MS,
  type FunnelHostInput,
  HARNESS_PROPAGATION_TOKEN,
  type HarnessPropagationLike,
  IDLE_MS_DEFAULT,
  IDLE_MS_KEY,
  MAX_FREQUENT_TICKS,
  type NotifyRegistry,
  OPERATION_GAP_MS,
  ProductGraph,
  RETIRE_AFTER_DORMANT_DAYS_KEY,
  type RpcHandlerLike,
  captureTimers,
  childProductContainer,
  disposeChild,
  descriptionOf,
  instrumentLaneRunner,
  parseStringArray,
  readRetirementDays,
  resolveRequired,
  settle,
  stageTranscripts,
  suggestionRowSchema,
  yieldTurn,
  HostBacklogPort,
} from './funnel-host-graph';

// ------------------------------------------------------------------ 22.1

class HostRunPort implements FunnelRunPort {
  private readonly graph: ProductGraph;
  private readonly lane: ReturnType<typeof instrumentLaneRunner>;
  private readonly workspaceRoot: string;
  private clock: FunnelClock | null = null;
  private started = false;

  constructor(private readonly input: FunnelHostInput) {
    this.graph = new ProductGraph(input.container);
    this.lane = instrumentLaneRunner(input.laneRunner);
    this.workspaceRoot = join(input.home, 'funnel-workspace');
  }

  private requireClock(): FunnelClock {
    if (this.clock === null) {
      throw new Error('funnel run port used before prepare');
    }
    return this.clock;
  }

  async prepare(
    sessions: readonly FunnelSessionFile[],
    clock: FunnelClock,
  ): Promise<void> {
    this.clock = clock;
    stageTranscripts(this.input.home, this.workspaceRoot, sessions);
    this.started = true;
    await this.graph.start();
  }

  /** The enqueue a trigger fires is fire-and-forget; wait for its row or its rejection. */
  private async settleEnqueue(sessionId: string): Promise<void> {
    await settle(
      () =>
        this.graph.count(
          "SELECT COUNT(*) AS n FROM skill_synthesis_queue WHERE session_id = ? AND stage = 'prefilter'",
          sessionId,
        ) > 0 ||
        this.graph
          .feed(new Set([sessionId]))
          .some(
            (event) => event.kind === 'ineligible' || event.kind === 'error',
          ),
      `enqueue of ${sessionId}`,
    );
  }

  async sessionEnd(sessionId: string): Promise<void> {
    this.requireClock().advance(OPERATION_GAP_MS);
    resolveRequired<
      NotifyRegistry<{ sessionId: string; workspaceRoot: string }>
    >(
      this.input.container,
      SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY,
    ).notifyAll({ sessionId, workspaceRoot: this.workspaceRoot });
    await this.settleEnqueue(sessionId);
  }

  async idleTimeout(sessionId: string): Promise<void> {
    const clock = this.requireClock();
    clock.advance(OPERATION_GAP_MS);
    const activity = resolveRequired<
      NotifyRegistry<{
        sessionId: string;
        workspaceRoot: string;
        role: 'user' | 'assistant';
        timestamp: number;
      }>
    >(this.input.container, SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY);
    const timers = captureTimers(() =>
      activity.notifyAll({
        sessionId,
        workspaceRoot: this.workspaceRoot,
        role: 'assistant',
        timestamp: clock.now(),
      }),
    );
    const idleMs =
      this.graph.workspace.getConfiguration<number>(
        'ptah',
        IDLE_MS_KEY,
        IDLE_MS_DEFAULT,
      ) ?? IDLE_MS_DEFAULT;
    const idle = timers.filter(
      (timer) => !timer.cleared && timer.ms === idleMs,
    );
    if (idle.length !== 1) {
      throw new Error(
        `expected one idle timer of ${idleMs} ms for ${sessionId}, captured ${idle.length}`,
      );
    }
    clock.advance(idleMs);
    idle[0].fire();
    await this.settleEnqueue(sessionId);
  }

  async manualAnalyze(sessionId: string): Promise<ManualAnalyzeOutcome> {
    this.requireClock().advance(OPERATION_GAP_MS);
    if (!this.input.container.isRegistered(TOKENS.RPC_HANDLER, true)) {
      return 'unreachable';
    }
    const rpc = this.input.container.resolve<RpcHandlerLike>(
      TOKENS.RPC_HANDLER,
    );
    const response = await rpc.handleMessage({
      method: 'skillSynthesis:analyzeNow',
      params: { sessionId, workspaceRoot: this.workspaceRoot },
      correlationId: `bench-funnel-${sessionId}`,
    });
    if (response.success) return 'ran';
    const error = response.error ?? 'unknown RPC error';
    // Only an unregistered method means the operation cannot run here; any
    // other refusal ran and failed, and its cause is kept for the case.
    return /Method not found/.test(error) ? 'unreachable' : { rpcError: error };
  }

  async drainCycle(): Promise<FunnelDrainTick[]> {
    const clock = this.requireClock();
    const ticks: FunnelDrainTick[] = [];
    const placeholders = FREQUENT_STAGES.map(() => '?').join(', ');
    for (let tick = 0; tick < MAX_FREQUENT_TICKS; tick += 1) {
      clock.advance(FREQUENT_TICK_MS);
      const eligible = this.graph.count(
        `SELECT COUNT(*) AS n FROM skill_synthesis_queue
          WHERE status = 'queued' AND not_before <= ? AND stage IN (${placeholders})`,
        clock.now(),
        ...FREQUENT_STAGES,
      );
      if (eligible === 0) break;
      ticks.push(await this.graph.drain('frequent'));
    }
    clock.advance(FREQUENT_TICK_MS);
    ticks.push(await this.graph.drain('nightly'));
    clock.advance(FREQUENT_TICK_MS);
    ticks.push(await this.graph.drain('weekly'));
    return ticks;
  }

  snapshot(sessionIds: readonly string[]): FunnelSnapshot {
    const ids = new Set(sessionIds);
    const verdicts: FunnelVerdictView[] = [];
    for (const sessionId of sessionIds) {
      const verdict = this.graph.verdicts.findBySession(sessionId);
      if (verdict === null) continue;
      verdicts.push({
        sessionId,
        routinePresent: verdict.routine !== null,
        degraded: verdict.degradedReason !== null,
        createdAt: verdict.createdAt,
      });
    }
    const placeholders = sessionIds.map(() => '?').join(', ');
    return {
      feed: this.graph.feed(ids),
      candidates: this.graph.candidates((id) => ids.has(id)),
      verdicts,
      queue:
        sessionIds.length === 0
          ? []
          : this.graph.queueRows(
              `session_id IN (${placeholders})`,
              ...sessionIds,
            ),
      suggestions: z
        .array(suggestionRowSchema)
        .parse(
          this.graph.sqlite.db
            .prepare(
              'SELECT id, member_session_ids FROM skill_suggestions ORDER BY created_at, id',
            )
            .all(),
        )
        .map((row) => ({
          id: row.id,
          memberSessionIds: parseStringArray(row.member_session_ids),
        }))
        .filter((row) => row.memberSessionIds.some((id) => ids.has(id))),
    };
  }

  async restartFeed(sessionIds: readonly string[]): Promise<FunnelFeedEvent[]> {
    const child = childProductContainer(
      this.input.container,
      this.input.laneRunner,
    );
    const fresh = new ProductGraph(child);
    try {
      const synthesis = fresh.synthesis;
      await synthesis.start();
      try {
        return fresh.feed(new Set(sessionIds));
      } finally {
        synthesis.stop();
      }
    } finally {
      await disposeChild(child);
    }
  }

  laneStats(): FunnelLaneStats {
    return this.lane.stats();
  }

  async close(): Promise<void> {
    try {
      if (this.started) this.graph.stop();
    } finally {
      this.lane.restore();
    }
  }
}

// ------------------------------------------------------------------ 22.2

class HostLifecyclePort implements FunnelLifecyclePort {
  private readonly graph: ProductGraph;
  private readonly lane: ReturnType<typeof instrumentLaneRunner>;
  private started = false;
  private freshWorkspaces = 0;
  /** Child product containers this port built; disposed at `close`. */
  private readonly children: DependencyContainer[] = [];

  constructor(private readonly input: FunnelHostInput) {
    this.graph = new ProductGraph(input.container);
    this.lane = instrumentLaneRunner(input.laneRunner);
  }

  async begin(clock: FunnelClock): Promise<FunnelLifecycleSettings> {
    void clock;
    this.started = true;
    await this.graph.start();
    const settings = this.graph.synthesis.readSettings();
    const workspace = this.graph.workspace;
    return {
      dormantAfterDays: readRetirementDays(workspace, DORMANT_AFTER_DAYS_KEY),
      retireAfterDormantDays: readRetirementDays(
        workspace,
        RETIRE_AFTER_DORMANT_DAYS_KEY,
      ),
      successesToPromote: settings.successesToPromote,
      maxActiveSkills: settings.maxActiveSkills,
      scratchRoot: join(this.input.home, 'funnel-lifecycle'),
    };
  }

  seedCandidate(input: SeedSkillInput): string {
    return this.graph.seedCandidate(input);
  }

  seedPromoted(
    input: SeedSkillInput & { readonly promotedAt: number },
  ): string {
    return this.graph.seedPromoted(input);
  }

  candidate(id: string): FunnelCandidateView | null {
    return this.graph.candidate(id);
  }

  countDistinctContexts(id: string): number {
    return this.graph.store.countDistinctContexts(
      id as SkillCandidateRow['id'],
    );
  }

  invocationEvents(slug: string): number {
    return this.graph.count(
      'SELECT COUNT(*) AS n FROM skill_invocation_events WHERE skill_slug = ?',
      slug,
    );
  }

  async recordSkillUse(input: {
    readonly slug: string;
    readonly sessionId: string;
    readonly workspaceRoot: string;
    readonly at?: number;
  }): Promise<void> {
    const before = this.invocationEvents(input.slug);
    mkdirSync(input.workspaceRoot, { recursive: true });
    resolveRequired<NotifyRegistry<Record<string, unknown>>>(
      this.input.container,
      SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
    ).notifyAll({
      toolName: 'Skill',
      toolInput: { command: input.slug },
      toolOutput: null,
      exitCode: 0,
      success: true,
      sessionId: input.sessionId,
      workspaceRoot: input.workspaceRoot,
      timestamp: input.at ?? Date.now(),
    });
    try {
      await settle(
        () => this.invocationEvents(input.slug) > before,
        `skill use of ${input.slug}`,
      );
    } catch {
      // The trigger wrote nothing; the suite reads `invocationEvents` and
      // reports the count it found rather than failing the run here.
    }
  }

  drainTick(tier: DrainTier): Promise<FunnelDrainTick> {
    return this.graph.drain(tier);
  }

  residentCount(): number {
    return this.graph.count(
      "SELECT COUNT(*) AS n FROM skill_candidates WHERE status = 'promoted' AND residency = 'resident'",
    );
  }

  async promoteRace(input: {
    readonly ids: readonly [string, string];
    readonly cap: number;
    readonly schedule: FunnelRaceSchedule;
  }): Promise<FunnelRaceObservation> {
    const [first, second] = input.ids;
    const log: string[] = [];
    const names = new Map<string, string>();
    for (const id of input.ids) {
      const row = this.graph.store.findById(id as SkillCandidateRow['id']);
      if (row === null) throw new Error(`race candidate ${id} not found`);
      names.set(id, row.name);
    }
    const ownerOf = (prompt: string): string | null =>
      [...names.entries()].find(([, name]) => prompt.includes(name))?.[0] ??
      null;

    // The recorded lane runner behind a pause gate: one held call per owner.
    const waiting = new Map<string, () => void>();
    let active: string | null = null;
    const laneRunner = this.input.laneRunner;
    const gate: LaneRunnerDouble = {
      run: async (req) => {
        const owner = ownerOf(req.prompt);
        if (owner !== null) {
          log.push(`pause:${owner}`);
          await new Promise<void>((release) => waiting.set(owner, release));
        }
        return laneRunner.run(req);
      },
    };
    const raceChild = childProductContainer(this.input.container, gate);
    this.children.push(raceChild);
    const graph = new ProductGraph(raceChild);
    const store = graph.store;
    // Observation-only hooks on the child's store instance: log, call through.
    const read = store.listActiveOrderedByDecayScore.bind(store);
    const cas = store.promoteAtomically.bind(store);
    Object.defineProperty(store, 'listActiveOrderedByDecayScore', {
      configurable: true,
      value: (...args: Parameters<typeof read>) => {
        log.push(`read:${active ?? 'unknown'}`);
        return read(...args);
      },
    });
    Object.defineProperty(store, 'promoteAtomically', {
      configurable: true,
      value: (...args: Parameters<typeof cas>) => {
        log.push(`cas:${String(args[0])}`);
        return cas(...args);
      },
    });

    const settings = {
      ...graph.synthesis.readSettings(),
      maxActiveSkills: input.cap,
    };
    const settled = new Map<string, string>();
    const runs = input.ids.map((id) =>
      graph.promotion
        .promoteManually(id as SkillCandidateRow['id'], settings, {
          userInitiated: true,
        })
        .then(
          (decision) => settled.set(id, decision.reason),
          (error: unknown) =>
            settled.set(
              id,
              `threw: ${error instanceof Error ? error.message : String(error)}`,
            ),
        ),
    );
    // Release schedule. `a-then-b` / `b-then-a`: the first promotion passes
    // every pause before the second leaves its first; `alternating`: the two
    // take turns at each pause point.
    const order: readonly [string, string] =
      input.schedule === 'b-then-a' ? [second, first] : [first, second];
    let turn = 0;
    const pickNext = (): string | undefined => {
      if (input.schedule !== 'alternating') {
        return order.find((id) => waiting.has(id));
      }
      const preferred = order[turn % 2];
      return waiting.has(preferred) ? preferred : order[(turn + 1) % 2];
    };
    while (settled.size < input.ids.length) {
      await settle(
        () => input.ids.every((id) => settled.has(id) || waiting.has(id)),
        'race promotions reaching a pause point',
      );
      const pick = pickNext();
      const release = pick === undefined ? undefined : waiting.get(pick);
      if (pick === undefined || release === undefined) continue;
      turn += 1;
      waiting.delete(pick);
      active = pick;
      release();
      await yieldTurn();
    }
    await Promise.all(runs);
    return {
      decisions: Object.fromEntries(settled),
      residentAfter: this.residentCount(),
      log,
    };
  }

  async retire(input: {
    readonly now: number;
    readonly useAtCommit?: {
      readonly slug: string;
      readonly sessionId: string;
    };
  }): Promise<FunnelRetireObservation> {
    const store = this.graph.store;
    const use = input.useAtCommit;
    let restore: () => void = () => undefined;
    if (use !== undefined) {
      const target = store.findByName(use.slug);
      if (target === null)
        throw new Error(`retire target ${use.slug} not found`);
      const findById = store.findById.bind(store);
      const recorder = this.graph.recorder;
      let fired = false;
      // The pass reads the row again right before its destructive step
      // (`skill-retirement.service.ts:269-289`): a real use lands there.
      Object.defineProperty(store, 'findById', {
        configurable: true,
        value: (id: SkillCandidateRow['id']) => {
          if (!fired && id === target.id) {
            fired = true;
            recorder.recordSkillEvent({
              slug: use.slug,
              sessionId: use.sessionId,
              workspaceRoot: '',
              contextId: null,
              succeeded: true,
              invokedAt: Date.now(),
              source: 'tool-use',
            });
          }
          return findById(id);
        },
      });
      restore = () => {
        delete (store as { findById?: unknown }).findById;
      };
    }
    try {
      const result = await this.graph.retirement.run({}, input.now);
      return {
        retired: [...result.retiredSlugs],
        dormant: [...result.dormantSlugs],
        skippedReason: result.skippedReason ?? null,
      };
    } finally {
      restore();
    }
  }

  activeDirExists(slug: string): boolean {
    return existsSync(join(this.graph.md.activeRoot(), slug, 'SKILL.md'));
  }

  seedAcceptedSuggestion(input: {
    readonly slug: string;
    readonly body: string;
    readonly memberCandidateIds: readonly string[];
    readonly memberSessionIds: readonly string[];
  }): string {
    const description = descriptionOf(input.slug);
    const materialized = this.graph.md.promoteToActive({
      slug: input.slug,
      description,
      body: input.body,
    });
    const suggestions = this.graph.suggestions;
    const pending = suggestions.insert(
      {
        name: input.slug,
        description,
        body: input.body,
        memberSessionIds: [...input.memberSessionIds],
        memberCandidateIds: [...input.memberCandidateIds],
        clusterSize: Math.max(1, input.memberCandidateIds.length),
        technologyFingerprint: 'general',
        judgeScore: 8,
      },
      'pending',
    );
    // Accepted the way the pre-578 curator accepted: no promoted candidate.
    suggestions.accept(pending.id, null);
    this.graph.upsertSynth(materialized.slug, materialized.filePath, null);
    return pending.id;
  }

  suggestionLinked(id: string): boolean {
    return this.graph.suggestions.findById(id)?.promotedCandidateId != null;
  }

  async bootReconcile(suggestionId: string): Promise<'linked' | 'not-linked'> {
    const curator = this.graph.curator;
    // The reconcile is data repair and runs with the curator disabled
    // (`skill-curator.service.ts:224-229`); no interval is scheduled.
    curator.start({
      ...this.graph.synthesis.readSettings(),
      curatorEnabled: false,
    });
    try {
      await settle(
        () => this.suggestionLinked(suggestionId),
        `reconcile of ${suggestionId}`,
      );
      // The merged members' directories are removed after the link commits.
      for (let turn = 0; turn < 200; turn += 1) await yieldTurn();
      return 'linked';
    } catch {
      return 'not-linked';
    } finally {
      curator.stop();
    }
  }

  reconcileWait(): Promise<'settled'> {
    // Never resolved (resuming would run a real-time curator pass on the
    // shared DB); unreferenced once `close` disposes the child.
    const never = { repropagate: () => new Promise<void>(() => undefined) };
    const waitChild = childProductContainer(
      this.input.container,
      this.input.laneRunner,
      (child) => {
        child.register(SKILL_REPROPAGATION_TOKEN, { useValue: never });
      },
    );
    this.children.push(waitChild);
    const graph = new ProductGraph(waitChild);
    const curator = graph.curator;
    curator.start({ ...graph.synthesis.readSettings(), curatorEnabled: false });
    // A pass waits on the in-flight reconcile (`skill-curator.service.ts:272`).
    return curator.runManual().then(() => 'settled' as const);
  }

  async delivery(candidateId: string): Promise<FunnelDeliveryObservation> {
    // Cap lifted above the residents earlier suites left (review finding 6).
    const residentAtEntry = this.residentCount();
    const settings = this.graph.synthesis.readSettings();
    const decision = await this.graph.promotion.promoteManually(
      candidateId as SkillCandidateRow['id'],
      {
        ...settings,
        maxActiveSkills: Math.max(
          settings.maxActiveSkills,
          residentAtEntry + 1,
        ),
      },
      { userInitiated: true },
    );
    const slug = decision.promoted ? (decision.candidate?.name ?? null) : null;
    const harness = this.input.container.isRegistered(
      HARNESS_PROPAGATION_TOKEN,
      true,
    )
      ? this.input.container.resolve<HarnessPropagationLike>(
          HARNESS_PROPAGATION_TOKEN,
        )
      : null;
    if (slug === null || harness === null) {
      return {
        promoted: decision.promoted,
        reason: decision.reason,
        slug,
        residentAtEntry,
        hostWorkspaceHasSkill: null,
        freshWorkspaceHasSkill: null,
      };
    }
    const delivered = (root: string): boolean =>
      existsSync(join(root, '.claude', 'skills', slug, 'SKILL.md'));
    const hostRoot = this.graph.workspace.getWorkspaceRoot() ?? '';
    this.freshWorkspaces += 1;
    const fresh = join(
      this.input.home,
      `funnel-fresh-workspace-${this.freshWorkspaces}`,
    );
    mkdirSync(fresh, { recursive: true });
    await harness.propagate(fresh, 'bench-funnel-delivery');
    return {
      promoted: true,
      reason: decision.reason,
      slug,
      residentAtEntry,
      hostWorkspaceHasSkill: hostRoot === '' ? null : delivered(hostRoot),
      freshWorkspaceHasSkill: delivered(fresh),
    };
  }

  laneStats(): FunnelLaneStats {
    return this.lane.stats();
  }

  async close(): Promise<void> {
    try {
      if (this.started) this.graph.stop();
    } finally {
      try {
        for (const child of this.children.splice(0)) await disposeChild(child);
      } finally {
        this.lane.restore();
      }
    }
  }
}

export type { FunnelHostInput } from './funnel-host-graph';

/** The funnel ports over one container. */
export function funnelPortsOver(input: FunnelHostInput): FunnelPorts {
  return {
    run: () => new HostRunPort(input),
    lifecycle: () => new HostLifecyclePort(input),
    backlog: () => new HostBacklogPort(input),
  };
}

/** The ports over the booted bench host (the host entry passes this as `portsOf`). */
export function hostFunnelPorts(context: {
  readonly container: DependencyContainer;
  readonly isolation: { readonly home: string };
  readonly doubles: { readonly laneRunner: LaneRunnerDouble };
}): FunnelPorts {
  return funnelPortsOver({
    container: context.container,
    home: context.isolation.home,
    laneRunner: context.doubles.laneRunner,
  });
}
