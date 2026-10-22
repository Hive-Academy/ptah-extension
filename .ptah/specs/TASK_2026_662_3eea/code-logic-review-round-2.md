# Code Logic Review, Round 2 (Phase A fix round) - TASK_2026_662

Review family: reviewer Claude (in-process subagent), implementers codex.
Scope: uncommitted diff against `fd0110afc` plus untracked `libs/backend/platform-core/src/utils/source-hash*.ts`. No checks were run by me (RAM rule). Paths below are relative to the worktree.

## Per-item verdicts

| Item | Finding | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | L-S1 review format | PARTIAL | `spec-extractor.ts:79-80,114,118` now accepts `Recommendation:` and APPROVE / APPROVED / REVISE / NEEDS_REVISION. The reviewer contract's third value `REJECT` is not in the fail list (only `rejected`), and `NEEDS REVISION` / `NEEDS-REVISION` stop at `needs` because the capture is `[a-z_]+`. The no-verdict diagnostic is now emitted for every file (`:259`). |
| 2 | L-M1 conflict gate | FIXED | `spec-harvester.service.ts:166` gates only when there is no batch and no lane verdict; batch and lane keep precedence. |
| 3 / 3b | L-M2 `is_error` | FIXED | `spec-harvester.service.ts:119-127` no longer passes `isError`. `skill-candidate.store.ts:1428-1436` leaves `is_error` untouched when it is `undefined`. The only caller is the harvester. O8 spec change is consistent. |
| 4 | L-M4 root normalisation | PARTIAL (risk, see S1) | `spec-harvester.service.ts:150` normalises with the shared helper, but nothing on the write side normalises (see S1). |
| 5 | L-M6 marker skip | FIXED, with two side effects (M1, M2) | `spec-harvester.service.ts:133,148-190`: attribution or grade failure returns false and no marker is written. |
| 6 | L-M5 `removeAbsent` | FIXED | `skill-task-grade.store.ts:163-174`: empty list is a no-op and `spec:%` rows are excluded in both the SELECT and the DELETE. The harvester writes `batch`, `lane-final-review` and `task-review` (`spec-harvester.service.ts:177`), so no overlap with the backfill prefix. |
| 7 | St-M1 Zod rows | FIXED | `skill-task-grade.store.ts:41-71,85-92`. `final_review` domain is `approved/rejected/null` (`lane-outcome.schema.ts:58`), so the strict enum does not reject legitimate rows. |
| 8 | L-M3 `slash-command` | FIXED | `skill-invocation-event.store.ts:108`, `skill-candidate.store.ts:1671`. Grep finds no other `'tool-use', 'prompt-expansion'` filter. |
| 9 | L-S3 dual-write | FIXED | `skills-synthesis-rpc.handlers.ts:639-670`. Key names match `file-settings-keys.ts:296-298` and the enhancer reads `skills.enhancement.timeoutMs` at `skill-enhancer.service.ts:854`. `getSettings` still reads the legacy keys (`:612-625`), so read-after-write is consistent. Lane A2 reported this as unowned; Lane B made the change in the handler (correct place). See M3. |
| 10 | L-S2 successRate | FIXED | `skills-synthesis-rpc.handlers.ts:2326-2330`. `failed` counts only `succeeded = 0` (`skill-candidate.store.ts:1473`), so NULL (ungraded) rows make the sum fall short of `total` and yield null. |
| 11 | St-S1 single hash helper | FIXED | `platform-core/src/utils/source-hash.ts:4`, exported at `index.ts:304`; used at `skill-enhancer.service.ts:481` and `user-layer-mirror.service.ts:836`. No leftover `createHash` + `sha256:` copy in either file. Import is through `@ptah-extension/platform-core` only. Placement is acceptable under O7. See Mi1, Mi2. |
| 12 | St-S2 stale guard | FIXED | `user-layer-mirror.service.ts:830-837` and both call sites. Behaviour is unchanged: the file is read only when a hash is supplied, inside the same lock window as before. See Mi3. |
| 13 | L-M7 error diagnostics | FIXED | `skill-enhancer.service.ts:222-239,584,1006`. Name allowlisted, message scrubbed for URLs, bearer/token/secret/key, `sk-/pk-/rk-` keys, quoted strings and 32+ char blobs, then cut to 240. The auth site at ~:907 is untouched (O3). No credential is logged. See Mi4. |
| 14 | St-S3 archive constants | FIXED | `skill-pipeline-archive.ts:7-8,47`, `migration-runner.ts:23,131-133,149-156,339-359`. Options object and private method are in place; behaviour is unchanged (`maxVersion` 56, fatal true). See Mi3. |
| 15 | L-M8 migration rewrite | FIXED | `file-settings-manager.ts:542-549` now goes through `persist()` on the `writePromise` queue and a failure is caught and logged. `writePromise` is initialised at the field declaration (`:74`), before `loadSync()` in the constructor. See Mi5. |

