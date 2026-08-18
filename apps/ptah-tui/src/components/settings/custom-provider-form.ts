/**
 * The pure decision layer behind the TUI's "add custom provider" flow.
 *
 * Sibling of `provider-form.ts` and written for the same reason: everything
 * worth asserting about a form — which fields exist, what focus movement does,
 * what a set of typed strings turns into on the wire, what the card says about
 * where traffic goes — is logic, and logic inside an Ink component is logic
 * nobody can test. `CustomProviderForm.tsx` renders what this module decides
 * and owns nothing else.
 *
 * Two rules this module exists to enforce:
 *
 *   1. **The lane is never inferred.** `lane` decides whether the local
 *      OpenAI→Anthropic translation proxy runs. Guessing it from the URL shape
 *      produces an entry that saves cleanly and then fails at the first tool
 *      call, so the lane is an explicit two-value field with no default guess.
 *   2. **The API key never enters the entry.** `CustomProviderEntry` is the
 *      blob written to `~/.ptah/settings.json`; the key belongs to
 *      SecretStorage and travels as a separate `apiKey` RPC parameter. The
 *      builders below are the single place that split holds, so a spec can pin
 *      it.
 *
 * Validation delegates to `CustomProviderEntrySchema` — the same schema the
 * settings store and the RPC handler parse with — rather than restating the
 * rules, so the TUI can never accept a shape the backend would reject.
 */

import {
  CUSTOM_PROVIDER_LANES,
  CustomProviderEntrySchema,
} from '@ptah-extension/shared';
import type {
  CustomProviderEntry,
  CustomProviderLane,
} from '@ptah-extension/shared';

/** Creating a brand-new entry, or editing one that already exists. */
export type CustomProviderFormMode = 'create' | 'edit';

/** Every field is held as a string — the form is a terminal, not a type. */
export interface CustomProviderFormValues {
  id: string;
  name: string;
  baseUrl: string;
  lane: CustomProviderLane;
  apiKey: string;
  modelsEndpoint: string;
  tierSonnet: string;
  tierOpus: string;
  tierHaiku: string;
  inputPrice: string;
  outputPrice: string;
}

export type CustomProviderFieldId = keyof CustomProviderFormValues;

/**
 * How a field is edited.
 *
 * - `text`   — an `ink-text-input`
 * - `secret` — the same, masked
 * - `lane`   — a two-option radio driven by ←/→, NOT a text input
 */
export type CustomProviderFieldKind = 'text' | 'secret' | 'lane';

export interface CustomProviderFormField {
  readonly id: CustomProviderFieldId;
  readonly label: string;
  readonly kind: CustomProviderFieldKind;
  readonly required: boolean;
  readonly placeholder: string;
  /** Shown under the field while it holds focus. */
  readonly hint?: string;
}

/**
 * Field order is the tab order. Required fields come first so an impatient
 * user can fill the top four and hit Save.
 */
export const CUSTOM_PROVIDER_FIELDS: readonly CustomProviderFormField[] = [
  {
    id: 'id',
    label: 'Id',
    kind: 'text',
    required: true,
    placeholder: 'my-gateway',
    hint: 'Lower-case letters, digits and dashes. Blank derives one from the name.',
  },
  {
    id: 'name',
    label: 'Name',
    kind: 'text',
    required: true,
    placeholder: 'My Gateway',
  },
  {
    id: 'baseUrl',
    label: 'Base URL',
    kind: 'text',
    required: true,
    placeholder: 'https://gateway.example.com',
    hint: 'http:// or https://. LAN and localhost gateways are fine.',
  },
  {
    id: 'lane',
    label: 'Lane',
    kind: 'lane',
    required: true,
    placeholder: '',
    hint: '←/→ to switch. anthropic = passthrough, openai = local translation proxy.',
  },
  {
    id: 'apiKey',
    label: 'API key',
    kind: 'secret',
    required: false,
    placeholder: 'Paste API key…',
    hint: 'Stored in secret storage, never in settings.json. Blank keeps the existing key.',
  },
  {
    id: 'modelsEndpoint',
    label: 'Models endpoint',
    kind: 'text',
    required: false,
    placeholder: 'optional — https://…/v1/models',
  },
  {
    id: 'tierSonnet',
    label: 'Tier · sonnet',
    kind: 'text',
    required: false,
    placeholder: 'optional — model id',
    hint: 'All three tiers or none.',
  },
  {
    id: 'tierOpus',
    label: 'Tier · opus',
    kind: 'text',
    required: false,
    placeholder: 'optional — model id',
  },
  {
    id: 'tierHaiku',
    label: 'Tier · haiku',
    kind: 'text',
    required: false,
    placeholder: 'optional — model id',
  },
  {
    id: 'inputPrice',
    label: 'Input $/1M',
    kind: 'text',
    required: false,
    placeholder: 'optional',
    hint: 'Both prices or neither. Left blank, this entry reports cost unavailable.',
  },
  {
    id: 'outputPrice',
    label: 'Output $/1M',
    kind: 'text',
    required: false,
    placeholder: 'optional',
  },
];

