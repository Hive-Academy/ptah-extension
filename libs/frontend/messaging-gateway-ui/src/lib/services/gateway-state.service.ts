import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type GatewayBindingDto,
  type GatewayDiscordGuildDto,
  type GatewayPlatformId,
  type GatewayRegisterDiscordCommandsResult,
  type GatewayStatusChangedPayload,
  type GatewayStatusResult,
  type GatewayTestPlatform,
  type GatewayTestResult,
} from '@ptah-extension/shared';

import { GatewayRpcService } from './gateway-rpc.service';

/** Adapter status as surfaced in the UI per-platform card. */
export type PlatformAdapterState = 'stopped' | 'starting' | 'running' | 'error';

/** Per-platform UI status, derived from {@link GatewayStatusResult}. */
export interface PlatformStatus {
  readonly state: PlatformAdapterState;
  readonly lastError: string | null;
}

/** Voice model download progress payload (forwarded from backend). */
export interface VoiceModelDownloadProgress {
  readonly modelName: string;
  readonly percent: number;
  readonly error: string | null;
  readonly done: boolean;
}

/** Read-only view of `~/.ptah/settings.json` rate-limit fields. */
export interface RateLimitView {
  readonly minTimeMs: number;
  readonly maxConcurrent: number;
}

const DEFAULT_PLATFORM_STATUS: PlatformStatus = {
  state: 'stopped',
  lastError: null,
};

const ALL_PLATFORMS: readonly GatewayPlatformId[] = [
  'telegram',
  'discord',
  'slack',
] as const;

type PlatformStatusMap = Readonly<Record<GatewayPlatformId, PlatformStatus>>;
type PlatformErrorMap = Readonly<Record<GatewayPlatformId, string | null>>;

function emptyStatusMap(): PlatformStatusMap {
  return {
    telegram: DEFAULT_PLATFORM_STATUS,
    discord: DEFAULT_PLATFORM_STATUS,
    slack: DEFAULT_PLATFORM_STATUS,
  };
}

function emptyErrorMap(): PlatformErrorMap {
  return { telegram: null, discord: null, slack: null };
}

/**
 * GatewayStateService
 *
 * Signal-based state container for the messaging-gateway tab. Owns:
 * - master enable flag (mirror of `gateway:status.enabled`)
 * - per-platform adapter status (running / starting / error)
 * - bindings list with pending-bindings computed view
 * - last-error per platform (cleared on next successful op)
 * - voice toggle + read-only rate-limit fields
 * - voice model download progress (one-time toast)
 *
 * SECURITY: this service NEVER stores plaintext tokens. `setToken` is a
 * pass-through to {@link GatewayRpcService.setToken} — the token argument is
 * not retained, logged, or persisted at this layer.
 */
@Injectable({ providedIn: 'root' })
export class GatewayStateService implements MessageHandler {
  private readonly rpc = inject(GatewayRpcService);
  private readonly destroyRef = inject(DestroyRef);

  /** Message types this service handles via MessageRouterService. */
  public readonly handledMessageTypes = [
    MESSAGE_TYPES.GATEWAY_STATUS_CHANGED,
  ] as const;

  /**
   * Set of origin tokens stamped by in-flight user-initiated start/stop/setToken
   * calls. Each call adds its UUID; the matching GATEWAY_STATUS_CHANGED echo
   * removes it via `delete()`. Using a `Set` (not a single ref) tolerates rapid
   * sequential platform actions — e.g. enable Telegram immediately followed by
   * enable Discord — without overwriting the first action's token before its
   * echo arrives. Orphaned tokens (echo never arrived
   * because backend broadcast failed) are harmless: UUIDs do not collide with
   * future origins, and the entries are ~36 bytes each. NOT a signal — nothing
   * renders it.
   */
  private readonly _pendingOrigins = new Set<string>();
  public readonly globalError = signal<string | null>(null);
  public readonly enabled = signal<boolean>(false);
  public readonly platforms = signal<PlatformStatusMap>(emptyStatusMap());
  public readonly bindings = signal<readonly GatewayBindingDto[]>([]);
  public readonly lastError = signal<PlatformErrorMap>(emptyErrorMap());
  public readonly voiceEnabled = signal<boolean>(false);
  public readonly rateLimit = signal<RateLimitView>({
    minTimeMs: 500,
    maxConcurrent: 2,
  });
  /** Persisted allow-list per platform (mirror of settings.json). */
  public readonly allowLists = signal<Record<GatewayPlatformId, string[]>>({
    telegram: [],
    discord: [],
    slack: [],
  });
  /** Persisted Discord application (client) id, or null if unset. */
  public readonly discordAppId = signal<string | null>(null);
  /** Servers the connected Discord bot is in (empty until started + refreshed). */
  public readonly discordGuilds = signal<readonly GatewayDiscordGuildDto[]>([]);
  /**
   * Voice-model download progress signal — currently inert.
   *
   * The signal + `dismissVoiceToast()` action + template binding are
   * preserved as the public API surface for when a real
   * `MESSAGE_TYPES.GATEWAY_VOICE_DOWNLOAD_PROGRESS` push event is wired.
   * Until then the signal stays `null` and the template `@if` block stays
   * hidden.
   */
  public readonly voiceDownload = signal<VoiceModelDownloadProgress | null>(
    null,
  );
  public readonly loading = signal<boolean>(false);
  public readonly testResult = signal<{
    readonly platform: GatewayPlatformId;
    readonly ok: boolean;
    readonly message: string;
  } | null>(null);
  public readonly pendingBindings = computed(() =>
    this.bindings().filter((b) => b.approvalStatus === 'pending'),
  );

