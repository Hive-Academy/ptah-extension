import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  DECISION_MODEL_TIMEOUT_SETTING_KEY,
  LANE_FAILURE_CLASSES,
  type LaneFailureClassificationInput,
} from '@ptah-extension/shared';

import { DecisionModelConfig } from '../decision-model/decision-model.config';
import type {
  StructuredDecisionCompleter,
  StructuredDecisionRequest,
} from '../decision-model/structured-decision.port';
import {
  SYSTEM_ONE_PATH,
  type SystemOneFetch,
} from '../decision-model/system-one.client';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import {
  DECISION_REQUEST_TIMEOUT_REMOTE_MS,
  DECISION_RETURN_MARGIN_MS,
} from '../routing-constants';
import {
  DecisionModelFailureClassifier,
  FAILURE_CLASSIFICATION_TIMEOUT_MS,
  buildFailureClassificationPayload,
} from './decision-model-failure-classifier';

const INPUT: LaneFailureClassificationInput = {
  runId: 'codex:1700000000000',
  executorKind: 'cli',
  family: 'openai',
  status: 'failed',
  verdict: 'failed',
  failureKind: 'quota',
  exitCode: 1,
  durationMs: 1200,
};

const STATE_KEYS = [
  'durationMs',
  'executorKind',
  'exitCode',
  'failureKind',
  'family',
  'runId',
  'status',
  'verdict',
];

const CLASS_KEYS = [...LANE_FAILURE_CLASSES].sort();

function testLogger(): jest.Mocked<LaneRoutingLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('expected a record');
  return value;
}

const refuseFetch: SystemOneFetch = async (url) => {
  throw new Error(`unexpected request to ${url}`);
};

async function harness(options: {
  readonly selection?: unknown;
  readonly structured?: StructuredDecisionCompleter;
  readonly fetchImpl?: SystemOneFetch;
  readonly config?: Record<string, unknown>;
}): Promise<{
  readonly classifier: DecisionModelFailureClassifier;
  readonly config: DecisionModelConfig;
  readonly logger: jest.Mocked<LaneRoutingLogger>;
}> {
  const logger = testLogger();
  const config = new DecisionModelConfig(
    createMockWorkspaceProvider({ config: options.config ?? {} }),
    createMockSecretStorage(),
    createMockStateStorage(),
    logger,
    undefined,
    { fetch: refuseFetch },
  );
  if (options.selection !== undefined) {
    await config.setSelection(options.selection);
  }
  const classifier = new DecisionModelFailureClassifier({
    config,
    logger,
    ...(options.structured !== undefined
      ? { structured: options.structured }
      : {}),
    seams: { fetch: options.fetchImpl ?? refuseFetch },
  });
  return { classifier, config, logger };
}

function structuredCompleter(
  complete: StructuredDecisionCompleter['complete'],
): StructuredDecisionCompleter {
  return { isReady: async () => true, complete };
}

