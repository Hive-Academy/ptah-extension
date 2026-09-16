# Handoff — TASK_2026_439_1310, the Thoth rework umbrella

Written 2026-09-16 at the end of phase 2. Read this first, then `context.md` for the phase table and
`tribunal/verdict.md` for the requirements. The verdict is the requirements source for every phase.

## Where the work stands

| Phase | Scope | Task | State |
| --- | --- | --- | --- |
| 1 | Stop disk growth: daily retention job, processed-observation purge at 7 days, stuck-row quarantine, pre-migration rotation 3 to 1, idle vacuum, storage numbers in diagnostics | TASK_2026_440_834c | **merged**, PR #513, merge commit `dbffc1938` |
| 2 | Memory age lifecycle, ranking-only salience, per-workspace cap | TASK_2026_443_40ec | **in review**, PR #521 open, CI green, all review threads resolved |
| 3 | Skills unblock: manual promote path, delete the fake creation invocation, stricter prefilter, one-time backlog cleanup, namer wired or deleted | not filed | backlog |
| 4 | Activity feed correctness: newest first, real event ids, grouping, remove the overlapping summary, tiles refresh | not filed | backlog |
| 5 | Skills evidence-first pipeline: archaeology before authoring, cross-session clustering, promotion from real `skill_invocation_events` | not filed | backlog |
| 6 | Thoth Overview (Health, Needs attention, Recent outcomes) and a durable, bounded activity ledger | not filed | backlog |

Phases 3 and 4 are mostly file-disjoint from each other and from phase 2. They can run in parallel
worktrees. Phase 5 depends on phase 3. Phase 6 depends on phase 4.

## The rule that governs every phase

The tribunal's finding was not bad algorithms. It was **features built, unit-tested and documented but
never called from production**: the observation purge, the memory decay job, the candidate namer and the
skill invocation tracker. So every phase ships a **reachability proof**: a boot or integration spec that
FAILS if the production path does not call the new code, or if the scheduled job is not registered. Unit
specs alone do not close a phase. Prove each proof by mutation: remove the production call, show the
spec fails, restore it, and paste both outputs into the batch report.

Phase 2 shipped four such proofs (DI graph, real SQLite with sqlite-vec, Electron `startThothCron`, CLI
`activateThoth`), each shown failing under mutation. Copy that pattern.

## What phase 2 changed, in case phase 3 or 4 touches it

- The lifecycle runs as a step inside `MemoryRetentionService.run`, under the existing hourly
  `@ptah/memory-retention` job. It reuses that job's gates (boot-deferred, on-battery,
  foreground-active), its `RetentionRunBudget`, one `BEGIN IMMEDIATE` per batch, and a
  background-work-governor wait before every batch, capped by the run's remaining wall budget.
- `MemoryDecayJob`, `SalienceScorer`, `MemoryStore.updateTier`, the decay diagnostics, the `'decay-run'`
  event kind and the `lastDecay*` DTO fields are **deleted**. Do not resurrect them.
- Salience is an immutable base in `[0,1]`; ranking is a query-time SQL expression. Migration `0044`
  rebases the stored values once, as a backfill. After that, no runtime code writes `salience`: it is
  set at insert and never again.
- "Used" is recorded explicitly through `IMemoryUsageRecorder` (injected hits, MCP search hits,
  `memory:get`, `mem:getObservations`, curator merge). `MemorySearchService` no longer writes on a read.
- New files worth knowing: `retention/memory-lifecycle.store.ts`, `memory-lifecycle.service.ts`,
  `memory-lifecycle-config.ts`, `retention-run-budget.ts`, `memory-storage-health.ts`,
  `salience-ranking.ts`, and migration `0044_memory_lifecycle`.

## Working rules that cost us time to learn

1. **`npx nx run-many -t <target> -p a b c`**, never `nx test a b c` — the second form runs only the
   first project and turns the rest into path filters, then exits 0. Check the `for N projects` header.
2. **Quote any `--testPathPatterns` value containing `|` as `'"a|b"'`.** Unquoted, PowerShell splits the
   command and strands an `nx run-executor` with no workers. One such orphan burned a full core for
   3.5 hours before another session noticed it.
