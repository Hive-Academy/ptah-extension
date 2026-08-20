import type { IDisposable } from '@ptah-extension/platform-core';

export interface IActiveWorkspaceSource {
  getActivePath(): string | undefined;
  onDidChange(cb: () => void): IDisposable;
}
