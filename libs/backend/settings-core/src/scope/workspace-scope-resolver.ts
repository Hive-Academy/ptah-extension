import { createHash } from 'crypto';
import * as path from 'path';
import type { IDisposable } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '../ports/settings-store.interface';
import type { IActiveWorkspaceSource } from './active-workspace-source';

const WORKSPACE_KEY_PREFIX = 'workspace';
const APP_KEY_PREFIX = 'app';

export type WorkspaceWriteTarget = 'global' | 'app' | 'workspace';

export function appScopePrefixFor(type: string): string {
  return `${APP_KEY_PREFIX}.${type}`;
}

function normalizeActivePath(activePath: string): string | undefined {
  if (typeof activePath !== 'string' || activePath.trim() === '') {
    return undefined;
  }
  try {
    let norm = path.resolve(activePath);
    if (process.platform === 'win32') {
      norm = norm.replace(
        /^([a-zA-Z]):/,
        (_m, drive: string) => `${drive.toLowerCase()}:`,
      );
    }
    return norm;
  } catch {
    return undefined;
  }
}

function deriveWorkspaceKeyHash(normalizedPath: string): string {
  return createHash('sha256').update(normalizedPath).digest('hex').slice(0, 16);
}

function workspaceKeyFor(globalKey: string, normalizedPath: string): string {
  return `${WORKSPACE_KEY_PREFIX}.${deriveWorkspaceKeyHash(normalizedPath)}.${globalKey}`;
}

export class WorkspaceScopeResolver {
  private readonly store: ISettingsStore;
  private readonly source: IActiveWorkspaceSource;
  private readonly appScope?: string;

  constructor(
    store: ISettingsStore,
    source: IActiveWorkspaceSource,
    appScope?: string,
  ) {
    this.store = store;
    this.source = source;
    this.appScope =
      typeof appScope === 'string' && appScope.trim() !== ''
        ? appScope
        : undefined;
  }

  private activeNormalizedPath(): string | undefined {
    const raw = this.source.getActivePath();
    if (raw === undefined) return undefined;
    return normalizeActivePath(raw);
  }

  private candidateKeys(globalKey: string, appScopable: boolean): string[] {
    return this.candidateKeysForNorm(
      globalKey,
      appScopable,
      this.activeNormalizedPath(),
    );
  }

  /**
   * Build the ordered candidate key list for an EXPLICIT normalized workspace
   * path (rather than the ambient active path). Shared by {@link candidateKeys}
   * (active path) and the path-scoped read helpers so per-workspace resolution
   * is byte-identical to active-path resolution — only the path hash differs.
   */
  private candidateKeysForNorm(
    globalKey: string,
    appScopable: boolean,
    norm: string | undefined,
  ): string[] {
    const useApp = appScopable && this.appScope !== undefined;
    const candidates: string[] = [];

    if (useApp) {
      const appPrefix = this.appScope as string;
      if (norm) {
        candidates.push(`${appPrefix}.${workspaceKeyFor(globalKey, norm)}`);
      }
      candidates.push(`${appPrefix}.${globalKey}`);
      if (norm) {
        candidates.push(workspaceKeyFor(globalKey, norm));
      }
    } else if (norm) {
      candidates.push(workspaceKeyFor(globalKey, norm));
    }

    candidates.push(globalKey);
    return candidates;
  }

  getActivePath(): string | undefined {
    return this.activeNormalizedPath();
  }

