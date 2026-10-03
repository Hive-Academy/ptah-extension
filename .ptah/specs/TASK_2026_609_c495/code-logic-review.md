# Code Logic Review — TASK_2026_609_c495 Part A

> Restored by the orchestrator on 2026-10-04. A later re-check lane overwrote this file by mistake; its output was moved to `code-logic-recheck.md`. The text below is the original review as read earlier in the same orchestrator session.

Verdict: CHANGES REQUIRED
Score: 4/10

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Failure modes found | 3 |

The ownership filter and ordinary snapshot failure handling implement the requested policy. However, retirement can still destroy unarchived content, and quarantine completion can lose its recovery record. These are significant problems in the central preservation requirement, separating this score from 5–6; functioning validation, ownership selection, and retry paths separate it from 1–2.

Scope: individually examined `git show` for exactly `62f1ad576`, `ba965aa1c`, `c2c4f9951`, `43a330406`, `4071ff138`, and `3c2c52284`. No branch-range review, source edits, or mutating git commands. Direct dependencies were followed for hashing, copying, settings resolution and recovery. Part B implementation changes are not attributed to Part A.

Evidence convention: findings use current worktree lines, with original commit locations supplied where Part B shifted them. The checklist uses the following explicit file aliases and revision line numbers so interleaved changes cannot alter its meaning:

- **M** = `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` at `c2c4f9951`.
- **Q** = `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts` at `c2c4f9951`.
- **T** = `libs/backend/harness-sync/src/lib/targets/workspace-target.ts` at `ba965aa1c`.
- **R** = `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts` at `ba965aa1c`.
- **O** = `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts` at `3c2c52284`.
- Other paths are worktree paths unless a revision is stated. All are relative to the supplied worktree root.

## Checklist

“HOLDS” means the specified mitigation/assumption holds within the stated scope, not that every operation is risk-free.

