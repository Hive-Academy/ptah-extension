import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';

import { DecisionModelConfig } from '../decision-model/decision-model.config';
import type { DecisionPayload } from '../decision-model/decision-payload';
import type { SystemOneCallResult, SystemOneClientOptions } from '../decision-model/system-one.client';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { DECISION_REQUEST_TIMEOUT_MS, REQUEST_SIZE_LIMIT_BYTES } from '../routing-constants';
import { HostRoutingSetting } from './host-routing-setting';
import {
  ScopeCheckService,
  buildPreflightScopeSummary,
  type ScopeConversation,
} from './scope-check.service';

const CONVERSATION: ScopeConversation = {
  turnText: 'Yes, implement retries',
  previousUserTurn: 'Add retries to the uploader',
  lastAssistantReply: 'Retry network errors three times?',
  pendingScope: 'Uploader retry work',
  lastRoutedScope: 'Earlier uploader work',
};

function harness(options: {
  readonly selection?: unknown;
  readonly enabled?: unknown;
  readonly reply?: (payload: DecisionPayload) => SystemOneCallResult;
}) {
  const configValues: Record<string, unknown> = {};
  if (options.selection !== undefined) {
    configValues['ptah.agentOrchestration.decisionModel'] = options.selection;
  }
  if (options.enabled !== undefined) {
    configValues['ptah.agentOrchestration.hostRouting'] = options.enabled;
  }
  const workspace = createMockWorkspaceProvider({ config: configValues });
  const logger: LaneRoutingLogger = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  };
  const config = new DecisionModelConfig(
    workspace, createMockSecretStorage(), createMockStateStorage(), logger,
  );
  const setting = new HostRoutingSetting(workspace, config);
  const calls: DecisionPayload[] = [];
  const seen: SystemOneClientOptions[] = [];
  const service = new ScopeCheckService({
    config, logger, setting,
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
                  engineering: { type: 'choice', choice: 'o1', confidence: 0.9 },
                  scope_settled: { type: 'choice', choice: 'o1', confidence: 0.8 },
                  relation: { type: 'choice', choice: 'o2', confidence: 0.7 },
                  material_change: { type: 'choice', choice: 'o2', confidence: 0.6 },
                },
              },
            };
          },
        };
      },
    },
  });
  return { service, calls, seen, logger };
}

describe('ScopeCheckService', () => {
  it.each([
    ['unset model', undefined, undefined],
    ['routing disabled', { kind: 'ollama', model: 'nimble' }, false],
  ])('makes zero requests for %s', async (_name, selection, enabled) => {
    const { service, calls, seen } = harness({ selection, enabled });
    await expect(service.assess(CONVERSATION)).resolves.toMatchObject({ kind: 'unavailable' });
    expect(calls).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('returns four typed answers from one request with the existing deadline', async () => {
    const { service, calls, seen } = harness({ selection: { kind: 'ollama', model: 'nimble' } });
    await expect(service.assess(CONVERSATION)).resolves.toEqual({
      kind: 'answered',
      engineering: { value: 'yes', confidence: 0.9 },
      settled: { value: 'yes', confidence: 0.8 },
      relation: { value: 'continuation', confidence: 0.7 },
      materialChange: { value: 'no', confidence: 0.6 },
      usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null },
    });
    expect(calls).toHaveLength(1);
    expect(seen[0]?.timeoutMs).toBe(DECISION_REQUEST_TIMEOUT_MS);
    expect(Object.keys(calls[0]?.questions ?? {})).toEqual([
      'engineering', 'scope_settled', 'relation', 'material_change',
    ]);
  });

  it('drops low confidence and malformed answers without a second request', async () => {
    const { service, calls } = harness({
      selection: { kind: 'ollama', model: 'nimble' },
      reply: () => ({
        ok: true,
        result: {
          model: 'nimble',
          answers: {
            engineering: { type: 'choice', choice: 'o1', confidence: 0.49 },
            scope_settled: { type: 'choice', choice: 'o99', confidence: 0.9 },
          },
        },
      }),
    });
    await expect(service.assess(CONVERSATION)).resolves.toMatchObject({
      kind: 'answered', engineering: null, settled: null, relation: null, materialChange: null,
    });
    expect(calls).toHaveLength(1);
  });

  it('fails open on timeout and never logs conversation text', async () => {
    const { service, calls, logger } = harness({
      selection: { kind: 'ollama', model: 'nimble' },
      reply: () => ({ ok: false, cause: 'timeout', detail: CONVERSATION.turnText, notFound: false }),
    });
    await expect(service.assess(CONVERSATION)).resolves.toMatchObject({ kind: 'unavailable' });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain(CONVERSATION.turnText);
  });

  it('caps every field and the complete payload, omitting null sections', async () => {
    const { service, calls } = harness({ selection: { kind: 'ollama', model: 'nimble' } });
    const huge: ScopeConversation = {
      turnText: 't'.repeat(10_000),
      previousUserTurn: 'u'.repeat(10_000),
      lastAssistantReply: 'a'.repeat(10_000),
      pendingScope: 'p'.repeat(10_000),
      lastRoutedScope: 'r'.repeat(10_000),
    };
    await service.assess(huge);
    const payload = calls[0];
    expect(payload).toBeDefined();
    const request = payload?.state.request ?? '';
    expect(request.length).toBeLessThanOrEqual(8000);
    expect(new TextEncoder().encode(JSON.stringify(payload)).length).toBeLessThanOrEqual(REQUEST_SIZE_LIMIT_BYTES);
    expect(request).toContain('t'.repeat(2000));
    expect(request).not.toContain('t'.repeat(2001));
    expect(request).toContain('u'.repeat(800));
    expect(request).not.toContain('u'.repeat(801));
    expect(request).toContain('a'.repeat(1500));
    expect(request).not.toContain('a'.repeat(1501));
    expect(request).toContain('p'.repeat(1200));
    expect(request).not.toContain('p'.repeat(1201));
    expect(request).toContain('r'.repeat(1200));
    expect(request).not.toContain('r'.repeat(1201));
    expect(buildPreflightScopeSummary(huge).length).toBeLessThanOrEqual(8000);

    await service.assess({ ...CONVERSATION, previousUserTurn: null, lastAssistantReply: null, pendingScope: null, lastRoutedScope: null });
    expect(calls[1]?.state.request).toBe(`User turn:\n${CONVERSATION.turnText}`);
  });
});
