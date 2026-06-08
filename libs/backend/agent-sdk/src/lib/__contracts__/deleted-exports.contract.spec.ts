import 'reflect-metadata';
import * as agentSdk from '../../index';

describe('agent-sdk barrel anti-regression contracts (TASK_2026_134)', () => {
  it.each([
    'TIER_TO_MODEL_ID',
    'STATIC_FALLBACK_MODELS',
    'DEFAULT_FALLBACK_MODEL_ID',
  ])('agent-sdk barrel does not export %s', (symbolName: string) => {
    const exported = (agentSdk as Record<string, unknown>)[symbolName];
    expect(exported).toBeUndefined();
  });
});
