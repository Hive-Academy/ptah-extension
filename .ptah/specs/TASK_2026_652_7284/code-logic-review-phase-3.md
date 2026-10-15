# Code-Logic Review: Phase 3 (Manifest v4 and freshness, Batches 10-13), TASK_2026_652_7284

- **Score:** 6 / 10
- **Verdict:** APPROVED WITH FIXES
- **Review family:** antigravity (implementer: codex)
- **Diff:** `git diff 27bf6b468^..29519e705`

Path prefixes: `ASS` = `libs/backend/agent-generation/src/lib/services/analysis-storage.service.ts`, `ARC` = `.../services/wizard/analysis-run-checkpoint.ts`, `MPA` = `.../services/wizard/multi-phase-analysis.service.ts`, `AFS` = `.../services/analysis-freshness.service.ts`, `SRH` = `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`.

## Checks 1-8

| #   | Check                                                | Verdict                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | The only complete copy can be deleted                | **FAIL (Serious)**             | ASS:360-368, 371-377. See Finding 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1b  | Crash between copy and delete leaves two copies      | OK, with side effects          | ASS:347 uses a fresh `ulid()`, so a second archive is safe (nothing is overwritten). The next open sees the v3 source again (ARC:58) and writes another archive. Duplicate archives accumulate (Finding 6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1c  | Depends on the provider deleting files one at a time | Partly                         | The restore design in ASS:363-366 assumes a partial delete is possible. Whether the outer catch deletes the archive depends on whether `manifest.json` survives or is restored (ASS:371), so it depends on the provider's delete order and the `readDirectory` order. Nothing guards against that.                                                                                                                                                                                                                                                                                                                                                                                    |
| 1d  | Manifest check compares two `JSON.stringify` outputs | OK                             | ASS:354-357. Both values come from `safeParse` of the same zod schema, so key order is deterministic. The check is also redundant after the byte verification at ASS:398-402.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2   | v3 archived on every open                            | **FAIL (Serious, regression)** | ARC:58-59 runs regardless of `resume`. An archive failure throws out of `open` (MPA:219), which returns `Result.err` at MPA:439. Before, `createSlugDir` (ASS:160-163) just deleted and recreated the folder. Finding 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3   | Session id handling                                  | OK, one gap                    | The `!` at MPA:545 is safe at runtime. `succeeded` requires `!outcome.error`. A null id on a normal stream end raises `PhaseSessionMissingError` (MPA:731), which sets `resultError` and so `error`. Abort and timeout paths: the throw sits inside the `!aborted` guard (MPA:742-749). `timedOut` still sets `resultReceived = false` (MPA:775), so those paths behave as before. Gap: the first-id vs system/init rule (MPA:891-907) only validates against `system/init`. A later non-init message with a different id is silently ignored (Finding 7).                                                                                                                            |
| 4   | Resume checks                                        | Mostly OK, 2 issues            | `isCompleted` (ARC:133-170) resets the failing phase and all later ones, which is correct. It persists the reset (ARC:168). The fingerprint overwrite at ARC:70 happens before the input comparison, so a changed workspace invalidates every phase. That is consistent but silent. `hashPhaseOutput` (MPA:613-619) can throw after a phase succeeded. See Finding 3. A v3 "resume" restarts from scratch: Finding 4.                                                                                                                                                                                                                                                                 |
| 5   | F20: `MultiPhaseManifest` is V3 \| V4                | OK                             | `runId` exists in both versions (`multi-phase.types.ts:107,168`). `wizard-generation-checkpoint.service.ts:133` uses only `loadManifest(...)?.runId`. `Object.values(manifest.phases)` (ASS:578, 614; SRH:383, 482, 1127) and `lifecycle` (SRH:381, ASS:450) exist in both. `readManifest` returns null for v2 and unknown versions (ASS:315). I found no consumer that reads v4-only fields without narrowing. `listValidRuns` (ASS:653) and its callers include `-v3-archive-` directories as ordinary v3 runs (Finding 6).                                                                                                                                                         |
| 6   | Freshness                                            | OK, with caveats               | Read-only: only `readDirectory`, `readFile` and `readFileBytes` are used. A read error gives `unreadable` through the outer catch (AFS:256-258) or the rethrow of non-ENOENT errors (AFS:168, 177, 246). A rejected manifest alone gives `stale/unreadable` (AFS:191-194). Hash mismatch, a bad phase filename (path traversal check at AFS:231-239) and a missing file all give `stale`. Caveat: a newer rejected or corrupt run is skipped when an older valid fresh run exists (AFS:179-180, spec lines 153, 184 assert it), so "fresh" is reported although the newest run is bad (Finding 8). The run is picked by `analyzedAt` (AFS:187), while age uses `updatedAt` (AFS:215). |
| 7   | `wizard:analysis-status` RPC                         | Mostly OK                      | The schema is `z.object({})` (setup-rpc.schema.ts:27), which strips unknown keys, so there is nothing to inject. The handler is registered, the method name is listed at SRH:95, and the baseline file gained the entry. `getStatus` never throws (outer catch), and no error text is returned. However, `analysisDir` is returned as an absolute filesystem path, so it exposes the workspace path to the webview (Finding 9). Registry and baseline are consistent, and the handler spec passes (47 tests).                                                                                                                                                                         |
| 8   | Do the specs prove 1-7?                              | Partly                         | The 84 agent-generation tests and 47 rpc tests pass. The archive specs (`analysis-storage.service.spec.ts:384-410`) only mock a _whole_ copy failure and a _clean_ delete rejection (nothing is deleted before the rejection). Nothing tests a partial delete plus a failed restore, which is the data-loss case. Nothing tests that an archive failure blocks a fresh analysis, or `hashPhaseOutput` throwing. Freshness read-error specs exist (spec lines 299, 309).                                                                                                                                                                                                               |

