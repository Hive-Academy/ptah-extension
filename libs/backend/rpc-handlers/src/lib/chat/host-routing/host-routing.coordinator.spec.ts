/**
 * HostRoutingCoordinator — scope state machine, one pre-flight per revision,
 * one nudge per revision, and the Gate 2 carry-forward (TASK_2026_857,
 * Component 16, Batch 18).
 *
 * Drives the real coordinator with a fake scope check and route service, a
 * real `PreflightReuseCache` on a real `HostRoutingSetting`, and a real
 * `NextTurnReminderQueue`. The turn-ended bus and the session-id registry are
 * small fakes with the same subscribe shape.
 */
import 'reflect-metadata';

// The real lm-tools barrel loads ESM-only workspace-intelligence modules that
// Jest cannot require. This mirrors `buildRouteCandidateSource` for an agent
// without a limit lookup.
jest.mock('@ptah-extension/vscode-lm-tools', () => ({
  buildRouteCandidateSource: (agent: {
    list(): Promise<unknown>;
    listRoles(): Promise<unknown>;
  }) => ({
    rows: () => agent.list(),
    limits: async () => null,
    roles: () => agent.listRoles(),
  }),
}));

import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  DecisionModelConfig,
  HostRoutingSetting,
  PreflightResultSchema,
  PreflightReuseCache,
  type LaneRoutingLogger,
  type PreflightResult,
  type RouteCandidateSource,
  type RouteDecideResult,
  type ScopeAssessment,
  type ScopeConversation,
} from '@ptah-extension/lane-routing';
import {
  NextTurnReminderQueue,
  type SdkAdapterTurnEndedEvent,
  type SessionIdResolvedPayload,
} from '@ptah-extension/agent-sdk';
import type { CliDetectionResult } from '@ptah-extension/shared';

import { HostRoutingCoordinator } from './host-routing.coordinator';
import { ROUTING_NUDGE_TEXT } from './routing-reminder.format';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TAB = 'tab-1';
const SDK = 'sdk-1';
const SETTING_KEY = 'ptah.agentOrchestration.hostRouting';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

type YesNo = 'yes' | 'no';
interface AnswerSpec {
  readonly e: YesNo | null;
  readonly s?: YesNo | null;
  readonly r?: 'new-task' | 'continuation' | null;
  readonly m?: YesNo | null;
}

function answered(spec: AnswerSpec): ScopeAssessment {
  const wrap = <T extends string>(value: T | null | undefined) =>
    value === null || value === undefined ? null : { value, confidence: 0.9 };
  return {
    kind: 'answered',
    engineering: wrap(spec.e),
    settled: wrap(spec.s),
    relation: wrap(spec.r),
    materialChange: wrap(spec.m),
    usage: { requests: 1, inputTokens: 5, outputTokens: 1, costUsd: null },
  };
}

function preflight(
  taskType: 'FEATURE' | 'BUGFIX' = 'FEATURE',
): PreflightResult {
  return PreflightResultSchema.parse({
    stage: 'pre-flight',
    taskType: {
      value: taskType,
      source: 'model',
      confidence: 0.9,
      fallbackCause: null,
      modelProposal: null,
    },
    depth: {
      value: 'Full',
      source: 'model',
      confidence: 0.8,
      fallbackCause: null,
      modelProposal: null,
    },
    overallConfidence: 0.8,
    reasons: [],
    usage: { requests: 1, inputTokens: 10, outputTokens: 2, costUsd: null },
  });
}

function row(
  cli: CliDetectionResult['cli'],
  extra: Partial<
    Pick<CliDetectionResult, 'installed' | 'disabled' | 'preferredRank'>
  > = {},
): CliDetectionResult {
  return { cli, installed: true, messagingMode: 'none', ...extra };
}

class FakeSessionIdRegistry {
  private readonly callbacks = new Set<
    (payload: SessionIdResolvedPayload) => void | Promise<void>
  >();

  register(
    callback: (payload: SessionIdResolvedPayload) => void | Promise<void>,
  ): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  fire(payload: SessionIdResolvedPayload): void {
    for (const callback of this.callbacks) void callback(payload);
  }