/** The buttons under the fields, in focus order. */
export type CustomProviderFormAction = 'save' | 'test' | 'delete' | 'cancel';

/**
 * `test` and `delete` need a persisted entry to act on, so they only exist in
 * edit mode. Save in create mode already probes the endpoint after storing it.
 */
export function customProviderFormActions(
  mode: CustomProviderFormMode,
): readonly CustomProviderFormAction[] {
  return mode === 'edit'
    ? ['save', 'test', 'delete', 'cancel']
    : ['save', 'cancel'];
}

/** Label shown on each action button. */
export function customProviderActionLabel(
  action: CustomProviderFormAction,
): string {
  switch (action) {
    case 'save':
      return 'Save & Test';
    case 'test':
      return 'Test connection';
    case 'delete':
      return 'Delete';
    case 'cancel':
      return 'Cancel';
  }
}

/** Total focus slots: every field, then every action. */
export function customProviderSlotCount(mode: CustomProviderFormMode): number {
  return CUSTOM_PROVIDER_FIELDS.length + customProviderFormActions(mode).length;
}

/** What the focused slot is — a field to type into, or a button to press. */
export type CustomProviderSlot =
  | { readonly kind: 'field'; readonly field: CustomProviderFormField }
  | { readonly kind: 'action'; readonly action: CustomProviderFormAction };

export function customProviderSlotAt(
  mode: CustomProviderFormMode,
  index: number,
): CustomProviderSlot {
  const fields = CUSTOM_PROVIDER_FIELDS;
  const clamped = clampSlot(mode, index);
  const field = fields[clamped];
  if (field) return { kind: 'field', field };
  const actions = customProviderFormActions(mode);
  const action = actions[clamped - fields.length] ?? 'cancel';
  return { kind: 'action', action };
}

/**
 * Focus movement clamps rather than wraps.
 *
 * Wrapping would send ↓ from the last button back into the id field, which in
 * a form (unlike a menu) reads as the screen jumping.
 */
export function moveCustomProviderFocus(
  mode: CustomProviderFormMode,
  current: number,
  delta: number,
): number {
  return clampSlot(mode, current + delta);
}

function clampSlot(mode: CustomProviderFormMode, index: number): number {
  const max = customProviderSlotCount(mode) - 1;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(index)));
}

/** ←/→ on the lane field. Two values, so either direction toggles. */
export function toggleLane(lane: CustomProviderLane): CustomProviderLane {
  return lane === 'anthropic' ? 'openai' : 'anthropic';
}

/** A blank create-mode form. `anthropic` is the shown default, not a guess. */
export function emptyCustomProviderForm(): CustomProviderFormValues {
  return {
    id: '',
    name: '',
    baseUrl: '',
    lane: 'anthropic',
    apiKey: '',
    modelsEndpoint: '',
    tierSonnet: '',
    tierOpus: '',
    tierHaiku: '',
    inputPrice: '',
    outputPrice: '',
  };
}

/**
 * Pre-fill the edit form from a stored entry.
 *
 * `apiKey` is deliberately blank: the stored key is never read back to any
 * surface, and blank means "leave the stored key alone" on save.
 */
export function customProviderFormFromEntry(
  entry: CustomProviderEntry,
): CustomProviderFormValues {
  return {
    id: entry.id,
    name: entry.name,
    baseUrl: entry.baseUrl,
    lane: entry.lane,
    apiKey: '',
    modelsEndpoint: entry.modelsEndpoint ?? '',
    tierSonnet: entry.defaultTiers?.sonnet ?? '',
    tierOpus: entry.defaultTiers?.opus ?? '',
    tierHaiku: entry.defaultTiers?.haiku ?? '',
    inputPrice:
      entry.pricing?.inputPerMillion !== undefined
        ? String(entry.pricing.inputPerMillion)
        : '',
    outputPrice:
      entry.pricing?.outputPerMillion !== undefined
        ? String(entry.pricing.outputPerMillion)
        : '',
  };
}

/**
 * Derive a settings-safe id from a display name.
 *
 * Used only to fill an id the user left blank — the id is still an editable
 * field, because it is what every settings key for this provider is built from
 * and a silent auto-id is not something to discover later.
 */
export function slugifyProviderId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface CustomProviderFormError {
  /** Absent when the problem spans fields (a half-filled tier map). */
  readonly field?: CustomProviderFieldId;
  readonly message: string;
}

export type CustomProviderFormValidation =
  | {
      readonly ok: true;
      readonly entry: CustomProviderEntry;
      /** Present only when the user typed a key on this pass. */
      readonly apiKey?: string;
    }
  | { readonly ok: false; readonly errors: readonly CustomProviderFormError[] };

function trimmed(value: string): string {
  return value.trim();
}

/**
 * Turn the typed strings into a validated entry, or into per-field errors.
 *
 * Cross-field rules (all-or-none tiers, both-or-neither prices) are checked
 * here because the schema cannot express them; everything else is deferred to
 * `CustomProviderEntrySchema` so there is one definition of a legal entry.
 */
