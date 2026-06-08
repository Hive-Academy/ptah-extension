/**
 * VecEmbedderRecoveryService
 *
 * Single-source signal state for the Thoth DB Health panel's vec + embedder
 * recovery surface. Implements `MessageHandler` to receive
 * `db:vecStatusChanged` and `embedder:statusChanged` push events broadcast
 * by the Electron main process when either service emits a state change.
 *
 * Surfaces four user-recoverable actions to the renderer:
 *   - retryVec()          → `db:reloadVec`
 *   - retryEmbedder()     → `embedder:retry`
 *   - openBindingFolder() → `db:openBindingFolder`
 *   - copyDiagnostic()    → renderer-local clipboard write (no RPC)
 *
 * Each action returns a renderer-safe toast message so the calling
 * component can surface success/failure without re-deriving copy.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService, type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type DbReloadVecResult,
  type DbOpenBindingFolderResult,
  type EmbedderRetryResult,
  type EmbedderStatusWire,
  type EmbedderStatusChangedPayload,
  type VecLoadDiagnosticWire,
  type VecStatusChangedPayload,
} from '@ptah-extension/shared';

const RPC_TIMEOUT_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class VecEmbedderRecoveryService implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.VEC_STATUS_CHANGED,
    MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED,
  ] as const;

  private readonly _vecDiagnostic = signal<VecLoadDiagnosticWire | null>(null);
  private readonly _embedderStatus = signal<EmbedderStatusWire | null>(null);
  private readonly _vecBusy = signal<boolean>(false);
  private readonly _embedderBusy = signal<boolean>(false);
  private readonly _lastToast = signal<RecoveryToast | null>(null);

  readonly vecDiagnostic = this._vecDiagnostic.asReadonly();
  readonly embedderStatus = this._embedderStatus.asReadonly();
  readonly vecBusy = this._vecBusy.asReadonly();
  readonly embedderBusy = this._embedderBusy.asReadonly();
  readonly lastToast = this._lastToast.asReadonly();

  readonly vecAvailable = computed<boolean>(
    () => this._vecDiagnostic()?.ok ?? false,
  );
  readonly embedderReady = computed<boolean>(
    () => this._embedderStatus()?.ready ?? false,
  );
  readonly embedderDownloading = computed<boolean>(
    () => this._embedderStatus()?.downloading ?? false,
  );

  /**
   * `MessageHandler.handleMessage` — receives push events from the
   * `MESSAGE_HANDLERS` multi-provider pipeline. Tolerates unknown payload
   * shapes (drops them silently) so a malformed broadcast can't crash the
   * renderer.
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type === MESSAGE_TYPES.VEC_STATUS_CHANGED) {
      const payload = message.payload as VecStatusChangedPayload | undefined;
      if (payload && payload.diagnostic) {
        this._vecDiagnostic.set(payload.diagnostic);
        if (!payload.ok && this._vecDiagnostic()?.ok !== false) {
          this.publishToast({
            kind: 'warn',
            message: `sqlite-vec went offline (${payload.diagnostic.reason}).`,
          });
        } else if (payload.ok) {
          this.publishToast({
            kind: 'success',
            message: 'sqlite-vec is online.',
          });
        }
      }
      return;
    }
    if (message.type === MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED) {
      const payload = message.payload as
        | EmbedderStatusChangedPayload
        | undefined;
      if (payload && payload.status) {
        const prev = this._embedderStatus();
        this._embedderStatus.set(payload.status);
        if (
          payload.status.error &&
          prev?.error?.message !== payload.status.error.message
        ) {
          this.publishToast({
            kind: 'warn',
            message: `Embedder error: ${payload.status.error.message}`,
          });
        } else if (payload.status.ready && prev?.ready === false) {
          this.publishToast({
            kind: 'success',
            message: 'Embedder ready.',
          });
        }
      }
    }
  }

  /** Pull-mode prime — invoked once on first panel open to seed signals. */
  async prime(): Promise<void> {
    await Promise.all([this.primeVecDiagnostic(), this.primeEmbedderStatus()]);
  }

  async primeVecDiagnostic(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'db:health',
        {},
        { timeout: RPC_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data?.vecDiagnostic) {
        this._vecDiagnostic.set(result.data.vecDiagnostic);
      }
    } catch {
      // Best-effort prime — push events keep state fresh after this.
    }
  }

  async primeEmbedderStatus(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'embedder:status',
        {},
        { timeout: RPC_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data) {
        this._embedderStatus.set(result.data.status);
      }
    } catch {
      // Best-effort prime — push events keep state fresh after this.
    }
  }

  async retryVec(): Promise<DbReloadVecResult | null> {
    if (this._vecBusy()) return null;
    this._vecBusy.set(true);
    try {
      const result = await this.rpc.call(
        'db:reloadVec',
        {},
        { timeout: RPC_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data) {
        this._vecDiagnostic.set(result.data.diagnostic);
        this.publishToast({
          kind: result.data.ok ? 'success' : 'warn',
          message: result.data.message,
        });
        return result.data;
      }
      this.publishToast({
        kind: 'error',
        message: result.error || 'db:reloadVec failed',
      });
      return null;
    } catch (err: unknown) {
      this.publishToast({
        kind: 'error',
        message: toErrorMessage(err),
      });
      return null;
    } finally {
      this._vecBusy.set(false);
    }
  }

  async retryEmbedder(): Promise<EmbedderRetryResult | null> {
    if (this._embedderBusy()) return null;
    this._embedderBusy.set(true);
    try {
      const result = await this.rpc.call(
        'embedder:retry',
        {},
        { timeout: 60_000 },
      );
      if (result.isSuccess() && result.data) {
        this._embedderStatus.set(result.data.status);
        this.publishToast({
          kind: result.data.ok ? 'success' : 'warn',
          message: result.data.message,
        });
        return result.data;
      }
      this.publishToast({
        kind: 'error',
        message: result.error || 'embedder:retry failed',
      });
      return null;
    } catch (err: unknown) {
      this.publishToast({ kind: 'error', message: toErrorMessage(err) });
      return null;
    } finally {
      this._embedderBusy.set(false);
    }
  }

  async openBindingFolder(): Promise<DbOpenBindingFolderResult | null> {
    try {
      const result = await this.rpc.call(
        'db:openBindingFolder',
        {},
        { timeout: RPC_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data) {
        this.publishToast({
          kind: result.data.opened ? 'success' : 'warn',
          message: result.data.message,
        });
        return result.data;
      }
      this.publishToast({
        kind: 'error',
        message: result.error || 'db:openBindingFolder failed',
      });
      return null;
    } catch (err: unknown) {
      this.publishToast({ kind: 'error', message: toErrorMessage(err) });
      return null;
    }
  }

  async copyDiagnostic(): Promise<boolean> {
    const blob = {
      vec: this._vecDiagnostic(),
      embedder: this._embedderStatus(),
      capturedAt: new Date().toISOString(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(blob, null, 2));
      this.publishToast({
        kind: 'success',
        message: 'Diagnostic copied to clipboard.',
      });
      return true;
    } catch (err: unknown) {
      this.publishToast({
        kind: 'error',
        message: `Could not copy: ${toErrorMessage(err)}`,
      });
      return false;
    }
  }

  dismissToast(): void {
    this._lastToast.set(null);
  }

  private publishToast(toast: RecoveryToast): void {
    this._lastToast.set({ ...toast, id: nextToastId() });
  }
}

export interface RecoveryToast {
  readonly id?: number;
  readonly kind: 'success' | 'warn' | 'error';
  readonly message: string;
}

let toastCounter = 0;
function nextToastId(): number {
  toastCounter = (toastCounter + 1) % Number.MAX_SAFE_INTEGER;
  return toastCounter;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
