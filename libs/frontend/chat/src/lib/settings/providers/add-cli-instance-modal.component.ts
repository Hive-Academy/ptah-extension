import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Eye, EyeOff, LucideAngularModule, X } from 'lucide-angular';
import {
  ProvidersSettingsStateService,
  type ProvidersConnection,
  type ProvidersEditContext,
  type ProvidersSettingsCommit,
} from '@ptah-extension/core';
import {
  NativeModalComponent,
  ProviderMarkComponent,
} from '@ptah-extension/ui';
import { getAnthropicProvider } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { SettingsToastComponent } from '../feedback/settings-toast.component';

/** The instance an Edit opens with (from `cliAgents()`); `null` opens the create form. */
export interface CliInstanceEditTarget {
  readonly id: string;
  readonly name: string;
  readonly providerId: string;
  readonly providerName: string;
}

/** Connections a Ptah CLI instance cannot use (the rule of the instance manager retired in Batch 34). */
const EXCLUDED_PROVIDERS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai-codex',
]);
const COPILOT = 'github-copilot';
const MODALITY: Readonly<Record<string, string>> = {
  apiKey: 'API key',
  cli: 'CLI login',
  oauth: 'OAuth',
  'local-native': 'Local server',
  'local-proxy': 'Local server',
  custom: 'Custom endpoint',
};
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const FIELD = `input input-bordered input-sm w-full text-xs text-base-content ${FOCUS}`;
const SAVE_SCOPE = 'global';
/** Gate V 36 M4: a stored key is not a checked key (the matrix then runs the new instance's Test). */
const KEY_NOT_VERIFIED = 'Key stored, not verified.';
/** M7: the rename and the key are separate host writes; a partial result says which one landed. */
const NAME_SAVED_KEY_NOT = 'Name saved. The key was not saved.';
const NAME_SAVED_KEY_UNKNOWN =
  'Name saved. Could not confirm whether the key was saved; check it before retrying.';
const KEY_SAVED_NAME_NOT = `${KEY_NOT_VERIFIED} The name was not saved.`;
const KEY_SAVED_NAME_UNKNOWN = `${KEY_NOT_VERIFIED} Could not confirm whether the name was saved; check it before retrying.`;
const DUPLICATE_NAME = 'Another Ptah CLI instance already uses this name.';

/** How a provider takes credentials in this form (#48). */
type KeyMode = 'required' | 'optional' | 'none' | 'sign-in';

/**
 * Add / Edit Ptah CLI instance (plan :750-758, prototype `#modalAddPtahCli`, interactions/orchestration-1), on the
 * shared `NativeModalComponent` (centered `<dialog>`, design-spec §6 decision).
 * - **Create:** name (unique, case-insensitive), provider connection (every connection except Claude API and OpenAI
 *   Codex), and the key the provider needs, masked with show/hide (#49). Switching provider drops the typed key, and a
 *   hidden key field is never sent (S2). GitHub Copilot re-reads its sign-in when chosen and signs in inline (#47, M6);
 *   Create stays disabled until this open's check or login reports `signed-in`. A created instance is reported through
 *   `created` so the matrix runs its Test (M4).
 * - **Edit (#50):** name and a replacement key, as two `ptahCli:update` writes so a partial result names what saved
 *   (M7). The provider is shown, not editable. A Copilot instance shows its sign-in only while Copilot is signed out.
 * Saves go through `SettingsSaveFeedbackService` and close on that save's own result (M2); a second
 * `<ptah-settings-toast>` in the footer is the one assistive tech hears while `showModal()` makes the page inert
 * (plan :542-544). Closing mid-save is allowed: the write continues and the page toast reports it. The typed key lives
 * only here and is cleared on every open, close and provider change.
 */
