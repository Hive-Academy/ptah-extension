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
 * View Channel + Send Messages + Create Public Threads + Send Messages in
 * Threads — the minimum the Discord adapter needs to create per-conversation
 * threads and stream replies into them.
 */
const DISCORD_INVITE_PERMISSIONS = '292057779200';

function describeRegisterError(error: string): string {
  if (error === 'missing-application-id') {
    return 'set & save the Application ID first';
  }
  if (error === 'missing-token') return 'save the bot token first';
  return error;
}

/**
 * MessagingGatewayTabComponent
 *
 * Gateway tab inside the Thoth shell. Renders:
 * - master enable toggle
 * - per-platform card with token input (cleared after dispatch),
 *   status chip, and "Send test" button
 * - pending-bindings approval queue with code-entry input
 * - read-only voice toggle and rate-limit display
 * - one-time voice-model download toast
 * - right-side "Setup guide" drawer with platform configuration steps
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
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                (click)="toggleHelp()"
                aria-label="Open gateway setup guide"
              >
                Setup guide
              </button>
              <div class="badge badge-sm" [class.badge-success]="enabled()">
                {{ enabled() ? 'enabled' : 'disabled' }}
              </div>
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
            [attr.data-testid]="'gateway-platform-card-' + cfg.id"
          >
            <div class="card-body p-4">
              <div class="flex items-center justify-between">
                <h3 class="card-title text-sm">{{ cfg.label }}</h3>
                <span
                  class="badge badge-sm"
                  [attr.data-testid]="'gateway-platform-status-' + cfg.id"
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
                    — one ID per line. Empty = accept any sender it can see.
                  </span>
                </span>
                <textarea
                  class="textarea textarea-bordered textarea-sm mt-1 w-full font-mono"
                  rows="3"
                  [attr.data-testid]="'gateway-allowlist-' + cfg.id"
                  [attr.aria-label]="cfg.label + ' allow-list'"
                  [value]="allowListValue(cfg.id)"
                  (input)="onAllowListInput(cfg.id, $event)"
                ></textarea>
                <div class="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    class="btn btn-outline btn-xs"
                    [attr.data-testid]="'gateway-allowlist-save-' + cfg.id"
                    (click)="onSaveAllowList(cfg.id)"
                  >
                    Save allow-list
                  </button>
                  @if (allowListFeedbackFor(cfg.id); as fb) {
                    <span class="text-xs text-base-content/70">{{ fb }}</span>
                  }
                </div>
              </label>

              @if (cfg.id === 'discord') {
                <div
                  class="mt-3 flex flex-col gap-2 rounded border border-base-300 p-3"
                  data-testid="gateway-discord-integration"
                >
                  <h4 class="text-xs font-semibold">Discord integration</h4>

                  <label class="form-control w-full">
                    <span class="label-text text-xs">
                      Application (client) ID
                    </span>
                    <div class="flex items-center gap-2">
                      <input
                        type="text"
                        autocomplete="off"
                        class="input input-bordered input-sm w-full font-mono"
                        placeholder="e.g. 1512896140939362527"
                        data-testid="gateway-discord-appid"
                        [value]="discordAppIdValue()"
                        (input)="onDiscordAppIdInput($event)"
                        aria-label="Discord application id"
                      />
                      <button
                        type="button"
                        class="btn btn-outline btn-sm"
                        data-testid="gateway-discord-appid-save"
                        (click)="onSaveDiscordAppId()"
                      >
                        Save
                      </button>
                    </div>
                  </label>

                  <div class="flex flex-wrap items-center gap-2">
                    @if (discordInviteUrl(); as url) {
                      <a
                        class="btn btn-primary btn-sm"
                        [href]="url"
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="gateway-discord-invite"
                      >
                        Add to your server
                      </a>
                    } @else {
                      <span class="text-xs text-base-content/50">
                        Enter the Application ID to generate an invite link.
                      </span>
                    }
                    <button
                      type="button"
                      class="btn btn-outline btn-sm"
                      data-testid="gateway-discord-register"
                      [disabled]="registering()"
                      (click)="onRegisterDiscordCommands()"
                    >
                      @if (registering()) {
                        Registering&hellip;
                      } @else {
                        Register /ptah
                      }
                    </button>
                  </div>

                  @if (registerFeedback(); as fb) {
                    <span
                      class="text-xs text-base-content/70"
                      data-testid="gateway-discord-register-feedback"
                      >{{ fb }}</span
                    >
                  }
                  <!-- Server picker -->
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between">
                      <span class="label-text text-xs">
                        Allowed servers
                        <span class="text-base-content/50">
                          — tick to allow; empty = any server the bot is in
                        </span>
                      </span>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        data-testid="gateway-discord-guilds-refresh"
                        (click)="onRefreshGuilds()"
                      >
                        Refresh
                      </button>
                    </div>
                    @if (discordGuilds().length === 0) {
                      <span class="text-xs text-base-content/50">
                        Start the bot, then Refresh to pick servers by name (or
                        add IDs in the allow-list above).
                      </span>
                    } @else {
                      @for (g of discordGuilds(); track g.id) {
                        <label
                          class="flex items-center gap-2 text-xs"
                          [attr.data-testid]="'gateway-discord-guild-' + g.id"
                        >
                          <input
                            type="checkbox"
                            class="checkbox checkbox-xs"
                            [checked]="isGuildAllowed(g.id)"
                            (change)="onToggleGuild(g.id)"
                            [attr.aria-label]="'Allow server ' + g.name"
                          />
                          <span>{{ g.name }}</span>
                        </label>
                      }
                    }
                  </div>

                  <span class="text-xs text-base-content/50">
                    Invite grants View Channel, Send Messages, Create Public
                    Threads, and Send Messages in Threads. Enable the Message
                    Content intent in the Developer Portal for free-form
                    replies.
                  </span>
                </div>
              }

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
              <p
                class="text-xs text-base-content/60"
                data-testid="gateway-binding-empty"
              >
                No pending requests. New bindings appear here after a user
                messages the bot.
              </p>
            } @else {
              <ul class="mt-2 flex flex-col gap-2">
                @for (b of pendingBindings(); track b.id) {
                  <li
                    data-testid="gateway-pending-binding-row"
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
                        data-testid="gateway-approve-code"
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
                        data-testid="gateway-approve-btn"
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
                      @if (canAllowSender(b)) {
                        <button
                          type="button"
                          class="btn btn-outline btn-xs"
                          [attr.data-testid]="'gateway-allow-sender-' + b.id"
                          (click)="onAllowSender(b)"
                        >
                          {{ allowSenderLabel(b.platform) }}
                        </button>
                      }
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
                    <div class="flex items-center gap-2">
                      @if (canAllowSender(b)) {
                        <button
                          type="button"
                          class="btn btn-outline btn-xs"
                          [attr.data-testid]="'gateway-allow-sender-' + b.id"
                          (click)="onAllowSender(b)"
                        >
                          {{ allowSenderLabel(b.platform) }}
                        </button>
                      }
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        (click)="onRevoke(b)"
                      >
                        Revoke
                      </button>
                    </div>
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

      @if (helpOpen()) {
        <div
          class="fixed inset-0 z-40 bg-black/40"
          (click)="closeHelp()"
          aria-hidden="true"
        ></div>
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Gateway setup guide"
          tabindex="-1"
          (keydown.escape)="closeHelp()"
          class="fixed inset-y-0 right-0 z-50 w-96 max-w-full overflow-y-auto bg-base-100 shadow-xl"
        >
          <div
            class="sticky top-0 flex items-center justify-between border-b border-base-300 bg-base-100 p-4"
          >
            <h2 class="text-base font-semibold">Gateway setup</h2>
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              (click)="closeHelp()"
              aria-label="Close gateway setup guide"
            >
              ✕
            </button>
          </div>

          <div class="flex flex-col gap-4 p-4 text-sm">
            <section>
              <h3 class="mb-1 text-sm font-semibold">Overview</h3>
              <p class="text-xs text-base-content/70">
                Configure a bot token per platform, approve the pairing request,
                then chat from the platform.
              </p>
            </section>

            <section>
              <h3 class="mb-1 text-sm font-semibold">Discord setup</h3>
              <ol
                class="list-decimal space-y-1 pl-5 text-xs text-base-content/70"
              >
                <li>
                  Create an app at the Discord Developer Portal and copy the Bot
                  token.
                </li>
                <li>
                  Invite the bot with the <span class="font-mono">bot</span> and
                  <span class="font-mono">applications.commands</span> OAuth2
                  scopes and the "Send Messages" permission.
                </li>
                <li>
                  Register the <span class="font-mono">/ptah</span> slash
                  command with a required string option named
                  <span class="font-mono">prompt</span> (Ptah does not
                  auto-register it).
                </li>
                <li>Paste the bot token above and click "Save & start".</li>
                <li>
                  Add your server ID to
                  <span class="font-mono">gateway.discord.allowedGuildIds</span>
                  (an array) in
                  <span class="font-mono">~/.ptah/settings.json</span>.
                </li>
                <li>
                  Send <span class="font-mono">/ptah</span> once — the bot
                  replies with a pairing code; approve it in the Pending
                  bindings section below.
                </li>
              </ol>
            </section>

            <section>
              <h3 class="mb-1 text-sm font-semibold">Telegram setup</h3>
              <ol
                class="list-decimal space-y-1 pl-5 text-xs text-base-content/70"
              >
                <li>
                  Create a bot via <span class="font-mono">@BotFather</span> and
                  copy the token.
                </li>
                <li>Paste it above and Save & start.</li>
                <li>
                  Add allowed user IDs to
                  <span class="font-mono">gateway.telegram.allowedUserIds</span
                  >.
                </li>
                <li>Message the bot, then approve the pairing code.</li>
              </ol>
            </section>

            <section>
              <h3 class="mb-1 text-sm font-semibold">Allow-list</h3>
              <p class="text-xs text-base-content/70">
                Allow-list keys live in
                <span class="font-mono">~/.ptah/settings.json</span> under
                <span class="font-mono">gateway.discord.allowedGuildIds</span>,
                <span class="font-mono">gateway.telegram.allowedUserIds</span>,
                <span class="font-mono">gateway.slack.allowedTeamIds</span> (one
                nested array each). If empty, that platform accepts any sender
                it can see — set at least one to lock it down.
              </p>
            </section>

            <section>
              <h3 class="mb-1 text-sm font-semibold">Pairing</h3>
              <p class="text-xs text-base-content/70">
                The first message from a new sender creates a pending binding
                and a 6-digit code; the bot sends the code; approve it in
                "Pending bindings" to start chatting.
              </p>
            </section>
          </div>
        </aside>
      }
    }
  `,
})
export class MessagingGatewayTabComponent implements OnInit {
  private readonly state = inject(GatewayStateService);
  private readonly vscode = inject(VSCodeService);

  protected readonly platformCards = PLATFORM_CARDS;
  protected readonly enabled = this.state.enabled;
  protected readonly platforms = this.state.platforms;
  protected readonly pendingBindings = this.state.pendingBindings;
  protected readonly approvedBindings = this.state.approvedBindings;
  protected readonly voiceEnabled = this.state.voiceEnabled;
  protected readonly whisperModel = this.state.whisperModel;
  protected readonly rateLimit = this.state.rateLimit;
  protected readonly voiceDownload = this.state.voiceDownload;
  protected readonly discordGuilds = this.state.discordGuilds;

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

  /**
   * Local edit drafts for the per-platform allow-list textareas, keyed by
   * platform. Undefined entry means "show the persisted value"; once the user
   * types, the draft takes over until saved (then cleared back to persisted).
   */
  private readonly allowListDrafts = signal<Record<string, string>>({});
  private readonly allowListFeedback = signal<Record<string, string>>({});

  /** Local edit draft for the Discord application id (null = show persisted). */
  private readonly discordAppIdDraft = signal<string | null>(null);

  /** Discord slash-command registration in-flight + last result. */
  protected readonly registering = signal(false);
  protected readonly registerFeedback = signal<string | null>(null);

  /** Transient toast for binding-approval feedback (code mismatch, etc.). */
  protected readonly approvalToast = signal<string | null>(null);

  /** Controls the right-side setup-guide drawer. */
  protected readonly helpOpen = signal(false);

  protected readonly testResults = computed(() => this.state.testResult());

  public get isElectron(): boolean {
    return this.vscode.isElectron;
  }

  public ngOnInit(): void {
    if (!this.isElectron) return;
    void this.state.initialize();
  }

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
    } finally {
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
    await this.state.sendTest(platform);
  }

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
    const code = this.bindingCodes()[binding.id]?.trim();
    if (!code) return;
    const result = await this.state.approveBinding(binding.id, code);
    if (!result.ok) {
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

  protected allowListValue(platform: GatewayPlatformId): string {
    const draft = this.allowListDrafts()[platform];
    if (draft !== undefined) return draft;
    return this.state.allowLists()[platform].join('\n');
  }

  protected onAllowListInput(platform: GatewayPlatformId, event: Event): void {
    const target = event.target as HTMLTextAreaElement | null;
    if (!target) return;
    const value = target.value;
    this.allowListDrafts.update((current) => ({
      ...current,
      [platform]: value,
    }));
  }

  protected allowListFeedbackFor(platform: GatewayPlatformId): string | null {
    return this.allowListFeedback()[platform] ?? null;
  }

  protected isSenderAllowed(binding: GatewayBindingDto): boolean {
    const id = binding.allowListId;
    if (!id) return false;
    return this.state.allowLists()[binding.platform].includes(id);
  }

  protected canAllowSender(binding: GatewayBindingDto): boolean {
    return !!binding.allowListId && !this.isSenderAllowed(binding);
  }

  protected allowSenderLabel(platform: GatewayPlatformId): string {
    if (platform === 'discord') return 'Allow this server';
    if (platform === 'slack') return 'Allow this workspace';
    return 'Allow this user';
  }

  protected async onAllowSender(binding: GatewayBindingDto): Promise<void> {
    const id = binding.allowListId;
    if (!id) return;
    const current = this.state.allowLists()[binding.platform];
    if (current.includes(id)) return;
    await this.state.saveAllowList(binding.platform, [...current, id]);
  }

  protected isGuildAllowed(id: string): boolean {
    return this.state.allowLists().discord.includes(id);
  }

  protected async onToggleGuild(id: string): Promise<void> {
    const current = this.state.allowLists().discord;
    const next = current.includes(id)
      ? current.filter((g) => g !== id)
      : [...current, id];
    await this.state.saveAllowList('discord', next);
  }

  protected async onRefreshGuilds(): Promise<void> {
    await this.state.loadDiscordGuilds();
  }

  protected async onSaveAllowList(platform: GatewayPlatformId): Promise<void> {
    const entries = this.allowListValue(platform)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const result = await this.state.saveAllowList(platform, entries);
    this.allowListDrafts.update((current) => {
      const next = { ...current };
      delete next[platform];
      return next;
    });
    this.allowListFeedback.update((current) => ({
      ...current,
      [platform]: result.ok ? 'Saved.' : `Save failed: ${result.error}`,
    }));
  }

  protected discordAppIdValue(): string {
    const draft = this.discordAppIdDraft();
    if (draft !== null) return draft;
    return this.state.discordAppId() ?? '';
  }

  protected onDiscordAppIdInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    this.discordAppIdDraft.set(target.value);
  }

  protected async onSaveDiscordAppId(): Promise<void> {
    await this.state.saveDiscordAppId(this.discordAppIdValue().trim());
    this.discordAppIdDraft.set(null);
  }

  protected discordInviteUrl(): string | null {
    const appId = this.discordAppIdValue().trim();
    if (!appId) return null;
    const scope = encodeURIComponent('bot applications.commands');
    return (
      `https://discord.com/api/oauth2/authorize` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&scope=${scope}` +
      `&permissions=${DISCORD_INVITE_PERMISSIONS}`
    );
  }

  protected async onRegisterDiscordCommands(): Promise<void> {
    this.registering.set(true);
    this.registerFeedback.set(null);
    try {
      const result = await this.state.registerDiscordCommands();
      this.registerFeedback.set(
        result.ok
          ? `Registered /ptah on ${result.registered} ${
              result.scope === 'guild' ? 'server(s)' : 'globally'
            }.`
          : `Registration failed: ${describeRegisterError(result.error)}`,
      );
    } finally {
      this.registering.set(false);
    }
  }

  protected onDismissVoiceToast(): void {
    this.state.dismissVoiceToast();
  }

  protected toggleHelp(): void {
    this.helpOpen.update((open) => !open);
  }

  protected closeHelp(): void {
    this.helpOpen.set(false);
  }

  protected formatTime(epochMs: number | null): string {
    if (epochMs === null || !Number.isFinite(epochMs)) return '—';
    return new Date(epochMs).toLocaleString();
  }
}
