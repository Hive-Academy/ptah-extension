/**
 * Memory Curator e2e (TASK_2026_HERMES Track 1).
 *
 * Surface under test: `memory:list`, `memory:search`, `memory:stats` RPC
 * methods backed by `@ptah-extension/memory-curator`. The full lifecycle
 * requires the MemoryCuratorService's PreCompact callback to fire (extract →
 * resolve → score) so that at least one Memory row lands in the SQLite store.
 *
 * Why skipped:
 *   Triggering the PreCompact callback requires a real upstream Claude turn
 *   that crosses the context-window threshold. That is not feasible in CI
 *   without burning real API tokens on every run — the same constraint that
 *   caused `compaction.e2e.spec.ts` to be fully skipped (see file header
 *   there). The placeholders below document the observable surfaces so a
 *   follow-up task can stand them up once either:
 *     (a) a recorded SDK fixture / synthetic compaction harness exists, or
 *     (b) the harness supports injecting a fake PreCompact trigger that seeds
 *         the MemoryStore without a real API call.
 *
 * When unblocked, the test flow is:
 *   1. CliRunner.spawn({ home, env: { ANTHROPIC_API_KEY: FAKE } })
 *   2. Submit a task that fills context and crosses the compaction threshold.
 *   3. Await `memory.curator.complete` notification (once wired).
 *   4. CliRunner.spawnOneshot(['memory', 'list', '--json']) → assert ≥1 row.
 *   5. CliRunner.spawnOneshot(['memory', 'stats', '--json']) → totalMemories ≥ 1.
 *   6. runner.shutdown() + tmp.cleanup().
 *
 * Prerequisite: `ptah memory list|stats|search|get|pin|forget` CLI subcommands
 * added to `apps/ptah-cli/src/cli/router.ts` (not yet present as of HERMES
 * scaffold).
 */

describe.skip('memory curator e2e (TASK_2026_HERMES Track 1 — requires real compaction)', () => {
  it('PreCompact callback seeds ≥1 Memory row visible via memory:list', () => {
    /* Stub — see file header. */
  });

  it('memory:stats returns totalMemories ≥ 1 after first curator run', () => {
    /* Stub — see file header. */
  });

  it('memory:search returns ranked hits matching a query drawn from the extracted content', () => {
    /* Stub — see file header. */
  });

  it('memory:pin + memory:unpin toggle pinned flag on a stored memory', () => {
    /* Stub — see file header. */
  });

  it('memory:forget soft-deletes a row so it no longer appears in memory:list', () => {
    /* Stub — see file header. */
  });
});
