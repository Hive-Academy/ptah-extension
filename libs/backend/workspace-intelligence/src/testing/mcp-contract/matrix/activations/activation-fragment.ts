/**
 * The shape every `matrix/activations/<batch>.ts` fragment exports as
 * `ACTIVATION` (TASK_2026_559 Batch 27, Task 27.2). Kept in its own file so a
 * fragment never has to import from the discovery spec, and the spec never
 * has to hardcode a fragment's module shape beyond this contract.
 */
export interface ActivationFragment {
  /** The batch name, matching the file's own name without extension. */
  readonly batch: string;
  /** The `required-keys.ts` keys this batch claims. Must be a subset of `REQUIRED_KEYS`. */
  readonly keys: readonly string[];
  /**
   * Declared approximations per key, when the capability is not a full
   * contract (e.g. `syntax-only`). A key with no entry here claims a full,
   * unqualified contract for 100% recall.
   */
  readonly approximations?: Readonly<Record<string, readonly string[]>>;
}
