import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ProvidersSettingsStateService } from '@ptah-extension/core';
import type { SettingScope } from '@ptah-extension/shared';
import { injectAppScopeName } from '../providers/app-scope-label';

/** One save-on-selection request (D2). */
export interface SettingsSaveRequest {
  /** Field name shown to the user, e.g. "main agent model". */
  readonly label: string;
  readonly scope: SettingScope;
  /** A state-service save command: `false` means it was refused because another save is in flight. */
  readonly write: () => Promise<boolean>;
  /** Saves the pre-change value back through the same state-service path. `null` offers no Undo. */
  readonly undo: (() => Promise<boolean>) | null;
}

/** Generic save entry for settings that do not flow through {@link ProvidersSettingsStateService} (G2). */
export interface SettingsGenericSaveRequest {
  /** Field name shown to the user, e.g. "MCP port". */
  readonly label: string;
  /** The save itself; `ok:false` carries the user-facing failure message. */
  readonly write: () => Promise<{ ok: true } | { ok: false; message: string }>;
  /** Writes the previous value back. `null` offers no Undo. */
  readonly undo: (() => Promise<{ ok: true } | { ok: false; message: string }>) | null;
}

export interface SettingsToast {
  /** `status` renders `role="status"` (polite); `alert` renders `role="alert"`. */
  readonly tone: 'status' | 'alert';
  readonly message: string;
  readonly canUndo: boolean;
}

export const SETTINGS_TOAST_TIMEOUT_MS = 8000;
export const SAVE_REFUSED_MESSAGE = 'Another change is still saving.';


/**
 * The one path for save-on-selection feedback and Undo (plan Component 11, D2/D3/D15).
 *
 * The outcome is decided from each call's own result: a `write()` resolving `false` was refused
 * and never shows success, even when `commit()` still describes an earlier `saved` commit.
 * `commit()` is read only after this call's `write()` resolved `true`.
 *
 * Provided by `SettingsComponent`, so the toast and its timer live exactly as long as the page.
 */
@Injectable()
export class SettingsSaveFeedbackService {
  private readonly state = inject(ProvidersSettingsStateService);
  /** The App scope is the running host's own layer ("VS Code" or "Desktop app"). */
  private readonly scopeLabels: Readonly<Record<SettingScope, string>> = {
    workspace: 'This workspace',
    app: injectAppScopeName().label,
    global: 'All Ptah apps',
  };
  private readonly toastState = signal<SettingsToast | null>(null);
  private readonly genericSaving = signal(false);
  private undoRequest: SettingsSaveRequest | SettingsGenericSaveRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly toast = this.toastState.asReadonly();
  /** Save triggers are disabled while this is true (D3). Covers both Providers commits and generic writes. */
  readonly saving = computed(() => this.state.commit().status === 'saving' || this.genericSaving());

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  async save(request: SettingsSaveRequest): Promise<void> {
    if (this.saving()) {
      this.show({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false }, null);
      return;
    }
    let accepted: boolean;
    try {
      accepted = await request.write();
    } catch {
      // State commands settle their own failures into `commit()`; a throw here means the command
      // itself broke, so nothing about the write can be confirmed.
      this.show(
        { tone: 'alert', message: `Could not confirm whether ${request.label} was saved.`, canUndo: false },
        null,
      );
      return;
    }
    if (!accepted) {
      this.show({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false }, null);
      return;
    }
    const commit = this.state.commit();
    if (commit.status === 'saved') {
      const undo = request.undo;
      this.show(
        {
          tone: 'status',
          message: `Saved ${request.label} to ${this.scopeLabels[request.scope]}.`,
          canUndo: undo !== null,
        },
        undo ? { ...request, write: undo, undo: null } : null,
      );
      return;
    }
    const parts = [`Could not save ${request.label}.`];
    if (commit.unsaved.length) parts.push(`Not saved: ${commit.unsaved.join(', ')}.`);
    if (commit.unconfirmed.length) parts.push(`Not confirmed: ${commit.unconfirmed.join(', ')}.`);
    if (commit.message) parts.push(commit.message);
    this.show({ tone: 'alert', message: parts.join(' '), canUndo: false }, null);
  }

  /**
   * Generic save entry for settings outside the Providers state service (G2).
   *
   * Same D3 disable-while-saving, same 8 s toast timer, and the same Undo contract as `save()`. The
   * success message is scope-less: "Saved {label}.". A failed write never shows "Saved" (D15); the
   * failure message comes straight from the writer.
   */
  async saveGeneric(request: SettingsGenericSaveRequest): Promise<void> {
    if (this.saving()) {
      this.show({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false }, null);
      return;
    }
    let result: { ok: true } | { ok: false; message: string };
    try {
      this.genericSaving.set(true);
      result = await request.write();
    } catch {
      // The writer itself broke; nothing about the write can be confirmed.
      this.show(
        { tone: 'alert', message: `Could not confirm whether ${request.label} was saved.`, canUndo: false },
        null,
      );
      return;
    } finally {
      this.genericSaving.set(false);
    }
    if (!result.ok) {
      this.show({ tone: 'alert', message: result.message, canUndo: false }, null);
      return;
    }
    const undo = request.undo;
    this.show(
      { tone: 'status', message: `Saved ${request.label}.`, canUndo: undo !== null },
      undo ? { ...request, write: undo, undo: null } : null,
    );
  }

  /**
   * Runs the current toast's Undo as a real write through the same entry that created it (with no Undo
   * of its own). While another save is in flight the Undo is kept: the toast says so and still offers
   * it, and it is dismissed only when the Undo write really starts (m1, Providers 21-28 review).
   */
  async undo(): Promise<void> {
    const request = this.undoRequest;
    if (!request) return;
    if (this.saving()) {
      this.show({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: true }, request);
      return;
    }
    this.dismiss();
    if ('scope' in request) {
      await this.save(request);
    } else {
      await this.saveGeneric(request);
    }
  }

  dismiss(): void {
    this.clearTimer();
    this.undoRequest = null;
    this.toastState.set(null);
  }

  private show(toast: SettingsToast, undoRequest: SettingsSaveRequest | SettingsGenericSaveRequest | null): void {
    this.clearTimer();
    this.undoRequest = undoRequest;
    this.toastState.set(toast);
    this.timer = setTimeout(() => this.dismiss(), SETTINGS_TOAST_TIMEOUT_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
