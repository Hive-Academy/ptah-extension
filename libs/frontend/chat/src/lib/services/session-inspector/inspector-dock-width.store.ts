import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { LoggingService } from '@ptah-extension/core';
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
} from './inspector-shell.controller';

/** `localStorage` key of the docked inspector width; value is an integer string. */
export const INSPECTOR_DOCK_WIDTH_STORAGE_KEY = 'ptah.inspector-dock-width.v1';

const LOG_CONTEXT = 'InspectorDockWidth';

type StorageFailureKind = 'read' | 'write' | 'remove';

/**
 * Parse a stored width: `null`, blank or non-finite text gives `null`;
 * anything else is rounded and clamped to [MIN, MAX].
 */
function parseStoredWidth(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return clampWidth(value);
}

function clampWidth(value: number): number {
  return Math.min(
    INSPECTOR_MAX_WIDTH,
    Math.max(INSPECTOR_MIN_WIDTH, Math.round(value)),
  );
}

/**
 * The user's committed docked inspector width, persisted in the webview's
 * `localStorage` (one value per storage scope). It never holds a drag or
 * key preview: the host keeps its own draft and commits on release.
 *
 * `preference` changes only through `commit`, `reset` and the `storage`
 * event of another document in the same scope. Storage failures keep the
 * value in memory for the session and are logged once per kind.
 */
@Injectable({ providedIn: 'root' })
export class InspectorDockWidthStore {
  private readonly logger = inject(LoggingService);
  private readonly preferenceState = signal<number | null>(null);
  private readonly reportedFailures = new Set<StorageFailureKind>();

  /** Stored width in px within [MIN, MAX], or `null` when none is stored. */
  readonly preference = this.preferenceState.asReadonly();

  constructor() {
    this.preferenceState.set(this.restore());
    if (typeof window === 'undefined') return;
    const onStorage = (event: StorageEvent): void => this.onStorage(event);
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() =>
      window.removeEventListener('storage', onStorage),
    );
  }

  /** Store `width` (rounded, clamped to [MIN, MAX]); non-finite is ignored. */
  commit(width: number): void {
    if (!Number.isFinite(width)) return;
    const value = clampWidth(width);
    this.preferenceState.set(value);
    try {
      localStorage.setItem(INSPECTOR_DOCK_WIDTH_STORAGE_KEY, String(value));
    } catch (error) {
      this.reportFailure('write', error);
    }
  }

  /** Forget the stored width so the shell default applies. */
  reset(): void {
    this.preferenceState.set(null);
    try {
      localStorage.removeItem(INSPECTOR_DOCK_WIDTH_STORAGE_KEY);
    } catch (error) {
      this.reportFailure('remove', error);
    }
  }

  private restore(): number | null {
    try {
      return parseStoredWidth(
        localStorage.getItem(INSPECTOR_DOCK_WIDTH_STORAGE_KEY),
      );
    } catch (error) {
      // degradation-audit: reported - storage read failure is logged via LoggingService.warn;
      // the default width is used
      this.reportFailure('read', error);
      return null;
    }
  }

  /**
   * Another document in this storage scope changed the key. Only
   * `preference` moves; storage is never written here, so nothing echoes.
   */
  private onStorage(event: StorageEvent): void {
    if (event.key !== INSPECTOR_DOCK_WIDTH_STORAGE_KEY) return;
    if (!this.isLocalStorage(event.storageArea)) return;
    if (event.newValue === null) {
      this.preferenceState.set(null);
      return;
    }
    const value = parseStoredWidth(event.newValue);
    if (value !== null) this.preferenceState.set(value);
  }

  private isLocalStorage(area: Storage | null): boolean {
    if (area === null) return false;
    let local: Storage | null = null;
    try {
      local = window.localStorage;
    } catch (error) {
      this.reportFailure('read', error);
    }
    return area === local;
  }

  private reportFailure(kind: StorageFailureKind, error: unknown): void {
    if (this.reportedFailures.has(kind)) return;
    this.reportedFailures.add(kind);
    this.logger.warn(
      LOG_CONTEXT,
      `${kind} failed; width kept in memory only`,
      error,
    );
  }
}
