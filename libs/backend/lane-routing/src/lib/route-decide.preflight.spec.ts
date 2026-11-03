import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  DECISION_MODEL_TIMEOUT_SETTING_KEY,
  type CliDetectionResult,
} from '@ptah-extension/shared';

import { DecisionModelConfig } from './decision-model/decision-model.config';
import type { StructuredDecisionCompleter } from './decision-model/structured-decision.port';
import type { SystemOneFetch } from './decision-model/system-one.client';
import type { LaneRoutingLogger } from './lane-routing-logger';
import type { RouteCandidateSource } from './route-candidate-source.port';
import { DECISION_REQUEST_TIMEOUT_MS } from './routing-constants';
import {
  RouteDecideService,
  type RouteDecideSeams,
} from './route-decide.service';
import {
  systemOneClientOptions,
  type SystemOneCaller,
} from './pipeline/model-refine';
import type { DecisionPayload } from './decision-model/decision-payload';
import type { SystemOneCallResult } from './decision-model/system-one.client';
import {
  SystemOneClient,
  type SystemOneClientOptions,
} from './decision-model/system-one.client';
import { PreflightResultSchema } from './contracts/route-decide-result.schema';
import { HostRoutingSetting } from './scope/host-routing-setting';
import { PreflightReuseCache } from './scope/preflight-reuse-cache';

const SELECTION_KEY = 'ptah.agentOrchestration.decisionModel';
const OLLAMA = { kind: 'ollama', model: 'nimble' } as const;

function testLogger(): LaneRoutingLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function configFor(
  selection: unknown,
  extra: Record<string, unknown> = {},
): DecisionModelConfig {
  const fetchImpl: SystemOneFetch = async (url) => {
    throw new Error(`unexpected probe ${url}`);
  };
  return new DecisionModelConfig(
    createMockWorkspaceProvider({
      config:
        selection === undefined
          ? extra
          : { ...extra, [SELECTION_KEY]: selection },
    }),
    createMockSecretStorage(),
    createMockStateStorage(),
    testLogger(),
    undefined,
    { fetch: fetchImpl },
  );
}

function source(): RouteCandidateSource & { readonly rows: jest.Mock } {
  return {
    rows: jest.fn(async () => [] as CliDetectionResult[]),
    limits: jest.fn(async () => new Map()),
    roles: jest.fn(async () => []),
  };
}

function harness(options: {
  readonly selection?: unknown;
  readonly config?: Record<string, unknown>;
  readonly structured?: StructuredDecisionCompleter;
  readonly seams?: RouteDecideSeams;
  readonly reply?: (payload: DecisionPayload) => SystemOneCallResult;
  readonly reuse?: PreflightReuseCache;
}) {
  const calls: DecisionPayload[] = [];
  const seen: SystemOneClientOptions[] = [];
  const caller: SystemOneCaller = {
    decide: async (payload) => {
      calls.push(payload);
      return (
        options.reply?.(payload) ?? {
          ok: true,
          result: {
            model: 'nimble',
            answers: {
              task_type: { type: 'choice', choice: 'o1', confidence: 0.8 },
              depth: { type: 'choice', choice: 'o1', confidence: 0.7 },
            },
          },
        }
      );
    },
  };
  const service = new RouteDecideService({
    config: configFor(options.selection, options.config),
    matrix: {
      load: async () => {
        throw new Error('preflight must not load the matrix');
      },
    },
    rotation: {
      load: () => {
        throw new Error('preflight must not load rotation');
      },
      save: async () => {
        throw new Error('preflight must not save rotation');
      },
    },
    logger: testLogger(),
    ...(options.reuse !== undefined ? { reuse: options.reuse } : {}),
    ...(options.structured !== undefined
      ? { structured: options.structured }
      : {}),
    seams: {
      systemOne: (clientOptions) => {
        seen.push(clientOptions);
        return options.seams?.systemOne?.(clientOptions) ?? caller;
      },
      ...options.seams,
    },
  });
  return { service, calls, seen };
}

const preflight = {
  stage: 'pre-flight' as const,
  request: 'describe the change',
};

function reuseCache(enabled = true): PreflightReuseCache {
  return new PreflightReuseCache(
    new HostRoutingSetting(
      createMockWorkspaceProvider({
        config: { 'ptah.agentOrchestration.hostRouting': enabled },
      }),
      configFor(OLLAMA),
    ),
  );
}

