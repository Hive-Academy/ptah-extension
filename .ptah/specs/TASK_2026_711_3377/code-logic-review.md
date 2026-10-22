# Code Logic Review — `TASK_2026_711_3377`

Revision round 1 of 2. Supersedes the first-pass review of the same file. Reviewer family: grok. Implementers: opencode, then Ollama Cloud (Glm).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 |

Score 8 is the sound band. It is not 9 because the escaped-recording specs, typecheck, and lint were not run locally (CI owns them) and this pass did not re-execute the browser hosts. It is not 7 because both prior moderate findings are fixed in the current source and the orchestrator's focused Jest run passed.

## Five logic questions

### 1. How does this fail silently?

No new silent success on the revised paths. `remove` no longer treats every `realpath` `ENOENT` as deletion. After `isEnoent`, it `lstat`s `owned.directory` without following the final component (`lane-instruction-file-store.ts:82-97`). A remaining entry throws `Lane instruction directory changed` and does not call `files.delete`. Only a second `ENOENT` from `lstat` drops ownership.

### 2. What user action produces unexpected behaviour?

None confirmed on the revision. A live `stop` while status is `running` still stamps `stopped`, swallows a rejected remove, then clears timers, flushes, discards, schedules TTL, and emits `agent:exited` (`agent-process-manager.service.ts:2036-2064`). The new spec drives that branch (`agent-process-manager.service.spec.ts:3196-3227`).

### 3. What input data produces a wrong answer?

None confirmed. A dangling symlink or junction keeps the claim and rejects. A path that `lstat` also cannot see still drops ownership. A resolvable outside link still fails `assertInside` or the changed-directory check before delete (`lane-instruction-file-store.ts:99-102`). A non-native throw, or a native error whose `code` is not `ENOENT`, is rethrown (`:15-19`, `:82`).

### 4. What happens when a dependency fails?

`instructionFiles.remove` rejecting during a live stop is logged and does not skip `agent:exited`. `realpath` or `lstat` throwing a non-`ENOENT` native error keeps ownership and rejects `remove`. Startup still rethrows the original spawn error after the non-throwing cleanup helper (unchanged from the first pass; not re-tested as its own case).

### 5. What is missing that the requirements never mentioned?

Nothing new. Timeout and startup rejection tails still have no dedicated spec. They call the same `removeInstructionFiles` helper as the live stop, which this run did execute.

## Failure modes

None confirmed in this round. The prior dangling-link failure mode is closed: the `ENOENT` branch does not delete and does not follow the final component (`lane-instruction-file-store.ts:87-95`).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None.

## Prior findings

| Prior finding | Disposition | Evidence |
| --- | --- | --- |
| Moderate 1. `realpath` `ENOENT` dropped ownership while a dangling link still existed | FIXED | `isEnoent` uses `types.isNativeError` plus `code === 'ENOENT'` (`lane-instruction-file-store.ts:15-19`), so a Jest VM fs error is accepted without `instanceof Error`. A surviving entry is refused and ownership is kept (`:88-95`). The spec swaps in a dangling link, expects `Lane instruction directory changed`, and expects a second `remove` to refuse again (`lane-instruction-file-store.spec.ts:93-114`). `files.delete` is not on that branch. |
| Moderate 2. Stop spec settled the turn before `stop`, so it never entered the running branch | FIXED | New spec asserts `status: 'running'`, calls `stop` first, and only then resolves the handle (`agent-process-manager.service.spec.ts:3203-3213`). It expects `status: 'stopped'`, one `remove(agentId)`, the warn, and `agent:exited` with `stopped` (`:3216-3227`). The settled-release spec at `:3175` remains. `agent:exited` is emitted after the timer, buffer, and TTL lines (`agent-process-manager.service.ts:2056-2064`). |

Original store cases remain: content round-trip, retain-on-delete-failure, deleted directory, deleted root, symlinked parent, resolvable outside link, traversal (`lane-instruction-file-store.spec.ts:25-95` and `:117-119`).

## Data flow

1. `realpath` of root and directory. Success continues to `assertInside`, the same-path check, then `files.delete` of that resolved directory (`lane-instruction-file-store.ts:73-102`). OK.
2. `ENOENT`: `lstat(owned.directory)`. Entry present: throw, map unchanged, no delete. Entry absent: `owned.delete` and return. OK.
3. Live stop: status must be `running` or `stop` takes `releaseSubprocess` (`agent-process-manager.service.ts:2036-2038`). The new spec holds `running` until `stop` aborts the handle. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Dangling link keeps ownership and is rejected; absent path drops ownership | COMPLETE | Spec plus passing store suite |
| Errno check does not depend on the Jest realm's `Error` | COMPLETE | `types.isNativeError` |
| Hostile link is not deleted or followed | COMPLETE | No `files.delete` on the `lstat` branch; `lstat` does not follow the final component |
| Live stop with a rejected remove still finishes | COMPLETE | Spec expects `stopped` and `agent:exited` |
| Original store tests preserved | COMPLETE | Listed above |
| Focused runtime suites | COMPLETE | Log below |
| Browser escape specs, typecheck, lint | UNVERIFIED | Not run this round |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Deleted lane directory | YES | `lstat` `ENOENT` drops ownership | Covered by the passing store suite |
| Deleted workspace root | YES | Same, because the owned path is gone | Same suite |
| Dangling link or junction | YES | `lstat` sees the entry; throw; second `remove` still throws | Passing spec |
| Resolvable outside link | YES | Throw before `files.delete` | Passing spec |
| Plain object or string `{ code: 'ENOENT' }` | YES | `isNativeError` is false; rethrow | Not a separate spec; the helper rejects non-native values |
| Live stop, `remove` rejects | YES | Swallow, then tail, then `agent:exited` | Passing manager spec |
| Settled continuation, then stop | YES | Still the release path; prior spec kept | Passing manager spec |

## Verification

Orchestrator log `.ptah/specs/TASK_2026_711_3377/pr803-focused-tests.log`: 4 suites passed, 325 tests passed, 13.763 s. Paths: `lane-instruction-file-store.spec.ts`, `agent-process-manager.service.spec.ts`, `codex-cli.adapter.spec.ts`, `acp-session-handle.spec.ts`. This review did not re-run Jest. The runtime report's "UNRUN" note for the new store and live-stop cases is older than that log.

`node scripts/generate-content-manifest.js --check` was not repeated. The first pass already recorded a match for `sha256:65fba8acce81d425439b4e63709158d459bbb834dabfc72d877612ac30c2a774`.

## Verification limitations

- Browser escape specs, typecheck, and lint were not run locally. CI owns them.
- Timeout and startup cleanup-rejection paths have no new spec. Product code still uses `removeInstructionFiles`.
- This pass re-read the store, the store spec, the live-stop spec, and the running `stop` tail. It did not re-read the Codex, ACP, or browser bodies.
- `ptah_*` tools were not available (`search_tool` reported no MCP tools).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH on the two revised findings and the four Jest suites; MEDIUM on the unrun browser specs
- Top risk: an escaped-page recording regression would not have been seen locally
- What a robust implementation would add: nothing further on the two closed findings
