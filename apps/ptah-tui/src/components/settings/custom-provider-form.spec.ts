/**
 * Custom-provider form — specs.
 *
 * Two things are pinned here that a rendering test could not reach:
 *
 *   1. The key/metadata split. `CustomProviderEntry` is what gets written to
 *      `~/.ptah/settings.json`; the API key belongs to SecretStorage. Every
 *      assertion below that looks for a key inside `entry` is guarding that
 *      boundary, because a leak there is a plaintext credential on disk.
 *   2. The lane is carried, never derived. A URL-shaped guess would save fine
 *      and then fail at the first tool call.
 *
 * The existing tile classifier is also re-checked against a custom entry, since
 * the whole feature assumes `resolveProviderFormKind` already routes one to the
 * api-key form without modification.
 */

import { customEntryToAnthropicProvider } from '@ptah-extension/shared';
import type { CustomProviderEntry } from '@ptah-extension/shared';

import { resolveProviderFormKind } from './provider-form.js';
import {
  CUSTOM_PROVIDER_FIELDS,
  buildAddCustomEntryParams,
  buildUpdateCustomEntryParams,
  customProviderActionLabel,
  customProviderFormActions,
  customProviderFormFromEntry,
  customProviderSecurityNote,
  customProviderSlotAt,
  customProviderSlotCount,
  emptyCustomProviderForm,
  formatCustomProviderPricing,
  moveCustomProviderFocus,
  slugifyProviderId,
  toggleLane,
  validateCustomProviderForm,
  type CustomProviderFormValues,
} from './custom-provider-form.js';

function filledForm(
  overrides: Partial<CustomProviderFormValues> = {},
): CustomProviderFormValues {
  return {
    ...emptyCustomProviderForm(),
    id: 'my-gateway',
    name: 'My Gateway',
    baseUrl: 'https://gateway.example.com',
    lane: 'openai',
    ...overrides,
  };
}

const storedEntry: CustomProviderEntry = {
  id: 'my-gateway',
  name: 'My Gateway',
  baseUrl: 'https://gateway.example.com',
  lane: 'openai',
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
  keyPrefix: '',
  helpUrl: '',
  modelsEndpoint: 'https://gateway.example.com/v1/models',
  defaultTiers: { sonnet: 'gw/medium', opus: 'gw/large', haiku: 'gw/small' },
  pricing: { inputPerMillion: 1.5, outputPerMillion: 7 },
};

describe('field model', () => {
  it('makes the lane its own radio field, not free text', () => {
    const lane = CUSTOM_PROVIDER_FIELDS.find((field) => field.id === 'lane');
    expect(lane?.kind).toBe('lane');
    expect(lane?.required).toBe(true);
  });

  it('masks the API key field and never marks it required', () => {
    const key = CUSTOM_PROVIDER_FIELDS.find((field) => field.id === 'apiKey');
    expect(key?.kind).toBe('secret');
    // Local gateways legitimately need no key at all.
    expect(key?.required).toBe(false);
  });

  it('requires exactly id, name, base URL and lane', () => {
    expect(
      CUSTOM_PROVIDER_FIELDS.filter((field) => field.required).map((f) => f.id),
    ).toEqual(['id', 'name', 'baseUrl', 'lane']);
  });
});

describe('actions', () => {
  it('offers only save and cancel before an entry exists', () => {
    expect(customProviderFormActions('create')).toEqual(['save', 'cancel']);
  });

  it('adds test and delete once the entry is stored', () => {
    expect(customProviderFormActions('edit')).toEqual([
      'save',
      'test',
      'delete',
      'cancel',
    ]);
  });

  it('labels save as Save & Test — saving always probes', () => {
    expect(customProviderActionLabel('save')).toBe('Save & Test');
  });
});

