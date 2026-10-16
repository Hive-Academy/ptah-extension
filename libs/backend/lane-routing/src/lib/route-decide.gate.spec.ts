import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type {
  CliDetectionResult,
  CliType,
  LaneLimitState,
} from '@ptah-extension/shared';

import { GateResultSchema } from './contracts/route-decide-result.schema';
import type { DecisionPayload } from './decision-model/decision-payload';
import { DecisionModelConfig } from './decision-model/decision-model.config';
import {
  SYSTEM_ONE_CONTROL_PATH,
  type DecisionModelStatusDto,
} from './decision-model/decision-model.types';
import type { StructuredDecisionCompleter } from './decision-model/structured-decision.port';
import {
  SYSTEM_ONE_PATH,
  type SystemOneCallResult,
  type SystemOneClientOptions,
  type SystemOneFetch,
} from './decision-model/system-one.client';
import type { LaneModelListing } from './lane-model-listing.port';
import type { LaneRoutingLogger } from './lane-routing-logger';
import { FAMILY_PROFILE_MODEL } from './matrix/matrix.types';
import type { RouteMatrix } from './pipeline/gather';
import { systemOneClientOptions } from './pipeline/model-refine';
import {
  emptyRotationState,
  type RotationState,
} from './ranking/rotation.store';
import type { RouteCandidateSource } from './route-candidate-source.port';
import {
  RouteDecideService,
  type RouteDecideSeams,
} from './route-decide.service';
import {
  DECISION_REQUEST_TIMEOUT_MS,
  QUESTIONS_PER_REQUEST,
} from './routing-constants';

const SELECTION_KEY = 'ptah.agentOrchestration.decisionModel';
const OLLAMA = { kind: 'ollama', model: 'nimble' } as const;
const LIVE_DETAIL = 'model "nimble" not found';
const VERSION_PATH = '/api/version';
const GO_NOT_FOUND = { status: 404, body: '404 page not found' };
const VERSION_OK = { status: 200, body: '{"version":"0.40.0"}' };
const MODEL_REQUIRED = { status: 400, body: '{"error":"model is required"}' };

interface FakeRoute {
  readonly status: number;
  readonly body: string;
}

function testLogger(): LaneRoutingLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function lane(cli: CliType): CliDetectionResult {
  return { cli, installed: true, messagingMode: 'none' };
}

const THREE = [lane('codex'), lane('grok'), lane('opencode')] as const;

function neutralMatrix(): RouteMatrix {
  return {
    load: async () => ({
      reasons: [],
      resolve: (family, model, taskKind) => ({
        family,
        model,
        profileModel: FAMILY_PROFILE_MODEL,
        taskKind,
        cell: { kind: 'unknown' },
        score: 50,
        noProfile: true,
      }),
    }),
  };
}

function memoryRotation(): {
  load(): { state: RotationState; reason: null };
  save(state: RotationState): Promise<{ persisted: boolean }>;
} {
  let state = emptyRotationState();
  return {
    load: () => ({ state, reason: null }),
    save: async (next) => {
      state = next;
      return { persisted: true };
    },
  };
}

function candidateSource(
  rows:
    | readonly CliDetectionResult[]
    | (() => Promise<readonly CliDetectionResult[]>),
  limits?: ReadonlyMap<string, LaneLimitState> | null,
): RouteCandidateSource {
  return {
    rows: typeof rows === 'function' ? rows : async () => rows,
    limits: async () => (limits === undefined ? new Map() : limits),
    roles: async () => [],
  };
}

function listingOf(list: LaneModelListing['list']): LaneModelListing {
  return { list };
}

function fakeFetch(routes: Record<string, FakeRoute>): SystemOneFetch {
  return async (url) => {
    const path = new URL(url).pathname;
    const route = routes[path] ?? GO_NOT_FOUND;
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      text: async () => route.body,
    };
  };
}

