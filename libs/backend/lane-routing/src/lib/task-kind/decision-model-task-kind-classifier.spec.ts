import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { LaneTaskKindClassificationInput } from '@ptah-extension/shared';

import { DecisionModelConfig } from '../decision-model/decision-model.config';
import type { DecisionPayload } from '../decision-model/decision-payload';
import type {
  SystemOneCallResult,
  SystemOneClientOptions,
} from '../decision-model/system-one.client';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { DECISION_REQUEST_TIMEOUT_MS } from '../routing-constants';
import { DecisionModelTaskKindClassifier } from './decision-model-task-kind-classifier';

const SELECTION_KEY = 'ptah.agentOrchestration.decisionModel';
const BRIEF = 'Private task brief: make a plan';
const INPUT: LaneTaskKindClassificationInput = {
  runId: 'run-1',
  executorKind: 'cli',
  role: 'planner',
  brief: BRIEF,
};

function harness(options: {
  readonly selection?: unknown;
  readonly reply?: (payload: DecisionPayload) => SystemOneCallResult;
}) {
  const logger: LaneRoutingLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config = new DecisionModelConfig(
    createMockWorkspaceProvider({
      config:
        options.selection === undefined
          ? {}
          : { [SELECTION_KEY]: options.selection },
    }),
    createMockSecretStorage(),
    createMockStateStorage(),
    logger,
  );
  const calls: DecisionPayload[] = [];
  const seen: SystemOneClientOptions[] = [];
  const classifier = new DecisionModelTaskKindClassifier({
    config,
    logger,
    seams: {
      systemOne: (clientOptions) => {
        seen.push(clientOptions);
        return {
          decide: async (payload) => {
            calls.push(payload);
            return options.reply?.(payload) ?? {
              ok: true,
              result: {
                model: 'nimble',
                answers: {
                  task_kind: { type: 'choice', choice: 'o1', confidence: 0.8 },
                },
              },
            };
          },
        };
      },
    },
  });
  return { classifier, calls, seen, logger };
}

describe('DecisionModelTaskKindClassifier', () => {
  it('returns null without opening a request when the model is unset', async () => {
    const { classifier, calls, seen } = harness({});
    await expect(classifier.classify(INPUT)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('sends one fixed question and accepts an offered kind', async () => {
    const { classifier, calls, seen, logger } = harness({
      selection: { kind: 'ollama', model: 'nimble' },
      reply: () => ({
        ok: true,
        result: {
          model: 'nimble',
          answers: {
            task_kind: { type: 'choice', choice: 'o2', confidence: 0.8 },
          },
        },
      }),
    });
    await expect(classifier.classify(INPUT)).resolves.toBe('implement');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.state.request).toBe(`Role: planner\nTask:\n${BRIEF}`);
    expect(Object.keys(calls[0]?.questions ?? {})).toEqual(['task_kind']);
    expect(seen[0]?.timeoutMs).toBe(DECISION_REQUEST_TIMEOUT_MS);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['low confidence', 'o1', 0.49],
    ['out-of-set choice', 'o99', 0.9],
  ])('returns null for %s', async (_reason, choice, confidence) => {
    const { classifier, calls } = harness({
      selection: { kind: 'ollama', model: 'nimble' },
      reply: () => ({
        ok: true,
        result: {
          model: 'nimble',
          answers: {
            task_kind: { type: 'choice', choice, confidence },
          },
        },
      }),
    });
    await expect(classifier.classify(INPUT)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('returns null when the existing per-request timeout is reported', async () => {
    const { classifier, calls, seen } = harness({
      selection: { kind: 'ollama', model: 'nimble' },
      reply: () => ({
        ok: false,
        cause: 'timeout',
        detail: 'request timed out',
        notFound: false,
      }),
    });
    await expect(classifier.classify(INPUT)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    expect(seen[0]?.timeoutMs).toBe(DECISION_REQUEST_TIMEOUT_MS);
  });

  it('logs only safe facts and resolves null when a caller throws', async () => {
    const { classifier, calls, logger } = harness({
      selection: { kind: 'ollama', model: 'nimble' },
      reply: () => {
        throw new Error(BRIEF);
      },
    });
    await expect(classifier.classify(INPUT)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[lane-routing] task-kind classification failed',
      { name: 'Error' },
    );
    expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain(
      BRIEF,
    );
  });
});