  public readonly approvedBindings = computed(() =>
    this.bindings().filter((b) => b.approvalStatus === 'approved'),
  );

  public readonly hasApprovedBindingFor = (
    platform: GatewayPlatformId,
  ): boolean => this.approvedBindings().some((b) => b.platform === platform);

  /**
   * Boot the state service: one-time initial hydration of status + bindings.
   * Subsequent updates arrive via the MessageHandler `handleMessage` callback
   * (GATEWAY_STATUS_CHANGED push events from the backend).
   */
  public async initialize(): Promise<void> {
    await Promise.all([
      this.refreshStatus(),
      this.listBindings(),
      this.loadAllowLists(),
      this.loadDiscordAppId(),
      this.loadDiscordGuilds(),
    ]);
  }

  /** Refresh the list of servers the Discord bot is in (no-op list if stopped). */
  public async loadDiscordGuilds(): Promise<void> {
    try {
      const { guilds } = await this.rpc.listDiscordGuilds();
      this.discordGuilds.set(guilds);
    } catch (err) {
      this.recordPlatformError('discord', err);
    }
  }

  private async loadAllowLists(): Promise<void> {
    await Promise.all(ALL_PLATFORMS.map((p) => this.loadAllowList(p)));
  }

  public async loadAllowList(platform: GatewayPlatformId): Promise<void> {
    try {
      const { entries } = await this.rpc.getAllowList(platform);
      this.allowLists.update((current) => ({
        ...current,
        [platform]: entries,
      }));
    } catch (err) {
      this.recordPlatformError(platform, err);
    }
  }

