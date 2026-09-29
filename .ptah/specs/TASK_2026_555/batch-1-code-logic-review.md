# Code Logic Review — TASK_2026_555 Batch 1 (TASK_2026_553: persist failures reject)

## Summary

| Metric              | Value                              |
| ------------------- | ---------------------------------- |
| Overall score       | 7/10                               |
| Assessment          | APPROVED (with recorded follow-ups) |
| Blocking issues     | 0                                  |
| Serious issues      | 0                                  |
| Moderate issues     | 3                                  |
| Failure modes found | 5                                  |

Scope reviewed in full: `file-settings-errors.ts` (new), `file-settings-manager.ts` (whole file +
diff), `index.ts` (one export), `file-settings-manager.error-paths.spec.ts` (diff), `fix-report.md`.
Inputs: `batches.md` "## Batch 1" + verification, `TASK_2026_553\task.md`,
`implementation-plan.md` Component 1 (§1, lines 176-228).

Test evidence: `npx jest libs/backend/platform-core/src/file-settings-manager` (the requested root
command) fails to start: the root multi-project Jest config cannot resolve
`apps/ptah-cli/jest.e2e.config.cjs` (`Can't find a root directory`). The same specs run through
`npx jest -c libs/backend/platform-core/jest.config.ts src/file-settings-manager`:

- 3 consecutive runs: **4 suites, 66/66 tests green** (16 s each).
- 1 earlier run under concurrent worktree load: 2 suites / 3 tests red, with a bench `rename` ENOENT
  logged after teardown and a worker force-exit. Not reproduced in 3 isolated runs. This matches the
  "load-sensitive timeouts that pass when run alone" pattern recorded in `batches.md`, and the bench
  suite is self-labelled "NOT a CI hard gate" (`file-settings-manager.bench.spec.ts:1-5`). The
  team-leader's serial commit-time re-verify must confirm it is green alone.

## Numbered findings

### 1. MODERATE — The rollback rule uses value identity, not write ownership

- File: `libs/backend/platform-core/src/file-settings-manager.ts:121-127` (with `:104-117`).
- Scenario: two concurrent `set()` calls write an `Object.is`-equal value to the same key, and the
  first call's persist fails. Reaction order on the failed `write` promise guarantees the first
  call's catch runs before the queued second persist starts (reactions run in attachment order, and
  `set()` attaches its `await` before the next `set()` chains onto the same promise). The catch sees
  `Object.is(this.settings[key], value)` as true — it was the *second* set that put that value
  there — and restores the *previous* value. The second persist then serializes the restored map to
  disk, resolves, and the second `set()` fires its listeners with the new value.
- Impact: the second caller is told the write succeeded and its listener runs, but memory and disk
  hold the old value. That is exactly the "silent success after a lost write" class TASK_2026_553
  exists to remove.
- Cross-process variant: `processCrossProcessChange` (`:472`) replaces the map wholesale. If the
  reloaded disk value equals this call's value, the catch still "owns" the key and rolls it back,
  and any later queued persist writes the rollback over the other process's value.
- Likelihood: low. It needs an identical concurrent value *and* a failing persist. Distinct object
  references are not `Object.is`-equal, so most object-valued settings are safe; primitives
  (booleans, strings, numbers) are the exposure. Realistic sources: a double-clicked save, or a
  migration racing a user write of the same default.
- Fix: replace value identity with write ownership. Keep a per-key generation counter
  (`lastWriteId: Map<string, number>`); each `set()` takes `id = ++this.writeSequence` before the
  queue write, and the catch restores only when `this.lastWriteId.get(key) === id`. Cheap,
  spec-pinnable with the same harness as the existing "does not roll back a later set()" case by
  changing the second value to an identical primitive.

### 2. MODERATE — Orphaned temp files have no cleanup path

- File: `libs/backend/platform-core/src/file-settings-manager.ts:517` (temp name), `:536`
  (best-effort `rm`), `:486-502` (`loadSync` — no sweep).
