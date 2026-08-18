/**
 * GatewayService — the messaging gateway's façade.
 *
 * It owns the decisions that turn a platform message into (or away from) an
 * agent turn, and delegates the two concerns that are not that:
 *
 *   - {@link AdapterLifecycleService} — which transports are up, token
 *     decryption, enable flags, reconnect backoff, `lastError` / `status()`.
 *   - {@link OutboundDeliveryService} — coalescing the assistant reply and
 *     getting it delivered (or failing loudly).
 *
 * What stays here IS the façade's own concern: the inbound admission path
 * (abuse cap → transcription → pairing gate → persist → `inbound` event),
 * binding administration (approve / attach / detach / revoke, allow-lists,
 * token storage, the Discord application id and slash-command registration),
 * the out-of-band speech that must NOT travel through the coalescer
 * (`sendNotice`, `sendTyping`), and voice housekeeping.
 *
 * Every public method here is called by `GatewayRpcHandlers`,
 * `gateway-chat-bridge` or `apps/ptah-electron` — the signatures are the
 * contract, not an implementation detail.
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
import { ConversationStore } from './conversation.store';
import { MessageStore, type UnfinishedInboundTurn } from './message.store';
import { AttachedSessionRegistry } from './attached-session-registry';
import type { ISessionResumabilityChecker } from './session-resumability';
import type { FlushPayload, OutboundRoute } from './stream-coalescer';
import {
  SETTINGS_KEYS,
  allowedKeyFor,
  readBool,
  readStringArray,
} from './gateway-settings-access';
import {
  AdapterLifecycleService,
  type AdapterFactoryOverrides,
  type AdapterTestOverrides,
  type GatewayStatus,
} from './adapter-lifecycle.service';
import { OutboundDeliveryService } from './outbound-delivery.service';
import {
  VOICE_CONTRACT_TOKENS,
  type IVoiceProviderSelector,
  type VoiceDownloadEvent,
} from '@ptah-extension/voice-contracts';
import { registerDiscordSlashCommands } from './adapters/discord/discord-command-registration';
import type { InboundMessage } from './adapters/adapter.interface';
import {
  ApprovalStatus,
  BindingId,
  ConversationKey,
  GatewayBinding,
  GatewayConversation,
  GatewayMessageId,
  GatewayPlatform,
  GatewayTurnState,
} from './types';

export { OutboundDeliveryError } from './outbound-delivery.service';
export type { GatewayStatus } from './adapter-lifecycle.service';

const VOICE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const INBOUND_ABUSE_LIMIT_PER_MIN = 60;
/** Sliding window for both the abuse counter and the abuse-notice throttle. */
const INBOUND_ABUSE_WINDOW_MS = 60_000;

/**
 * Sent once per allow-list id per {@link INBOUND_ABUSE_WINDOW_MS} when the
 * inbound cap starts dropping messages (TASK_2026_271). Before this the drop
 * was completely silent, which from the chat side is indistinguishable from a
 * crashed bot.
 */
export const ABUSE_CAP_NOTICE =
  "You're sending messages faster than Ptah can take them — please slow down.";

export interface GatewayInboundEvent {
  binding: GatewayBinding;
  conversation: GatewayConversation;
  /**
   * Id of the persisted `gateway_messages` row this event came from. The bridge
   * stamps the turn's lifecycle onto it (TASK_2026_277), which is what lets a
   * restart notice reach the sender of a turn that never finished.
   */
  messageId: GatewayMessageId;
  message: InboundMessage;
}

/**
 * One conversation with at least one inbound turn the previous process left
 * unfinished — the unit the restart notice is batched by.
 */
export interface InterruptedInboundConversation {
  route: OutboundRoute;
  /** How many of this conversation's messages were caught mid-flight. */
  messageCount: number;
}

/** Test seam: lets tests inject fake adapters, timers and a flush path. */
export interface GatewayTestOverrides extends AdapterTestOverrides {
  flushCallback?: (payload: FlushPayload) => Promise<void> | void;
}