| Item | Status | Evidence file:line |
| --- | --- | --- |
| A3 — source slug establishes ownership | HOLDS | M:1893 filters seeds against the source listing; Q:108 classifier checks source membership, not a contaminated harness manifest. |
| A4 — why clones survive the reaper | HOLDS | Q:13 documents sidecar-less/local-work survivors; M:502 calls the reaper from reconcileAll. `user-layer-seed-quarantine.spec.ts` at c2c4f9951:267 and :280 exercise both survivor forms. Actual sidecars on the user's machine were not inspected; the criterion covers both. |
| A5 — retirement reaches hand-edited copies | HOLDS | T:581 selects absent desired entries without a drift exemption; T:909 snapshots detected edits before removal. Preservation limitations are findings 1–2. |
| A6 — dogfood refresh excluded | NOT APPLICABLE | `.ptah/specs/TASK_2026_609_c495/batches.md:30` explicitly excludes dogfood refresh. No finding against those copies. |
| A7 — shared workspace retirement path | HOLDS | T:255 calls retireOwned; R:297 explicit uninstall also calls apply with baseEntries at :307. This covers manifest-owned workspace copies. Existing home-entry migrations at T:938 are a distinct pre-existing path, not newly protected by this batch. |
| A8 — recorded skill hash matches transformed output | HOLDS | T:992 copies transformed content and :998 hashes the output; :968 records that hash. `harness-reconciler.retire-local-edit.spec.ts` at ba965aa1c:323 pins unchanged skill retirement. This is a content hash, not proof of a complete tree. |
| R1 — conservative ownership decision | HOLDS | M:1893; Q:154 refuses unknown source state; Q:108 requires absent slug and byte equality to flat original. Owned/different/unprovable clones are retained. |
| R2 — quarantine never loses user data | VIOLATED | Q:272 checks snapshot against earlier bytes, then :288 removes the live clone without detaching or rechecking it. Finding 2. |
| R3 — absent source seeds nothing and logs count | HOLDS | M:1880 logs workspace, source status and flatClonesNotSeeded; :1890 returns without copying. Flat originals are only read in M:1912. |
| R4 — preserve retired hand edits | VIOLATED | T:895/:906 uses a filtered hash to choose whether any snapshot is needed; T:919 removes the whole artifact. Findings 1–2. Ordinary edited files are handled. |
| R5 — once-only completion and partial retry | VIOLATED | Q:147 creates a fresh result; :202 only writes completion on a clean pass; :307 records only that pass's slugs. Retries execute, but earlier successful moves disappear from the permanent record. Finding 3. |
| R6 — concurrent mirror passes | VIOLATED | M:365 and Q:192 lock each slug, but Q:166 marker check and :203 marker write are outside a pass-wide lock. Two successful passes can replace the record with different subsets or an empty list. Finding 3. |
| R7 — relative paths rejected without breaking normal caller | HOLDS | `file-writer.service.ts:198`, :322; O:419 and :791 construct the output under the workspace root; :873 calls writeAgent. Batch validates all paths before I/O at `file-writer.service.ts:134`. Prior caller audit is recorded in `batch-2-executor-report.md`; no production batch caller was identified there. |
| R8 — invalid Claude model never emitted | HOLDS | O:1117–1134 trims, checks emittability and exact Claude syntax, warns and falls back; O:1192 emits the resolved value. Both generated (:973) and fallback (:1081) paths share it. |
| R9 — tool names match source | HOLDS | `templates/agents/_shared/tooling-precedence.md:7` under agent-generation contains the eight rows; `template-sharing.guard.spec.ts:1038` checks them against `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts:31`. |
| R10 — generated manifest current | HOLDS | `content-manifest.json:4` hash is 6a9c3b40…1024; reviewer ran manifest:check successfully, reporting 226 files. |
| R11 — usable snapshot before deletion | VIOLATED | T:1141 verifies the destination against an old hash, not the live object being deleted at :919; directory hash is filtered and permits incomplete observations. Findings 1–2. Copy failures themselves correctly retain ownership. |
| R12 — optional shared health field | HOLDS | `libs/backend/harness-sync/src/lib/targets/harness-target.port.ts` at ba965aa1c:168 and `libs/shared/src/lib/types/harness-sync.types.ts` at ba965aa1c:159 declare optional removedLocalEdit; `harness-health.ts` at ba965aa1c:117 and R:331 propagate it. |
| R13 — history outside scanned target roots | HOLDS | T:1119 puts history under .ptah/harness; T:292 enumerates CLI roots; `harness-reconciler.retire-local-edit.spec.ts` at ba965aa1c:409 checks the next pass. The hash-ignore rule is valid for source discovery but unsafe as deletion-proof evidence (finding 1). |

## Findings

### 1. Blocking — filtered content hash permits deletion of unarchived skill data

- File: `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:908`, :919, :932 (introduced at ba965aa1c:895, :906, :919).
- Failure scenario / trigger: install a managed skill, then put the only copy of personal notes at `.agents/skills/<slug>/.history/notes.md` without changing SKILL.md. Delete/disable its upstream skill and reconcile.
- Symptom / impact: the skill is reported as an ordinary removal; the notes are deleted and no retirement snapshot exists.
- Evidence: `libs/backend/harness-sync/src/lib/hash/content-hash.ts:89` excludes .history, _candidates, .ptah-origin.json and quarantine content; :180 skips those entries. T's new hashArtifact uses that same hashDir. `libs/backend/harness-sync/src/lib/targets/copy-engine.ts:239` recursively deletes the entire directory, including ignored content.
- Current handling: equality with the recorded content hash is treated as proof that every byte being removed is unchanged. Nested symlinks and content beyond the hash depth limit are also outside this proof. The existing case 6 adds NOTES.md at the root, so it does not exercise excluded content.
- Suggested fix: before destructive directory retirement, preserve the complete tree or use a separate exhaustive preservation inventory that includes excluded names, links and all depths and fails on unreadable entries. Do not change source-discovery ignore semantics merely to fix retirement. Add a regression with an otherwise unchanged skill containing unique .history data.

### 2. Blocking — a save after snapshot verification is deleted without preservation