@Component({
  selector: 'ptah-add-cli-instance-modal',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativeModalComponent,
    ProviderMarkComponent,
    SettingsToastComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-modal
      [isOpen]="open()"
      ariaLabelledby="add-cli-instance-title"
      size="md"
      (closed)="requestClose()"
    >
      <div
        modal-header
        class="surface-3 -mx-6 -mt-6 mb-4 flex items-center justify-between gap-2 border-b px-5 py-3"
        data-testid="add-cli-instance-modal"
      >
        <h2
          id="add-cli-instance-title"
          class="text-sm font-bold text-base-content"
        >
          {{
            editing()
              ? 'Edit ' + editing()?.name
              : 'Add Ptah CLI Agent Instance'
          }}
        </h2>
        <button
          type="button"
          [class]="'btn btn-ghost btn-xs btn-square min-h-6 ' + focusRing"
          aria-label="Close"
          (click)="requestClose()"
        >
          <lucide-angular
            [img]="CloseIcon"
            class="h-4 w-4"
            aria-hidden="true"
          />
        </button>
      </div>

      <form
        class="space-y-3 text-xs"
        (submit)="$event.preventDefault(); submit()"
        data-testid="add-cli-instance-form"
      >
        <div class="space-y-1">
          <label
            for="add-cli-instance-name"
            class="block font-semibold text-base-content"
            >Instance name</label
          >
          <input
            id="add-cli-instance-name"
            type="text"
            [class]="field"
            [value]="name()"
            (input)="name.set(value($event))"
            placeholder="e.g. Glm-Secondary, Llama-Local"
            autocomplete="off"
            maxlength="80"
            data-testid="add-cli-instance-name"
            [attr.aria-invalid]="duplicateName()"
            [attr.aria-describedby]="
              duplicateName() ? 'add-cli-instance-name-error' : null
            "
          />
          @if (duplicateName()) {
            <p
              id="add-cli-instance-name-error"
              role="alert"
              class="text-base-content"
              data-testid="add-cli-instance-name-error"
            >
              {{ duplicateMessage }}
            </p>
          }
        </div>

        <div class="space-y-1">
          <span
            class="block font-semibold text-base-content"
            id="add-cli-instance-provider-label"
            >Provider connection</span
          >
          @if (editing(); as target) {
            <p
              class="flex items-center gap-2 text-base-content"
              aria-labelledby="add-cli-instance-provider-label"
              data-testid="add-cli-instance-provider-fixed"
            >
              <ptah-provider-mark
                [providerId]="target.providerId"
                fallback="Bot"
              />
              <span>{{ target.providerName }}</span>
            </p>
          } @else {
            <span class="flex items-center gap-2">
              @if (providerId()) {
                <ptah-provider-mark
                  [providerId]="providerId()"
                  fallback="Bot"
                />
              }
              <select
                [class]="
                  'select select-bordered select-sm min-w-0 flex-1 text-xs text-base-content ' +
                  focusRing
                "
                aria-labelledby="add-cli-instance-provider-label"
                (change)="selectProvider(value($event))"
                data-testid="add-cli-instance-provider"
              >
                <option value="" [selected]="!providerId()">
                  Choose a provider connection…
                </option>
                @for (option of providerOptions(); track option.id) {
                  <option
                    [value]="option.id"
                    [selected]="option.id === providerId()"
                  >
                    {{ option.label }}
                  </option>
                }
              </select>
            </span>
            @if (state.connections().status === 'error') {
              <p
                role="alert"
                class="text-base-content"
                data-testid="add-cli-instance-providers-error"
              >
                The provider connections could not be loaded. Close and retry
                from the Providers tab.
              </p>
            }
          }
        </div>

        @if (showSignIn()) {
          <div
            class="space-y-2 rounded border border-base-300 bg-base-200 p-3"
            data-testid="add-cli-instance-copilot"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-base-content"
                >GitHub sign-in</span
              >
              <span
                [class]="
                  'badge badge-outline badge-xs h-auto py-0.5 font-medium text-base-content ' +
                  (signedIn()
                    ? 'border-success/40 bg-success/10'
                    : 'border-warning/40 bg-warning/10')
                "
                data-testid="add-cli-instance-copilot-state"
                >{{ signInLabel() }}</span
              >
            </div>
            <p class="text-base-content-muted">
              {{
                editing()
                  ? 'GitHub Copilot is signed out. Sign in so this instance can run.'
                  : 'Sign in with GitHub to use Copilot for this CLI instance. Create is available once sign-in is confirmed.'
              }}
            </p>
            @if (signInMessage(); as message) {
              <p
                [attr.role]="signInFailed() ? 'alert' : 'status'"
                class="text-base-content"
                data-testid="add-cli-instance-copilot-message"
              >
                {{ message }}
              </p>
            }
            <button
              type="button"
              [class]="'btn btn-primary btn-xs min-h-7 ' + focusRing"
              [disabled]="signingIn() || signedIn()"
              (click)="signIn()"
              data-testid="add-cli-instance-copilot-login"
            >
              {{
                signingIn()
                  ? signInBusyLabel()
                  : signInFailed()
                    ? 'Retry login with GitHub'
                    : 'Login with GitHub'
              }}
            </button>
          </div>
        }

        @if (showKey()) {
          <div class="space-y-1">
            <label
              for="add-cli-instance-key"
              class="block font-semibold text-base-content"
              >{{ keyLabel() }}</label
            >
            <div class="relative">
              <input
                id="add-cli-instance-key"
                [type]="keyVisible() ? 'text' : 'password'"
                autocomplete="new-password"
                spellcheck="false"
                [class]="field + ' pr-9 font-mono'"
                [value]="key()"
                (input)="key.set(value($event))"
                placeholder="sk-…"
                aria-describedby="add-cli-instance-key-help"
                data-testid="add-cli-instance-key"
              />
              <button
                type="button"
                [class]="
                  'btn btn-ghost btn-xs absolute right-1 top-1 ' + focusRing
                "
                (click)="keyVisible.set(!keyVisible())"
                [attr.aria-label]="
                  keyVisible() ? 'Hide API key' : 'Show API key'
                "
                [attr.aria-pressed]="keyVisible()"
                data-testid="add-cli-instance-toggle-visibility"
              >
                <lucide-angular
                  [img]="keyVisible() ? EyeOffIcon : EyeIcon"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
        }
        @if (keyHint(); as hint) {
          <p
            id="add-cli-instance-key-help"
            class="text-xs text-base-content-muted"
            data-testid="add-cli-instance-key-help"
          >
            {{ hint }}
          </p>
        }
        <!-- Submitting with Enter from a field. The visible submit is in the footer. -->
        <button
          type="submit"
          class="hidden"
          tabindex="-1"
          aria-hidden="true"
        ></button>
      </form>

      <div
        modal-footer
        class="surface-3 -mx-6 -mb-6 mt-5 flex items-center justify-between gap-2 border-t px-5 py-3"
      >
        <button
          type="button"
          [class]="'btn btn-ghost btn-sm text-base-content ' + focusRing"
          (click)="requestClose()"
        >
          Cancel
        </button>
        <button
          type="button"
          [class]="'btn btn-primary btn-sm ' + focusRing"
          [disabled]="!canSubmit()"
          (click)="submit()"
          data-testid="add-cli-instance-submit"
        >
          {{
            busy() ? 'Saving…' : editing() ? 'Save changes' : 'Create Instance'
          }}
        </button>
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
  protected readonly duplicateMessage = DUPLICATE_NAME;
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);

  readonly open = input(false);
  /** The instance to edit; `null` creates a new one. */
  readonly editing = input<CliInstanceEditTarget | null>(null);
  readonly closed = output<void>();
  /** A create saved (emitted before `closed`), with the trimmed name it was created under (unique). */
  readonly created = output<string>();

  protected readonly name = signal('');
  protected readonly providerId = signal('');
  /** The typed key: held only here, never in service state. */
  protected readonly key = signal('');
  protected readonly keyVisible = signal(false);
  private context: ProvidersEditContext | null = null;
  private session = 0;

  protected readonly busy = this.feedback.saving;
  protected readonly providerOptions = computed(() =>
    (this.state.connections().data ?? [])
      .filter((connection) => !EXCLUDED_PROVIDERS.has(connection.id))
      .map((connection) => ({
        id: connection.id,
        label: `${connection.name} · ${MODALITY[connection.authMode] ?? connection.authMode}`,
      })),
  );
  private readonly provider = computed<ProvidersConnection | null>(() => {
    const id = this.editing()?.providerId ?? this.providerId();
    return (
      (this.state.connections().data ?? []).find(
        (connection) => connection.id === id,
      ) ?? null
    );
  });
  protected readonly keyMode = computed<KeyMode | null>(() => {
    const provider = this.provider();
    if (!provider) return this.editing() ? 'optional' : null;
    if (provider.id === COPILOT) return 'sign-in';
    if (provider.authMode === 'cli') return 'none';
    if (
      provider.authMode === 'local-native' ||
      provider.authMode === 'local-proxy'
    ) {
      return getAnthropicProvider(provider.id)?.supportsOptionalApiKey
        ? 'optional'
        : 'none';
    }
    return getAnthropicProvider(provider.id)?.supportsOptionalApiKey
      ? 'optional'
      : 'required';
  });
  protected readonly showKey = computed(
    () => this.keyMode() === 'required' || this.keyMode() === 'optional',
  );
  protected readonly keyLabel = computed(() =>
    this.editing()
      ? 'Replacement API key (leave empty to keep the stored one)'
      : this.keyMode() === 'optional'
        ? 'API key (optional)'
        : 'API key for this instance',
  );
  /** #48 hints (the old wording of the pre-#581 instance manager at `7ecdefa45^1`, where it existed). */
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
        return this.editing()
          ? null
          : "Enter this instance's own key. Keys stored for the provider connection are not copied.";
      default:
        return null;
    }
  });

  /** M9: case-insensitive, against every other instance (an edit may keep its own name). */
  protected readonly duplicateName = computed(() => {
    const name = this.name().trim().toLowerCase(),
      self = this.editing()?.id;
    return (
      !!name &&
      (this.state.cliAgents().data ?? []).some(
        (agent) =>
          agent.id !== self && agent.name.trim().toLowerCase() === name,
      )
    );
  });

  /**
   * M6: only this open's own sign-in check or login counts: an earlier sign-in in the shared store (Providers tab, an
   * earlier open, then a sign-out) never reads as signed in.
   */
  private readonly signInAction = signal<'check' | 'login' | null>(null);
  protected readonly signInSection = computed(() => {
    const section = this.state.externalAuth();
    const ours =
      this.signInAction() !== null &&
      (section.data?.providerId === COPILOT ||
        section.status === 'loading' ||
        section.status === 'error');
    return ours ? section : null;
  });
  protected readonly signingIn = computed(
    () => this.signInSection()?.status === 'loading',
  );
  protected readonly signedIn = computed(
    () => this.signInSection()?.data?.signInState === 'signed-in',
  );
  protected readonly signInFailed = computed(
    () => this.signInSection()?.status === 'error',
  );
  protected readonly signInBusyLabel = computed(() =>
    this.signInAction() === 'check' ? 'Checking sign-in…' : 'Signing in…',
  );
  protected readonly signInLabel = computed(() =>
    this.signedIn()
      ? 'Signed in'
      : this.signingIn()
        ? this.signInBusyLabel()
        : 'Awaiting sign-in',
  );
  protected readonly signInMessage = computed(() =>
    this.signInFailed()
      ? this.signInAction() === 'check'
        ? 'Could not check the GitHub sign-in. Retry login with GitHub.'
        : 'Sign-in did not complete. Complete the GitHub login, then retry.'
      : (this.signInSection()?.data?.message ?? null),
  );
  /** Edit shows the sign-in only while Copilot reads as signed out (the connection row, M6); create always does. */
  protected readonly showSignIn = computed(() => {
    if (this.keyMode() !== 'sign-in') return false;
    return !this.editing() || this.provider()?.configured === false;
  });

  protected readonly canSubmit = computed(() => {
    if (
      this.busy() ||
      !this.name().trim() ||
      this.duplicateName() ||
      !this.state.reviewContext()
    )
      return false;
    const target = this.editing();
    if (target)
      return this.name().trim() !== target.name || !!this.key().trim();
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
        this.signInAction.set(null);
        this.clearKey();
      });
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  /** S2: a provider change drops the typed key (it was for the other vendor); Copilot re-reads its sign-in (M6). */
  protected selectProvider(id: string): void {
    this.providerId.set(id);
    this.clearKey();
    this.signInAction.set(null);
    if (id === COPILOT) {
      this.signInAction.set('check');
      void this.state.performExternalAuth(COPILOT, 'cli-check');
    }
  }

  protected signIn(): Promise<void> {
    this.signInAction.set('login');
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
    const session = this.session,
      target = this.editing(),
      name = this.name().trim();
    // S2: a key field that is not shown is never sent.
    const key = this.showKey() ? this.key() : '';
    const result = target
      ? await this.saveEdit(target, name, key, context)
      : await this.saveCreate(name, key, context);
    if (result === 'failed' && this.state.commit().status === 'blocked')
      this.context = this.state.reviewContext();
    // M2: closes only on this save's own result, and only for the open it started in (D15).
    if (result !== 'saved' || session !== this.session || !this.open()) return;
    if (!target) this.created.emit(name);
    this.requestClose();
  }

  private saveCreate(name: string, key: string, context: ProvidersEditContext) {
    const providerId = this.providerId();
    return this.feedback.save({
      label: `Ptah CLI instance ${name}`,
      scope: SAVE_SCOPE,
      write: () =>
        this.state.saveSettings(
          {
            cli: [
              { action: 'create', params: { name, providerId, apiKey: key } },
            ],
          },
          context,
        ),
      undo: null,
      // No promise of a Test here: the matrix runs it only once it finds the new instance (re-check N-1).
      ...(key.trim()
        ? { successMessage: `Created ${name}. ${KEY_NOT_VERIFIED}` }
        : {}),
    });
  }

  /** Name and key are two writes (M7); either one drops the instance's last Test (M8). */
  private saveEdit(
    target: CliInstanceEditTarget,
    name: string,
    key: string,
    context: ProvidersEditContext,
  ) {
    const nameChanged = name !== target.name,
      keyChanged = !!key.trim();
    const write =
      (params: { readonly name?: string; readonly apiKey?: string }) => () => {
        this.state.clearCliTest(target.id);
        return this.state.saveSettings(
          {
            cli: [
              ...(params.name !== undefined
                ? [
                    {
                      action: 'update' as const,
                      params: { id: target.id, name: params.name },
                    },
                  ]
                : []),
              ...(params.apiKey !== undefined
                ? [
                    {
                      action: 'update' as const,
                      params: { id: target.id, apiKey: params.apiKey },
                    },
                  ]
                : []),
            ],
          },
          context,
        );
      };
    return this.feedback.save({
      label: `${target.name} instance`,
      scope: SAVE_SCOPE,
      write: write({
        ...(nameChanged ? { name } : {}),
        ...(keyChanged ? { apiKey: key } : {}),
      }),
      // A replaced key cannot be written back; a rename alone can.
      undo: nameChanged && !keyChanged ? write({ name: target.name }) : null,
      ...(keyChanged
        ? {
            successMessage: `Saved ${target.name} instance. ${KEY_NOT_VERIFIED}`,
          }
        : {}),
      failureMessage: (commit) => partialEditMessage(commit, target.id),
    });
  }

  private clearKey(): void {
    this.key.set('');
    this.keyVisible.set(false);
  }
}

/**
 * M7: one of the two writes landed and the other did not, in either direction: "Name saved. The key was not saved."
 * or, when the rename was rejected and the key stored (re-check N-3), "Key stored, not verified. The name was not saved."
 */
function partialEditMessage(
  commit: ProvidersSettingsCommit,
  id: string,
): string | null {
  const nameField = `ptahCliAgents.${id}.name`,
    keyField = `ptahCliAgents.${id}.apiKey`;
  if (commit.saved.includes(nameField)) {
    if (commit.unsaved.includes(keyField)) return NAME_SAVED_KEY_NOT;
    return commit.unconfirmed.includes(keyField)
      ? NAME_SAVED_KEY_UNKNOWN
      : null;
  }
  if (!commit.saved.includes(keyField)) return null;
  if (commit.unsaved.includes(nameField)) return KEY_SAVED_NAME_NOT;
  return commit.unconfirmed.includes(nameField) ? KEY_SAVED_NAME_UNKNOWN : null;
}
