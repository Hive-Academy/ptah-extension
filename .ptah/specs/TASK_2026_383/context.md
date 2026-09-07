# TASK_2026_383 — Silent-degradation audit

## Why

TASK_2026_380 Batch 5 found Finding F-1: the integrity worker bundle
(`integrity-worker.mjs`) was built as ESM with no `createRequire` banner, so
`require('better-sqlite3')` threw on every run. The catch returned
`'unavailable'`, wrote no record, and logged at `warn`. Every unit test mocked
the worker and passed. Only a live run of the built bundle found the defect.

The fail-safe was correct. The invisibility was the defect. This class is wide.

## Sweep (main worktree, 2026-09-06, excludes specs)

| Pattern                                                                | Count                                      |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| Catch that returns a sentinel (`null`, `false`, `[]`, `'unavailable'`) | 508                                        |
| Promise `.catch(() => undefined / null / {})` swallow                  | 20                                         |
| Optional-capability probes (`'unavailable'`, `isAvailable`)            | 54                                         |
| ESM worker bundles with no `createRequire` banner                      | 3 / 3                                      |
| Lint rules for empty catch / floating promises                         | none                                       |
| Specs that execute a built worker bundle as a process                  | 0 (main), 1 on branch 380 (integrity only) |

Top libs by sentinel catches: rpc-handlers 19, harness-sync 18,
cli-agent-runtime 18, vscode-core 14, agent-generation 14, ptah-electron 14,
workspace-intelligence 13, skill-synthesis 13, agent-sdk 13, vscode-lm-tools 11.

Named hits worth a direct look:

- `apps/ptah-electron/src/activation/wire-runtime.ts:324` —
  `void booter.startOrJoin(root).catch(() => undefined)`. A startup failure is invisible.
- `libs/backend/persistence-sqlite/src/lib/backup.service.ts:249,268` —
  same `'unavailable'` shape as F-1, around the native `better-sqlite3` load.
- `libs/backend/platform-cli/src/settings/cli-master-key-provider.ts:139` —
  `await import('keytar').catch(() => null)`.
- `apps/ptah-cli/src/smoke.spec.ts` — `describeIfBuilt` auto-skips when the
  dist is missing and still reports green. A fail-safe inside the test suite.
- ESM targets with no banner: `ptah-electron` `build-embedder-worker`,
  `build-voice-worker`, `ptah-cli` `build-embedder-worker`. Neither worker calls
  `require` today, so the defect is latent. The next `require` breaks silently.

Lint state in `eslint.config.mjs`: `no-empty` off, `no-floating-promises` absent
(no type-aware block), `no-unused-vars` at warn without `caughtErrors`,
`no-restricted-syntax` has no `CatchClause` selector.

## Rule the audit enforces

A catch may degrade to a default only when both hold:

1. A spec exercises the positive path against the real dependency at least once
   (not a mock). For a bundle, that means the built artifact runs as a process.
2. The negative path emits a structured degradation event with a stable code,
   not only a log line.

A site that meets neither is a defect candidate and gets fixed or escalated.

## Scope

1. **Lint the shape.** `no-empty` with `allowEmptyCatch: false`.
   `no-restricted-syntax` `CatchClause` selectors: body with no `throw`, no
   `logger.error`, and a literal `return`. Selector for `.catch(() => undefined)`
   and friends. `@typescript-eslint/no-floating-promises` in a type-aware block.
   Land at `warn` first. The first run is the inventory.
2. **Classify the inventory.** Each site gets one of: legitimate optional
   capability (keep, add event), defect (fix), test-only (exempt with reason).
3. **Generalize the bundle gate.** Template:
   `apps/ptah-electron/src/config/integrity-worker-bundle.spec.ts` (branch 380).
   One spec iterates every esbuild target with `format: ["esm"]`, asserts the
   banner, and spawns the built bundle with a self-test argument. Covers the
   embedder and voice workers in both hosts.
4. **Make degradation observable.** One `DegradationEvent` shape in
   `libs/shared`, emitted from every kept degrade site. A boot-log summary line
   with the count. One e2e assertion: a healthy fixture boots with zero
   degradation events. Future-enhancement #5 of TASK_2026_380 (escalate repeated
   `'unavailable'` verdicts) is a special case of this.
5. **Forbid green-by-skip.** A spec that auto-skips on a missing dist must fail
   in CI. Keep the skip for local runs behind an explicit env var.

## Track B — backup copy off the main thread (TASK_2026_380 HIGH #1)

`SqliteBackupService` runs `db.backup()` (full ~1 GB copy) plus `quick_check`,
`incremental_vacuum` and `optimize` synchronously on the main process at two
sites: the pre-migration backup in
`libs/backend/persistence-sqlite/src/lib/migration-runner.ts:88-99` and the
daily cron handler in `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:207-251`.
Measured: 27 s with 3.2 s lag spikes on the first boot that applies 0042.
Route both through the `IIntegrityWorkerProcessFactory` worker infrastructure
under `libs/backend/persistence-sqlite/src/lib/integrity/` with the same
three-valued verdict and never-block contract. Note: the pre-migration backup
runs BEFORE the migration inside `applyAll`, so "off the main thread" for that
site means the main process awaits a worker, not that boot proceeds without it.
The architect decides whether the backup worker is the integrity worker with a
second command, or a sibling worker. Item 16 of 380's future-enhancements
(fold backup validation into the integrity verdict) is the natural consolidation.

## Track C — post-boot RPC jank (TASK_2026_380 HIGH #2)

After the first RPC, five handlers land at once and each takes 2-4 s on the
main thread: `auth:getAuthStatus` (2244 ms), `config:models-list` (2296 ms),
`session:list` (2291 ms), `git:info` (2476 ms), `autocomplete:agents` (4095 ms).
Cause: CLI/SDK subprocess spawns (`claude.EXE`, `codex.CMD`) and model-list
calls. Lag spikes up to 1074 ms across ~14 s. Target: criterion-2 threshold of
500 ms. Re-run `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs` cold
BEFORE designing the fix (380's own re-measurement gate). Candidate shapes:
stagger or defer (the `bootScanDelayMs` arm-not-run pattern), cache detection
results across boots, or move subprocess detection off the main thread.

## Out of scope

- Rewriting the 508 sites in one pass. Track A classifies; fixes ship per lib.
- The remaining 14 LOW/MEDIUM items of 380's future-enhancements, except #5
  (escalation of repeated `unavailable`) and #11 (`--keep-db` flag, PID kill),
  which Track A and Track C need respectively.

## Sequencing and base branch

Track A's bundle gate and degradation event land first. Tracks B and C must
prove through them that their workers and deferrals actually run.

TASK_2026_380 is on PR #463 (`electron-cold-start-380`), not yet merged. Track B
depends on its integrity worker infrastructure. Branch this task from
`electron-cold-start-380` until #463 merges, then rebase onto `main`.

## CLI delegation

`cli_delegation: auto`. Team-leader recommends per batch. Sub-agents may hand
file-disjoint grunt work (the 508-site classification is the obvious candidate)
to CLI agents discovered via `ptah_agent_list`. Discovered 2026-09-06: `codex`
(cli, installed), `antigravity` (cli, installed), `claude cli` (ptah-cli,
`pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`), `ollama cloud` (ptah-cli,
`pc-85830910-3d81-4248-84c1-4fa52752dd19`). Max 3 concurrent.