- File: `libs/backend/harness-sync/src/lib/targets/workspace-target.ts:922`, :932, :1182; `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts:477`, :492, :493 (Part A T:909, :919, :1141; Q:272, :287, :288).
- Failure scenario / trigger: retirement reads version A and copies/verifies A into history. An editor or another process atomically saves version B to the original path before removeManaged runs. The quarantine version is similarly deterministic if a save occurs while the awaited sidecar removal is in progress, after the clone snapshot was verified.
- Symptom / impact: version B is deleted while history contains only A; the result reports a successful move/removal. An initially unchanged copy also has an asynchronous gap between hashing and deletion.
- Evidence: verification rereads only the snapshot. Neither removal path checks the identity/content of the object it actually removes. M:1574's in-process slug lock coordinates participating service calls, not external editor saves. Harness serialization likewise cannot lock a user's editor.
- Current handling: copy-then-delete with no atomic handoff. Unique history destinations prevent archive collisions, but do not protect the live source.
- Suggested fix: atomically detach the original artifact into a unique history/staging location on the same filesystem, preserve that detached object, and never unlink a new occupant that appears at the original path. If a filesystem cannot support a safe handoff, retain the original and report failure. A second hash alone narrows but does not eliminate this race. Test an injected save/replacement between verification and removal for both paths.

### 3. Serious — successful quarantine moves lose their durable record after retry or overlap

- File: `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts:345`, :359, :388, :395, :507 (Part A Q:147, :166, :195, :202, :307).
- Failure scenario / trigger: video-director moves successfully; figma-designer fails with EBUSY. No completion marker is written. On retry, only figma-designer remains in the clone listing, so the completion marker records only figma-designer. A marker-write failure or process exit after a successful move has the same result. Two overlapping runs can also each pass the initial marker check and overwrite the other's record after per-slug locks are released.
- Symptom / impact: earlier successfully quarantined agents vanish from the permanent quarantine inventory. Their bytes remain in history, but normal recovery cannot identify them from the record.
- Evidence: the existing partial-failure spec at `user-layer-seed-quarantine.spec.ts` in c2c4f9951:453 retries successfully but checks only the second result; it never asserts the cumulative marker. The direct current consumers in the same source file iterate only marker.quarantined at :547 and refuse Restore for absent slugs at :613. These consumers are Part B; they demonstrate the impact of the Part A record defect, not an additional Part B finding.
- Current handling: per-pass in-memory result, with a completion marker only after success. No durable per-move journal and no whole-pass serialization.
- Suggested fix: persist recoverable per-slug quarantine provenance before removing the active clone, resume and merge that journal after failure/restart, and serialize marker completion per scoped workspace. Keep the completion marker absent until all moves settle successfully; do not solve retry by marking a partial pass complete. Test success+EBUSY+retry, marker-write failure, process restart and two concurrent runs, asserting every moved slug remains recoverable.

## Five logic questions

### 1. How does this fail silently?

Filtered hashes turn omitted skill data into a clean removal (T:906, finding 1). A late edit is removed with a valid-looking old snapshot (T:919; Q:288, finding 2). The marker can look complete while omitting prior moves (Q:307, finding 3).

### 2. What user action produces unexpected behaviour?

Saving an agent during retirement can lose the saved version (T:909 → :919). Keeping unique notes under a skill's .history then removing the skill destroys those notes (T:895; content-hash.ts:91). Retrying an EBUSY quarantine can hide previously moved agents (Q:202/:307).

### 3. What input data produces a wrong answer?

A skill tree differing only in ignored entries is classified as unchanged (content-hash.ts:89; T:906). Model input is more defensive: blank/non-string/malformed layers resolve to absence, and invalid nonblank Claude strings fall back to the template (O:1117; shared agent-models.types.ts:166).

### 4. What happens when a dependency fails?

Snapshot mkdir/copy/verification failure yields writeFailed and leaves the target manifest entry for retry (T:910; R:317/:653). Quarantine catches individual move failures and continues (Q:242), but loses completed-move provenance on retry (finding 3). Missing settings injection uses template models; throwing settings reads warn and use templates (O:1091–1099). No new unobserved async task or resource leak was found in the scoped additions.

### 5. What is missing that the requirements never mentioned?

A complete preservation inventory, an atomic retirement handoff with external writers, and durable per-move quarantine provenance are required by the never-lose-data promise (findings 1–3). A per-slug lock alone does not serialize completion records (Q:192/:203).