## Write-path traces

| Persisted write | Writer | Runtime reader | Result |
| --- | --- | --- | --- |
| `skills.enhancement.provider/model/timeoutMs` (new) plus `skillSynthesis.judge*` / `enhanceTimeoutMs` (legacy) | `skills-synthesis-rpc.handlers.ts:657-671` | New keys: `skill-enhancer.service.ts:854` area. Legacy keys: `skill-synthesis.service.ts:1619-1630` and `getSettings` (`:612`) | OK. Not atomic across the two writes (M3). |
| Load-time settings migration | `file-settings-manager.ts:542` via `persist()` | `get()` on the new keys | OK. |
| `skill_task_grades` rows | `spec-harvester.service.ts:180` (`upsert`), `:183` (`removeAbsent`) | `getAggregates`, `listRecent`, `hasGradeForTask` | Write is keyed by a normalised workspace root; the attribution read is keyed by the same normalised value against raw stored event roots (S1). |
| `skill_invocation_events.succeeded` / `reconciled_at` / `verdict_source` | `skill-candidate.store.ts:1428-1436` | Stats at `:1468` | OK; `is_error` preserved. |
| `.harvested.json` marker | `spec-harvester.service.ts:134` | `:113` skip check, `listSpecs` `:205` | Not written on a grade failure (intended); is written on an empty attribution result (S1). |
| `pre-0057-*` archive directory | `skill-pipeline-archive.ts:47` | Archive verification only | Unchanged. |

## Findings

### Blocking

None.

### Serious

**S1. Normalised workspace root may not match the stored root, so grades are silently never written and the marker is written anyway.**
- File: `spec-harvester.service.ts:150`; `skill-task-grade.store.ts:130,141` (`e.workspace_root = ?`, `workspace_root = ?`); writers `skill-invocation-event.store.ts:73`, `skill-invocation-recorder.ts:54`, `triggers/skill-trigger.service.ts:306,441`.
- Scenario: events are stored with the raw `payload.workspaceRoot`. No writer in skill-synthesis or lane-outcomes calls `normalizeWorkspaceRoot` (grep). The harvest root arrives from the same raw payload (`skill-trigger.service.ts:433,498`). Before the fix, `join(specsRoot,'..','..')` reproduced the raw string. Now `normalizeWorkspaceRoot` lowercases the drive letter, resolves and strips trailing separators. On Windows, a raw root such as `D:\proj` (Electron) no longer equals `d:\proj`, and SQLite `=` is case-sensitive.
- Impact: `findAttributions` returns an empty list with no error, `removeAbsent` is a no-op, `writeGrades` returns true, and the marker is written. The spec is recorded as harvested with zero grades and no diagnostic. This is the same silent-absence failure the fix round set out to remove. The plan said to normalise "to the exact form the store writes"; that was not verified. The spec at `spec-harvester.service.spec.ts:223-226` only asserts mock call arguments, so it cannot catch it.
- Fix: normalise at the write side too (event store, lane records and `session_task_links`), or compare in SQL through a normalised column, or revert to the raw join and normalise only for comparison. Add one spec with a real in-memory DB where the event is stored with an uppercase drive or trailing separator. Until then, log a warning when `findAttributions` returns an empty list for a spec that has batches.

### Moderate

