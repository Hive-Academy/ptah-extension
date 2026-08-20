/**
 * Fan-out registry for PreCompact notifications.
 *
 * **`sessionId` is required on purpose, and the guarantee is held — do not
 * widen it to `string | undefined`.** The port has exactly one notifier
 * (`CompactionCallbackRegistry.notifyAll`, `agent-sdk/.../compaction-callback-registry.ts`)
 * and that notifier has exactly one caller: `CompactionHookHandler`
 * (`agent-sdk/src/lib/helpers/compaction-hook-handler.ts`). That caller resolves
 * the id through `resolveHookSessionId` (payload first, closure second, `''`
 * from either source treated as absent) and **returns early on `null` at
 * `:182-192`**, before `notifyAll` is ever reached. So a subscriber cannot be
 * handed a blank or absent `sessionId`.
 *
 * Publishing `''` here would be worse than publishing nothing: it reaches the
 * memory curator's transcript reader, which rejects it as a path-traversal
 * attempt and curates a placeholder instead of the conversation (TASK_2026_293).
 * `agent-sdk/CLAUDE.md` "Hook session identity" states the same rule as binding.
 *
 * Pinned by `compaction-hook-handler.spec.ts` — "skips the fan-out entirely when
 * neither source has an id", which asserts zero notifications and the
 * `missing sessionId` warning.
 *
 * Widening this field would force every subscriber (notably
 * `MemoryCuratorService.start()`) to grow an absence branch for a case its only
 * producer already rejects — dead defensive code, and a weakening of a
 * documented invariant. TASK_2026_296 §1d.
 */
export interface ICompactionCallbackRegistry {
  register(
    callback: (data: {
      /**
       * Guaranteed non-blank by the caller's `null` rejection — see the
       * interface doc above. Never `''`.
       */
      sessionId: string;
      trigger: 'manual' | 'auto';
      timestamp: number;
      preTokens: number;
      cwd?: string | null;
    }) => void,
  ): () => void;
}
