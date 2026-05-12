/**
 * Memory write port — minimal contract for upserting persistent memory entries
 * by stable identity (workspaceFingerprint + subject).
 *
 * Adapter lives in @ptah-extension/memory-curator. Consumers (e.g. the wizard
 * seeder) inject by token, never by class. When no adapter is registered
 * (VS Code without SQLite today), `container.resolve(MEMORY_WRITER)` throws —
 * callers MUST wrap in try/catch and treat the absence as a graceful skip.
 */
export interface IMemoryWriter {
  /**
   * Upsert one memory entry by (fingerprint, subject) identity.
   *
   * Implementation contract:
   *   1. Compute SHA-256(`subject + ' ' + content`) hex (single ASCII space separator).
   *      Implementors MUST use this exact format for cross-adapter hash compatibility.
   *   2. Find existing entries matching `(fingerprint, subject)` regardless of
   *      current `workspaceRoot` — supports moves/renames.
   *   3. If exactly one match exists AND its embedded hash equals the new hash
   *      → return `{ status: 'unchanged', id }`. No DB writes.
   *   4. Otherwise: delete all matches, then insert new entry with the
   *      `<!-- ptah-seed:hash=…;fp=…;v=1 -->` prefix line in content.
   *   5. Return `{ status: 'inserted' | 'replaced', id }`.
   */
  upsert(req: MemoryWriteRequest): Promise<MemoryWriteResult>;
}

export interface MemoryWriteRequest {
  /** Stable workspace identity. Use `deriveWorkspaceFingerprint()`. */
  readonly workspaceFingerprint: string;
  /** Current absolute workspace root (for tagging the row). */
  readonly workspaceRoot: string;
  /** Identity within the workspace (e.g. 'project-profile'). */
  readonly subject: string;
  /** Markdown body. The adapter prepends the hash/fingerprint comment line. */
  readonly content: string;
  readonly tier: 'core' | 'recall' | 'archival';
  readonly kind: 'fact' | 'preference' | 'event' | 'entity';
  readonly pinned: boolean;
  /** Optional; defaults: pinned core → 1.0/0; unpinned recall → 0.6/0.01. */
  readonly salience?: number;
  readonly decayRate?: number;
}

export interface MemoryWriteResult {
  readonly status: 'inserted' | 'replaced' | 'unchanged';
  /** Opaque to consumers; useful for telemetry. */
  readonly id: string;
}