3. **CI loads `better-sqlite3`; local Node falls back to `node:sqlite`.** A spec that leaves a named SQL
   parameter unbound passes locally and fails on CI. Run SQLite specs both ways:
   ```powershell
   $root = git rev-parse --show-toplevel
   $env:ELECTRON_RUN_AS_NODE = '1'
   & "$root/node_modules/.bin/electron.cmd" "$root/node_modules/jest/bin/jest.js" `
     --config <lib>/jest.config.ts --testPathPatterns '"<pattern>"' --runInBand
   ```
   In a worktree without its own `node_modules`, point `$root` at the main checkout instead.
4. **`npx nx run degradation-audit:lint` must stay at its per-lib baselines.** Any new catch that fails
   open or returns a default needs `// degradation-audit: optional-capability - <reason>` or
   `// degradation-audit: reported - <reason>`, and the marker must sit inside the catch's leading-comment
   zone or the scanner reports an orphaned suppression.
5. **Never open the live database or a migration snapshot with SQLite.** That is
   `<state>/ptah.sqlite` and its `-wal` and `-shm` files, plus every `ptah.pre-migration-*.sqlite`,
   where `<state>` is `$PTAH_STATE_DIR` if set and `~/.ptah/state` otherwise. Measure on a byte copy in
   a fail-if-exists temp dir, named so it does not start with `ptah`, with the six production pragmas
   read back.
6. **Lanes do not report completion.** Give every lane a marker file to write as its last step and watch
   for that file; a lane can exit 0 without writing its deliverable (TASK_2026_438).
7. **Reviews come from a different model family than the implementer.** In phase 2, codex implemented,
   Ollama Cloud reviewed each batch, and antigravity reviewed the whole branch at Gate 3. The branch
   review found three defects that nine per-batch reviews could not see, so keep it.
8. **Known load flakes**, not regressions: the platform-core file-settings bench, the memory-curator
   boot-scan abort test, and the rpc-handlers skills-sh source-root spec. Re-run or use `--parallel=1`
   and record both runs. `TASK_2026_456_b421` owns fixing them.

## Open pull requests

- **#521** phase 2. CI green, 4 CodeRabbit threads resolved, 37 commits. Needs a human approving review.
- **#522** captures task specs that never reached `main` (documentation only).

## Follow-up tasks already filed

`TASK_2026_444_1078` TUI storage panel · `445_6ece` pin the `formatSnapshot` locale · `447_035a`
contentless `memory_concepts_fts` drift · `450_8383` watcher stress flake · `454_b401` memory-curator to
agent-sdk import rule · `455_9f2c` measure the Electron `better-sqlite3` binding in the field ·
`456_b421` three load-sensitive specs · `457_e48b` per-field lifecycle preview · `458_39c2` degraded CLI
boot still crashes on `MEMORY_SEARCH`. `446_198a` is done.

## Accepted deviations, do not "fix" them silently

- Migration `0044` measures 1066 and 1011 ms against a 1-second estimate. It is a one-time boot cost,
  and a shipped migration is append-only — never edit `0044`. If the cost ever matters, a later
  migration rebuilds the index.
- A governor abort during the ledger prune can overwrite a `memory-row-budget` reason string. The
  outcome is `partial` either way.

## Worktrees

Removed at the end of phase 2, all merged: `task-440-memory-retention`,
`task-410-background-agent-execution`, `task-418-codex-session-statistics`,
`task-442-fluid-canvas-spans`, `ptah-sqlite-bump`.

Still present and **not ours**: `ptah-437`, `compaction-null-session`, `boot-readiness-timeout`,
`native-loop`, `task-449-peer-session-name-sync`, `task-451-compact-tile-sizing`,
`task-453-tile-open-long-tasks`. Other sessions own them. `skill-corpus-tasks` can be deleted once #522
merges; `task-439-phase2-memory-lifecycle` once #521 merges.

## Other sessions share this machine

At least one other session runs performance baselines and needs the machine free of `jest-worker` and
`nx run-executor` processes. It asks ahead of time and pings when done. Hold heavy verification passes
when asked, and say what you are about to run.
