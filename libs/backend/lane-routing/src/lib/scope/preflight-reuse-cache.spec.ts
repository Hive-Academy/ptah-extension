import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';

import type { PreflightResult } from '../contracts/route-decide-result.schema';
import { DecisionModelConfig } from '../decision-model/decision-model.config';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { HostRoutingSetting } from './host-routing-setting';
import { PreflightReuseCache } from './preflight-reuse-cache';

const RESULT: PreflightResult = {
  stage: 'pre-flight',
  taskType: {
    value: null,
    source: 'skill-table',
    confidence: null,
    fallbackCause: 'bad-output',
    modelProposal: null,
  },
  depth: {
    value: null,
    source: 'skill-table',
    confidence: null,
    fallbackCause: 'bad-output',
    modelProposal: null,
  },
  overallConfidence: null,
  reasons: [],
  usage: { requests: 1, inputTokens: null, outputTokens: null, costUsd: null },
};

function harness() {
  const workspace = createMockWorkspaceProvider({
    config: {
      'ptah.agentOrchestration.decisionModel': {
        kind: 'ollama',
        model: 'nimble',
      },
    },
  });
  const logger: LaneRoutingLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config = new DecisionModelConfig(
    workspace,
    createMockSecretStorage(),
    createMockStateStorage(),
    logger,
  );
  const setting = new HostRoutingSetting(workspace, config);
  return { cache: new PreflightReuseCache(setting), setting };
}

describe('PreflightReuseCache', () => {
  it('hits only the same session, revision and model fingerprint', () => {
    const { cache } = harness();
    cache.confirmRevision('tab-a', 1);
    cache.put('tab-a', {
      revision: 1,
      modelFingerprint: 'model-a',
      result: RESULT,
    });
    expect(cache.get('tab-a', 'model-a')).toBe(RESULT);
    expect(cache.get('tab-b', 'model-a')).toBeNull();
    expect(cache.get('tab-a', 'model-b')).toBeNull();
    expect(cache.get('tab-a', 'model-a')).toBeNull();
  });

  it('blocks reuse during pending or unknown continuity and discards malformed state', () => {
    const { cache } = harness();
    cache.confirmRevision('tab', 1);
    cache.put('tab', { revision: 1, modelFingerprint: 'm', result: RESULT });
    cache.beginTurn('tab');
    expect(cache.get('tab', 'm')).toBeNull();
    cache.confirmRevision('tab', 1);
    expect(cache.get('tab', 'm')).toBe(RESULT);
    cache.markUnknown('tab');
    expect(cache.get('tab', 'm')).toBeNull();
    cache.confirmRevision('tab', 1);
    expect(cache.get('tab', 'm')).toBeNull();
  });

  it('drops an old revision and ignores stale writes', () => {
    const { cache } = harness();
    cache.confirmRevision('tab', 1);
    cache.put('tab', { revision: 1, modelFingerprint: 'm', result: RESULT });
    cache.confirmRevision('tab', 2);
    expect(cache.get('tab', 'm')).toBeNull();
    cache.put('tab', { revision: 1, modelFingerprint: 'm', result: RESULT });
    expect(cache.get('tab', 'm')).toBeNull();
    cache.put('tab', { revision: 2, modelFingerprint: 'm', result: RESULT });
    expect(cache.get('tab', 'm')).toBe(RESULT);
    cache.confirmRevision('tab', Number.NaN);
    expect(cache.get('tab', 'm')).toBeNull();
  });

  it('clears every session when disabled and never reuses after re-enable', () => {
    const { cache, setting } = harness();
    const enabled = jest.spyOn(setting, 'isEnabled');
    cache.confirmRevision('tab', 1);
    cache.put('tab', { revision: 1, modelFingerprint: 'm', result: RESULT });
    enabled.mockReturnValue(false);
    expect(cache.get('tab', 'm')).toBeNull();
    enabled.mockReturnValue(true);
    expect(cache.get('tab', 'm')).toBeNull();
    cache.put('tab', { revision: 1, modelFingerprint: 'm', result: RESULT });
    expect(cache.get('tab', 'm')).toBeNull();
  });

  it('also clears an earlier entry when a disabled write is attempted', () => {
    const { cache, setting } = harness();
    const enabled = jest.spyOn(setting, 'isEnabled');
    cache.confirmRevision('tab', 1);
    cache.put('tab', { revision: 1, modelFingerprint: 'm', result: RESULT });
    enabled.mockReturnValue(false);
    cache.put('tab', { revision: 1, modelFingerprint: 'm', result: RESULT });
    enabled.mockReturnValue(true);
    expect(cache.get('tab', 'm')).toBeNull();
  });

  it('evicts the least recently used session at 100 entries', () => {
    const { cache } = harness();
    for (let i = 0; i < 100; i += 1) {
      cache.confirmRevision(`tab-${i}`, 1);
      cache.put(`tab-${i}`, {
        revision: 1,
        modelFingerprint: 'm',
        result: RESULT,
      });
    }
    expect(cache.get('tab-0', 'm')).toBe(RESULT);
    cache.confirmRevision('tab-100', 1);
    cache.put('tab-100', {
      revision: 1,
      modelFingerprint: 'm',
      result: RESULT,
    });
    expect(cache.get('tab-1', 'm')).toBeNull();
    expect(cache.get('tab-0', 'm')).toBe(RESULT);
    cache.invalidate('tab-0');
    expect(cache.get('tab-0', 'm')).toBeNull();
  });
});