@injectable()
export class GatewayService extends EventEmitter {
  private inboundCounters = new Map<string, number[]>();
  /** allowListId → timestamp of the last "you're too fast" reply we sent. */
  private abuseNotified = new Map<string, number>();

  /**
   * Bindings that have already received the one-shot pairing prompt this
   * process. Architecture §8.5 mandates a *single* "approval required" reply
   * per pending binding — not a reply on every inbound message. Cleared on
   * approval (the binding leaves the pending state) or on process restart.
   */
  private pairingPromptSent = new Set<string>();

  private voiceEventsBridged = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT)
    private readonly vault: ITokenVault,
    @inject(GATEWAY_TOKENS.GATEWAY_BINDING_STORE)
    private readonly bindings: BindingStore,
    @inject(GATEWAY_TOKENS.GATEWAY_CONVERSATION_STORE)
    private readonly conversations: ConversationStore,
    @inject(GATEWAY_TOKENS.GATEWAY_MESSAGE_STORE)
    private readonly messages: MessageStore,
    @inject(VOICE_CONTRACT_TOKENS.VOICE_PROVIDER_SELECTOR)
    private readonly voiceSelector: IVoiceProviderSelector,
    @inject(SETTINGS_TOKENS.GATEWAY_SETTINGS)
    private readonly gatewaySettings: GatewaySettings,
    @inject(GATEWAY_TOKENS.GATEWAY_ATTACHED_SESSION_REGISTRY)
    private readonly attachedSessionRegistry: AttachedSessionRegistry,
    @inject(GATEWAY_TOKENS.GATEWAY_SESSION_RESUMABILITY_CHECKER)
    private readonly resumability: ISessionResumabilityChecker,
    @inject(GATEWAY_TOKENS.GATEWAY_ADAPTER_LIFECYCLE)
    private readonly lifecycle: AdapterLifecycleService,
    @inject(GATEWAY_TOKENS.GATEWAY_OUTBOUND_DELIVERY)
    private readonly outbound: OutboundDeliveryService,
  ) {
    super();
    this.lifecycle.setInboundHandler((msg) => this.handleInbound(msg));
    this.lifecycle.on('status-changed', (payload) =>
      this.emit('status-changed', payload),
    );
  }

  /** Test/integration seam — production callers do not invoke this. */
  configureForTest(overrides: GatewayTestOverrides): void {
    this.lifecycle.configureForTest(overrides);
    if (overrides.flushCallback) {
      this.outbound.useFlushCallback(overrides.flushCallback);
    }
  }

  /** Inject client-library factories before start. */
  configureFactories(opts: AdapterFactoryOverrides): void {
    this.lifecycle.configureFactories(opts);
  }

  status(): GatewayStatus {
    return this.lifecycle.status();
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
    this.outbound.ensureCoalescer();
    this.bridgeVoiceDownloadEvents();
    await this.lifecycle.startEnabled();
  }

  async startPlatform(platform: GatewayPlatform): Promise<void> {
    await this.lifecycle.startPlatform(platform);
  }

  async stopPlatform(platform: GatewayPlatform): Promise<void> {
    await this.lifecycle.stopPlatform(platform);
  }

  /** LIFO cleanup hook called by `main.ts` `will-quit`. */
  async stop(): Promise<void> {
    this.lifecycle.cancelAllReconnects();
    await this.outbound.drainAll();
    await this.lifecycle.stopAdapters();
  }

  /**
   * RPC handler — encrypt + persist a token into the encrypted secrets file.
   *
   * The ITokenVault.encrypt() call produces a Vault cipher (application-layer
   * encryption). The resulting cipher is then stored via the GatewaySettings
   * secret handles, which apply AES-256-GCM envelope encryption on top
   * (two-layer encryption for defense-in-depth).
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
    this.lifecycle.clearDecryptFailure(args.platform);
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
    this.pairingPromptSent.delete(id);
    this.emit('bindings-changed');
    return { ok: true, binding };
  }

  /**
   * Attach an existing Ptah SDK session (webview-supplied `sessionUuid` +
   * `workspaceRoot`) to an approved binding so subsequent inbound platform
   * messages resume that exact conversation.
   *
   * Mirrors {@link approveBinding}'s discriminated-union contract. "Resumable"
   * means the JSONL plausibly exists — NOT "currently active" — so a session
   * opened earlier but now inactive can still be attached.
   *
   * Because the webview carries the session's authoritative `workspaceRoot`,
   * the attach stamps it at BOTH levels: the binding (default for new
   * conversations, Data-4) and the target conversation row — atomically with
   * the session link — so `isResumable(ptahSessionId,
   * effectiveWorkspace(conversation))` holds under conversation-first
   * resolution even if the binding root is later repointed (AC-7.4, Data-3).
   *
   * The binding's transport must be RUNNING (TASK_2026_272 #2). Attaching is
   * not a passive bookmark — it makes the webview tab read-only and hands the
   * conversation to the platform. Against a stopped or disconnected adapter
   * that produces a tab nobody can type into and a channel nothing arrives
   * from, so the attach is refused rather than silently accepted. `isRunning()`
   * means "started AND transport usable", so a bot that died since boot is
   * caught too, not just one that was never started.
   */
  async attachSession(
    bindingId: BindingId,
    sessionUuid: string,
    workspaceRoot: string,
    externalConversationId = 'default',
  ): Promise<
    | { ok: true; binding: GatewayBinding }
    | {
        ok: false;
        error:
          | 'binding-not-found'
          | 'binding-not-approved'
          | 'adapter-not-running'
          | 'session-not-resumable';
      }
  > {
    const existing = this.bindings.findById(bindingId);
    if (!existing) {
      return { ok: false, error: 'binding-not-found' };
    }
    if (existing.approvalStatus !== 'approved') {
      return { ok: false, error: 'binding-not-approved' };
    }
    // Checked before the (I/O-bound) resumability probe: it is the cheaper
    // gate, and the same error code `sendTest` already returns for this exact
    // condition.
    if (!this.lifecycle.adapterFor(existing.platform)?.isRunning()) {
      this.logger.warn(
        '[gateway] attachSession rejected — adapter not running',
        {
          bindingId: String(bindingId),
          platform: existing.platform,
        },
      );
      return { ok: false, error: 'adapter-not-running' };
    }

    const resumable = await this.resumability.isResumable(
      sessionUuid,
      workspaceRoot,
    );
    if (!resumable) {
      this.logger.warn('[gateway] attachSession rejected — not resumable', {
        bindingId: String(bindingId),
        platform: existing.platform,
      });
      return { ok: false, error: 'session-not-resumable' };
    }

    const binding = this.bindings.setWorkspaceRoot(bindingId, workspaceRoot);
    const conversation = this.conversations.resolveOrCreate(
      bindingId,
      externalConversationId,
    );
    this.conversations.setPtahSessionIdAndWorkspaceRoot(
      conversation.id,
      sessionUuid,
      workspaceRoot,
    );
    this.attachedSessionRegistry.attach(sessionUuid, String(bindingId));

    this.logger.info('[gateway] session attached to binding', {
      bindingId: String(bindingId),
      platform: binding.platform,
    });
    this.emit('bindings-changed');
    this.emit('session-attached', {
      bindingId: String(bindingId),
      sessionUuid,
      platform: binding.platform,
    });
    return { ok: true, binding };
  }

  /**
   * Detach a binding — CLEAR the session link on all its conversation(s)
   * (sets `ptah_session_id` to NULL). No continuity flag, no "stop resuming"
   * branch. Idempotent: detaching a binding with no linked session still
   * succeeds and emits with an empty `sessionUuid`.
   */
  detachSession(
    bindingId: BindingId,
  ):
    | { ok: true; binding: GatewayBinding }
    | { ok: false; error: 'binding-not-found' } {
    const existing = this.bindings.findById(bindingId);
    if (!existing) {
      return { ok: false, error: 'binding-not-found' };
    }

    const conversations = this.conversations.listByBinding(bindingId);
    let clearedUuid = '';
    for (const conversation of conversations) {
      if (conversation.ptahSessionId && !clearedUuid) {
        clearedUuid = conversation.ptahSessionId;
      }
      if (conversation.ptahSessionId) {
        this.conversations.clearPtahSessionId(conversation.id);
      }
    }
    if (clearedUuid) {
      this.attachedSessionRegistry.detach(clearedUuid);
    }

    this.logger.info('[gateway] session detached from binding', {
      bindingId: String(bindingId),
      platform: existing.platform,
      hadSession: clearedUuid.length > 0,
    });
    this.emit('bindings-changed');
    this.emit('session-detached', {
      bindingId: String(bindingId),
      sessionUuid: clearedUuid,
    });
    return { ok: true, binding: existing };
  }

  setBindingStatus(id: BindingId, status: ApprovalStatus): GatewayBinding {
    const binding = this.bindings.setStatus(id, status);
    this.pairingPromptSent.delete(id);
    if (status === 'revoked' || status === 'rejected') {
      const conversations = this.conversations.listByBinding(id);
      const keys = new Set<ConversationKey>([
        ConversationKey.for(binding.platform, binding.externalChatId),
      ]);
      for (const conversation of conversations) {
        keys.add(
          ConversationKey.for(
            binding.platform,
            binding.externalChatId,
            conversation.externalConversationId,
          ),
        );
      }
      for (const key of keys) {
        this.outbound.discard(key);
      }
      this.conversations.deleteByBinding(id);
    }
    this.emit('bindings-changed');
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

  /** See {@link OutboundDeliveryService.sendTest} — powers "Send test". */
  async sendTest(args: {
    platform: GatewayPlatform;
    bindingId?: BindingId;
  }): Promise<
    | { ok: true; bindingId: string; externalMsgId: string | null }
    | { ok: false; error: string }
  > {
    return this.outbound.sendTest(args);
  }

  /** Read the current allow-list for a platform from settings. */
  getAllowList(platform: GatewayPlatform): string[] {
    return readStringArray(this.workspace, allowedKeyFor(platform));
  }

  /**
   * Persist a platform allow-list to settings and re-apply it to the live
   * adapter so the change takes effect without a restart. Entries are trimmed,
   * de-duplicated, and emptied of blanks.
   */
  async setAllowList(
    platform: GatewayPlatform,
    entries: ReadonlyArray<string>,
  ): Promise<void> {
    const cleaned = Array.from(
      new Set(entries.map((e) => e.trim()).filter((e) => e.length > 0)),
    );
    await this.workspace.setConfiguration(
      'ptah',
      allowedKeyFor(platform),
      cleaned,
    );
    this.lifecycle.applyAllowList(platform, cleaned);
  }

  /** Servers the Discord bot is currently in — empty until connected. */
  listDiscordGuilds(): Array<{ id: string; name: string }> {
    return this.lifecycle.listDiscordGuilds();
  }

  /** Read the persisted Discord application (client) id, or null if unset. */
  getDiscordAppId(): string | null {
    const value = this.workspace.getConfiguration<string>(
      'ptah',
      SETTINGS_KEYS.discord.applicationId,
      '',
    );
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /** Persist the Discord application (client) id used for invite + registration. */
  async setDiscordAppId(applicationId: string): Promise<void> {
    await this.workspace.setConfiguration(
      'ptah',
      SETTINGS_KEYS.discord.applicationId,
      applicationId.trim(),
    );
  }

  /**
   * Register the `/ptah` slash command with Discord using the stored bot token
   * and application id. Registers per allow-listed guild (instant) or globally
   * when the allow-list is empty. Returns a structured result so the UI can
   * surface a precise reason without throwing.
   */
  async registerDiscordCommands(): Promise<
    | {
        ok: true;
        registered: number;
        scope: 'guild' | 'global';
        failed?: ReadonlyArray<{ guildId: string; error: string }>;
      }
    | { ok: false; error: string }
  > {
    const applicationId = this.getDiscordAppId();
    if (!applicationId) {
      return { ok: false, error: 'missing-application-id' };
    }
    const token = await this.lifecycle.decryptToken('discord');
    if (!token) {
      return { ok: false, error: 'missing-token' };
    }
    const guildIds = readStringArray(
      this.workspace,
      SETTINGS_KEYS.discord.allowed,
    );
    try {
      const result = await registerDiscordSlashCommands({
        token,
        applicationId,
        guildIds,
      });
      const failed = result.results
        .filter((r) => !r.ok)
        .map((r) => ({ guildId: r.guildId, error: r.error ?? 'unknown' }));
      if (failed.length > 0) {
        this.logger.warn(
          '[gateway] discord slash commands registered for some guilds only',
          { registered: result.registered, failed },
        );
      } else {
        this.logger.info('[gateway] discord slash commands registered', {
          registered: result.registered,
          scope: result.scope,
        });
      }
      return {
        ok: true,
        registered: result.registered,
        scope: result.scope,
        ...(failed.length > 0 ? { failed } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('[gateway] discord command registration failed', {
        error: message,
      });
      return { ok: false, error: message };
    }
  }

  /**
   * Append assistant text for a given conversation. Accumulates in the
   * coalescer; nothing reaches the platform until the turn is sealed.
   */
  appendOutboundChunk(route: OutboundRoute, chunk: string): void {
    this.outbound.append(route, chunk);
  }

  /** See {@link AdapterLifecycleService.recordTurnOutcome}. */
  recordTurnOutcome(
    platform: GatewayPlatform,
    outcome: { ok: true } | { ok: false; reason: string },
  ): void {
    this.lifecycle.recordTurnOutcome(platform, outcome);
  }

  /** Drop a turn's accumulated text without sending it (TASK_2026_271 #6). */
  discardOutbound(conversationKey: ConversationKey): void {
    this.outbound.discard(conversationKey);
  }

  /** Mid-turn flush primitive — does NOT seal the turn. */
  async drainOutbound(conversationKey: ConversationKey): Promise<void> {
    await this.outbound.drain(conversationKey);
  }

  /** Seal a turn: flush what is pending, then reset buffer + message handle. */
  async completeOutboundTurn(conversationKey: ConversationKey): Promise<void> {
    await this.outbound.completeTurn(conversationKey);
  }

  /**
   * Send a short out-of-band notice ("waiting for approval…") straight to
   * the platform, bypassing the coalescer so the turn's accumulating reply
   * is neither flushed early nor polluted. Not persisted as an outbound
   * message row. Throws on delivery failure so the caller can decide.
   */
  async sendNotice(route: OutboundRoute, text: string): Promise<void> {
    const adapter = this.lifecycle.adapterFor(route.platform);
    if (!adapter) {
      throw new Error(`gateway: no adapter for platform ${route.platform}`);
    }
    await adapter.sendMessage(
      route.externalChatId,
      text,
      route.conversationId !== undefined
        ? { conversationId: route.conversationId }
        : undefined,
    );
  }

  /**
   * Show the platform's "bot is typing" affordance for a route (TASK_2026_271).
   * Purely cosmetic and strictly best-effort: platforms without the capability
   * omit `sendTyping` entirely, and a failure must never disturb the turn — a
   * gateway reply is already slow, it should not also be fragile. The indicator
   * decays on its own (Discord ≈10 s), so the bridge re-arms it while a turn
   * runs rather than this method holding any state.
   */
  async sendTyping(route: OutboundRoute): Promise<void> {
    const adapter = this.lifecycle.adapterFor(route.platform);
    if (!adapter) return;
    try {
      await adapter.sendTyping?.(
        route.externalChatId,
        route.conversationId !== undefined
          ? { conversationId: route.conversationId }
          : undefined,
      );
    } catch (error: unknown) {
      this.logger.debug('[gateway] typing indicator failed', {
        platform: route.platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Sliding-window inbound cap, per allow-list id (architecture §9.9).
   *
   * A drop is logged at `debug` — one line per dropped message is noise, not
   * signal — while the *onset* of throttling gets a single `warn` and a single
   * reply to the sender per window (TASK_2026_271). Both are throttled by the
   * same {@link abuseNotified} stamp, so a sender hammering the bot sees one
   * explanation a minute rather than 500 or, as before, none at all.
   *
   * @returns `true` when the caller must drop the message.
   */
  private async isRateLimited(msg: InboundMessage): Promise<boolean> {
    const allowListId = msg.allowListId;
    if (!allowListId) return false;
    const now = Date.now();
    const recent = (this.inboundCounters.get(allowListId) ?? []).filter(
      (ts) => ts > now - INBOUND_ABUSE_WINDOW_MS,
    );
    this.inboundCounters.set(allowListId, recent);
    if (recent.length < INBOUND_ABUSE_LIMIT_PER_MIN) {
      recent.push(now);
      return false;
    }
    this.logger.debug('[gateway] dropping inbound — abuse cap', {
      allowListId,
      platform: msg.platform,
    });
    await this.notifyAbuseCap(msg, allowListId, now);
    return true;
  }

  /**
   * One-per-window "slow down" reply. Best-effort: the sender is already over
   * the cap, so a failed notice is worth a warn and nothing more.
   */
  private async notifyAbuseCap(
    msg: InboundMessage,
    allowListId: string,
    now: number,
  ): Promise<void> {
    const lastNotified = this.abuseNotified.get(allowListId);
    if (
      lastNotified !== undefined &&
      now - lastNotified < INBOUND_ABUSE_WINDOW_MS
    ) {
      return;
    }
    this.abuseNotified.set(allowListId, now);
    this.logger.warn(
      '[gateway] inbound abuse cap reached — throttling sender',
      {
        allowListId,
        platform: msg.platform,
        limitPerMin: INBOUND_ABUSE_LIMIT_PER_MIN,
      },
    );
    const adapter = this.lifecycle.adapterFor(msg.platform);
    if (!adapter) {
      this.restoreAbuseStamp(allowListId, lastNotified);
      return;
    }
    try {
      await adapter.sendMessage(
        msg.externalChatId,
        ABUSE_CAP_NOTICE,
        msg.conversationId !== undefined
          ? { conversationId: msg.conversationId }
          : undefined,
      );
    } catch (error: unknown) {
      // The stamp is set BEFORE the send so a burst cannot fire N concurrent
      // notices, but a notice that never landed must not cost the sender the
      // whole window in silence — roll back so the next drop tries again.
      this.restoreAbuseStamp(allowListId, lastNotified);
      this.logger.warn('[gateway] abuse-cap notice not delivered', {
        platform: msg.platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Undo an optimistic {@link abuseNotified} stamp after a failed notice. */
  private restoreAbuseStamp(
    allowListId: string,
    previous: number | undefined,
  ): void {
    if (previous === undefined) this.abuseNotified.delete(allowListId);
    else this.abuseNotified.set(allowListId, previous);
  }

  private async handleInbound(msg: InboundMessage): Promise<void> {
    if (await this.isRateLimited(msg)) return;
    const body = await this.withTranscript(msg);

    const binding =
      msg.conversationMode === 'attach'
        ? this.resolveAttachBinding(msg)
        : await this.resolvePairedBinding(msg);
    if (!binding) return;

    // The conversation is resolved BEFORE the row is written so the row can
    // carry `conversation_id` (TASK_2026_277) — the restart notice is batched
    // per conversation, and a binding may serve many Discord threads. Both
    // resolvers are idempotent, so the duplicate that the insert below drops
    // costs at most one redundant lookup of a row that already exists.
    const externalConversationId = msg.conversationId
      ? msg.conversationId
      : 'default';
    const conversation =
      msg.conversationMode === 'attach' && msg.platform === 'discord'
        ? this.conversations.resolveOrAdopt(binding.id, externalConversationId)
        : this.conversations.resolveOrCreate(
            binding.id,
            externalConversationId,
          );

    const persisted = this.messages.insert({
      bindingId: binding.id,
      direction: 'inbound',
      externalMsgId: msg.externalMsgId,
      body,
      voicePath: msg.voicePath ?? null,
      conversationId: conversation.id,
      turnState: 'queued',
    });
    if (!persisted) return; // duplicate

    this.conversations.touch(conversation.id);
    this.bindings.touch(binding.id);
    const event: GatewayInboundEvent = {
      binding,
      conversation,
      messageId: persisted.id,
      message: { ...msg, body },
    };
    this.emit('inbound', event);
  }

  /**
   * Record where an inbound message's agent turn has got to (TASK_2026_277).
   * Called by `gateway-chat-bridge` at turn start and in the turn's `finally`;
   * persistence belongs here rather than in the bridge, which owns no stores.
   *
   * Best-effort by design: a SQLite hiccup while bookkeeping must not fail a
   * turn that is otherwise fine. The cost of a lost write is one spurious
   * "please resend" notice after a restart, which is the safe direction.
   */
  markInboundTurnState(
    messageId: GatewayMessageId,
    state: GatewayTurnState,
  ): void {
    try {
      this.messages.markTurnState([messageId], state);
    } catch (error: unknown) {
      this.logger.warn('[gateway] failed to record inbound turn state', {
        messageId: String(messageId),
        state,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Claim every inbound turn the previous process left in flight
   * (TASK_2026_277) and return one entry per conversation for the bridge to
   * notify.
   *
   * The rows are moved to `'interrupted'` BEFORE the caller sends anything.
   * That ordering is the whole point: a platform that rejects the notice
   * (deleted channel, revoked permission, offline transport) must not leave the
   * rows claimable, or every subsequent boot would sweep and re-notify the same
   * messages forever.
   *
   * NO turn is started for these rows, here or in the caller. A turn that died
   * at `auto-edit`/`yolo` may already have run `Write`/`Bash`; replaying it
   * would repeat side effects with no idempotency guarantee.
   */
  claimInterruptedInboundTurns(): InterruptedInboundConversation[] {
    const unfinished = this.messages.listUnfinishedInboundTurns();
    if (unfinished.length === 0) return [];

    this.messages.markTurnState(
      unfinished.map((row) => row.id),
      'interrupted',
    );

    // Group first, resolve second: one notice per conversation, however many
    // messages of theirs were caught mid-flight. Rows from before migration
    // 0038 carry no conversation id — they fall back to one notice per binding
    // (the parent chat) rather than being dropped silently.
    const groups = new Map<string, UnfinishedInboundTurn[]>();
    for (const row of unfinished) {
      const groupKey = row.conversationId
        ? `conversation:${row.conversationId}`
        : `binding:${row.bindingId}`;
      const bucket = groups.get(groupKey);
      if (bucket) {
        bucket.push(row);
      } else {
        groups.set(groupKey, [row]);
      }
    }

    const claimed: InterruptedInboundConversation[] = [];
    for (const rows of groups.values()) {
      const route = this.routeForInterrupted(rows[0]);
      if (!route) continue;
      claimed.push({ route, messageCount: rows.length });
    }
    if (claimed.length > 0) {
      this.logger.info('[gateway] claimed interrupted inbound turns', {
        messages: unfinished.length,
        conversations: claimed.length,
      });
    }
    return claimed;
  }

  /**
   * Rebuild the outbound route for an interrupted row. Returns null when the
   * binding is gone (revoked mid-turn, then restarted) — the row is already
   * marked `'interrupted'`, so there is nothing left to do but skip it.
   */
  private routeForInterrupted(
    row: UnfinishedInboundTurn,
  ): OutboundRoute | null {
    const binding = this.bindings.findById(row.bindingId);
    if (!binding) {
      this.logger.debug(
        '[gateway] interrupted inbound has no binding — no notice',
        { bindingId: String(row.bindingId) },
      );
      return null;
    }
    const conversation = row.conversationId
      ? this.conversations.findById(row.conversationId)
      : null;
    // `'default'` is the non-threaded sentinel: it must stay OUT of both the
    // conversation key and the route, exactly as `ConversationKey.for` and the
    // bridge's own `resolveRoute` treat it.
    const externalConversationId =
      conversation && conversation.externalConversationId !== 'default'
        ? conversation.externalConversationId
        : undefined;
    return {
      conversationKey: ConversationKey.for(
        binding.platform,
        binding.externalChatId,
        externalConversationId,
      ),
      platform: binding.platform,
      externalChatId: binding.externalChatId,
      ...(externalConversationId !== undefined
        ? { conversationId: externalConversationId }
        : {}),
    };
  }

  /**
   * Substitute the transcript for a voice note. A failed transcription is a
   * warn and nothing more — the message still flows with whatever text it
   * carried, because dropping it would look like the bot ignored the user.
   */
  private async withTranscript(msg: InboundMessage): Promise<string> {
    if (
      !msg.voicePath ||
      !readBool(this.workspace, SETTINGS_KEYS.voiceEnabled, true)
    ) {
      return msg.body;
    }
    try {
      const { text: transcript } = await this.voiceSelector
        .activeStt()
        .transcribe({ audioPath: msg.voicePath, mimeType: 'audio/ogg' });
      if (!transcript) return msg.body;
      return msg.body ? `${msg.body}\n${transcript}` : transcript;
    } catch (err) {
      this.logger.warn('[gateway] voice transcription failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return msg.body;
    }
  }

  /**
   * `'attach'` mode (a Discord thread already owned by a session) dispatches
   * ONLY into an existing approved binding: never `upsertPending`, never a
   * pairing prompt (AC 1.11).
   */
  private resolveAttachBinding(msg: InboundMessage): GatewayBinding | null {
    const existing = this.bindings.findByExternal(
      msg.platform,
      msg.externalChatId,
    );
    if (existing && existing.approvalStatus === 'approved') return existing;
    this.logger.debug(
      '[gateway] dropping attach inbound — no approved binding',
      {
        platform: msg.platform,
        externalChatId: msg.externalChatId,
        status: existing?.approvalStatus ?? 'none',
      },
    );
    return null;
  }

  /**
   * `'open'` mode: upsert the binding and gate on approval. A pending binding
   * gets the 6-digit pairing code exactly ONCE per process, then silence until
   * a human approves it in Ptah.
   */
  private async resolvePairedBinding(
    msg: InboundMessage,
  ): Promise<GatewayBinding | null> {
    const binding = this.bindings.upsertPending({
      platform: msg.platform,
      externalChatId: msg.externalChatId,
      displayName: msg.displayName,
      ...(msg.allowListId ? { allowListId: msg.allowListId } : {}),
    });

    if (binding.approvalStatus === 'approved') return binding;

    if (binding.approvalStatus !== 'pending') {
      this.logger.debug('[gateway] dropping inbound — binding not approved', {
        bindingId: binding.id,
        status: binding.approvalStatus,
      });
      return null;
    }

    this.emit('bindings-changed');
    if (this.pairingPromptSent.has(binding.id)) return null;
    const code = binding.pairingCode ?? '------';
    const reply =
      `Ptah pairing required. Approve this binding in Ptah using code: ${code}\n` +
      `(I will not respond to messages until approved.)`;
    try {
      const adapter = this.lifecycle.adapterFor(msg.platform);
      if (adapter) {
        await adapter.sendMessage(msg.externalChatId, reply);
      }
      this.pairingPromptSent.add(binding.id);
    } catch (error: unknown) {
      this.logger.warn('[gateway] failed to send pairing prompt', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }

  private async gcOldVoiceFiles(): Promise<void> {
    const cutoff = Date.now() - VOICE_RETENTION_MS;
    const stale = this.messages.listVoicePathsOlderThan(cutoff);
    let deleted = 0;
    for (const p of stale) {
      await fs.unlink(p);
      deleted++;
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
   * Subscribe the voice provider's STT download events and re-emit them on
   * `gateway:event` so the renderer's voice-model-download toast lights up.
   * Public so the activation layer can wire this once after DI registration
   * completes. (Renamed from `bridgeWhisperEvents` — same wire payloads.)
   */
  bridgeVoiceDownloadEvents(): void {
    if (this.voiceEventsBridged) return;
    this.voiceEventsBridged = true;
    this.voiceSelector.downloadEvents.onDownload((evt: VoiceDownloadEvent) => {
      if (evt.direction !== 'stt') return;
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
