/**
 * Codex Provider Entry Specs
 *
 * The Codex static list is IDs-only fallback metadata. Pins:
 * 1. `gpt-5.4` stays first (`staticModels[0]` is the default-model fallback).
 * 2. `gpt-6-astra` and `gpt-5.6-sol` are appended after the original six.
 * 3. Every `contextLength` is 0 (unknown); windows come only from the live catalog.
 * 4. `CODEX_DEFAULT_TIERS` is unchanged and names only listed IDs.
 * 5. `seedStaticModelPricing('openai-codex')` writes nothing, so no
 *    `maxTokens: 0` entry is ever published for a Codex ID.
 *
 * @see TASK_2026_408
 */

import {
  CODEX_DEFAULT_TIERS,
  CODEX_PROVIDER_ENTRY,
} from './codex-provider-entry';
import {
  getAnthropicProvider,
  isSubscriptionCoveredProvider,
  seedStaticModelPricing,
} from '../provider-registry';
import { getPricingMap } from '../../utils/pricing.utils';

const STATIC_MODELS = CODEX_PROVIDER_ENTRY.staticModels ?? [];
const STATIC_IDS = STATIC_MODELS.map((m) => m.id);

describe('CODEX_PROVIDER_ENTRY static models', () => {
  it('keeps gpt-5.4 first so the default-model fallback is unchanged', () => {
    expect(STATIC_IDS[0]).toBe('gpt-5.4');
  });

  it('keeps the original six IDs in order and appends the two new IDs', () => {
    expect(STATIC_IDS).toEqual([
      'gpt-5.4',
      'gpt-5.3-codex',
      'gpt-5.2-codex',
      'gpt-5.2',
      'gpt-5.1-codex-max',
      'gpt-5.1-codex-mini',
      'gpt-6-astra',
      'gpt-5.6-sol',
    ]);
  });

  it('has no duplicate IDs', () => {
    expect(new Set(STATIC_IDS).size).toBe(STATIC_IDS.length);
  });

  it('declares every context window as 0 (unknown; catalog-only)', () => {
    expect(STATIC_MODELS.length).toBeGreaterThan(0);
    for (const model of STATIC_MODELS) {
      expect(model.contextLength).toBe(0);
    }
  });

  it('marks every model as tool-capable', () => {
    for (const model of STATIC_MODELS) {
      expect(model.supportsToolUse).toBe(true);
    }
  });

  it('is the list the registry resolves for openai-codex', () => {
    expect(getAnthropicProvider('openai-codex')?.staticModels).toBe(
      CODEX_PROVIDER_ENTRY.staticModels,
    );
  });
});

describe('CODEX_DEFAULT_TIERS', () => {
  it('is unchanged', () => {
    expect(CODEX_DEFAULT_TIERS).toEqual({
      sonnet: 'gpt-5.3-codex',
      opus: 'gpt-5.4',
      haiku: 'gpt-5.1-codex-mini',
    });
    expect(CODEX_PROVIDER_ENTRY.defaultTiers).toBe(CODEX_DEFAULT_TIERS);
  });

  it('names only IDs present in the static list', () => {
    for (const modelId of Object.values(CODEX_DEFAULT_TIERS)) {
      expect(STATIC_IDS).toContain(modelId);
    }
  });
});

describe('Codex pricing seed', () => {
  it('is subscription-covered', () => {
    expect(isSubscriptionCoveredProvider('openai-codex')).toBe(true);
  });

  it('seeds nothing, so no Codex ID is published with maxTokens 0', () => {
    const beforeKeys = Object.keys(getPricingMap());

    seedStaticModelPricing('openai-codex');

    const afterMap = getPricingMap();
    expect(Object.keys(afterMap)).toEqual(beforeKeys);
    for (const id of STATIC_IDS) {
      expect(afterMap[id]).toBeUndefined();
      expect(afterMap[id.toLowerCase()]).toBeUndefined();
    }
  });
});
