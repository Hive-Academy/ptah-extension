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
    const norm = this.activeNormalizedPath();
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
