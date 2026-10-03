import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked,
} from '@angular/core';
import { ProvidersSettingsStateService, type ProvidersConnection, type ProvidersCustomEntry } from '@ptah-extension/core';
import { validateProviderBaseUrl, type AuthVerifyDraftConnectionParams, type AuthVerifyDraftConnectionResult } from '@ptah-extension/shared';
import type { CancelDraftFn, VerifyDraftFn } from './credentials-tab.component';
import { runDrawerWrite, type DrawerWriteOutcome } from './drawer-write';
import { SettingsBusyDisabledDirective } from '../../feedback/busy-disabled.directive';

/** Verbatim (plan :662-664): pricing has no runtime reader (`provider-registry.ts:703-718`). */
export const PRICING_NOTE = 'Stored for your reference; Ptah does not use it for cost estimates yet.';

type Section = 'endpoint' | 'help' | 'pricing' | 'delete';
type ProbeState = 'idle' | 'checking' | 'verified' | 'failed';

const SAVED_TEXT: Readonly<Record<Section, string>> = {
  endpoint: 'Endpoint saved.',
  help: 'Help URL saved.',
  pricing: 'Pricing saved.',
  delete: 'Connection deleted.',
};

const PROBE_FAILURE_COPY: Readonly<Record<string, string>> = {
  'credential-rejected': 'The provider rejected the key.',
  'permission-denied': 'This account cannot use the requested service or model.',
  unreachable: 'Could not reach this address.',
  timeout: 'The endpoint did not answer in time.',
  'rate-limited': 'The endpoint is rate-limiting requests. Retry in a moment.',
  'quota-exhausted': 'This account has no available quota for the check.',
  'model-unavailable': 'The model used for the check is not available here.',
  cancelled: 'Check cancelled.',
  'no-stored-credential': 'No key is stored for this connection. Add one on the Credentials tab.',
  'stored-credential-mismatch': 'The stored key can only be checked against the saved address. Enter the key to check the new one.',
  unclassified: 'The check failed. Retry.',
};

let PROBE_COUNTER = 0;

/** Parses the two price fields: both empty clears the pricing; otherwise both must be numbers ≥ 0. */
export function parsePricing(input: string, output: string): { readonly ok: true; readonly value: ProvidersCustomEntry['pricing'] } | { readonly ok: false } {
  const a = input.trim(), b = output.trim();
  if (!a && !b) return { ok: true, value: null };
  const inputPerMillion = Number(a), outputPerMillion = Number(b);
  if (!a || !b || !Number.isFinite(inputPerMillion) || !Number.isFinite(outputPerMillion) || inputPerMillion < 0 || outputPerMillion < 0) {
    return { ok: false };
  }
  return { ok: true, value: { inputPerMillion, outputPerMillion } };
}

/**
 * Drawer tab "Advanced" (custom connections only; plan :659-665, prototype drawer Tab 4, D7):
 * - base URL and models endpoint, saved only after a passing check (D7): a changed base URL is checked
 *   with a typed key (the host checks a stored key only against its saved address); a models endpoint
 *   alone is checked against the current address with the stored key;
 * - help URL (#28) and pricing (#30, with the verbatim note), saved directly;
 * - Delete connection (#25) with an inline confirm, refused for the main agent's driver.
 * Values render by interpolation and `[value]` only.
 */
