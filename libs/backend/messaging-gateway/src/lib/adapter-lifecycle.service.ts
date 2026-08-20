/**
 * AdapterLifecycleService — everything about whether the three transports are
 * up, and what to do when one falls over.
 *
 * Extracted from `GatewayService` (TASK_2026_271) under the façade rule:
 * `GatewayService` keeps its name, token and every public signature and
 * delegates here. This class owns exactly one concern — transport lifecycle:
 *
 *   - the live `IMessagingAdapter` per platform (plus the test-override seam);
 *   - token decryption + the "ciphertext is unreadable" flag, because a token
 *     that will not decrypt is a start failure, not a settings problem;
 *   - start / stop per platform and the persisted enable flags;
 *   - the bounded-backoff reconnect loop ({@link RECONNECT_DELAYS_MS});
 *   - `lastError` per platform — connect failures, transport events AND the
 *     last agent turn's outcome, since all three compete for the one line of
 *     text the Gateway tab shows under the status dot.
 *
 * Inbound messages are NOT its business: it wires the adapter's `inbound`
 * event to the handler `GatewayService` installs via
 * {@link setInboundHandler} and returns that handler's promise unchanged, so
 * an adapter that awaits its listener still awaits the real work.
 *
 * Emits `'status-changed'` with `{ platform, state }`; `GatewayService`
 * re-emits it so `gateway.on('status-changed')` keeps working for
 * `GatewayRpcHandlers`.
 */
import { EventEmitter } from 'node:events';
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
import {
  SETTINGS_KEYS,
  allowedKeyFor,
  enabledKeyFor,
  readBool,
  readStringArray,
} from './gateway-settings-access';
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
  AdapterConnectionEvent,
  IMessagingAdapter,
  InboundListener,
} from './adapters/adapter.interface';
import type { IGatewayCommandHandler } from './commands/gateway-command.types';
import type { GatewayPlatform } from './types';

/**
 * Bounded backoff for adapter (re)connects: a boot-time login that fails on
 * a flaky network, or a Discord session the platform invalidated. Before this
 * a failed start left the adapter dead until the user toggled it by hand
 * (TASK_2026_271 #4/#6). Attempts beyond the last delay reuse it; the retry
 * loop stops only on success, `stopPlatform`, or `stop`.
 */
const RECONNECT_DELAYS_MS: readonly number[] = [
  5_000, 15_000, 45_000, 120_000, 300_000,
];

/**
 * Marks a `lastError` that came from an agent turn rather than the transport,
 * so a later successful turn clears only its own kind of error and never
 * hides a live connect failure.
 */
const TURN_ERROR_PREFIX = 'Last turn: ';

const ALL_PLATFORMS: readonly GatewayPlatform[] = [
  'telegram',
  'discord',
  'slack',
];

export interface GatewayStatus {
  enabled: boolean;
  adapters: Array<{
    platform: GatewayPlatform;
    running: boolean;
    lastError?: string;
  }>;
}

/** Test seam: fake adapters + a timer that does not make specs wait. */
export interface AdapterTestOverrides {
  telegram?: IMessagingAdapter;
  discord?: IMessagingAdapter;
  slack?: IMessagingAdapter;
  scheduleTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

/** Client-library factories, injected before start (integration seam). */
export interface AdapterFactoryOverrides {
  telegramBotFactory?: TelegramBotFactory;
  discordClientFactory?: DiscordClientFactory;
  slackAppFactory?: SlackAppFactory;
}

@injectable()
export class AdapterLifecycleService extends EventEmitter {
  private readonly adapters = new Map<GatewayPlatform, IMessagingAdapter>();
  private readonly lastErrors = new Map<GatewayPlatform, string>();

  /** Ciphertext-decrypt-failure flag — surfaced via gateway:status. */
  private readonly decryptFailures = new Set<GatewayPlatform>();