function configFor(
  selection: unknown,
  fetchImpl: SystemOneFetch,
  structured?: StructuredDecisionCompleter,
): DecisionModelConfig {
  return new DecisionModelConfig(
    createMockWorkspaceProvider({
      config: selection === undefined ? {} : { [SELECTION_KEY]: selection },
    }),
    createMockSecretStorage(),
    createMockStateStorage(),
    testLogger(),
    structured,
    { fetch: fetchImpl, now: () => 1_000 },
  );
}

function answersFor(
  payload: DecisionPayload,
  choice: (
    key: string,
    index: number,
  ) => { readonly choice: string; readonly confidence?: number },
): SystemOneCallResult {
  const answers: Record<
    string,
    {
      type: 'choice';
      choice: string;
      confidence?: number;
      probabilities?: Record<string, number>;
    }
  > = {};
  Object.keys(payload.questions).forEach((key, index) => {
    const picked = choice(key, index);
    answers[key] = {
      type: 'choice',
      choice: picked.choice,
      ...(picked.confidence !== undefined
        ? { confidence: picked.confidence }
        : {}),
    };
  });
  return {
    ok: true,
    result: {
      model: 'nimble',
      answers,
      usage: { input_tokens: 10, output_tokens: 4 },
    },
  };
}

function harness(options: {
  readonly selection?: unknown;
  readonly rows?: readonly CliDetectionResult[];
  readonly limits?: ReadonlyMap<string, LaneLimitState> | null;
  readonly listing?: LaneModelListing;
  readonly structured?: StructuredDecisionCompleter;
  readonly fetchImpl?: SystemOneFetch;
  readonly seams?: RouteDecideSeams;
  readonly reply?: (
    payload: DecisionPayload,
    index: number,
  ) => SystemOneCallResult;
  readonly rotation?: ReturnType<typeof memoryRotation>;
}) {
  const calls: DecisionPayload[] = [];
  const seen: SystemOneClientOptions[] = [];
  const rotation = options.rotation ?? memoryRotation();
  const rows = jest.fn(async () => options.rows ?? [...THREE]);
  const source: RouteCandidateSource = {
    rows,
    limits: async () =>
      options.limits === undefined ? new Map() : options.limits,
    roles: async () => [],
  };
  const service = new RouteDecideService({
    config: configFor(
      options.selection === undefined ? OLLAMA : options.selection,
      options.fetchImpl ??
        (async (url) => {
          throw new Error(`unexpected probe ${url}`);
        }),
      options.structured,
    ),
    matrix: neutralMatrix(),
    rotation,
    logger: testLogger(),
    listing:
      options.listing ??
      listingOf(async () => [{ id: 'listed', provenance: 'reported' }]),
    ...(options.structured !== undefined
      ? { structured: options.structured }
      : {}),
    seams: {
      listingBudgetMs: options.seams?.listingBudgetMs,
      maxRequestBytes: options.seams?.maxRequestBytes,
      now: options.seams?.now,
      systemOne: (clientOptions) => {
        seen.push(clientOptions);
        if (options.seams?.systemOne !== undefined)
          return options.seams.systemOne(clientOptions);
        return {
          decide: async (payload) => {
            const index = calls.length;
            calls.push(payload);
            return (
              options.reply?.(payload, index) ??
              answersFor(payload, () => ({ choice: 'o1', confidence: 0.9 }))
            );
          },
        };
      },
    },
  });
  return { service, source, calls, seen, rows, rotation };
}

function implement(id = 'build') {
  return {
    stage: 'gate-0.1' as const,
    request: 'ship the change',
    taskType: 'FEATURE' as const,
    depth: 'Full' as const,
    phases: [{ id, kind: 'implement' as const }],
  };
}

const READY_ROUTES: Record<string, FakeRoute> = {
  [VERSION_PATH]: VERSION_OK,
  [SYSTEM_ONE_PATH]: MODEL_REQUIRED,
  [SYSTEM_ONE_CONTROL_PATH]: GO_NOT_FOUND,
};

