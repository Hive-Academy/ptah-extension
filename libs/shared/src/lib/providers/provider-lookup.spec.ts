/**
 * Provider registry — the lookup accessors and the static-pricing seed.
 *
 * The sibling spec (`provider-registry.spec.ts`) covers the user-defined entry
 * merge layer. This one covers the read side that every surface goes through,
 * where the failure modes are quiet rather than loud:
 *
 *  - `getProviderBaseUrl` FALLS BACK rather than throwing, so a typo'd id
 *    silently sends traffic to the default provider's host. That fallback must
 *    be deliberate and pinned, not incidental.
 *  - `getProviderAuthEnvVar` defaults to `ANTHROPIC_AUTH_TOKEN`; a provider
 *    that needs a different variable and does not declare one gets its key
 *    exported under the wrong name and simply fails to authenticate.
 *  - `seedStaticModelPricing` writes into the global pricing map. A model with
 *    no declared rates must be SKIPPED, not seeded at zero, or a session on
 *    that model reads as free.
 */
import {
  ANTHROPIC_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  clearCustomProviderEntries,
  customEntryToAnthropicProvider,
  getAnthropicProvider,
  getProviderAuthEnvVar,
  getProviderBaseUrl,
  isSubscriptionCoveredProvider,
  seedStaticModelPricing,
  setCustomProviderEntries,
  CustomProviderEntrySchema,
  type AnthropicProvider,
} from './provider-registry';
import { getPricingMap } from '../utils/pricing.utils';

/**
 * The shipped registry, widened from its literal tuple type so the optional
 * `staticModels` field is visible. The runtime array is the same object.
 */
const PROVIDERS: readonly AnthropicProvider[] = ANTHROPIC_PROVIDERS;

/** A provider that ships static models WITH rates. */
const PRICED_PROVIDER = PROVIDERS.find((p) =>
  p.staticModels?.some((m) => m.inputCostPerToken != null),
);

/** A provider whose static models declare NO rates (local/self-hosted). */
const UNPRICED_PROVIDER = PROVIDERS.find(
  (p) =>
    p.staticModels !== undefined &&
    p.staticModels.length > 0 &&
    p.staticModels.every((m) => m.inputCostPerToken == null),
);

/** A provider that ships no static models at all. */
const NO_STATIC_PROVIDER = PROVIDERS.find((p) => p.staticModels === undefined);

describe('registry fixtures', () => {
  it('still contains the three shapes the seed logic branches on', () => {
    // If the shipped registry ever loses one of these, the assertions below
    // would silently stop testing the branch they were written for.
    expect(PRICED_PROVIDER).toBeDefined();
    expect(UNPRICED_PROVIDER).toBeDefined();
    expect(NO_STATIC_PROVIDER).toBeDefined();
  });
});

describe('getProviderBaseUrl', () => {
  afterEach(() => clearCustomProviderEntries());

  it('returns the declared base URL for a known provider', () => {
    const provider = PROVIDERS[0];
    expect(getProviderBaseUrl(provider.id)).toBe(provider.baseUrl);
  });

  it('falls back to the default provider for an unknown id', () => {
    const fallback = getAnthropicProvider(DEFAULT_PROVIDER_ID);
    expect(fallback).toBeDefined();
    expect(getProviderBaseUrl('no-such-provider')).toBe(fallback?.baseUrl);
  });

  it('resolves a user-defined provider rather than falling back', () => {
    setCustomProviderEntries([
      CustomProviderEntrySchema.parse({
        id: 'my-box',
        name: 'My Box',
        baseUrl: 'http://192.168.1.50:8000',
        lane: 'openai',
      }),
    ]);

    expect(getProviderBaseUrl('my-box')).toBe('http://192.168.1.50:8000');
  });
});

describe('getProviderAuthEnvVar', () => {
  it('returns the declared variable for every shipped provider', () => {
    for (const provider of PROVIDERS) {
      expect(getProviderAuthEnvVar(provider.id)).toBe(provider.authEnvVar);
    }
  });

  it('defaults to ANTHROPIC_AUTH_TOKEN for an unknown id', () => {
    expect(getProviderAuthEnvVar('no-such-provider')).toBe(
      'ANTHROPIC_AUTH_TOKEN',
    );
  });
});

describe('customEntryToAnthropicProvider', () => {
  it('renders a key placeholder from the declared prefix', () => {
    const provider = customEntryToAnthropicProvider(
      CustomProviderEntrySchema.parse({
        id: 'prefixed',
        name: 'Prefixed',
        baseUrl: 'https://api.example.com/v1',
        lane: 'openai',
        keyPrefix: 'sk-ex-',
      }),
    );

    expect(provider.keyPlaceholder).toBe('sk-ex-…');
  });

  it('falls back to a generic placeholder when no prefix is declared', () => {
    const provider = customEntryToAnthropicProvider(
      CustomProviderEntrySchema.parse({
        id: 'unprefixed',
        name: 'Unprefixed',
        baseUrl: 'https://api.example.com/v1',
        lane: 'anthropic',
      }),
    );

    expect(provider.keyPlaceholder).toBe('API key');
  });
});

describe('seedStaticModelPricing', () => {
  afterEach(() => clearCustomProviderEntries());

  it('publishes the declared rates for a usage-billed provider', () => {
    const provider = PRICED_PROVIDER;
    const model = provider?.staticModels?.find(
      (m) => m.inputCostPerToken != null && m.outputCostPerToken != null,
    );
    expect(model).toBeDefined();

    seedStaticModelPricing(provider?.id as string);

    const entry = getPricingMap()[model?.id as string];
    expect(entry).toBeDefined();
    expect(entry.inputCostPerToken).toBe(model?.inputCostPerToken);
    expect(entry.outputCostPerToken).toBe(model?.outputCostPerToken);
    expect(entry.provider).toBe(provider?.id);
    expect(entry.maxTokens).toBe(model?.contextLength);
  });

  it('skips models that declare no rates rather than seeding them at zero', () => {
    const provider = UNPRICED_PROVIDER;

    seedStaticModelPricing(provider?.id as string);

    const map = getPricingMap();
    for (const model of provider?.staticModels ?? []) {
      // A $0 entry here would make a session on this model report as free.
      expect(map[model.id]).toBeUndefined();
    }
  });

  it('is a no-op for a provider that ships no static models', () => {
    const before = { ...getPricingMap() };

    seedStaticModelPricing(NO_STATIC_PROVIDER?.id as string);

    expect(getPricingMap()).toEqual(before);
  });

  it('is a no-op for an unknown provider id', () => {
    const before = { ...getPricingMap() };

    seedStaticModelPricing('no-such-provider');

    expect(getPricingMap()).toEqual(before);
  });

  it('never seeds a subscription-billed provider', () => {
    const subscription = PROVIDERS.find((p) =>
      isSubscriptionCoveredProvider(p.id),
    );
    expect(subscription).toBeDefined();
    const before = { ...getPricingMap() };

    seedStaticModelPricing(subscription?.id as string);

    // Their static entries carry $0; publishing that under a bare model id
    // makes the next usage-billed session serving the same id read as free.
    expect(getPricingMap()).toEqual(before);
  });
});