  /** Pending reconnect timers, one per platform; cleared on stop. */
  private readonly reconnectTimers = new Map<
    GatewayPlatform,
    ReturnType<typeof setTimeout>
  >();
  private readonly reconnectAttempts = new Map<GatewayPlatform, number>();

  /**
   * Platforms the operator (or shutdown) has asked to be DOWN.
   *
   * Cancelling a reconnect used to mean cancelling a pending timer, which does
   * nothing once the timer has already fired: its callback removes itself from
   * {@link reconnectTimers} and runs {@link reconnect} as an independent chain
   * that nobody holds a handle to. That chain checks the enable flag once at
   * entry and then calls `maybeStart(platform, true)` — and `force` exists
   * precisely to walk past that flag. A `stopPlatform()` / `stop()` landing in
   * the window between the check and `adapter.start()` (a window that contains
   * a real network `login()`) therefore brought the adapter back up after the
   * caller believed it stopped; at shutdown that leaves a live Discord /
   * Telegram / Slack connection running past `will-quit`.
   *
   * This set is the standing answer to "should this platform be up?", so it
   * survives the awaits a cancellation flag scoped to one reconnect would not.
   * It is checked in {@link maybeStart} and again in {@link startAdapter} —
   * the last gate before the network call — and OUTRANKS `force`. Only an
   * explicit start ({@link startPlatform} / {@link startEnabled}) clears it.
   */
  private readonly stopping = new Set<GatewayPlatform>();

  /** Test seam: swap the timer so specs do not wait for real backoff. */
  private scheduleTimer: (
    fn: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout> = (fn, ms) => {
    const timer = setTimeout(fn, ms);
    // A pending reconnect must never keep the process alive on its own.
    (timer as { unref?: () => void }).unref?.();
    return timer;
  };

  private inboundHandler: InboundListener | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(GATEWAY_TOKENS.GATEWAY_TOKEN_VAULT)
    private readonly vault: ITokenVault,
    @inject(SETTINGS_TOKENS.GATEWAY_SETTINGS)
    private readonly gatewaySettings: GatewaySettings,
    @inject(GrammyTelegramAdapter)
    private readonly telegram: GrammyTelegramAdapter,
    @inject(DiscordAdapter) private readonly discord: DiscordAdapter,
    @inject(BoltSlackAdapter) private readonly slack: BoltSlackAdapter,
    @inject(GATEWAY_TOKENS.GATEWAY_COMMAND_SERVICE)
    private readonly commandHandler: IGatewayCommandHandler,
  ) {
    super();
  }

  /**
   * Install the inbound sink. Exactly one handler; its promise is returned to
   * the adapter untouched so `await listener(msg)` inside an adapter still
   * awaits the gateway's persistence + dispatch.
   */
  setInboundHandler(handler: InboundListener): void {
    this.inboundHandler = handler;
  }

  /** Test/integration seam — production callers do not invoke this. */
  configureForTest(overrides: AdapterTestOverrides): void {
    if (overrides.telegram) this.adapters.set('telegram', overrides.telegram);
    if (overrides.discord) this.adapters.set('discord', overrides.discord);
    if (overrides.slack) this.adapters.set('slack', overrides.slack);
    if (overrides.scheduleTimer) this.scheduleTimer = overrides.scheduleTimer;
  }

  /** Inject client-library factories before start. */
  configureFactories(opts: AdapterFactoryOverrides): void {
    if (opts.telegramBotFactory)
      this.telegram.configure({ factory: opts.telegramBotFactory });
    if (opts.discordClientFactory)
      this.discord.configure({ factory: opts.discordClientFactory });
    if (opts.slackAppFactory)
      this.slack.configure({ factory: opts.slackAppFactory });
  }

  /** The live adapter for a platform, or undefined when none is started. */
  adapterFor(platform: GatewayPlatform): IMessagingAdapter | undefined {
    return this.adapters.get(platform);
  }

