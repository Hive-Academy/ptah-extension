import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VSCodeService } from '@ptah-extension/core';
import type {
  GatewayBindingDto,
  GatewayPlatformId,
} from '@ptah-extension/shared';

import { GatewayStateService } from '../services/gateway-state.service';

interface PlatformCardConfig {
  readonly id: GatewayPlatformId;
  readonly label: string;
  readonly tokenPlaceholder: string;
  readonly hasAppToken: boolean;
}

const PLATFORM_CARDS: readonly PlatformCardConfig[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    tokenPlaceholder: 'Paste bot token (123456:ABC-...)',
    hasAppToken: false,
  },
  {
    id: 'discord',
    label: 'Discord',
    tokenPlaceholder: 'Paste bot token (MTAxNzU...)',
    hasAppToken: false,
  },
  {
    id: 'slack',
    label: 'Slack',
    tokenPlaceholder: 'Paste bot token (xoxb-...)',
    hasAppToken: true,
  },
];

/**
 * MessagingGatewayTabComponent
 *
 * Gateway tab inside the Hermes shell. Renders:
 * - master enable toggle
 * - per-platform card with token input (cleared after dispatch),
 *   status chip, and "Send test" button
 * - pending-bindings approval queue with code-entry input
 * - read-only voice toggle and rate-limit display
 * - one-time voice-model download toast
 *
 * VS Code parity: gated on `vscode.isElectron`. In VS Code the placeholder
 * informs the user that gateway adapters are Electron-only.
 *
 * SECURITY: token input fields are local-only signals that are reset to ''
 * synchronously after `setToken` resolves (or rejects). Tokens are never
 * stored in any service signal, never logged, and never persisted to webview
 * state (`localStorage`/`sessionStorage`).
 */
