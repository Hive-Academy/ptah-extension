/**
 * GatewayService — top-level orchestrator for the messaging gateway.
 *
 * Responsibilities (architecture §9 Track 4):
 *
 *   - Hold three IMessagingAdapter instances (Telegram, Discord, Slack).
 *   - Read enable flags + tokens from `~/.ptah/settings.json` via
 *     `IWorkspaceProvider`, decrypt tokens via `ITokenVault`, and start
 *     each enabled adapter on `start()`.
 *   - Pairing flow: route every inbound through `BindingStore.upsertPending`.
 *     If `pending`, reply with the binding's 6-digit pairing code and DROP
 *     the message (do not forward to the agent).
 *   - On approved bindings: persist inbound, then emit a typed event so the
 *     RPC handler / orchestrator layer can hand it off to the chat session.
 *   - Stream coalescing: callers push outbound assistant chunks through
 *     `appendOutboundChunk()`. The coalescer batches them into 1–3 edits
 *     per ~250ms window and the flush callback pushes them through the
 *     adapter's `sendMessage` / `editMessage`.
 *   - Voice retention: on `start()`, delete `voice_path` files older than
 *     7 days (architecture §11 default 5).
 *   - Inbound abuse guard: drop silently when a single allow-list id sends
 *     >60 messages/min (architecture §9.9).
 */
import { EventEmitter } from 'node:events';
import { timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SETTINGS_TOKENS,
  type GatewaySettings,
} from '@ptah-extension/settings-core';

import { GATEWAY_TOKENS } from './di/tokens';
import type { ITokenVault } from './token-vault.interface';
import { BindingStore } from './binding.store';
import { MessageStore } from './message.store';
import { StreamCoalescer, type FlushPayload } from './stream-coalescer';
import { FfmpegDecoder } from './voice/ffmpeg-decoder';
import {
  WhisperTranscriber,
  type WhisperDownloadEvent,
} from './voice/whisper-transcriber';
import {
  GrammyTelegramAdapter,
  type TelegramBotFactory,
} from './adapters/telegram/grammy.adapter';
import {
  DiscordAdapter,
  type DiscordClientFactory,
} from './adapters/discord/discord.adapter';
import {
  BoltSlackAdapter,
  type SlackAppFactory,
} from './adapters/slack/bolt.adapter';
import type {
  IMessagingAdapter,
  InboundMessage,
} from './adapters/adapter.interface';
import {
  ApprovalStatus,
  BindingId,
  ConversationKey,
  GatewayBinding,
  GatewayPlatform,
} from './types';

const SETTINGS_KEYS = {
  enabled: 'gateway.enabled',
  coalesceMs: 'gateway.coalesceMs',
  voiceEnabled: 'gateway.voice.enabled',
  whisperModel: 'gateway.voice.whisperModel',
  rateLimitMinTimeMs: 'gateway.rateLimit.minTimeMs',
  rateLimitMaxConcurrent: 'gateway.rateLimit.maxConcurrent',
  telegram: {
    enabled: 'gateway.telegram.enabled',
    token: 'gateway.telegram.tokenCipher',
    allowed: 'gateway.telegram.allowedUserIds',
  },
  discord: {
    enabled: 'gateway.discord.enabled',
    token: 'gateway.discord.tokenCipher',
    allowed: 'gateway.discord.allowedGuildIds',
  },
  slack: {
    enabled: 'gateway.slack.enabled',
    botToken: 'gateway.slack.botTokenCipher',
    appToken: 'gateway.slack.appTokenCipher',
    allowed: 'gateway.slack.allowedTeamIds',
  },
} as const;

const VOICE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const INBOUND_ABUSE_LIMIT_PER_MIN = 60;

export interface GatewayInboundEvent {
  binding: GatewayBinding;
  message: InboundMessage;
}

export interface GatewayStatus {
  enabled: boolean;
  adapters: Array<{
    platform: GatewayPlatform;
    running: boolean;
    lastError?: string;
  }>;
}

/** Test seam: lets tests inject fake adapter instances. */
export interface GatewayTestOverrides {
  telegram?: IMessagingAdapter;
  discord?: IMessagingAdapter;
  slack?: IMessagingAdapter;
  flushCallback?: (payload: FlushPayload) => Promise<void> | void;
}