  status(): GatewayStatus {
    return {
      enabled: readBool(this.workspace, SETTINGS_KEYS.enabled, false),
      adapters: ALL_PLATFORMS.map((platform) => ({
        platform,
        running: this.adapters.get(platform)?.isRunning() ?? false,
        lastError: this.lastErrors.get(platform),
      })),
    };
  }

  /** Start every platform whose enable flag is set, master switch permitting. */
  async startEnabled(): Promise<void> {
    if (!readBool(this.workspace, SETTINGS_KEYS.enabled, false)) {
      this.logger.info('[gateway] master switch off; not starting adapters');
      return;
    }
    // An explicit start supersedes any earlier stop request: this is the boot
    // path, and a `stopping` entry left over from a previous `stop()` in the
    // same process would silently make every adapter unstartable.
    this.stopping.clear();
    for (const platform of ALL_PLATFORMS) await this.maybeStart(platform);
  }

  /**
   * Force-start one platform (ignores its enable flag) and, only if the
   * adapter is actually running afterwards, persist the flags so the next boot
   * auto-starts it.
   */
  async startPlatform(platform: GatewayPlatform): Promise<void> {
    this.stopping.delete(platform);
    await this.maybeStart(platform, true);
    if (this.adapters.get(platform)?.isRunning() !== true) return;
    await this.workspace.setConfiguration(
      'ptah',
      enabledKeyFor(platform),
      true,
    );
    await this.workspace.setConfiguration('ptah', SETTINGS_KEYS.enabled, true);
  }