## Findings

### 1. [Serious] The archive can destroy the only complete copy (ASS:360-377)

**Scenario:**

1. The archive is verified, then `fs.delete(source)` fails after removing some phase files.
2. The restore (`copyDirectoryVerified(archive, source)`, ASS:366) copies `manifest.json` back, then fails on a later file.
3. The exception reaches the outer catch. `readManifest(source)` is a valid v3 (ASS:371), so `fs.delete(archive)` runs (ASS:373).
4. Source is now a manifest with missing phase files, and the verified archive is gone. The phase output is lost.

The check proves "a v3 manifest exists", not "the source is complete".

**Minimal fix:**

- Never delete the archive after the copy has been verified. Delete it only when the failure happened before the delete step, using a flag set before `fs.delete(source)`.
- Better: after a failed delete, verify the source against the archive file by file before ever deleting the archive. Otherwise keep the archive and surface its path in the error.
- Add a spec with a delete that removes `phase.md` and then rejects, plus a restore copy that rejects.

### 2. [Serious] A normal fresh analysis can now fail because of the archive (ARC:58-59, ASS:403-405)

**Scenario:** The user re-runs the analysis on a workspace holding a v3 run. Examples: a symlink or unknown entry in the folder (`Unsupported entry`, ASS:404), a locked file on Windows, a read-only provider, or low disk space.

- `archiveLegacyRun` throws `LegacyRunArchiveError`, `open` throws, and `analyzeWorkspace` returns `Result.err`.
- Before, `createSlugDir` simply replaced the folder. The user can no longer start a new analysis until they delete the folder by hand.
- Fresh (non-resume) runs do not need the old data, so the failure is a regression of a user-visible capability.

**Minimal fix:** Decide the policy explicitly.

- For `resume === false`, treat the archive as best-effort: log a warning and continue to `createSlugDir`, or move the folder aside with a rename.
- Fail hard only if the product requirement says v3 data must never be dropped. In that case give the user an actionable error naming the folder.

### 3. [Moderate] Failure after a phase finishes leaves the run stuck as `running` (MPA:546, 576, 613)

**Scenario:** The phase file is written, then `hashPhaseOutput` or `markCompleted` throws (file read error, manifest write error).

