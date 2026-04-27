/**
 * Enhanced Prompts State Store — workspace-keyed in-memory + globalState persistence.
 *
 * Extracted from `enhanced-prompts.service.ts` as part of TASK_2025_291 Wave C7a.
 *
 * Plain class composed internally by `EnhancedPromptsService` — no DI token.
 * Owns the `Map<workspacePath, EnhancedPromptsState>` and the base64url storage
 * key derivation. Library-internal.
 */

import {
  EnhancedPromptsState,
  createInitialEnhancedPromptsState,
} from './enhanced-prompts.types';

/**
 * VS Code ExtensionContext interface (minimal) — mirrors the shape used by
 * the coordinator to avoid a hard dependency on VS Code APIs.
 */
interface IExtensionContext {
  globalState: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
  };
}

export const ENHANCED_PROMPTS_STATE_STORAGE_KEY = 'ptah.enhancedPrompts.state';

export class EnhancedPromptsStateStore {
  private readonly stateByWorkspace = new Map<string, EnhancedPromptsState>();

  constructor(private readonly context: IExtensionContext) {}

  /**
   * Load state for a workspace — returns cached in-memory value, falls back to
   * globalState, otherwise produces a fresh initial state and caches it.
   */
  async load(workspacePath: string): Promise<EnhancedPromptsState> {
    const cachedState = this.stateByWorkspace.get(workspacePath);
    if (cachedState) {
      return cachedState;
    }

    const storageKey = this.getStorageKey(workspacePath);
    const stored =
      this.context.globalState.get<EnhancedPromptsState>(storageKey);

    if (stored) {
      this.stateByWorkspace.set(workspacePath, stored);
      return stored;
    }

    const initial = createInitialEnhancedPromptsState(workspacePath);
    this.stateByWorkspace.set(workspacePath, initial);
    return initial;
  }

  /**
   * Persist state to globalState and update the in-memory cache.
   */
  async save(
    workspacePath: string,
    state: EnhancedPromptsState,
  ): Promise<void> {
    const storageKey = this.getStorageKey(workspacePath);
    await this.context.globalState.update(storageKey, state);
    this.stateByWorkspace.set(workspacePath, state);
  }

  /**
   * Look up cached in-memory state without hitting storage.
   * Used by the cache-invalidation listener which needs to mutate `configHash`
   * in place without reloading from disk.
   */
  peek(workspacePath: string): EnhancedPromptsState | undefined {
    return this.stateByWorkspace.get(workspacePath);
  }

  /**
   * Derive the globalState key for a workspace.
   *
   * Uses base64url encoding of the workspace path to avoid hash collisions —
   * base64url replaces characters that are problematic in storage keys.
   */
  getStorageKey(workspacePath: string): string {
    const encoded = Buffer.from(workspacePath, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return `${ENHANCED_PROMPTS_STATE_STORAGE_KEY}.${encoded}`;
  }
}