@Component({
  selector: 'ptah-connection-advanced-tab',
  standalone: true,
  imports: [SettingsBusyDisabledDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4 text-sm" data-testid="connection-advanced">
      @if (!entry()) {
        <div class="space-y-2" aria-busy="true" data-testid="advanced-skeleton">
          <span class="skeleton block h-8 w-full"></span>
          <span class="skeleton block h-8 w-full"></span>
        </div>
      } @else {
        <section class="space-y-2" aria-labelledby="advanced-endpoint-heading">
          <h3 id="advanced-endpoint-heading" class="font-semibold text-base-content">Endpoint</h3>
          <label for="advanced-base-url" class="block text-xs font-medium text-base-content-muted">Base URL</label>
          <input id="advanced-base-url" type="url" class="input input-bordered input-sm w-full font-mono text-xs" [value]="baseUrl()"
            (input)="baseUrlDraft.set(value($event)); abandonProbe()" data-testid="advanced-base-url" />
          @if (baseUrlError(); as error) { <p class="text-xs text-base-content">{{ error }}</p> }
          <label for="advanced-models-endpoint" class="block text-xs font-medium text-base-content-muted">Models endpoint</label>
          <input id="advanced-models-endpoint" type="text" class="input input-bordered input-sm w-full font-mono text-xs"
            [value]="modelsEndpoint()" placeholder="e.g. /v1/models" (input)="modelsEndpointDraft.set(value($event)); abandonProbe()"
            data-testid="advanced-models-endpoint" />
          <p class="text-xs text-base-content-muted">Path Ptah uses to list this gateway's models. Leave it empty to use the default.</p>
          @if (baseUrlChanged()) {
            <label for="advanced-check-key" class="block text-xs font-medium text-base-content-muted">API key for the check</label>
            <input id="advanced-check-key" type="password" autocomplete="off" class="input input-bordered input-sm w-full font-mono text-xs"
              [value]="keyDraft()" (input)="keyDraft.set(value($event)); abandonProbe()" data-testid="advanced-check-key" />
            <p class="text-xs text-base-content-muted">The stored key can only be checked against the saved address. It is used for this check only and is not saved.</p>
          }
          <p role="status" class="flex items-center gap-1.5 text-xs text-base-content" data-testid="advanced-probe">
            @if (probeState() !== 'idle') { <span [class]="probeDot()" aria-hidden="true"></span> }
            {{ probeText() }}
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline btn-sm" [disabled]="!canCheck()" (click)="check()"
              data-testid="advanced-check">{{ probeState() === 'checking' ? 'Checking…' : 'Check endpoint' }}</button>
            <button type="button" class="btn btn-primary btn-sm" [disabled]="!canSaveEndpoint()" (click)="saveEndpoint()"
              data-testid="advanced-save-endpoint">Save endpoint</button>
          </div>
        </section>

        <section class="space-y-2" aria-labelledby="advanced-help-heading">
          <h3 id="advanced-help-heading" class="font-semibold text-base-content">Documentation URL</h3>
          <div class="flex gap-2">
            <input id="advanced-help-url" type="url" aria-labelledby="advanced-help-heading" class="input input-bordered input-sm min-w-0 flex-1 text-xs"
              [value]="helpUrl()" placeholder="https://" (input)="helpUrlDraft.set(value($event))" data-testid="advanced-help-url" />
            <button type="button" class="btn btn-outline btn-sm" [ptahBusyDisabled]="busy() || helpUrlDraft() === null || !!helpUrlError()"
              (click)="saveHelpUrl()" data-testid="advanced-save-help">Save</button>
          </div>
          @if (helpUrlError(); as error) { <p class="text-xs text-base-content">{{ error }}</p> }
        </section>

        <section class="space-y-2 rounded border border-base-300 bg-base-200 p-3" aria-labelledby="advanced-pricing-heading">
          <h3 id="advanced-pricing-heading" class="font-semibold text-base-content">Token pricing (per 1M tokens)</h3>
          <div class="grid grid-cols-2 gap-2">
            <label class="text-xs text-base-content-muted">Input price ($ / 1M)
              <input type="number" min="0" step="0.01" class="input input-bordered input-sm mt-1 w-full font-mono text-xs"
                [value]="inputPrice()" (input)="inputPriceDraft.set(value($event))" data-testid="advanced-price-input" />
            </label>
            <label class="text-xs text-base-content-muted">Output price ($ / 1M)
              <input type="number" min="0" step="0.01" class="input input-bordered input-sm mt-1 w-full font-mono text-xs"
                [value]="outputPrice()" (input)="outputPriceDraft.set(value($event))" data-testid="advanced-price-output" />
            </label>
          </div>
          <p class="text-xs text-base-content-muted" data-testid="advanced-pricing-note">{{ pricingNote }}</p>
          @if (!pricing().ok) { <p class="text-xs text-base-content">Enter both prices as numbers of 0 or more, or leave both empty.</p> }
          <button type="button" class="btn btn-outline btn-sm" [ptahBusyDisabled]="busy() || !pricingDirty() || !pricing().ok"
            (click)="savePricing()" data-testid="advanced-save-pricing">Save pricing</button>
        </section>

        <section class="flex items-center justify-between gap-3 border-t border-base-300 pt-3" aria-labelledby="advanced-delete-heading">
          <div class="min-w-0">
            <h3 id="advanced-delete-heading" class="flex items-center gap-1.5 font-semibold text-base-content">
              <span class="h-2 w-2 rounded-full bg-error" aria-hidden="true"></span> Delete connection
            </h3>
            <p class="text-xs text-base-content-muted">Removes this custom gateway and its stored key from this machine.</p>
            @if (isDriver()) {
              <p class="text-xs text-base-content" data-testid="advanced-delete-blocked">Switch the main agent first.</p>
            }
          </div>
          @if (!confirmingDelete()) {
            <button type="button" class="btn btn-outline btn-sm border-error text-base-content" [disabled]="busy() || isDriver()"
              (click)="confirmingDelete.set(true)" data-testid="advanced-delete">Delete connection</button>
          }
        </section>
        @if (confirmingDelete()) {
          <div role="group" aria-label="Confirm delete connection" class="space-y-2 rounded border border-base-300 p-3" data-testid="advanced-delete-confirm">
            <p class="text-xs text-base-content">Delete {{ connection().name }} for good? Its endpoint, settings and stored key are removed.</p>
            <div class="flex gap-2">
              <button type="button" class="btn btn-outline btn-sm border-error text-base-content" [ptahBusyDisabled]="busy() || isDriver()"
                (click)="deleteConnection()" data-testid="advanced-delete-confirm-button">Delete for good</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="confirmingDelete.set(false)">Cancel</button>
            </div>
          </div>
        }
      }
      @if (outcomeView(); as feedback) {
        <p [attr.role]="feedback.alert ? 'alert' : 'status'" class="flex items-start gap-1.5 text-xs text-base-content" data-testid="advanced-commit">
          <span [class]="feedback.dot" aria-hidden="true"></span> {{ feedback.text }}
        </p>
      }
    </div>
  `,
})
export class AdvancedTabComponent {
  private readonly state = inject(ProvidersSettingsStateService);
  readonly connection = input.required<ProvidersConnection>();
  /** This connection drives the main agent: it cannot be deleted. */
  readonly isDriver = input(false);
  readonly verifyDraftConnection = input.required<VerifyDraftFn>();
  readonly cancelDraftVerification = input.required<CancelDraftFn>();

  protected readonly pricingNote = PRICING_NOTE;
  protected readonly entry = computed(() => this.state.customEntry(this.connection().id));
  /** `null` = not edited: the field shows the stored value. */
  protected readonly baseUrlDraft = signal<string | null>(null);
  protected readonly modelsEndpointDraft = signal<string | null>(null);
  protected readonly helpUrlDraft = signal<string | null>(null);
  protected readonly inputPriceDraft = signal<string | null>(null);
  protected readonly outputPriceDraft = signal<string | null>(null);
  /** Typed only to check a changed base URL; never saved. Cleared on a saved endpoint, another connection and destroy. */
  protected readonly keyDraft = signal('');
  protected readonly confirmingDelete = signal(false);
  protected readonly probeState = signal<ProbeState>('idle');
  protected readonly probeResult = signal<AuthVerifyDraftConnectionResult | null>(null);
  private readonly outcome = signal<DrawerWriteOutcome | null>(null);
  private readonly section = signal<Section | null>(null);
  private probeId: string | null = null;
  private readonly connectionId = computed(() => this.connection().id);

  protected readonly baseUrl = computed(() => this.baseUrlDraft() ?? this.entry()?.baseUrl ?? '');
  protected readonly modelsEndpoint = computed(() => this.modelsEndpointDraft() ?? this.entry()?.modelsEndpoint ?? '');
  protected readonly helpUrl = computed(() => this.helpUrlDraft() ?? this.entry()?.helpUrl ?? '');
  protected readonly inputPrice = computed(() => this.inputPriceDraft() ?? String(this.entry()?.pricing?.inputPerMillion ?? ''));
  protected readonly outputPrice = computed(() => this.outputPriceDraft() ?? String(this.entry()?.pricing?.outputPerMillion ?? ''));
  protected readonly baseUrlChanged = computed(() => this.baseUrl().trim() !== (this.entry()?.baseUrl ?? ''));
  private readonly modelsEndpointChanged = computed(() => this.modelsEndpoint().trim() !== (this.entry()?.modelsEndpoint ?? ''));
  protected readonly baseUrlError = computed(() =>
    this.baseUrlChanged() && !validateProviderBaseUrl(this.baseUrl().trim()).ok ? 'Enter an http:// or https:// URL.' : null);
  protected readonly helpUrlError = computed(() => {
    const url = this.helpUrl().trim();
    return url && !/^https?:\/\/\S+$/i.test(url) ? 'Enter an http:// or https:// URL, or leave it empty.' : null;
  });
  protected readonly pricing = computed(() => parsePricing(this.inputPrice(), this.outputPrice()));
  protected readonly pricingDirty = computed(() => this.inputPriceDraft() !== null || this.outputPriceDraft() !== null);
  protected readonly busy = computed(() => this.state.commit().status === 'saving' || this.outcome()?.status === 'saving');
  protected readonly canCheck = computed(() => !this.busy() && this.probeState() !== 'checking' && !this.baseUrlError()
    && (this.baseUrlChanged() || this.modelsEndpointChanged()) && (!this.baseUrlChanged() || !!this.keyDraft().trim()));
  protected readonly canSaveEndpoint = computed(() => !this.busy() && this.probeState() === 'verified'
    && this.probeResult()?.probeId === this.probeId && (this.baseUrlChanged() || this.modelsEndpointChanged()));
  protected readonly probeText = computed(() => {
    const result = this.probeResult();
    const latency = result?.latencyMs !== null && result?.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : '';
    switch (this.probeState()) {
      case 'checking': return 'Checking the endpoint…';
      case 'verified': return `Endpoint verified${latency}. Save it to apply.`;
      case 'failed': return `Check failed${latency}: ${PROBE_FAILURE_COPY[result?.reason ?? 'unclassified'] ?? PROBE_FAILURE_COPY['unclassified']} Nothing was saved.`;
      default: return 'A changed base URL or models endpoint is saved only after a passing check.';
    }
  });
  protected readonly probeDot = computed(() =>
    `h-2 w-2 shrink-0 rounded-full ${this.probeState() === 'verified' ? 'bg-success' : this.probeState() === 'failed' ? 'bg-error' : 'bg-base-content-muted'}`);
  protected readonly outcomeView = computed(() => {
    const outcome = this.outcome(), section = this.section();
    if (!outcome || !section || outcome.status === 'idle') return null;
    const dot = (tone: string) => `mt-1 h-2 w-2 shrink-0 rounded-full ${tone}`;
    switch (outcome.status) {
      case 'saving': return { text: 'Saving…', dot: dot('bg-base-content-muted'), alert: false };
      case 'saved': return { text: SAVED_TEXT[section], dot: dot('bg-success'), alert: false };
      case 'unconfirmed': return { text: `Save not confirmed. ${outcome.message ?? ''}`.trim(), dot: dot('bg-warning'), alert: true };
      default: return { text: `Not saved. ${outcome.message ?? ''}`.trim(), dot: dot('bg-error'), alert: true };
    }
  });

  constructor() {
    effect(() => {
      this.connectionId();
      untracked(() => this.resetAll());
    });
    inject(DestroyRef).onDestroy(() => { this.abandonProbe(); this.keyDraft.set(''); });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected check(): void {
    if (!this.canCheck()) return;
    const probeId = `advanced-probe-${(PROBE_COUNTER += 1)}`;
    this.probeId = probeId;
    this.probeState.set('checking');
    this.probeResult.set(null);
    const params: AuthVerifyDraftConnectionParams = {
      probeId, providerId: this.connection().id, authMode: 'custom', baseUrl: this.baseUrl().trim(),
      credential: this.baseUrlChanged() ? { kind: 'apiKey', value: this.keyDraft().trim() } : { kind: 'stored' },
    };
    void this.verifyDraftConnection()(params).then((result) => {
      if (this.probeId !== probeId || result.probeId !== probeId) return;
      this.probeResult.set(result);
      this.probeState.set(result.outcome === 'verified' ? 'verified' : 'failed');
    }).catch(() => {
      if (this.probeId !== probeId) return;
      this.probeResult.set({ probeId, outcome: 'failed', reason: 'unclassified', detail: null, latencyMs: null, modelUsed: null,
        checkedAt: new Date().toISOString() });
      this.probeState.set('failed');
    });
  }

  protected saveEndpoint(): Promise<void> {
    const probeId = this.probeId;
    if (!this.canSaveEndpoint() || !probeId) return Promise.resolve();
    const id = this.connection().id;
    const changes: { baseUrl?: string; modelsEndpoint?: string | null } = {};
    if (this.baseUrlChanged()) changes.baseUrl = this.baseUrl().trim();
    if (this.modelsEndpointChanged()) changes.modelsEndpoint = this.modelsEndpoint().trim() || null;
    return this.write('endpoint', (context) => this.state.updateCustomEntryEndpoint(id, changes, probeId, context), () => {
      this.baseUrlDraft.set(null);
      this.modelsEndpointDraft.set(null);
      this.keyDraft.set('');
      this.abandonProbe();
      // The Credentials tab checks a replacement key against the stored address it read on open.
      if (changes.baseUrl !== undefined) void this.state.refreshConnectionSetup(id);
    });
  }

  protected saveHelpUrl(): Promise<void> {
    const id = this.connection().id, helpUrl = this.helpUrl().trim();
    return this.write('help', (context) => this.state.updateCustomEntryFields(id, { helpUrl }, context), () => this.helpUrlDraft.set(null));
  }

  protected savePricing(): Promise<void> {
    const parsed = this.pricing();
    if (!parsed.ok) return Promise.resolve();
    const id = this.connection().id;
    return this.write('pricing', (context) => this.state.updateCustomEntryFields(id, { pricing: parsed.value }, context), () => {
      this.inputPriceDraft.set(null);
      this.outputPriceDraft.set(null);
    });
  }

  protected deleteConnection(): Promise<void> {
    this.confirmingDelete.set(false);
    const id = this.connection().id;
    return this.write('delete', (context) => this.state.removeCustomEntry(id, context), () => undefined);
  }

  /**
   * One write at a time; its own outcome only (D15). A saved write drops that section's drafts. An
   * outcome that lands after another connection opened in this tab belongs to that earlier connection
   * and is dropped.
   */
  private async write(section: Section, run: Parameters<typeof runDrawerWrite>[1], onSaved: () => void): Promise<void> {
    if (this.busy()) return;
    const id = this.connectionId();
    this.section.set(section);
    await runDrawerWrite(this.state, run, (outcome) => {
      if (this.connectionId() !== id) return;
      this.outcome.set(outcome);
      if (outcome.status === 'saved') onSaved();
    });
  }

  protected abandonProbe(): void {
    const probeId = this.probeId;
    if (probeId && this.probeState() === 'checking') void this.cancelDraftVerification()({ probeId }).catch(() => undefined);
    this.probeId = null;
    this.probeState.set('idle');
    this.probeResult.set(null);
  }

  private resetAll(): void {
    this.abandonProbe();
    for (const draft of [this.baseUrlDraft, this.modelsEndpointDraft, this.helpUrlDraft, this.inputPriceDraft, this.outputPriceDraft]) draft.set(null);
    this.keyDraft.set('');
    this.confirmingDelete.set(false);
    this.outcome.set(null);
    this.section.set(null);
  }
}