- The exception skips `markFailed` and `checkpoint.finish()`, and goes to the outer catch (MPA:439).
- The manifest keeps `lifecycle: 'running'` and the phase `running`. The UI gets `Result.err` but the checkpoint never records the failure.
- Resume does recover (`running` becomes `pending`, ARC:67-69), and freshness says `incomplete`, so this is not data loss.

**Minimal fix:** Wrap the success-path hash in try/catch and fall through to `markFailed` with the error text, or call `checkpoint.pause(null)` or `finish()` in the outer catch when a checkpoint exists.

### 4. [Moderate] A v3 run is archived and restarted silently on "resume" (ARC:58-60, ASS:431-452)

An unfinished v3 run is still returned as resumable (ASS:450 only checks `lifecycle !== 'completed'`). Resume of a v3 run archives it and begins a new run from phase 1 (resume only applies to `kind === 'current'`). The user expects continuation.

**Minimal fix:** Exclude legacy v3 from `getResumableRun` (filter on `kind`), or return a clear "legacy run will be archived and restarted" signal.

### 5. [Minor] Fingerprint failures abort the analysis (ARC:52)

`computeWorkspaceFingerprint` throws on an unreadable root metadata file, and the whole analysis fails before any SDK work. The fingerprint is also taken at start only. User changes during a long run, or an agent-created root file, give `workspace-changed` right after completion. **Fix:** capture a fingerprint failure as a degraded or unknown fingerprint, or fingerprint again at `finish()`.

### 6. [Minor] Archives accumulate and are treated as normal runs (ASS:347, `listValidRuns`)

Each failed or crashed attempt, or each re-run, may add a `-v3-archive-<ulid>` folder. They show up in `list`, `findLatest` and `getResumableRun` and are never pruned. **Fix:** exclude the `-v3-archive-` suffix from run selection (or write a marker), and reuse an existing archive when the verified bytes are identical.

### 7. [Minor] Session id mismatch only checked against system/init (MPA:888-907)

A non-init message with a different id after a first non-init id is never flagged, and a later `result` message with another id is ignored, so the stored `sessionId` could belong to a different session. **Fix:** compare every message id with `capture.sessionId`, or document that init is authoritative.

### 8. [Minor] A newer corrupt run is hidden behind an older valid one (AFS:179-195)

The newer rejected run is skipped, so an older fresh run gives `fresh/ok`. Since `createSlugDir` replaces runs of the same slug, this is only reachable across different slugs or leftover archives, but "fresh" is then reported while the newest attempt is unreadable. **Fix:** if any rejected dir has a filesystem mtime newer than the chosen run, report `stale/unreadable`.

### 9. [Minor] `analysisDir` returns an absolute path (AFS:133-141, SRH:466)

The status payload includes the absolute analysis directory. **Fix:** return a workspace-relative path, or drop the field from the response unless the UI needs it.

## What I ran

- `npx jest -c libs/backend/agent-generation/jest.config.ts analysis-freshness analysis-storage multi-phase-analysis --coverage=false --maxWorkers=2`: 3 suites, 84 tests passed.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts setup-rpc.handlers --coverage=false --maxWorkers=2`: 1 suite, 47 tests passed.

## What I did not read or run

- I did not read the batch reports (`batches.md`, `batch-1x-report.md`, `batch-11-fix-report.md`, `implementation-plan.md`) or the `rpc.types.ts` and baseline changes beyond their diff stat.
- I read only the diff hunks for `multi-phase-analysis.service.ts`, `setup-rpc.handlers.ts` and `setup-rpc.schema.ts`, plus targeted line ranges of the source files. I read the specs only through name searches and the archive spec lines 358-412.
- I did not read the `isSystemInit` implementation, `readJson`, or `writeManifest` internals. The claim that `readJson` returns undefined on read errors is inferred from the freshness rethrow logic.
- I did not read the `getResumableRun` handler body (SRH:365-455). Finding 4 comes from `ASS:431-452`.
- I did not verify the real `IFileSystemProvider.delete` and `readDirectory` behaviour on any host.
- I ran no build, lint, e2e or typecheck. No source files were edited and nothing was committed.
