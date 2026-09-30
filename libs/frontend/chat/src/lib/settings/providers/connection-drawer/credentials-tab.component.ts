import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { Copy, Eye, EyeOff, LucideAngularModule } from 'lucide-angular';
import type { ProvidersConnection, ProvidersConnectionDraft, ProvidersSettingsCommit } from '@ptah-extension/core';
import {
  getAnthropicProvider,
  type AuthCancelDraftVerificationParams, type AuthCancelDraftVerificationResult,
  type AuthVerifyDraftConnectionParams, type AuthVerifyDraftConnectionResult, type ProbeFailureReason,
} from '@ptah-extension/shared';
import type { ConnectionKind } from './connection-kind';

export type VerifyDraftFn = (params: AuthVerifyDraftConnectionParams) => Promise<AuthVerifyDraftConnectionResult>;
export type CancelDraftFn = (params: AuthCancelDraftVerificationParams) => Promise<AuthCancelDraftVerificationResult>;

/** A verified replacement key. The key lives only in this event and the draft built from it. */
export interface ReplaceKeyRequest {
  readonly key: string;
  readonly probeId: string;
}

/**
 * The outcome of this tab's own last write. The parent sets `saving` when it starts the write and
 * copies `state.commit()` only after that write resolved, so an earlier save never shows here.
 */
export interface CredentialsCommit {
  readonly status: ProvidersSettingsCommit['status'];
  readonly message: string | null;
}

/** Stored main-agent tiers from `state.connectionSetup()`; the Replace draft keeps them unchanged. */
export interface CredentialsSetup {
  readonly baseUrl: string | null;
  readonly tiers: { readonly sonnet: string | null; readonly opus: string | null; readonly haiku: string | null };
}

export type CredentialsExternalAction = 'sign-in' | 'cli-check';

/**
 * The `connectProvider` draft for a verified Replace (plan :645-652). It writes the credential only:
 * - no tier edits (`editedTiers: []`, the stored tiers go in as-is so the models check passes);
 * - a custom entry goes in as a key write, so its metadata is not rewritten (Advanced owns it);
 * - `anthropic` is stored through `auth:saveSettings`, so it activates, and the tab offers it only
 *   while Claude API already drives the main agent.
 */
export function replaceKeyDraft(connection: ProvidersConnection, request: ReplaceKeyRequest,
  setup: CredentialsSetup | null): ProvidersConnectionDraft {
  const tiers = { everyday: setup?.tiers.sonnet ?? '', complex: setup?.tiers.opus ?? '', fast: setup?.tiers.haiku ?? '' };
  return {
    providerId: connection.id, displayName: connection.name,
    authMode: connection.custom || connection.authMode === 'custom' ? 'apiKey' : connection.authMode,
    customName: null, customProtocol: null,
    credential: { kind: 'apiKey', value: request.key },
    baseUrl: null, verified: { probeId: request.probeId },
    tiers, tierSnapshot: { everyday: setup?.tiers.sonnet ?? null, complex: setup?.tiers.opus ?? null, fast: setup?.tiers.haiku ?? null },
    editedTiers: [], saveTo: 'global',
    activation: connection.id === 'anthropic' ? 'use-main-agent' : 'connect-only',
  };
}

/** Fixed copy per reason. The host's `detail` is never rendered here. */
const PROBE_FAILURE_COPY: Readonly<Record<ProbeFailureReason, string>> = {
  'credential-rejected': 'The provider rejected this key.',
  'permission-denied': 'This account cannot use the requested service or model.',
  unreachable: 'Could not reach the provider. Check the connection and retry.',
  timeout: 'The provider did not answer in time. Retry.',
  'rate-limited': 'The provider is rate-limiting requests. Retry in a moment.',
  'quota-exhausted': 'This account has no available quota for the check.',
  'model-unavailable': 'The model used for the check is not available on this connection.',
  cancelled: 'Check cancelled.',
  unclassified: 'The check failed. Retry.',
  'no-stored-credential': 'No key is stored for this provider.',
  'stored-credential-mismatch': 'The stored key does not match this endpoint.',
};