@Component({
  selector: 'ptah-messaging-gateway-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    @if (!isElectron) {
      <div role="alert" class="alert alert-info">
        <span>
          Messaging gateway is only available in the Ptah desktop app.
          <a
            class="link link-primary ml-1"
            href="https://github.com/ptah-extensions/ptah-extension/releases"
            rel="noopener noreferrer"
            target="_blank"
            >Download Ptah desktop</a
          >
        </span>
      </div>
    } @else {
      <div class="flex h-full w-full flex-col gap-4">
        <!-- Master enable -->
        <section
          class="card bg-base-200 shadow-sm"
          aria-label="Gateway master toggle"
        >
          <div class="card-body flex-row items-center justify-between p-4">
            <div>
              <h2 class="card-title text-sm">Messaging gateway</h2>
              <p class="text-xs text-base-content/60">
                {{
                  enabled()
                    ? 'Gateway running. Per-platform adapters managed below.'
                    : 'Gateway stopped. Add a token to a platform to start it.'
                }}
              </p>
            </div>
            <div class="badge badge-sm" [class.badge-success]="enabled()">
              {{ enabled() ? 'enabled' : 'disabled' }}
            </div>
          </div>
        </section>

        <!-- Voice toast (one-time per session) -->
        @if (voiceDownload(); as v) {
          <div
            role="status"
            aria-live="polite"
            class="alert"
            [class.alert-info]="!v.error"
            [class.alert-error]="!!v.error"
          >
            <div class="flex flex-1 flex-col gap-1">
              <span class="text-sm">
                @if (v.error) {
                  Failed to download Whisper model
                  <span class="font-mono">{{ v.modelName }}</span
                  >: {{ v.error }}
                } @else if (v.done) {
                  Whisper model
                  <span class="font-mono">{{ v.modelName }}</span> ready.
                } @else {
                  Downloading Whisper model
                  <span class="font-mono">{{ v.modelName }}</span> &mdash;
                  {{ v.percent.toFixed(0) }}%
                }
              </span>
              @if (!v.error && !v.done) {
                <progress
                  class="progress progress-primary w-full"
                  [value]="v.percent"
                  max="100"
                ></progress>
              }
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              (click)="onDismissVoiceToast()"
            >
              Dismiss
            </button>
          </div>
        }

        <!-- Per-platform cards -->
        @for (cfg of platformCards; track cfg.id) {
          <section
            class="card bg-base-200 shadow-sm"
            [attr.aria-label]="cfg.label + ' adapter'"
          >
            <div class="card-body p-4">
              <div class="flex items-center justify-between">
                <h3 class="card-title text-sm">{{ cfg.label }}</h3>
                <span
                  class="badge badge-sm"
                  [class.badge-success]="statusFor(cfg.id) === 'running'"
                  [class.badge-warning]="statusFor(cfg.id) === 'starting'"
                  [class.badge-error]="statusFor(cfg.id) === 'error'"
                  [class.badge-ghost]="statusFor(cfg.id) === 'stopped'"
                >
                  {{ statusFor(cfg.id) }}
                </span>
              </div>

              @if (errorFor(cfg.id); as msg) {
                <div role="alert" class="alert alert-error mt-2 py-2 text-xs">
                  <span>{{ msg }}</span>
                </div>
              }

              <!-- Token form -->
              <form
                class="mt-3 flex flex-col gap-2"
                (submit)="onSubmitToken(cfg.id, $event)"
              >
                <label class="form-control w-full">
                  <span class="label-text text-xs">Bot token</span>
                  <input
                    type="password"
                    autocomplete="new-password"
                    autocorrect="off"
                    autocapitalize="off"
                    spellcheck="false"
                    name="bot-token"
                    class="input input-bordered input-sm font-mono"
                    [placeholder]="cfg.tokenPlaceholder"
                    [value]="tokenInputValue(cfg.id)"
                    (input)="onTokenInput(cfg.id, 'bot', $event)"
                    [attr.aria-label]="cfg.label + ' bot token'"
                  />
                </label>

                @if (cfg.hasAppToken) {
                  <label class="form-control w-full">
                    <span class="label-text text-xs">
                      App-level token (xapp-...)
                    </span>
                    <input
                      type="password"
                      autocomplete="new-password"
                      autocorrect="off"
                      autocapitalize="off"
                      spellcheck="false"
                      name="app-token"
                      class="input input-bordered input-sm font-mono"
                      placeholder="Paste app-level token (xapp-...)"
                      [value]="appTokenInputValue(cfg.id)"
                      (input)="onTokenInput(cfg.id, 'app', $event)"
                      [attr.aria-label]="cfg.label + ' app-level token'"
                    />
                  </label>
                }

                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs text-base-content/60">
                    Tokens are encrypted by the OS keychain and never persisted
                    in the renderer.
                  </span>
                  <button
                    type="submit"
                    class="btn btn-primary btn-sm"
                    [disabled]="
                      submittingFor(cfg.id) || !canSubmit(cfg.id, cfg)
                    "
                  >
                    @if (submittingFor(cfg.id)) {
                      Saving&hellip;
                    } @else {
                      Save & start
                    }
                  </button>
                </div>
              </form>

              <!-- Allow-list editor -->
              <label class="form-control mt-3 w-full">
                <span class="label-text text-xs">
                  Allow-list ({{ cfg.label }})
                  <span class="text-base-content/50">
                    — one entry per line; configured in
                    <span class="font-mono">~/.ptah/settings.json</span>
                  </span>
                </span>
                <textarea
                  class="textarea textarea-bordered textarea-sm mt-1 w-full font-mono"
                  rows="3"
                  readonly
                  [attr.aria-label]="cfg.label + ' allow-list (read-only)'"
                  [value]="allowListPlaceholder"
                ></textarea>
              </label>

              <!-- Send test -->
              <div class="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  [disabled]="!canSendTest(cfg.id)"
                  (click)="onSendTest(cfg.id)"
                >
                  Send test
                </button>
                @if (testResultFor(cfg.id); as r) {
                  <span
                    class="text-xs"
                    [class.text-success]="r.ok"
                    [class.text-error]="!r.ok"
                  >
                    {{ r.message }}
                  </span>
                }
              </div>
            </div>
          </section>
        }

        @if (approvalToast(); as msg) {
          <div role="alert" class="alert alert-error">
            <span class="text-sm">{{ msg }}</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              (click)="onDismissApprovalToast()"
            >
              Dismiss
            </button>
          </div>
        }

        <!-- Pending bindings approval queue -->
        <section
          class="card bg-base-200 shadow-sm"
          aria-label="Pending bindings"
        >
          <div class="card-body p-4">
            <h3 class="card-title text-sm">Pending bindings</h3>
            @if (pendingBindings().length === 0) {
              <p class="text-xs text-base-content/60">
                No pending requests. New bindings appear here after a user
                messages the bot.
              </p>
            } @else {
              <ul class="mt-2 flex flex-col gap-2">
                @for (b of pendingBindings(); track b.id) {
                  <li
                    class="flex flex-col gap-2 rounded border border-base-300 p-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div class="flex flex-col">
                      <span class="text-sm font-medium">
                        {{ b.platform }}
                      </span>
                      <span class="text-xs text-base-content/60">
                        Awaiting code from bot — paste the code the bot sent
                        you.
                      </span>
                    </div>
                    <div class="flex items-center gap-2">
                      <input
                        type="text"
                        autocomplete="off"
                        class="input input-bordered input-xs w-24 font-mono"
                        placeholder="code"
                        [value]="bindingCodeFor(b.id)"
                        (input)="onBindingCodeInput(b.id, $event)"
                        [attr.aria-label]="
                          'Pairing code for ' + b.platform + ' binding'
                        "
                      />
                      <button
                        type="button"
                        class="btn btn-success btn-xs"
                        [disabled]="!bindingCodeFor(b.id)"
                        (click)="onApprove(b)"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        class="btn btn-error btn-outline btn-xs"
                        (click)="onReject(b)"
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                }
              </ul>
            }
          </div>
        </section>

        <!-- Approved bindings (revoke target) -->
        @if (approvedBindings().length > 0) {
          <section
            class="card bg-base-200 shadow-sm"
            aria-label="Approved bindings"
          >
            <div class="card-body p-4">
              <h3 class="card-title text-sm">Approved bindings</h3>
              <ul class="mt-2 flex flex-col gap-2">
                @for (b of approvedBindings(); track b.id) {
                  <li
                    class="flex items-center justify-between rounded border border-base-300 p-2"
                  >
                    <div class="flex flex-col">
                      <span class="text-sm font-medium">
                        {{ b.platform }}
                      </span>
                      <span class="text-xs text-base-content/60">
                        {{ b.displayName ?? '—' }}
                        @if (b.lastActiveAt) {
                          · last active
                          {{ formatTime(b.lastActiveAt) }}
                        }
                      </span>
                    </div>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      (click)="onRevoke(b)"
                    >
                      Revoke
                    </button>
                  </li>
                }
              </ul>
            </div>
          </section>
        }

        <!-- Voice + rate-limit (read-only) -->
        <section
          class="card bg-base-200 shadow-sm"
          aria-label="Voice and rate-limit settings"
        >
          <div class="card-body p-4">
            <h3 class="card-title text-sm">Voice & rate-limit (read-only)</h3>
            <p class="text-xs text-base-content/60">
              Configure these in
              <span class="font-mono">~/.ptah/settings.json</span>.
            </p>
            <ul class="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              <li class="font-mono">
                gateway.voice.enabled =
                <span class="text-base-content/70">{{ voiceEnabled() }}</span>
              </li>
              <li class="font-mono">
                gateway.voice.whisperModel =
                <span class="text-base-content/70">{{ whisperModel() }}</span>
              </li>
              <li class="font-mono">
                gateway.rateLimit.minTimeMs =
                <span class="text-base-content/70">
                  {{ rateLimit().minTimeMs }}
                </span>
              </li>
              <li class="font-mono">
                gateway.rateLimit.maxConcurrent =
                <span class="text-base-content/70">
                  {{ rateLimit().maxConcurrent }}
                </span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    }
  `,
})
export class MessagingGatewayTabComponent implements OnInit {
  private readonly state = inject(GatewayStateService);
  private readonly vscode = inject(VSCodeService);

  protected readonly platformCards = PLATFORM_CARDS;
  protected readonly allowListPlaceholder =
    'Configured in settings file (gateway.allowList.<platform>).';

  // Re-export state signals for the template.
  protected readonly enabled = this.state.enabled;
  protected readonly platforms = this.state.platforms;
  protected readonly pendingBindings = this.state.pendingBindings;
  protected readonly approvedBindings = this.state.approvedBindings;
  protected readonly voiceEnabled = this.state.voiceEnabled;
  protected readonly whisperModel = this.state.whisperModel;
  protected readonly rateLimit = this.state.rateLimit;
  protected readonly voiceDownload = this.state.voiceDownload;

  /**
   * Local-only token signals — one per (platform, kind). These are the ONLY
   * places a plaintext token lives in the renderer. They are reset to '' in
   * the `finally` of `submitToken` so the field clears regardless of outcome.
   */
  private readonly tokenInputs = signal<Record<string, string>>({});
  private readonly submittingPlatforms = signal<
    Record<GatewayPlatformId, boolean>
  >({ telegram: false, discord: false, slack: false });

  /** Pending-binding code-entry inputs, keyed by binding id. */
  private readonly bindingCodes = signal<Record<string, string>>({});

  /** Transient toast for binding-approval feedback (code mismatch, etc.). */
  protected readonly approvalToast = signal<string | null>(null);

  protected readonly testResults = computed(() => this.state.testResult());

  public get isElectron(): boolean {
    return this.vscode.isElectron;
  }

  public ngOnInit(): void {
    if (!this.isElectron) return;
    void this.state.initialize();
  }

  // ── Token input plumbing ───────────────────────────────────────────────

  protected tokenInputValue(platform: GatewayPlatformId): string {
    return this.tokenInputs()[`${platform}:bot`] ?? '';
  }

  protected appTokenInputValue(platform: GatewayPlatformId): string {
    return this.tokenInputs()[`${platform}:app`] ?? '';
  }

  protected onTokenInput(
    platform: GatewayPlatformId,
    kind: 'bot' | 'app',
    event: Event,
  ): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    const key = `${platform}:${kind}`;
    const value = target.value;
    this.tokenInputs.update((current) => ({ ...current, [key]: value }));
  }

  protected canSubmit(
    platform: GatewayPlatformId,
    cfg: PlatformCardConfig,
  ): boolean {
    const bot = this.tokenInputs()[`${platform}:bot`] ?? '';
    if (bot.trim().length === 0) return false;
    if (cfg.hasAppToken) {
      const app = this.tokenInputs()[`${platform}:app`] ?? '';
      if (app.trim().length === 0) return false;
    }
    return true;
  }

  protected submittingFor(platform: GatewayPlatformId): boolean {
    return this.submittingPlatforms()[platform] === true;
  }

  protected async onSubmitToken(
    platform: GatewayPlatformId,
    event: Event,
  ): Promise<void> {
    event.preventDefault();
    const tokens = this.tokenInputs();
    const bot = tokens[`${platform}:bot`] ?? '';
    const app = tokens[`${platform}:app`];
    if (bot.trim().length === 0) return;

    this.submittingPlatforms.update((current) => ({
      ...current,
      [platform]: true,
    }));

    try {
      if (platform === 'slack') {
        await this.state.setToken(platform, bot, app ?? '');
      } else {
        await this.state.setToken(platform, bot);
      }
    } catch {
      // recordPlatformError already wrote the error to state — swallow here
      // because the UI surfaces it via `errorFor()`. We deliberately do NOT
      // log the error object: stack traces from token-handling RPCs may
      // contain redacted-but-still-sensitive context.
    } finally {
      // SECURITY: clear the token fields synchronously regardless of outcome.
      this.tokenInputs.update((current) => {
        const next = { ...current };
        next[`${platform}:bot`] = '';
        next[`${platform}:app`] = '';
        return next;
      });
      this.submittingPlatforms.update((current) => ({
        ...current,
        [platform]: false,
      }));
    }
  }

  // ── Status helpers ─────────────────────────────────────────────────────

  protected statusFor(
    platform: GatewayPlatformId,
  ): 'stopped' | 'starting' | 'running' | 'error' {
    return this.platforms()[platform].state;
  }

  protected errorFor(platform: GatewayPlatformId): string | null {
    return (
      this.state.lastError()[platform] ??
      this.platforms()[platform].lastError ??
      null
    );
  }

  protected canSendTest(platform: GatewayPlatformId): boolean {
    return (
      this.statusFor(platform) === 'running' &&
      this.state.hasApprovedBindingFor(platform)
    );
  }

  protected testResultFor(
    platform: GatewayPlatformId,
  ): { ok: boolean; message: string } | null {
    const r = this.testResults();
    if (!r || r.platform !== platform) return null;
    return { ok: r.ok, message: r.message };
  }

  protected async onSendTest(platform: GatewayPlatformId): Promise<void> {
    try {
      await this.state.sendTest(platform);
    } catch {
      // testResult already recorded — surface via template.
    }
  }

  // ── Bindings queue ─────────────────────────────────────────────────────

  protected bindingCodeFor(bindingId: string): string {
    return this.bindingCodes()[bindingId] ?? '';
  }

  protected onBindingCodeInput(bindingId: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    const value = target.value;
    this.bindingCodes.update((current) => ({ ...current, [bindingId]: value }));
  }

  protected async onApprove(binding: GatewayBindingDto): Promise<void> {
    // Architecture §9: codes are NEVER returned by listBindings. The user
    // must enter the code their bot received; the backend compares it with
    // a constant-time check (gateway.service.ts approveBinding). We still
    // gate the button locally on a non-empty code so we don't dispatch
    // obviously-empty approvals.
    const code = this.bindingCodes()[binding.id]?.trim();
    if (!code) return;
    const result = await this.state.approveBinding(binding.id, code);
    if (!result.ok) {
      // Code mismatch — clear the entered code so the user can try again.
      this.bindingCodes.update((current) => {
        const next = { ...current };
        next[binding.id] = '';
        return next;
      });
      this.approvalToast.set(
        result.error === 'invalid-code'
          ? 'Code mismatch — try again'
          : `Approval failed: ${result.error}`,
      );
      return;
    }
    this.approvalToast.set(null);
    this.bindingCodes.update((current) => {
      const next = { ...current };
      delete next[binding.id];
      return next;
    });
  }

  protected onDismissApprovalToast(): void {
    this.approvalToast.set(null);
  }

  protected async onReject(binding: GatewayBindingDto): Promise<void> {
    await this.state.rejectBinding(binding.id);
    this.bindingCodes.update((current) => {
      const next = { ...current };
      delete next[binding.id];
      return next;
    });
  }

  protected async onRevoke(binding: GatewayBindingDto): Promise<void> {
    await this.state.revokeBinding(binding.id);
  }

  // ── Voice toast ────────────────────────────────────────────────────────

  protected onDismissVoiceToast(): void {
    this.state.dismissVoiceToast();
  }

  protected formatTime(epochMs: number | null): string {
    if (epochMs === null || !Number.isFinite(epochMs)) return '—';
    return new Date(epochMs).toLocaleString();
  }
}
