import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Loader2,
  Trash2,
  X,
  AlertTriangle,
} from 'lucide-angular';
import { AuthStateService } from '@ptah-extension/core';
import {
  validateProviderBaseUrl,
  type CustomProviderEntry,
  type CustomProviderEntryInput,
  type CustomProviderLane,
} from '@ptah-extension/shared';

/** A validated draft ready to send, or the reasons it is not sendable yet. */
type DraftValidation =
  | { readonly ok: true; readonly entry: CustomProviderEntryInput }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Turn a display name into a registry-safe id.
 *
 * The id must satisfy `CUSTOM_PROVIDER_ID_PATTERN` (`/^[a-z0-9][a-z0-9-]*$/`)
 * because the backend re-validates it and a rejected entry is a dead end for
 * the user — they typed a name, not an id, and cannot see why it failed.
 */
function slugifyProviderName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'provider';
}

/**
 * CustomProviderFormComponent — add / edit / delete a user-defined provider.
 *
 * Complexity Level: 3. It carries genuinely complex form state (eleven fields,
 * three conditional field groups, cross-field validation) over an async CRUD
 * surface, which is what justifies a dedicated component instead of another
 * branch inside `AuthConfigComponent`.
 *
 * SOLID:
 * - Single Responsibility: collect + validate one custom entry. All persistence
 *   is delegated to `AuthStateService`; this component owns no RPC calls.
 * - Dependency Inversion: depends on the `AuthStateService` abstraction only.
 *
 * Security: the API key is a write-only field. It is sent once, through the
 * `apiKey` parameter, and stored in SecretStorage backend-side. It is never
 * part of the entry, never read back, and never logged.
 */
