import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { CliDetectionResult } from '@ptah-extension/shared';

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
import type { SystemOneClientOptions } from './decision-model/system-one.client';
import { PreflightResultSchema } from './contracts/route-decide-result.schema';

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

function configFor(selection: unknown): DecisionModelConfig {
  const fetchImpl: SystemOneFetch = async (url) => {
    throw new Error(`unexpected probe ${url}`);
  };
  return new DecisionModelConfig(
    createMockWorkspaceProvider({
      config: selection === undefined ? {} : { [SELECTION_KEY]: selection },
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
  readonly structured?: StructuredDecisionCompleter;
  readonly seams?: RouteDecideSeams;
  readonly reply?: (payload: DecisionPayload) => SystemOneCallResult;
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
    config: configFor(options.selection),
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

describe('route decide preflight', () => {
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