describe('focus movement', () => {
  it('clamps instead of wrapping at both ends', () => {
    expect(moveCustomProviderFocus('create', 0, -1)).toBe(0);
    const last = customProviderSlotCount('create') - 1;
    expect(moveCustomProviderFocus('create', last, 1)).toBe(last);
  });

  it('walks fields first, then the action buttons', () => {
    expect(customProviderSlotAt('edit', 0)).toEqual({
      kind: 'field',
      field: CUSTOM_PROVIDER_FIELDS[0],
    });
    const firstAction = customProviderSlotAt(
      'edit',
      CUSTOM_PROVIDER_FIELDS.length,
    );
    expect(firstAction).toEqual({ kind: 'action', action: 'save' });
  });

  it('toggles the lane in either direction', () => {
    expect(toggleLane('anthropic')).toBe('openai');
    expect(toggleLane(toggleLane('anthropic'))).toBe('anthropic');
  });
});

describe('slugifyProviderId', () => {
  it.each([
    ['My Gateway', 'my-gateway'],
    ['LiteLLM  Proxy!', 'litellm-proxy'],
    ['---weird---', 'weird'],
  ])('%s → %s', (input, expected) => {
    expect(slugifyProviderId(input)).toBe(expected);
  });
});

describe('validateCustomProviderForm', () => {
  it('keeps the API key out of the persisted entry', () => {
    const result = validateCustomProviderForm(
      filledForm({ apiKey: 'sk-super-secret' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apiKey).toBe('sk-super-secret');
    expect(JSON.stringify(result.entry)).not.toContain('sk-super-secret');
  });

  it('carries the lane verbatim rather than deriving it from the URL', () => {
    const result = validateCustomProviderForm(
      // An `api.anthropic.com`-shaped URL on the OpenAI lane: a URL sniffer
      // would get this wrong, which is exactly why there is no sniffer.
      filledForm({ baseUrl: 'https://api.anthropic.com', lane: 'openai' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.lane).toBe('openai');
  });

  it('omits apiKey entirely when the field is blank (edit keeps the stored key)', () => {
    const result = validateCustomProviderForm(filledForm({ apiKey: '   ' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.apiKey).toBeUndefined();
  });

  it('derives the id from the name when the id field is left blank', () => {
    const result = validateCustomProviderForm(
      filledForm({ id: '', name: 'My Gateway' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.id).toBe('my-gateway');
  });

  it('rejects an id the settings-key patterns could not round-trip', () => {
    const result = validateCustomProviderForm(filledForm({ id: 'My Gateway' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.field === 'id')).toBe(true);
  });

  it.each([
    ['name', filledForm({ name: '' })],
    ['baseUrl', filledForm({ baseUrl: '' })],
  ])('reports a missing %s against that field', (field, values) => {
    const result = validateCustomProviderForm(values);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.field === field)).toBe(true);
  });

  it('rejects a non-http scheme through the shared entry schema', () => {
    const result = validateCustomProviderForm(
      filledForm({ baseUrl: 'ftp://gateway.example.com' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.field === 'baseUrl')).toBe(true);
  });

  it('accepts a plain-http LAN gateway — loopback is not required', () => {
    const result = validateCustomProviderForm(
      filledForm({ baseUrl: 'http://192.168.1.40:4000' }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a half-filled tier map', () => {
    const result = validateCustomProviderForm(
      filledForm({ tierSonnet: 'gw/medium' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('all three tiers');
  });

  it('accepts a complete tier map', () => {
    const result = validateCustomProviderForm(
      filledForm({
        tierSonnet: 'gw/medium',
        tierOpus: 'gw/large',
        tierHaiku: 'gw/small',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.defaultTiers).toEqual({
      sonnet: 'gw/medium',
      opus: 'gw/large',
      haiku: 'gw/small',
    });
  });

  it.each([
    ['only one price', filledForm({ inputPrice: '1.5' })],
    ['a non-numeric price', filledForm({ inputPrice: 'x', outputPrice: '7' })],
    ['a negative price', filledForm({ inputPrice: '-1', outputPrice: '7' })],
  ])('rejects %s', (_label, values) => {
    expect(validateCustomProviderForm(values).ok).toBe(false);
  });

  it('accepts a complete manual price pair', () => {
    const result = validateCustomProviderForm(
      filledForm({ inputPrice: '1.5', outputPrice: '7' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.pricing).toEqual({
      inputPerMillion: 1.5,
      outputPerMillion: 7,
    });
  });

  it('leaves pricing absent when both fields are blank', () => {
    const result = validateCustomProviderForm(filledForm());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.pricing).toBeUndefined();
  });
});

describe('RPC payload builders', () => {
  it('sends the key beside the entry, never inside it', () => {
    const params = buildAddCustomEntryParams(storedEntry, 'sk-secret');
    expect(params.apiKey).toBe('sk-secret');
    expect(params.entry).not.toHaveProperty('apiKey');
  });

  it('omits apiKey when there is none to send', () => {
    expect(buildAddCustomEntryParams(storedEntry)).not.toHaveProperty('apiKey');
  });

  it('splits the id out of the update changes', () => {
    const params = buildUpdateCustomEntryParams(storedEntry);
    expect(params.id).toBe('my-gateway');
    expect(params.changes).not.toHaveProperty('id');
    expect(params.changes.lane).toBe('openai');
  });
});

describe('customProviderFormFromEntry', () => {
  it('pre-fills every stored field', () => {
    const values = customProviderFormFromEntry(storedEntry);
    expect(values.id).toBe('my-gateway');
    expect(values.lane).toBe('openai');
    expect(values.modelsEndpoint).toBe('https://gateway.example.com/v1/models');
    expect(values.tierOpus).toBe('gw/large');
    expect(values.inputPrice).toBe('1.5');
  });

  it('leaves the key blank — a stored key is never read back to a surface', () => {
    expect(customProviderFormFromEntry(storedEntry).apiKey).toBe('');
  });

  it('round-trips through validation unchanged', () => {
    const result = validateCustomProviderForm(
      customProviderFormFromEntry(storedEntry),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toEqual(storedEntry);
  });
});

describe('security copy', () => {
  /**
   * The 8 built-in tiles keep the unconditional "no proxies, no Ptah servers"
   * line because those base URLs ship in Ptah's own source. A user-typed host
   * cannot carry that claim, so the custom card names the host instead.
   */
  it('names the host the user typed and makes no promise about it', () => {
    const note = customProviderSecurityNote('https://gateway.example.com/v1');
    expect(note).toContain('gateway.example.com');
    expect(note).toContain('Ptah does not operate, vet, or log');
  });

  it('shows the raw text while the URL is still half-typed', () => {
    expect(customProviderSecurityNote('gateway.exa')).toContain('gateway.exa');
  });
});

describe('formatCustomProviderPricing', () => {
  it('says cost is unavailable rather than showing a zero', () => {
    expect(formatCustomProviderPricing({ pricing: null })).toBe(
      'Cost unavailable',
    );
    expect(formatCustomProviderPricing({})).toBe('Cost unavailable');
  });

  it('shows manual rates when the user supplied them', () => {
    expect(formatCustomProviderPricing(storedEntry)).toContain('$1.5 in');
  });
});

describe('resolveProviderFormKind against a custom entry', () => {
  /**
   * The whole TUI plan rests on this: a custom entry projected onto the
   * `AnthropicProvider` shape already classifies as the api-key form, so the
   * classifier needed no change for this feature. If this fails,
   * `provider-form.ts` does need one.
   */
  it('routes a custom entry to the api-key form with no classifier change', () => {
    const projected = customEntryToAnthropicProvider(storedEntry);
    expect(projected.authType).toBe('apiKey');
    expect(resolveProviderFormKind(projected.id, projected)).toBe('api-key');
  });

  it('routes an anthropic-lane custom entry the same way', () => {
    const projected = customEntryToAnthropicProvider({
      ...storedEntry,
      id: 'requesty-clone',
      lane: 'anthropic',
    });
    expect(resolveProviderFormKind(projected.id, projected)).toBe('api-key');
    expect(projected.requiresProxy).toBe(false);
  });
});