  read<T>(globalKey: string, appScopable = false): T | undefined {
    const candidates = this.candidateKeys(globalKey, appScopable);
    for (const candidate of candidates) {
      const value = this.store.readGlobal<T>(candidate);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  hasOverride(globalKey: string, appScopable = false): boolean {
    const candidates = this.candidateKeys(globalKey, appScopable);
    for (let i = 0; i < candidates.length - 1; i++) {
      if (this.store.readGlobal(candidates[i]) !== undefined) return true;
    }
    return false;
  }

  /**
   * Read a setting resolved for an EXPLICIT workspace path instead of the
   * ambient active path. Resolution order is identical to {@link read}
   * (workspace-specific → app → global) but keyed on the supplied path's hash.
   *
   * Used by per-workspace provider isolation: a chat session belonging to
   * workspace A must resolve A's provider even when a different workspace is
   * currently active. Falls back to the global value when `workspacePath` is
   * empty/unresolvable (mirrors the active-path branch).
   */
  readForPath<T>(
    globalKey: string,
    workspacePath: string,
    appScopable = false,
  ): T | undefined {
    const norm = normalizeActivePath(workspacePath);
    const candidates = this.candidateKeysForNorm(globalKey, appScopable, norm);
    for (const candidate of candidates) {
      const value = this.store.readGlobal<T>(candidate);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  /**
   * Whether an EXPLICIT workspace path has a more-specific override (workspace
   * or app scope) for `globalKey` — i.e. a value that would shadow the global
   * default. Path-scoped counterpart of {@link hasOverride}.
   */
  hasOverrideForPath(
    globalKey: string,
    workspacePath: string,
    appScopable = false,
  ): boolean {
    const norm = normalizeActivePath(workspacePath);
    const candidates = this.candidateKeysForNorm(globalKey, appScopable, norm);
    for (let i = 0; i < candidates.length - 1; i++) {
      if (this.store.readGlobal(candidates[i]) !== undefined) return true;
    }
    return false;
  }

  async write<T>(
    globalKey: string,
    value: T,
    target: WorkspaceWriteTarget,
    appScopable = false,
  ): Promise<void> {
    if (target === 'app') {
      const useApp = appScopable && this.appScope !== undefined;
      if (!useApp) {
        await this.store.writeGlobal(globalKey, value);
        return;
      }
      await this.store.writeGlobal(`${this.appScope}.${globalKey}`, value);
      return;
    }

    if (target === 'workspace') {
      const norm = this.activeNormalizedPath();
      if (!norm) {
        await this.store.writeGlobal(globalKey, value);
        return;
      }
      const useApp = appScopable && this.appScope !== undefined;
      const workspaceKey = workspaceKeyFor(globalKey, norm);
      const physicalKey = useApp
        ? `${this.appScope}.${workspaceKey}`
        : workspaceKey;
      await this.store.writeGlobal(physicalKey, value);
      return;
    }

    await this.store.writeGlobal(globalKey, value);
  }

  async clearOverride(globalKey: string, appScopable = false): Promise<void> {
    const candidates = this.candidateKeys(globalKey, appScopable);
    for (let i = 0; i < candidates.length - 1; i++) {
      const candidate = candidates[i];
      if (this.store.readGlobal(candidate) !== undefined) {
        await this.store.writeGlobal(candidate, undefined);
        return;
      }
    }
  }

  /**
   * Clear every override that is MORE specific than `target` for `globalKey`,
   * so a value written at `target` is no longer shadowed on read.
   *
   * Specificity: workspace (most specific) > app > global. Writing at a broader
   * scope (e.g. "Global default") would otherwise be silently overridden by a
   * leftover per-workspace value because {@link candidateKeys} resolves
   * most-specific-first. Saving the broader value calls this to drop the
   * narrower keys so the user's explicit choice actually takes effect.
   *
   * - target 'workspace' → clears nothing (already the most specific scope).
   * - target 'app'       → clears the active workspace override(s).
   * - target 'global'    → clears the active workspace AND app-level override(s).
   */
  async clearMoreSpecific(
    globalKey: string,
    target: WorkspaceWriteTarget,
    appScopable = false,
  ): Promise<void> {
    if (target === 'workspace') return;

    const norm = this.activeNormalizedPath();
    const useApp = appScopable && this.appScope !== undefined;
    const keysToClear: string[] = [];

    if (norm) {
      const workspaceKey = workspaceKeyFor(globalKey, norm);
      if (useApp) {
        keysToClear.push(`${this.appScope}.${workspaceKey}`);
      }
      keysToClear.push(workspaceKey);
    }

    if (target === 'global' && useApp) {
      keysToClear.push(`${this.appScope}.${globalKey}`);
    }

    for (const key of keysToClear) {
      if (this.store.readGlobal(key) !== undefined) {
        await this.store.writeGlobal(key, undefined);
      }
    }
  }

  effectiveKey(globalKey: string, appScopable = false): string {
    const candidates = this.candidateKeys(globalKey, appScopable);
    for (let i = 0; i < candidates.length - 1; i++) {
      if (this.store.readGlobal(candidates[i]) !== undefined) {
        return candidates[i];
      }
    }
    return globalKey;
  }

  onActiveChange(cb: () => void): IDisposable {
    return this.source.onDidChange(cb);
  }
}
