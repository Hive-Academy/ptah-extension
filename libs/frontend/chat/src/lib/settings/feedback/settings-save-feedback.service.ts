import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ProvidersSettingsStateService, type ProvidersSettingsCommit } from '@ptah-extension/core';
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
  /**
   * Fixed copy for a failure of this save, given its own commit (e.g. a partial edit: "Name saved. The key was not
   * saved."). `null` falls back to the default text.
   */
  readonly failureMessage?: (commit: ProvidersSettingsCommit) => string | null;
  /** Fixed copy replacing "Saved {label} to {scope}." (e.g. a stored credential: "… Key stored, not verified."). */
  readonly successMessage?: string;
}

/**
 * This call's own outcome (Gate V 36 M2): `saved` only when its write resolved `true` and the commit it produced is
 * `saved`; `refused` when nothing was written (another save in flight); `failed` for every other end, including a
 * write that threw. Callers close or confirm from this, never from `commit()`.
 */
export type SettingsSaveResult = 'saved' | 'failed' | 'refused';

/** A raw settings key (`agentOrchestration.copilotAutoApprove`, `ptahCliAgents.<id>.tierMappings`): never shown (Minor 3). */
const RAW_FIELD_KEY = /^[A-Za-z][\w-]*(\.[^\s.]+)+$/;
const shownFields = (fields: readonly string[]): readonly string[] => fields.filter((field) => !RAW_FIELD_KEY.test(field));

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

  async save(request: SettingsSaveRequest): Promise<SettingsSaveResult> {
    if (this.saving()) {
      this.show({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false }, null);
      return 'refused';
    }
    let accepted: boolean;
    try {
      accepted = await request.write();
    } catch {
      // degradation-audit: reported - shows a fixed alert toast and returns 'failed'.
      // State commands settle their own failures into `commit()`; a throw here means the command
      // itself broke, so nothing about the write can be confirmed.
      this.show(
        { tone: 'alert', message: `Could not confirm whether ${request.label} was saved.`, canUndo: false },
        null,
      );
      return 'failed';
    }
    if (!accepted) {
      this.show({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false }, null);
      return 'refused';
    }
    const commit = this.state.commit();
    if (commit.status === 'saved') {
      const undo = request.undo;
      this.show(
        {
          tone: 'status',
          message: request.successMessage ?? `Saved ${request.label} to ${this.scopeLabels[request.scope]}.`,
          canUndo: undo !== null,
        },
        // The Undo is its own save: it reports with the default copy, never this request's fixed copy.
        undo ? { label: request.label, scope: request.scope, write: undo, undo: null } : null,
      );
      return 'saved';
    }
    const fixed = request.failureMessage?.(commit) ?? null;
    const parts = [fixed ?? `Could not save ${request.label}.`];
    const unsaved = shownFields(commit.unsaved), unconfirmed = shownFields(commit.unconfirmed);
    if (!fixed && unsaved.length) parts.push(`Not saved: ${unsaved.join(', ')}.`);
    if (!fixed && unconfirmed.length) parts.push(`Not confirmed: ${unconfirmed.join(', ')}.`);
    else if (!fixed && commit.unconfirmed.length) parts.push('It may have been saved; check the current value before retrying.');
    if (commit.message) parts.push(commit.message);
    this.show({ tone: 'alert', message: parts.join(' '), canUndo: false }, null);
    return 'failed';
  }

  /**
   * Generic save entry for settings outside the Providers state service (G2).
   *
   * Same D3 disable-while-saving, same 8 s toast timer, and the same Undo contract as `save()`. The
   * success message is scope-less: "Saved {label}.". A failed write never shows "Saved" (D15); the
   * failure message comes straight from the writer. Returns this call's own outcome, like `save()`
   * (`refused` when another save is in flight).
   */
  async saveGeneric(request: SettingsGenericSaveRequest): Promise<SettingsSaveResult> {
    if (this.saving()) {
      this.show({ tone: 'alert', message: SAVE_REFUSED_MESSAGE, canUndo: false }, null);
      return 'refused';
    }
    let result: { ok: true } | { ok: false; message: string };
    try {
      this.genericSaving.set(true);
      result = await request.write();
    } catch {
      // degradation-audit: reported - shows a fixed alert toast and returns 'failed'.
      // The writer itself broke; nothing about the write can be confirmed.
      this.show(
        { tone: 'alert', message: `Could not confirm whether ${request.label} was saved.`, canUndo: false },
        null,
      );
      return 'failed';
    } finally {
      this.genericSaving.set(false);
    }
    if (!result.ok) {
      this.show({ tone: 'alert', message: result.message, canUndo: false }, null);
      return 'failed';
    }
    const undo = request.undo;
    this.show(
      { tone: 'status', message: `Saved ${request.label}.`, canUndo: undo !== null },
      undo ? { ...request, write: undo, undo: null } : null,
    );
    return 'saved';
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

  /**
   * A fixed confirmation or failure from a write outside `save()` (the Cursor credential, Gate V 36 M3): the page toast
   * outlives the control that wrote, so the announcement survives that control being re-created. No Undo.
   */
  announce(message: string, tone: SettingsToast['tone']): void {
    this.show({ tone, message, canUndo: false }, null);
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