export function validateCustomProviderForm(
  values: CustomProviderFormValues,
): CustomProviderFormValidation {
  const errors: CustomProviderFormError[] = [];

  const name = trimmed(values.name);
  const id = trimmed(values.id) || slugifyProviderId(name);
  const baseUrl = trimmed(values.baseUrl);

  if (!name)
    errors.push({ field: 'name', message: 'A display name is required' });
  if (!baseUrl) {
    errors.push({ field: 'baseUrl', message: 'A base URL is required' });
  }
  if (!CUSTOM_PROVIDER_LANES.includes(values.lane)) {
    errors.push({ field: 'lane', message: 'Pick a lane' });
  }

  const tiers = [values.tierSonnet, values.tierOpus, values.tierHaiku].map(
    trimmed,
  );
  const filledTiers = tiers.filter((tier) => tier.length > 0).length;
  if (filledTiers > 0 && filledTiers < 3) {
    errors.push({
      field: 'tierSonnet',
      message: 'Map all three tiers or leave all three blank',
    });
  }

  const inputPrice = trimmed(values.inputPrice);
  const outputPrice = trimmed(values.outputPrice);
  let pricing:
    | { inputPerMillion: number; outputPerMillion: number }
    | undefined;
  if (inputPrice || outputPrice) {
    if (!inputPrice || !outputPrice) {
      errors.push({
        field: 'inputPrice',
        message: 'Enter both prices or neither',
      });
    } else {
      const input = Number(inputPrice);
      const output = Number(outputPrice);
      if (!Number.isFinite(input) || input < 0) {
        errors.push({
          field: 'inputPrice',
          message: 'Price must be a non-negative number',
        });
      } else if (!Number.isFinite(output) || output < 0) {
        errors.push({
          field: 'outputPrice',
          message: 'Price must be a non-negative number',
        });
      } else {
        pricing = { inputPerMillion: input, outputPerMillion: output };
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const modelsEndpoint = trimmed(values.modelsEndpoint);
  const parsed = CustomProviderEntrySchema.safeParse({
    id,
    name,
    baseUrl,
    lane: values.lane,
    ...(modelsEndpoint ? { modelsEndpoint } : {}),
    ...(filledTiers === 3
      ? {
          defaultTiers: {
            sonnet: tiers[0] ?? '',
            opus: tiers[1] ?? '',
            haiku: tiers[2] ?? '',
          },
        }
      : {}),
    ...(pricing ? { pricing } : {}),
  });

  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        const field = issue.path[0];
        return {
          ...(isFieldId(field) ? { field } : {}),
          message: issue.message,
        };
      }),
    };
  }

  const apiKey = trimmed(values.apiKey);
  return { ok: true, entry: parsed.data, ...(apiKey ? { apiKey } : {}) };
}

function isFieldId(value: unknown): value is CustomProviderFieldId {
  return (
    typeof value === 'string' &&
    CUSTOM_PROVIDER_FIELDS.some((field) => field.id === value)
  );
}

/** `provider:addCustomEntry` params. The key stays OUT of the entry. */
export function buildAddCustomEntryParams(
  entry: CustomProviderEntry,
  apiKey?: string,
): { entry: CustomProviderEntry; apiKey?: string } {
  return { entry, ...(apiKey ? { apiKey } : {}) };
}

/**
 * `provider:updateCustomEntry` params.
 *
 * The edit form holds every field, so `changes` is the whole entry minus the
 * id — there is no partial-patch ambiguity to resolve. A blank key field means
 * "keep the stored key", so `apiKey` is omitted rather than sent empty.
 */
export function buildUpdateCustomEntryParams(
  entry: CustomProviderEntry,
  apiKey?: string,
): {
  id: string;
  changes: Omit<CustomProviderEntry, 'id'>;
  apiKey?: string;
} {
  const { id, ...changes } = entry;
  return { id, changes, ...(apiKey ? { apiKey } : {}) };
}

/**
 * The per-entry security line.
 *
 * The 8 built-in tiles keep the unconditional "no proxies, no Ptah servers"
 * copy — every one of those base URLs ships in Ptah's own source, so the claim
 * is verifiable. A user-typed endpoint is not, so its card names the host
 * instead of making a promise about it.
 */
export function customProviderSecurityNote(baseUrl: string): string {
  let host = baseUrl.trim();
  try {
    host = new URL(baseUrl).host || host;
  } catch {
    // Unparseable while the user is still typing — show what they typed.
  }
  return `Requests go directly from this machine to ${host} — Ptah does not operate, vet, or log traffic through this endpoint.`;
}

/**
 * Cost display for a custom entry. There is no standard for how a `/v1/models`
 * response encodes pricing, so an entry without manual rates says so rather
 * than guessing or showing a zero.
 */
export function formatCustomProviderPricing(
  entry: Pick<CustomProviderEntry, 'pricing'>,
): string {
  const pricing = entry.pricing;
  if (!pricing) return 'Cost unavailable';
  return `$${pricing.inputPerMillion} in / $${pricing.outputPerMillion} out per 1M tokens`;
}