@Component({
  selector: 'ptah-custom-provider-form',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './custom-provider-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomProviderFormComponent {
  private readonly authState = inject(AuthStateService);

  readonly Loader2Icon = Loader2;
  readonly Trash2Icon = Trash2;
  readonly XIcon = X;
  readonly AlertTriangleIcon = AlertTriangle;

  /** Entry being edited, or null to create a new one. */
  readonly entry = input<CustomProviderEntry | null>(null);

  /** Emitted after a successful create or update, with the stored entry. */
  readonly saved = output<CustomProviderEntry>();

  /** Emitted after a successful delete, with the removed entry's id. */
  readonly deleted = output<string>();

  /** Emitted when the user dismisses the form without saving. */
  readonly cancelled = output<void>();

  /**
   * The entry this form is bound to once it exists backend-side.
   *
   * Set on a successful create so the form flips from "new" to "editing the
   * thing I just made" — which is what makes "Test connection" (an id-keyed
   * RPC) reachable without closing and reopening the panel.
   */
  private readonly persistedEntry = signal<CustomProviderEntry | null>(null);

  /** The entry backing this form: the freshly created one, else the input. */
  readonly currentEntry = computed<CustomProviderEntry | null>(
    () => this.persistedEntry() ?? this.entry(),
  );

  /** Whether this form edits an already-stored entry. */
  readonly isEditing = computed(() => this.currentEntry() !== null);

  readonly name = signal('');
  readonly baseUrl = signal('');
  readonly lane = signal<CustomProviderLane>('openai');
  readonly apiKey = signal('');
  readonly modelsEndpoint = signal('');
  readonly helpUrl = signal('');
  readonly tierSonnet = signal('');
  readonly tierOpus = signal('');
  readonly tierHaiku = signal('');
  readonly priceInput = signal('');
  readonly priceOutput = signal('');

  /** Whether the user has attempted a save — gates error display. */
  readonly submitted = signal(false);

  /** Whether a save/delete is in flight (separate from the probe). */
  readonly isSaving = signal(false);

  /** Confirmation gate for the destructive delete action. */
  readonly confirmingDelete = signal(false);

  /** Backend rejection text from the last mutation, surfaced verbatim. */
  readonly backendError = this.authState.customEntryError;

  /** Result of the last "Test connection" probe. */
  readonly testState = this.authState.customTestState;

  /** Whether the probe for THIS entry is currently running. */
  readonly isTesting = computed(() => {
    const id = this.currentEntry()?.id;
    return id !== undefined && this.authState.customTestingId() === id;
  });

  /** Probe result, but only when it belongs to the entry on screen. */
  readonly ownTestState = computed(() => {
    const id = this.currentEntry()?.id;
    const state = this.testState();
    return state !== null && state.id === id ? state : null;
  });

  /**
   * Host of the typed base URL, for the security copy. Null while the URL is
   * still unparseable, so the copy never names a half-typed host.
   */
  readonly typedHost = computed<string | null>(() => {
    const validation = validateProviderBaseUrl(this.baseUrl());
    return validation.ok ? validation.url.host : null;
  });

  /**
   * Ids already taken — every custom entry plus every built-in provider, since
   * `setCustomProviderEntries` rejects an entry that shadows a built-in.
   */
  private readonly takenIds = computed(() => {
    const ids = new Set<string>(
      this.authState.availableProviders().map((provider) => provider.id),
    );
    for (const existing of this.authState.customEntries()) {
      ids.add(existing.id);
    }
    ids.add('anthropic');
    ids.add('claude');
    return ids;
  });

  /** Display names already taken, lower-cased for a case-insensitive compare. */
  private readonly takenNames = computed(() => {
    const currentId = this.currentEntry()?.id;
    const names = new Set<string>();
    for (const provider of this.authState.availableProviders()) {
      if (provider.id === currentId) continue;
      names.add(provider.name.trim().toLowerCase());
    }
    for (const existing of this.authState.customEntries()) {
      if (existing.id === currentId) continue;
      names.add(existing.name.trim().toLowerCase());
    }
    return names;
  });

  /**
   * The id this draft will be stored under. Stable once the entry exists —
   * renaming an entry must not move its SecretStorage slot.
   */
  readonly draftId = computed(() => {
    const existing = this.currentEntry();
    if (existing) return existing.id;

    const base = slugifyProviderName(this.name());
    const taken = this.takenIds();
    if (!taken.has(base)) return base;
    for (let suffix = 2; suffix < 100; suffix++) {
      const candidate = `${base}-${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  });

  /**
   * Cross-field validation.
   *
   * Client-side only — the backend re-validates everything and its rejection is
   * still rendered. This exists to catch the two mistakes that would otherwise
   * cost a round-trip: an unparseable base URL and a duplicate name.
   */
  readonly validation = computed<DraftValidation>(() => {
    const errors: string[] = [];

    const name = this.name().trim();
    if (name.length === 0) {
      errors.push('Display name is required.');
    } else if (this.takenNames().has(name.toLowerCase())) {
      errors.push(`A provider named "${name}" already exists.`);
    }

    const urlCheck = validateProviderBaseUrl(this.baseUrl());
    if (!urlCheck.ok) {
      errors.push(
        `Base URL must be a complete http:// or https:// address (${urlCheck.error}).`,
      );
    }

    const modelsEndpoint = this.modelsEndpoint().trim();
    if (
      modelsEndpoint.length > 0 &&
      !validateProviderBaseUrl(modelsEndpoint).ok
    ) {
      errors.push('Models endpoint must be an http:// or https:// URL.');
    }

    const helpUrl = this.helpUrl().trim();
    if (helpUrl.length > 0 && !validateProviderBaseUrl(helpUrl).ok) {
      errors.push('Help URL must be an http:// or https:// URL.');
    }

    const sonnet = this.tierSonnet().trim();
    const opus = this.tierOpus().trim();
    const haiku = this.tierHaiku().trim();
    const filledTiers = [sonnet, opus, haiku].filter(
      (tier) => tier.length > 0,
    ).length;
    if (filledTiers > 0 && filledTiers < 3) {
      errors.push(
        'Model mapping needs all three tiers (sonnet, opus, haiku) or none.',
      );
    }

    const pricing = this.parsePricing();
    if (pricing === 'invalid') {
      errors.push(
        'Pricing needs both an input and an output rate, each a number of 0 or more.',
      );
    }

    const id = this.draftId();
    if (!this.isEditing() && this.takenIds().has(id)) {
      errors.push(`Provider id "${id}" is already in use.`);
    }

    if (errors.length > 0 || !urlCheck.ok || pricing === 'invalid') {
      return { ok: false, errors };
    }

    const existing = this.currentEntry();
    return {
      ok: true,
      entry: {
        id,
        name,
        baseUrl: urlCheck.normalized,
        lane: this.lane(),
        authEnvVar: existing?.authEnvVar ?? 'ANTHROPIC_AUTH_TOKEN',
        keyPrefix: existing?.keyPrefix ?? '',
        helpUrl,
        modelsEndpoint: modelsEndpoint.length > 0 ? modelsEndpoint : null,
        defaultTiers: filledTiers === 3 ? { sonnet, opus, haiku } : null,
        pricing,
      },
    };
  });

  /** Errors to display — suppressed until the first save attempt. */
  readonly visibleErrors = computed<readonly string[]>(() => {
    if (!this.submitted()) return [];
    const result = this.validation();
    return result.ok ? [] : result.errors;
  });

  /** Whether the save button is enabled. */
  readonly canSave = computed(
    () => this.validation().ok && !this.isSaving() && !this.isTesting(),
  );

  /**
   * Whether the entered pricing will leave cost display unavailable. Drives the
   * honest "cost unavailable" hint rather than letting the user assume $0.
   */
  readonly pricingOmitted = computed(() => this.parsePricing() === null);

  constructor() {
    // Re-seed the fields whenever the bound entry changes (including the
    // null → entry transition when the user clicks Edit on a different tile).
    effect(() => {
      const bound = this.entry();
      this.persistedEntry.set(null);
      this.seedFrom(bound);
    });
  }

  /** Populate the form fields from a stored entry, or reset them for a new one. */
  private seedFrom(source: CustomProviderEntry | null): void {
    this.submitted.set(false);
    this.confirmingDelete.set(false);
    this.apiKey.set('');
    this.name.set(source?.name ?? '');
    this.baseUrl.set(source?.baseUrl ?? '');
    this.lane.set(source?.lane ?? 'openai');
    this.modelsEndpoint.set(source?.modelsEndpoint ?? '');
    this.helpUrl.set(source?.helpUrl ?? '');
    this.tierSonnet.set(source?.defaultTiers?.sonnet ?? '');
    this.tierOpus.set(source?.defaultTiers?.opus ?? '');
    this.tierHaiku.set(source?.defaultTiers?.haiku ?? '');
    this.priceInput.set(
      source?.pricing ? String(source.pricing.inputPerMillion) : '',
    );
    this.priceOutput.set(
      source?.pricing ? String(source.pricing.outputPerMillion) : '',
    );
  }

  /**
   * Parse the optional price pair.
   *
   * @returns the pair when both are valid, `null` when both are blank (the
   *   "cost unavailable" case), and `'invalid'` when the input is partial or
   *   not a non-negative number.
   */
  private parsePricing():
    | { inputPerMillion: number; outputPerMillion: number }
    | null
    | 'invalid' {
    const rawIn = this.priceInput().trim();
    const rawOut = this.priceOutput().trim();
    if (rawIn.length === 0 && rawOut.length === 0) return null;
    if (rawIn.length === 0 || rawOut.length === 0) return 'invalid';

    const inputPerMillion = Number(rawIn);
    const outputPerMillion = Number(rawOut);
    const valid =
      Number.isFinite(inputPerMillion) &&
      inputPerMillion >= 0 &&
      Number.isFinite(outputPerMillion) &&
      outputPerMillion >= 0;
    return valid ? { inputPerMillion, outputPerMillion } : 'invalid';
  }

  /** Set the compatibility lane from the radio group. */
  selectLane(lane: CustomProviderLane): void {
    this.lane.set(lane);
  }

  /**
   * Create or update the entry.
   *
   * A backend rejection leaves the form open with the reason showing — success
   * is never assumed from the absence of a thrown error.
   */
  async save(): Promise<void> {
    this.submitted.set(true);
    const result = this.validation();
    if (!result.ok || this.isSaving()) return;

    this.authState.clearCustomEntryError();
    this.isSaving.set(true);
    try {
      const key = this.apiKey().trim();
      const existing = this.currentEntry();
      const outcome = existing
        ? await this.authState.updateCustomEntry(
            existing.id,
            {
              name: result.entry.name,
              baseUrl: result.entry.baseUrl,
              lane: result.entry.lane,
              helpUrl: result.entry.helpUrl,
              modelsEndpoint: result.entry.modelsEndpoint,
              defaultTiers: result.entry.defaultTiers,
              pricing: result.entry.pricing,
            },
            key.length > 0 ? key : undefined,
          )
        : await this.authState.addCustomEntry(
            result.entry,
            key.length > 0 ? key : undefined,
          );

      if (!outcome.ok || !outcome.entry) return;

      this.apiKey.set('');
      this.submitted.set(false);
      this.persistedEntry.set(outcome.entry);
      this.saved.emit(outcome.entry);
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Probe the saved entry's endpoint with one real round-trip. */
  async testConnection(): Promise<void> {
    const existing = this.currentEntry();
    if (!existing || this.isTesting()) return;
    await this.authState.testCustomEntry(existing.id);
  }

  /** Arm the delete confirmation. */
  requestDelete(): void {
    this.confirmingDelete.set(true);
  }

  /** Stand down from the delete confirmation. */
  cancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  /** Delete the entry and its stored key. */
  async confirmDelete(): Promise<void> {
    const existing = this.currentEntry();
    if (!existing || this.isSaving()) return;

    this.isSaving.set(true);
    try {
      const removed = await this.authState.removeCustomEntry(existing.id);
      if (!removed) return;
      this.confirmingDelete.set(false);
      this.deleted.emit(existing.id);
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Dismiss without saving. */
  cancel(): void {
    this.authState.clearCustomEntryError();
    this.authState.clearCustomTestState();
    this.cancelled.emit();
  }
}
