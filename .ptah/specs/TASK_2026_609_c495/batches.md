# Batches - TASK_2026_609_c495

Total tasks: 20 (Part A, incl. 8 A-FIX) + 33 (Part B) = 53 | Batches: 10 (Part A, incl. A-FIX-1..A-FIX-4) + 22 (Part B) + 1 (FU-4) = 33 | Complete: 33/33 (B-7 COMPLETE except Gate 3 QA, Mode 3 2026-10-04 completion-report.md, HEAD dc5bc09f3; B-6 COMPLETE 7be71f54e; A-FIX-3 COMPLETE c1a631b21, A-FIX-4 COMPLETE bd05497c8, Part A short scoped re-check due; B-5g COMPLETE 846d6f3f2, B-5f2/B-5f3/B-5f4 COMPLETE 15d845bd2 in one commit, counted as three batches; FU-4 COMPLETE 6d9dcba5e; Part A 8/8: phase review CHANGES REQUIRED 2026-10-03, fix round A-FIX-1 COMPLETE 841263730, A-FIX-2 COMPLETE dc2e2b3fd, A-FIX re-review due; Part B 21/22, B-5f1 4fe3cae22; B-5b, B-5c2 added 2026-10-03; refreshed 2026-10-03 after #634: Batch 3 split into 3a/3b; B-5 split into B-5a, b, c, c2, d, e, f1, f2, f3, f4, g)

Scope: Part A (F1 + quarantine, F5, F2, F4) — batches 1a-4 below, unchanged. Part B (narrowed, fast track; implementation-plan.md C1-C6) — see "Part B" at the end of this file.
Worktree root (W): `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup`, branch `fix/task-609-subagent-setup`. Never touch `main`.

## Run defaults (recorded, from context.md "CLI Lanes" + orchestrator prompt)

- Order after the Batch 1 hold (context.md "User Decisions — Batch 1 hold"): Batch 1a (harness-sync guard) is implemented, checked and committed FIRST; then Batch 1 is committed as one unit, scope unchanged. Batch 1's uncommitted working-tree files (`user-layer-mirror.service.ts`, `user-layer-agent-scope.spec.ts`, `user-layer-seed-quarantine.ts`, `user-layer-seed-quarantine.spec.ts`) stay untouched and unstaged during Batch 1a; the 1a commit stages only the 1a file list.
- Batches 1 and 2 run now and are file-disjoint; they may run concurrently. Both live in `@ptah-extension/agent-generation`, so one batch's scoped checks can see the other's in-flight edits. A failure in a file that belongs to the other batch is not this batch's failure; re-run after both land.
- Batches 3 and 4 were BLOCKED-ON-#634; unblocked 2026-10-03 (#634 merged, rebased). See "Mode 1 refresh after #634": 3a and 4 run now, 3b after B-5b.
- Review policy (user hygiene rule 3): no per-batch review. Each batch is verified on disk by the team-leader and must pass its scoped checks; commits stay LOCAL (no push). ONE code-logic review runs on the combined Part A diff (`git diff origin/main...HEAD` after Batch 4) and gates push/PR. At most one fix round (Blocking/Serious; Moderate only if it can break a config or lose data), as a follow-up commit.
- Scoped checks, always in this order, output tailed (`| tail -40`): `npx nx run-many -t typecheck,lint -p <projects>` (never `--maxWorkers` on typecheck), then `npx nx run-many -t test -p <projects> --maxWorkers=2`. Never workspace-wide.
- CLI lanes get the explicit file list below and a tool-call ceiling; no polling.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1. The research claim "no template references the `TOOLING_PRECEDENCE` block (grep count 0)" is FALSE. Verified: all 15 `templates/agents/*.template.md` already carry `<!-- STATIC:TOOLING_PRECEDENCE -->` (e.g. `team-leader.template.md:34`, `backend-developer.template.md:34`). F4 therefore edits ONLY `_shared/tooling-precedence.md`; `team-leader.template.md` needs no edit, so that #634 collision disappears. The remaining F4 collision is `content-manifest.json` (single global `contentHash`, `scripts/generate-content-manifest.js:141-155`), which changes whenever any template file changes. Verified.
- A2. PR #634 also touches `libs/backend/platform-core/src/file-settings-keys.ts` (+spec) — verified with `git diff --name-only origin/main...origin/fix/task-597-lane-token-burn`. F2 collides on two files, not one; it stays blocked.
- A3. "Owned by this workspace" means: the slug has a `<slug>.md` in this workspace's agent source dir (`sources.agentSourceDir`, i.e. `{ws}/.claude/agents`). The harness manifests (`{ws}/.ptah/harness/<target>.manifest.json`) cannot be the ownership test: the reconciler already recorded the leaked slugs there (e.g. `.codex/agents/video-director.toml` in property-hub), so they would read as owned. Unverified against the user's machine; Task 1.1 states it in code and spec.
- A4. The orchestrator-reported contamination (video-director, visual-reviewer in all 4 scoped dirs; figma-designer in property-hub) survived the existing orphan reaper (`user-layer-orphan-reaper.ts:115-140` would class a sidecar'd, non-plugin agent whose slug is absent from source as `orphan`). So the leaked clones are probably sidecar-less (rule 1, "never touched") or flagged local-work (`orphaned: true`), or `reapDeletedUpstream` does not run on the propagate path. Task 1.2 must find out which, because the quarantine criterion must catch exactly those clones. Unverified.
- A5. When a scoped clone leaves the desired state, the reconciler retires its manifest-owned rival copies (`{ws}/.codex/agents`, `.github/agents`, `.cursor/agents`, `.opencode/agent`) through `removeManaged` (`harness-sync/src/lib/targets/workspace-target.ts:251-262`). Whether the planner skips a HAND-EDITED owned copy (drift) or deletes it is unverified. Task 1.3 checks it.
- A7. Every retirement of a rival-CLI copy goes through `WorkspaceHarnessTarget.apply`'s removal loop (`workspace-target.ts:251-262`): the plan path (`planRemovals`, `:580-598`; source deleted, slug left the desired set, disabled agent per `harness-reconciler.agent-consent.spec.ts:226`) AND the reconciler's remove pass (`harness-reconciler.service.ts:280-332`, E22), which builds its own removal list from the manifest and calls `target.apply`. Both pass `baseEntries` (the manifest) in the plan, so the guard belongs in `apply`, keyed on `plan.baseEntries[relPath].hash`. `ClaudeHarnessTarget` is out of scope: its removals are only migratable links (`claude-target.ts:569-580`), never owned copies. Verified.
- A8. The recorded manifest `hash` for an owned rival SKILL directory equals `hashDir` of the on-disk transformed copy (the `'unchanged'` branch records the actual hash, `workspace-target.ts:455-459, 523`; the write branch must too). Unverified for the write branch; Task 1a.3 spec case 6 checks it. If false, an unmodified skill retirement would be mis-reported as a local edit (extra snapshot, no data loss) — executor reports it, does not paper over it.
- A6. Dogfood copies `W/.claude/agents/*.md` and their `.codex`/`.opencode` mirrors (`scripts/regen-agents.mjs`) embed the rendered `## Working rules` block. Refreshing them is NOT in Part A: #634 rewrites 12 of them, and they are repository dogfood, not shipped content. Recorded so the reviewer does not flag the drift as a miss.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1. Wrong ownership filter strands or reaps a workspace's own agent copies | HIGH | Task 1.1: seed copies only slugs present in this workspace's source; Task 1.2 quarantine requires (a) source dir read successfully, (b) slug absent from it, (c) clone byte-identical to the flat-base `~/.ptah/user/agents/<slug>.md` (proves seed origin, no local work since). Anything else is kept and logged. Specs cover each branch. |
| R2. Quarantine destroys user data | HIGH | Task 1.2: move, never delete. Reuse the reaper's snapshot-then-remove path into the scoped root's `.history/<slug>/<ts>/` (the same store `revertFileClone` reads, `user-layer-mirror.service.ts:915`), clone + sidecar together; assert the snapshot exists before removing. Flat-base originals untouched. |
| R3. Workspace with consent but no `{ws}/.claude/agents` loses its rival CLI copies on first scoped pass (365 D4 reason) | MEDIUM | Default chosen: seed nothing when the source dir is absent (stops the leak on every path; the wizard always creates the dir before `propagate`). Data is not lost: flat originals stay on disk and rival copies are derivatives. Task 1.1 logs the skip with the workspace and the count of flat files not seeded. Reviewer to confirm. |
| R4. Reconciler deletes a hand-edited rival copy of a quarantined slug | MEDIUM | Task 1.3: verify planner behaviour. If it deletes drifted copies, the executor STOPS and reports (no harness-sync behaviour change inside Batch 1); team-leader returns it as a blocker for that sub-part. If it keeps them (foreign/frozen), pin with a spec. CONFIRMED (deletes); resolved by Batch 1a per user decision (snapshot to `.history`, then remove, report removed-with-local-edit). |
| R5. One-time quarantine re-runs every pass, or never retries after a partial failure | MEDIUM | Task 1.2: marker file written in the scoped root only after a pass with zero move failures; marker name starts with `.` and is not `*.md` so `listClones`/reaper/source resolver never read it as a clone. |
| R6. Concurrent mirror passes for one workspace race the quarantine | LOW | Task 1.2: quarantine runs inside `mirrorAll` before `mirrorAgents`, per slug under the existing `withSlugLock('agent', slug)`. |
| R7. F5 rejects a path some caller passes as relative today | LOW | Task 2.1: grep callers of `AgentFileWriterService` write methods; orchestrator passes absolute (`orchestrator.service.ts:404`). Use `path.isAbsolute` (covers `\\server\share`); reject with a `Result.err(FileWriteError)` naming the path, never throw. |
| R8. Invalid `agentGeneration.models` value writes a `model:` Claude Code rejects | LOW | Task 3.2: accept only `opus`, `sonnet`, `haiku`, `inherit` (trimmed); anything else logs a warning and falls back to `template.model`. |
| R9. Tooling table drifts from the real tool names | LOW | Task 4.1: every row checked against `PTAH_MCP_SUBSTITUTION_SECTION` / `server-instructions.ts`; guard spec asserts the names. |
| R10. Stale `content-manifest.json` fails CI `manifest:check` | MEDIUM | Task 4.2 runs `npm run manifest:generate` after the rebase onto merged #634, then `npm run manifest:check`. |
| R11. Guard removes a hand-edited copy without a usable snapshot (partial write, wrong bytes) | HIGH | Task 1a.2: snapshot first, then verify the snapshot hash equals the on-disk hash just read, only then `removeManaged`. Any failure ⇒ no removal, `writeFailed` entry, manifest entry stays owned so the next pass retries (existing contract, `harness-reconciler.service.ts:313-318`). |
| R12. Adding a field to the shared health type breaks its many literal producers (frontend fixtures, specs) | MEDIUM | Task 1a.1: field is OPTIONAL on both `HarnessApplyResult` and `HarnessTargetHealth`, same precedent as `adopted?` (`harness-sync.types.ts:150-162`). No fixture edits. |
| R13. Snapshot store read back as a source, target, or foreign finding | LOW | Store lives at `{ws}/.ptah/harness/.history/`, outside every target dir; `.history` is already in the hash ignore set (`content-hash.ts:91`). Spec asserts the next pass reports no new `foreign` entry. |

Edge cases:

- `workspaceRoot` undefined or scoped root equals the flat root — seed and quarantine both no-op (Task 1.1, 1.2; existing guard at `user-layer-mirror.service.ts:1836`).
- Source dir present but EMPTY vs ABSENT vs unreadable (EACCES) — empty: seed nothing, quarantine allowed; absent or unreadable: seed nothing, quarantine NOT run ("unknown is not gone", reaper doc `user-layer-orphan-reaper.ts:29-38`) (Task 1.1, 1.2).
- Scoped clone with no sidecar but byte-identical to the flat file — quarantined (seed origin proven by bytes) (Task 1.2).
- Scoped clone that differs from the flat file (enhanced or hand-edited) — kept, logged as foreign-with-local-work (Task 1.2).
- Flat file gone since the seed — cannot prove seed origin, kept (Task 1.2).
- Quarantine move fails on one slug (Windows EBUSY) — others proceed, marker not written, retried next pass (Task 1.2).
- Settings map key lookup: exact agent name first, then `*`, then template (Task 3.2).
- Relative, drive-relative (`C:foo`), UNC and POSIX-absolute paths to `FileWriterService` (Task 2.1).

## Batch 1a: harness-sync guard — snapshot hand-edited CLI copies before retiring them — COMPLETE (b5cc7ab43)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane x 1 (Codex allowed) with exactly the file list below, tool-call ceiling 40, no git, no polling
- Execution mode: sequential
- Rationale: data-loss guard on the one removal path every retirement shares, spanning two libs (harness-sync + shared type) with an unverified hash assumption (A8) that needs judgement if it fails; three dependent tasks in overlapping files.
- Tasks: 3 | Depends on: none | Blocks: Batch 1 commit
- Source: context.md "User Decisions — Batch 1 hold"; batch-1-executor-report.md "A5 / R4" (probe: hand-edited `.codex/agents/a2.toml` removed, reported only in `removed`).
- Projects: `@ptah-extension/harness-sync`, `@ptah-extension/shared` (type only)
- Files (exactly these; do not edit any other file, and never touch Batch 1's working-tree files):
  - `W\libs\backend\harness-sync\src\lib\targets\workspace-target.ts` (modify: `apply` removal loop `:251-262`; private snapshot helper)
  - `W\libs\backend\harness-sync\src\lib\targets\harness-target.port.ts` (modify: `HarnessApplyResult` `:152-159`)
  - `W\libs\backend\harness-sync\src\lib\health\harness-health.ts` (modify: `appliedTargetHealth` `:95-120`)
  - `W\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts` (modify: remove-pass health row `:320-332` only)
  - `W\libs\shared\src\lib\types\harness-sync.types.ts` (modify: `HarnessTargetHealth` `:146-162`)
  - `W\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.retire-local-edit.spec.ts` (create)
- Overlap check (verified 2026-10-03): Batch 1 working tree = 4 agent-generation `user-layer/*` files (`git status --short`); none listed here. Batch 1's optional `workspace-target.agent-retire.spec.ts` was never created and is superseded by this batch's spec. PR #634 (`git diff --name-only origin/main...origin/fix/task-597-lane-token-burn`, 147 files) touches no file under `libs/backend/harness-sync/` and not `libs/shared/src/lib/types/harness-sync.types.ts`. No overlap.
- Snapshot location (default chosen, recorded): `{ws}/.ptah/harness/.history/<slug>/<ts>/<relPath>` — e.g. `.ptah/harness/.history/a2/2026-10-03T12-00-00-000Z/.codex/agents/a2.toml`. Workspace-local per the user decision, beside the harness manifests, outside every CLI's read dir (a `.history` inside `.codex/skills` would be read as a skill and reported foreign). Keeping `relPath` under `<ts>` keeps two targets retiring the same slug in one pass from colliding and tells the user where to restore. `<slug>` = basename of `relPath` up to its first `.` (skill dir: the dir name). `<ts>` = ISO time with `:` and `.` replaced by `-`; create with non-recursive `mkdir` and suffix `-1`, `-2`… on EEXIST.

### Task 1a.1: Add the optional `removedLocalEdit` report field — COMPLETE

- Files: `harness-target.port.ts`, `harness-sync.types.ts`, `harness-health.ts`, `harness-reconciler.service.ts`
- Plan reference: context.md "User Decisions — Batch 1 hold" ("report as removed-with-local-edit").
- Pattern to follow: `adopted?: string[]` on `HarnessTargetHealth` (`harness-sync.types.ts:150-162`, optional "because every existing producer of this type must keep compiling"); `overwrittenLocalEdit` doc line `:146`.
- Quality requirements: `removedLocalEdit?: string[]` on `HarnessApplyResult` and `HarnessTargetHealth`, doc comment: manifest-owned paths that were hand-edited, snapshotted to `{ws}/.ptah/harness/.history/...`, then removed; every such path ALSO appears in `removed` (so existing counts/manifest pruning stay correct). `appliedTargetHealth` copies it through; the remove-pass health row (`harness-reconciler.service.ts:320-332`) copies `result.removedLocalEdit`. Omit the field or emit `[]` consistently — pick one and keep it (R12). No frontend or fixture edits.
- Validation notes: R12.

### Task 1a.2: Guard the removal loop in `WorkspaceHarnessTarget.apply` — COMPLETE

- Depends on: Task 1a.1
- File: `W\libs\backend\harness-sync\src\lib\targets\workspace-target.ts`
- Plan reference: batches.md "Batch 1 hold"; A7.
- Pattern to follow: drift test `actual === owned.hash` in `planEntry` (`:487-489, 523`) with `hashFile` / `hashDir` (`hash/content-hash.ts:122, 295`); `withWindowsRetry` + `removeManaged` (`copy-engine.ts:235-251`); failure shape `result.writeFailed.push({ relPath, reason })` (`:257-261`).
- Quality requirements, per non-mcp removal, in this order:
  1. `lstat` the path. Absent ⇒ current behaviour (plain remove, ENOENT tolerated, reported `removed`). Symlink ⇒ plain `unlink`, no snapshot (never follow a link).
  2. Owned record = `plan.baseEntries[relPath]`. Hash the on-disk copy (`hashDir` for `isDirectory`, else `hashFile`). Hash `null` while the path exists ⇒ READ ERROR ⇒ do NOT remove; `writeFailed` with reason `cannot read to check for local edits: ...`.
  3. Hash equals the owned `hash` (or no owned record exists) ⇒ unchanged copy ⇒ plain remove, no snapshot.
  4. Hash differs ⇒ hand-edited ⇒ copy file/dir into the snapshot dir; re-hash the snapshot and require it equal the on-disk hash; any failure (mkdir, copy, verify) ⇒ do NOT remove, `writeFailed` with reason `could not save local edit before removal: ...`. Only after a verified snapshot: `removeManaged`, then push to `removed` AND `removedLocalEdit`. If `removeManaged` fails after the snapshot: `writeFailed`, snapshot stays (harmless; next pass makes a new `<ts>`).
- Replace the removal loop in place; doc comment states the rule and cites TASK_2026_609. Helper stays private in this file (file budget). No change to `planRemovals`' selection logic and no change to MCP removals (facet-owned).
- Validation notes: R4, R11, R13, A7, A8. A `writeFailed` removal keeps its manifest entry (reconciler only prunes `result.removed`, `harness-reconciler.service.ts:313-318` and `:652`), so it is retried next pass — confirm, do not change.

### Task 1a.3: Spec pinning retirement of unchanged vs hand-edited copies — COMPLETE

- Depends on: Task 1a.2
- File: `W\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.retire-local-edit.spec.ts` (create)
- Pattern to follow: `harness-reconciler.agent-consent.spec.ts` (real reconciler, temp workspace, `newReconciler([...disabled])`, `CODEX_ONE`/`CODEX_TWO` helpers, `:226-241`) and `harness-reconciler.remove.spec.ts:97`.
- Spec cases (real reconciler + real Codex/Copilot targets, temp workspace; no fs mocks unless a case cannot be made deterministic):
  1. Unchanged owned agent copy, source deleted ⇒ removed, in `removed`, NOT in `removedLocalEdit`, no `.ptah/harness/.history` dir.
  2. Hand-edited owned agent copy (`HAND EDITED`), source deleted ⇒ file gone; `.ptah/harness/.history/<slug>/<ts>/.codex/agents/<slug>.toml` holds exactly `HAND EDITED`; path in `removed` and `removedLocalEdit`; manifest entry dropped. (Pins A5 case 2, replaces the deleted probe.)
  3. Disabled-agent retirement (`newReconciler(['agent-two'])`) with a hand-edited Codex copy ⇒ same outcome as 2; sibling untouched.
  4. Read error: replace the owned file path with a directory of the same name (lstat ok, read fails) ⇒ not removed, `writeFailed` reason mentions local edits, manifest entry kept, no history; after restoring a readable file, the next pass retires it.
  5. History write fails: create a regular FILE at `{ws}/.ptah/harness/.history` ⇒ hand-edited copy NOT removed, `writeFailed`, manifest entry kept; unchanged copies in the same pass still removed.
  6. Rival skill directory: unchanged ⇒ plain remove, no history (checks A8); hand-edited (extra file added) ⇒ whole dir snapshotted then removed.
  7. Remove pass (`reconciler.remove`, E22) over a hand-edited copy ⇒ snapshot + `removedLocalEdit` on that health row.
  8. Same slug hand-edited in two targets, one pass ⇒ both preserved, nothing overwritten.
  9. Next pass after case 2 reports no new `foreign` entry (R13).
- Existing specs must stay green unchanged: `agent-consent.spec.ts:226`, `idempotency-removal.spec.ts:237`, `remove.spec.ts:97`, `foreign-edits.spec.ts:136`.

### Batch 1a verification

- Only the six listed files changed in harness-sync/shared (`git status --short`); Batch 1's four working-tree files byte-unchanged
- `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync,@ptah-extension/shared | tail -40` (no `--maxWorkers` on typecheck), then `npx nx run-many -t test -p @ptah-extension/harness-sync --maxWorkers=2 | tail -40`
- Spec cases 1-9 present with real assertions; A8 outcome reported with evidence
- Edge cases: copy unchanged ⇒ plain remove; read error ⇒ not removed; history write fails ⇒ not removed — each pinned
- Commit stages only the 1a files (`fix(harness-sync): ...`), local only, before Batch 1's commit

### Batch 1a result (team-leader, Mode 2, 2026-10-03)

- On disk: real `retireOwned` + `snapshotLocalEdit` in `workspace-target.ts`, optional `removedLocalEdit` on both types, copied through in `appliedTargetHealth` and the E22 row; spec cases 1-9 with real assertions. A8 holds (spec case 6).
- `typecheck,lint -p harness-sync,shared`: pass (one pre-existing max-lines warning in `workspace-target.ts`, already 703 > 700 at HEAD).
- Targeted run (retire-local-edit, agent-consent, idempotency-removal, remove, foreign-edits): 20 passed, 2 failed — both agent-consent failures are in the baseline list below.
- Baseline comparison: `npx nx run-many -t test -p @ptah-extension/harness-sync --maxWorkers=2 --skip-nx-cache` in the clean main checkout `D:\projects\ptah-extension` at `21c27d17f` (read-only) versus the worktree:
  - Base: 5 suites / 17 tests failed (448 total). Worktree: 6 suites / 18 tests failed (457 total; +9 are the new spec, all passing).
  - Failing test names diffed (`comm`): 17 identical in both — agent-consent (2), skill-consent (7), gitignore E23 (5), cancellation B8 (2), write-failure E21 (1).
  - Only in worktree: `capability-policy [C3] keeps only MCP writes and removals`. Re-ran that spec 4x in each checkout: base failed 3/4, worktree 4/4. Pre-existing flaky test, not caused by 1a.
  - Result: no failure introduced by Batch 1a. The pre-existing failures are outside this task; they are noted for the phase review, not fixed here.
- Committed `b5cc7ab43`, the six files only.

## Batch 1: F1 seed tightening + one-time foreign-slug quarantine — COMPLETE (5f52dfbc8)

- Depends on: Batch 1a (committed first, per user decision). Scope unchanged; Task 1.3's optional spec is superseded by Batch 1a Task 1a.3 (cases 2-3 pin A5).

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: cross-file change in a 2,135-line service with data-loss risk and two open questions (A4, A5) that need judgement mid-flight; not a narrow lane task.
- Tasks: 3 | Depends on: none | May run concurrently with Batch 2
- Projects: `@ptah-extension/agent-generation` (+ `@ptah-extension/harness-sync` only if Task 1.3 adds a spec)
- Files (max 5):
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-mirror.service.ts` (modify)
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.ts` (create; keeps the service from growing)
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-agent-scope.spec.ts` (modify)
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.spec.ts` (create)
  - `W\libs\backend\harness-sync\src\lib\targets\workspace-target.agent-retire.spec.ts` (create, only if Task 1.3 finds no existing coverage)

### Task 1.1: Restrict `seedLegacyAgents` to slugs this workspace owns — COMPLETE

- File: `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-mirror.service.ts`
- Plan reference: research-report.md "Findings 1" (vector 1), "Proposed surgical fixes" F1; context.md "User Decisions"; seed at `user-layer-mirror.service.ts:1806-1880`, call site `:341-344`.
- Pattern to follow: existing seed loop `:1852-1867` (copy `.md` + sidecar, warn-and-continue per slug); `isEnoent` handling in `mirrorAgents` (`:1890-1900`).
- Quality requirements: pass `sources.agentSourceDir` into the seed; read its `*.md` names once; copy a flat file only when its slug is in that set. Source absent/unreadable ⇒ seed nothing and log (R3). Rewrite the doc comment so it states the new rule and why (TASK_2026_609, cross-workspace leak), replacing the "copied in as a SEED ... all flat clones" wording, not appending to it.
- Validation notes: R1, R3; A3.
- Implementation details: signature becomes `seedLegacyAgents(workspaceRoot, scopedAgentsRoot, agentSourceDir)`; the guard "scoped dir already exists ⇒ return" stays; `.history` still never copied.

### Task 1.2: One-time quarantine of foreign seeded clones — COMPLETE

- Depends on: Task 1.1
- Files: `W\...\user-layer\user-layer-seed-quarantine.ts` (create), call wired in `user-layer-mirror.service.ts` `mirrorAll` between seed and `mirrorAgents`; spec `W\...\user-layer\user-layer-seed-quarantine.spec.ts` (create).
- Plan reference: context.md "User Decisions" (quarantine, never delete) and "Machine evidence"; research-report.md "Unknowns" first bullet.
- Pattern to follow: `user-layer-orphan-reaper.ts` (snapshot to root-level `.history/<slug>/<ts>/` FIRST, then remove clone + sidecar) and `UserLayerFsOps.snapshotFileToHistory` / `makeUniqueHistoryDir` (`user-layer-fs-ops.ts:177,263`).
- Quality requirements: criterion is (a) source dir read OK, (b) slug absent from source, (c) clone bytes equal the flat-base file of the same name. Move clone + sidecar into the scoped root's `.history/<slug>/<ts>/`, verify the snapshot exists, then remove. Never touch the flat base. Log one info line per run with quarantined / kept-with-local-work / kept-unprovable counts and slugs. One-time: marker file (dot-prefixed, non-`.md`) in the scoped root, written only after zero failures.
- Validation notes: R1, R2, R5, R6; A4 — before coding, determine why the existing reaper did not remove these clones (no sidecar, `orphaned: true`, or `reapDeletedUpstream` not on the propagate path) and report it; the criterion above must cover that case.
- Implementation details: pure classifier function (testable without fs) + an async apply step using `UserLayerFsOps`; run per slug under `withSlugLock('agent', slug)`.

### Task 1.3: Verify reconciler handling of the quarantined slugs' CLI copies — COMPLETE (finding: hand-edited copies were deleted; resolved by Batch 1a, pinned by its spec cases 2-3; no file of its own)

- Depends on: Task 1.2
- File: read-only `W\libs\backend\harness-sync\src\lib\targets\workspace-target.ts` (plan + apply, `:225-262`) and `W\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.service.ts`; optional spec `W\libs\backend\harness-sync\src\lib\targets\workspace-target.agent-retire.spec.ts`.
- Plan reference: research-report.md Evidence row "Rival agent targets are workspace-relative"; orchestrator prompt "reconciler-written CLI copies handled consistently".
- Pattern to follow: existing harness-sync target specs next to `workspace-target.ts`.
- Quality requirements: answer with `file:line`: when an agent slug leaves the desired state, (1) is an unmodified manifest-owned rival copy removed, (2) is a hand-edited one removed, kept-and-reported, or frozen? If an existing spec already pins (1) and (2), cite it and add nothing. If not, add the spec. NO change to harness-sync production code in this batch.
- Validation notes: R4, A5. If (2) is "removed", stop and report it; do not work around it.
- Implementation details: spec only; uses the real planner with a temp workspace.

### Batch 1 hold (team-leader, Mode 2, 2026-10-03)

Batch 1 stays IN_PROGRESS and uncommitted; no task is IMPLEMENTED. Tasks 1.1 and 1.2 are on disk and pass scoped checks, but neither part can ship alone without breaking the user's never-delete rule:

- R4 confirmed. `planRemovals` (`harness-sync/src/lib/targets/workspace-target.ts:580-598`) queues every manifest entry no longer desired and never compares its on-disk hash; drift is checked only for desired entries (`:523-530`). Executor probe: a hand-edited `.codex/agents/a2.toml` was removed.
- The seed fix alone (Task 1.1) reaches the same path. A missing agent dir gives an empty desired set (`harness-manifest.builder.ts:527-533`). So a workspace not yet scoped since TASK_2026_365, whose flat-era manifest owns all slugs, loses its foreign CLI copies on first open. A workspace with no `{ws}/.claude/agents` (R3) loses all of them. Hand-edited copies go too. Option (a), committing 1.1 and holding the quarantine wiring, does not keep the guarantee.
- The quarantine (Task 1.2) does the same for the leaked slugs in the four already-scoped workspaces.
- Next: a harness-sync guard batch, so a removal of a drifted agent copy keeps or snapshots it, must land before or with Batch 1. Its semantics need the user's choice; see the team-leader return.
- Resolved 2026-10-03: user chose snapshot-then-remove for every retirement path, Batch 1a first. Batch 1 stays IN_PROGRESS, uncommitted, until Batch 1a is committed.
- Released 2026-10-03 after `b5cc7ab43`: `typecheck,lint -p agent-generation` pass; `test -p agent-generation --maxWorkers=2 --skip-nx-cache` pass. Quarantine verified on disk (snapshot, byte-verify, sidecar-first remove, marker only on zero failures). Committed `5f52dfbc8`, the four user-layer files only.

### Batch 1 verification

- Every listed artifact exists and contains real logic (no TODO/stub, no log-only branches)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation[,@ptah-extension/harness-sync]` then `npx nx run-many -t test -p <same> --maxWorkers=2`, tailed
- Specs cover: owned-only seed; absent vs empty source; quarantine of byte-identical foreign clone (+ sidecar) into `.history/<slug>/<ts>/`; kept clone with local work; flat file missing; marker written only on a clean pass; second pass is a no-op
- Executor report answers A4 and A5 with `file:line`
- Edge cases above addressed

## Batch 2: F5 FileWriterService rejects relative paths — COMPLETE (381449fba)

- Recommended executor: CLI lane x 1 (Codex allowed), tool-call ceiling 25
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential (single task)
- Rationale: two files, one function, explicit spec; fits one self-contained lane prompt.
- Tasks: 1 | Depends on: none | May run concurrently with Batch 1
- Projects: `@ptah-extension/agent-generation`
- Files (exactly these; lane must not edit others):
  - `W\libs\backend\agent-generation\src\lib\services\file-writer.service.ts`
  - `W\libs\backend\agent-generation\src\lib\services\file-writer.service.spec.ts`

### Task 2.1: Reject non-absolute paths instead of resolving against `homedir()` — COMPLETE

- File: `W\libs\backend\agent-generation\src\lib\services\file-writer.service.ts` (`resolveAbsolutePath`, `:314-326`, and its callers in the same file)
- Plan reference: research-report.md Evidence row "FileWriterService resolves a RELATIVE path against homedir()", F5.
- Pattern to follow: the validation `Result.err(new FileWriteError(message, filePath, 'write'))` shape at `:303-310`.
- Quality requirements: use `path.isAbsolute`; non-absolute ⇒ `Result.err(FileWriteError)` with a message naming the path and that an absolute path is required; nothing written. Remove the `homedir` import if unused. Update the method doc comment.
- Validation notes: R7 — grep every caller of `writeAgent` / `writeAgentsBatch` / the service's public write methods across `W\libs` and `W\apps` and list them in the report with whether they pass absolute paths.
- Implementation details: spec cases: POSIX relative (`.claude/agents/x.md`) rejected and no write; drive-relative `C:foo` rejected on win32; absolute POSIX and Windows paths accepted; existing spec cases that relied on homedir resolution updated, not deleted.

### Batch 2 verification

- Both files changed, nothing else (`git status --short`)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation` then `npx nx run-many -t test -p @ptah-extension/agent-generation --maxWorkers=2`, tailed
- Caller list in the report

## Mode 1 refresh after #634 (team-leader, 2026-10-03)

- Tree: HEAD `165881e4a` on origin/main `f314a4f8a`. Of this file's remaining work, #634 touched `orchestrator.service.ts` (+spec), `file-settings-keys.ts` (+spec), `agent-rpc.handlers.ts`, `templates/agents/team-leader.template.md`, `content-manifest.json`, `sdk-query-options-builder.ts`. No remaining batch touches `sdk-query-options-builder.ts`.
- Re-checked on disk: `orchestrator.service.ts:1110-1111` still writes `model:` from `template.model` only; `:1113-1116` emits `disallowedTools` (#634); `buildAgentFileContent` at `:1071`, callers `:948`, `:1054`; workspace path is `options.workspacePath` (`:285`). `file-settings-keys.ts`: `FILE_BASED_SETTINGS_KEYS` at `:154` (`agentOrchestration.*Model` `:162-176`), `FILE_BASED_SETTINGS_DEFAULTS` at `:456`; `isFileBasedSettingKey` (`:746`) already routes every `workspace.*` key (`SCOPED_SETTING_PREFIX_PATTERN :740`), so only the machine key needs registering. `agent-rpc.handlers.ts`: list body is now `registerListCliModels :570-635` + `getCopilotModelsFromHost :637` + `getCodexModelsFromAuth :656` (plan's `:503-549` / `:510-539` are stale). Host wirings unchanged: electron `phase-2-libraries.ts:213-215`, vscode `:173-174`, cli-engine `container.ts:669-670`. `tooling-precedence.md` is 3 lines; guard spec `TOOLING` at `template-sharing.guard.spec.ts:994`; all 15 templates still reference the block (A1 holds). `npm run manifest:check` passes on the rebased tree (226 files).
- C6 CREATE files do not exist yet (`agent-models.types.ts`, `agent-model-settings.ts`, `cli-model-list.service.ts`, `agent-model-editor.component.ts`).
- The 3 settings registrations live in 3 libs (`platform-{vscode,electron,cli}/src/settings/*-settings-registration.ts`) and the 3 host wirings in 3 more projects, so the old B-5f (resolver + 6 host files + RPC) is split: B-5f1 (resolver, harness-sync), B-5f2 / B-5f3 / B-5f4 (one host each: platform registration + host wiring, 2 projects, parallel lanes), B-5g (RPC).
- Batch 3 is split: 3a (Task 3.1, key registration, no dependency, starts now) and 3b (Task 3.2 revised per C6, after B-5a + B-5b).
- Start now (file-disjoint, IN_PROGRESS): Batch 3a, Batch 4, B-5a, B-5c — libs platform-core / agent-generation / shared / rpc-handlers. rpc-handlers' scoped check compiles `shared`, so it may see B-5a's in-flight edits; a failure in a B-5a file is not B-5c's failure (same rule as Part A). Each commits alone after on-disk verification and green scoped checks; no per-batch review (policy unchanged).
- Update (team-leader, 2026-10-03): 3a `43a330406`, 4 `4071ff138`, B-5a `e7a347322` and B-5c `d28ce1337` are committed. B-5b and the new B-5c2 (rpc-handlers, disjoint from B-5b's settings-core) are IN_PROGRESS. B-5c2 must land before B-5g.
- Update (team-leader, 2026-10-03): B-5b `67cca83f8` and B-5c2 `8fffc0652` are committed. Batch 3b and B-5d are IN_PROGRESS. They are file-disjoint (agent-generation vs harness-sync) and both depend only on committed work.
- Scoped-check target note: `@ptah-extension/settings-core` has no `lint` target, so `-t lint` silently runs nothing there; its check is `-t typecheck,eslint:lint`. No remaining batch targets settings-core. Every project a remaining batch targets (agent-generation, harness-sync, platform-vscode/electron/cli, both apps, cli-engine, shared, rpc-handlers, skill-synthesis-ui) has a real `lint` target (verified with `nx show project`), so their `typecheck,lint` commands stand. Any batch that adds settings-core to its projects must use `eslint:lint` for it.
- Update (team-leader, 2026-10-03, end of session): 3b `3c2c52284` and B-5d `48877e550` are committed. Part A is complete (1a, 1, 2, 3a, 3b, 4); its phase code-logic review is due next. Nothing is IN_PROGRESS. Next runnable: the Part A phase review and B-5e (file-disjoint; the review is read-only, so both may run together).
- Run order from here: {3a, 4, B-5a, B-5c} → {B-5b, B-5c2} (after B-5a / B-5c) → {3b, B-5d} (after B-5b; B-5d after B-5a) → B-5e → B-5f1 → {B-5f2, B-5f3, B-5f4} (after B-5b + B-5f1) → B-5g (after B-5b + B-5c) → B-6 → B-7. Part A phase review runs after 3b and 4.

## Batch 3a: F2 register `agentGeneration.models` as a file-based key — COMPLETE (43a330406)

- Recommended executor: CLI lane x 1 (Codex allowed), tool-call ceiling 25
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: two files, one set entry (+ default if required) + spec assertions; no judgement.
- Tasks: 1 | Depends on: rebase (done) | Runs concurrently with Batch 4, B-5a, B-5c
- Projects: `@ptah-extension/platform-core`
- Files (exactly these):
  - `W\libs\backend\platform-core\src\file-settings-keys.ts`
  - `W\libs\backend\platform-core\src\file-settings-keys.spec.ts`

### Task 3.1: Register the `agentGeneration.models` file-based settings key — COMPLETE

- Plan reference: implementation-plan.md C6 (machine key + per-workspace override); research-report.md "Findings 2".
- Pattern to follow: `agentOrchestration.*Model` entries (`file-settings-keys.ts:162-176`) and their defaults (`:464-478`); the spec's membership assertions.
- Quality requirements: add `'agentGeneration.models'` to `FILE_BASED_SETTINGS_KEYS`; add a `{}` default to `FILE_BASED_SETTINGS_DEFAULTS` only if the spec or the neighbouring keys require every key to have one. Comment documents the C6 value shape (supersedes the old "Claude only" note): `{ "<agent-slug>" | "*": { claude?, codex?, copilot?, cursor?, opencode?: string } }`, machine scope here, per-workspace override under `workspace.<hash>.agentGeneration.models` (already routed by `SCOPED_SETTING_PREFIX_PATTERN`, `:740`).
- Validation notes: A2. Spec asserts `isFileBasedSettingKey` is true for `agentGeneration.models` and for `workspace.<somehash>.agentGeneration.models`.

### Batch 3a verification

- Only the two files changed (`git diff --name-only`)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/platform-core` then `npx nx run-many -t test -p @ptah-extension/platform-core --maxWorkers=2`, tailed

### Batch 3a result (team-leader, Mode 2, 2026-10-03)

- Diff read: `'agentGeneration.models'` added to `FILE_BASED_SETTINGS_KEYS` beside the `agentOrchestration.*Model` keys, with a comment giving the C6 shape, machine scope and the `workspace.<hash>.agentGeneration.models` override routed by `SCOPED_SETTING_PREFIX_PATTERN`. Spec `it.each` asserts `isFileBasedSettingKey` is true for both keys. No default added: the defaults-alignment spec requires defaults to be registered keys, not the reverse. Accepted.
- Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p platform-core` pass; `test -p platform-core --maxWorkers=2` 46/46 suites, 1028 passed, 4 todo.
- Review: none per batch (Part A policy); covered by the Part A phase review.
- Committed `43a330406`, the two files only.

## Batch 3b: F2 Claude model override in `buildAgentFileContent` (revised per C6) — COMPLETE (3c2c52284)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane x 1, ceiling 35
- Execution mode: sequential
- Rationale: new optional injected dependency in `OrchestratorService`, merged with #634's `disallowedTools` emission; judgement required.
- Tasks: 1 | Depends on: Batch 3a, B-5a, B-5b (`resolveAgentModel`, `AgentModelSettings.layersForPath`, `SETTINGS_TOKENS.AGENT_MODEL_SETTINGS`)
- Projects: `@ptah-extension/agent-generation`
- Files (exactly these):
  - `W\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
  - `W\libs\backend\agent-generation\src\lib\services\orchestrator.service.spec.ts`

### Task 3.2: Apply the Claude override from `AgentModelSettings` — COMPLETE

- Plan reference: implementation-plan.md C6 "Claude: F2 reads `AgentModelSettings.layersForPath(ws)` + `resolveAgentModel`"; `orchestrator.service.ts:1110-1111` (rebased).
- Pattern to follow: optional injection `@inject(TOKEN, { isOptional: true })` (`skills-synthesis-rpc.handlers.ts:335-349`); agent-generation already imports `@ptah-extension/settings-core` (`content-generation.service.ts`).
- Quality requirements: inject `SETTINGS_TOKENS.AGENT_MODEL_SETTINGS` optionally; read `layersForPath(options.workspacePath)` ONCE per generation run; per agent `resolveAgentModel(layers, template.name, 'claude')?.value` (returns `{ value, scope, wildcard } | undefined` since B-5a `e7a347322`; ws[slug] → ws['*'] → machine[slug] → machine['*']); use the value only when `isAgentModelEmittable('claude', v)` and `matchesAgentModelSyntax('claude', v)` (shared, `opus|sonnet|haiku|inherit`) accept it. Shared classification does not trim; if this batch trims before the syntax check it must emit the trimmed value, never the raw one; otherwise `logger.warn` + `template.model` (R8). Token absent, read throws, or malformed object ⇒ `template.model`, no throw. Both callers (`:948`, `:1054`) get the same value. `disallowedTools` line unchanged, still after `model:`.
- Spec cases: ws per-agent; ws `*`; machine fallback when ws empty; ws beats machine; invalid value → template; token absent → template; template without model + override → `model:` emitted; `disallowedTools` still present.

### Batch 3b verification

- Only the two files changed
- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation` then `-t test ... --maxWorkers=2`, tailed

### Batch 3b result (team-leader, Mode 2, 2026-10-03)

- Diff read: `SETTINGS_TOKENS.AGENT_MODEL_SETTINGS` injected optionally (last ctor arg). `readAgentModelLayers(options.workspacePath)` runs once per run before the agent loop; token absent ⇒ `null`, a throwing read ⇒ warn + `null`, never throws. `resolveClaudeModel` takes `resolveAgentModel(layers, template.name, 'claude')?.value`, trims it, and emits the TRIMMED value only when `isAgentModelEmittable` and `matchesAgentModelSyntax` both accept it; otherwise warns (value JSON-quoted) and returns the trimmed template model. Both callers (generated path and authored fallback) get the same resolved `model`. `buildAgentFileContent` emits `model:` from the argument; the `disallowedTools` line is unchanged and still follows `model:`. R8 held, including newline injection (`opus\nevil: true` spec).
- Spec: all 8 required cases plus trim, invalid-without-template-model, Codex-only value ignored, throwing read, 5 malformed shapes, authored-fallback path, and one read for two agents. #634 cases unchanged.
- Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p agent-generation` pass; `test -p agent-generation --maxWorkers=2` 36/36 suites, 1240 passed, 1 skipped (1219 + 21 new).
- Review: none per batch; covered by the Part A phase review. Committed `3c2c52284`, the two files only.

## Batch 4: F4 compact tooling table in the shared block + manifest — COMPLETE (4071ff138)

- Precondition met: #634 merged, branch rebased, `manifest:check` green on `165881e4a`.
- Recommended executor: CLI lane x 1 (Codex allowed), tool-call ceiling 30
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: one markdown file, one guard spec, one generated file; no template edits (A1 re-verified).
- Tasks: 2 | Depends on: rebase (done) | Runs concurrently with Batch 3a, B-5a, B-5c (agent-generation is touched by no other running batch)
- Projects: `@ptah-extension/agent-generation`
- Files (exactly these):
  - `W\libs\backend\agent-generation\templates\agents\_shared\tooling-precedence.md`
  - `W\libs\backend\agent-generation\src\lib\services\template-sharing.guard.spec.ts`
  - `W\content-manifest.json` (generated only, via the script)

### Task 4.1: Expand `TOOLING_PRECEDENCE` into a compact substitution table — COMPLETE

- Plan reference: research-report.md "Findings 4" option A, F4.
- Pattern to follow: keep the `## Working rules` heading and the existing first bullet's rules; row source: `PTAH_MCP_SUBSTITUTION_SECTION` (`libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`) and `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/server-instructions.ts`.
- Quality requirements: table of 8 rows (workspace_analyze, search_files, code_search_symbols, ast_analyze, lsp_references, get_diagnostics, memory_search, relevance_rank_files: native step -> ptah tool) plus one line "write, build, test and git stay native". Whole block <= 300 tokens (`ptah_count_tokens` if listed, else chars/4; report the number). No template edits.
- Validation notes: R9. Guard spec (`TOOLING` at `:994`): add one assertion that every `ptah_*` name in the block appears in the substitution source; any existing text assertion it breaks is updated with a one-line reason.

### Task 4.2: Regenerate the content manifest — COMPLETE

- Depends on: Task 4.1
- File: `W\content-manifest.json`
- Quality requirements: `npm run manifest:generate` then `npm run manifest:check` passes; only generated fields change; no hand edits.
- Validation notes: R10; A6 (dogfood `.claude/agents` not refreshed).

### Batch 4 verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation` then `-t test -p @ptah-extension/agent-generation --maxWorkers=2`, tailed (guard spec included)
- `npm run manifest:check` passes
- Only the three listed files changed

### Batch 4 result (team-leader, Mode 2, 2026-10-03)

- Diff read: `## Working rules` heading and the first bullet unchanged; an 8-row native-step → ptah-tool table (workspace_analyze, search_files, code_search_symbols, ast_analyze, lsp_references, get_diagnostics, memory_search, relevance_rank_files) plus "write, build, test and git stay native". 735 chars ≈ 184 tokens (lane: `ptah_count_tokens` 184), under the 300 limit. The guard spec asserts that every concrete `ptah_*` name in the block appears in `PTAH_MCP_SUBSTITUTION_SECTION`; it reads that section as text. No existing assertion edited (R9).
- Templates: `git diff --name-only -- libs/backend/agent-generation/templates` lists only `_shared/tooling-precedence.md`; all 15 `*.template.md` untouched (A1).
- Manifest (R10): only `contentHash` and `generatedAt` changed (script output); `npm run manifest:check` → up to date, `sha256:6a9c3b40…1024`, 226 files.
- The lane's typecheck failure (TS4111 in B-5a's in-flight `agent-models.types.ts`) was not this batch's, and the B-5a fix round resolved it. Team-leader re-run (`--skip-nx-cache`): `typecheck,lint -p agent-generation` pass; `test -p agent-generation --maxWorkers=2` 36/36 suites, 1219 passed, 1 skipped.
- Review: none per batch (Part A policy); covered by the Part A phase review.
- Committed `4071ff138`, the three files only.

## Phase review (after Batches 3b and 4) — CHANGES REQUIRED (4/10), fix round A-FIX IN_PROGRESS

- Part A is complete (post-rebase SHAs, verified with `git log` by the orchestrator): 1a `ba965aa1c`, 1 `c2c4f9951`, 2 `62f1ad576`, 3a `43a330406`, 4 `4071ff138`, 3b `3c2c52284`. (Pre-rebase 1a `b5cc7ab43`, 1 `5f52dfbc8`, 2 `381449fba` no longer exist on the branch.)
- One code-logic-reviewer pass on the combined Part A diff. Part B commits are interleaved on the branch, so the reviewer reviews these six commits (`git show <sha>` each, or `git diff origin/main...HEAD -- <the Part A file lists above>`), not the whole branch range. Checklist: risks R1-R13 and assumptions A3-A8. Output: `code-logic-review.md` in the task folder; then re-invoke team-leader (Mode 2 step 6) with its path and verdict. At most one fix round. It gates push/PR; user approval is still required before push.

### Phase review verdict (team-leader, Mode 2 step 6, 2026-10-03)

- Review: `code-logic-review.md` (Codex CLI lane, cross-side). Verdict CHANGES REQUIRED, 4/10, REVISE. 2 Blocking, 1 Serious, 0 Moderate. All three verified against the code; none rejected:
  - F1 Blocking, CONFIRMED. `retireOwned` (`workspace-target.ts:906-919`) treats `hashArtifact === owned.hash` as "unchanged" and calls `removeManaged` (recursive delete, `copy-engine.ts:235`). `hashDir` → `listContentFiles` (`content-hash.ts:158-200`) skips `IGNORED_ENTRY_NAMES` (`:89-94`: `.ptah-origin.json`, `.history`, `_candidates`, quarantine dir), symlinks (`classifyEntry` `'skip'`), anything below `MAX_DEPTH` 20 (`:165`), and silently treats an unreadable subdirectory as empty (`:170-172`). Bytes in any of those are deleted unarchived.
  - F2 Blocking, CONFIRMED. Harness: `snapshotLocalEdit` (`workspace-target.ts:1154-1188`) copies and re-hashes the SNAPSHOT only; `retireOwned` then deletes the live path (`:932`) with no identity check, and an unchanged copy has an await gap between `hashArtifact` (`:908`) and `removeManaged`. Quarantine: `moveToHistory` (`user-layer-seed-quarantine.ts:458-494`) verifies the snapshot against `cloneBytes` read earlier (`:426`), then `await removePath(sidecar)` and `removePath(clone)` (`:492-493`); the slug lock does not stop an editor save.
  - F3 Serious, CONFIRMED. `run` (`:344-412`) builds a fresh per-pass result; `writeMarker` (`:496-526`) writes only that pass's lists, and only when `failed` is empty (`:395`). A retry after EBUSY lists only the remaining clones, so earlier moves vanish from the record that `listQuarantined` (`:547`) and `restoreUnderLock` (`:606`) read. The marker check (`:359`) and write (`:396`) are outside any pass-wide lock, so two overlapping passes overwrite each other.
- Fix round (the one allowed): F1 + F2 + F3 in A-FIX-1 (harness-sync) and A-FIX-2 (agent-generation). Moderate/Minor: none raised.
- Design adjustments to the orchestrator's direction (code-driven, recorded):
  1. Harness "unchanged" test after detach = `hashDir(staged) === owned.hash` AND an exhaustive coverage walk of the staged tree finds nothing `hashDir` skips: no ignored-name entry, no symlink, no non-file/non-dir node, no unreadable directory, no depth beyond `MAX_DEPTH`. The orchestrator's "no entries in the hash-ignore set" alone misses symlinks, depth and unreadable subdirectories, which `hashDir` also skips.
  2. Harness staging location = the final snapshot location (`{ws}/.ptah/harness/.history/<slug>/<ts>/<relPath>`), so an edited copy needs no second move. Consequence: when the history store is unwritable, NO retirement proceeds, unchanged copies included (all `writeFailed`, all retried). Batch 1a spec case 5's "unchanged copies in the same pass still removed" assertion is updated to that, with a one-line reason. Conservative; no bytes at risk.
  3. Quarantine F3: a SEPARATE journal file (`.ptah-seed-quarantine.journal.json`, dot-prefixed, not `*.md`), merged per verified move; the completion marker keeps its exact v1 shape and is still written only after a clean pass, as the union of journal + this pass. Readers `listQuarantined` / `restoreUnderLock` / `readValidatedMarker` / `validateSeedQuarantineMarker` stay byte-for-byte unchanged, and the existing "no marker after a partial failure" assertions (`user-layer-seed-quarantine.spec.ts:374`, `:501`) keep their meaning. Putting the journal into the marker itself would make the marker exist after a partial pass, which `run`'s one-time check (`:359`) reads as "done".
- Related, NOT in this fix round (Part B, recorded for the B-7 combined review): `snapshotBeforeOverwrite` (`workspace-target.ts:1197-1218`, B-1 `9d31e981d`) has the same copy→verify→act shape on the overwrite path (a save after its snapshot is overwritten). A-FIX-1 moves its helper but keeps its semantics.

## Batch A-FIX-1: harness-sync — detach-then-decide retirement (F1, F2) — COMPLETE (841263730)

Result (team-leader, Mode 2, 2026-10-04):

- I verified the diff on disk. `artifact-retirement.ts` `retireOwnedArtifact` follows the rules in order:
  - It runs `lstat` first.
  - It detaches by `rename` under `withWindowsRetry` (`:149-162`) before it decides anything.
  - It decides on the staged object (`:167`, `isProvablyUnchanged`). Before treating a directory as unchanged, it compares the hash and runs the full `isFullyHashable` walk (`:214-234`), which rejects ignored names at any depth, symlinks and junctions, other nodes, unreadable dirs and anything deeper than `MAX_DEPTH`.
  - It never touches the original path after the rename.
  - A failed rename returns `failed`, which maps to `writeFailed` and keeps the manifest entry. Only empty dirs are pruned in that case, and there is no copy+delete fallback.
- `workspace-target.ts` went from 1293 to 1156 lines. `retireOwned` is now a delegation, the moved helpers are deleted, and `snapshotBeforeOverwrite`'s semantics are unchanged. `content-hash.ts` change: only the `MAX_DEPTH` export.
- Executor deviations, all accepted:
  - It uses `degradation-audit` comments instead of a logger, because there is no logger in `targets/`.
  - Case 12 uses a path-filtered `jest.spyOn` on real `fs/promises` rather than a production test option.
  - The new reason prefix `could not detach for removal: <CODE>` is fine.
  - The F2 race cases are unit-only, because the reconciler has no hook seam.
- Checks:
  - typecheck and lint pass.
  - The full test run has 18 failures: the 17 baseline failures (agent-consent 2, skill-consent 7, E23 5, B8 2, E21 1) plus the flaky C3.
  - capability-policy, artifact-retirement and retire-local-edit pass on their own: 40/40.
- Noted for the A-FIX re-review, not defects of this batch:
  - `lstatOrNull` returns null on a non-ENOENT error (such as EACCES), and that still routes to `removeManaged` as it did in Part A.
  - `snapshotBeforeOverwrite` has the copy-verify-act race, which is recorded for B-7.

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: data-loss protocol change on the one retirement path every target shares, with a facade extraction out of a ~1,290-line file and Windows rename semantics to judge; not a lane task.
- Tasks: 3 | Depends on: none | Runs concurrently with A-FIX-2 (different lib) and with the B-5f1 Codex lane (same lib, disjoint files)
- Phase: Part A | Phase review: code-logic re-review scoped to the A-FIX-1 + A-FIX-2 commits (the one re-review)
- Projects: `@ptah-extension/harness-sync`
- Files (exactly these; do not edit any other file):
  - `W\libs\backend\harness-sync\src\lib\targets\artifact-retirement.ts` (create)
  - `W\libs\backend\harness-sync\src\lib\targets\artifact-retirement.spec.ts` (create)
  - `W\libs\backend\harness-sync\src\lib\targets\workspace-target.ts` (modify: `retireOwned` `:878-941` becomes a delegation; move `LOCAL_EDIT_HISTORY_DIR`, `MAX_SNAPSHOT_SUFFIX`, `hashArtifact`, `snapshotLocalEdit`, `historySlug`, `createUniqueDir` `:1125-1238` into the new file; `snapshotBeforeOverwrite` stays and imports them. Net line count must go DOWN.)
  - `W\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.retire-local-edit.spec.ts` (modify: case 5 assertion + new cases 10-12)
  - `W\libs\backend\harness-sync\src\lib\hash\content-hash.ts` (modify ONLY to export `MAX_DEPTH` if the coverage walk needs it; no change to ignore semantics or to `hashDir`/`listContentFiles` behaviour — the review says not to alter source-discovery rules)
- Must NOT touch (B-5f1 Codex lane in flight): `plugin-config-source-resolver.ts` (+spec), `di/register.ts`, `targets/rival-targets.agent-model.spec.ts`. A scoped-check failure in one of those files is B-5f1's, not this batch's.

### Task A-FIX-1.1: `artifact-retirement.ts` — detach, then decide on the detached object — COMPLETE

- File: `W\libs\backend\harness-sync\src\lib\targets\artifact-retirement.ts`
- Plan reference: code-logic-review.md Findings 1-2 "Suggested fix"; this section's design adjustments 1-2; batches.md Batch 1a Task 1a.2 (the rule being replaced).
- Pattern to follow: `snapshotLocalEdit` / `createUniqueDir` (`workspace-target.ts:1154-1238`) for the unique `<ts>` dir; `withWindowsRetry`, `removeManaged` (`copy-engine.ts:235`); `lstatSyncOrNull` (`workspace-target.ts:1240`); `listContentFiles` + `classifyEntry` (`content-hash.ts:158-230`) as the walk to mirror, NOT to reuse (it filters).
- Quality requirements — one exported function, e.g. `retireOwnedArtifact({ workspaceRoot, relPath, isDirectory, ownedHash }): Promise<RetirementOutcome>` where the outcome is `removed` | `removed-local-edit` (with the snapshot path) | `failed` (with the reason). Rules, in order:
  1. `lstat` the path. Absent ⇒ `removed` (ENOENT tolerated, current behaviour). Symlink ⇒ unlink only, never followed, never snapshotted (current behaviour).
  2. Kind mismatch (a directory where a file was recorded or the reverse) ⇒ `failed`, `cannot read to check for local edits: ...` (keeps the "unknown is not unchanged" rule and spec case 4's reason text).
  3. Create `{ws}/.ptah/harness/.history/<slug>/` (recursive) and a unique `<ts>` dir (non-recursive mkdir, `-N` suffix on EEXIST), then the parent dirs of `<ts>/<relPath>`. Any failure ⇒ `failed`, `could not save local edit before removal: ...`; the original is untouched.
  4. DETACH: `rename(original, staged)` under `withWindowsRetry`. Failure (EXDEV, EBUSY, EPERM, EACCES, anything) ⇒ `failed` with the code in the reason; best-effort remove the empty `<ts>` dir; the original is untouched. ENOENT here (vanished since step 1) ⇒ `removed`, empty `<ts>` dir removed. Never fall back to copy+delete.
  5. From here on, NEVER touch the original path again: whatever occupies it after the rename is a new object (a save) and stays.
  6. Decide on the STAGED object: unchanged ⇔ `ownedHash !== undefined` AND hash of the staged object equals `ownedHash` AND (files) it is a regular file / (dirs) an exhaustive coverage walk of the staged tree finds no entry `hashDir` would skip: an `IGNORED_ENTRY_NAMES` name at any depth, a symlink, a non-file/non-dir node, a directory that cannot be read, or depth beyond `MAX_DEPTH`. Any doubt (hash `null`, walk error) ⇒ treat as edited.
  7. Unchanged ⇒ remove the staged `<ts>` dir recursively, then best-effort `rmdir` (non-recursive, ENOTEMPTY/ENOENT ignored) of `.history/<slug>` and `.history`, so an unchanged retirement leaves no history (Batch 1a case 1 stays green). Return `removed`. A failure to delete the staged copy is logged-and-ignored, never `failed`: the artifact is already gone from the target dir and the leftover copy is harmless.
  8. Edited or unprovable ⇒ keep the staged copy as the snapshot; return `removed-local-edit`.
- Doc comment states the rule, why (detach-first: the decision is made on bytes no other writer can reach; filtered hash ≠ deletion proof), cites TASK_2026_609 and the review. Replace the old 1a doc comment on `retireOwned`, do not append.
- Validation notes: R4, R11, R13 (history still outside every target dir); review F1, F2. The manifest-retry contract is unchanged: `failed` ⇒ `writeFailed`, entry kept (`harness-reconciler.service.ts:313-318`, `:652`).

### Task A-FIX-1.2: Wire `workspace-target.ts` to the collaborator — COMPLETE

- Depends on: Task A-FIX-1.1
- File: `W\libs\backend\harness-sync\src\lib\targets\workspace-target.ts`
- Quality requirements: `retireOwned` (`:878-941`) maps the outcome to `result.removed` / `removedLocalEdit` / `result.writeFailed` exactly as today (an edited removal is in BOTH `removed` and `removedLocalEdit`). The moved helpers are deleted from this file (no duplicate copies); `snapshotBeforeOverwrite` imports `snapshotLocalEdit` / `hashArtifact` from the new file and keeps its current semantics (Part B; see "Related, NOT in this fix round"). No change to `planRemovals`, MCP removals, or `applyWrite`. File gets shorter.

### Task A-FIX-1.3: Regression specs — COMPLETE

- Depends on: Task A-FIX-1.2
- Files: `artifact-retirement.spec.ts` (create; unit, temp dirs), `harness-reconciler.retire-local-edit.spec.ts` (modify)
- Cases (real fs, temp workspace; fs mocks only where an interleaving cannot be made deterministic otherwise — inject via a seam the module exposes for tests, e.g. an optional `afterDetach`/`beforeDecide` hook or an injectable `rename`, not jest.mock of `fs`):
  - F1: owned rival skill dir whose SKILL.md is unchanged but which contains `.history/notes.md` (unique bytes) ⇒ retirement reports `removedLocalEdit`, and `.ptah/harness/.history/<slug>/<ts>/<relPath>/.history/notes.md` holds those bytes. Same for a `_candidates/` entry and a symlink inside the dir (link preserved as a link or reported; never followed).
  - F2 harness: a save injected AFTER the hash/decision point (hook fires after detach): the new bytes at the original path survive untouched; the detached copy is handled per its own content. And a save injected BEFORE detach is the object that gets detached (preserved if it differs from the manifest hash).
  - Rename failure (injected EBUSY/EXDEV) ⇒ not removed, `writeFailed`, manifest entry kept, no `<ts>` dir left behind; next pass retires it.
  - Unchanged agent file and unchanged skill dir ⇒ removed, NO `.ptah/harness/.history` left (cases 1 and 6 stay green unchanged).
  - Case 5 (history store is a FILE) updated: every owned copy, unchanged included, is `writeFailed` and kept; reason comment cites adjustment 2.
  - Cases 1-4, 6-9 stay green unchanged; also `agent-consent.spec.ts:226`, `idempotency-removal.spec.ts:237`, `remove.spec.ts:97`, `foreign-edits.spec.ts:136`.

### Batch A-FIX-1 verification

- `git status --short` / `git diff --name-only`: only the files above (B-5f1's files are excluded from staging even if modified)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync | tail -40` (no `--maxWorkers` on typecheck), then `npx nx run-many -t test -p @ptah-extension/harness-sync --maxWorkers=2 | tail -40`
- Failures compared with the Batch 1a baseline list (17 pre-existing: agent-consent 2, skill-consent 7, gitignore E23 5, cancellation B8 2, write-failure E21 1; capability-policy C3 flaky); any failure outside that list blocks
- `workspace-target.ts` line count lower than before the batch; no TODO/stub; no copy+delete fallback anywhere in retirement
- Commit (team-leader): `fix(harness-sync): ...`, A-FIX-1 files only, local

## Batch A-FIX-2: agent-generation — rename-detach quarantine + cumulative journal + pass lock (F2, F3) — COMPLETE (dc2e2b3fd)

Result (team-leader, Mode 2, 2026-10-04):

- Diff verified on disk (report: `afix2-executor-report.md`).
- F2 confirmed. `detachToHistory` creates a `<ts>` dir via `makeUniqueHistoryDir`, then renames the sidecar and then the clone into it through the `renamePath` seam (production default: `fs/promises.rename`). `stagedMatches` compares the detached bytes with `cloneBytes`; if they cannot be read, they count as different. There is no `removePath` or `unlink` at the live paths. On a mismatch or a failed journal write, `undoDetach` uses `placeExclusive` (link or `COPYFILE_EXCL`) and never overwrites; a taken path leaves the file in history with a warning naming `historyFile`. A failed rename puts the sidecar back and runs a non-recursive `rmdir` on `<ts>`.
- F3 confirmed. `SeedQuarantineJournal.recordMove` runs after each verified move, and a write failure there undoes the detach (outcome `failed`). The marker is written only when `failed` is empty, as `mergeSeedQuarantineLists(journal.lists, result)` in the exact v1 shape. `SeedQuarantinePassLock` keys on `resolve(scopedAgentsRoot)` and wraps `runPass` from the marker check to the marker write; its gate only resolves, so a rejected pass still releases the lock. An absent journal is treated as empty; an unreadable or malformed one makes `open` return `null`, and the pass returns `ran: false` with no moves.
- Unchanged: the readers (`listQuarantined`, `restore*`, `readValidatedMarker`, `selectSnapshot`, `validateSeedQuarantineMarker`) have no diff hunks. `isSafeAgentSlug` moved to the journal module to avoid an import cycle and is re-exported, with an identical body. `user-layer-mirror.service.ts` is not modified.
- Spec changes are justified. Both re-wired cases spied on `snapshotFileToHistory`, which the new protocol no longer calls. In the EBUSY case, every original assertion is kept and the F3 cumulative, `listQuarantined` and `restore` checks are added. "Snapshot does not hold bytes" is replaced by the F2 save-before-detach case, with the same guarantee and still `failed: ['video-director']`. Ten new cases cover the batch list.
- Checks: `typecheck,lint -p @ptah-extension/agent-generation` passed. `test --maxWorkers=2`: 36/36 suites, 1248 passed, 1 skipped (POSIX chmod).
- Orchestrator decision, recorded: `user-layer-seed-quarantine.ts` has 801 code lines, which trips only the 700-line `max-lines` WARNING. Accepted as is: 700 is a soft ceiling and over 1000 needs a deliberate look. No fourth file. Minor; not tracked as a follow-up.
- Notes for the A-FIX re-review, not defects:
  - The journal kept lists accumulate across passes. A slug quarantined earlier and later kept under the same name can appear in two lists; `validateSeedQuarantineMarker` tolerates that.
  - Residual risk: a crash between the rename and the journal write leaves the bytes in history but unrecorded. This was accepted in the batch plan and is documented in the module header.
- Committed `dc2e2b3fd`, the three files only.

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer re-run with the failing task only
- Execution mode: sequential
- Rationale: ordering and crash/rollback semantics around a durable record that Part B's Restore reads; judgement-heavy, one tightly coupled module.
- Tasks: 3 | Depends on: none | Runs concurrently with A-FIX-1 (different lib, agent-generation never imports harness-sync)
- Phase: Part A | Phase review: code-logic re-review scoped to the A-FIX-1 + A-FIX-2 commits
- Projects: `@ptah-extension/agent-generation`
- Files (exactly these):
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine-journal.ts` (create: journal read/merge/write + per-scoped-root pass lock; keeps the 917-line quarantine file from growing)
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.ts` (modify: `run` `:344-412`, `handleSlug` `:418-450`, `moveToHistory` `:458-494`, `writeMarker` `:496-526`; readers untouched)
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.spec.ts` (modify: add cases; existing cases stay green)
- Must NOT change: `listQuarantined` (`:534-577`), `restore`/`restoreUnderLock` (`:588-653`), `readValidatedMarker` (`:759-797`), `selectSnapshot`, `validateSeedQuarantineMarker`, the marker's v1 shape and name, `user-layer-mirror.service.ts`, and every Part B consumer (`rpc-handlers` `skills-synthesis-rpc.*`).

### Task A-FIX-2.1: Detach-by-rename in `moveToHistory` (F2) — COMPLETE

- File: `user-layer-seed-quarantine.ts`
- Pattern to follow: `UserLayerFsOps.makeUniqueHistoryDir` (`user-layer-fs-ops.ts:177`) for `.history/<slug>/<ts>/` (keeps the `<ms>[-<n>]` names `orderQuarantineSnapshotCandidates` parses); `placeExclusive` (`user-layer-seed-quarantine.ts:846`) for a no-clobber put-back.
- Quality requirements, in order, under the existing slug lock:
  1. Make the unique `<ts>` dir.
  2. Sidecar present ⇒ `rename` it into `<ts>/`. Then `rename` the clone into `<ts>/<slug>.md`. No copy, no `removePath` of the live paths.
  3. Read the DETACHED clone and compare with the `cloneBytes` that were classified. Equal ⇒ moved (go to journal, Task 2.2). Different (a save landed between classification and rename) ⇒ this is user work, not a proven seed clone: put clone (and sidecar) back with no-clobber; if the original path is now occupied, leave the detached file in `<ts>/`, log a warning naming its path; outcome `failed` (not journaled, no completion this pass).
  4. Clone rename fails (EBUSY/EPERM/…) ⇒ put the sidecar back no-clobber (best effort), remove the empty `<ts>` dir, outcome `failed`. The original clone is untouched.
  5. Never unlink anything at the original paths after step 2.
- Doc comment replaces the copy-verify-remove text; cites TASK_2026_609 review F2.

### Task A-FIX-2.2: Cumulative journal + pass lock (F3) — COMPLETE

- Depends on: Task A-FIX-2.1
- Files: `user-layer-seed-quarantine-journal.ts` (create), `user-layer-seed-quarantine.ts`
- Quality requirements:
  - Journal file `.ptah-seed-quarantine.journal.json` in the scoped root (dot-prefixed, not `*.md`, so `listMarkdownFiles`/reaper/source resolver never read it), written with `writeTextAtomic`. Content: `{ version: 1, quarantined: string[], keptWithLocalWork: string[], keptUnprovable: string[] }`, slugs validated with `isSafeAgentSlug` on read.
  - After each verified move (Task 2.1 step 3), read-merge-write the journal adding the slug (union; a slug moved now is removed from the kept lists). Journal write fails ⇒ put the clone + sidecar back no-clobber so the next pass retries it, outcome `failed`; if the put-back is impossible, log an error naming the history path (bytes remain in `.history`).
  - Kept outcomes are merged into the journal too (union), so the final record is cumulative.
  - Existing journal unreadable or malformed ⇒ the pass moves NOTHING (warn, `ran: false`): a move whose record cannot be merged is the bug being fixed. Absent ⇒ empty.
  - Completion: only when this pass has zero failures, write the v1 marker (`version`, `completedAt` = now, the three lists) as the UNION of the journal and this pass — same shape `validateSeedQuarantineMarker` accepts. Marker write failure ⇒ as today (no completion, retried; the journal still holds every move).
  - Pass lock: an in-process promise chain keyed by `resolve(scopedAgentsRoot)`, held by the `UserLayerSeedQuarantine` instance (one per `UserLayerMirrorService`, `user-layer-mirror.service.ts:290`), around the WHOLE pass from the marker check (`:359`) to the marker write. The marker check happens INSIDE the lock, so the second of two overlapping passes sees the first's marker and no-ops. A rejected pass releases the lock.
- Residual risk recorded (accepted, disclose in report): a process exit between the clone rename and the journal write leaves that clone's bytes in `.history/<slug>/<ts>/` but not in the record. Window is one `writeTextAtomic`; bytes are never lost.
- Validation notes: R2, R5, R6; review F3. Readers stay unchanged (see "Must NOT change").

### Task A-FIX-2.3: Regression specs — COMPLETE

- Depends on: Task A-FIX-2.2
- File: `user-layer-seed-quarantine.spec.ts`
- Cases (real temp fs; injected failures via the `UserLayerFsOps` instance or an explicit seam, not jest.mock of `fs`):
  - F2: a save injected between classification and detach ⇒ the saved bytes are not lost (back at the original path, or preserved in `.history` with a warning) and the slug is NOT recorded as quarantined. A save injected after detach (new file at the original path) ⇒ the new file survives untouched, the detached seed is recorded.
  - Clone rename fails (EBUSY) ⇒ clone and sidecar remain at the original paths, no empty `<ts>` dir, outcome `failed`, no marker.
  - F3 success + EBUSY + retry: video-director moves, figma-designer EBUSY; retry succeeds ⇒ marker `quarantined` contains BOTH; `listQuarantined` lists both and `restore` accepts both.
  - Journal write failure after a move ⇒ clone back in place, `failed`, no marker; next pass moves and records it.
  - Interrupted pass (journal present from a prior pass, marker absent) ⇒ next clean pass's marker contains the journal's slugs.
  - Two concurrent `run` calls on one scoped root (`Promise.all`) ⇒ every moved slug in the final marker; the second pass moves nothing.
  - Malformed journal ⇒ no move, no marker, warning.
  - Existing assertions stay unchanged (`:374`, `:384`, `:391`, `:501`, `:750-765`, the `validateSeedQuarantineMarker` block `:614`).

### Batch A-FIX-2 verification

- Only the three files above changed (`git diff --name-only`)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation | tail -40`, then `npx nx run-many -t test -p @ptah-extension/agent-generation --maxWorkers=2 | tail -40` (baseline: 36/36 suites green at `3c2c52284`; any failure blocks)
- `user-layer-seed-quarantine.ts` does not grow by more than the delegation it needs; readers byte-identical (`git diff` shows no hunk in `listQuarantined`/`restore*`/`readValidatedMarker`/`selectSnapshot`)
- Commit (team-leader): `fix(agent-generation): ...`, A-FIX-2 files only, local

### A-FIX re-review (the one re-review)

- After both A-FIX commits: one code-logic re-review (cross-side lane, as before) scoped to the A-FIX-1 and A-FIX-2 commits only, checking F1-F3 and the regression cases above. No further fix round (user rule): anything it raises beyond F1-F3 regressions is recorded as a named follow-up, not fixed in this task.

---

# Part B (narrowed, fast track) — implementation-plan.md C1-C6

Inputs: implementation-plan.md ("Team-leader handoff", B-1..B-7), task-description.md (items 1-4), context.md "fast track" + "Combined Gate (1+2) — APPROVED" (Restore destination = option 1: owned workspace source `{ws}/.claude/agents/<slug>.md`, disclosed before Restore). Base for "before" evidence: `21c27d17f`.

## Part B run defaults (recorded)

- Batch-size rule (≤6 files, ≤2 libs, one scoped check) splits the plan's proposed B-2, B-3 and B-5 into sub-batches; the plan's ordering is kept: C1 before C3/C4; C2 → C3 sequential (shared `rpc.types.ts`); C4 ∥ C5; C6 after #634.
- Dependency graph:
  - Start now, in parallel (file-disjoint and lib-disjoint): **B-0** (before screenshots, no source files) ∥ **B-1** (shared + harness-sync) ∥ **B-2a** (agent-generation).
  - B-1 → B-1b. B-2a → B-2b. (B-1 + B-1b + B-2b) → B-2c.
  - (B-0 + B-1 + B-2b) → B-3a → B-3b. (B-0 + B-2c) → B-4. B-3 ∥ B-4 (skill-synthesis-ui vs setup-wizard).
  - B-5 (a-g) and B-6: unblocked 2026-10-03; order in "Mode 1 refresh after #634" (B-5a ∥ B-5c now; Part A Batch 3b after B-5b). B-7 last.
- B-1 and B-2a touch disjoint files AND disjoint libs (`libs/shared` + `harness-sync` vs `agent-generation`; agent-generation never imports harness-sync), so their scoped checks do not see each other's in-flight edits. B-2b and B-1 both edit `libs/shared` (different files); B-2b starts only after B-2a, by which time B-1 is usually committed — if not, a `@ptah-extension/shared` failure in a file owned by the other batch is not this batch's failure (same rule as Part A).
- Executors: backend-developer for judgement-heavy backend (B-1, B-2a, B-2b, B-2c, B-5); frontend-developer for B-3a/B-3b/B-6; Codex-allowed CLI lane for narrow batches (B-1b, B-4) with the explicit file list and a tool-call ceiling ≤40; visual-reviewer for B-0 and B-7 screenshots. Lanes never run git.
- Scoped checks, always in this order, tailed (`| tail -40`): `npx nx run-many -t typecheck,lint -p <projects>` (no `--maxWorkers` on typecheck), then `npx nx run-many -t test -p <projects> --maxWorkers=2`. Never workspace-wide.
- `git diff --name-only` per batch must show only that batch's files, and no #634 file (`rpc-agents.types.ts`, `rpc-auth.types.ts`, `agent-rpc.handlers.ts`, `file-settings-keys.ts`, `orchestrator.service.ts`) in B-0..B-4.
- Review policy (usage hygiene rule 3): no per-batch review. Each batch is verified on disk by the team-leader, must pass its scoped checks, and is committed LOCALLY. ONE code-logic review on the combined Part B diff in B-7 gates push/PR; at most one fix round (Blocking/Serious), as a follow-up commit.
- Default chosen for the review timing: the single review runs after B-6 (the whole Part B diff). If #634 is still unmerged when B-4 commits, the orchestrator surfaces that to the user (ship items 2-4 with their own review vs wait); it is not decided here.
- Spec edits to existing assertions carry a one-line reason (plan "Preserve list check").

## Part B plan validation (short, fast track)

Status: PASSED WITH RISKS

Assumptions:

- PA-1 (plan A-7) VERIFIED with a mitigation: `SkillsSynthesisRpcHandlers` has no container reference (`skills-synthesis-rpc.handlers.ts:342` is a comment), but uses `@inject(TOKEN, { isOptional: true })` (`:335-349`). B-2b injects `HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE` optionally; absent or throws → `agentSync:'unknown'`. Spec asserts both.
- PA-2 (plan A-4) FALSE as stated: per-agent enablement lives in the PRIVATE `HarnessManifestBuilder.buildAgents` (`harness-manifest.builder.ts:476-499`, `disabledAgentIds` raw membership + `agentSyncEnabled`). Per the plan's own fallback, B-1b extracts it into an exported pure function used by both the builder and the preview (B-2c). No behaviour change in the builder.
- PA-3: no `manifest.spec.ts` exists under `host-profile/`; METHODS/`RPC_METHOD_ENTRIES` totality is covered by the rpc-handlers test run (e.g. `skills-synthesis-rpc.handlers.spec.ts`, `setup-rpc.handlers.spec.ts`). B-2b/B-2c checks include `@ptah-extension/rpc-handlers` tests. Verified.
- PA-4: `NativeModalComponent` is at `libs/frontend/ui/src/lib/native/modal/native-modal.component.ts`; B-3a/B-4 reuse it, no new modal. Verified (file exists).
- PA-5: plan A-1, A-2, A-3, A-5, A-6 stay open and are checked inside the batch that depends on them (A-6 in B-2c; A-1, A-2, A-3, A-5 in B-5).

| Risk | Severity | Mitigation |
| --- | --- | --- |
| PR1. `workspace-target.ts` is 1222 lines (max-lines warning, batches.md:128); C1 adds to it | MEDIUM | B-1 Task 1.B3 keeps additions minimal; if lint flips to an error, the executor moves the new helper into the existing `harness-health.ts` (already in the batch), not a new file. |
| PR2. Overwrite of a hand-edited copy without a usable snapshot | HIGH | B-1: `snapshotLocalEdit` before the write; failure → no write, `writeFailed`; spec (c) leaves the original byte-unchanged. |
| PR3. Restore leaves a partial `dest` or deletes user data | HIGH | B-2a: tmp + exclusive `fs.link`, `COPYFILE_EXCL` fallback, verify bytes, never delete snapshot; specs for injected failure + retry (`already-restored`). |
| PR4. Malformed quarantine marker or traversal slug reaches the fs | HIGH | B-2a validates marker and each slug (`.`/`..` refused); B-2b zod `SlugSchema` at the handler. |
| PR5. Restore silently enables agent-sync consent | MEDIUM | B-2a/B-2b never call `AgentSyncGate.enable`; spec asserts the gate state file is unchanged. |
| PR6. Preview promises paths generation does not write (or misses some) | HIGH | B-2c fidelity spec through the real `wizard:submit-selection` with exact set equality; B-4 re-preview on confirm. |
| PR7. A reconcile mutates without the user seeing edited paths | HIGH | B-3a guard runs a fresh `harness:health{refresh:true}` first; cancel = no mutation; every caller on the surface uses it (Sync, post-Restore, Finish restore; model save in B-6). |
| PR8. `rpc.types.ts` concurrent edits (B-2b, B-2c, B-5g) | MEDIUM | Strictly sequential, one executor at a time. |
| PR9. C6 settings write falls back to the global key / clobbers unrelated entries | HIGH | B-5b `writeForPath` throws on a missing path; per-key queued read-modify-write; specs from plan C6. Blocked until #634. |
| PR10. Before screenshots taken after the UI changed | MEDIUM | B-0 captures from `21c27d17f` and must finish before B-3a/B-4 start. |

Edge cases:

- Hand-edited non-agent owned file (skill/MCP) appears in `localEdit` — B-1 spec (a2); listed by the guard — B-3a.
- Disabled agent excluded from `agentsInSync` — B-1 spec (d).
- Marker wrong-shaped / `completedAt` unparseable / history dir missing / later ts dir — B-2a.
- Source restored but gate off (`source-restored`, no reconcile) — B-2a/B-2b/B-3b.
- Conflict in source (different bytes) or scoped root — B-2a; toast — B-3b.
- Reconciler absent or verify throws → Claude-only preview + warning — B-2c; preview failure keeps Generate enabled — B-4.
- Provider detected between preview and confirm → "Targets changed since preview" — B-4.
- Non-agent tabs make no harness call — B-3b.

## Batch B-0: BEFORE screenshots from base `21c27d17f` — COMPLETE (evidence only, no commit)

- Recommended executor: visual-reviewer (sub-agent)
- Fallback executor: none (screenshots need a rendered build)
- Execution mode: sequential
- Rationale: evidence only; touches no source file, so it runs alongside B-1/B-2a. Must COMPLETE before B-3a and B-4 start.
- Tasks: 1 | Depends on: none
- Precondition (orchestrator does the git): a detached checkout of `21c27d17f` OUTSIDE this worktree (e.g. `git worktree add --detach <path> 21c27d17f`), built and launched there. Never check out the base inside W.

### Task B-0.1: Capture Agents tab + wizard selection step, dark + light — COMPLETE

- Output: `W\.ptah\specs\TASK_2026_609_c495\screenshots\before-agents-dark.png`, `before-agents-light.png`, `before-wizard-dark.png`, `before-wizard-light.png`
- Content: Thoth Library → Agents tab with at least one agent card (current card actions visible); setup wizard agent-selection step with the Generate button. Same viewport for before and after (record it in the report).
- Done when: all four files exist and are non-empty; viewport and build commit recorded.

### Batch B-0 result (team-leader, 2026-10-03)

- On disk: the four `screenshots/before-*.png` files (78-120 KB each). `visual-b0-report.md`: base checkout at `21c27d17f` outside W, viewport 1280x800, dark `anubis` / light `anubis-light` set via `data-theme` after boot, fixture RPC auto-responder; reproducible script in `b0-capture/`. The AFTER run (B-7) must use the same viewport, theme method and script.

## Batch B-1: C1 harness health `localEdit` / `agentsInSync` + snapshot-before-overwrite — COMPLETE (9d31e981d)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane x 1 with the file list below, ceiling 40
- Execution mode: sequential
- Rationale: touches the drift and write path of the reconciler; snapshot-before-write needs judgement. File-disjoint and lib-disjoint from B-2a.
- Tasks: 3 | Depends on: none (Part A 1a committed)
- Projects: `@ptah-extension/shared,@ptah-extension/harness-sync`
- Files (exactly these):
  - `W\libs\shared\src\lib\types\harness-sync.types.ts`
  - `W\libs\backend\harness-sync\src\lib\health\harness-health.ts`
  - `W\libs\backend\harness-sync\src\lib\targets\harness-target.port.ts`
  - `W\libs\backend\harness-sync\src\lib\targets\workspace-target.ts`
  - `W\libs\backend\harness-sync\src\lib\reconciler\harness-reconciler.local-edit-report.spec.ts` (CREATE)
  - `W\libs\backend\harness-sync\src\lib\targets\transformers\agent-rel-path.guard.spec.ts` (CREATE)

### Task B-1.1: Shared contract — optional `localEdit?`, `agentsInSync?`; `harnessAgentRelPath`, `HARNESS_AGENT_CHIP_TARGETS` — COMPLETE

- File: `harness-sync.types.ts`
- Plan reference: implementation-plan.md:44-52 (C1), :21, :29 evidence rows
- Pattern to follow: `adopted?` optional field (`harness-sync.types.ts:150-162`, R12); pure rule precedent `blockedTargetPaths` (`:334-379`)
- Quality requirements: fields optional (no fixture edits); `harnessAgentRelPath(target, slug)` returns the same path as each transformer (codex `codex-agent-transformer.ts:65-68`, copilot `:28-31`, cursor `:24-27`, opencode `opencode-agent-transformer.ts:59-62`), `null` for Claude/unsupported.
- Validation notes: PR1 not affected (shared file).

### Task B-1.2: Fill `localEdit` / `agentsInSync` in planned + applied health — COMPLETE

- Depends on: B-1.1
- Files: `harness-health.ts`, `harness-target.port.ts` (`HarnessPlan.unchangedAgents?`), `workspace-target.ts` (push at `:205` for `entry.kind==='agent'`)
- Plan reference: implementation-plan.md:45-47
- Quality requirements: `localEdit` = `plan.writes.filter(w => w.overwritesLocalEdit)` over ALL facets; `agentsInSync` = unchanged agents + written agent keys on apply; disabled agent excluded.

### Task B-1.3: Snapshot before overwriting a hand-edited copy + specs — COMPLETE

- Depends on: B-1.2
- File: `workspace-target.ts` `applyWrite` (`:974-976`), reuse `snapshotLocalEdit` (`:1113`); both new specs
- Plan reference: implementation-plan.md:48, :51 tests (a)-(e)
- Quality requirements: snapshot failure → no write, `writeFailed` reason `could not save local edit before overwrite: …`, original byte-unchanged; `overwrittenLocalEdit=[path]` on success.
- Validation notes: PR1 (minimal additions), PR2.

### Batch B-1 verification

- Six files only (`git status --short` / `git diff --name-only`)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared,@ptah-extension/harness-sync` then `-t test ... --maxWorkers=2`, tailed; specs (a), (a2), (b), (c), (d), (e) present and passing
- No lint max-lines error on `workspace-target.ts`

### Batch B-1 result (team-leader, Mode 2, 2026-10-03)

- On disk: optional `localEdit?` / `agentsInSync?` on `HarnessTargetHealth`; exhaustive `harnessAgentRelPath`; `HARNESS_AGENT_CHIP_TARGETS` (vscode excluded); `HarnessPlan.unchangedAgents?` filled in `WorkspaceHarnessTarget.plan`; `localEditPaths(plan)` over all facets in planned + applied health; `snapshotBeforeOverwrite` runs before the write in `applyWrite` (symlink or unreadable copy → throw → `writeFailed`, nothing written; `overwrittenLocalEdit` only after a verified snapshot and a successful write). Specs (a), (a2), (b), (c), (d), (e) present with real assertions, no skip/only/TODO.
- `typecheck,lint -p shared,harness-sync`: pass (pre-existing max-lines warning on `workspace-target.ts`, still a warning; PR1 fallback not triggered).
- `test -p shared,harness-sync --maxWorkers=2 --skip-nx-cache`: shared 2277/2277; harness-sync 17 failed / 452 passed / 469. The 17 failing names equal the Batch 1a baseline set exactly (E23 x5, B8 x2, agent-consent x2, skill-consent x7, E21 x1). No new failure. Direct jest run of local-edit-report + agent-rel-path.guard + retire-local-edit: 21/21.
- PR2 resolved for `WorkspaceHarnessTarget` (spec c). Executor's out-of-scope finding verified: `claude-target.ts:381` and `mcp-facet-planner.ts:184` push `overwrittenLocalEdit` with no snapshot. Not fixed in B-1 (fast-track scope). Resolution: B-3a.2 guard wording is per-target accurate (see that task); named follow-up **FU-1** below.
- Doc caveat (FU-1 owns it): the `localEdit` doc comment in `harness-sync.types.ts` says "Every overwrite saves the edited copy … first"; true only for workspace (non-Claude) targets' agent/skill copies. FU-1 either makes it true or narrows the comment.
- Committed `9d31e981d`, the six B-1 files only (B-2a's three `user-layer/*` files, `test-results/` and the task folder unstaged).

### Follow-up FU-1 (recorded, not in Part B fast track): snapshot before overwrite for Claude target and MCP fragments

- `ClaudeHarnessTarget.apply` (`claude-target.ts:381`) and `mcp-facet-planner.ts:184` overwrite a hand-edited owned copy without a `.history` snapshot. Extend the B-1 rule (snapshot → verify → write; failure → `writeFailed`) to both, then widen the B-3a guard's snapshot sentence to all targets and correct the `localEdit` doc comment if anything stays unsnapshotted. Owner: next harness-sync task after TASK_2026_609; surfaced in B-7.2 review and the PR description.

## Batch B-1b: Extract per-agent sync enablement as a pure exported function (PA-2) — COMPLETE (442317863)

- Recommended executor: CLI lane x 1 (Codex allowed), tool-call ceiling 25
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: narrow mechanical extraction, three files, no behaviour change.
- Tasks: 1 | Depends on: B-1 committed (same lib; avoids cross-batch noise in harness-sync checks) | May run concurrently with B-2b
- Projects: `@ptah-extension/harness-sync`
- Files (exactly these):
  - `W\libs\backend\harness-sync\src\lib\manifest\harness-manifest.builder.ts`
  - `W\libs\backend\harness-sync\src\index.ts`
  - `W\libs\backend\harness-sync\src\lib\manifest\harness-manifest.agent-enablement.spec.ts` (CREATE)

### Task B-1b.1: `isAgentSelectedForSync({ agentSyncEnabled, disabledAgentIds }, slug)` — COMPLETE

- Plan reference: implementation-plan.md:81, :185 (A-4 fallback)
- Pattern to follow: `buildAgents` gates 1 and 2 (`harness-manifest.builder.ts:476-499`), raw membership on `disabledAgentIds` (same key shape as `disabledSkillIds`)
- Quality requirements: export from the builder module and `index.ts`; `buildAgents` calls it (no behaviour change; existing builder/reconciler specs unchanged); spec: sync disabled → false, slug in `disabledAgentIds` → false, else true; absent flag never resolves to a bare `false` contrary to `state/agent-sync-gate.ts`.

### Batch B-1b verification

- Three files only; `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync` then `-t test ... --maxWorkers=2`, tailed; all existing `harness-reconciler.*.spec.ts` pass unchanged

### Batch B-1b result (team-leader, Mode 2, 2026-10-03)

- Executor: CLI lane (Codex). On disk: exported `isAgentSelectedForSync` = `agentSyncEnabled !== false && !(disabledAgentIds ?? []).includes(slug)`; `buildAgents` keeps its `if (!syncEnabled) return []` consent early return and `build()` still passes `options.agentSyncEnabled !== false`; `Set.has` → `Array.includes` on raw slugs (same membership, no case/whitespace/extension normalisation); re-exported from `index.ts`. No existing spec touched.
- New spec: 13 pure cases (absent flag → enabled, explicit false → excluded, raw-ID matching incl. `Reviewer` / `reviewer.md` / ` reviewer ` not matching, frozen input) + 6 real-fs builder cases asserting exact manifest slugs.
- `typecheck,lint -p harness-sync`: pass (re-run by team-leader). Manifest specs: 4 suites / 50 tests pass. Full `harness-sync` test (team-leader re-run, `--maxWorkers=2`): 18 failed / 470 passed / 488; failing names = the 17 Batch 1a baseline names (agent-consent x2, skill-consent x7, E23 x5, B8 x2, E21 x1) + the documented capability-policy `[C3]` flake. No new failure.
- Review: none per batch (Part B review policy); covered by the B-7 combined review.
- Committed `442317863`, the three B-1b files only (B-2b's in-flight files, `test-results/` and the task folder unstaged).

## Batch B-2a: C2 quarantine list + restore core (agent-generation) — COMPLETE (614afaabf)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: CLI lane x 1 with the file list below, ceiling 40
- Execution mode: sequential
- Rationale: data-safety logic (marker validation, snapshot selection, atomic restore under the slug lock). File- and lib-disjoint from B-1.
- Tasks: 2 | Depends on: none (Part A Batch 1 committed)
- Projects: `@ptah-extension/agent-generation`
- Files (exactly these):
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.ts`
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.spec.ts`
  - `W\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-mirror.service.ts`

### Task B-2a.1: Validated marker read + per-item state derivation (`listQuarantinedAgents`) — COMPLETE

- Plan reference: implementation-plan.md:54-60, :26-27 evidence
- Pattern to follow: marker write `user-layer-seed-quarantine.ts:261-317`; history layout `user-layer-fs-ops.ts:177-191,263-275`
- Quality requirements: marker `version===1`, `completedAt` with finite `Date.parse`, three arrays of strings, else treated absent + `recordUnreadable:true`; per-slug rule `/^[a-z0-9][a-z0-9._-]*$/i` duplicated as a local constant (no cross-lib import), `.`/`..` refused, dropped slugs `logger.warn`; snapshot = largest `^\d+(-\d+)?$` dir with ms ≤ `completedAt` holding a regular `<slug>.md`; states `quarantined` / `source-restored`, dropped when the scoped clone exists; `notOwned` = validated kept lists still present. Domain result types stay local to agent-generation (handler maps them in B-2b).
- Validation notes: PR4.

### Task B-2a.2: `restoreQuarantinedAgent(slug)` under `withSlugLock('agent', slug)` + specs — COMPLETE

- Depends on: B-2a.1
- Plan reference: implementation-plan.md:64-70, :74 tests
- Quality requirements: outcomes `restored | already-restored | conflict | not-quarantined | no-snapshot | copy-failed`; tmp `.<slug>.md.ptah-restore-<random>.tmp` → verify → `fs.link` (EEXIST-safe) → unlink tmp; `EPERM/ENOTSUP/EXDEV` → `copyFile(..., COPYFILE_EXCL)` + verify, remove own `dest` on mismatch; never deletes the snapshot; never calls `AgentSyncGate.enable`; `logger.info` slug + outcome. All plan C2 spec cases that do not need the RPC layer (wrong-shaped marker, missing history, later ts dir ignored, flat base + other workspace byte-unchanged, conflict both sides, injected link/verify failure then successful retry, `already-restored`, non-quarantined refused).
- Validation notes: PR3, PR5.

### Batch B-2a verification

- Three files only; `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation` then `-t test -p @ptah-extension/agent-generation --maxWorkers=2`, tailed
- No harness-sync import added to agent-generation

### Batch B-2a result (team-leader, Mode 2, 2026-10-03)

- On disk: `validateSeedQuarantineMarker` (version 1, finite `completedAt`, three string lists; unsafe slugs dropped per entry + `logger.warn`), local `isSafeAgentSlug` (SlugSchema regex, max 128, `.`/`..`/`..`-substring refused), `orderQuarantineSnapshotCandidates` (ms <= completedAt, newest first), `listQuarantined` (dropped when the scoped clone exists; `source-restored` vs `quarantined`; `notOwned` from kept lists still present), `restore` (unsafe slug refused before any path join or lock; under `withSlugLock('agent', slug)`; tmp `wx` -> verify -> `fs.link`, EEXIST re-check, EPERM/ENOTSUP/EOPNOTSUPP/EXDEV -> `COPYFILE_EXCL` + verify + remove own dest; tmp unlinked in `finally`; snapshot never touched). Facade `listQuarantinedAgents` / `restoreQuarantinedAgent` on `UserLayerMirrorService` throw on a non-absolute workspace root (B-2b handler maps that to an RPC error).
- No harness-sync import in agent-generation (grep). No TODO/stub markers; the one `it.skip` (POSIX-only, ~line 589) is pre-existing.
- `typecheck,lint -p @ptah-extension/agent-generation --skip-nx-cache`: pass (pre-existing max-lines warning on `user-layer-mirror.service.ts`). `test --maxWorkers=2 --skip-nx-cache`: 35/35 suites, 1192 passed, 1 skipped (pre-existing).
- PR3, PR4 (fs side), PR5 (no gate call; gate-state stand-in byte-unchanged) addressed; PR4 zod side and the real `AgentSyncGate` assertion stay on B-2b.
- Committed `614afaabf`, the three B-2a files only (task folder, `test-results/` and B-1b lane files unstaged).

## Batch B-2b: C2 RPC contract + handler (`skillSynthesis:listQuarantinedAgents`, `:restoreQuarantinedAgent`) — COMPLETE (c674de486)

- Recommended executor: backend-developer (sub-agent; same executor then continues to B-2c)
- Fallback executor: CLI lane x 1 with the file list below, ceiling 40
- Execution mode: sequential
- Rationale: edits `rpc.types.ts`, shared with B-2c (PR8); optional DI injection needs judgement (PA-1).
- Tasks: 2 | Depends on: B-2a committed (614afaabf)
- Projects: `@ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/agent-generation` (agent-generation for typecheck,lint only)
- Size exception (recorded): 7 files / 3 libs, above the 6-file / 2-lib rule. The seventh file is a type-only re-export the B-2a executor could not add (outside its list); the orchestrator directed it into B-2b rather than a separate batch.
- Files (exactly these):
  - `W\libs\backend\agent-generation\src\index.ts` (type-only re-export, see Task B-2b.1)
  - `W\libs\shared\src\lib\types\rpc\rpc-skill-clone.types.ts`
  - `W\libs\shared\src\lib\types\rpc.types.ts`
  - `W\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.ts`
  - `W\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.ts`
  - `W\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.spec.ts`
  - `W\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.spec.ts`

### Task B-2b.1: Contracts + `METHODS` / `RpcMethodRegistry` / `RPC_METHOD_ENTRIES` — COMPLETE

- Plan reference: implementation-plan.md:61-63, :33
- Quality requirements: exact shapes from the plan (`agentSync: 'enabled'|'disabled'|'unknown'`, `quarantinedAt: string|null`, `recordUnreadable?: true`); no manifest edit.
- Also: add `QuarantinedAgentItem`, `QuarantinedAgentState`, `QuarantinedAgentsListing`, `QuarantineRestoreOutcome`, `QuarantineRestoreResult` to the existing `export type { … } from './lib/services/user-layer/user-layer-mirror.service'` block in `agent-generation/src/index.ts` (`:105-125`); type-only, no value export. The handler imports these domain types and maps them to the shared RPC shapes (domain types never leak into `libs/shared`).

### Task B-2b.2: Handlers + zod + specs — COMPLETE

- Depends on: B-2b.1
- Pattern to follow: `skills-synthesis-rpc.handlers.ts` `METHODS :243-285`, handler pattern `:1354-1420`, `requireDesktop`, `agentScope() :2027`; optional injection `:335-349`; `SlugSchema` (`skills-synthesis-rpc.schema.ts:376-380`)
- Quality requirements: `agentSync` via optionally-injected `AGENT_SYNC_GATE`.resolve(`resolveHarnessWorkspaceRoot(ws)`), missing/throws → `'unknown'`; traversal slug rejected by schema; specs: gate disabled → `restored` + `agentSync:'disabled'` + gate state unchanged + item `source-restored`; gate unregistered → `'unknown'`; existing construction sites still compile (optional token).
- Validation notes: PA-1, PA-3, PR4, PR5. The B-2a facade throws on a non-absolute workspace root, and `restore` returns `not-quarantined` for an unsafe slug. The handler passes an absolute harness-resolved workspace root and surfaces a thrown error as an RPC error, never as success. Mirror service absent (optional `USER_LAYER_MIRROR_SERVICE_TOKEN`, handlers `:308-309`) -> explicit error, not an empty list.

### Batch B-2b verification

- Seven files only; `npx nx run-many -t typecheck,lint -p @ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/agent-generation` then `-t test -p @ptah-extension/shared,@ptah-extension/rpc-handlers --maxWorkers=2`, tailed (includes RPC totality specs)

### Batch B-2b result (team-leader, Mode 2, 2026-10-03)

- On disk: shared contracts in `rpc-skill-clone.types.ts` (self-contained, no domain import); two `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` entries; handler `METHODS` + registrations; `@inject(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE, { isOptional: true })` typed `AgentConsentReader` (only `resolve`) as the last constructor parameter; root = `resolveHarnessWorkspaceRoot(agentScope())`; mirror absent -> `PERSISTENCE_UNAVAILABLE`; thrown facade error -> Sentry `report()` + generic `PERSISTENCE_UNAVAILABLE` (message not leaked), never success; strict zod schemas, restore slug via `SlugSchema`. Type-only re-export of the five domain types in `agent-generation/src/index.ts`.
- PR5: the added lines contain no `enable` call; spec uses the real `AgentSyncGate(new ManagedManifestStore())`, spies `enable` (never called), asserts state.json bytes unchanged and `resolve` still `{enabled:false, derived:false}`, then the item lists as `source-restored`. Resolved for the backend.
- PR4: traversal slugs (`../evil`, `..`, `a/b`, `a\b`, `''`) rejected `INVALID_PARAMS` before the mirror is called (handler spec), plus the schema table (`a..b`, `.`, `/etc/passwd`, `C:\x`, >128, extra keys). Resolved.
- Executor deviation ACCEPTED (not in plan): no open folder -> list `{ workspaceRoot: null, agentSync: 'unknown', quarantined: [], notOwned: [] }`; restore -> `RpcUserError INVALID_PARAMS` ("Open a workspace folder to restore a quarantined agent."), mirror not called. Restore never reports success without a folder. **For B-3b:** the panel must tell "no folder" (`workspaceRoot === null`) apart from "nothing quarantined" (`workspaceRoot` set, `quarantined` empty) and must not offer Restore when `workspaceRoot` is null.
- Plan deviation accepted: optional injection instead of the `isRegistered` container pattern (class has no container; PA-1 prescribes this).
- No TODO/stub/skip/only markers in the diff. Pre-existing warnings in `skills-synthesis-rpc.handlers.ts` (unused `SkillStatus`, `max-lines`, `no-useless-assignment`) untouched.
- Team-leader re-run (`--skip-nx-cache`): `typecheck,lint -p shared,rpc-handlers,agent-generation` 6/6 pass; `test -p shared,rpc-handlers --maxWorkers=2` "Successfully ran target test for 2 projects", exit 0 (executor counts: shared 2277/2277, rpc-handlers 3962 passed / 7 pre-existing skipped).
- Review: none per batch (Part B review policy); covered by the combined Part B review.
- Committed `c674de486`, the seven B-2b files only (`test-results/` and the task folder unstaged).

## Batch B-2c: C3 `wizard:preview-generation` (backend) — COMPLETE (ae794adae)

- Recommended executor: backend-developer (sub-agent; same as B-2b)
- Fallback executor: CLI lane x 1 with the file list below, ceiling 40
- Execution mode: sequential
- Rationale: second `rpc.types.ts` edit (after B-2b); fidelity spec through the real submit path needs judgement (A-6).
- Tasks: 2 | Depends on: B-1, B-1b, B-2b committed
- Projects: `@ptah-extension/shared,@ptah-extension/rpc-handlers`
- Files (exactly these):
  - `W\libs\shared\src\lib\types\rpc\rpc-setup.types.ts`
  - `W\libs\shared\src\lib\types\rpc.types.ts`
  - `W\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.ts`
  - `W\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.schema.ts`
  - `W\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation-rpc.handlers.spec.ts`
  - `W\libs\backend\rpc-handlers\src\lib\handlers\wizard-generation.preview-fidelity.spec.ts` (CREATE)

### Task B-2c.1: Contract + handler — COMPLETE

- Plan reference: implementation-plan.md:76-84
- Pattern to follow: gate/propagation registration check `wizard-generation-rpc.handlers.ts:745-798`; id rule `wizard-generation-rpc.schema.ts:36`
- Quality requirements: Claude path `definite`; rivals from a fresh `reconciler.verify(ws)` (`detected && facets.agents==='supported'`) via `harnessAgentRelPath` + `isAgentSelectedForSync` (B-1b); `AGENT_SYNC_GATE` or `PROPAGATION` unregistered → rivals `conditional` with "agent sync not available on this host"; reconciler absent / verify throws → Claude only + `warning`; `willOverwrite` = `lstat` exists.
- Validation notes: PA-2, PR6.

### Task B-2c.2: Handler specs + fidelity spec — COMPLETE

- Depends on: B-2c.1
- Plan reference: implementation-plan.md:86
- Quality requirements: plan C3 cases; fidelity: temp workspace, real `HarnessPropagationService` + reconciler + gate, LLM/content step stubbed at its boundary (A-6; if impossible, stub at the orchestrator but keep its own Claude path function, and report which); written agent paths === `definite` set exactly; gate initially disabled → still equal; preview failure → generation still writes Claude files.
- Validation notes: A-6 checked and reported.

### Batch B-2c verification

- Six files only; `npx nx run-many -t typecheck,lint -p @ptah-extension/shared,@ptah-extension/rpc-handlers` then `-t test ... --maxWorkers=2`, tailed

### Batch B-2c result (team-leader, Mode 2, 2026-10-03)

- On disk: `WizardPreviewGeneration*` / `GenerationPreview*` contracts (`rpc-setup.types.ts`), registry + `RPC_METHOD_ENTRIES` entries, zod `selectedAgentIds` 1..200 of `WizardAgentIdSchema`, handler `registerPreviewGeneration` / `previewRivals` / `previewAgent` / `previewFile`. Read-only: fresh `reconciler.verify(harnessRoot)`, one `SOURCE_RESOLVER.resolve`, `lstat`; no `enable` / `propagate` / `reconcile`. Eligibility via B-1b `isAgentSelectedForSync` (PA-2), paths via `harnessAgentRelPath`.
- Extra cases ACCEPTED (each specced): reserved slug (`con`) → no rival path; `policyUnknown` → rivals `conditional`; folder nested under another harness root → Claude only + warning naming the root.
- PR6 gap (executor deviation 3) FIXED in one bounded round (backend-developer, same six files): submit grants consent and propagates only when `writtenCount > 0`, so a rival copy is now `definite` only when the fresh verify lists its exact rel path in that target's `agentsInSync` (in place either way); otherwise `conditional` with `PREVIEW_WRITE_DEPENDENT_CONDITION` ("generation changes at least one selected agent file; other CLIs are only synced when a file is written"). Priority: no gate/propagation → policy unknown → in-sync rule. Submit path unchanged. Fidelity invariant is now: every `definite` path is written AND every written agent path is in definite ∪ conditional; new cases reproduce the all-unchanged run with gate disabled (no rival written, gate stays disabled, every definite path exists) and the synced rerun (rivals definite, unchanged run keeps them). **For B-4:** after this change a fresh workspace shows rival copies under the "may also write, if …" group, not as definite.
- Home-safety (must-pass, verified in the diff): fidelity spec `jest.mock('os')` pins `homedir()` to the temp home, `beforeEach` asserts `os.homedir() === mockHome` and `codexHomeDir() === <temp home>/.codex` with `CODEX_HOME` deleted and restored in `afterEach` (only env path lookup in harness-sync/agent-generation is `codex-home.ts:51`; all `homedir()` calls are call-time, none module-level); the refresher throws unless the user-layer root is under the temp home. The handler spec constructs no real home-touching service (no `registerHarnessSyncServices` / `registerAgentGenerationServices` / `AgentSyncGate`). Real `~/.ptah/user/agents`: 34 entries before and after the team-leader test run, nothing newer than the executor report.
- Incidental: prettier normalised `MultiPhaseAnalysisPhaseStatus` (`rpc-setup.types.ts:39`, was unformatted at HEAD); type unchanged.
- Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p shared,rpc-handlers` pass (max-lines warning on `wizard-generation-rpc.handlers.ts`, see FU-2); `test -p shared,rpc-handlers --maxWorkers=2` "Successfully ran target test for 2 projects" (fix round: rpc-handlers 3985 passed / 7 pre-existing skipped).
- Review: none per batch (Part B review policy); covered by B-7.2.
- Committed `ae794adae`, the six B-2c files only (B-3b's in-flight skill-synthesis-ui files, `test-results/` and the task folder unstaged).

### Follow-up FU-2 (recorded, not done now): move the generation preview out of `wizard-generation-rpc.handlers.ts`

- The file is ~880 lines against `max-lines` 700 (warning; HEAD had none). Move `registerPreviewGeneration`'s helpers (`previewRivals`, `previewAgent`, `previewFile`, `RivalPreview`, the `PREVIEW_*` constants) into a `wizard-generation.preview.ts` collaborator in the same folder, handler keeps only the registration. Behaviour-preserving; both specs unchanged. Owner: after B-7 review fixes, before the PR merges or as the first harness-sync follow-up.

## Batch B-3a: C4 pure chips rule, reconcile guard, RPC client methods — COMPLETE (fe98b57b5)

- Recommended executor: frontend-developer (sub-agent; continues to B-3b)
- Fallback executor: CLI lane x 1 with the file list below, ceiling 40
- Execution mode: sequential
- Rationale: the guard is the single mutation policy for the surface (PR7); pure helpers first so B-3b only wires them.
- Tasks: 3 | Depends on: B-0 COMPLETE, B-1 and B-2b committed | May run concurrently with B-4
- Started 2026-10-03 in parallel with B-2c (deps B-0, B-1 9d31e981d, B-2b c674de486 met; file- and lib-disjoint). B-2c edits `libs/shared` (`rpc-setup.types.ts`, `rpc.types.ts`); a skill-synthesis-ui typecheck failure that points into those in-flight shared files is not B-3a's failure.
- Projects: `@ptah-extension/skill-synthesis-ui`
- Files (exactly these):
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-sync-chips.ts` (CREATE)
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-sync-chips.spec.ts` (CREATE)
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\reconcile-guard.ts` (CREATE)
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\reconcile-guard.spec.ts` (CREATE)
  - `W\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.ts`
  - `W\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.spec.ts`

### Task B-3a.1: `agent-sync-chips.ts` — COMPLETE

- Plan reference: implementation-plan.md:89
- Quality requirements: state order `unknown, not-detected, source (Claude), unsupported, failed(reason), edited, missing, in-sync, not-synced`; "in sync" only via `agentsInSync`; spec over the risk-table fixture + undetected cursor.

### Task B-3a.2: `reconcile-guard.ts` — COMPLETE

- Plan reference: implementation-plan.md:90-96
- Pattern to follow: `HarnessHealthStore` (`marketplace/.../harness-health.store.ts:105-177`, import via `@ptah-extension/marketplace/services`, eslint exemption `eslint.config.mjs:248-251`); `NativeModalComponent` (PA-4)
- Quality requirements: fresh `store.refresh({refresh:true})`; `localEdit` across all targets/facets; whole-workspace wording verbatim from the plan; cancel → `false` and NO mutation; option to show only when edits exist (for B-6). Specs: cancel → no reconcile; edit made after tab load appears (fresh, not cached); unrelated skill/MCP edit listed.
- Snapshot wording is PER TARGET and must be true (team-leader decision after B-1, 2026-10-03; supersedes the plan's single "a copy is saved first" line): group listed `localEdit` paths by target. For a non-Claude CLI target's agent/skill copy (written by `WorkspaceHarnessTarget`, snapshotted since `9d31e981d`) say the edited copy is saved to `.ptah/harness/.history/` before it is overwritten. For a `claude` target path and for any MCP config path (`facet === 'mcp'` / MCP config files) say only that the hand edit will be overwritten — NO snapshot promise. If both kinds are listed, show both sentences against their groups. Spec: a fixture with one Codex agent edit and one Claude (or MCP) edit renders the `.history` note only for the Codex path and the plain overwrite warning for the other. When FU-1 lands, widen the note to all targets.
- Validation notes: PR7; FU-1.

### Task B-3a.3: RPC client methods `listQuarantinedAgents`, `restoreQuarantinedAgent` — COMPLETE

- Quality requirements: typed from `rpc-skill-clone.types.ts` (B-2b) via `libs/shared` only (`scope:webview`).

### Batch B-3a verification

- Six files only; `npx nx run-many -t typecheck,lint -p @ptah-extension/skill-synthesis-ui` then `-t test ... --maxWorkers=2`, tailed

### Batch B-3a result (team-leader, Mode 2, 2026-10-03)

- Verified on disk: the six files, real implementations. Chips state order matches B-3a.1; "in sync" comes only from `agentsInSync`.
- Guard: every `confirm` calls `store.refresh({ refresh: true })` (spec asserts the params, and that an edit made after the tab loaded is listed). `localEdit` is collected across all targets and facets. The whole-workspace notice is verbatim. Snapshot wording is per target, following the FU-1 rule: `.history` note only for non-Claude, non-MCP (`#`) paths. Spec: a mixed Codex/Claude/MCP fixture shows the note once, in the Codex section only. Claude-only shows no `.history` text. The `WorkspaceHarnessTarget.applyWrite` snapshot (`workspace-target.ts:961-979`) backs the promise.
- Fails closed: when a harness call is in flight, the read fails, or there is no report, the guard resolves `false`, also with `onlyWhenEdits`. Accepted for Sync/Restore. See the B-6 open design point.
- RPC client: throws message text only (existing service convention; `errorCode` dropped). B-3b detects "no folder" from `workspaceRoot: null` in the list result, not from an error code (B-3b.1 text below matches this).
- Checks (team-leader run): typecheck and lint for `@ptah-extension/skill-synthesis-ui` passed. Test: 33 suites, 539 tests passed.
- Review: none per batch (Part B review policy); covered by B-7.2.
- Committed `fe98b57b5`, the six B-3a files only. B-2c's in-flight files, `test-results/` and the task folder were left unstaged.

## Batch B-3b: C4 quarantine panel + card chips + Sync wiring — COMPLETE (263832daf)

- Recommended executor: frontend-developer (sub-agent; same as B-3a)
- Fallback executor: none (template + state wiring across 3 components)
- Execution mode: sequential
- Rationale: wires B-3a into existing components; preserve-list items live here.
- Tasks: 2 | Depends on: B-3a committed | May run concurrently with B-4
- Projects: `@ptah-extension/skill-synthesis-ui`
- Files (exactly these):
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\quarantined-agents-panel.component.ts` (CREATE)
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\quarantined-agents-panel.component.spec.ts` (CREATE)
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.ts`
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.spec.ts`
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.ts`
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.spec.ts`

- Started 2026-10-03 after B-3a `fe98b57b5`. B-2c is still running. B-3b is file-disjoint and lib-disjoint from it: B-2c touches `libs/shared` and `libs/backend/rpc-handlers`, and B-3b touches only `libs/frontend/skill-synthesis-ui`. A skill-synthesis-ui typecheck failure that points into B-2c's in-flight shared files is not B-3b's failure.

### Task B-3b.1: Quarantine panel — COMPLETE

- Plan reference: implementation-plan.md:98-103
- Quality requirements: count; slug, date or "date unknown", state; Restore confirm text names `.claude/agents/<slug>.md` as an owned, git-visible source and says the snapshot is kept (Decision 1 / user option 1); `agentSync:'disabled'` copy verbatim, Restore without reconcile and without guard; otherwise guard → restore → `store.reconcile()` → re-list + `refreshClones()`; `source-restored` → "restored, not yet synced" + "Finish restore" (guard → reconcile); `no-snapshot` → Restore disabled; `conflict`/`copy-failed` toast with path/reason; `recordUnreadable` muted note. No open folder (B-2b accepted deviation): `listQuarantinedAgents` returns `workspaceRoot: null` with empty lists → render a distinct "open a workspace folder" state, NOT the "nothing quarantined" empty state, and offer no Restore; a restore `INVALID_PARAMS` error is shown as an error, never as success. Spec both states. Detection rule (B-3a `fe98b57b5`): the RPC client throws `Error(message)` only, with no `errorCode`, so "no folder" is detected ONLY from the list result's `workspaceRoot === null`; never parse error text. A thrown restore or list error is shown as an error with its message.
- Validation notes: PR5, PR7.

### Task B-3b.2: Card chips + Sync button + view wiring — COMPLETE

- Plan reference: implementation-plan.md:97, :104, :150-152
- Quality requirements: `CloneCardComponent` inputs `syncChips`, `notOwned` (default empty, outputs unchanged `:227-231`); `SkillClonesViewComponent` injects `HarnessHealthStore` on the agent tab only, gated by `isElectron()` and `currentKind()==='agent'`; `actionsLocked` includes `store.busy()`; Sync → guard → `store.reconcile()`; `writeFailed` path + reason on the chip; panel renders outside the empty `<p>`; non-agent tabs make no harness call (spec). One verify per tab entry/Refresh/guarded mutation, no polling.

### Batch B-3b verification

- Six files only; `npx nx run-many -t typecheck,lint -p @ptah-extension/skill-synthesis-ui` then `-t test ... --maxWorkers=2`, tailed; edited existing assertions carry a one-line reason

### Batch B-3b result (team-leader, Mode 2, 2026-10-03)

- Verified on disk: the six files, real implementations. The panel reuses B-3a's `ReconcileGuardComponent`, `agentSyncChips` and RPC client methods.
- "No folder" comes only from `listing.workspaceRoot === null`, never from error text. A thrown list error renders `quarantine-error` (role=alert) and clears the listing, so it never reads as empty. A thrown restore gives an error toast with no reconcile. A store reconcile failure is read from `store.error()`: an error toast for Sync and Finish restore, a warning for post-restore. No polling: the view's effect calls one `refresh({refresh:true})` per Agents-tab entry, the panel lists once on init (it is recreated per tab entry), Refresh re-verifies and re-lists, and the guard verifies inside `confirm`.
- Decision 1 accepted (guard placed only on the Agents tab): there is still exactly one `<ptah-reconcile-guard>` in the template. Its only callers live on that tab: Sync via `viewChild`, Restore with sync on, and Finish restore via the `[guard]` input. All three call `confirm` before any write. Restore with sync off is unguarded by design (PR5), since it writes only the disclosed source file.
- Decision 2 accepted (two dialogs on sync-on Restore): the disclosure modal shows `quarantineRestoreDisclosure(slug)` on both paths, and the sync-off path adds the verbatim sync-off copy.
- Decision 3 accepted (Finish restore hidden when sync is off): the row reads "restored, not yet synced". The panel shows `QUARANTINE_SYNC_OFF_COPY` ("Agent sync is off here: only Claude will see it until agent sync is enabled by the setup wizard. Ptah will not turn sync on."), which says why.
- Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p @ptah-extension/skill-synthesis-ui` pass. Lint has one new warning, max-lines on `skill-clones-view.component.ts` (730/700, see FU-3). `test -p @ptah-extension/skill-synthesis-ui --maxWorkers=2`: 34/34 suites, 571/571 tests.
- Review: none per batch (Part B review policy); covered by B-7.2.
- Committed `263832daf`, the six B-3b files only. B-4's setup-wizard files, `test-results/` and the task folder were left unstaged.

### Follow-up FU-3 (recorded, not done now): split the Agents-tab wiring out of `skill-clones-view.component.ts`

- The file is 730 lines against the `max-lines` limit of 700 (a warning; HEAD had none). Extract the Agents-tab harness wiring into its own component in `components/clones/`: the Sync row and `onSync`, the `agentChips` map, the tab-entry verify effect, and the panel plus guard placement. The view keeps only the `onAgentTab` gate and the card inputs. Behaviour-preserving: the existing view specs move with the wiring unchanged. Owner: with FU-2, after the B-7 review fixes and before the PR merges.
- Added 2026-10-04 (B-6):
  - Move `AgentModelsStore` out of `agent-model-editor.component.ts` (765 lines, max-lines warning) into `clones/agent-models.store.ts`, with no behaviour change. The view is now 739 lines; the model-load wiring (store provider, the `load()` calls on tab entry and Refresh, the `modelGuard` binding) moves with the Agents-tab wiring.
  - Add the view-level wiring spec if B-7.2 has not already added it.

## Batch B-4: C5 wizard preview step — COMPLETE (`4d18d7088` pre-rebase; `165881e4a` after rebase onto #634)

- Recommended executor: CLI lane x 1 (Codex allowed), tool-call ceiling 40
- Fallback executor: frontend-developer (sub-agent)
- Execution mode: sequential
- Rationale: one component, its spec, one RPC client in one lib; behaviour fully specified by the plan. File- and lib-disjoint from B-3.
- Tasks: 2 | Depends on: B-0 COMPLETE, B-2c committed | May run concurrently with B-3a/B-3b
- Projects: `@ptah-extension/setup-wizard`
- Files (exactly these):
  - `W\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`
  - `W\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.spec.ts`
  - `W\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
  - `W\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.spec.ts`

- Started 2026-10-03: deps met (B-0 COMPLETE, B-2c `ae794adae`). File- and lib-disjoint from B-3b (setup-wizard vs skill-synthesis-ui); neither edits `libs/shared`.

### Task B-4.1: `previewGeneration(ids)` client method — COMPLETE

- Quality requirements: typed from `rpc-setup.types.ts` (B-2c); spec for the RPC call shape.

### Task B-4.2: Preview modal + confirm/re-preview flow — COMPLETE

- Depends on: B-4.1
- Plan reference: implementation-plan.md:108-113 (`agent-selection.component.ts:466-488`, `:883-946`)
- Quality requirements: `onGenerateAgents()` → preview → `NativeModalComponent` listing agent, path, "will overwrite", and a separate "may also write, if …" group with condition; confirm → re-preview, changed `definite` set → "Targets changed since preview" + second confirm; then the existing body moved verbatim into `confirmGenerate()`; cancel → no RPC, selection kept; preview throws → reason shown, Generate stays enabled and submits. Existing submit specs now confirm first, each edited assertion with a one-line reason.
- Validation notes: PR6.

### Batch B-4 verification

- Four files only; `npx nx run-many -t typecheck,lint -p @ptah-extension/setup-wizard` then `-t test ... --maxWorkers=2`, tailed

### Batch B-4 result (team-leader, Mode 2, 2026-10-03) — NOT ACCEPTED, round 1

- On disk (diff read): exactly the four files; no #634 file. Generate body moved verbatim (only the method name changed, `onGenerateAgents` → `confirmGenerate`); cancel bumps `previewRequest` and sends no submit, selection handlers guarded while open; changed definite set (set comparison, conditionals excluded) sets "Targets changed since preview" and returns, next confirm re-previews before submitting; preview failure shows the reason and enables "Generate without preview" (no auto-submit); conditional files render "May also write, if {{ condition }}" in a separate group; `NativeModalComponent` reused, OnPush + signals, no `[innerHTML]`.
- Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p @ptah-extension/setup-wizard` pass; `test -p @ptah-extension/setup-wizard --maxWorkers=2` pass.
- BigInt TS2737 in `capability-id-codec.ts`: not this batch (file absent from the diff; last touched by `cdeff5021`, before base).
- Defect (blocks commit): user-visible overwrite markers contain a literal ASCII `?` (0x3F, a mangled dash) — `agent-selection.component.ts:539` renders `path ? will overwrite` and `:561` renders `? will overwrite if written`. Fix: use a real separator (e.g. `— will overwrite` / `(will overwrite if written)`, matching existing template copy) and tighten the spec at `agent-selection.component.spec.ts` (`toContain('will overwrite')`) to assert the full marker so the regression is caught. Tasks stay IN_PROGRESS.

### Batch B-4 result, fix round 1 (team-leader, Mode 2, 2026-10-03) — ACCEPTED, COMMITTED

- On disk: `agent-selection.component.ts:539` renders `— will overwrite`, `:561` `(will overwrite if written)`; no U+FFFD in the component or spec. Spec asserts exact trimmed markers (`agent-selection.component.spec.ts:459-461` `toBe('— will overwrite')`, `:467-469` `toBe('(will overwrite if written)')`), so either mangled form fails.
- Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p @ptah-extension/setup-wizard` pass; `test -p @ptah-extension/setup-wizard --maxWorkers=2` pass.
- Review: none per batch (Part B review policy); covered by B-7.2.
- Committed `4d18d7088` (hooks ran), the four setup-wizard files only; `test-results/` and the task folder left unstaged.

## Rebase onto origin/main after #634 (team-leader, 2026-10-03)

- `git fetch origin`: origin/main `21c27d17f` → `f314a4f8a` (Merge PR #634). Working tree had no uncommitted source changes (only the untracked task folder and `test-results/`).
- `git rebase origin/main`: clean, 11/11 commits, no conflicts. Not pushed.
- Old HEAD `4d18d70881315d05bc00afa3ab736f7e809f3aec` (base `21c27d17f`) → new HEAD `165881e4a` (base `f314a4f8a`).
- Rebased commit map (old → new): `381449fba`→`62f1ad576`, `b5cc7ab43`→`ba965aa1c`, `5f52dfbc8`→`c2c4f9951`, `9d31e981d`→`b3dc1b83a`, `614afaabf`→`ec2387def`, `442317863`→`2b9af459f`, `c674de486`→`3a08ff540`, `fe98b57b5`→`045293092`, `ae794adae`→`4b1fa6135`, `263832daf`→`b4f8d4b31`, `4d18d7088`→`165881e4a`. SHAs recorded earlier in this file are pre-rebase; use this map.
- Post-rebase check: `npx nx run-many -t typecheck -p shared,harness-sync,agent-generation,rpc-handlers,skill-synthesis-ui,setup-wizard` — all 6 pass (0/6 cache).
- Batches 3/4 (Part A) and B-5/B-6 are now unblocked on #634; a short Mode 1 refresh re-checks their line references and file counts against the rebased tree before any start.

## Batch B-5: C6 agent model control, backend — split into B-5a..B-5g (refreshed 2026-10-03 after #634)

- Precondition met: #634 merged, rebased (`165881e4a`). Plan C6 test list (implementation-plan.md:133) is the acceptance list, distributed below; review fixes 1 and 4 (implementation-plan.md:204, :207) apply.
- Executors: backend-developer for judgement-heavy sub-batches; Codex-allowed CLI lane (ceiling ≤40) for narrow ones. Lanes never run git.
- Validation notes for all: PR8 (`rpc.types.ts` only in B-5g), PR9.

### B-5a: shared contract (classifier, resolver) — COMPLETE (e7a347322)

- Recommended executor: backend-developer (sub-agent) | Fallback: CLI lane, ceiling 40 | Mode: sequential
- Rationale: the classify⇒emittable invariant and the OpenCode exception are the core of C6; judgement.
- Depends on: none | Projects: `@ptah-extension/shared`
- Files: `W\libs\shared\src\lib\types\agent-models.types.ts` (CREATE), `W\libs\shared\src\lib\types\agent-models.types.spec.ts` (CREATE), `W\libs\shared\src\index.ts`
- Task B-5a.1 — COMPLETE: types `AgentModelProvider` (`claude|codex|copilot|cursor|opencode`), `AgentModelEntry`, `AgentModelSettingsValue` (`Record<slug|'*', Partial<Record<provider,string>>>`), `AgentModelLayers { workspace, machine }`, classification enum (Empty, Malformed, Listed, Unlisted, Unverifiable); `classifyAgentModelValue(provider, value, list|null)`, `isAgentModelEmittable(provider, value)`, `providerReported(list)` (drops fallback entries, so a fallback-only id is Unlisted), `resolveAgentModel(layers, slug, provider)` exactly per implementation-plan.md:125-131. Syntax per :126 (A-3 OpenCode `^[^\s/]+\/\S+$`). Malformed settings objects (non-object, non-string leaf) are ignored, never thrown on.
- Spec: every class per provider; listed-but-syntax-failing Codex → Listed; OpenCode listed-but-malformed → Malformed; fallback-only id → Unlisted; invariant over every class (classify accepts ⇒ emittable); precedence rows for Claude and Codex; never across providers.
- Check: `npx nx run-many -t typecheck,lint -p @ptah-extension/shared` then `-t test -p @ptah-extension/shared --maxWorkers=2`, tailed.
- Result (team-leader, Mode 2, 2026-10-03), accepted after fix round 1:
  - On disk: `agent-models.types.ts` matches plan :123-130. `resolveAgentModel` returns `AgentModelResolution { value, scope: 'workspace'|'machine', wildcard } | undefined`. Readers use own properties only, so `__proto__` and `constructor` never resolve. Non-object layers, entries and non-string leaves are skipped, never thrown on. `providerReported` drops `isFallback === true`. The OpenCode exception holds: listed but syntax-failing is `malformed`. `matchesAgentModelSyntax` is exported for 3b. Regexes use ASCII escapes; non-ASCII appears only in comments. The barrel adds one `export *` line.
  - Downstream contract changes recorded: 3b and B-5d read `.value`, and their task text is updated. Classification does not trim.
  - Fix round 1 (TS4111 at `:192-195`): the guard is `typeof layers !== 'object' || layers === null`, with behaviour unchanged.
  - Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p shared` pass; `typecheck -p agent-generation,rpc-handlers` pass; `test -p shared --maxWorkers=2` 84/84 suites, 2456 passed.
  - Review: none per batch; covered by B-7.2. Committed `e7a347322`, three files only.

### B-5b: settings-core `writeForPath` / `inspectForPath` + `AgentModelSettings` — COMPLETE (67cca83f8)

- Recommended executor: backend-developer | Fallback: CLI lane, ceiling 40 | Mode: sequential
- Depends on: B-5a | Projects: `@ptah-extension/settings-core`
- Files: `W\libs\backend\settings-core\src\scope\workspace-scope-resolver.ts`, `...\scope\workspace-scope-resolver.spec.ts`, `W\libs\backend\settings-core\src\repositories\agent-model-settings.ts` (CREATE), `...\repositories\agent-model-settings.spec.ts` (CREATE), `W\libs\backend\settings-core\src\di\tokens.ts` (`AGENT_MODEL_SETTINGS`), `W\libs\backend\settings-core\src\index.ts`
- Started 2026-10-03 after B-5a `e7a347322` (its only dependency). Types from `@ptah-extension/shared`: `AgentModelLayers`, `AgentModelSettingsValue`, `AgentModelProvider`.
- Task B-5b.1 — COMPLETE: `writeForPath(path, key, value)` / `inspectForPath` throw on empty/missing path (no global fallback); `AgentModelSettings.layersForPath(ws)` reads `workspace.<hash>.agentGeneration.models` + machine `agentGeneration.models`; `update(ws, slug, provider, value|null, scope)` is a per-physical-key promise-queued read-modify-write preserving unrelated slugs/providers. A-1 checked: confirm `vscode-settings-registration.ts` store persists arbitrary `workspace.<hash>.*` keys; report the evidence.
- Spec: `writeForPath('')` throws, global key unchanged; two concurrent `update`s on different providers of one slug both persist; unrelated entries preserved; two workspaces isolated (AC6); write failure keeps prior bytes.
- Result (team-leader, Mode 2, 2026-10-03):
  - Diff read. `WorkspaceScopeResolver.inspectForPath<T>(globalKey, workspacePath) → { key, value }` and `writeForPath<T>(globalKey, workspacePath, value)` both go through private `requireWorkspaceKey`, which throws when `normalizeActivePath` returns nothing. There is no global, app or default fallback, and the store is not touched before the throw. Argument order is `(globalKey, workspacePath[, value])`, matching `readForPath` and plan C6 :118.
  - `AgentModelSettings(store, resolver)`: `layersForPath(ws)` returns the raw `{ workspace, machine }` layers and throws on an empty path. `update(ws, slug, provider, value|null, scope)` validates the slug and provider and resolves the physical key before it queues. Inside a per-physical-key promise queue (`Map<key, tail>`, a tail that never rejects, released when idle) it re-reads the raw key, copies the map and changes one leaf (`defineOwn`, so `__proto__` is safe), then writes. Nothing read is mutated in place.
  - A-1 VERIFIED (evidence on disk): `vscode-settings-adapter.ts:70-85` routes file-based keys to `~/.ptah/settings.json`; `file-settings-keys.ts:742,755` (`/^(app|workspace)\./` ⇒ file-based) and `:176-179` (machine key, 3a); `file-settings-manager.ts:121-157` stores any key, atomic tmp+rename.
  - Specs: 9 resolver cases (`''`/blank/non-string throw with zero writes and global unchanged; same physical key as active `write`; isolation; `undefined` drops); 20 repository cases incl. concurrent different-provider and multi-key updates through a delayed store, failed write keeps the cached object unmutated and the queue keeps working, AC6.
  - Checks (team-leader, `--skip-nx-cache`): `typecheck,eslint:lint -p settings-core` pass (13 pre-existing warnings, none in the six files; direct `eslint` on them is clean); `test -p settings-core --maxWorkers=2` 8/8 suites, 195 passed.
  - Review: none per batch; covered by B-7.2. Committed `67cca83f8`, six files only.
- **Binding on B-5f2, B-5f3, B-5f4: exactly ONE `AgentModelSettings` instance per process.** Register it once as a singleton: `container.register(SETTINGS_TOKENS.AGENT_MODEL_SETTINGS, { useValue: new AgentModelSettings(reactiveStore, scopeResolver) })`, placed only inside the existing `WORKSPACE_SCOPE_RESOLVER` guard (vscode `vscode-settings-registration.ts:113-128`). Never use `useClass`, a factory that constructs on each resolve, or a second `new`. The write queue serialises only callers that share one instance. The lazy getter passed to the source resolver must resolve that same token; it must not construct its own instance.
- **Binding on B-5g: call `update(workspaceRoot, slug, provider, value, scope)` in exactly that order.** The batches.md order wins. Plan :122 shows `(workspacePath, scope, slug, provider, value)`; do not follow it. Machine-scope `update` does not validate `workspaceRoot`, so B-5g must require it, and check it against the active workspace, before calling `update`.

### B-5c: `CliModelListService` (list extraction from `agent:listCliModels`) — COMPLETE (d28ce1337)

- Recommended executor: CLI lane x 1 (Codex allowed), tool-call ceiling 40 | Fallback: backend-developer | Mode: sequential
- Rationale: mechanical extraction of an existing method body into a service; behaviour-preserving.
- Depends on: none | Projects: `@ptah-extension/rpc-handlers`
- Files: `W\libs\backend\rpc-handlers\src\lib\services\cli-model-list.service.ts` (CREATE), `...\services\cli-model-list.service.spec.ts` (CREATE), `W\libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts` (#634 file; list extraction only), `W\libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts` (registerSingleton), plus the existing agent-rpc spec that constructs the handler only if its constructor change breaks it.
- Task B-5c.1 — COMPLETE: move the body of `registerListCliModels` (`agent-rpc.handlers.ts:577-607`) and the helpers `getCopilotModelsFromHost` (`:637`), `getCodexModelsFromAuth` (`:656`) into `CliModelListService.listAll()`; the handler calls it; response shape byte-identical. Mark per entry whether it is provider-reported or fallback if the current code distinguishes them (needed by B-5a `providerReported`); if it does not, report how fallback entries can be told apart — do not invent a field without stating it.
- Spec: service returns the same map the handler returned before (Codex-auth and Copilot-host refinements included); a failing detector yields the existing fallback behaviour.
- Check: `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers` then `-t test -p @ptah-extension/rpc-handlers --maxWorkers=2`, tailed.
- Result (team-leader, Mode 2, 2026-10-03):
  - Diff read: `CliModelListService.listAll()` (`@injectable`, injects `CLI_DETECTION_SERVICE`, `MODEL_DISCOVERY`, `SDK_CODEX_AUTH`) holds the old handler body verbatim. It keeps the same six keys in the same order (codex, copilot, cursor, antigravity, opencode, pi), the same "non-empty live list replaces the detector list" rule, the same name mapping and `formatModelDisplayName`, and the same `degradation-audit` catches. A top-level `listModelsForAll` rejection still reaches the handler's catch, Sentry and rethrow. The handler drops `MODEL_DISCOVERY` and `SDK_CODEX_AUTH` for the one service argument. `registerSharedRpcHandlers` calls `registerSingleton(CliModelListService)`. The response is byte-identical: the spec asserts `JSON.stringify` equality on both the fallback and live paths.
  - Fixtures: in the four existing specs (`list-rows`, `migration`, `resume-parent-session`, `set-config`), the only change is the constructor (two imports and two args → one). No assertion changed.
  - Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p rpc-handlers` pass; `test -p rpc-handlers --maxWorkers=2` 138/138 suites, 4011 passed, 7 pre-existing skipped.
  - Review: none per batch; covered by B-7.2. Committed `d28ce1337`, eight files only.
- **Provenance finding and safe rule (binding on B-5d, B-5e, B-5g, B-6):**
  - The lane's finding is verified on disk: no CLI adapter sets `isFallback`. `CliModelInfo` (`cli-agent-runtime/.../cli-adapter.interface.ts:19`) is `{ id, name }` only. The curated and static lists are Codex `SUPPORTED_MODELS` (`codex-cli.adapter.ts:380`, returned by `listModels()` `:414`), Copilot `COPILOT_MODELS` (`copilot-sdk.adapter.ts:114`, `listModels()` `:234`) and Cursor `FALLBACK_MODELS` (`cursor-cli.adapter.ts:281`). Cursor's `listModels()` (`:290-303`) returns SDK results or `FALLBACK_MODELS` in the same shape, so provenance is lost before the service sees it. OpenCode, Pi and Antigravity `listModels()` are adapter-defined, with no provenance either. The `agent:listCliModels` response therefore cannot tell curated entries from provider-reported ones. An absent `isFallback` proves nothing.
  - Rule: an entry counts as provider-reported only when it comes from a live provider query. There are exactly two:
    - `CliModelListService.getCodexModelsFromAuth()` (`cli-model-list.service.ts:83`, `CodexAuthService.listModels()` `codex-auth.service.ts:302`), when it returns a non-empty list. This is the `codex` branch at `listAll()` `:32-35`.
    - `CliModelListService.getCopilotModelsFromHost()` (`cli-model-list.service.ts:64`, `IModelDiscovery.getCopilotModels()`), when it returns a non-empty list. This is the `copilot` branch at `:39-42`.
    Every other entry is fallback: detector lists via `cliDetection.listModelsForAll()` for every provider, including Codex and Copilot when their live list is empty, and Cursor and OpenCode always. A fallback entry is never `listed`. When a provider has no provider-reported list, its values classify `unverifiable` (or `malformed`), never `listed` and never `unlisted`.
  - Where the tagging lives: provenance is known only inside `CliModelListService.listAll()` (rpc-handlers). B-5d and B-5e (emission, harness-sync) never classify against a list. They gate on `isAgentModelEmittable` alone, so they need no provenance field and must not add one. Their only obligation is not to call `classifyAgentModelValue` with a CLI model list. The classifier consumers are B-5g (`setAgentModel`) and B-6 (labels). They get provenance from new batch **B-5c2** (below), which keeps `agent:listCliModels` byte-identical. Safe default if B-5c2 has not landed: B-5g passes `list = null` for every provider (all values `unverifiable`, never `listed`).

### B-5c2: provider-reported model lists with provenance — COMPLETE (8fffc0652)

- Recommended executor: CLI lane x 1 (Codex allowed), tool-call ceiling 30 | Fallback: backend-developer | Mode: sequential
- Rationale: two files in one service whose live branches are already isolated. Mechanical, with no change to the existing response. Split from B-5g so B-5g stays within the 6-file cap.
- Depends on: B-5a, B-5c (committed) | Blocks: B-5g | Projects: `@ptah-extension/rpc-handlers`
- Files (exactly these): `W\libs\backend\rpc-handlers\src\lib\services\cli-model-list.service.ts`, `W\libs\backend\rpc-handlers\src\lib\services\cli-model-list.service.spec.ts`
- Task B-5c2.1 — COMPLETE: add `listForClassification(): Promise<Record<AgentModelProvider, AgentModelEntry[]>>` (types from `@ptah-extension/shared`). For `codex`, return the `getCodexModelsFromAuth()` entries when non-empty. For `copilot`, return the `getCopilotModelsFromHost()` entries when non-empty. Every other entry, including every detector entry for Codex and Copilot when their live list is empty and every entry for `cursor`, `opencode` and `claude` (`claude`: `[]`), is returned with `isFallback: true`. Reuse the private helpers, with one `listModelsForAll()` call and no second copy of the refinement rule. Factor a private helper shared with `listAll()` if needed. `listAll()` output stays byte-identical, and its existing `JSON.stringify` cases stay green unchanged.
- Spec: live Codex list → those entries have no `isFallback`. Empty Codex auth → detector Codex entries all have `isFallback: true`. Same pair for Copilot. Cursor SDK-shaped entries → `isFallback: true`. `providerReported(listForClassification().cursor)` is empty. `listAll()` is unchanged on both paths.
- Check: `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers` then `-t test -p @ptah-extension/rpc-handlers --maxWorkers=2`, tailed.
- Result (team-leader, Mode 2, 2026-10-03):
  - Diff read: the old `listAll()` body is now the private `loadModels()`, which returns `{ models, codexReported, copilotReported }`. Each flag is `live.length > 0`, captured before the detector fallback. `listAll()` returns `.models`, and its keys, order and values are unchanged. `listForClassification()` returns exactly `{ claude: [], codex, copilot, cursor, opencode }`. Live Codex/Copilot entries are returned as-is (`{id,name}` from the auth/host helpers, with no `isFallback`). Every other entry is a fresh copy, `{ ...entry, isFallback: true }`, which also overrides a detector `isFallback: false`, and the detector arrays are not mutated. There is one `listModelsForAll()` per invocation and the refinement rule exists once.
  - Spec: the diff removes no existing line, so every `listAll()` `JSON.stringify` case is unchanged. 7 new cases: live Codex and live Copilot with no `isFallback`, surviving `providerReported`, one call each. Empty Codex and empty Copilot entries are all fallback, `providerReported` is empty and the source is unmutated. Cursor and OpenCode are fallback, `claude: []` and there are exactly five keys. Missing keys give empty arrays. Failed live queries fall back.
  - Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p rpc-handlers` pass (48 pre-existing warnings, none in the two files; direct `eslint` and `prettier --check` on them are clean); `test -p rpc-handlers --maxWorkers=2` 138/138 suites, 4018 passed (4011 + 7), 7 pre-existing skipped.
  - Review: none per batch; covered by B-7.2. Committed `8fffc0652`, two files only.

### B-5d: harness-sync emission core — COMPLETE (48877e550)

- Recommended executor: backend-developer | Fallback: CLI lane, ceiling 40 | Mode: sequential
- Depends on: B-5a | Projects: `@ptah-extension/harness-sync`
- Files: `W\libs\backend\harness-sync\src\lib\sources\harness-source.port.ts`, `...\manifest\desired-state.types.ts`, `...\manifest\harness-manifest.builder.ts`, `...\manifest\harness-manifest.builder.spec.ts`, `...\targets\workspace-target.ts`, `...\targets\transformers\agent-transformer.port.ts`
- Task B-5d.1 — COMPLETE: `HarnessSourceState.agentModels?: AgentModelLayers`; builder sets `HarnessDesiredAgent.models?` per provider from `resolveAgentModel(layers, slug, provider)?.value` (B-5a returns `{ value, scope, wildcard } | undefined`), gated by `isAgentModelEmittable(provider, value)` (non-emittable → skipped with `logger.warn`). Emission never classifies against a CLI model list, so there is no `classifyAgentModelValue` call and no provenance field here (see the B-5c provenance rule); `sourceHash` folds the model only when present (AC8: no model ⇒ hash byte-identical to today); transformer port gains optional `model`. Keep `workspace-target.ts` additions minimal (PR1).
- Spec: non-Claude empty with Claude set → no field (AC4); hash unchanged without models; model present changes hash.
- Result (team-leader, Mode 2, 2026-10-03):
  - Diff read: `HarnessSourceState.agentModels?`, `HarnessDesiredAgent.models?` (rival providers only, absent when none), `HarnessAgentSource.model?`. Builder `resolveAgentModels` iterates `AGENT_MODEL_PROVIDERS` minus `claude`, takes `resolveAgentModel(...)?.value`, gates on `isAgentModelEmittable`, warns (slug/provider/scope/wildcard, never the value) on a skip. No `classifyAgentModelValue` call, no provenance field (B-5c rule held). No import cycle: the builder does not import `workspace-target.ts`.
  - Choice 1, per-target hash folding — ACCEPTED. `contentHash` stays `hashFile(source)`; `desiredAgentSourceHash(agent, target)` returns `contentHash` unchanged when that target has no model, else `hashContent(contentHash + "\nmodel:" + model)`. AC8 holds: spec case 2 asserts the agent object equals the pre-change shape and every target's source hash equals the file hash with no models and with empty layers. Changing the Codex model changes only the Codex source hash (spec case 3), so only the Codex copy is rewritten.
  - Choice 2, model carried on the plan write via the local `AgentModelPlanWrite = HarnessPlanWrite & { model?: string }` in `workspace-target.ts`, read in `writeArtifact` with an `in` + `typeof` guard — ACCEPTED for now. Plan and apply render the same bytes (spec case 6: plan write hash = written hash = `hashContent(file)`). Follow-up **FU-4** below moves it to `HarnessPlanWrite.model?`. Not folded into B-5e: B-5e is at its 6-file cap and the move needs `harness-target.port.ts` + `workspace-target.ts`, neither in B-5e's list.
  - Gap: the skipped-model warning is silent in production because `di/register.ts:134` still constructs `new HarnessManifestBuilder()` with the default no-op `warn`. Assigned to B-5f1 (next batch that owns harness-sync wiring; within its cap), see there.
  - Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p harness-sync` pass (pre-existing max-lines warning in `workspace-target.ts` only, 1293 lines). `test -p harness-sync --maxWorkers=2`: 6 suites / 18 tests failed of 494 = the 17-test baseline (agent-consent 2, skill-consent 7, gitignore E23 5, cancellation B8 2, write-failure E21 1) + the known capability-policy C3 flake. None in a B-5d file; `harness-manifest.builder.spec.ts` 16/16.
  - Review: none per batch; covered by B-7.2. Committed `48877e550`, the six files only.

### Follow-up FU-4: move the agent model onto `HarnessPlanWrite` — COMPLETE (6d9dcba5e)

- Result (team-leader, Mode 2, 2026-10-04): verified on disk — `HarnessPlanWrite.model?: string` (agents-only doc) added in `harness-target.port.ts`; `AgentModelPlanWrite` deleted (no references left in `libs/`), `writes: HarnessPlanWrite[]`, `writeArtifact` reads `write.model`. Executor: Codex lane, report `fu4-executor-report.md`.
- Checks (team-leader, `--skip-nx-cache`): typecheck + lint pass; tests 18 failed / 525 passed of 543 = the 17-test baseline + capability-policy C3 (reconciler `baseEntries`, no `workspace-target` import, fails alone too — pre-existing, not FU-4). Committed `6d9dcba5e`, the 2 files only, hooks passed. Review: none (type-only, behaviour-preserving).

- Add `model?: string` (doc: agents only, the model the transformed copy carries) to `HarnessPlanWrite` in `W\libs\backend\harness-sync\src\lib\targets\harness-target.port.ts`; in `W\libs\backend\harness-sync\src\lib\targets\workspace-target.ts` delete the local `AgentModelPlanWrite` type, type `writes` as `HarnessPlanWrite[]`, and read `write.model` directly in `writeArtifact`. Behaviour unchanged; B-5d spec case 6 must stay green. Two files, harness-sync only; may be folded into any later harness-sync batch with room (B-5f1 would reach 6 files with it — allowed only if that batch's executor has budget; default: separate small batch after B-5f1).

### B-5e: four transformers — COMPLETE (89fb3c5d3)

- Recommended executor: CLI lane x 1, ceiling 40 | Fallback: backend-developer | Mode: sequential
- Depends on: B-5d | Projects: `@ptah-extension/harness-sync`
- Files: `...\targets\transformers\{codex,copilot,cursor,opencode}-agent-transformer.ts`, `agent-transformers.spec.ts`, `opencode-agent-transformer.spec.ts`
- Task B-5e.1 — COMPLETE: emit `model` only when given, quoted/escaped per format (Codex TOML `model = "…"`, Copilot `.agent.md` / Cursor frontmatter `model:`, OpenCode `model:`). A-2: one test per format; a format that cannot be confirmed is reported, and the provider is listed as unsupported for B-5g (refused up front), never accepted then dropped.
- Result (team-leader, 2026-10-03): verified on disk. No model gives byte-identical output in all four transformers (Codex `tomlBasicString` keeps its legacy escaping by default; Copilot/Cursor return `transformAgentContent` unchanged; OpenCode spreads an empty array). `model` is emitted once: Copilot/Cursor insert it after the leading `---\n` that `rewriteFrontmatter` always produces (`transform-rules.ts:281-284`), and because that frontmatter is fully rewritten, a source `model:` cannot be duplicated. Escaping: Codex is a TOML basic string with every control character as `\uXXXX`; the others use `yamlDoubleQuoted` (it drops `\r` and turns `\n` into a space, which is lossy but unreachable because B-5d's `isAgentModelEmittable` gates the value first). Typecheck and lint pass. Tests: 491 pass and 17 fail, all 17 being the known baseline (agent-consent 2, skill-consent 7, E23 5, B8 2, E21 1); capability-policy C3 passed this run. Only the six batch files were committed, and the hooks passed. Executor report: `b5e-executor-report.md`. Review: none per batch; B-7.2 covers it.
- **A-2 provider list for B-5g:** supported providers are codex, copilot, cursor and opencode. No provider is unsupported. The support was confirmed from each CLI's documented agent format, not from live inference, so availability of a given model on an account is still a provider-side matter.

### B-5f1: source resolver reads agent models — COMPLETE (4fe3cae22)

- Recommended executor: CLI lane x 1, ceiling 30 | Fallback: backend-developer | Mode: sequential
- Depends on: B-5e | Projects: `@ptah-extension/harness-sync`
- Files: `W\libs\backend\harness-sync\src\lib\sources\plugin-config-source-resolver.ts`, `...\sources\plugin-config-source-resolver.spec.ts`, `W\libs\backend\harness-sync\src\lib\targets\rival-targets.agent-model.spec.ts` (CREATE), `W\libs\backend\harness-sync\src\lib\di\register.ts` (added 2026-10-03 from B-5d's gap)
- Task B-5f1.2 — COMPLETE (from B-5d): `di/register.ts:134` becomes `new HarnessManifestBuilder((message, detail) => logger.warn(message, toDetail(detail)))`, the same pattern as `ManagedManifestStore` two lines above, so the skipped-model warning reaches the host log. One line; no spec required beyond the existing register specs staying green.
- Task B-5f1.1 — COMPLETE: `createPluginConfigSourceResolver` accepts an optional second lazy getter `() => { layersForPath(ws) } | null`; resolver fills `agentModels` for the reconcile workspace (`resolveHarnessWorkspaceRoot`); getter absent/null/throws ⇒ `agentModels` undefined (hosts without the factory byte-identical). End-to-end spec: model change rewrites the rival copy with no `overwrittenLocalEdit`; listed-but-syntax-failing Codex value emitted.
- Result (team-leader, 2026-10-03): commit `4fe3cae22`, 5 files (resolver + spec, `di/register.ts`, new `targets/rival-targets.agent-model.spec.ts`, `src/index.ts` barrel `type AgentModelsFactory` added by orchestrator). Fix round 1 changed the API: the getter is the **4th** optional parameter, `createPluginConfigSourceResolver(readerFactory, layout?, mcpIntents?, agentModelsFactory?)`, so the existing `layout`/`mcpIntents` callers are unchanged. B-5f2/3/4 hosts pass `undefined, undefined, getter`, or the existing layout/intents. Verified on disk: `readAgentModels` returns undefined for an empty root or an absent, null or throwing getter or `layersForPath`, and spreads `agentModels` only when it is defined, so the output is byte-identical without the getter. All three return paths (empty, sync policy, effective policy) are covered. The builder warn is wired the same way as `ManagedManifestStore`. Checks: harness-sync lint passed. The first typecheck run failed only at `workspace-target.ts:875` (A-FIX-1 in flight, not B-5f1). A direct `tsc` re-run on the lib and spec tsconfigs was clean. The filtered harness-sync tests passed 9/9 suites, 72/72 tests. rpc-handlers typecheck passed (preview-fidelity factory caller).

### B-5f2 / B-5f3 / B-5f4: host registration + wiring (one host each) — COMPLETE (15d845bd2, one commit for all three hosts)

- Recommended executor: CLI lanes x 3, one per host, ceiling 25 each | Fallback: backend-developer (one at a time) | Mode: parallel
- Rationale: file-disjoint and project-disjoint; each is a registration line + a getter argument.
- Depends on: B-5b, B-5f1
- B-5f2 VS Code: `W\libs\backend\platform-vscode\src\settings\vscode-settings-registration.ts`, `W\apps\ptah-extension-vscode\src\di\phase-2-libraries.ts` (`:173-174`). Projects: `platform-vscode`, `ptah-extension-vscode`.
- B-5f3 Electron: `W\libs\backend\platform-electron\src\settings\electron-settings-registration.ts`, `W\apps\ptah-electron\src\di\phase-2-libraries.ts` (`:213-215`). Projects: `platform-electron`, `ptah-electron`.
- B-5f4 CLI: `W\libs\backend\platform-cli\src\settings\cli-settings-registration.ts`, `W\libs\backend\cli-engine\src\lib\container.ts` (`:669-670`). Projects: `platform-cli`, `cli-engine`.
- Each: register `SETTINGS_TOKENS.AGENT_MODEL_SETTINGS` next to `SKILL_SYNTHESIS_SETTINGS` (only where `WORKSPACE_SCOPE_RESOLVER` is registered; follow its guard), pass the lazy getter (`container.isRegistered(...) ? resolve : null`). A-5: B-5f3 reports whether Electron reloads the view on workspace switch.
- Check per lane: `npx nx run-many -t typecheck,lint -p <its two projects>` then `-t test ... --maxWorkers=2`, tailed.
- Result (team-leader, Mode 2, 2026-10-04): three Codex lanes, reports `b5f2-`, `b5f3-`, `b5f4-executor-report.md`. Diffs read on disk.
  - Wiring: each `*-settings-registration.ts` registers `SETTINGS_TOKENS.AGENT_MODEL_SETTINGS` with `useValue: new AgentModelSettings(reactiveStore, scopeResolver)` exactly once, inside the existing `if (scopeResolver)` block after `WORKSPACE_SCOPE_RESOLVER`. This satisfies the B-5b single-instance binding: no `useClass`, no factory, no second `new`. Each host passes `undefined, undefined, () => container.isRegistered(AGENT_MODEL_SETTINGS) ? container.resolve(...) : null` as the 4th argument of `createPluginConfigSourceResolver`. VS Code `phase-2-libraries.ts`, Electron `phase-2-libraries.ts` and CLI `container.ts` previously passed only the reader factory, so `layout` and `mcpIntents` stay undefined, as before.
  - One commit for the three hosts: they share one pattern, and the getter is inert without the registration.
  - Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p platform-vscode, ptah-extension-vscode, platform-electron, ptah-electron, platform-cli, cli-engine` all pass. The B-5f3 app typecheck failure was B-5g in flight in `rpc.types.ts` and is gone after `846d6f3f2`. Tests: platform-vscode 18/18 suites (211 passed); platform-cli 15/15 (256 passed); cli-engine 21/21 (215 passed). The lane's 8 failed suites were the in-flight `rpc.types.ts`, and none remain. platform-electron: 36 passed, 1 failed, 2 skipped; the 1 failure was `workspace-watch-host.stress.spec.ts` (3 tests). Its message: `dist/apps/ptah-electron/workspace-watch-host.mjs is missing; run npx nx run ptah-electron:build-workspace-watch-host first` (spec `:83`). That is an environment precondition: the artifact was absent in this worktree and present in the main checkout. After `npx nx run ptah-electron:build-workspace-watch-host` (gitignored `dist/`), the spec passes 3/3. Not a regression, and no main-checkout run was needed.
  - **A-5 finding (B-5f3, Electron workspace switch):** Electron does not reload the webview or rebuild DI on a workspace switch. `workspace:switch` (`workspace-rpc.handlers.ts:319,329`) calls `setActiveFolder`. `electron-workspace-provider.ts:171-188` fires the folders-changed event. `apps/ptah-electron/src/activation/workspace-restore.ts:155-194` sends `WORKSPACE_CHANGED` to the same renderer, and the frontend re-syncs (`electron-layout.service.ts:111-127`, `vscode.service.ts:100-106`). The single `AgentModelSettings` stays correct across switches: `layersForPath` takes an explicit root, and `WorkspaceScopeResolver` reads the live `getActivePath` getter. Consequence for B-6: the model editor must re-load on `WORKSPACE_CHANGED`. A stale `workspaceRoot` is refused server-side with `UNAUTHORIZED_WORKSPACE` (B-5g), never written to the wrong key.
  - Review: none per batch; covered by B-7.2.

### B-5g: `skillSynthesis:getAgentModels` / `:setAgentModel` RPC — COMPLETE (846d6f3f2)

- Recommended executor: backend-developer | Fallback: CLI lane, ceiling 40 | Mode: sequential
- Depends on: B-5b, B-5c, B-5c2, B-5e (unsupported-provider list) | Projects: `@ptah-extension/shared`, `@ptah-extension/rpc-handlers`
- Classification list (B-5c provenance rule): classify with `CliModelListService.listForClassification()` (B-5c2), never with `listAll()` / the `agent:listCliModels` response. `getAgentModels` returns classifications computed from that list, so B-6 does not classify from `agent:listCliModels` either (B-6 uses that response for the datalist only).
- Files: `W\libs\shared\src\lib\types\rpc\rpc-skill-clone.types.ts`, `W\libs\shared\src\lib\types\rpc.types.ts`, `W\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.ts`, `...\skills-synthesis-rpc.handlers.spec.ts`, `...\skills-synthesis-rpc.schema.ts`, `...\skills-synthesis-rpc.schema.spec.ts` (pattern: B-2b commit `3a08ff540`)
- Task B-5g.1 — COMPLETE: `getAgentModels {workspaceRoot}` returns layers + per-provider classification + unsupported providers; `setAgentModel {workspaceRoot, slug, provider, value|null, scope, confirmUnlisted?}` requires `workspaceRoot` and refuses when it is not the active workspace (switched between load and save → refused, neither key changed); classifies with the `CliModelListService` list (server wins); Malformed → refused; Unlisted without `confirmUnlisted` → refused "needs confirmation"; unsupported provider → refused "not supported for <provider>"; zod `SlugSchema`. Never calls reconcile (the UI does).
- Spec: missing `workspaceRoot` → refused, global key unchanged; workspace switch; Unlisted with/without confirmation; OpenCode listed-but-malformed refused; save failure keeps prior bytes.
- Result (team-leader, Mode 2, 2026-10-04): executor backend-developer, report `b5g-executor-report.md`. Diff read on disk.
  - Binding notes held: `settings.update(workspaceRoot, parsed.slug, provider, value, parsed.scope)` (spec asserts with `toHaveBeenCalledWith`). `workspaceRoot` is required by zod on set (non-blank, also for machine scope) and checked by `requireActiveWorkspace` on entry and again after the list read. Comparison is exact (`resolveHarnessWorkspaceRoot(requested) === active`). Classification uses only `listForClassification()` (no `listAll` call in the new code). No reconcile dependency or call. A refused switch leaves both keys unchanged (spec: full-store snapshot equality, workspace and machine scope).
  - Deviations, each ACCEPTED: (1) `getAgentModels.workspaceRoot` optional — when absent it reads only the active root (`quarantineWorkspaceRoot()`), and when present it must equal the active root, so no path reads another workspace's layers. (2) Unlisted without confirmation → `MODEL_NOT_AVAILABLE`: a distinct code, so B-6 need not parse messages; nothing is written. (3) 15 s list timeout ⇒ `lists = null`. Malformed is still refused without a list, because `classifyAgentModelValue` (`agent-models.types.ts:130-137`) returns `malformed` on control characters or failed syntax before it looks at the list. OpenCode listed-but-malformed returns `malformed` at `:135` and is refused (spec case 15). Timeout path not spec-covered; recorded for B-7.2. (4) No `AgentModelSettings` on the host ⇒ `PERSISTENCE_UNAVAILABLE`, nothing written. (5) Call-time lookup through the optional `PLATFORM_TOKENS.DI_CONTAINER` matches the existing pattern.
  - File size: `skills-synthesis-rpc.handlers.ts` is 3137 lines (was 2762), well past the 1000-line mark. The pre-existing max-lines warning grows; it is not split here. Recorded for FU-3/B-7.2 as a deliberate size note: the agent-model methods (~380 lines) are a natural extraction candidate.
  - Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p shared,rpc-handlers` pass; `test -p shared,rpc-handlers --maxWorkers=2` pass (executor counts: shared 84/84 suites, 2456 tests; rpc-handlers 138/138 suites, 4067 passed, 7 pre-existing skipped).
  - Review: none per batch; covered by B-7.2. Committed `846d6f3f2`, the six files only, hooks passed.

## Batch B-6: C6 agent model control, frontend — COMPLETE (7be71f54e)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: none
- Execution mode: sequential
- Rationale: model editor UI with classification, confirmation and the reconcile guard; judgement on labels and failure copy.
- Tasks: 1 | Depends on: B-5g (and so all of B-5), B-3b committed
- Projects: `@ptah-extension/skill-synthesis-ui`
- Files (exactly these; re-verified on disk 2026-10-03, the two CREATE files are absent):
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-model-editor.component.ts` (CREATE)
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-model-editor.component.spec.ts` (CREATE)
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.ts`
  - `W\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.ts`
  - `W\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.ts`
  - `W\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.spec.ts`

### Task B-6.1: Inline model section on agent cards — COMPLETE

- Plan reference: implementation-plan.md:8, :131
- Quality requirements: effective value + source (Claude nothing set → "template"); empty non-Claude rows show `inherits: <model> (lane default)` from `agent:getConfig` or `inherits: CLI default`; datalist from `agent:listCliModels`; shared classifier labels; Unlisted → confirmation; machine scope copy (AC7); save = guard (only when edits exist) → `setAgentModel {workspaceRoot}` → `store.reconcile()`; cancel saves nothing; save failure keeps previous value + reason; reconcile failure → "saved; provider copies not updated: <reason>" with Sync to retry; unsupported provider rows disabled. Per-subagent reasoning effort out of scope.
- RESOLVED DESIGN POINT (was open after B-3a; B-3a's guard is not changed): option (a), the lower-risk one. When the guard cannot read harness health freshly (call in flight, read failure, no report) and `confirm` resolves `false` for that reason, the row shows "Could not check for hand-edited files; nothing was saved." with a Retry button that re-runs the guard and, on success, the same save. The typed value stays in the input; `setAgentModel` is NOT called. Reason: settings and provider copies never diverge, no new "save without syncing" branch, and PR7 holds unchanged. The editor must tell this case apart from a user Cancel (Cancel: no message, value reverts); if the guard's return does not expose the reason, read it from the guard's existing state/result without editing `reconcile-guard.ts`, and report how.
- Spec: health-read failure → `setAgentModel` not called, message + Retry shown; Retry after recovery → saved once; user Cancel → no call, no failure message.
- Contract notes from B-5g / A-5 (added 2026-10-04): load with `skillSynthesis:getAgentModels` and send its `result.workspaceRoot` back to `setAgentModel` verbatim. Label rows from `result.classification`, or from `classifyAgentModelValue` over `result.lists` for typed values; never from `agent:listCliModels`. `MODEL_NOT_AVAILABLE` means confirm, then resend with `confirmUnlisted: true`. `INVALID_PARAMS` on a value means malformed; show the server message. `UNAUTHORIZED_WORKSPACE` means reload the models. `PERSISTENCE_UNAVAILABLE` means the host has no settings, or the save failed. Re-load on `WORKSPACE_CHANGED`, because Electron does not reload the view (A-5).

### Batch B-6 verification

- Six files only; `npx nx run-many -t typecheck,lint -p @ptah-extension/skill-synthesis-ui` then `-t test ... --maxWorkers=2`, tailed
- Result (team-leader, Mode 2, 2026-10-04). Accepted. Report: b6-executor-report.md.
  - On disk: `AgentModelsStore` (view-provided `@Injectable()`) and `AgentModelEditorComponent` (standalone, OnPush, signals/`inject()`, no `[innerHTML]`, no CDK). The card hosts the editor only when `modelGuard` is set. The view passes the guard only on the Agents tab, provides the store, and loads it on tab entry and on Refresh. RPC: `getAgentModels`, `setAgentModel` (a refusal comes back as `{ok:false, code, message}`), `listCliModels`, `getAgentLaneConfig`.
  - Save flow (`agent-model-editor.component.ts:759-819`): guard(`onlyWhenEdits`), then `setAgentModel` with `snapshot.workspaceRoot` verbatim, then `applySaved` and `harness.reconcile()`. A reconcile error shows `Saved; provider copies not updated: <reason>` with Sync. `MODEL_NOT_AVAILABLE` asks for confirmation and resends with `confirmUnlisted: true`. `UNAUTHORIZED_WORKSPACE` reloads the models. `INVALID_PARAMS`, `PERSISTENCE_UNAVAILABLE` and any other refusal or throw show `Not saved: <server message>`; the store is untouched, so the row keeps its previous value. Unsupported providers are disabled. The store reloads on a `workspaceRoot` change. The datalist comes from `listCliModels` only; labels come from `classification` or from `classifyAgentModelValue` over `snapshot.lists`. The AC7 copy shows when machine scope is selected. An empty row shows `inherits: <m> (lane default)` or `inherits: CLI default`. Claude with nothing set shows `template`.
  - Guard failure vs Cancel (`:825-840`, `reconcile-guard.ts` unchanged), verified against `reconcile-guard.ts:266-298` and `harness-health.store.ts:105-138,285-291`:
    - A Cancel can only happen after `refresh({refresh:true})` succeeded with a non-null report. `applyReport` then sets `_health` to `result.data.health`, an object freshly deserialised from the RPC reply (`postMessage`/IPC; the RPC service has no cache). So after a real Cancel, `health() !== before` and the error is `null`.
    - An unchanged reference arises only from (a) busy at call time or guard re-entry (`inFlight`), where no read happens, or (b) a mock that returns the same object.
    - Possible misclassifications run one way only, toward "unverified". This happens when a background reconcile from another surface sets `error` while the Cancel modal is open, or on re-entry. The result is the safe case: `GUARD_FAILED_COPY` with Retry, nothing saved, and the typed value kept. A real guard failure can never read as Cancel: busy, error and null are each checked directly.
  - Checks (team-leader, `--skip-nx-cache`): `typecheck,lint -p skill-synthesis-ui` pass, with max-lines warnings only. `test -p skill-synthesis-ui --maxWorkers=2` pass (executor counts: 35/35 suites, 597 tests).
  - Size (warn, accepted): `agent-model-editor.component.ts` is 765 counted lines (> 700), and `skill-clones-view.component.ts` is 739 (was 730). **Folded into FU-3:** move `AgentModelsStore` to `clones/agent-models.store.ts`, with no behaviour change.
  - Notes for B-7.2:
    - (1) **Missing view-level wiring spec.** `skill-clones-view.component.spec.ts` has no `getAgentModels` mock, and nothing checks that cards get `modelGuard` only on the desktop Agents tab or that Refresh/tab entry reloads the models. Add it in the B-7.2 fix round or FU-3.
    - (2) `HarnessHealthStore.reconcile()` returns early when a reconcile is already running (`harness-health.store.ts:152`). After a save, `reportReconcile` then reads a `null` error and shows no notice, although this save's reconcile did not run. The in-flight pass may still pick up the new settings. Check whether this needs a notice.
    - (3) The unlisted-model confirmation is inline in the row, not a modal. The in-row Sync does not emit to the view.
  - Review: none per batch; covered by B-7.2. Committed `7be71f54e`, the six files only, hooks passed.

## Batch B-7: AFTER screenshots, combined Part B review, QA — COMPLETE except QA (Mode 3 2026-10-04, completion-report.md; HEAD dc5bc09f3; Gate 3 QA pending)

- Recommended executor: visual-reviewer (screenshots) → code-logic-reviewer (one review) → orchestrator-selected QA
- Execution mode: sequential
- Tasks: 3 | Depends on: B-6 committed (see run-defaults note if #634 slips)

### Task B-7.1: AFTER screenshots, dark + light — COMPLETE (visual-b7-report.md, 34 files; light guard/preview modals predate B-FIX-3, re-capture recommended in completion-report.md)

- Output: `W\.ptah\specs\TASK_2026_609_c495\screenshots\after-agents-{dark,light}.png`, `after-wizard-{dark,light}.png` (+ extra states as separate files), same viewport as B-0.
- Content (implementation-plan.md:164-166): chips incl. missing + edited; guard modal; quarantine panel incl. `source-restored` and gate-disabled copy; not-owned label; model section with an inherited row; wizard preview modal incl. conditional group.

### Task B-7.2: One code-logic review on the combined Part B diff — COMPLETE (partb-review-{lanes,backend,frontend}.md → B-FIX-1/2/3 → partb-recheck.md APPROVED WITH NOTES 9/10)

- Range: Part B commits only (from the first Part B commit's parent to HEAD, excluding Part A Batches 3/4 commits — list the Part B SHAs from this file's batch headers).
- Part B commit list (post-rebase SHAs, oldest first, checked against `git log` on 2026-10-04). Review these commits individually (`git show <sha>`); this is not a contiguous range, because Part A commits are interleaved:
  1. `b3dc1b83a` B-1 — harness health `localEdit`/`agentsInSync` + snapshot-before-overwrite (pre-rebase 9d31e981d)
  2. `2b9af459f` B-1b — export the per-agent sync selection rule (pre-rebase 442317863)
  3. `ec2387def` B-2a — quarantine list + restore core (pre-rebase 614afaabf)
  4. `3a08ff540` B-2b — quarantine RPC contract + handler (pre-rebase c674de486)
  5. `4b1fa6135` B-2c — `wizard:preview-generation` backend (pre-rebase ae794adae)
  6. `045293092` B-3a — chips rule, reconcile guard, RPC client methods (pre-rebase fe98b57b5)
  7. `b4f8d4b31` B-3b — quarantine panel, card chips, Sync wiring (pre-rebase 263832daf)
  8. `165881e4a` B-4 — wizard preview step (pre-rebase 4d18d7088)
  9. `e7a347322` B-5a — shared classifier + resolver
  10. `d28ce1337` B-5c — `CliModelListService` extraction
  11. `67cca83f8` B-5b — settings-core path-explicit writes + `AgentModelSettings`
  12. `8fffc0652` B-5c2 — provider-reported lists with provenance
  13. `48877e550` B-5d — harness-sync emission core
  14. `89fb3c5d3` B-5e — four transformers
  15. `4fe3cae22` B-5f1 — source resolver reads agent models
  16. `6d9dcba5e` FU-4 — agent model on `HarnessPlanWrite` (type-only, part of the B-5 work)
  17. `846d6f3f2` B-5g — `skillSynthesis:getAgentModels`/`:setAgentModel` RPC
  18. `15d845bd2` B-5f2/f3/f4 — host registration + wiring
  19. `7be71f54e` B-6 — frontend agent model editor
- Excluded (Part A): `62f1ad576` (B2), `ba965aa1c` (B1a), `c2c4f9951` (B1), `43a330406` (3a), `4071ff138` (4), `3c2c52284` (3b), and the A-FIX commits `841263730`, `dc2e2b3fd`, `c1a631b21`, `bd05497c8`.
- B-6 notes to check: see "Notes for B-7.2" under Batch B-6 (the missing view-level wiring spec; `reconcile()` returning early when a pass is already in flight).
- Checklist: PR1-PR10, PA-1..PA-5, plan "Review fixes" 1-6, preserve list (implementation-plan.md:146-154).
- At most one fix round (Blocking/Serious) as a follow-up commit; no re-review beyond confirming the cited lines.

### Task B-7.3: QA handoff — COMPLETE (team-leader checks 1-4 in completion-report.md; Gate 3 QA selection pending)

- Team-leader Mode 3 checks: before/after screenshots both themes (B-0 + B-7.1); preserve list row-by-row; write-path trace for `agentGeneration.models` (machine key vs `workspace.<hash>.agentGeneration.models`, `resolveHarnessWorkspaceRoot` on both save and emission) and for the restored source file.

## Part A fix round 2 (user-approved 2026-10-04, after code-logic-rereview.md 5/10) — COMPLETE (c1a631b21, bd05497c8); short scoped re-check due

User decision: one extra bounded fix round, then one short scoped re-check; no further rounds.

### A-FIX-3: retirement fails closed on unreadable regular files (harness-sync) — COMPLETE c1a631b21
- Result: `isFullyHashable` now reads every regular file through `isReadableFile` (`readFile`); any failure returns `false`, so the detached tree is kept. `content-hash.ts` is unchanged. Two regressions were added in `artifact-retirement.spec.ts` (an unreadable file whose recorded hash already carries the sentinel; an unreadable directory). Report: afix3-executor-report.md.
- Checks (team-leader): `typecheck,lint -p harness-sync,agent-generation` pass. `test harness-sync --maxWorkers=2 --skip-nx-cache`: 17 failed / 528 passed / 545. The same 5 baseline suites fail (agent-consent, skill-consent, gitignore E23, cancellation B8, write-failure E21), and C3 did not flake on this run. No new failure.
- Executor: backend-developer (sub-agent). Projects: `@ptah-extension/harness-sync`.
- Files: `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts`, `artifact-retirement.spec.ts`, and only if needed `libs/backend/harness-sync/src/lib/targets/harness-reconciler.retire-local-edit.spec.ts` (path as in A-FIX-1). `content-hash.ts` source-discovery semantics must NOT change.
- Task: the retirement-only preservation proof (coverage walk, `artifact-retirement.ts:214-242`) must prove every regular file is readable (e.g. read/open it, or a strict digest that throws instead of substituting the `unreadable` sentinel, `content-hash.ts:316`). Any read failure ⇒ keep the detached tree as the snapshot (removedLocalEdit), never delete. Regressions: unreadable regular file with sentinel-bearing recorded hash ⇒ tree preserved; unreadable directory ⇒ preserved.

### A-FIX-4: quarantine rollback never unlinks the original path (agent-generation) — COMPLETE bd05497c8
- Result: `placeExclusive` gains `onCopyFailure: 'remove-partial' | 'keep-dest'`. `putBack` uses `'keep-dest'`, so the live path is never unlinked, and Restore keeps `'remove-partial'`. The warning names both `staged` and `livePath`. Accepted trade-off: a partial copy may remain at the live path, while the complete bytes stay in history and the next pass sees a differing clone and keeps it. Regression added: the re-review #1 case (link unsupported, the copy fails, an editor file exists at the live path, and both files survive). Report: afix4-executor-report.md.
- Checks (team-leader): `test agent-generation --maxWorkers=2 --skip-nx-cache`: 36/36 suites, 1249 passed, 1 skipped.
- Executor: backend-developer (sub-agent). Projects: `@ptah-extension/agent-generation`.
- Files: `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts`, `user-layer-seed-quarantine.spec.ts`.
- Task: rollback (`putBack`, `:626`) must use a placement that never unlinks the destination on failure (the shared `placeExclusive` fallback cleanup `unlink(dest)` at `:1044` stays as is for Restore, which predates this task, unless the change is provably safe for Restore too). If exclusive placement cannot complete, keep the detached artifact in history, log/report the recovery path, slug fails. Regression: `link` unsupported + fallback copy fails after an editor creates the original path ⇒ replacement and detached bytes both survive.

### Part A re-check after fix round 2 (Codex lane, 2026-10-04) — code-logic-recheck.md, 6/10
- A-FIX-4 (`bd05497c8`): FIXED. 'keep-dest' never unlinks the live path; regression fails without the fix; partial live copy accepted (complete bytes stay in history, warning names both paths). Restore still uses 'remove-partial'.
- A-FIX-3 (`c1a631b21`): residual. The hash read (`artifact-retirement.ts:211`, sentinel on failure, `content-hash.ts:316`) and the readability read (`:243/:253`) are two separate reads. A transient failure in the hash read only, with a recorded hash that already holds the sentinel, still passes and deletes at `:182`. Narrow (needs a sentinel-bearing recorded hash AND a transient read failure).
- Per user decision (no further fix rounds): recorded as **FU-5**, disclosed at Gate 3. Fix: a retirement-only strict digest with `hashDir` semantics that throws on any read failure, compared with the recorded hash (a sentinel-bearing recorded hash can then never match); drop the separate readability read. Regression: a read failure injected in the hash read only.
- Process note: the re-check lane wrote over `code-logic-review.md` (role default name) instead of the requested file. The orchestrator moved its output to `code-logic-recheck.md` and restored the original review text from its session.

## B-7.1 / B-7.2 results and the Part B fix round (2026-10-04) — COMPLETE (fix commits 603808f5c, 1fa2b6cc8, 7dca3b7cc; re-check partb-recheck.md APPROVED WITH NOTES 9/10; CI-FIX dc5bc09f3 degradation-audit ratchet, comments only)

- B-7.1 visual (visual-b7-report.md, 7/10): 34 screenshots, all required states. Serious: light-theme warning text ~2.46:1 on guard + wizard preview modals (fixed in B-FIX-3). Moderate (follow-up FU-6): model section makes cards ~2.5x taller, card actions below the fold; badge wrapping in 2-col cards; cramped edit form.
- B-7.2 split cross-side (role preamble of `code-logic-reviewer` forbids git and fixes the file name; lanes respawned without `role`):
  - partb-review-lanes.md (subagent on lane commits): APPROVED WITH NOTES 8/10. Moderate → FU-7: Windows path case splits `workspace.<hash>` key (fix would rehash all workspace keys — separate task); resolver/registration model-read failures are silent (log).
  - partb-review-backend.md (Codex lane): CHANGES REQUIRED 5/10. #1 Blocking snapshotBeforeOverwrite race, #3 Serious model change overwrites edited copy without snapshot → B-FIX-1; #2 Serious Restore cleanup unlinks editor file → B-FIX-2; #4 Moderate preview mislabels foreign copy as overwrite → FU-8.
  - partb-review-frontend.md (Codex lane): CHANGES REQUIRED 6/10. #1, #2 Serious; #3, #4 Moderate (model silently not applied to lane copies); #5 Moderate (fixed with #1) → B-FIX-3; #6 Moderate wizard confirm-preview after destroy → FU-9.
- Fix round (one, per rule): B-FIX-1 harness-sync (backend-developer), B-FIX-2 agent-generation Restore (backend-developer), B-FIX-3 frontend + contrast (frontend-developer). Then one short scoped re-check (cross-side Codex lane), then team-leader Mode 3 and Gate 3.
- B-FIX-1 harness-sync (backend findings 1 + 3) — COMPLETE 603808f5c. `artifact-retirement.ts` (new `detachForOverwrite`, shared `detachExisting`; `snapshotLocalEdit`/`hashArtifact` deleted; `isProvablyUnchanged` untouched, so FU-5 stays a follow-up), `copy-engine.ts` (exclusive publish: non-recursive mkdir / `COPYFILE_EXCL`), `workspace-target.ts` (detach-then-exclusive-create; drift judged on the copy alone), new `workspace-target.overwrite-detach.spec.ts`. Accepted trade-off: when history cannot be written, an untouched copy's update fails and retries (fail-safe).
- B-FIX-2 agent-generation Restore (backend finding 2) — COMPLETE 1fa2b6cc8. `user-layer-seed-quarantine.ts` + spec: a published dest is never unlinked; a changed or partial dest returns `'conflict'` naming the snapshot; `removeOwnDest` and `'remove-partial'` deleted.
- B-FIX-3 frontend (findings 1-5 + light contrast) — COMPLETE 7dca3b7cc. The guard `check()` returns a per-call `approved | cancelled | unverified`, used by all 5 callers (Sync, model save, model Sync, Restore, Finish restore); it never approves once destroyed, including when destroyed during the health read. The editor's op counter, `AgentModelsTicket` and `DestroyRef` stop stale saves and syncs. The store discards stale loads and saves by revision and workspace epoch. A skipped reconcile (`SYNC_SKIPPED_COPY`) and `writeFailed` entries (`reconcileWriteFailures`) now show a notice pointing at Sync. The contrast fix is a solid `bg-warning text-warning-content` on these messages only, with no global token change. The setup-wizard edits are contrast-only, and finding 6 (FU-9) is not included.
- Checks (team-leader, `--skip-nx-cache`). `typecheck,lint` passes on harness-sync, agent-generation, skill-synthesis-ui and setup-wizard (4/4). Tests (`--maxWorkers=2`): agent-generation, skill-synthesis-ui and setup-wizard pass. harness-sync has 18 failures in 532/550: exactly the 17 known baseline failures (agent-consent 2, skill-consent 7, gitignore E23 5, cancellation B8 2, write-failure E21 1) plus capability-policy C3 1, which also fails on main. No new failures.
- FU-3 update: `AgentModelsStore` moved to `clones/agent-models.store.ts` in B-FIX-3 (7dca3b7cc), which closes that part of FU-3. The rest of FU-3 (the Agents-tab wiring split and the view-level wiring spec) stays open.
- Fix round status: COMPLETE (3/3 committed). Next: one short scoped cross-side re-check over 603808f5c..7dca3b7cc (range from the parent of 603808f5c), then Mode 3.

## PR #635 CodeRabbit round (2026-10-04) — COMPLETE (faa768e31, 8dd6fea24, 0fa180286; not pushed)

- User decision (context.md): fix all 5 inline comments plus the actionable nitpick.
- PR-FIX-A agent-generation (comments 4175024986, 4175024989, 4175024993, 4175024958) — COMPLETE faa768e31. The model-layer read resolves `resolveHarnessWorkspaceRoot` first, the same root the save uses. The Claude override is keyed by `template.id`, the file slug. Restore refuses a `.claude` or `.claude/agents` that is a symlink or junction, returning `conflict` (CWE-59). `validateFilePath` runs before `resolveAbsolutePath`. Boundary: both libs are tagged `scope:extension` and harness-sync imports only `shared`/`vscode-core`, so there is no cycle and lint passes. Accepted: `'C:foo'` now reports `securityViolation`, which is correct because it is not under `.claude` and was rejected before as well. Three traversal specs now expect "Path traversal detected". Accepted residual: a TOCTOU window remains for a link created between the `lstat` and the `mkdir`/write, because Node has no portable `O_NOFOLLOW` directory open. Report: prfixa-executor-report.md.
- PR-FIX-B skill-synthesis-ui (comment 4175025001) — COMPLETE 8dd6fea24. A workspace switch while the Agents tab is active triggers one forced `harness.refresh`. Entering the tab and switching workspace in the same run still gives one refresh. Nothing fires off the tab. Report: prfixb-executor-report.md.
- Nitpick 2 harness-sync (orchestrator edit) — COMPLETE 0fa180286. `pruneEmptyAncestors` checks containment with `path.relative`, so a sibling such as `.history-old` no longer matches as a prefix.
- Nitpick 1 (`wizard-generation-rpc.handlers.ts:545-586`): no change; CodeRabbit agrees.
- Visual re-capture: PASS, warning text at 5.66:1 light and 6.61:1 dark (visual-recapture-report.md).
- Checks (team-leader, `--skip-nx-cache`): `typecheck,lint` passes on agent-generation, skill-synthesis-ui and harness-sync (0 errors, warnings pre-existing). Tests pass on agent-generation and skill-synthesis-ui (`--maxWorkers=2`). Orchestrator ran the 3 harness-sync retirement suites: 39/39. Degradation audit exits 0 (TOTAL 293).
- Push: the orchestrator pushes only after all CI jobs on dc5bc09f3 finish (user).

### CI round on PR #635 (2026-10-04)
- Push 1 (7be71f54e): `main` failed on degradation-audit ratchet → CI-FIX `dc5bc09f3` (7 suppression comments with reasons; audit exit 0).
- Push 2 (dc5bc09f3): all jobs finished; `main` failed 3 suites: settings-core TC-18 import-scope guard (apps imported settings-core) → `134bdda11` (getter moved to platform-vscode/electron `createAgentModelSettingsGetter`); VS Code rpc-surface excluded list (4 new Electron-only skillSynthesis methods) → `b8f123f2b` (added per the spec header's documented process); `git-watcher.real-git` packed-refs (not touched by this branch, presumed flaky — confirm on push 3).
- CodeRabbit round: faa768e31, 8dd6fea24, 0fa180286; re-check coderabbit-recheck.md APPROVED WITH NOTES 9/10. Replies posted on all 5 inline comments + one PR comment for the nitpicks.
- Push 3 (b8f123f2b): pushed after all push-2 jobs finished (user rule). CI pending.
