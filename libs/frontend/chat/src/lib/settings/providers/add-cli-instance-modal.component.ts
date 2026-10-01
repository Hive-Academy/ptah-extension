import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Eye, EyeOff, LucideAngularModule, X } from 'lucide-angular';
import { ProvidersSettingsStateService, type ProvidersConnection, type ProvidersEditContext } from '@ptah-extension/core';
import { NativeModalComponent } from '@ptah-extension/ui';
import { getAnthropicProvider } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { SettingsToastComponent } from '../feedback/settings-toast.component';

/** The instance an Edit opens with (from `cliAgents()`); `null` opens the create form. */
export interface CliInstanceEditTarget {
  readonly id: string;
  readonly name: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly hasStoredKey: boolean;
}

/** Connections a Ptah CLI instance cannot use (`ptah-cli-config.component.ts:51, 173`). */
const EXCLUDED_PROVIDERS: ReadonlySet<string> = new Set(['anthropic', 'openai-codex']);
const COPILOT = 'github-copilot';
const MODALITY: Readonly<Record<string, string>> = {
  apiKey: 'API key', cli: 'CLI login', oauth: 'OAuth', 'local-native': 'Local server', 'local-proxy': 'Local server', custom: 'Custom endpoint',
};
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const FIELD = `input input-bordered input-sm w-full text-xs text-base-content ${FOCUS}`;
const SAVE_SCOPE = 'global';

/** How a provider takes credentials in this form (#48). */
type KeyMode = 'required' | 'optional' | 'none' | 'sign-in';

/**
 * Add / Edit Ptah CLI instance (plan :750-758, prototype `#modalAddPtahCli`, interactions/orchestration-1), on the
 * shared `NativeModalComponent` (centered `<dialog>`, design-spec §6 decision).
 * - **Create:** name, provider connection (the existing rule: every connection except Claude API and OpenAI Codex),
 *   and the key the provider needs, masked with show/hide (#49). Keyless and optional-key providers say so (#48).
 *   GitHub Copilot signs in inline (`state.performExternalAuth('github-copilot','sign-in')`, #47); Create stays
 *   disabled until that reports `signed-in`. Submit → `saveSettings({cli:[{action:'create', …}]})`.
 * - **Edit (#50):** name and a replacement key → `saveSettings({cli:[{action:'update', params:{id, name?, apiKey?}}]})`
 *   (`PtahCliUpdateParams` carries both). The provider is shown, not editable: the update contract has no provider.
 * Saves go through `SettingsSaveFeedbackService`; a second `<ptah-settings-toast>` in the footer is the one assistive
 * tech hears while `showModal()` makes the page inert (plan :542-544). Closing mid-save is allowed: the write
 * continues and the page toast reports it. The typed key lives only here and is cleared on every open and close.
 */
