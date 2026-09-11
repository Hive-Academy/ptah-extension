/**
 * IStateStorage — Platform-agnostic key-value persistence.
 *
 * Replaces: vscode.Memento (ExtensionContext.globalState, workspaceState)
 *
 * Provides synchronous get (cached) and async update. Stores that need
 * asynchronous initialization, bounded sequence I/O, or adapter-owned
 * maintenance expose the optional structural capabilities declared alongside
 * this interface; these signatures remain the compatibility baseline.
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