@injectable()
export class GatewayService extends EventEmitter {
  private adapters = new Map<GatewayPlatform, IMessagingAdapter>();
  private lastErrors = new Map<GatewayPlatform, string>();
  private coalescer: StreamCoalescer | null = null;
  private inboundCounters = new Map<string, number[]>();
  /** Map conversationKey → first outbound externalMsgId (for editMessage). */
  private streamHandles = new Map<
    ConversationKey,
    {
      platform: GatewayPlatform;
      externalChatId: string;
      externalMsgId: string;
    }
  >();

  /** Ciphertext-decrypt-failure flag — surfaced via gateway:status. */
  private decryptFailures = new Set<GatewayPlatform>();

  /**
   * Bindings that have already received the one-shot pairing prompt this
   * process. Architecture §8.5 mandates a *single* "approval required" reply
   * per pending binding — not a reply on every inbound message. Cleared on
   * approval (the binding leaves the pending state) or on process restart.
   */
  private pairingPromptSent = new Set<string>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT)
    private readonly vault: ITokenVault,
    @inject(GATEWAY_TOKENS.GATEWAY_BINDING_STORE)
    private readonly bindings: BindingStore,
    @inject(GATEWAY_TOKENS.GATEWAY_MESSAGE_STORE)
    private readonly messages: MessageStore,
    @inject(GrammyTelegramAdapter)
    private readonly telegram: GrammyTelegramAdapter,
    @inject(DiscordAdapter) private readonly discord: DiscordAdapter,
    @inject(BoltSlackAdapter) private readonly slack: BoltSlackAdapter,
    @inject(FfmpegDecoder) private readonly ffmpeg: FfmpegDecoder,
    @inject(WhisperTranscriber) private readonly whisper: WhisperTranscriber,
    @inject(SETTINGS_TOKENS.GATEWAY_SETTINGS)
    private readonly gatewaySettings: GatewaySettings,
  ) {
    super();
  }

  /** Test/integration seam — production callers do not invoke this. */
  configureForTest(overrides: GatewayTestOverrides): void {
    if (overrides.telegram) this.adapters.set('telegram', overrides.telegram);
    if (overrides.discord) this.adapters.set('discord', overrides.discord);
    if (overrides.slack) this.adapters.set('slack', overrides.slack);
    if (overrides.flushCallback) {
      this.coalescer = new StreamCoalescer(overrides.flushCallback);
    }
  }

  /** Inject grammy bot factory before start (used by adapter wiring tests). */
  configureFactories(opts: {
    telegramBotFactory?: TelegramBotFactory;
    discordClientFactory?: DiscordClientFactory;
    slackAppFactory?: SlackAppFactory;
  }): void {
    if (opts.telegramBotFactory)
      this.telegram.configure({ factory: opts.telegramBotFactory });
    if (opts.discordClientFactory)
      this.discord.configure({ factory: opts.discordClientFactory });
    if (opts.slackAppFactory)
      this.slack.configure({ factory: opts.slackAppFactory });
  }

  status(): GatewayStatus {
    const enabled =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        SETTINGS_KEYS.enabled,
        false,
      ) ?? false;
    const platforms: GatewayPlatform[] = ['telegram', 'discord', 'slack'];
    return {
      enabled,
      adapters: platforms.map((platform) => {
        const adapter = this.adapters.get(platform);
        return {
          platform,
          running: adapter?.isRunning() ?? false,
          lastError: this.lastErrors.get(platform),
        };
      }),
    };
  }

  /**
   * Start all enabled adapters. Idempotent — calling twice while running is
   * a no-op for already-started adapters.
   */
  async start(): Promise<void> {
    await this.gcOldVoiceFiles().catch((err) =>
      this.logger.warn('[gateway] voice GC failed', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    if (!this.coalescer) {
      this.coalescer = new StreamCoalescer((payload) =>
        this.flushOutbound(payload),
      );
    }

    // Bridge transcriber download lifecycle to the renderer. Idempotent.
    this.bridgeWhisperEvents();

    const masterEnabled =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        SETTINGS_KEYS.enabled,
        false,
      ) ?? false;
    if (!masterEnabled) {
      this.logger.info('[gateway] master switch off; not starting adapters');
      return;
    }

    await this.maybeStartTelegram();
    await this.maybeStartDiscord();
    await this.maybeStartSlack();
  }

  async startPlatform(platform: GatewayPlatform): Promise<void> {
    if (platform === 'telegram') await this.maybeStartTelegram(true);
    else if (platform === 'discord') await this.maybeStartDiscord(true);
    else await this.maybeStartSlack(true);
  }

  async stopPlatform(platform: GatewayPlatform): Promise<void> {
    const adapter = this.adapters.get(platform);
    if (!adapter) return;
    try {
      await adapter.stop();
    } catch (err) {
      this.lastErrors.set(
        platform,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** LIFO cleanup hook called by `main.ts` `will-quit`. */
  async stop(): Promise<void> {
    // Drain before discard so any in-flight chunks reach the platform before
    // adapters close. discardAll() without drainAll() drops buffered content.
    await this.coalescer?.drainAll();
    for (const [platform, adapter] of this.adapters) {
      try {
        await adapter.stop();
      } catch (err) {
        this.logger.warn('[gateway] adapter stop failed', {
          platform,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * RPC handler — encrypt + persist a token into the encrypted secrets file.
   *
   * The ITokenVault.encrypt() call produces a Vault cipher (application-layer
   * encryption). The resulting cipher is then stored via the GatewaySettings
   * secret handles, which apply AES-256-GCM envelope encryption on top
   * (two-layer encryption — see WP-4A design doc for rationale).
   */
  async setToken(args: {
    platform: GatewayPlatform;
    token: string;
    slackAppToken?: string;
  }): Promise<void> {
    const cipher = this.vault.encrypt(args.token);
    if (args.platform === 'telegram') {
      await this.gatewaySettings.telegramTokenCipher.set(cipher);
    } else if (args.platform === 'discord') {
      await this.gatewaySettings.discordTokenCipher.set(cipher);
    } else {
      await this.gatewaySettings.slackBotTokenCipher.set(cipher);
      if (args.slackAppToken) {
        await this.gatewaySettings.slackAppTokenCipher.set(
          this.vault.encrypt(args.slackAppToken),
        );
      }
    }
    this.decryptFailures.delete(args.platform);
  }

  /**
   * Approve a pending binding only when the supplied `code` matches the
   * stored pairing code with a constant-time compare. SECURITY: the comparison
   * uses {@link timingSafeEqual} so an attacker cannot recover the code via a
   * response-time side-channel.
   *
   * Returns a discriminated union rather than throwing because the renderer
   * surfaces structured error reasons (`invalid-code` clears the input,
   * `binding-not-found` flags a stale list).
   */
  approveBinding(
    id: BindingId,
    ptahSessionId?: string,
    workspaceRoot?: string,
    code?: string,
  ):
    | { ok: true; binding: GatewayBinding }
    | { ok: false; error: 'invalid-code' | 'binding-not-found' } {
    const existing = this.bindings.findById(id);
    if (!existing) {
      return { ok: false, error: 'binding-not-found' };
    }
    const stored = existing.pairingCode ?? '';
    const supplied = (code ?? '').trim();
    if (!stored || !supplied || !constantTimeStringEqual(stored, supplied)) {
      this.logger.warn('[gateway] approveBinding rejected — code mismatch', {
        bindingId: String(id),
        platform: existing.platform,
      });
      return { ok: false, error: 'invalid-code' };
    }
    const binding = this.bindings.approve(id, ptahSessionId, workspaceRoot);
    // Binding has left the pending state — drop the one-shot prompt latch so
    // a future revoke→re-pending cycle gets a fresh prompt.
    this.pairingPromptSent.delete(id);
    return { ok: true, binding };
  }

  setBindingStatus(id: BindingId, status: ApprovalStatus): GatewayBinding {
    const binding = this.bindings.setStatus(id, status);
    // Any state transition out of `pending` clears the latch. Any transition
    // into `revoked`/`rejected` also drops any in-flight outbound stream.
    this.pairingPromptSent.delete(id);
    if (status === 'revoked' || status === 'rejected') {
      const handleKey =
        `${binding.platform}:${binding.externalChatId}` as ConversationKey;
      this.streamHandles.delete(handleKey);
      this.coalescer?.discard(handleKey);
    }
    return binding;
  }

  listBindings(filter?: {
    platform?: GatewayPlatform;
    status?: ApprovalStatus;
  }): GatewayBinding[] {
    return this.bindings.list(filter);
  }

  listMessages(args: {
    bindingId: BindingId;
    limit?: number;
    before?: number;
  }) {
    return this.messages.list(args);
  }

  /**
   * Fire a single canned test message at an approved binding for the given
   * platform. Powers the "Send test" button in the gateway UI. Returns a
   * structured result so the UI can surface a precise reason on failure
   * (no-approved-binding, adapter-not-running, etc.) without throwing.
   */
  async sendTest(args: {
    platform: GatewayPlatform;
    bindingId?: BindingId;
  }): Promise<
    | { ok: true; bindingId: string; externalMsgId: string | null }
    | { ok: false; error: string }
  > {
    const adapter = this.adapters.get(args.platform);
    if (!adapter) {
      return { ok: false, error: 'adapter-not-running' };
    }

    let binding: GatewayBinding | undefined;
    if (args.bindingId) {
      binding = this.bindings
        .list({ platform: args.platform, status: 'approved' })
        .find((b) => String(b.id) === String(args.bindingId));
      if (!binding) {
        return { ok: false, error: 'binding-not-approved' };
      }
    } else {
      binding = this.bindings
        .list({ platform: args.platform, status: 'approved' })
        .at(0);
      if (!binding) {
        return { ok: false, error: 'no-approved-binding' };
      }
    }

    const body = 'Ptah test message — gateway is wired up correctly.';
    try {
      const res = await adapter.sendMessage(binding.externalChatId, body);
      this.messages.insert({
        bindingId: binding.id,
        direction: 'outbound',
        externalMsgId: res.externalMsgId,
        body,
      });
      this.bindings.touch(binding.id);
      return {
        ok: true,
        bindingId: String(binding.id),
        externalMsgId: res.externalMsgId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('[gateway] sendTest failed', {
        platform: args.platform,
        error: message,
      });
      return { ok: false, error: message };
    }
  }

  /**
   * Append assistant text for a given conversation. The coalescer will
   * flush via {@link flushOutbound} which sends/edits via the adapter.
   */
  appendOutboundChunk(conversationKey: ConversationKey, chunk: string): void {
    if (!this.coalescer) {
      this.coalescer = new StreamCoalescer((payload) =>
        this.flushOutbound(payload),
      );
    }
    this.coalescer.append(conversationKey, chunk);
  }

  async drainOutbound(conversationKey: ConversationKey): Promise<void> {
    await this.coalescer?.drain(conversationKey);
    this.streamHandles.delete(conversationKey);
  }

  // -------------------------------------------------------------------------
  // Internal — adapter wiring + inbound pipeline.
  // -------------------------------------------------------------------------

  private wireAdapter(
    platform: GatewayPlatform,
    adapter: IMessagingAdapter,
  ): void {
    this.adapters.set(platform, adapter);
    adapter.on('inbound', (msg) => this.handleInbound(msg));
  }

  private async maybeStartTelegram(force = false): Promise<void> {
    const enabled = this.cfgBool(SETTINGS_KEYS.telegram.enabled, false);
    if (!enabled && !force) return;
    const existing = this.adapters.get('telegram') ?? this.telegram;
    this.wireAdapter('telegram', existing);
    const allowed = this.cfgArray(SETTINGS_KEYS.telegram.allowed);
    if (existing === this.telegram) {
      this.telegram.configure({ allowedUserIds: allowed });
    }
    const token = await this.decryptToken('telegram');
    if (!token) return;
    try {
      await existing.start(token);
      this.lastErrors.delete('telegram');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastErrors.set('telegram', msg);
      this.logger.warn('[gateway] telegram start failed', { error: msg });
    }
  }

  private async maybeStartDiscord(force = false): Promise<void> {
    const enabled = this.cfgBool(SETTINGS_KEYS.discord.enabled, false);
    if (!enabled && !force) return;
    const existing = this.adapters.get('discord') ?? this.discord;
    this.wireAdapter('discord', existing);
    const allowed = this.cfgArray(SETTINGS_KEYS.discord.allowed);
    if (existing === this.discord) {
      this.discord.configure({ allowedGuildIds: allowed });
    }
    const token = await this.decryptToken('discord');
    if (!token) return;
    try {
      await existing.start(token);
      this.lastErrors.delete('discord');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastErrors.set('discord', msg);
      this.logger.warn('[gateway] discord start failed', { error: msg });
    }
  }

  private async maybeStartSlack(force = false): Promise<void> {
    const enabled = this.cfgBool(SETTINGS_KEYS.slack.enabled, false);
    if (!enabled && !force) return;
    const existing = this.adapters.get('slack') ?? this.slack;
    this.wireAdapter('slack', existing);
    const allowed = this.cfgArray(SETTINGS_KEYS.slack.allowed);
    if (existing === this.slack) {
      this.slack.configure({ allowedTeamIds: allowed });
    }
    const botToken = await this.decryptToken('slack');
    const appToken = await this.decryptSlackAppToken();
    if (!botToken || !appToken) return;
    try {
      await existing.start(botToken, { appToken });
      this.lastErrors.delete('slack');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastErrors.set('slack', msg);
      this.logger.warn('[gateway] slack start failed', { error: msg });
    }
  }

  private async handleInbound(msg: InboundMessage): Promise<void> {
    // Abuse cap.
    if (msg.allowListId) {
      const now = Date.now();
      const recent = (this.inboundCounters.get(msg.allowListId) ?? []).filter(
        (ts) => ts > now - 60_000,
      );
      if (recent.length >= INBOUND_ABUSE_LIMIT_PER_MIN) {
        this.logger.warn('[gateway] dropping inbound — abuse cap', {
          allowListId: msg.allowListId,
          platform: msg.platform,
        });
        return;
      }
      recent.push(now);
      this.inboundCounters.set(msg.allowListId, recent);
    }

    // Voice path: transcribe before pairing logic.
    let body = msg.body;
    if (msg.voicePath && this.cfgBool(SETTINGS_KEYS.voiceEnabled, true)) {
      try {
        const wav = await this.ffmpeg.decodeToPcm16Wav(msg.voicePath);
        const transcript = await this.whisper.transcribe(wav);
        if (transcript) body = body ? `${body}\n${transcript}` : transcript;
      } catch (err) {
        this.logger.warn('[gateway] voice transcription failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Pairing flow.
    const binding = this.bindings.upsertPending({
      platform: msg.platform,
      externalChatId: msg.externalChatId,
      displayName: msg.displayName,
    });

    if (binding.approvalStatus === 'pending') {
      // Architecture §8.5: send the "approval required" reply ONCE per
      // pending binding. Every subsequent inbound is silently dropped to
      // prevent a hostile sender from spamming the user's notifications.
      if (!this.pairingPromptSent.has(binding.id)) {
        const code = binding.pairingCode ?? '------';
        const reply =
          `Ptah pairing required. Approve this binding in Ptah using code: ${code}\n` +
          `(I will not respond to messages until approved.)`;
        try {
          const adapter = this.adapters.get(msg.platform);
          if (adapter) {
            await adapter.sendMessage(msg.externalChatId, reply);
          }
          this.pairingPromptSent.add(binding.id);
        } catch (err) {
          this.logger.warn('[gateway] failed to send pairing prompt', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }

    if (binding.approvalStatus !== 'approved') {
      this.logger.debug('[gateway] dropping inbound — binding not approved', {
        bindingId: binding.id,
        status: binding.approvalStatus,
      });
      return;
    }

    // Persist (dedup via UNIQUE).
    const persisted = this.messages.insert({
      bindingId: binding.id,
      direction: 'inbound',
      externalMsgId: msg.externalMsgId,
      body,
      voicePath: msg.voicePath ?? null,
    });
    if (!persisted) return; // duplicate

    this.bindings.touch(binding.id);
    const event: GatewayInboundEvent = {
      binding,
      message: { ...msg, body },
    };
    this.emit('inbound', event);
  }

  private async flushOutbound(payload: FlushPayload): Promise<void> {
    const handle = this.streamHandles.get(payload.conversationKey);
    const [platform, externalChatId] = payload.conversationKey.split(':') as [
      GatewayPlatform,
      string,
    ];
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      this.logger.warn('[gateway] flushOutbound: no adapter for platform', {
        platform,
      });
      return;
    }
    try {
      if (payload.isFirstFlush || !handle) {
        const res = await adapter.sendMessage(externalChatId, payload.body);
        this.streamHandles.set(payload.conversationKey, {
          platform,
          externalChatId,
          externalMsgId: res.externalMsgId,
        });
        // Persist outbound (dedup-friendly).
        const binding = this.bindings.findByExternal(platform, externalChatId);
        if (binding) {
          this.messages.insert({
            bindingId: binding.id,
            direction: 'outbound',
            externalMsgId: res.externalMsgId,
            body: payload.body,
          });
        }
      } else {
        await adapter.editMessage(
          externalChatId,
          handle.externalMsgId,
          payload.body,
        );
      }
    } catch (err) {
      this.logger.warn('[gateway] flushOutbound failed', {
        platform,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async decryptToken(
    platform: GatewayPlatform,
  ): Promise<string | null> {
    let cipher: string | undefined;
    try {
      if (platform === 'telegram') {
        cipher = await this.gatewaySettings.telegramTokenCipher.get();
      } else if (platform === 'discord') {
        cipher = await this.gatewaySettings.discordTokenCipher.get();
      } else {
        // Slack: bot token only — appToken is handled separately in maybeStartSlack.
        cipher = await this.gatewaySettings.slackBotTokenCipher.get();
      }
    } catch (err) {
      this.logger.warn(
        '[gateway] failed to read secret — secrets file may be corrupt',
        {
          platform,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return null;
    }

    if (!cipher) return null;

    const plain = this.vault.decrypt(cipher);
    if (plain === null) {
      if (!this.decryptFailures.has(platform)) {
        this.decryptFailures.add(platform);
        this.logger.warn(
          `[gateway] failed to decrypt ${platform} token — user must re-enter via gateway:setToken`,
        );
        this.lastErrors.set(
          platform,
          `decrypt failed — re-enter token via gateway:setToken`,
        );
      }
      return null;
    }
    return plain;
  }

  /** Read the Slack app token cipher from the secrets store. */
  private async decryptSlackAppToken(): Promise<string | null> {
    let cipher: string | undefined;
    try {
      cipher = await this.gatewaySettings.slackAppTokenCipher.get();
    } catch (err) {
      this.logger.warn('[gateway] failed to read slack app token secret', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!cipher) return null;
    return this.vault.decrypt(cipher);
  }

  private cfgBool(key: string, defaultValue: boolean): boolean {
    return (
      this.workspace.getConfiguration<boolean>('ptah', key, defaultValue) ??
      defaultValue
    );
  }

  private cfgArray(key: string): string[] {
    const raw = this.workspace.getConfiguration<unknown>('ptah', key, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (v): v is string | number =>
          typeof v === 'string' || typeof v === 'number',
      )
      .map(String);
  }

  private async gcOldVoiceFiles(): Promise<void> {
    const cutoff = Date.now() - VOICE_RETENTION_MS;
    const stale = this.messages.listVoicePathsOlderThan(cutoff);
    let deleted = 0;
    for (const p of stale) {
      try {
        await fs.unlink(p);
        deleted++;
      } catch {
        // file may already be gone — non-fatal.
      }
    }
    if (deleted > 0) {
      this.logger.info('[gateway] voice GC removed stale files', {
        count: deleted,
      });
    }
  }

  /** Default voice cache directory (callers may use this when downloading). */
  static defaultVoiceCacheDir(): string {
    return path.join(os.homedir(), '.ptah', 'voice-cache');
  }

  /**
   * Subscribe transcriber download events and re-emit them on `gateway:event`
   * so the renderer's voice-model-download toast lights up. Public so the
   * activation layer can wire this once after DI registration completes.
   */
  bridgeWhisperEvents(): void {
    if (this.whisperEventsBridged) return;
    this.whisperEventsBridged = true;
    // Apply the current settings model name so the next transcribe uses it.
    const modelName = this.workspace.getConfiguration<string>(
      'ptah',
      SETTINGS_KEYS.whisperModel,
      'base.en',
    );
    if (typeof modelName === 'string' && modelName.length > 0) {
      this.whisper.configure({ modelName });
    }
    this.whisper.on('download', (evt: WhisperDownloadEvent) => {
      switch (evt.kind) {
        case 'download:start':
          this.emit('event', {
            kind: 'voice-model-download',
            modelName: evt.model,
            percent: 0,
          });
          break;
        case 'download:progress':
          this.emit('event', {
            kind: 'voice-model-download',
            modelName: evt.model,
            percent: evt.percent,
          });
          break;
        case 'download:complete':
          this.emit('event', {
            kind: 'voice-model-download',
            modelName: evt.model,
            percent: 100,
          });
          break;
        case 'download:error':
          this.emit('event', {
            kind: 'voice-model-download-error',
            modelName: evt.model,
            reason: evt.error,
          });
          break;
      }
    });
  }

  private whisperEventsBridged = false;
}

/**
 * Constant-time string comparison via {@link timingSafeEqual}. Returns false
 * on length mismatch (timingSafeEqual itself throws on length mismatch, so
 * the caller wraps that case explicitly).
 */
function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