- Scenario: the process is killed (crash, power loss, force-quit) between `writeFile` and `rename`.
  The unique temp file `settings.json.<pid>.<n>.tmp` stays on disk forever. The failure-path
  `rm(tmpPath, { force: true }).catch(() => undefined)` covers *handled* failures only, and
  swallows its own error (an antivirus lock on the tmp leaves the orphan silently). Nothing at
  startup — `loadSync` does not scan the directory — ever removes stale temps.
- Impact: unbounded slow accumulation in `~/.ptah/` over the machine's lifetime. No data-loss and
  no correctness effect (the fix-report's rationale for unique names is sound and the B4 evidence is
  documented), but the unique-name change converted "at most one stray file" into "one per
  interrupted write".
- Fix: on construction (inside `loadSync`), sweep `${this.filePath}.*.tmp` files whose `mtime` is
  older than a conservative age (e.g. 24 h) so a live writer from another process is never removed.
  Record it in the fix report.

### 3. MODERATE — The batch's verification result is not recorded; the fix-report cites a document that does not exist

- File: `.ptah/specs/TASK_2026_553/fix-report.md:130` — "See the TASK_2026_555 Batch 1 report for
  the scoped `nx run-many -t typecheck,test,lint` result". No `batch-1-report.md` exists in
  `.ptah/specs/TASK_2026_555/` (checked the folder listing).