  /**
   * Persist a platform allow-list, then re-read it so the signal reflects the
   * trimmed/de-duplicated server-side value.
   */
  public async saveAllowList(
    platform: GatewayPlatformId,
    entries: string[],
  ): Promise<{ ok: boolean; error?: string }> {
    this.clearError(platform);
    try {
      await this.rpc.setAllowList(platform, entries);
      await this.loadAllowList(platform);
      return { ok: true };
    } catch (err) {
      this.recordPlatformError(platform, err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async loadDiscordAppId(): Promise<void> {
    try {
      const { applicationId } = await this.rpc.getDiscordAppId();
      this.discordAppId.set(applicationId);
    } catch (err) {
      this.recordPlatformError('discord', err);
    }
  }

  public async saveDiscordAppId(
    applicationId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.rpc.setDiscordAppId(applicationId);
      this.discordAppId.set(applicationId.trim() || null);
      return { ok: true };
    } catch (err) {
      this.recordPlatformError('discord', err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async registerDiscordCommands(): Promise<GatewayRegisterDiscordCommandsResult> {
    try {
      return await this.rpc.registerDiscordCommands();
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * MessageHandler entry point. Called by MessageRouterService when a
   * GATEWAY_STATUS_CHANGED event is dispatched from the backend.
   *
   * Self-echo suppression: if `payload.origin` matches the token stamped by
   * a recent user-initiated start/stop call, drop the event (the optimistic
   * UI update has already been applied). Origin === null means the change
   * was triggered externally (boot, crash recovery) and must be applied.
   */
  public handleMessage(msg: { type: string; payload?: unknown }): void {
    const payload = msg.payload as GatewayStatusChangedPayload | undefined;
    if (!payload) return;
    if (payload.origin !== null && this._pendingOrigins.has(payload.origin)) {
      this._pendingOrigins.delete(payload.origin);
      return;
    }
    this.applyStatus(payload.status);
  }

  public async refreshStatus(): Promise<void> {
    try {
      const status = await this.rpc.status();
      this.applyStatus(status);
    } catch (err) {
      this.recordGlobalError(err);
    }
  }

  public async listBindings(): Promise<void> {
    try {
      const { bindings } = await this.rpc.listBindings();
      this.bindings.set(bindings);
    } catch (err) {
      this.recordGlobalError(err);
    }
  }

  /**
   * Pass-through to the RPC layer. Caller is responsible for clearing the
   * token field synchronously after this Promise settles. The token argument
   * is NOT retained by the state service.
   */
  public async setToken(
    platform: GatewayPlatformId,
    token: string,
    slackAppToken?: string,
  ): Promise<void> {
    this.clearError(platform);
    try {
      const params: {
        platform: GatewayPlatformId;
        token: string;
        slackAppToken?: string;
      } = { platform, token };
      if (slackAppToken) params.slackAppToken = slackAppToken;
      await this.rpc.setToken(params);
      this.markStarting(platform);
      const origin = crypto.randomUUID();
      this._pendingOrigins.add(origin);
      try {
        await this.rpc.start(platform, origin);
      } catch (startErr) {
        this.recordPlatformError(platform, startErr);
      } finally {
        await this.refreshStatus();
        this._pendingOrigins.delete(origin);
      }
    } catch (err) {
      this.recordPlatformError(platform, err);
      throw err;
    }
  }

  public async startPlatform(platform: GatewayPlatformId): Promise<void> {
    this.clearError(platform);
    this.markStarting(platform);
    const origin = crypto.randomUUID();
    this._pendingOrigins.add(origin);
    try {
      await this.rpc.start(platform, origin);
      await this.refreshStatus();
    } catch (err) {
      this.recordPlatformError(platform, err);
    } finally {
      this._pendingOrigins.delete(origin);
    }
  }

  public async stopPlatform(platform: GatewayPlatformId): Promise<void> {
    this.clearError(platform);
    const origin = crypto.randomUUID();
    this._pendingOrigins.add(origin);
    try {
      await this.rpc.stop(platform, origin);
      await this.refreshStatus();
    } catch (err) {
      this.recordPlatformError(platform, err);
    } finally {
      this._pendingOrigins.delete(origin);
    }
  }

  /**
   * Approve a pending binding by submitting the user-entered pairing code.
   * Returns a discriminated result so the caller can distinguish a code
   * mismatch (clear input + show toast) from a generic transport failure.
   */
  public async approveBinding(
    bindingId: string,
    code: string,
    platform: GatewayPlatformId,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const result = await this.rpc.approveBinding(bindingId, code);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      await this.listBindings();
      return { ok: true };
    } catch (err) {
      this.recordPlatformError(platform, err);
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  public async rejectBinding(
    bindingId: string,
    platform: GatewayPlatformId,
  ): Promise<void> {
    try {
      await this.rpc.blockBinding(bindingId, 'rejected');
      await this.listBindings();
    } catch (err) {
      this.recordPlatformError(platform, err);
    }
  }

  public async revokeBinding(
    bindingId: string,
    platform: GatewayPlatformId,
  ): Promise<void> {
    try {
      await this.rpc.blockBinding(bindingId, 'revoked');
      await this.listBindings();
    } catch (err) {
      this.recordPlatformError(platform, err);
    }
  }

  public async sendTest(
    platform: GatewayTestPlatform,
    bindingId?: string,
  ): Promise<GatewayTestResult> {
    this.testResult.set(null);
    try {
      const result = await this.rpc.test(platform, bindingId);
      const platformId =
        platform === 'telegram' ||
        platform === 'discord' ||
        platform === 'slack'
          ? platform
          : 'telegram';
      this.testResult.set({
        platform: platformId,
        ok: result.ok,
        message: result.ok
          ? 'Test message sent.'
          : (result.error ?? 'Test failed (unknown reason).'),
      });
      return result;
    } catch (err) {
      const platformId: GatewayPlatformId =
        platform === 'discord' || platform === 'slack' ? platform : 'telegram';
      const message = err instanceof Error ? err.message : String(err);
      this.testResult.set({ platform: platformId, ok: false, message });
      throw err;
    }
  }

  /**
   * Hydrate the read-only settings mirror from values discovered elsewhere
   * (e.g. a future `config:get` call). Today the AppShell may inject these;
   * the component uses defaults if not provided.
   */
  public setRateLimit(view: RateLimitView): void {
    this.rateLimit.set(view);
  }

  public setVoiceEnabled(enabled: boolean): void {
    this.voiceEnabled.set(enabled);
  }

  public dismissVoiceToast(): void {
    this.voiceDownload.set(null);
  }

  private applyStatus(status: GatewayStatusResult): void {
    this.enabled.set(status.enabled);
    const next: Record<GatewayPlatformId, PlatformStatus> = emptyStatusMap();
    for (const platform of ALL_PLATFORMS) {
      const adapter = status.adapters.find((a) => a.platform === platform);
      if (!adapter) {
        next[platform] = DEFAULT_PLATFORM_STATUS;
        continue;
      }
      if (adapter.lastError) {
        next[platform] = {
          state: 'error',
          lastError: adapter.lastError,
        };
      } else if (adapter.running) {
        next[platform] = { state: 'running', lastError: null };
      } else {
        next[platform] = { state: 'stopped', lastError: null };
      }
    }
    this.platforms.set(next);
  }

  private markStarting(platform: GatewayPlatformId): void {
    this.platforms.update((current) => ({
      ...current,
      [platform]: { state: 'starting', lastError: null },
    }));
  }

  private clearError(platform: GatewayPlatformId): void {
    this.lastError.update((current) => ({ ...current, [platform]: null }));
  }

  private recordPlatformError(platform: GatewayPlatformId, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.lastError.update((current) => ({ ...current, [platform]: message }));
    this.platforms.update((current) => ({
      ...current,
      [platform]: { state: 'error', lastError: message },
    }));
  }
  private recordGlobalError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.globalError.set(message);
  }

  public clearGlobalError(): void {
    this.globalError.set(null);
  }
}