describe('DecisionModelFailureClassifier', () => {
  it('makes zero requests when the decision model is unset', async () => {
    const complete = jest.fn();
    const fetchImpl = jest.fn(refuseFetch);
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    const { classifier } = await harness({
      structured: structuredCompleter(complete),
      fetchImpl,
    });

    await expect(classifier.classify(INPUT)).resolves.toBeNull();

    expect(complete).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    timeout.mockRestore();
  });

  it('asks a fake structured client exactly once', async () => {
    const complete = jest.fn(async () => ({
      failureClass: 'crash',
      confidence: 0.91,
    }));
    const fetchImpl = jest.fn(refuseFetch);
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);
    const { classifier } = await harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: structuredCompleter(complete),
      fetchImpl,
    });

    await expect(classifier.classify(INPUT)).resolves.toBe('crash');

    expect(complete).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(FAILURE_CLASSIFICATION_TIMEOUT_MS);
    expect(FAILURE_CLASSIFICATION_TIMEOUT_MS).toBe(3250);
    timeout.mockRestore();
  });

  it('returns null when confidence is below the threshold', async () => {
    const complete = jest.fn(async () => ({
      failureClass: 'usage-limit',
      confidence: 0.49,
    }));
    const { classifier } = await harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: structuredCompleter(complete),
    });

    await expect(classifier.classify(INPUT)).resolves.toBeNull();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('returns null when the chosen probability is below the threshold', async () => {
    const complete = jest.fn(async () => ({
      failureClass: {
        choice: 'crash',
        probabilities: { crash: 0.49, auth: 0.51 },
      },
    }));
    const { classifier } = await harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: structuredCompleter(complete),
    });

    await expect(classifier.classify(INPUT)).resolves.toBeNull();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('accepts the threshold and a missing confidence', async () => {
    const atThreshold = jest.fn(async () => ({
      failureClass: 'timeout',
      confidence: 0.5,
    }));
    const missing = jest.fn(async () => ({ failureClass: 'bad-output' }));
    const high = await harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: structuredCompleter(atThreshold),
    });
    const none = await harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: structuredCompleter(missing),
    });

    await expect(high.classifier.classify(INPUT)).resolves.toBe('timeout');
    await expect(none.classifier.classify(INPUT)).resolves.toBe('bad-output');
    expect(atThreshold).toHaveBeenCalledTimes(1);
    expect(missing).toHaveBeenCalledTimes(1);
  });

  it('returns null when the answer is outside the five classes', async () => {
    const complete = jest.fn(async () => ({
      failureClass: 'overloaded',
      confidence: 0.99,
    }));
    const { classifier } = await harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: structuredCompleter(complete),
    });

    await expect(classifier.classify(INPUT)).resolves.toBeNull();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('pins the payload field set sent to the client', async () => {
    const calls: StructuredDecisionRequest[] = [];
    const leaky = {
      ...INPUT,
      request: 'leak-me',
      apiKey: 'leak-me',
    };
    const complete = jest.fn(async (request: StructuredDecisionRequest) => {
      calls.push(request);
      return { failureClass: 'auth', confidence: 0.8 };
    });
    const { classifier } = await harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: structuredCompleter(complete),
    });

    await expect(classifier.classify(leaky)).resolves.toBe('auth');

    const request = calls[0];
    if (request === undefined) throw new Error('expected one request');
    expect(Object.keys(request).sort()).toEqual([
      'jsonSchema',
      'model',
      'prompt',
      'providerId',
      'signal',
    ]);
    expect(request.providerId).toBe('anthropic');
    expect(request.model).toBe('claude');
    expect(request.prompt).not.toContain('leak-me');
    expect(JSON.parse(request.prompt)).toEqual(
      buildFailureClassificationPayload(INPUT),
    );

    const prompt = record(JSON.parse(request.prompt));
    expect(Object.keys(prompt).sort()).toEqual(['questions', 'state']);
    const state = record(prompt['state']);
    expect(Object.keys(state).sort()).toEqual(STATE_KEYS);
    expect(state).toEqual({
      runId: INPUT.runId,
      executorKind: INPUT.executorKind,
      family: INPUT.family,
      status: INPUT.status,
      verdict: INPUT.verdict,
      failureKind: INPUT.failureKind,
      exitCode: INPUT.exitCode,
      durationMs: INPUT.durationMs,
    });
    const questions = record(prompt['questions']);
    expect(Object.keys(questions)).toEqual(['failureClass']);
    const question = record(questions['failureClass']);
    expect(Object.keys(question).sort()).toEqual([
      'criteria',
      'instructions',
      'type',
    ]);
    expect(question['type']).toBe('choice');
    const criteria = record(question['criteria']);
    expect(Object.keys(criteria).sort()).toEqual(CLASS_KEYS);
    for (const failureClass of CLASS_KEYS) {
      expect(criteria[failureClass]).toBe(failureClass);
    }

    const schema = record(request.jsonSchema);
    expect(Object.keys(schema).sort()).toEqual([
      'additionalProperties',
      'properties',
      'required',
      'type',
    ]);
    expect(schema['additionalProperties']).toBe(false);
    expect(schema['type']).toBe('object');
    expect(schema['required']).toEqual(['failureClass']);
    const properties = record(schema['properties']);
    expect(Object.keys(properties)).toEqual(['failureClass']);
    const property = record(properties['failureClass']);
    expect(property['type']).toBe('string');
    expect(property['enum']).toEqual([...LANE_FAILURE_CLASSES]);
  });

  it('posts exactly one system one request when ollama is selected', async () => {
    const calls: {
      url: string;
      body: string;
      headers: Record<string, string>;
    }[] = [];
    const fetchImpl: SystemOneFetch = async (url, init) => {
      calls.push({
        url,
        body: init?.body ?? '',
        headers: init?.headers ?? {},
      });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            model: 'nimble',
            answers: {
              failureClass: {
                type: 'choice',
                choice: 'auth',
                confidence: 0.8,
              },
            },
          }),
      };
    };
    const { classifier } = await harness({
      selection: { kind: 'ollama', model: 'nimble' },
      fetchImpl,
    });

    await expect(classifier.classify(INPUT)).resolves.toBe('auth');

    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) throw new Error('expected one request');
    expect(new URL(call.url).pathname).toBe(SYSTEM_ONE_PATH);
    expect(call.headers['authorization']).toBeUndefined();
    expect(call.headers['content-type']).toBe('application/json');
    const body = record(JSON.parse(call.body));
    expect(Object.keys(body).sort()).toEqual(['model', 'questions', 'state']);
    expect(body['model']).toBe('nimble');
    expect(Object.keys(record(body['state'])).sort()).toEqual(STATE_KEYS);
    expect(JSON.stringify(body)).not.toContain('leak-me');
  });

  it('posts a custom endpoint request under its path with its key and remote budget', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl: SystemOneFetch = async (url, init) => {
      calls.push({ url, headers: init?.headers ?? {} });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            model: 'clef:27b',
            answers: {
              failureClass: {
                type: 'choice',
                choice: 'usage-limit',
                confidence: 0.9,
              },
            },
          }),
      };
    };
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);
    try {
      const { classifier, config } = await harness({
        selection: {
          kind: 'custom',
          baseUrl: 'https://gateway.example/team/',
          model: 'clef:27b',
        },
        fetchImpl,
      });
      await config.keys.set('custom', 'custom-key', 'https://gateway.example');

      await expect(classifier.classify(INPUT)).resolves.toBe('usage-limit');

      expect(calls).toHaveLength(1);
      const call = calls[0];
      if (call === undefined) throw new Error('expected one request');
      expect(call.url).toBe(`https://gateway.example/team${SYSTEM_ONE_PATH}`);
      expect(call.headers['authorization']).toBe('Bearer custom-key');
      expect(timeout).toHaveBeenCalledWith(
        DECISION_REQUEST_TIMEOUT_REMOTE_MS + DECISION_RETURN_MARGIN_MS,
      );
    } finally {
      timeout.mockRestore();
    }
  });

  it('gives a System One classification the configured request timeout', async () => {
    const fetchImpl: SystemOneFetch = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          model: 'nimble',
          answers: {
            failureClass: {
              type: 'choice',
              choice: 'usage-limit',
              confidence: 0.9,
            },
          },
        }),
    });
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);
    try {
      const { classifier } = await harness({
        selection: { kind: 'ollama', model: 'nimble' },
        fetchImpl,
        config: { [`ptah.${DECISION_MODEL_TIMEOUT_SETTING_KEY}`]: 25_000 },
      });

      await expect(classifier.classify(INPUT)).resolves.toBe('usage-limit');

      expect(timeout).toHaveBeenCalledWith(25_000 + DECISION_RETURN_MARGIN_MS);
    } finally {
      timeout.mockRestore();
    }
  });

  it('makes zero requests when the structured port is not registered', async () => {
    const fetchImpl = jest.fn(refuseFetch);
    const { classifier, logger } = await harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      fetchImpl,
    });

    await expect(classifier.classify(INPUT)).resolves.toBeNull();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[lane-routing] structured decision port is not registered',
      { runId: INPUT.runId, providerId: 'anthropic' },
    );
  });

  it('makes zero requests when jev has no credential', async () => {
    const fetchImpl = jest.fn(refuseFetch);
    const { classifier } = await harness({
      selection: { kind: 'jev', model: 'jev-1.13.0' },
      fetchImpl,
    });

    await expect(classifier.classify(INPUT)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves null when the structured client rejects', async () => {
    const complete = jest.fn(async () => {
      throw new Error('provider down');
    });
    const { classifier, logger } = await harness({
      selection: {
        kind: 'structured',
        providerId: 'anthropic',
        model: 'claude',
      },
      structured: structuredCompleter(complete),
    });

    await expect(classifier.classify(INPUT)).resolves.toBeNull();

    expect(complete).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[lane-routing] failure classification failed',
      { runId: INPUT.runId, name: 'Error' },
    );
  });

  it('returns null when the structured completer never settles', async () => {
    jest.useFakeTimers();
    const clear = jest.spyOn(global, 'clearTimeout');
    try {
      const { classifier } = await harness({
        selection: {
          kind: 'structured',
          providerId: 'anthropic',
          model: 'claude',
        },
        structured: structuredCompleter(() => new Promise(() => undefined)),
      });
      const pending = classifier.classify(INPUT);

      await jest.advanceTimersByTimeAsync(
        FAILURE_CLASSIFICATION_TIMEOUT_MS + 1,
      );

      await expect(pending).resolves.toBeNull();
      expect(clear).toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      clear.mockRestore();
      jest.useRealTimers();
    }
  });
});
