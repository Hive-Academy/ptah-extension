import { createHash } from 'crypto';
import * as path from 'path';
import type { IDisposable } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '../ports/settings-store.interface';
import type { IActiveWorkspaceSource } from './active-workspace-source';

const WORKSPACE_KEY_PREFIX = 'workspace';

export type WorkspaceWriteTarget = 'global' | 'workspace';

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

  constructor(store: ISettingsStore, source: IActiveWorkspaceSource) {
    this.store = store;
    this.source = source;
  }

  private activeNormalizedPath(): string | undefined {
    const raw = this.source.getActivePath();
    if (raw === undefined) return undefined;
    return normalizeActivePath(raw);
  }

  getActivePath(): string | undefined {
    return this.activeNormalizedPath();
  }

  read<T>(globalKey: string): T | undefined {
    const norm = this.activeNormalizedPath();
    if (norm) {
      const override = this.store.readGlobal<T>(
        workspaceKeyFor(globalKey, norm),
      );
      if (override !== undefined) return override;
    }
    return this.store.readGlobal<T>(globalKey);
  }

  hasOverride(globalKey: string): boolean {
    const norm = this.activeNormalizedPath();
    if (!norm) return false;
    return (
      this.store.readGlobal(workspaceKeyFor(globalKey, norm)) !== undefined
    );
  }

  async write<T>(
    globalKey: string,
    value: T,
    target: WorkspaceWriteTarget,
  ): Promise<void> {
    if (target === 'workspace') {
      const norm = this.activeNormalizedPath();
      if (!norm) {
        await this.store.writeGlobal(globalKey, value);
        return;
      }
      await this.store.writeGlobal(workspaceKeyFor(globalKey, norm), value);
      return;
    }
    await this.store.writeGlobal(globalKey, value);
  }

  async clearOverride(globalKey: string): Promise<void> {
    const norm = this.activeNormalizedPath();
    if (!norm) return;
    await this.store.writeGlobal(workspaceKeyFor(globalKey, norm), undefined);
  }

  effectiveKey(globalKey: string): string {
    const norm = this.activeNormalizedPath();
    if (
      norm &&
      this.store.readGlobal(workspaceKeyFor(globalKey, norm)) !== undefined
    ) {
      return workspaceKeyFor(globalKey, norm);
    }
    return globalKey;
  }

  onActiveChange(cb: () => void): IDisposable {
    return this.source.onDidChange(cb);
  }
}