@Component({
  selector: 'ptah-add-cli-instance-modal',
  standalone: true,
  imports: [LucideAngularModule, NativeModalComponent, SettingsToastComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-modal [isOpen]="open()" ariaLabelledby="add-cli-instance-title" size="md" (closed)="requestClose()">
      <div modal-header class="-mx-6 -mt-6 mb-4 flex items-center justify-between gap-2 border-b border-base-300 bg-base-200 px-5 py-3"
        data-testid="add-cli-instance-modal">
        <h2 id="add-cli-instance-title" class="text-sm font-bold text-base-content">{{ editing() ? 'Edit ' + editing()?.name : 'Add Ptah CLI Agent Instance' }}</h2>
        <button type="button" [class]="'btn btn-ghost btn-xs btn-square min-h-6 ' + focusRing" aria-label="Close" (click)="requestClose()">
          <lucide-angular [img]="CloseIcon" class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <form class="space-y-3 text-xs" (submit)="$event.preventDefault(); submit()" data-testid="add-cli-instance-form">
        <div class="space-y-1">
          <label for="add-cli-instance-name" class="block font-semibold text-base-content">Instance name</label>
          <input id="add-cli-instance-name" type="text" [class]="field" [value]="name()" (input)="name.set(value($event))"
            placeholder="e.g. Glm-Secondary, Llama-Local" autocomplete="off" data-testid="add-cli-instance-name" />
        </div>

        <div class="space-y-1">
          <span class="block font-semibold text-base-content" id="add-cli-instance-provider-label">Provider connection</span>
          @if (editing(); as target) {
            <p class="text-base-content" aria-labelledby="add-cli-instance-provider-label" data-testid="add-cli-instance-provider-fixed">{{ target.providerName }}</p>
          } @else {
            <select [class]="'select select-bordered select-sm w-full text-xs text-base-content ' + focusRing"
              aria-labelledby="add-cli-instance-provider-label" (change)="providerId.set(value($event))" data-testid="add-cli-instance-provider">
              <option value="" [selected]="!providerId()">Choose a provider connection…</option>
              @for (option of providerOptions(); track option.id) {
                <option [value]="option.id" [selected]="option.id === providerId()">{{ option.label }}</option>
              }
            </select>
            @if (state.connections().status === 'error') {
              <p role="alert" class="text-base-content" data-testid="add-cli-instance-providers-error">The provider connections could not be loaded. Close and retry from the Providers tab.</p>
            }
          }
        </div>

        @if (keyMode() === 'sign-in') {
          <div class="space-y-2 rounded border border-base-300 bg-base-200 p-3" data-testid="add-cli-instance-copilot">
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-base-content">GitHub sign-in</span>
              <span [class]="'badge badge-outline badge-xs h-auto py-0.5 font-medium text-base-content ' + (signedIn() ? 'border-success/40 bg-success/10' : 'border-warning/40 bg-warning/10')"
                data-testid="add-cli-instance-copilot-state">{{ signInLabel() }}</span>
            </div>
            <p class="text-base-content-muted">Sign in with GitHub to use Copilot for this CLI instance. Create is available once sign-in is confirmed.</p>
            @if (signInMessage(); as message) {
              <p [attr.role]="signInFailed() ? 'alert' : 'status'" class="text-base-content" data-testid="add-cli-instance-copilot-message">{{ message }}</p>
            }
            <button type="button" [class]="'btn btn-primary btn-xs min-h-7 ' + focusRing" [disabled]="signingIn() || signedIn()"
              (click)="signIn()" data-testid="add-cli-instance-copilot-login">{{ signingIn() ? 'Signing in…' : signInFailed() ? 'Retry login with GitHub' : 'Login with GitHub' }}</button>
          </div>
        }

        @if (showKey()) {
          <div class="space-y-1">
            <label for="add-cli-instance-key" class="block font-semibold text-base-content">{{ keyLabel() }}</label>
            <div class="relative">
              <input id="add-cli-instance-key" [type]="keyVisible() ? 'text' : 'password'" autocomplete="new-password" spellcheck="false"
                [class]="field + ' pr-9 font-mono'" [value]="key()" (input)="key.set(value($event))" placeholder="sk-…"
                aria-describedby="add-cli-instance-key-help" data-testid="add-cli-instance-key" />
              <button type="button" [class]="'btn btn-ghost btn-xs absolute right-1 top-1 ' + focusRing" (click)="keyVisible.set(!keyVisible())"
                [attr.aria-label]="keyVisible() ? 'Hide API key' : 'Show API key'" [attr.aria-pressed]="keyVisible()"
                data-testid="add-cli-instance-toggle-visibility">
                <lucide-angular [img]="keyVisible() ? EyeOffIcon : EyeIcon" class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        }
        @if (keyHint(); as hint) {
          <p id="add-cli-instance-key-help" class="text-[11px] text-base-content-muted" data-testid="add-cli-instance-key-help">{{ hint }}</p>
        }
        <!-- Submitting with Enter from a field. The visible submit is in the footer. -->
        <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
      </form>

      <div modal-footer class="-mx-6 -mb-6 mt-5 flex items-center justify-between gap-2 border-t border-base-300 bg-base-200 px-5 py-3">
        <button type="button" [class]="'btn btn-ghost btn-sm text-base-content ' + focusRing" (click)="requestClose()">Cancel</button>
        <button type="button" [class]="'btn btn-primary btn-sm ' + focusRing" [disabled]="!canSubmit()" (click)="submit()"
          data-testid="add-cli-instance-submit">{{ busy() ? 'Saving…' : editing() ? 'Save changes' : 'Create Instance' }}</button>
        <!-- showModal() makes the page inert: this copy of the toast is the one announced while the modal is open.
             Only while open: a closed modal must not keep a second toast (and Undo) in the page. -->
        @if (open()) {
          <ptah-settings-toast />
        }
      </div>
    </ptah-native-modal>
  `,
})
export class AddCliInstanceModalComponent {
  protected readonly CloseIcon = X;
  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly focusRing = FOCUS;
  protected readonly field = FIELD;
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);

  readonly open = input(false);
  /** The instance to edit; `null` creates a new one. */
  readonly editing = input<CliInstanceEditTarget | null>(null);
  readonly closed = output<void>();

  protected readonly name = signal('');
  protected readonly providerId = signal('');
  /** The typed key: held only here, never in service state. */
  protected readonly key = signal('');
  protected readonly keyVisible = signal(false);
  private context: ProvidersEditContext | null = null;
  private session = 0;

  protected readonly busy = this.feedback.saving;
  protected readonly providerOptions = computed(() => (this.state.connections().data ?? [])
    .filter((connection) => !EXCLUDED_PROVIDERS.has(connection.id))
    .map((connection) => ({ id: connection.id, label: `${connection.name} · ${MODALITY[connection.authMode] ?? connection.authMode}` })));
  private readonly provider = computed<ProvidersConnection | null>(() => {
    const id = this.editing()?.providerId ?? this.providerId();
    return (this.state.connections().data ?? []).find((connection) => connection.id === id) ?? null;
  });
  protected readonly keyMode = computed<KeyMode | null>(() => {
    const provider = this.provider();
    if (!provider) return this.editing() ? 'optional' : null;
    if (provider.id === COPILOT) return 'sign-in';
    if (provider.authMode === 'cli') return 'none';
    if (provider.authMode === 'local-native' || provider.authMode === 'local-proxy') {
      return getAnthropicProvider(provider.id)?.supportsOptionalApiKey ? 'optional' : 'none';
    }
    return getAnthropicProvider(provider.id)?.supportsOptionalApiKey ? 'optional' : 'required';
  });
  protected readonly showKey = computed(() => this.keyMode() === 'required' || this.keyMode() === 'optional');
  protected readonly keyLabel = computed(() => this.editing()
    ? 'Replacement API key (leave empty to keep the stored one)'
    : this.keyMode() === 'optional' ? 'API key (optional)' : 'API key for this instance');
  /** #48 hints (the old wording, `7ecdefa45^1:ptah-cli-config.component.ts:284-299`, where it existed). */
  protected readonly keyHint = computed(() => {
    const provider = this.provider();
    switch (this.keyMode()) {
      case 'none':
        return provider?.authMode === 'cli'
          ? 'No API key needed — uses your local Claude login / subscription.'
          : `No API key needed — make sure ${provider?.name ?? 'the local server'} is running locally.`;
      case 'optional':
        return provider?.id === 'ollama-cloud'
          ? 'Optional — run ollama signin to use Ollama Cloud, or paste an ollama.com API key above to enable live model discovery and pricing.'
          : 'Optional. Leave empty for keyless use or subscription sign-in.';
      case 'required':
        return this.editing() ? null : 'Enter this instance\'s own key. Keys stored for the provider connection are not copied.';
      default:
        return null;
    }
  });

  /** This open started a Copilot sign-in: a failed read (which carries no provider) is then this form's. */
  private readonly signInAttempted = signal(false);
  protected readonly signInSection = computed(() => {
    const section = this.state.externalAuth();
    const ours = section.data?.providerId === COPILOT
      || ((section.status === 'loading' || section.status === 'error') && this.signInAttempted());
    return ours ? section : null;
  });
  protected readonly signingIn = computed(() => this.signInSection()?.status === 'loading');
  protected readonly signedIn = computed(() => this.signInSection()?.data?.signInState === 'signed-in');
  protected readonly signInFailed = computed(() => this.signInSection()?.status === 'error');
  protected readonly signInLabel = computed(() => this.signedIn() ? 'Signed in' : this.signingIn() ? 'Signing in…' : 'Awaiting sign-in');
  protected readonly signInMessage = computed(() => this.signInFailed()
    ? 'Sign-in did not complete. Complete the GitHub login, then retry.'
    : this.signInSection()?.data?.message ?? null);

  protected readonly canSubmit = computed(() => {
    if (this.busy() || !this.name().trim() || !this.state.reviewContext()) return false;
    const target = this.editing();
    if (target) return this.name().trim() !== target.name || !!this.key().trim();
    const provider = this.provider();
    if (!provider || EXCLUDED_PROVIDERS.has(provider.id)) return false;
    if (this.keyMode() === 'sign-in') return this.signedIn();
    return this.keyMode() !== 'required' || !!this.key().trim();
  });

  constructor() {
    // Every open starts from the target's values and a fresh edit context; the key is never carried over.
    effect(() => {
      if (!this.open()) return;
      const target = this.editing();
      untracked(() => {
        this.session += 1;
        this.context = this.state.reviewContext();
        this.name.set(target?.name ?? '');
        this.providerId.set('');
        this.signInAttempted.set(false);
        this.clearKey();
      });
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected signIn(): Promise<void> {
    this.signInAttempted.set(true);
    return this.state.performExternalAuth(COPILOT, 'sign-in');
  }

  /** Esc, the backdrop, Cancel and ✕: closes even mid-save (the write continues and the page toast reports it). */
  protected requestClose(): void {
    this.clearKey();
    this.closed.emit();
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    // The context taken on open; if the scopes were still loading then, the current one.
    const context = this.context ?? this.state.reviewContext();
    if (!context) return;
    const session = this.session, target = this.editing(), name = this.name().trim(), key = this.key();
    if (target) {
      const nameChanged = name !== target.name;
      const params = { id: target.id, ...(nameChanged ? { name } : {}), ...(key.trim() ? { apiKey: key } : {}) };
      await this.feedback.save({
        label: `${target.name} instance`, scope: SAVE_SCOPE,
        write: () => this.state.saveSettings({ cli: [{ action: 'update', params }] }, context),
        // A replaced key cannot be written back; a rename alone can.
        undo: nameChanged && !key.trim()
          ? () => this.state.saveSettings({ cli: [{ action: 'update', params: { id: target.id, name: target.name } }] }, context)
          : null,
      });
    } else {
      const providerId = this.providerId();
      await this.feedback.save({
        label: `Ptah CLI instance ${name}`, scope: SAVE_SCOPE,
        write: () => this.state.saveSettings({ cli: [{ action: 'create', params: { name, providerId, apiKey: key } }] }, context),
        undo: null,
      });
    }
    const commit = this.state.commit().status;
    if (commit === 'blocked') this.context = this.state.reviewContext();
    // Closes only when this open's save landed; a failure keeps the form (and the key) for a retry (D15).
    if (commit === 'saved' && session === this.session && this.open()) this.requestClose();
  }

  private clearKey(): void {
    this.key.set('');
    this.keyVisible.set(false);
  }
}
