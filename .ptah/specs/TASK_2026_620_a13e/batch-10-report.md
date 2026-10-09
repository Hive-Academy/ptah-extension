# Batch 10 Report: memory ground-truth drafts (third attempt)

No repository or worktree change was made by this batch. Output is in `C:\Users\abdal\AppData\Local\ptah-mcp-bench\drafts\memory-ground-truth\` (5 JSONL files and README.md). Pinned HEAD `e0ca51e6e7721e9b925ae46530da9255d254eb23`. Nothing under `C:\Users\abdal\.ptah` was opened and no memory MCP tool was used.

## Counts

| Category | Valid drafts | Target | Shortfall |
|---|---:|---:|---:|
| Facts | 130 | 130 | 0 |
| Merge pairs | 100 (50 should-merge, 50 should-not-merge) | 100 | 0 |
| Update cases | 29 | 30 | 1 |
| Temporal cases | 21 | 18 | 0 |
| Abstention cases | 18 | 18 | 0 |

Fact categories: extraction 83, contradiction 19, multi-session 11, update 8, temporal 6, abstention 3. Distinct task folders (primary source): 68; maximum per folder: 5.

## Source mix

- Facts: 130/130 cite `.ptah/specs` file:line; 0 are commit-subject-only (limit 15%). 11 multi-session facts cite two sources from different dates.
- Updates: 14 spec-to-spec, 15 involve a git artefact (code constant or default changed on a later date: Ollama Cloud tier defaults x3, suggestionMaxCandidates 200 to 1000, pre-migration backups 3 to 1, CLAUDE.md removal, eight more constants such as the canvas tile cap 9 to 20, retention delete batch 200 to 100).
- No fact comes from 471/473/563/620 documents or from 621. Updates deliberately cite them (Jev decision, task statuses, 16/20 to 9/20, 28 to 26 authored skills), as the brief directed.

## Validation and BOM

- zod validation with `label-schemas.ts` (`npx --no-install tsx`, read-only): facts 130 valid / 0 invalid, merge pairs 100 / 0, updates 29 / 0, temporal 21 / 0, abstention 18 / 0; duplicate ids: none.
- BOM check: no file begins with EF BB BF. CR check: no carriage returns (LF only). All files UTF-8.
- Citation check: the build script rejects any item whose quote is not on the cited line of `git show <ref>:<file>`; commit dates were checked against each update's `at`. `git status` in the repo and the worktree shows only changes that existed before this batch.

## Sample items

Facts

- F-065 (extraction, 2026-09-30, `TASK_2026_576_e16a/context.md:72` @ 3cdb5eb19): "Review cadence (user, 2026-09-30, 'Per phase', TASK_2026_576): batches get only typecheck, lint, scoped unit tests and the pre-commit hook; at each phase end one cross-side review lane reviews the phase diff, the full e2e set runs, and UI phases get a visual review; no early wiring." Question: what review cadence did the user set for phases P2 to cutover? Bait: review every batch with a lane.
- F-042 (extraction, 2026-09-21, `TASK_2026_511_c7b4/context.md:5` @ 09e9b9921): on one install observation_queue reached 178,867 rows because retention never completed a run; the governor wait ceiling came from the run's own 60 s wall budget.

Updates

- U-001 retention of never-processed observations. v1 (2026-09-14, `memory-retention-config.ts:32` @ ba684b018): stuckDays = 14, stuck unprocessed rows quarantined or deleted. v2 (2026-10-06, `TASK_2026_621_3d5c/context.md:24`, untracked): retention never deletes an observation extraction never processed. Bait: reaped after 30 days by migration 0039.
- U-012 Ollama Cloud opus-tier default. v1 (2026-05-21, `local-provider-entry.ts:118` @ 80d26911d): deepseek-v3.2:cloud. v2 (2026-10-06, `local-provider-entry.ts:136` @ e102153eb): glm-5.3:cloud. Bait: kimi-k2.6:cloud.
- U-011 TASK_2026_576 lane pool. v1 (2026-09-29, `TASK_2026_576_e16a/context.md:35` @ 74e50a10b): only Glm and antigravity. v2 (2026-10-01, `context.md:75` @ 44e263749): plus opencode with Kimi, codex and copilot excluded. Bait: codex is the primary executor lane.

Temporal

- T-001 "Which retention rule applied to an unprocessed observation on 2026-09-20?" Answer: quarantined or deleted after stuckDays = 14; the never-delete rule arrived 2026-10-06. Same slot has T-002 for 2026-10-06 with the opposite answer.

Abstention

- A-002 (rejected-hypothesis) statement "Running the interval and signal writes outside NgZone removes ApplicationRef.tick()"; source `TASK_2026_482_d4a8/context.md:64`, verified and rejected.
- A-010 (corrected-claim) statement "The dashboard and surface tools are always on for every coding agent"; source `TASK_2026_595_1c01/context.md:23`, reversed by the user on 2026-10-03.

## Shortfalls and caveats

- Updates: 29 of 30. Further candidates were all same-day (Antigravity owner key, GLM-5.3 context window, burst limit, compaction dwell, PR list limit, child-session UI note) and cannot satisfy `v1.at < v2.at`; none were padded in.
- 11 updates (task statuses of 471/473/563/578/588, phase 4 and 5 rows, Jev, 582 repository move, authored-skill count, retention) have a v2 that exists only in uncommitted or untracked files at HEAD. Their `sourceCommit` is HEAD and the source says so. Re-verify after commit, or hold them out of the frozen set until then. Temporal cases derived from those slots inherit this.
- Should-not-merge pairs are same-task, different-aspect decisions, not adversarial lookalikes. A human labeller should add harder pairs.
- Abstention schema has no reason field; the reason is appended to `source`.
- All items are drafts (`labeller = draft:lane`); a fact without human acceptance is not in the set (design 10.1).