describe('route decide preflight', () => {
  it('returns a validated copy of a confirmed cached result without dispatching', async () => {
    const reuse = reuseCache();
    reuse.confirmRevision('tab-1', 4);
    const first = harness({ selection: OLLAMA, reuse });
    const result = await first.service.decide(preflight, source(), {
      sessionKey: 'tab-1',
    });
    if (result.stage !== 'pre-flight') throw new Error('expected preflight');
    expect(first.calls).toHaveLength(1);
    reuse.put('tab-1', {
      revision: 4,
      modelFingerprint: JSON.stringify(OLLAMA),
      result,
    });

    const next = harness({ selection: OLLAMA, reuse });
    const reused = await next.service.decide(preflight, source(), {
      sessionKey: 'tab-1',
    });
    expect(next.calls).toHaveLength(0);
    expect(reused).toMatchObject({
      ...result,
      reasons: [...result.reasons, 'reused host pre-flight result'],
      usage: {
        requests: 0,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      },
    });
    expect(reused.reasons).toEqual([
      ...result.reasons,
      'reused host pre-flight result',
    ]);
    expect(result.reasons).not.toContain('reused host pre-flight result');
    expect(PreflightResultSchema.safeParse(reused).success).toBe(true);
  });

  it.each([
    'different fingerprint',
    'missing session key',
    'pending continuity',
    'unknown continuity',
    'disabled setting',
    'invalidated entry',
  ] as const)('dispatches on a cache miss: %s', async (reason) => {
    const reuse = reuseCache(reason !== 'disabled setting');
    reuse.confirmRevision('tab-1', 4);
    const seeded = harness({ selection: OLLAMA, reuse });
    const cached = await seeded.service.decide(preflight, source());
    if (cached.stage !== 'pre-flight') throw new Error('expected preflight');
    reuse.put('tab-1', {
      revision: 4,
      modelFingerprint: JSON.stringify(
        reason === 'different fingerprint'
          ? { kind: 'ollama', model: 'other' }
          : OLLAMA,
      ),
      result: cached,
    });
    if (reason === 'pending continuity') reuse.beginTurn('tab-1');
    if (reason === 'unknown continuity') reuse.markUnknown('tab-1');
    if (reason === 'invalidated entry') reuse.invalidate('tab-1');

    const next = harness({ selection: OLLAMA, reuse });
    const result = await next.service.decide(
      preflight,
      source(),
      reason === 'missing session key' ? undefined : { sessionKey: 'tab-1' },
    );
    expect(next.calls).toHaveLength(1);
    expect(result.usage.requests).toBe(1);
    expect(result.reasons).not.toContain('reused host pre-flight result');
  });

  it('returns skill-table nulls and calls nothing when the model is unset', async () => {
    const rows = source();
    const { service, calls } = harness({});
    const result = await service.decide(preflight, rows);
    expect(rows.rows).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({
      stage: 'pre-flight',
      taskType: {
        value: null,
        source: 'skill-table',
        confidence: null,
        fallbackCause: null,
        modelProposal: null,
      },
      depth: {
        value: null,
        source: 'skill-table',
        confidence: null,
        fallbackCause: null,
        modelProposal: null,
      },
      overallConfidence: null,
      usage: {
        requests: 0,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      },
    });
    expect(PreflightResultSchema.safeParse(result).success).toBe(true);
  });

  it('asks task_type and depth once and maps the offered labels', async () => {
    const rows = source();
    const { service, calls, seen } = harness({ selection: OLLAMA });
    const result = await service.decide(preflight, rows);
    expect(rows.rows).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]?.questions ?? {}).sort()).toEqual([
      'depth',
      'task_type',
    ]);
    expect(seen[0]?.timeoutMs).toBe(DECISION_REQUEST_TIMEOUT_MS);
    expect(
      systemOneClientOptions({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'nimble',
        probe: 'daemon',
        locality: 'local',
        timeoutMs: DECISION_REQUEST_TIMEOUT_MS,
      }).timeoutMs,
    ).toBe(DECISION_REQUEST_TIMEOUT_MS);
    expect(result).toMatchObject({
      taskType: {
        value: 'FEATURE',
        source: 'model',
        confidence: 0.8,
        fallbackCause: null,
      },
      depth: {
        value: 'Full',
        source: 'model',
        confidence: 0.7,
        fallbackCause: null,
      },
      overallConfidence: 0.7,
      usage: { requests: 1, costUsd: null },
    });
  });

  // Real timers: AbortSignal.timeout ignores Jest's fake timers, so this
  // waits ~3.3 s. The reply is slower than the 3000 ms default and faster
  // than the configured 5000 ms, so it succeeds only if the setting reaches
  // the client's abort signal.
  it('waits for a slow decision model up to the configured timeout', async () => {
    const reply = JSON.stringify({
      model: 'nimble',
      answers: {
        task_type: { type: 'choice', choice: 'o1', confidence: 0.8 },
        depth: { type: 'choice', choice: 'o1', confidence: 0.7 },
      },
    });
    const slowFetch: SystemOneFetch = (_url, init) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            resolve({ ok: true, status: 200, text: async () => reply }),
          DECISION_REQUEST_TIMEOUT_MS + 300,
        );
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
    const seen: SystemOneClientOptions[] = [];
    const { service } = harness({
      selection: OLLAMA,
      config: { [`ptah.${DECISION_MODEL_TIMEOUT_SETTING_KEY}`]: 5_000 },
      seams: {
        systemOne: (clientOptions) => {
          seen.push(clientOptions);
          return new SystemOneClient(clientOptions, { fetch: slowFetch });
        },
      },
    });
    const result = await service.decide(preflight, source());
    expect(seen[0]?.timeoutMs).toBe(5_000);
    expect(result).toMatchObject({
      taskType: { value: 'FEATURE', source: 'model', fallbackCause: null },
      usage: { requests: 1 },
    });
  }, 10_000);

  it('rejects invalid args before any port or model call', async () => {
    const rows = source();
    const { service, calls } = harness({ selection: OLLAMA });
    await expect(service.decide({ stage: 'pre-flight' }, rows)).rejects.toThrow(
      /invalid route decide args/,
    );
    expect(rows.rows).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it.each([
    'timeout',
    'unreachable',
    'auth',
    'provider-error',
    'bad-output',
  ] as const)('records %s on both answers without throwing', async (cause) => {
    const { service, calls } = harness({
      selection: OLLAMA,
      reply: () => ({ ok: false, cause, notFound: false, detail: 'down' }),
    });
    const result = await service.decide(preflight, source());
    if (result.stage !== 'pre-flight') throw new Error('expected preflight');
    expect(result.taskType).toMatchObject({
      value: null,
      source: 'skill-table',
      fallbackCause: cause,
      modelProposal: null,
    });
    expect(result.depth).toMatchObject({
      value: null,
      source: 'skill-table',
      fallbackCause: cause,
      modelProposal: null,
    });
    expect(calls).toHaveLength(1);
    expect(result.usage.requests).toBe(1);
  });

  it('treats a low reported confidence as a skill-table fallback and keeps the label', async () => {
    const { service } = harness({
      selection: OLLAMA,
      reply: () => ({
        ok: true,
        result: {
          model: 'nimble',
          answers: {
            task_type: { type: 'choice', choice: 'o1', confidence: 0.2 },
            depth: { type: 'choice', choice: 'o2', confidence: 0.4 },
          },
        },
      }),
    });
    const result = await service.decide(preflight, source());
    if (result.stage !== 'pre-flight') throw new Error('expected preflight');
    expect(result.taskType).toMatchObject({
      value: null,
      source: 'skill-table',
      fallbackCause: 'low-confidence',
      modelProposal: { option: 'o1', confidence: 0.2 },
    });
    expect(result.depth.fallbackCause).toBe('low-confidence');
    expect(result.depth.modelProposal).toEqual({
      option: 'o2',
      confidence: 0.4,
    });
  });

  it('keeps structured confidence null', async () => {
    const complete = jest.fn(async () => ({ task_type: 'o2', depth: 'o3' }));
    const { service, calls } = harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: { isReady: async () => true, complete },
    });
    const result = await service.decide(preflight, source());
    expect(calls).toHaveLength(0);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      taskType: {
        value: 'BUGFIX',
        source: 'model',
        confidence: null,
        fallbackCause: null,
      },
      depth: {
        value: 'Minimal',
        source: 'model',
        confidence: null,
        fallbackCause: null,
      },
      overallConfidence: null,
    });
    expect(result.reasons.join('\n')).toContain('no confidence reported');
    expect(JSON.stringify(result)).not.toContain('low-confidence');
  });

  it('does not send a preflight body over the size limit', async () => {
    const tiny = harness({ selection: OLLAMA, seams: { maxRequestBytes: 1 } });
    const result = await tiny.service.decide(preflight, source());
    expect(tiny.calls).toHaveLength(0);
    if (result.stage !== 'pre-flight') throw new Error('expected preflight');
    expect(result.taskType.fallbackCause).toBe('payload-too-large');
    expect(result.depth.fallbackCause).toBe('payload-too-large');
  });
});