## Failure modes

The three numbered findings above are the complete counted failure-mode list; each supplies trigger, symptom, evidence, current handling and recommendation. Missing production model registration is a disclosed scheduled integration dependency below, not an additional defect charged to the six commits.

## Blocking issues

Findings 1 and 2. Both can irreversibly remove user-authored bytes while reporting success. Fix the preservation protocol before accepting Part A.

## Serious issues

Finding 3. The bytes survive, but the normal quarantine recovery path loses them after a probable partial failure.

## Moderate and minor issues

None counted. Existing unrelated writer rollback/containment behavior, pre-existing home-entry migration behavior, and the Part B transformer diagnostics are outside this six-commit change.

## Data flow

1. **OK:** mirrorAll gets workspace-scoped roots and reads source ownership once (M:324/:351).
2. **OK:** legacy seed selects only source-owned slugs, leaving flat originals untouched (M:1893/:1912).
3. **GAP:** quarantine locks/classifies each foreign clone, snapshots it, then deletes a still-mutable live path (Q:192/:224/:261/:288; finding 2).
4. **GAP:** completion records only this invocation's successful moves (Q:202/:307; finding 3).
5. **OK selection / GAP preservation:** desired-state removals flow through apply for ordinary reconciliation and uninstall (T:581; R:297); filtered hashes and copy/delete races undermine preservation (findings 1–2).
6. **OK:** only successful removals prune ownership; failed paths remain retryable (R:317/:653).
7. **OK locally / integration pending:** generation reads one settings-layer snapshot, resolves Claude values, applies them to both content branches, then passes absolute output paths to the writer (O:771/:828/:973/:1081/:873).
8. **OK:** the writer validates paths before I/O, and the shared tooling block is included in the verified content manifest (`file-writer.service.ts:134`, :198; `content-manifest.json:4`).

## Settings write-path trace

| Stage | Evidence and outcome |
| --- | --- |
| Key and stored format | `libs/backend/platform-core/src/file-settings-keys.ts:176` registers machine `agentGeneration.models`. Value is `{ "<slug>" or "*": { claude?, codex?, copilot?, cursor?, opencode? } }`; leaves are model strings, not one flat slug-to-string map. |
| Workspace scope | `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:34` derives the first 16 SHA-256 hex characters of the normalized explicit path; :38 forms `workspace.<hash>.agentGeneration.models`. :206 writes that key and :215 refuses absent paths. |
| Writer | Direct dependency `libs/backend/settings-core/src/repositories/agent-model-settings.ts:138` update selects one physical key, queues its read/modify/write and updates one slug/provider leaf. Workspace calls writeForPath; machine calls writeGlobal. This repository is a Part B dependency, not changed by these commits. |
| File routing | `file-settings-keys.ts:179` recognizes the machine key; :742/:755 routes workspace-prefixed keys. |
| Reader | `agent-model-settings.ts:117` layersForPath reads the workspace value separately from the global value. O:771 reads once using options.workspacePath. |
| Precedence | `libs/shared/src/lib/types/agent-models.types.ts:192`: workspace slug → workspace * → machine slug → machine *. No cross-provider inheritance. |
| Validation and emission | O:1123 trims, checks exact opus/sonnet/haiku/inherit, otherwise warns and returns template model. O:1192 writes model before unchanged disallowedTools; fallback and generated paths share the value. |
| Host integration | O:271 injects optionally and O:1091 silently returns null if absent. The three examined host registration files did not register AGENT_MODEL_SETTINGS at review time. `batches.md:916` explicitly assigns that wiring to pending B-5f2/B-5f3/B-5f4. Thus these six commits alone do not activate overrides in production. This is a release dependency, not a request to expand Part A's assigned file list. |
| Path identity limit | This reader uses options.workspacePath directly. Its eventual save callers must use the same resolved workspace root; normalized-path hashing alone is not git-root resolution. The pending Part B integration must verify this end to end before claiming workspace isolation. |

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| F1 owned-only seeding | COMPLETE | Implemented under A3; M:1893. |
| Quarantine proven leaked clones without losing data | PARTIAL | External-save race and incomplete durable inventory; Q:272/:288/:307. |
| Preserve retired hand-edited rival copies | PARTIAL | Ignored content and copy/delete race; T:895/:919. |
| F5 reject relative paths | COMPLETE | Result error before I/O; file-writer.service.ts:322. |
| F2 key registration and Claude rendering logic | COMPLETE | Key routing and renderer covered; file-settings-keys.ts:179; O:1113. |
| F2 usable production override | PARTIAL | Scheduled Part B host registrations not yet present; O:1091; batches.md:916. |
| F4 compact tooling table and content manifest | COMPLETE | Guard at template-sharing.guard.spec.ts:1038; manifest check passed. |
| Dogfood regeneration | Not in scope | Explicit A6 non-goal, batches.md:30. |

