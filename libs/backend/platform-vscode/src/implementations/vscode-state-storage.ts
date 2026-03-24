/**
 * VscodeStateStorage — IStateStorage implementation wrapping vscode.Memento.
 *
 * Used for both globalState and workspaceState.
 */

import type * as vscode from 'vscode';
import type { IStateStorage } from '@ptah-extension/platform-core';

export class VscodeStateStorage implements IStateStorage {
  constructor(private readonly memento: vscode.Memento) {}

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.memento.get<T>(key, defaultValue as T);
  }

  async update(key: string, value: unknown): Promise<void> {
    await this.memento.update(key, value);
  }

  keys(): readonly string[] {
    return this.memento.keys();
  }
}