const UNSUPPORTED_ROUTES: Record<string, FakeRoute> = {
  [VERSION_PATH]: VERSION_OK,
  [SYSTEM_ONE_PATH]: GO_NOT_FOUND,
  [SYSTEM_ONE_CONTROL_PATH]: GO_NOT_FOUND,
};

function notFoundReply(): SystemOneCallResult {
  return {
    ok: false,
    cause: 'provider-error',
    notFound: true,
    detail: LIVE_DETAIL,
  };
}

describe('route decide gate', () => {
  it('keeps a ready row when a live notFound is re-checked', async () => {
    const { service, source, config } = probeHarness(READY_ROUTES);
    const mark = jest.spyOn(config, 'markUnsupported');
    const recheck = jest.spyOn(config, 'recheckAfterLiveNotFound');
    const success = jest.spyOn(config, 'recordLiveSuccess');

    const result = await service.decide(implement(), source);
    const status = await config.getStatus();

    expect(recheck).toHaveBeenCalledTimes(1);
    expect(mark).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(status.state).toBe('ready');
    expect(status.detail).toContain(`last call failed: ${LIVE_DETAIL}`);
    expect(result.stage).toBe('gate-0.1');
    expect(GateResultSchema.safeParse(result).success).toBe(true);
  });

  it('shows unsupported-endpoint when the re-check probe agrees', async () => {
    const { service, source, config } = probeHarness(UNSUPPORTED_ROUTES);
    const mark = jest.spyOn(config, 'markUnsupported');
    const recheck = jest.spyOn(config, 'recheckAfterLiveNotFound');

    await service.decide(implement(), source);
    const status: DecisionModelStatusDto = await config.getStatus();

    expect(recheck).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledTimes(1);
    const markOrder = mark.mock.invocationCallOrder[0];
    const recheckOrder = recheck.mock.invocationCallOrder[0];
    expect(markOrder).toBeGreaterThan(recheckOrder ?? 0);
    expect(status.state).toBe('unsupported-endpoint');
  });

  it('passes the decision timeout to the system one factory', async () => {
    const { service, source, seen } = harness({
      reply: () => ({
        ok: false,
        cause: 'timeout',
        notFound: false,
        detail: 'slow',
      }),
    });
    await service.decide(implement(), source);
    expect(seen[0]?.timeoutMs).toBe(DECISION_REQUEST_TIMEOUT_MS);
    expect(
      systemOneClientOptions({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'nimble',
      }).timeoutMs,
    ).toBe(DECISION_REQUEST_TIMEOUT_MS);
  });

  it('ranks without a model call when the selection is unset', async () => {
    const { service, source, calls, rows } = harness({
      selection: { kind: 'unset' },
    });
    const result = await service.decide(implement(), source);
    expect(rows).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({
      stage: 'gate-0.1',
      overallSource: 'ranking',
      usage: { requests: 0, costUsd: null },
    });
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'chosen',
      source: 'ranking',
      fallbackCause: null,
    });
  });

  it('names the invalid field and does not call the candidate source', async () => {
    const { service, calls } = harness({});
    const unused = candidateSource([]);
    const rows = jest.spyOn(unused, 'rows');
    await expect(
      service.decide({ stage: 'gate-0.1', request: 'x' }, unused),
    ).rejects.toThrow(/invalid route decide args at taskType/);
    expect(rows).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('drops an invented choice and never copies it into the result', async () => {
    const { service, source } = harness({
      reply: () => ({
        ok: true,
        result: {
          model: 'nimble',
          answers: {
            build: {
              type: 'choice',
              choice: 'invented-lane',
              probabilities: { 'invented-model': 0.99 },
            },
          },
        },
      }),
    });
    const result = await service.decide(implement(), source);
    const text = JSON.stringify(result);
    expect(text).not.toContain('invented-lane');
    expect(text).not.toContain('invented-model');
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'chosen',
      source: 'ranking',
      fallbackCause: 'bad-output',
      modelProposal: null,
    });
  });

  it('accepts only an offered option', async () => {
    const { service, source } = harness({
      reply: (payload) =>
        answersFor(payload, () => ({ choice: 'o2', confidence: 0.8 })),
    });
    const result = await service.decide(implement(), source);
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'chosen',
      source: 'model',
      fallbackCause: null,
      confidence: 0.8,
    });
    if (entry?.status === 'chosen') expect(entry.executor.id).toBe('grok');
  });

  it('rotates equal lanes across three decisions before the subagent', async () => {
    const built = harness({});
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const result = await built.service.decide(implement(), built.source);
      const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
      if (entry?.status !== 'chosen') throw new Error('expected a choice');
      ids.push(entry.executor.id);
    }
    expect(ids).toEqual(['codex', 'grok', 'opencode']);
  });

  it('keeps a review off the implementer family, including after request 1 fails', async () => {
    const args = {
      stage: 'gate-0.1' as const,
      request: 'ship the change',
      taskType: 'FEATURE' as const,
      depth: 'Full' as const,
      phases: [
        { id: 'build', kind: 'implement' as const },
        { id: 'check', kind: 'review' as const, reviews: ['build'] },
      ],
    };
    const accepted = harness({
      reply: (payload) =>
        answersFor(payload, () => ({ choice: 'o1', confidence: 0.9 })),
    });
    await accepted.service.decide(args, accepted.source);
    expect(JSON.stringify(accepted.calls[1])).not.toContain('lane codex');

    let attempt = 0;
    const failed = harness({
      reply: (payload) => {
        attempt += 1;
        if (attempt === 1)
          return {
            ok: false,
            cause: 'provider-error',
            notFound: false,
            detail: 'down',
          };
        return answersFor(payload, () => ({ choice: 'o1', confidence: 0.9 }));
      },
    });
    const result = await failed.service.decide(args, failed.source);
    expect(JSON.stringify(failed.calls[1])).not.toContain('lane codex');
    const build = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(build).toMatchObject({ status: 'chosen', source: 'ranking' });
    if (build?.status === 'chosen') expect(build.executor.id).toBe('codex');
  });

  it('reports no eligible candidate when every lane is at limit and the role is not a subagent', async () => {
    const limits = new Map<string, LaneLimitState>([
      ['codex', 'at-limit'],
      ['grok', 'at-limit'],
      ['opencode', 'at-limit'],
    ]);
    const { service, source, calls } = harness({ limits });
    const result = await service.decide(
      {
        ...implement(),
        phases: [{ id: 'build', kind: 'implement', role: 'custom-role' }],
      },
      source,
    );
    expect(calls).toHaveLength(0);
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'unavailable',
      exclusionReason: 'no-eligible-candidate',
      source: 'ranking',
      confidence: null,
    });
    if (entry?.status === 'unavailable') {
      expect(entry.excludedBy.map((item) => item.rule)).toEqual([
        'at-limit',
        'at-limit',
        'at-limit',
      ]);
    }
    expect(
      result.stage === 'gate-0.1' ? result.overallConfidence : 1,
    ).toBeNull();
  });

  it('chooses the built-in subagent when every lane is at limit', async () => {
    const limits = new Map<string, LaneLimitState>([
      ['codex', 'at-limit'],
      ['grok', 'at-limit'],
      ['opencode', 'at-limit'],
    ]);
    const { service, source, calls } = harness({ limits });
    const result = await service.decide(implement(), source);
    expect(calls).toHaveLength(0);
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'chosen',
      source: 'ranking',
      executor: { kind: 'subagent', id: 'subagent:backend-developer' },
    });
    if (entry?.status === 'chosen')
      expect(entry.reason).toContain('only eligible candidate');
  });

  it.each([
    'timeout',
    'unreachable',
    'auth',
    'provider-error',
    'bad-output',
  ] as const)('falls back to ranking on %s', async (cause) => {
    const { service, source } = harness({
      reply: () => ({ ok: false, cause, notFound: false, detail: 'down' }),
    });
    const result = await service.decide(implement(), source);
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'chosen',
      source: 'ranking',
      fallbackCause: cause,
    });
  });

  it('falls back on low confidence and keeps the offered label as the proposal', async () => {
    const { service, source } = harness({
      reply: (payload) =>
        answersFor(payload, () => ({ choice: 'o1', confidence: 0.2 })),
    });
    const result = await service.decide(implement(), source);
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'chosen',
      source: 'ranking',
      fallbackCause: 'low-confidence',
      modelProposal: { option: 'o1', confidence: 0.2 },
      confidence: null,
    });
  });

  it('does not send a body that stays over the cap at two options', async () => {
    const { service, source, calls } = harness({
      seams: { maxRequestBytes: 1 },
    });
    const result = await service.decide(implement(), source);
    expect(calls).toHaveLength(0);
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      source: 'ranking',
      fallbackCause: 'payload-too-large',
    });
    expect(result.stage === 'gate-0.1' ? result.usage.requests : 1).toBe(0);
  });

  it('caps one request at 32 questions and marks the rest question-limit', async () => {
    const phases = Array.from({ length: 70 }, (_, index) => ({
      id: `p${index}`,
      kind: 'implement' as const,
    }));
    const { service, source, calls } = harness({});
    const result = await service.decide({ ...implement(), phases }, source);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]?.questions ?? {})).toHaveLength(
      QUESTIONS_PER_REQUEST,
    );
    if (result.stage !== 'gate-0.1') throw new Error('expected a gate result');
    expect(result.roster).toHaveLength(70);
    expect(result.usage.requests).toBeLessThanOrEqual(2);
    expect(result.roster[0]).toMatchObject({
      source: 'model',
      fallbackCause: null,
    });
    expect(result.roster[32]).toMatchObject({
      source: 'ranking',
      fallbackCause: 'question-limit',
    });
    expect(
      result.roster.filter(
        (entry) =>
          entry.status === 'chosen' && entry.fallbackCause === 'question-limit',
      ),
    ).toHaveLength(38);
  });

  it('keeps a fast model list when a sibling misses the budget', async () => {
    const listing = listingOf((row, signal) => {
      if (row.cli !== 'codex') {
        return Promise.resolve([
          { id: 'fast-model', provenance: 'configured' },
        ]);
      }
      return new Promise((resolve, reject) => {
        const onAbort = (): void => {
          signal.removeEventListener('abort', onAbort);
          reject(new Error('listing timed out'));
        };
        if (signal.aborted) {
          reject(new Error('listing timed out'));
          return;
        }
        signal.addEventListener('abort', onAbort);
      });
    });
    const { service, source, calls } = harness({
      listing,
      seams: { listingBudgetMs: 30 },
    });
    const result = await service.decide(implement(), source);
    const text = JSON.stringify(calls[0]);
    expect(text).toContain('fast-model');
    expect(text).toContain('lane-default');
    if (result.stage !== 'gate-0.1') throw new Error('expected a gate result');
    expect(
      result.reasons.filter((reason) => reason === 'models unknown'),
    ).toHaveLength(1);
  });

  it('takes the minimum model confidence and ignores unavailable entries', async () => {
    const both = harness({
      reply: (payload) =>
        answersFor(payload, (_key, index) => ({
          choice: 'o1',
          confidence: index === 0 ? 0.9 : 0.6,
        })),
    });
    const paired = await both.service.decide(
      {
        ...implement(),
        phases: [
          { id: 'one', kind: 'implement' },
          { id: 'two', kind: 'implement' },
        ],
      },
      both.source,
    );
    expect(paired).toMatchObject({
      overallConfidence: 0.6,
      overallSource: 'model',
    });

    const mixed = harness({
      reply: (payload) =>
        answersFor(payload, () => ({ choice: 'o1', confidence: 0.8 })),
    });
    const withSingle = await mixed.service.decide(
      {
        ...implement(),
        phases: [
          { id: 'build', kind: 'implement' },
          { id: 'look', kind: 'visual-review' },
        ],
      },
      mixed.source,
    );
    expect(withSingle).toMatchObject({
      overallConfidence: 0.8,
      overallSource: 'mixed',
    });

    const missing = harness({
      reply: (payload) =>
        answersFor(payload, (_key, index) => ({
          choice: 'o1',
          ...(index === 0 ? { confidence: 0.8 } : {}),
        })),
    });
    const withNull = await missing.service.decide(
      {
        ...implement(),
        phases: [
          { id: 'one', kind: 'implement' },
          { id: 'two', kind: 'implement' },
        ],
      },
      missing.source,
    );
    expect(withNull).toMatchObject({
      overallConfidence: null,
      overallSource: 'model',
    });
  });

  it('leaves structured confidence null and says none was reported', async () => {
    const complete = jest.fn(async () => ({ build: 'o1' }));
    const { service, source, calls } = harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: { isReady: async () => true, complete },
    });
    const result = await service.decide(implement(), source);
    expect(calls).toHaveLength(0);
    expect(complete).toHaveBeenCalledTimes(1);
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'chosen',
      source: 'model',
      confidence: null,
      fallbackCause: null,
    });
    expect(result).toMatchObject({ overallConfidence: null });
    if (entry?.status === 'chosen')
      expect(entry.reason).toContain('no confidence reported');
  });

  it('does not call the model when the Jev key is missing', async () => {
    const { service, source, calls } = harness({
      selection: { kind: 'jev', model: 'jev-1.13.0' },
    });
    const result = await service.decide(implement(), source);
    expect(calls).toHaveLength(0);
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({ source: 'ranking', fallbackCause: 'auth' });
  });

  it('does not emit an invalid pin model id', async () => {
    const { service, source, calls } = harness({});
    const result = await service.decide(
      {
        ...implement(),
        pins: [{ phaseId: 'build', executor: 'grok', model: 'not-a-model' }],
      },
      source,
    );
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('not-a-model');
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'chosen',
      source: 'pin',
      model: 'lane-default',
    });
    if (entry?.status === 'chosen') expect(entry.executor.id).toBe('grok');
  });

  it('still offers the built-in subagent when the agent list throws', async () => {
    const rows = jest.fn(async () => {
      throw new Error('agent list down');
    });
    const { service, calls } = harness({});
    const result = await service.decide(implement(), {
      rows,
      limits: async () => new Map(),
      roles: async () => [],
    });
    expect(calls).toHaveLength(0);
    const text = JSON.stringify(result);
    expect(text).not.toContain('agent list down');
    expect(text).toContain('agent-list-unavailable');
    const entry = result.stage === 'gate-0.1' ? result.roster[0] : undefined;
    expect(entry).toMatchObject({
      status: 'chosen',
      executor: { kind: 'subagent', id: 'subagent:backend-developer' },
    });
  });
});

function probeHarness(routes: Record<string, FakeRoute>) {
  const calls: DecisionPayload[] = [];
  const fetchImpl = fakeFetch(routes);
  const config = configFor(OLLAMA, fetchImpl);
  const source = candidateSource([...THREE]);
  const service = new RouteDecideService({
    config,
    matrix: neutralMatrix(),
    rotation: memoryRotation(),
    logger: testLogger(),
    listing: listingOf(async () => [{ id: 'listed', provenance: 'reported' }]),
    seams: {
      systemOne: () => ({
        decide: async (payload) => {
          calls.push(payload);
          return notFoundReply();
        },
      }),
    },
  });
  return { service, source, config, calls };
}