Implicit requirements not addressed: atomic preservation against external saves; complete inventory of bytes removed; cumulative recovery provenance across retries and process exit.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Undefined workspace / flat root | YES | M:1867; Q:152 | Seed and quarantine skip. |
| Empty source | YES | Q:74 yields ok+empty set | Eligible foreign clones may quarantine. |
| Absent/unreadable source | YES | Q:81; :154 | No quarantine; seed logs skip. |
| Sidecar absent / copied orphan flag | YES | Byte classifier Q:108 | Snapshot preserved on ordinary path. |
| Clone differs / flat gone | YES | Q:115 | Kept and logged. |
| Snapshot unreadable/wrong bytes | YES | Q:272; T:1141 | Original remains on detected failure. |
| Unique ignored skill content | NO | T:906 treats hash equality as unchanged | Finding 1. |
| Save after verification | NO | T:919; Q:288 remove live paths | Finding 2. |
| Partial success + EBUSY + retry | NO | Q:307 forgets earlier successes | Finding 3. |
| Concurrent quarantine passes | NO | Q:166/:203 outside slug lock | Completion records overwrite each other. |
| Process exit after move, before marker | NO | Q:288 precedes :203 | Recovery record missing, finding 3. |
| Invalid model / settings dependency absent | YES locally | O:1091/:1130 | Template fallback; host wiring remains a release dependency. |
| Relative / drive-relative / UNC | YES per native host semantics | file-writer.service.ts:322; spec :367 | Cross-platform acceptance is platform-conditioned in tests. |

## Verification and limits

- Read the task's Part A assumptions/risks, relevant batch contracts, context, and the Part B plan insofar as it defines direct dependencies. No code-style-review.md existed in the discovered task folder.
- No applicable AGENTS.md was found by ptah_search_files; the six discovered instruction files belong to unrelated HyperFrames projects. Applied the supplied repository guidance.
- ptah.files.read failed with an execution error; native reads were used as fallback.
- Reviewer ran scoped ptah_get_diagnostics for the changed agent-generation, harness-sync and platform-core paths. No diagnostics in the requested files. Two sibling TS2345 errors appeared at copilot-agent-transformer.ts:47 and cursor-agent-transformer.ts:43, in concurrently developed Part B files; they are not findings against these commits.
- Reviewer ran `npm run manifest:check`: passed, hash 6a9c3b4012d6622b1ec5212cf297dc49b7c5547834a0a7fe0ce02071e85f1024, 226 files.
- No test suite was rerun. Existing evidence: batches.md:298 records agent-generation 36/36 suites, 1240 passed/1 skipped; Batch 1a evidence at batches.md:130 distinguishes 17 baseline harness failures plus a pre-existing capability-policy flake and reports all nine new retirement cases passing. These are prior executor/team-leader results, not fresh reviewer executions.
- Findings are source-traced failure interleavings, not claims that new regression tests were executed. The partial-failure test visibly omits the cumulative-marker assertion. Permission behavior on other platforms and actual contaminated files on the user's machine remain unverified.
- The review does not approve unrelated historical code or interleaved Part B commits.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the three source-traced failures; production integration remains pending.
- Top risk: a successful-looking retirement can remove user bytes that were never archived.
- What a robust implementation would add: complete-tree preservation, atomic retirement handoff, durable per-slug quarantine provenance, serialized completion, and regression tests for ignored files, late saves, partial retries and process interruption. Finish and verify the already-planned host wiring before advertising model overrides.
