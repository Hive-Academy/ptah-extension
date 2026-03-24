/**
 * VscodeSecretStorage — ISecretStorage implementation wrapping vscode.SecretStorage.
 */

import type * as vscode from 'vscode';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { IEvent, SecretChangeEvent } from '@ptah-extension/platform-core';
import { createEvent } from '@ptah-extension/platform-core';

export class VscodeSecretStorage implements ISecretStorage {
  public readonly onDidChange: IEvent<SecretChangeEvent>;
  private readonly fireChange: (data: SecretChangeEvent) => void;
  private readonly disposable: vscode.Disposable;
  private readonly _secrets: vscode.SecretStorage;

  constructor(secrets: vscode.SecretStorage) {
    const [event, fire] = createEvent<SecretChangeEvent>();
    this.onDidChange = event;
    this.fireChange = fire;

    this.disposable = secrets.onDidChange((e) => {
      this.fireChange({ key: e.key });
    });

    this._secrets = secrets;
  }

  async get(key: string): Promise<string | undefined> {
    return this._secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    await this._secrets.store(key, value);
  }

  async delete(key: string): Promise<void> {
    await this._secrets.delete(key);
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