  /**
   * Stop one platform and clear its enable flag. The master switch is cleared
   * only when no sibling platform is still enabled, so stopping Telegram never
   * silently disables Discord at the next boot.
   */
  async stopPlatform(platform: GatewayPlatform): Promise<void> {
    // Before anything that awaits: a reconnect already past its enable check
    // must find this flag when it resumes, or `force: true` restarts what we
    // are stopping. Cleared only by an explicit `startPlatform`.
    this.stopping.add(platform);
    this.cancelReconnect(platform);
    const adapter = this.adapters.get(platform);
    if (adapter) {
      try {
        await adapter.stop();
      } catch (error: unknown) {
        this.lastErrors.set(
          platform,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    await this.workspace.setConfiguration(
      'ptah',
      enabledKeyFor(platform),
      false,
    );
    const anyEnabled = ALL_PLATFORMS.filter((p) => p !== platform).some((p) =>
      readBool(this.workspace, enabledKeyFor(p), false),
    );
    if (!anyEnabled) {
      await this.workspace.setConfiguration(
        'ptah',
        SETTINGS_KEYS.enabled,
        false,
      );
    }
  }

  /**
   * First move of a graceful shutdown: disarm every pending reconnect AND mark
   * every platform as stopping, so a reconnect whose timer already fired
   * cannot bring a transport back up between here and `will-quit`. Clearing
   * the timers alone is not enough — a fired timer's chain holds no handle we
   * could clear (see {@link stopping}).
   */
  cancelAllReconnects(): void {
    for (const platform of ALL_PLATFORMS) {
      this.stopping.add(platform);
      this.cancelReconnect(platform);
    }
  }

  /** Stop every started adapter; one that throws must not block the others. */
  async stopAdapters(): Promise<void> {
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

  /** Apply an allow-list to the live adapter so it takes effect without a restart. */
  applyAllowList(
    platform: GatewayPlatform,
    entries: ReadonlyArray<string>,
  ): void {
    if (platform === 'telegram') {
      this.telegram.configure({ allowedUserIds: entries });
    } else if (platform === 'discord') {
      this.discord.configure({ allowedGuildIds: entries });
    } else {
      this.slack.configure({ allowedTeamIds: entries });
    }
  }

  /** Servers the Discord bot is currently in — empty until connected. */
  listDiscordGuilds(): Array<{ id: string; name: string }> {
    return this.discord.listGuilds();
  }

  /** A freshly stored token supersedes an earlier decrypt failure. */
  clearDecryptFailure(platform: GatewayPlatform): void {
    this.decryptFailures.delete(platform);
  }

  /**
   * Record how the last agent turn on a platform ended so the Gateway tab
   * can show it (TASK_2026_271 #7). Transport events already keep
   * `lastError` truthful for connect/disconnect; without this, a turn that
   * hit the watchdog, failed to deliver, or errored left the tab green and
   * silent. A successful turn clears a previous turn error. Emits
   * `status-changed` only when the visible status actually changes.
   */
  recordTurnOutcome(
    platform: GatewayPlatform,
    outcome: { ok: true } | { ok: false; reason: string },
  ): void {
    const before = this.lastErrors.get(platform);
    if (outcome.ok) {
      if (before === undefined || !before.startsWith(TURN_ERROR_PREFIX)) return;
      this.lastErrors.delete(platform);
    } else {
      const next = `${TURN_ERROR_PREFIX}${outcome.reason}`;
      if (before === next) return;
      this.lastErrors.set(platform, next);
    }
    this.emit('status-changed', { platform, state: 'turn' });
  }

  /**
   * Decrypt a platform's stored bot token. Returns null — never throws — for
   * every "cannot start" reason: no cipher stored, an unreadable secrets file,
   * or a cipher this vault cannot open (wrong machine, rotated OS key). The
   * last case is latched into `lastError` once so the Gateway tab can tell the
   * user to re-enter the token rather than showing a bare red dot.
   */
  async decryptToken(platform: GatewayPlatform): Promise<string | null> {
    let cipher: string | undefined;
    try {
      if (platform === 'telegram') {
        cipher = await this.gatewaySettings.telegramTokenCipher.get();
      } else if (platform === 'discord') {
        cipher = await this.gatewaySettings.discordTokenCipher.get();
      } else {
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

  private wireAdapter(
    platform: GatewayPlatform,
    adapter: IMessagingAdapter,
  ): void {
    this.adapters.set(platform, adapter);
    adapter.on('inbound', (msg) => this.inboundHandler?.(msg));
    adapter.setCommandHandler?.(this.commandHandler);
    adapter.onConnectionChange?.((event) =>
      this.onAdapterConnection(platform, event),
    );
  }

  /**
   * Transport state from an adapter. Keeps `lastError` truthful, pushes a
   * `status-changed` so the Gateway tab flips its dot without a reload, and
   * on `'invalidated'` (client library gave up) restarts the adapter with
   * backoff. Errors from other states are recorded but not acted on — either
   * the client library reconnects those on its own, or, as with a Telegram
   * 401, no amount of reconnecting can help and only the user can fix it.
   */
  private onAdapterConnection(
    platform: GatewayPlatform,
    event: AdapterConnectionEvent,
  ): void {
    if (event.state === 'connected') {
      this.lastErrors.delete(platform);
      this.reconnectAttempts.delete(platform);
    } else if (event.reason) {
      this.lastErrors.set(platform, event.reason);
    }
    this.emit('status-changed', { platform, state: event.state });
    if (event.state === 'invalidated') {
      this.scheduleReconnect(platform, event.reason ?? 'session invalidated');
    }
  }

  private scheduleReconnect(platform: GatewayPlatform, reason: string): void {
    if (this.stopping.has(platform)) return; // stopped on purpose
    if (this.reconnectTimers.has(platform)) return; // one in flight
    const attempt = this.reconnectAttempts.get(platform) ?? 0;
    const delay =
      RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts.set(platform, attempt + 1);
    this.logger.warn('[gateway] scheduling adapter reconnect', {
      platform,
      attempt: attempt + 1,
      delayMs: delay,
      reason,
    });
    const timer = this.scheduleTimer(() => {
      this.reconnectTimers.delete(platform);
      void this.reconnect(platform);
    }, delay);
    this.reconnectTimers.set(platform, timer);
  }

  private cancelReconnect(platform: GatewayPlatform): void {
    const timer = this.reconnectTimers.get(platform);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(platform);
    this.reconnectAttempts.delete(platform);
  }

  private async reconnect(platform: GatewayPlatform): Promise<void> {
    // Still enabled? The user may have switched it off while we waited.
    if (
      !readBool(this.workspace, enabledKeyFor(platform), false) ||
      this.stopping.has(platform)
    ) {
      this.reconnectAttempts.delete(platform);
      return;
    }
    const adapter = this.adapters.get(platform);
    try {
      await adapter?.stop();
    } catch (error: unknown) {
      this.logger.warn('[gateway] adapter stop before reconnect failed', {
        platform,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Re-checked AFTER the await, and again inside `maybeStart` /
    // `startAdapter`: the checks above are stale the moment we yield, and
    // `force: true` below would otherwise walk straight past the enable flag a
    // concurrent `stopPlatform()` just cleared.
    if (this.stopping.has(platform)) return;
    await this.maybeStart(platform, true);
    this.emit('status-changed', {
      platform,
      state: this.adapters.get(platform)?.isRunning()
        ? 'connected'
        : 'disconnected',
    });
  }

  /** The adapter WE own for a platform, ignoring any test override. */
  private ownAdapter(platform: GatewayPlatform): IMessagingAdapter {
    if (platform === 'telegram') return this.telegram;
    if (platform === 'discord') return this.discord;
    return this.slack;
  }

  /**
   * Shared tail of every `maybeStart*`: run the adapter's `start`, record the
   * outcome, and on failure arm a bounded-backoff retry instead of leaving the
   * adapter dead until the user notices the red dot and toggles it.
   */
  private async startAdapter(
    platform: GatewayPlatform,
    run: () => Promise<void>,
  ): Promise<void> {
    // Last gate before the network call. `maybeStart` already checked, but
    // decrypting the token awaits, and a stop landing in that window must win
    // — otherwise `login()` fires and leaks a live connection past `will-quit`.
    if (this.stopping.has(platform)) return;
    try {
      await run();
      this.lastErrors.delete(platform);
      this.reconnectAttempts.delete(platform);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastErrors.set(platform, msg);
      this.logger.warn(`[gateway] ${platform} start failed`, { error: msg });
      this.scheduleReconnect(platform, msg);
    }
  }

  /**
   * Wire and start one platform. `force` bypasses the enable flag (the Start
   * button and the reconnect loop both want that); without it this is the
   * boot-time "start what the user left enabled" path.
   *
   * A missing or unreadable token is NOT an error here — `decryptToken` has
   * already recorded why — it simply means there is nothing to start.
   *
   * A pending stop request OUTRANKS `force`: `force` exists so the Start
   * button and the reconnect loop can ignore the enable *flag*, never so a
   * reconnect can resurrect a platform the operator (or shutdown) just
   * stopped.
   */
  private async maybeStart(
    platform: GatewayPlatform,
    force = false,
  ): Promise<void> {
    if (this.stopping.has(platform)) return;
    if (!force && !readBool(this.workspace, enabledKeyFor(platform), false)) {
      return;
    }
    const own = this.ownAdapter(platform);
    const existing = this.adapters.get(platform) ?? own;
    this.wireAdapter(platform, existing);
    // A test override brings its own allow-list handling; only configure ours.
    if (existing === own) {
      this.applyAllowList(
        platform,
        readStringArray(this.workspace, allowedKeyFor(platform)),
      );
    }
    const token = await this.decryptToken(platform);
    const appToken =
      platform === 'slack' ? await this.decryptSlackAppToken() : null;
    if (!token) return;
    if (platform === 'slack') {
      if (!appToken) return;
      await this.startAdapter(platform, () =>
        existing.start(token, { appToken }),
      );
      return;
    }
    await this.startAdapter(platform, () => existing.start(token));
  }
}