- Impact: Batch 1's own verification (the 11-project `run-many` over platform-core, vscode-core,
  platform-vscode, platform-electron, platform-cli, settings-core, rpc-handlers, cli-engine and the
  three apps) has no recorded evidence, and the caller-spec claim ("if caller specs … go red, fix
  them in this batch") cannot be checked from the tree. The two unplanned changes also rest on a
  B4 flake ("passed 8/8") whose command and output are not recorded.
- Fix: run the Batch 1 verification command serially (execution default 4 already requires this at
  commit time), write `batch-1-report.md` with the tail of the output, and repoint the fix-report
  reference.

### 4. MINOR — `flushSync` still uses the shared temp name

- File: `libs/backend/platform-core/src/file-settings-manager.ts:231` — `settings.json.flush.tmp`.
- The cross-process temp-collision rationale that justified the unique names at `:517` applies to
  `flushSync` too: two processes flushing at exit write the same temp. Pre-existing, exit-path
  only, and explicitly out of this batch's scope ("`flushSync` stays swallowing"). Record it as
  follow-up debt rather than changing it here.

### 5. MINOR — Two spec-only fire-and-forget `setConfiguration` calls become latent unhandled rejections

- `libs/backend/platform-electron/src/implementations/electron-workspace.spec.ts:63` and
  `libs/backend/platform-cli/src/implementations/cli-workspace-provider.spec.ts:74` —
  `void provider.setConfiguration(...)`. If a persist ever fails in those specs, the rejection is
  now unhandled (`void` discards it). Today both suites pass. A `.catch(() => undefined)` in the
  specs removes the latent noise.

### 6. MINOR — New retry specs use real timers, not jest timers

- `file-settings-manager.error-paths.spec.ts` — the "stays locked (EPERM)" case sleeps 20+60+150 ms
  in real time (4 rename attempts asserted at `renameWithRetry`, `file-settings-manager.ts:553-566`).
  Acceptable (~230 ms once), noted so nobody later "fixixes" the count. The retry loop itself is
  verified safe: bounded to 1+3 attempts, `ENOENT` is not in `TRANSIENT_RENAME_CODES` so a vanished
  source is not retried, the rename is idempotent, and a successful first rename adds zero latency
  to normal writes. The failure path adds at most ~230 ms before the caller is told.

## Focus questions from the review brief

### 1. set() rollback correctness under concurrency

- Queued `set()` with a *different* value: correct, and pinned by the spec ("does not roll back a
  later set() on the same key queued behind the failed write"). The write queue also provably
  continues after a failure: both queue reactions (`:111-114`) schedule the next `persist()`, and the
  "chain recovers" case still passes with only its first `await` flipped to `.rejects` — exactly the
  deliberate change the plan allows.
- Queued `set()` with an *identical* value: NOT correct — finding 1.
- Cross-process reload: the `Object.is` guard correctly skips rollback when the reloaded map owns
  the key — except the equal-value corner in finding 1.
- Listeners fire only after success (`:130-132` inside the try path): verified by code and by the
  "listeners are not called on failure" spec. `ConfigManager.set` also fires its watcher only after
  `await this.fileStore.set(...)` resolves (`config-manager.ts:216-227`), so a failed write triggers
  no watcher callback.
- `flushSync` still swallows (`:219-241`, unchanged): pinned by the new spec.
- One verified invariant: the rollback never needs a re-persist — every failure happens before the
  `rename` completes, so disk still holds the pre-write content and memory matches it after the
  restore.

### 2. The two unplanned changes (per-write temp name, bounded rename retry)

- Justified and documented in the fix-report ("Why (a) and (b)"), with a concrete failing case
  (settings-core B4, shared temp name across two instances). The unique name removes a real
  cross-process data race. Residual gap: finding 2 (no sweep of crashed writes).
- Retry safety: bounded (4 attempts), no infinite loop, non-transient codes fail on the first
  attempt (pinned by the ENOSPC spec), and normal-path latency is unchanged.

### 3. The error and the log never carry the value

- `SettingsPersistError` (`file-settings-errors.ts:8-14`) carries only `code` and fixed text.
- `console.warn` (`file-settings-manager.ts:531-534`) logs the file path and the fs message; the fs
  message contains the *temp* path, never a settings value.
- The `settings:set` handler catch logs `key` + `error.message` and returns the message as the
  envelope (`settings-rpc.handlers.ts:162-171`); keys and fixed text only. Handlers without their
  own catch reach the dispatcher, which returns `errorObj.message` (`rpc-handler.ts:242-252`) —
  the same fixed text.
- Spec-pinned: "carries only the fs code and fixed text, never the value".

### 4. Unhandled-rejection scan (every `set`-path caller)

Full grep of `.setConfiguration(` across `libs/` and `apps/` (~60 sites). Every production call is
`await`ed or composed in `Promise.all`; no production fire-and-forget exists. The wrappers:

- VS Code provider `vscode-workspace-provider.ts:101`, Electron `electron-workspace-provider.ts:218`,
  CLI `cli-workspace-provider.ts:110` — plain `await`, no catch: the rejection propagates up.
- `settings:set` has its own catch → `{ success: false }` (`settings-rpc.handlers.ts:155-171`).
- `agent:setConfig` writes (`agent-rpc.handlers.ts:335, 386, 393, 1041`) are awaited inside the
  handler; the dispatcher catch converts a rejection into `{ success: false, error }`
  (`rpc-handler.ts:217-252`).
- `ConfigManager.set` (`config-manager.ts:216-227`) and `llm-rpc-app.handlers.ts:435-440, 535, 577,
  716` — awaited in handlers → dispatcher catch.
- CLI shim `container.ts:556-576` (`set`/`setTyped`/`update`) — awaited; CLI commands
  (`config.ts:257, 363`, `auth.ts:433-929`) run under `router.parseAsync(process.argv)`
  (`apps/ptah-cli/src/main.ts:166`), so a rejected write surfaces as a commander error instead of a
  process-crashing unhandled rejection. Net behaviour change for the CLI: a failed
  `ptah config set` now exits non-zero — the intended fix.
- Tray toggle catches and re-reads (`tray.service.ts:258-273`).
- Memory / skills-synthesis handlers wrap the write in try → `RpcUserError('PERSISTENCE_UNAVAILABLE')`
  (`memory-rpc.handlers.ts:740-757`, `skills-synthesis-rpc.handlers.ts:573, 826, 901`).
- Gateway paths (`gateway.service.ts:493, 518`, `adapter-lifecycle.service.ts:249-295`) are awaited
  by their RPC handlers → dispatcher catch. Observation (not a defect): in `stopPlatform` the adapter
  is already stopped when the flag write rejects; the enable flag stays true on disk, so the
  platform auto-starts at the next boot — but the caller does receive the rejection, so nothing is
  silent.
- Startup paths (`runCursorApiKeyMigration`, `migrateAgentOrchestrationSettings`, `with-engine.ts:536`)
  are Batch 2 / Batch 5 scope, correctly not touched here.

The only fire-and-forget sites found are the two spec `void` calls in finding 5.

### 5. What the requirements never mentioned

- Sweep of stale temp files (finding 2).
- A recorded verification result for this batch (finding 3).
- The identical-value rollback corner (finding 1) — the plan specified "restore the previous
  in-memory value on failure" without defining ownership under concurrent identical writes.

## Failure modes

### Rollback clobbers a concurrent identical write

- Trigger: two concurrent `set()` calls with an `Object.is`-equal value; the first persist fails.
- Symptom: second caller told success; memory and disk hold the old value.
- Evidence: `file-settings-manager.ts:121-127` + reaction ordering of `:111-117`.
- Current handling: value-identity guard (`Object.is`) — passes only because the tests use distinct
  values.
- Recommendation: per-key write-generation ownership (finding 1 fix).

### Orphaned temp file after a hard crash

- Trigger: process death between `writeFile` (`:528`) and `rename` (`:529`), or a failed
  best-effort `rm` (`:536`).
- Symptom: `settings.json.<pid>.<n>.tmp` accumulates in `~/.ptah/`; nothing ever removes it.
- Current handling: none at startup.
- Recommendation: age-based sweep in `loadSync`.

### Verification record absent

- Trigger: reading the fix report or auditing the batch gate.
- Symptom: `fix-report.md:130` references a nonexistent `batch-1-report.md`; the 11-project verify
  output is unrecorded.
- Recommendation: run and record it before commit.

### flake under load, one observed

- Trigger: the 4 file-settings suites run while other batches verify in the shared worktree.
- Symptom: 2 suites / 3 tests red once; a bench `rename` ENOENT logged after teardown and a worker
  force-exit (the 30 s bench timeout abandons an awaited `set` mid-flight; its persist completes
  after `afterAll` removed the bench home). Not reproduced in 3 isolated runs.
- Current handling: `batches.md` known-failures list covers load-sensitive flakes; bench is not a
  CI gate.
- Recommendation: confirm green in the serial commit-time re-verify.

### flushSync shared temp name (pre-existing)

- Trigger: two processes flushing concurrently at exit.
- Symptom: one flush can rename the other's temp away — the same race the batch fixed for
  `persist()`.
- Recommendation: follow-up debt only (finding 4).

## Data flow (RPC save path)

1. Webview `runCommit` → RPC `settings:set`. OK.
2. Handler validates key against the file allow-list (`settings-rpc.handlers.ts:149-154`). OK.
3. `setConfiguration('ptah', key, value)` → `fileSettings.set`. Plain await; rejection
   propagates; the synthetic change event is not fired on failure (the `await` throws first). OK.
4. `set()`: snapshot → optimistic memory write → queued `persist()`. OK, except finding 1.
5. `persist()`: unique tmp → `writeFile` → `renameWithRetry`; on failure warn (no value), best-effort
   tmp removal, throw `SettingsPersistError(code)`. OK, except finding 2.
6. `set()` catch: guarded restore, no listeners, rethrow. Memory matches disk. OK, except finding 1.
7. Handler catch → `{ success: false, error: 'Settings could not be saved to disk (<code>)' }`.
   Dispatcher catch covers handlers without their own catch. OK.
8. `runCommit` records `unsaved`/`unconfirmed` (the D15 "never Saved after a failed write" half is
   Batch 8, by plan). OK for this batch's scope.
9. Toast is Batch 17. Out of scope here.

## Requirements fulfilment

| Requirement (task.md / plan Component 1 / batch) | Status | Gap |
| --- | --- | --- |
| `persist()` logs then throws `SettingsPersistError` | COMPLETE | — |
| Error carries only the fs `code` + fixed text; no value | COMPLETE | spec-pinned |
| `console.warn` stays; never logs the value | COMPLETE | — |
| `set()` restores the previous value on failure | PARTIAL | restore is correct for distinct values; finding 1 breaks the identical-value corner |
| Listeners fire only after success | COMPLETE | spec-pinned |
| Queue accepts writes after a failure | COMPLETE | spec-pinned |
| `flushSync` keeps swallowing | COMPLETE | spec-pinned |
| Only the two planned spec assertions changed | COMPLETE | diff shows exactly the two allowed changes, both listed in the fix report |
| New cases: value unchanged, next `set()` succeeds, no listeners on failure | COMPLETE | all present, plus rename-retry and UNKNOWN cases |
| Export `SettingsPersistError` from `index.ts` | COMPLETE | one line |
| Write-path trace in the fix report | COMPLETE | traced and verified at each step |
| Batch verification (`run-many` over 11 projects) recorded | MISSING | finding 3 |
| Startup paths survive a rejecting write | NOT IN THIS BATCH | Batch 2, correctly untouched |

Implicit requirements not addressed: stale-temp sweep (finding 2); the fix-report's own reference
integrity (finding 3).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Failed write, key had a value | YES | snapshot restore, spec-pinned | — |
| Failed write, key was absent | YES | `delete`, falls back to registered default, spec-pinned | — |
| Later queued `set()`, different value | YES | ownership by inequality; spec-pinned | — |
| Later queued `set()`, identical value | NO | value-identity guard passes | finding 1 |
| Cross-process reload replaces the map | YES | guard skips rollback | equal-value corner (finding 1) |
| `fs` error without a `code` (other realm) | YES | structural `fsErrorCode` → `UNKNOWN`; spec-pinned | — |
| Transient rename lock (EPERM/EACCES/EBUSY) | YES | 3 retries, 20/60/150 ms; spec-pinned | — |
| Non-transient rename failure (ENOSPC) | YES | no retry; spec-pinned | — |
| Rename source vanished (ENOENT) | YES | not transient → fails fast | — |
| Crash mid-write | NO | — | finding 2 (orphan tmp; settings.json itself stays intact) |
| `flushSync` write error | YES | still swallows; spec-pinned | shared tmp name (finding 4) |

## Verdict

- Recommendation: **APPROVED** — no blocking or serious issues; the core contract of TASK_2026_553
  (a failed write rejects the caller, memory matches disk, listeners stay quiet, the queue survives)
  is implemented, traced and spec-pinned. The three moderate findings are a narrow correctness
  corner, an operational cleanup gap, and a missing verification record — all cheap to fix and none
  of them reintroduces the swallowed-failure bug.
- Score justification: 7/10 — sound band. What separates it from 8: the rollback rule is
  value-identity rather than write-ownership (finding 1), and the batch's verification is not
  recorded (finding 3). What separates it from 5-6: every acceptance criterion from the plan is met
  with pinned specs, the blast-radius scan found no unhandled rejection in production code, and the
  two unplanned changes are safe, bounded and documented with evidence.
- Confidence: HIGH.
- Top risk: a concurrent identical-value write during a persist failure can be reported as saved
  while disk holds the old value — the same silent-loss class the task fixes, in a narrow corner.
- What a robust implementation would add:
  1. Per-key write-generation ownership for the rollback (finding 1).
  2. Age-based sweep of stale `settings.json.*.tmp` in `loadSync` (finding 2).
  3. The recorded 11-project verify result, and a fixed pointer in `fix-report.md:130` (finding 3).
  4. Follow-up debt entries for the `flushSync` shared temp name and the two spec `void` calls
     (findings 4-5).