  get size(): number {
    return this.callbacks.size;
  }
}

class FakeTurnEvents {
  private readonly listeners = new Set<
    (event: SdkAdapterTurnEndedEvent) => void
  >();

  onTurnEnded(listener: (event: SdkAdapterTurnEndedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(sessionId: string, lastAssistantMessage: string | null): void {
    for (const listener of this.listeners) {
      listener({
        sessionId,
        cwd: '/ws',
        lastAssistantMessage,
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: null,
        timestamp: 1,
      });
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

function harness(options: { readonly model?: boolean } = {}) {
  const workspace = createMockWorkspaceProvider({
    config:
      options.model === false
        ? {}
        : {
            'ptah.agentOrchestration.decisionModel': {
              kind: 'ollama',
              model: 'nimble',
            },
          },
  });
  const laneLogger: LaneRoutingLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config = new DecisionModelConfig(
    workspace,
    createMockSecretStorage(),
    createMockStateStorage(),
    laneLogger,
  );
  const setting = new HostRoutingSetting(workspace, config);
  const cache = new PreflightReuseCache(setting);
  const registry = new FakeSessionIdRegistry();
  const queue = new NextTurnReminderQueue(registry);
  const events = new FakeTurnEvents();
  const logger = { warn: jest.fn(), debug: jest.fn() };

  const assessQueue: Array<Promise<ScopeAssessment>> = [];
  const assess = jest.fn(
    (_conversation: ScopeConversation): Promise<ScopeAssessment> =>
      assessQueue.shift() ??
      Promise.resolve<ScopeAssessment>({
        kind: 'unavailable',
        usage: {
          requests: 0,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
        },
      }),
  );
  const decideQueue: Array<Promise<RouteDecideResult>> = [];
  const decide = jest.fn(
    (
      _args: unknown,
      _source: RouteCandidateSource,
    ): Promise<RouteDecideResult> =>
      decideQueue.shift() ?? Promise.resolve(preflight()),
  );
  const agent = {
    list: jest.fn(async (): Promise<CliDetectionResult[]> => [
      row('grok', { preferredRank: 2 }),
      row('codex', { preferredRank: 1 }),
      row('copilot', { disabled: true }),
      row('cursor', { installed: false }),
    ]),
    listRoles: jest.fn(async (): Promise<string[]> => [
      'backend-developer',
      'workspace-only-role',
      'senior-tester',
    ]),
  };

  const coordinator = new HostRoutingCoordinator(
    logger,
    setting,
    { assess },
    { decide },
    config,
    queue,
    { build: () => ({ agent }) },
    cache,
    events,
    registry,
  );
  const fingerprint = JSON.stringify(config.getSelection());

  return {
    coordinator,
    cache,
    queue,
    events,
    registry,
    logger,
    assess,
    decide,
    agent,
    fingerprint,
    /** Queue the next scope answer; returns a handle when deferred. */
    nextAnswer(spec: AnswerSpec): void {
      assessQueue.push(Promise.resolve(answered(spec)));
    },
    deferAnswer(): Deferred<ScopeAssessment> {
      const d = deferred<ScopeAssessment>();
      assessQueue.push(d.promise);
      return d;
    },
    deferDecide(): Deferred<RouteDecideResult> {
      const d = deferred<RouteDecideResult>();
      decideQueue.push(d.promise);
      return d;
    },
    failDecide(error: Error): void {
      const rejected = Promise.reject(error);
      // Mark handled now; the coordinator still observes the rejection.
      rejected.catch(() => undefined);
      decideQueue.push(rejected);
    },
    setEnabled(on: boolean): void {
      workspace.__state.config.set(SETTING_KEY, on);
    },
    /** A settings write: the value changes and the change event fires. */
    toggle(on: boolean): void {
      workspace.__state.config.set(SETTING_KEY, on);
      workspace.__state.fireConfigurationChange(SETTING_KEY);
    },
    turn(prompt: string, sessionId: string | null = SDK): void {
      coordinator.admitUserTurn({ tabId: TAB, sessionId, prompt });
    },
    hit(): PreflightResult | null {
      return cache.get(TAB, fingerprint);
    },
  };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('HostRoutingCoordinator', () => {
  describe('enablement', () => {
    it('makes zero scope and pre-flight calls when the setting is off, and clears the cache', async () => {
      const h = harness();
      h.cache.confirmRevision(TAB, 1);
      h.cache.put(TAB, {
        revision: 1,
        modelFingerprint: h.fingerprint,
        result: preflight(),
      });
      h.setEnabled(false);
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the uploader');
      await flush();
      expect(h.assess).not.toHaveBeenCalled();
      expect(h.decide).not.toHaveBeenCalled();
      h.setEnabled(true);
      expect(h.hit()).toBeNull();
    });

    it('makes zero decision-model calls when no decision model is configured', async () => {
      const h = harness({ model: false });
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the uploader');
      h.turn('yes, go ahead');
      await flush();
      expect(h.assess).not.toHaveBeenCalled();
      expect(h.decide).not.toHaveBeenCalled();
    });

    it('skips blank prompts and slash commands', async () => {
      const h = harness();
      h.turn('   ');
      h.turn('/compact');
      await flush();
      expect(h.assess).not.toHaveBeenCalled();
    });
  });

  describe('scope state machine', () => {
    it('nudges once per revision and never on unchanged or unknown turns (F2)', async () => {
      const h = harness();
      h.nextAnswer({ e: 'yes', s: 'no' });
      h.turn('make the uploader better');
      await flush();
      expect(h.queue.take(SDK)).toBe(ROUTING_NUDGE_TEXT);

      for (const prompt of ['maybe faster?', 'not sure yet']) {
        h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'no' });
        h.turn(prompt);
        await flush();
        expect(h.queue.take(SDK)).toBeNull();
      }

      h.nextAnswer({ e: 'yes', r: null, m: 'no', s: 'no' });
      h.turn('hmm');
      await flush();
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.decide).not.toHaveBeenCalled();
      // Revision stayed 1: a later settled continuation routes revision 1.
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('ok, agreed');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      expect(h.hit()).not.toBeNull();
    });

    it('routes a settled new task once: one pre-flight, one reminder, a confirmed cache hit', async () => {
      const h = harness();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader, 3 attempts');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      const [args] = h.decide.mock.calls[0];
      expect(args).toEqual({
        stage: 'pre-flight',
        request: expect.stringContaining('add retries to the downloader'),
      });
      const reminder = h.queue.take(SDK);
      expect(reminder).toContain('Routing: pre-flight taskType=FEATURE');
      expect(reminder).toContain('Available lanes: codex, grok.');
      expect(reminder).toContain(
        'Available subagents: backend-developer, senior-tester.',
      );
      expect(reminder).not.toContain('copilot');
      expect(reminder).not.toContain('workspace-only-role');
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.hit()).not.toBeNull();
    });

    it('does nothing for a non-engineering turn or an unchanged continuation of a routed revision', async () => {
      const h = harness();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      h.queue.take(SDK);

      h.nextAnswer({ e: 'no' });
      h.turn('what time is it?');
      await flush();
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('also log each retry');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.hit()).not.toBeNull();
    });

    it('a material change bumps the revision, drops the old entry and runs a new pre-flight', async () => {
      const h = harness();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      h.queue.take(SDK);

      const second = h.deferDecide();
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'yes', s: 'yes' });
      h.turn('actually rewrite the whole download pipeline');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(2);
      expect(h.hit()).toBeNull();
      second.resolve(preflight('BUGFIX'));
      await flush();
      expect(h.queue.take(SDK)).toContain('taskType=BUGFIX');
      expect(h.hit()?.taskType.value).toBe('BUGFIX');
    });

    it('treats an unknown relation after a routed revision as unknown continuity (F6)', async () => {
      const h = harness();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      expect(h.hit()).not.toBeNull();
      h.nextAnswer({ e: 'yes', r: null, m: null, s: 'yes' });
      h.turn('and then?');
      await flush();
      expect(h.hit()).toBeNull();
      expect(h.decide).toHaveBeenCalledTimes(1);
    });

    it('fails open on an unavailable scope answer without logging any text', async () => {
      const h = harness();
      h.turn('secret prompt text about the uploader');
      await flush();
      expect(h.decide).not.toHaveBeenCalled();
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.logger.warn).toHaveBeenCalledWith('Host routing step failed', {
        tabId: TAB,
        stage: 'scope',
        code: 'unavailable',
      });
      expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain('secret');
    });
  });

  describe('pre-flight (F3)', () => {
    it('reuses an in-flight pre-flight for the same revision and posts one reminder to the newest key', async () => {
      const h = harness();
      const d = h.deferDecide();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader', null);
      await flush();
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('yes, go ahead', SDK);
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      d.resolve(preflight());
      await flush();
      expect(h.queue.take(SDK)).toContain('Routing: pre-flight');
      expect(h.queue.take(TAB)).toBeNull();
    });

    it('discards a pre-flight overtaken by a material change and posts only the new one', async () => {
      const h = harness();
      const first = h.deferDecide();
      const second = h.deferDecide();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      h.nextAnswer({ e: 'yes', r: 'new-task', m: 'yes', s: 'yes' });
      h.turn('no, build a new upload queue instead');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(2);
      first.resolve(preflight('BUGFIX'));
      await flush();
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.hit()).toBeNull();
      second.resolve(preflight('FEATURE'));
      await flush();
      expect(h.queue.take(SDK)).toContain('taskType=FEATURE');
      expect(h.hit()?.taskType.value).toBe('FEATURE');
    });

    it('a failed pre-flight queues nothing and is not retried for the same revision', async () => {
      const h = harness();
      h.failDecide(new TypeError('boom'));
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.logger.warn).toHaveBeenCalledWith('Host routing step failed', {
        tabId: TAB,
        stage: 'pre-flight',
        code: 'TypeError',
      });
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('yes');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      expect(h.queue.take(SDK)).toBeNull();
    });

    it('omits the candidate lists when the listing fails', async () => {
      const h = harness();
      h.agent.list.mockRejectedValueOnce(new Error('detect failed'));
      h.agent.listRoles.mockRejectedValueOnce(new Error('roles failed'));
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      const reminder = h.queue.take(SDK);
      expect(reminder).toContain('Routing: pre-flight');
      expect(reminder).not.toContain('Available lanes');
      expect(reminder).not.toContain('Available subagents');
    });
  });

  describe('reverse-order scope answers (r3 N2)', () => {
    const TURN_1 = 'refactor the uploader';
    const TURN_2 = 'add retries to the downloader, 3 attempts';

    it('applies only the newest answer when the older one settles last', async () => {
      const h = harness();
      const a1 = h.deferAnswer();
      const a2 = h.deferAnswer();
      h.turn(TURN_1);
      h.turn(TURN_2);
      a2.resolve(answered({ e: 'yes', s: 'yes' }));
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      const [args] = h.decide.mock.calls[0];
      expect(JSON.stringify(args)).toContain(TURN_2);

      a1.resolve(answered({ e: 'yes', r: 'new-task', m: 'yes', s: 'yes' }));
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      expect(h.hit()).not.toBeNull();
      expect(h.queue.take(SDK)).toContain('Routing: pre-flight');
      expect(h.queue.take(SDK)).toBeNull();

      // pendingScope and previousUserTurn are still turn 2's text.
      h.nextAnswer({ e: 'no' });
      h.turn('thanks');
      await flush();
      const [snapshot] = h.assess.mock.calls[2];
      expect(snapshot.pendingScope).toBe(TURN_2);
      expect(snapshot.previousUserTurn).toBe(TURN_2);
    });

    it('a stale unsettled answer queues no nudge', async () => {
      const h = harness();
      const a1 = h.deferAnswer();
      const a2 = h.deferAnswer();
      h.turn(TURN_1);
      h.turn(TURN_2);
      a2.resolve(answered({ e: 'yes', s: 'yes' }));
      await flush();
      h.queue.take(SDK);
      a1.resolve(answered({ e: 'yes', s: 'no' }));
      await flush();
      expect(h.queue.take(SDK)).toBeNull();
    });

    it('in order but overlapping: the older answer is discarded while the newer one is pending', async () => {
      const h = harness();
      const a1 = h.deferAnswer();
      const a2 = h.deferAnswer();
      h.turn(TURN_1);
      h.turn(TURN_2);
      a1.resolve(answered({ e: 'yes', s: 'no' }));
      await flush();
      expect(h.hit()).toBeNull();
      expect(h.decide).not.toHaveBeenCalled();
      expect(h.queue.take(SDK)).toBeNull();
      a2.resolve(answered({ e: 'yes', s: 'yes' }));
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      expect(h.queue.take(SDK)).toContain('Routing: pre-flight');
    });
  });

  describe('Disable reset (r3 N3)', () => {
    it('toggle off while a pre-flight is in flight: no reminder, nudge discarded, re-enable routes anew', async () => {
      const h = harness();
      h.nextAnswer({ e: 'yes', s: 'no' });
      h.turn('make the uploader better');
      await flush();
      const d1 = h.deferDecide();
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('ok: retries, 3 attempts');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      // The earlier nudge is still queued so its discard is visible.
      h.setEnabled(false);
      d1.resolve(preflight());
      await flush();
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.hit()).toBeNull();
      h.setEnabled(true);
      expect(h.hit()).toBeNull();

      const a2 = h.deferAnswer();
      h.turn('still the same plan');
      await flush();
      expect(h.hit()).toBeNull();
      a2.resolve(answered({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' }));
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(2);
      expect(h.queue.take(SDK)).toContain('Routing: pre-flight');
      expect(h.queue.take(SDK)).toBeNull();
    });

    it('toggle off while a scope answer is pending: discarded with zero pre-flight and no nudge', async () => {
      const h = harness();
      const a1 = h.deferAnswer();
      h.turn('add retries to the downloader');
      h.setEnabled(false);
      a1.resolve(answered({ e: 'yes', s: 'yes' }));
      await flush();
      expect(h.decide).not.toHaveBeenCalled();
      expect(h.queue.take(SDK)).toBeNull();

      const a2 = h.deferAnswer();
      h.setEnabled(true);
      h.turn('make it better');
      h.setEnabled(false);
      a2.resolve(answered({ e: 'yes', s: 'no' }));
      await flush();
      expect(h.queue.take(SDK)).toBeNull();
    });
  });

  describe('Gate 2 carry-forward: cancellation epoch and inFlight identity', () => {
    it('off then on before an old assessment settles: the old answer changes nothing', async () => {
      const h = harness();
      const old = h.deferAnswer();
      h.turn('add retries to the downloader');
      // Disable reset at a disabled admission (no generation bump), then on.
      h.setEnabled(false);
      h.turn('never mind');
      h.setEnabled(true);
      old.resolve(answered({ e: 'yes', s: 'yes' }));
      await flush();
      expect(h.decide).not.toHaveBeenCalled();
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.hit()).toBeNull();

      // Only the new request is active afterwards.
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      expect(h.queue.take(SDK)).toContain('Routing: pre-flight');
    });

    it('off then on before an old pre-flight settles, with a new same-revision pre-flight', async () => {
      const h = harness();
      const oldDecide = h.deferDecide();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);

      h.setEnabled(false);
      h.turn('pause that');
      h.setEnabled(true);

      const newDecide = h.deferDecide();
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('resume, same plan');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(2);

      // The old result settles under the setting that is on again.
      oldDecide.resolve(preflight('BUGFIX'));
      await flush();
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.hit()).toBeNull();

      // The new request is still the active one (identity guard): another
      // settled turn reuses it instead of starting a third call.
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('yes');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(2);

      newDecide.resolve(preflight('FEATURE'));
      await flush();
      const reminder = h.queue.take(SDK);
      expect(reminder).toContain('taskType=FEATURE');
      expect(reminder).not.toContain('BUGFIX');
      expect(h.hit()?.taskType.value).toBe('FEATURE');
    });

    it('an old pre-flight failure after off→on does not clear the new in-flight request', async () => {
      const h = harness();
      const oldDecide = h.deferDecide();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      h.setEnabled(false);
      h.turn('pause');
      h.setEnabled(true);
      const newDecide = h.deferDecide();
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('resume');
      await flush();
      oldDecide.reject(new Error('late failure'));
      await flush();
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('go');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(2);
      newDecide.resolve(preflight());
      await flush();
      expect(h.queue.take(SDK)).toContain('Routing: pre-flight');
    });
  });

  describe('setting transitions with no admitted turn (review fix F1/F2)', () => {
    it('off then on before an old assessment settles: no reminder, no cache entry', async () => {
      const h = harness();
      const old = h.deferAnswer();
      h.turn('add retries to the downloader');
      h.toggle(false);
      h.toggle(true);
      old.resolve(answered({ e: 'yes', s: 'yes' }));
      await flush();
      expect(h.decide).not.toHaveBeenCalled();
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.hit()).toBeNull();
    });

    it('off then on before an old pre-flight settles: no reminder, no cache entry', async () => {
      const h = harness();
      const oldDecide = h.deferDecide();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(1);
      h.toggle(false);
      h.toggle(true);
      oldDecide.resolve(preflight());
      await flush();
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.hit()).toBeNull();

      // The revision is free again: the next settled turn routes anew.
      h.nextAnswer({ e: 'yes', r: 'continuation', m: 'no', s: 'yes' });
      h.turn('same plan');
      await flush();
      expect(h.decide).toHaveBeenCalledTimes(2);
      expect(h.queue.take(SDK)).toContain('Routing: pre-flight');
    });

    it('a write that keeps the switch on still cancels work started before it', async () => {
      const h = harness();
      const old = h.deferAnswer();
      h.turn('add retries to the downloader');
      // off and on landed before the listener ran; it reads "on".
      h.toggle(true);
      old.resolve(answered({ e: 'yes', s: 'yes' }));
      await flush();
      expect(h.decide).not.toHaveBeenCalled();
      expect(h.queue.take(SDK)).toBeNull();
    });

    it('turning routing off drops a queued reminder before the next hook drain', async () => {
      const h = harness();
      h.nextAnswer({ e: 'yes', s: 'yes' });
      h.turn('add retries to the downloader');
      await flush();
      h.queue.put('other-session', 'unrelated context', 'other-producer');
      h.toggle(false);
      // `take` is what the UserPromptSubmit hook drains.
      expect(h.queue.take(SDK)).toBeNull();
      expect(h.hit()).toBeNull();
      expect(h.queue.take('other-session')).toBe('unrelated context');
    });

    it('turning routing off drops a queued nudge too', async () => {
      const h = harness();
      h.nextAnswer({ e: 'yes', s: 'no' });
      h.turn('make the uploader better');
      await flush();
      h.toggle(false);
      expect(h.queue.take(SDK)).toBeNull();
    });
  });

  describe('conversation window and lifecycle', () => {
    it('stores the assistant reply for a start-turn tab once its session id resolves', async () => {
      const h = harness();
      h.nextAnswer({ e: 'yes', s: 'no' });
      h.turn('add retries to the uploader', null);
      await flush();
      h.registry.fire({ tabId: TAB, realSessionId: SDK, timestamp: 1 });
      h.events.emit(SDK, 'Retry only network errors?');
      h.nextAnswer({ e: 'no' });
      h.turn('yes');
      await flush();
      const [snapshot] = h.assess.mock.calls[1];
      expect(snapshot.lastAssistantReply).toBe('Retry only network errors?');
    });

    it('dispose releases its subscriptions', () => {
      const h = harness();
      const discardOwned = jest.spyOn(h.queue, 'discardOwned');
      expect(h.events.size).toBe(1);
      expect(h.registry.size).toBe(2); // the queue's and the coordinator's
      h.coordinator.dispose();
      expect(h.events.size).toBe(0);
      expect(h.registry.size).toBe(1);
      // The setting listener is released too.
      h.toggle(false);
      expect(discardOwned).not.toHaveBeenCalled();
    });
  });
});
