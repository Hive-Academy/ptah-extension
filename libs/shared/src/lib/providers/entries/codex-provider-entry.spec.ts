/**
 * Codex Provider Entry Specs
 *
 * The Codex static list is IDs-only fallback metadata. Pins:
 * 1. `gpt-5.4` stays first (`staticModels[0]` is the default-model fallback).
 * 2. `gpt-6-astra` and `gpt-5.6-sol` are appended after the original six.
 * 3. Every `contextLength` is 0 (unknown); windows come only from the live catalog.
 * 4. `CODEX_DEFAULT_TIERS` names current, listed IDs.
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
  it('matches the listed live catalog in menu order, first model as the default fallback', () => {
    // `codex debug models`, visibility "list", 2026-10-07. The gpt-5.x-codex IDs
    // it replaced are rejected for ChatGPT accounts.
    expect(STATIC_IDS).toEqual([
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
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
  it('maps each tier to a current model', () => {
    expect(CODEX_DEFAULT_TIERS).toEqual({
      sonnet: 'gpt-6-sol',
      opus: 'gpt-6.1-sol',
      haiku: 'gpt-6-luna',
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
