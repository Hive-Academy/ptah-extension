/**
 * ISecretStorage — Platform-agnostic secure credential storage.
 *
 * Replaces: vscode.ExtensionContext.secrets (SecretStorage)
 */

import type { IEvent, SecretChangeEvent } from '../types/platform.types';

export interface ISecretStorage {
  /**
   * Get a secret by key.
   * Replaces: vscode.SecretStorage.get(key)
   */
  get(key: string): Promise<string | undefined>;

  /**
   * Store a secret.
   * Replaces: vscode.SecretStorage.store(key, value)
   */
  store(key: string, value: string): Promise<void>;

  /**
   * Delete a secret.
   * Replaces: vscode.SecretStorage.delete(key)
   */
  delete(key: string): Promise<void>;

  /**
   * Event fired when a secret changes.
   * Replaces: vscode.SecretStorage.onDidChange
   */
  readonly onDidChange: IEvent<SecretChangeEvent>;
}