const CLAUDE_LOGIN = 'claude login';
const CLAUDE_INSTALL = 'npm install -g @anthropic-ai/claude-code';

type ProbeState = 'idle' | 'checking' | 'verified' | 'failed';
let PROBE_COUNTER = 0;

/**
 * Drawer tab "Credentials" (design-spec §2.3, plan :645-658). What it holds depends on the connection:
 * - api-key / custom: a fixed mask (never a hint of the key), Replace (verify, then save), Delete key;
 * - GitHub Copilot: the account and Sign out; OpenAI Codex: login state and Open login;
 * - claude-cli: the `claude login` / install commands with Copy;
 * - local: "no key needed".
 * Every write asks for an inline confirm or a passing check first; this component never writes itself.
 */
@Component({
  selector: 'ptah-connection-credentials-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div class="space-y-4 text-sm" data-testid="connection-credentials">
      @switch (view()) {
        @case ('cli') {
          <div class="space-y-2 rounded border border-base-300 bg-base-200 p-3" data-testid="credentials-cli">
            <p class="font-semibold text-base-content">CLI subscription session</p>
            <p class="text-xs text-base-content-muted">Sign-in is managed by the Claude CLI. No API key is stored on this machine. Works with Claude Max, Pro and Team plans.</p>
            @for (command of commands; track command.text) {
              <div class="flex items-center justify-between gap-2 rounded border border-base-300 bg-base-100 px-2 py-1">
                <code class="font-mono text-xs text-base-content">{{ command.text }}</code>
                <button type="button" class="btn btn-ghost btn-xs gap-1" (click)="copy(command.text)"
                  [attr.aria-label]="'Copy ' + command.label" [attr.data-testid]="'credentials-copy-' + command.id">
                  <lucide-angular [img]="CopyIcon" class="h-3 w-3" aria-hidden="true" /> Copy
                </button>
              </div>
            }
            <p class="text-xs text-base-content-muted">Run <code class="font-mono">claude login</code> in your terminal; if the CLI is missing, install it first.</p>
            <button type="button" class="btn btn-outline btn-sm" [disabled]="busy()" (click)="externalActionRequested.emit('cli-check')"
              data-testid="credentials-cli-check">Check again</button>
          </div>
        }
        @case ('copilot') {
          <div class="space-y-2 rounded border border-base-300 bg-base-200 p-3" data-testid="credentials-copilot">
            <div class="flex items-center justify-between gap-3 text-xs">
              <span class="text-base-content-muted">Signed-in account</span>
              <span class="font-medium text-base-content" data-testid="credentials-account">{{ connection().accountLabel ?? 'GitHub account' }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between gap-3 border-t border-base-300 pt-3">
            <div class="min-w-0">
              <p class="font-semibold text-base-content">Sign out of GitHub Copilot</p>
              <p class="text-xs text-base-content-muted">Removes the Copilot sign-in from this machine.</p>
            </div>
            @if (confirming() !== 'sign-out') {
              <button type="button" class="btn btn-outline btn-sm border-error text-base-content" [disabled]="busy()"
                (click)="confirming.set('sign-out')" data-testid="credentials-sign-out">Sign out</button>
            }
          </div>
          @if (confirming() === 'sign-out') {
            <div role="group" aria-label="Confirm sign out" class="space-y-2 rounded border border-base-300 p-3" data-testid="credentials-sign-out-confirm">
              <p class="text-xs text-base-content">Sign out of GitHub Copilot on this machine?@if (isActiveDriver()) { It drives the main agent: new requests fail until you sign in again.}</p>
              <div class="flex gap-2">
                <button type="button" class="btn btn-outline btn-sm border-error text-base-content" [disabled]="busy()"
                  (click)="confirmSignOut()" data-testid="credentials-sign-out-confirm-button">Sign out</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="confirming.set(null)">Cancel</button>
              </div>
            </div>
          }
        }
        @case ('codex') {
          <div class="space-y-2 rounded border border-base-300 bg-base-200 p-3" data-testid="credentials-codex">
            <p class="flex items-center gap-1.5 font-semibold text-base-content">
              <span [class]="connection().tokenStale ? 'h-2 w-2 rounded-full bg-warning' : 'h-2 w-2 rounded-full bg-success'" aria-hidden="true"></span>
              {{ connection().tokenStale ? 'Codex login expired' : 'Signed in with the Codex CLI' }}
            </p>
            <p class="text-xs text-base-content-muted" data-testid="credentials-codex-copy">
              {{ connection().tokenStale
                ? 'The token in ~/.codex/auth.json has expired. Open login to sign in again.'
                : 'Ptah uses the Codex login stored in ~/.codex/auth.json. Open login to switch or refresh the account.' }}
            </p>
            <button type="button" class="btn btn-outline btn-sm" [disabled]="busy()" (click)="externalActionRequested.emit('sign-in')"
              data-testid="credentials-open-login">Open login</button>
          </div>
        }
        @case ('oauth') {
          <div class="space-y-2 rounded border border-base-300 bg-base-200 p-3" data-testid="credentials-oauth">
            <p class="text-xs text-base-content">Signed in with your provider account. Open login to switch or refresh it.</p>
            <button type="button" class="btn btn-outline btn-sm" [disabled]="busy()" (click)="externalActionRequested.emit('sign-in')"
              data-testid="credentials-open-login">Open login</button>
          </div>
        }
        @case ('local') {
          <p class="rounded border border-base-300 bg-base-200 p-3 text-xs text-base-content" data-testid="credentials-local">
            No key needed: this connection runs on a local server.{{ connection().hasKey ? ' An optional key is stored on this machine.' : '' }}
          </p>
        }
        @default {
          <div class="space-y-2" data-testid="credentials-key">
            <span class="block font-semibold text-base-content" id="credentials-key-label">Stored API key</span>
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 flex-1 rounded border border-base-300 bg-base-200 px-3 py-1.5 font-mono text-xs text-base-content"
                aria-labelledby="credentials-key-label" data-testid="credentials-key-mask">
                {{ connection().hasKey ? '••••••••••••••••' : 'No key stored' }}
              </span>
              @if (canReplace()) {
                <button type="button" class="btn btn-outline btn-sm" [disabled]="busy() || replacing()"
                  (click)="startReplace()" data-testid="credentials-replace">{{ connection().hasKey ? 'Replace' : 'Add key' }}</button>
              }
              @if (connection().hasKey) {
                <button type="button" class="btn btn-outline btn-sm border-error text-base-content" [disabled]="busy()"
                  (click)="confirming.set('delete')" data-testid="credentials-delete">Delete key</button>
              }
            </div>
            @if (anthropicGuidance()) {
              <p class="text-xs text-base-content-muted" data-testid="credentials-anthropic-guidance">
                A new Claude API key is saved together with choosing Claude API for the main agent. Use Connect provider → Claude API to replace it.
              </p>
            }
            @if (optionalKey()) {
              <p class="text-xs text-base-content-muted" data-testid="credentials-optional-key">
                The key is optional. Without it, requests go through your signed-in local Ollama; with an ollama.com key, Ptah connects directly and can list models and prices.
              </p>
            }
            @if (helpUrl(); as url) {
              <a [href]="url" target="_blank" rel="noopener noreferrer" class="link link-hover inline-block text-xs text-base-content"
                data-testid="credentials-get-key">Get a key →</a>
            }
          </div>

          @if (replacing()) {
            <div class="space-y-2 rounded border border-base-300 p-3" data-testid="credentials-replace-form">
              <label for="credentials-new-key" class="block text-xs font-semibold text-base-content">New API key</label>
              <div class="relative">
                <input id="credentials-new-key" [type]="keyVisible() ? 'text' : 'password'" autocomplete="off" spellcheck="false"
                  class="input input-bordered input-sm w-full pr-9 font-mono text-xs" [value]="keyDraft()" (input)="onKeyInput($event)"
                  [attr.placeholder]="keyPlaceholder()" data-testid="credentials-new-key" />
                <button type="button" class="btn btn-ghost btn-xs absolute right-1 top-1" (click)="keyVisible.set(!keyVisible())"
                  [attr.aria-label]="keyVisible() ? 'Hide API key' : 'Show API key'" [attr.aria-pressed]="keyVisible()"
                  data-testid="credentials-toggle-visibility">
                  <lucide-angular [img]="keyVisible() ? EyeOffIcon : EyeIcon" class="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              @if (connection().id === 'anthropic') {
                <p class="text-xs text-base-content-muted">Saving updates the main agent's Claude API key and restarts running chat sessions.</p>
              }
              <p role="status" class="flex items-center gap-1.5 text-xs text-base-content" data-testid="credentials-probe">
                @if (probeState() !== 'idle') { <span [class]="probeDot()" aria-hidden="true"></span> }
                {{ probeText() }}
              </p>
              <div class="flex flex-wrap gap-2">
                <button type="button" class="btn btn-outline btn-sm" [disabled]="!keyDraft().trim() || probeState() === 'checking' || busy()"
                  (click)="verify()" data-testid="credentials-verify">{{ probeState() === 'checking' ? 'Checking…' : 'Check key' }}</button>
                <button type="button" class="btn btn-primary btn-sm" [disabled]="!canSave()" (click)="save()"
                  data-testid="credentials-save">Save key</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="cancelReplace()" data-testid="credentials-cancel-replace">Cancel</button>
              </div>
            </div>
          }

          @if (confirming() === 'delete') {
            <div role="group" aria-label="Confirm delete key" class="space-y-2 rounded border border-base-300 p-3" data-testid="credentials-delete-confirm">
              <p class="text-xs text-base-content">Delete the stored key for {{ connection().name }} from this machine?</p>
              @if (isActiveDriver()) {
                <p class="flex items-center gap-1.5 text-xs text-base-content" data-testid="credentials-active-driver-warning">
                  <span class="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden="true"></span>
                  {{ connection().name }} drives the main agent. New requests fail until a key is added.
                </p>
              }
              <div class="flex gap-2">
                <button type="button" class="btn btn-outline btn-sm border-error text-base-content" [disabled]="busy()"
                  (click)="confirmDelete()" data-testid="credentials-delete-confirm-button">Delete key</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="confirming.set(null)">Cancel</button>
              </div>
            </div>
          }

          <div class="flex items-center justify-between gap-3 rounded border border-base-300 bg-base-200 p-2.5 text-xs">
            <span class="text-base-content-muted">Storage</span>
            <span class="text-base-content">Encrypted on this machine</span>
          </div>
        }
      }

      @if (externalMessage(); as message) {
        <p role="status" class="text-xs text-base-content" data-testid="credentials-external-message">{{ message }}</p>
      }
      @if (copyMessage(); as message) {
        <p role="status" class="text-xs text-base-content-muted">{{ message }}</p>
      }
      @if (commitView(); as feedback) {
        <p [attr.role]="feedback.alert ? 'alert' : 'status'" class="flex items-start gap-1.5 text-xs text-base-content" data-testid="credentials-commit">
          <span [class]="feedback.dot" aria-hidden="true"></span> {{ feedback.text }}
        </p>
      }
    </div>
  `,
})
export class CredentialsTabComponent {
  readonly connection = input.required<ProvidersConnection>();
  readonly kind = input.required<ConnectionKind>();
  /** This connection drives the main agent now. */
  readonly isActiveDriver = input(false);
  /** A settings save is in flight: no write or check starts under it. */
  readonly saving = input(false);
  /** Stored endpoint and tiers (`state.connectionSetup()`); a custom key can be checked only with its endpoint. */
  readonly setup = input<CredentialsSetup | null>(null);
  readonly commit = input<CredentialsCommit | null>(null);
  /** The host's fixed sign-in message for this connection. */
  readonly externalMessage = input<string | null>(null);
  readonly verifyDraftConnection = input.required<VerifyDraftFn>();
  readonly cancelDraftVerification = input.required<CancelDraftFn>();
  readonly replaceKeyRequested = output<ReplaceKeyRequest>();
  readonly deleteKeyRequested = output<void>();
  readonly signOutRequested = output<void>();
  readonly externalActionRequested = output<CredentialsExternalAction>();

  protected readonly CopyIcon = Copy;
  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly commands = [
    { id: 'login', label: 'claude login command', text: CLAUDE_LOGIN },
    { id: 'install', label: 'install command', text: CLAUDE_INSTALL },
  ] as const;

  protected readonly confirming = signal<'delete' | 'sign-out' | null>(null);
  protected readonly replacing = signal(false);
  /** The typed key. Cleared on save, cancel, connection change and destroy; never leaves except in `replaceKeyRequested`. */
  protected readonly keyDraft = signal('');
  protected readonly keyVisible = signal(false);
  protected readonly probeState = signal<ProbeState>('idle');
  protected readonly probeResult = signal<AuthVerifyDraftConnectionResult | null>(null);
  protected readonly copyMessage = signal<string | null>(null);
  /** The write this tab started, so its outcome is read from `commit` (D15: never "Saved" after a failure). */
  private readonly pendingWrite = signal<'replace' | 'delete' | 'sign-out' | null>(null);
  private probeId: string | null = null;
  private readonly connectionId = computed(() => this.connection().id);

  protected readonly view = computed(() => {
    const connection = this.connection();
    if (connection.id === 'github-copilot') return 'copilot';
    if (connection.id === 'openai-codex') return 'codex';
    switch (this.kind()) {
      case 'claude-cli': return 'cli';
      case 'oauth': return 'oauth';
      case 'local': return 'local';
      default: return 'key';
    }
  });
  private readonly registryEntry = computed(() => getAnthropicProvider(this.connection().id) ?? null);
  protected readonly helpUrl = computed(() => {
    const url = this.registryEntry()?.helpUrl ?? '';
    return /^https:\/\//.test(url) ? url : null;
  });
  protected readonly optionalKey = computed(() => this.registryEntry()?.supportsOptionalApiKey === true);
  protected readonly keyPlaceholder = computed(() => {
    const prefix = this.registryEntry()?.keyPrefix ?? '';
    return prefix ? `Starts with ${prefix}` : 'Paste the new key';
  });
  /** `anthropic` is replaced only while it drives the main agent (plan :649-652). */
  protected readonly anthropicGuidance = computed(() => this.connection().id === 'anthropic' && !this.isActiveDriver());
  protected readonly canReplace = computed(() =>
    !this.anthropicGuidance() && (this.kind() !== 'custom' || !!this.setup()?.baseUrl));
  protected readonly busy = computed(() => this.saving() || this.commit()?.status === 'saving');
  protected readonly canSave = computed(() => this.probeState() === 'verified' && !!this.keyDraft().trim() && !this.busy()
    && this.probeResult()?.probeId === this.probeId);
  protected readonly probeText = computed(() => {
    const result = this.probeResult();
    const latency = result?.latencyMs !== null && result?.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : '';
    switch (this.probeState()) {
      case 'checking': return 'Checking the key…';
      case 'verified': return `Key verified${latency}. Save it to replace the stored key.`;
      case 'failed': return `Check failed${latency}: ${PROBE_FAILURE_COPY[result?.reason ?? 'unclassified'] ?? PROBE_FAILURE_COPY.unclassified} Nothing was saved.`;
      default: return 'Check the key before saving it.';
    }
  });
  protected readonly probeDot = computed(() =>
    `h-2 w-2 shrink-0 rounded-full ${this.probeState() === 'verified' ? 'bg-success' : this.probeState() === 'failed' ? 'bg-error' : 'bg-base-content-muted'}`);
  protected readonly commitView = computed(() => {
    const commit = this.commit();
    if (!this.pendingWrite() || !commit || commit.status === 'idle') return null;
    const dot = (tone: string) => `mt-1 h-2 w-2 shrink-0 rounded-full ${tone}`;
    switch (commit.status) {
      case 'saving': return { text: 'Saving…', dot: dot('bg-base-content-muted'), alert: false };
      case 'saved': return { text: this.savedText(), dot: dot('bg-success'), alert: false };
      case 'unconfirmed': return { text: `Save not confirmed. ${commit.message ?? ''}`.trim(), dot: dot('bg-warning'), alert: true };
      default: return { text: `Not saved. ${commit.message ?? ''}`.trim(), dot: dot('bg-error'), alert: true };
    }
  });

  constructor() {
    // Another connection: nothing typed or confirmed for the previous one survives.
    // Keyed on the id: a refreshed connection object (same id) keeps the form.
    effect(() => {
      this.connectionId();
      untracked(() => this.resetReplace());
      untracked(() => { this.confirming.set(null); this.pendingWrite.set(null); });
    });
    // A saved Replace closes the form and drops the key.
    effect(() => {
      if (this.commit()?.status === 'saved' && this.pendingWrite() === 'replace') untracked(() => this.resetReplace());
    });
    inject(DestroyRef).onDestroy(() => this.resetReplace());
  }

  protected startReplace(): void {
    this.confirming.set(null);
    this.replacing.set(true);
  }

  protected cancelReplace(): void {
    this.resetReplace();
  }

  protected onKeyInput(event: Event): void {
    this.keyDraft.set((event.target as HTMLInputElement).value);
    // A check belongs to the key it ran on: an edit needs a new check before Save.
    if (this.probeState() !== 'idle') this.abandonProbe();
  }

  protected verify(): void {
    const key = this.keyDraft().trim();
    if (!key || this.probeState() === 'checking') return;
    const connection = this.connection();
    const probeId = `drawer-probe-${(PROBE_COUNTER += 1)}`;
    this.probeId = probeId;
    this.probeState.set('checking');
    this.probeResult.set(null);
    const custom = this.kind() === 'custom';
    const params: AuthVerifyDraftConnectionParams = {
      probeId, providerId: connection.id,
      authMode: custom ? 'custom' : connection.authMode,
      credential: { kind: 'apiKey', value: key },
      ...(custom && this.setup()?.baseUrl ? { baseUrl: this.setup()?.baseUrl ?? '' } : {}),
    };
    void this.verifyDraftConnection()(params).then((result) => {
      if (this.probeId !== probeId || result.probeId !== probeId) return;
      this.probeResult.set(result);
      this.probeState.set(result.outcome === 'verified' ? 'verified' : 'failed');
    }).catch(() => {
      if (this.probeId !== probeId) return;
      this.probeResult.set({ probeId, outcome: 'failed', reason: 'unclassified', detail: null, latencyMs: null,
        modelUsed: null, checkedAt: new Date().toISOString() });
      this.probeState.set('failed');
    });
  }

  protected save(): void {
    const probeId = this.probeId;
    if (!this.canSave() || !probeId) return;
    this.pendingWrite.set('replace');
    this.replaceKeyRequested.emit({ key: this.keyDraft().trim(), probeId });
  }

  protected confirmDelete(): void {
    this.confirming.set(null);
    this.pendingWrite.set('delete');
    this.deleteKeyRequested.emit();
  }

  protected confirmSignOut(): void {
    this.confirming.set(null);
    this.pendingWrite.set('sign-out');
    this.signOutRequested.emit();
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copyMessage.set(`Copied "${text}".`);
    } catch {
      this.copyMessage.set('Copy is not available here. Select the command and copy it.');
    }
  }

  private savedText(): string {
    switch (this.pendingWrite()) {
      case 'replace': return 'Key replaced.';
      case 'delete': return 'Stored key deleted.';
      default: return 'Signed out.';
    }
  }

  /** Drops the typed key and any check of it, cancelling a check still running on the host. */
  private resetReplace(): void {
    this.abandonProbe();
    this.keyDraft.set('');
    this.keyVisible.set(false);
    this.replacing.set(false);
  }

  private abandonProbe(): void {
    const probeId = this.probeId;
    if (probeId && this.probeState() === 'checking') {
      void this.cancelDraftVerification()({ probeId }).catch(() => undefined);
    }
    this.probeId = null;
    this.probeState.set('idle');
    this.probeResult.set(null);
  }
}