- **M1.** `spec-harvester.service.ts:133,148-190`, `skill-task-grade.store.ts:85-92`. A persistently failing grade write (for example one row failing a Zod schema, which now throws) blocks the marker forever. The spec stays `complete-unharvested` and a warn is emitted on every harvest, with no backoff or cap. Retry is the intent; add a bounded retry count or a once-per-session log.
- **M2.** `spec-harvester.service.ts:164-172` combined with `skill-task-grade.store.ts:164`. If every attribution is skipped (conflict, or no verdict), the key list is empty and `removeAbsent` becomes a no-op. A previously written grade whose verdict is now conflicting stays stale, and the harvester returns success. Prune per key with an explicit `nothing graded` signal, or accept and document it.
- **M3.** `skills-synthesis-rpc.handlers.ts:657-671`. The legacy and new key writes are sequential and independent. If the second `setConfiguration` rejects, the legacy value is persisted, the RPC reports an error and the two key sets diverge until the next successful update. Write the new key first or roll back on failure.
- **M4.** `spec-extractor.ts:79`. `REJECT` and `NEEDS REVISION` (space or hyphen) are unrecognised. A rejected review yields no grade and now only a diagnostic. Add `reject` to the fail list and widen the capture to `[a-z_ -]+` with normalisation.
- **M5.** `spec-extractor.ts:114`. The last `verdict|status|recommendation` match decides the result. A trailing unrelated `Status:` or `Recommendation: <prose>` line after the verdict makes `terminalVerdict` null with no fallback to earlier matches. Pick the last match that parses to a terminal value.

### Minor

- **Mi1.** `platform-core/src/utils/source-hash.ts:4` versus `agent-generation/.../source-hash.ts:75,89`: two `sha256:`-prefixed "source hash" notions with different semantics (exact text versus CRLF-normalised). Add a one-line cross-reference in the doc comments to prevent misuse.
- **Mi2.** `platform-core/src/utils/source-hash.ts:3`: a skill-draft freshness hash is domain-specific for a platform util. Accepted under O7, recorded for later.
- **Mi3.** Orphaned JSDoc after the extractions. `user-layer-mirror.service.ts:829` has "Flat-file twin of `refreshSavedSidecarDir`" above `isStaleSource` instead of `refreshSavedSidecarFile`. `migration-runner.ts:~336-340` has the `runVecCatchUp` doc block sitting above the new `ensureArchive`. Move each doc to its method.
- **Mi4.** `skill-enhancer.service.ts:222-239`: unquoted filesystem paths in messages are not scrubbed (not credentials). The older `:702` warn still logs the raw `error.message` (outside this diff). `safeGenerationError` is a local helper that other warns could reuse.
- **Mi5.** `file-settings-manager.ts:542-549`: `persist()` now always writes the constant `$schema` and `version: 1`, where the old rewrite preserved the file's own values. Also, the double log on failure (persist and catch) is harmless.
- **Mi6.** `skill-pipeline-archive.ts:8`: `pre-0057-` repeats the number carried by `FIRST_DESTRUCTIVE_SKILL_PIPELINE_VERSION`. Fine as a stable on-disk name; a comment saying so would help. The `ensureArchive` method and `ensureArchiveOnce` closure names are close; consider `verifyArchiveOnce`.

## Answers to the check questions

1. All 15 items plus 3b are assessed above: 12 FIXED, 2 PARTIAL (items 1 and 4), 0 NOT FIXED. Item 5 is FIXED, with side effects M1 and M2.
2. Introduced risks: S1 (item 4), M1 (item 5), M2 (item 6), M3 (item 9). Item 15 loses no data. Item 9 key names match `file-settings-keys.ts` exactly.
3. Style for items 11, 12, 14: one hash helper, imported via public aliases, platform-core is a util tag and an allowed dependency of both consumers. The extracted guard and constants are clean apart from Mi3.
4. Item 13 logs no credentials; the auth site is unchanged per O3.

Score: 7/10. All Serious findings from round 1 are closed, but the item 4 change can silently suppress grading on Windows, and the item 1 parser still misses `REJECT`.

Verdict: REVISE (7/10)
