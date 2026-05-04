import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import type {
  GatewayBindingDto,
  GatewayPlatformId,
  GatewayStatusResult,
  GatewayTestPlatform,
  GatewayTestResult,
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

/** Polling cadence for the bindings queue when no event arrives. */
const BINDINGS_POLL_INTERVAL_MS = 30_000;

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
export class GatewayStateService {
  private readonly rpc = inject(GatewayRpcService);
  private readonly destroyRef = inject(DestroyRef);

  // ── State signals ──────────────────────────────────────────────────────
  public readonly enabled = signal<boolean>(false);
  public readonly platforms = signal<PlatformStatusMap>(emptyStatusMap());
  public readonly bindings = signal<readonly GatewayBindingDto[]>([]);
  public readonly lastError = signal<PlatformErrorMap>(emptyErrorMap());
  public readonly voiceEnabled = signal<boolean>(false);
  public readonly rateLimit = signal<RateLimitView>({
    minTimeMs: 500,
    maxConcurrent: 2,
  });
  public readonly whisperModel = signal<string>('base.en');
  public readonly voiceDownload = signal<VoiceModelDownloadProgress | null>(
    null,
  );
  public readonly loading = signal<boolean>(false);
  public readonly testResult = signal<{
    readonly platform: GatewayPlatformId;
    readonly ok: boolean;
    readonly message: string;
  } | null>(null);

  // ── Computed views ─────────────────────────────────────────────────────
  public readonly pendingBindings = computed(() =>
    this.bindings().filter((b) => b.approvalStatus === 'pending'),
  );

  public readonly approvedBindings = computed(() =>
    this.bindings().filter((b) => b.approvalStatus === 'approved'),
  );

  public readonly hasApprovedBindingFor = (
    platform: GatewayPlatformId,
  ): boolean => this.approvedBindings().some((b) => b.platform === platform);

  // ── Internal subscription state ────────────────────────────────────────
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private messageListener: ((event: MessageEvent) => void) | null = null;
  /** Set of voice-model-download events seen this session — toast is one-shot. */
  private voiceToastShown = false;

  public constructor() {
    this.destroyRef.onDestroy(() => this.teardown());
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Boot the state service: initial fetch + subscribe to events + start polling. */
  public async initialize(): Promise<void> {
    this.subscribeEvents();
    this.startPolling();
    await Promise.all([this.refreshStatus(), this.listBindings()]);
  }

  private teardown(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }
  }

  // ── Public actions ─────────────────────────────────────────────────────

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
      // After persisting the token, kick the adapter and refresh status.
      this.markStarting(platform);
      try {
        await this.rpc.start(platform);
      } catch (startErr) {
        this.recordPlatformError(platform, startErr);
      }
      await this.refreshStatus();
    } catch (err) {
      this.recordPlatformError(platform, err);
      throw err;
    }
  }

  public async startPlatform(platform: GatewayPlatformId): Promise<void> {
    this.clearError(platform);
    this.markStarting(platform);
    try {
      await this.rpc.start(platform);
      await this.refreshStatus();
    } catch (err) {
      this.recordPlatformError(platform, err);
    }
  }

  public async stopPlatform(platform: GatewayPlatformId): Promise<void> {
    this.clearError(platform);
    try {
      await this.rpc.stop(platform);
      await this.refreshStatus();
    } catch (err) {
      this.recordPlatformError(platform, err);
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
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const result = await this.rpc.approveBinding(bindingId, code);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      await this.listBindings();
      return { ok: true };
    } catch (err) {
      this.recordGlobalError(err);
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  public async rejectBinding(bindingId: string): Promise<void> {
    try {
      await this.rpc.blockBinding(bindingId, 'rejected');
      await this.listBindings();
    } catch (err) {
      this.recordGlobalError(err);
    }
  }

  public async revokeBinding(bindingId: string): Promise<void> {
    try {
      await this.rpc.blockBinding(bindingId, 'revoked');
      await this.listBindings();
    } catch (err) {
      this.recordGlobalError(err);
    }
  }

  public async sendTest(
    platform: GatewayTestPlatform,
    bindingId?: string,
  ): Promise<GatewayTestResult> {
    this.testResult.set(null);
    try {
      const result = await this.rpc.test(platform, bindingId);
      // Record a UI-friendly flash (success or error) so the template can
      // surface it without rebuilding the result shape.
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
   * Subscribes to `gateway:event` IPC frames forwarded by the host. Today the
   * backend emits voice-model-download / -error; future kinds (binding-requested,
   * adapter reconnects) extend the same channel.
   */
  public subscribeEvents(): void {
    if (this.messageListener) return; // idempotent

    const listener = (event: MessageEvent): void => {
      const data = event.data as
        | { type?: string; payload?: unknown }
        | null
        | undefined;
      if (!data || data.type !== 'gateway:event') return;
      this.handleGatewayEvent(data.payload);
    };
    this.messageListener = listener;
    window.addEventListener('message', listener);
  }

  // ── Settings injection (read-only mirror) ──────────────────────────────

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

  public setWhisperModel(name: string): void {
    this.whisperModel.set(name);
  }

  public dismissVoiceToast(): void {
    this.voiceDownload.set(null);
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this.listBindings();
    }, BINDINGS_POLL_INTERVAL_MS);
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
    // Spread a global error across all platforms only if the error is
    // platform-agnostic (network / RPC bridge). Per-platform routes already
    // call recordPlatformError directly.
    this.lastError.update((current) => ({
      ...current,
      telegram: current.telegram ?? message,
      discord: current.discord ?? message,
      slack: current.slack ?? message,
    }));
  }

  private handleGatewayEvent(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const ev = payload as { kind?: unknown };
    if (ev.kind === 'voice-model-download') {
      const evt = payload as {
        kind: 'voice-model-download';
        modelName?: unknown;
        percent?: unknown;
      };
      if (typeof evt.modelName !== 'string') return;
      const percent =
        typeof evt.percent === 'number' && Number.isFinite(evt.percent)
          ? Math.max(0, Math.min(100, evt.percent))
          : 0;
      // One-time gate: only show the toast on first transcription this session.
      if (!this.voiceToastShown && percent < 100) {
        this.voiceToastShown = true;
      }
      this.voiceDownload.set({
        modelName: evt.modelName,
        percent,
        error: null,
        done: percent >= 100,
      });
      return;
    }
    if (ev.kind === 'voice-model-download-error') {
      const evt = payload as {
        kind: 'voice-model-download-error';
        modelName?: unknown;
        reason?: unknown;
      };
      const modelName =
        typeof evt.modelName === 'string' ? evt.modelName : 'unknown';
      const reason = typeof evt.reason === 'string' ? evt.reason : 'unknown';
      this.voiceToastShown = true;
      this.voiceDownload.set({
        modelName,
        percent: 0,
        error: reason,
        done: true,
      });
      return;
    }
    if (ev.kind === 'binding-requested') {
      // New binding arrived: refresh the bindings list. The polling fallback
      // would catch this within 30s; the event makes it instant.
      void this.listBindings();
    }
  }
}
