# Batch 1 report — 553 persist failures reject (S1a)

Executor: backend-developer (subagent). The report covers the first delivery and the review-fix round for
`batch-1-code-logic-review.md` (APPROVED 7/10, three moderate findings, all fixed).

Detailed trace and spec evidence: `.ptah/specs/TASK_2026_553/fix-report.md`.

## Files

| Path (under ROOT) | Change |
| --- | --- |
| `libs/backend/platform-core/src/file-settings-errors.ts` | CREATED. `SettingsPersistError(code)`, with fixed text plus the fs code only. |
| `libs/backend/platform-core/src/file-settings-manager.ts` | MODIFIED (see below). |
| `libs/backend/platform-core/src/index.ts` | MODIFIED. Exports `SettingsPersistError`. |
| `libs/backend/platform-core/src/file-settings-manager.error-paths.spec.ts` | MODIFIED. Two deliberate assertion changes and 17 new cases (12 failed-write, 5 sweep). |
| `.ptah/specs/TASK_2026_553/fix-report.md` | CREATED. RPC write-path trace and spec evidence. |
| `.ptah/specs/TASK_2026_555/batch-1-report.md` | CREATED. This file. |

No other file was touched. No caller spec in another lib needed a change.

## What changed in `file-settings-manager.ts`

- **`persist()`** keeps its `console.warn` line, then throws `SettingsPersistError(fsErrorCode(error))`.
- **`set()`** snapshots the previous value (or its absence), awaits the queued persist, and on rejection
  restores the snapshot and rethrows. Listeners fire only after a successful persist.
  - The restore applies only while the call still owns the key. Ownership means two things are unchanged:
    the per-key write generation (`writeGenerations`) and the reload epoch (`reloadEpoch`, bumped by
    `processCrossProcessChange`).
  - Ownership replaced the first version's `Object.is` value check (review finding 1).
- **The write queue** (`writePromise`) still chains each persist on both fulfilment and rejection.
- **`flushSync`** still swallows errors.

## Plan deviations (all inside the listed file)

1. **Unique temp name per write** (`settings.json.<pid>.<n>.tmp`, removed on failure) instead of the shared
   `settings.json.tmp`.
   - Why: the first verify run failed settings-core `migration-edge-cases.spec.ts` B4 (two instances writing
     concurrently). One instance's rename moved the other's temp file away. The old code swallowed this; now it
     rejected. The same race exists across the VS Code extension, the Electron app and the CLI.
2. **Bounded rename retry** on `EPERM`/`EACCES`/`EBUSY` (20/60/150 ms; rename is idempotent).
   - Why: after deviation 1, B4 still failed 1 run in 5 on Windows with a transient lock code. With both
     deviations, B4 passed 8/8 repeated runs
     (`npx jest -c libs/backend/settings-core/jest.config.ts libs/backend/settings-core/src/migrations/migration-edge-cases -t "B4"`).
   - It also covers the antivirus/OneDrive locks named in TASK_2026_553.
   - The fs code is now read structurally (`fsErrorCode`). Errors from Node core can come from another realm,
     where `instanceof Error` is false, and the first B4 failure reported `UNKNOWN` for exactly that reason.

Review-round addition, from finding 2: `loadSync` sweeps `settings.json.<pid>.<n>.tmp` orphans. It removes only
files older than 10 minutes, never the current process's files, and never non-matching files. It is best-effort
and logs on error.

## Deliberate spec changes (plan risk row)

- **"set() recovers when a prior persist() in the chain rejected"**: only the first `await` changed, to
  `.rejects.toBeInstanceOf(SettingsPersistError)`. The recovery assertion is unchanged.
- **"persist() logs but does not throw…"**: renamed to "…logs and rejects with SettingsPersistError…". The
  assertion changed from `.resolves.toBeUndefined()` to `.rejects.toBeInstanceOf(SettingsPersistError)`.

## Verification

### `npx nx test @ptah-extension/platform-core --skip-nx-cache` (foreground, after the review fixes)

- Result: 45/46 suites and 1015 passed, 4 todo, 1 failed.
- The single failure was the bench `file-settings-manager.bench.spec.ts` (tail/head latency ratio 28.8 under
  machine load).
- The bench is self-described as "SANITY CHECK — not a CI hard gate" (`bench.spec.ts:60`). Evidence that it was
  load and not the change, running it alone:
  - Unique-name code, loaded machine: 27.7 s total, ratio 28.8.
  - A temporary fixed-name experiment on the same loaded machine (file restored afterwards): 22.7 s total, with
    an inverted ratio of 0.07.
  - Unique-name code, two further runs: 6.2 s total (ratio 0.31) and 1.7 s total (ratio 0.63). Both passed.
- The same suite passed inside the full run-many below.

### Batch 1 verify command (final run, after the review fixes)

```
npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core @ptah-extension/vscode-core @ptah-extension/platform-vscode @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/settings-core @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode ptah-electron ptah-cli --parallel=2
```

- Result: EXIT=1, with one failed task: `@ptah-extension/rpc-handlers:test`.
- `rpc-handlers:test`: 3396 passed, 4 skipped, 1 failed.
- Every other test, typecheck and lint target of the 11 projects passed, including platform-core, settings-core,
  vscode-core, platform-electron and ptah-electron.

### The unrelated failures seen across the three verify runs

1. **`rpc-handlers` `harness-skill-selection-rpc.service.spec.ts:113`** — "never writes state.json". Seen in
   all three runs.
   - It expects `existsSync(harnessStatePath(root))` to be false before the service is called, and finds the
     file already present.
   - It also fails when run alone (1 failed, 9 passed).
   - The spec and the harness-sync code it uses were not touched, and neither goes through
     `PtahFileSettingsManager`.
   - Likely cause: environmental. The temp workspace is created under `%TEMP%`, which is inside the home
     directory, and `resolveHarnessWorkspaceRoot` (`harness-sync/src/lib/workspace/workspace-root.ts:66-80`)
     walks ancestors for workspace markers.
2. **`platform-electron` `workspace-watch-host.entry.spec.ts`** — "Timed out after 5000 ms waiting for the
   first burst batch". Seen in run 2 only. It passes 12/12 alone, and it tests the `@parcel/watcher` host, not
   settings.
3. **`ptah-electron` `shell-csp.spec.ts`** — suite teardown `rmSync` hit `EPERM` on a temp directory. Seen in
   run 2 only. It passes 7/7 alone.
4. **Run 1 only (under load):** timeouts in `bounded-glob-walk.spec.ts`, the file-settings bench and
   `git-info.service.review.spec.ts`. None recurred in later runs.

Gate G does not apply yet (Batch 16 is not committed).

## Out of scope (recorded, not changed)

- `flushSync` still uses the shared `settings.json.flush.tmp` name (review finding 4, pre-existing, exit path).
- `void provider.setConfiguration(...)` in `platform-electron/.../electron-workspace.spec.ts:63` and
  `platform-cli/.../cli-workspace-provider.spec.ts:74` could now surface an unhandled rejection if a persist
  ever failed there (review finding 5). Both suites pass today.
- The D15 "unconfirmed → unsaved" half of the frontend path is Batch 8. The startup specs are Batch 2.
