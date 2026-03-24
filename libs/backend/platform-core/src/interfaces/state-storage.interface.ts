/**
 * IStateStorage — Platform-agnostic key-value persistence.
 *
 * Replaces: vscode.Memento (ExtensionContext.globalState, workspaceState)
 *
 * Provides synchronous get (cached) and async update.
 */

export interface IStateStorage {
  /**
   * Get a value by key.
   * Replaces: vscode.Memento.get<T>(key, defaultValue)
   */
  get<T>(key: string, defaultValue?: T): T | undefined;

  /**
   * Update a value by key.
   * Replaces: vscode.Memento.update(key, value)
   */
  update(key: string, value: unknown): Promise<void>;

  /**
   * Get all stored keys.
   * Replaces: vscode.Memento.keys()
   */
  keys(): readonly string[];
}
