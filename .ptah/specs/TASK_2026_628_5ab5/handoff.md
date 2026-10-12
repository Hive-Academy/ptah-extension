# Handoff: TASK_2026_628_5ab5 (renderer memory and CPU churn)

Date: 2026-10-12. Written at the end of the orchestrator session, after all agents stopped.

## Location

- Worktree: `D:\projects\ptah-wt-628`
- Branch: `fix/task-628-renderer-memory` (local only, not pushed, no PR)
- Base: `43803ee7e` (main)
- Spec folder: `D:\projects\ptah-wt-628\.ptah\specs\TASK_2026_628_5ab5\`

## Status of the batches

| Batch | Scope | Status | Commit | Review |
|---|---|---|---|---|
| Docs | Plan and plan reviews | Committed | `171489ba2` | Plan approved at the user gate |
| 1 | Streaming markdown blocks, sidebar transitions | Committed | `e72dfe150` | APPROVED (`code-logic-review-batch-1.md`) |
| 2 | Tree cache keyed on the identity of the state's Maps | Committed | `2c84c411c` | APPROVED 8/10 (`code-logic-review-batch-2.md`) |
| 6 | Linear `summarizeLive`, bounded caches | Committed | `fbbc75c99` | APPROVED 9/10 after round 1 (`code-logic-review-batch-6-r1.md`) |
| 3 | `AGENT_SUMMARY_CHUNK` through `BatchedUpdateService` | Uncommitted, round 1 fix done | — | Round 0: CHANGES REQUESTED 5/10 (`code-logic-review-batch-3.md`). Needs round 1 re-review |
| 4 | CLI agent output 4a–4e | Uncommitted, done | — | No review yet. Needs initial review |
| 5 | No-op tab copies, presentation memo, `tab-<id>` key, shared parse cache | Uncommitted, round 1 fix done | — | Round 0: CHANGES REQUESTED 5/10 (`code-logic-review-batch-5.md`). Needs round 1 re-review |
| 7 | Detached tile leak | Moved to TASK_2026_629 by the user | — | — |

Revise cap: 2 rounds per batch. Batches 3 and 5 used round 1. One round is left for each.

## Uncommitted files per batch (for separate commits)

**Batch 3**
- `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts` and `.spec.ts`
- `libs/frontend/chat-streaming/src/lib/batched-update.service.ts`, `batched-update.service.spec.ts`, `batched-update.visibility.spec.ts`
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`, `streaming-handler.service.spec.ts`, `streaming-handler.background.spec.ts`
- `.ptah/specs/.../batch-3-notes.md`, `code-logic-review-batch-3.md`

**Batch 4**
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`, `agent-monitor.store.spec.ts`, `agent-monitor.retention.spec.ts`
- `libs/frontend/chat-streaming/src/lib/agent-output-retention.ts`, `agent-output-retention.spec.ts` (new), `agent-output-frame.ts` (new)
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.utils.ts`, `agent-card.utils.spec.ts` (new), `agent-card.component.ts`, `agent-card-truncation.spec.ts`
- `libs/frontend/chat-ui/src/lib/molecules/agent-card/agent-card-output.component.ts` and `.spec.ts`
- `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts`, `.spec.ts`, `agent-monitor-tree-builder.cap-fold.spec.ts`
- `.ptah/specs/.../batch-4-notes.md`

**Batch 5**
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts` and `.spec.ts`
- `libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts` and `.spec.ts` (new)
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`, `.spec.ts`, `chat-transcript.ptah-ui.spec.ts`
- `libs/frontend/chat-types/src/index.ts`, `src/lib/tool-input-parse-cache.ts` (new)
- `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts`, `builders.spec.ts`, `tool-input-parse-cache.spec.ts` (new)
- `.ptah/specs/.../batch-5-notes.md`, `code-logic-review-batch-5.md`

Confirm each list with `git status --short` before you commit. Batch 3 and Batch 5 both touched spec mocks. Assign a file to the batch whose notes name it.

## Next steps

1. Run three codex reviews in parallel. Each review is read-only, uses the `code-logic-reviewer` role and has a 20 min timeout:
   - Batch 3, round 1: verify the fixes in `batch-3-notes.md` § "Review round 1". These are the flush guard on the `events`/`eventsByMessage` Map identity, the clears at the compaction sites and the skip for empty chunks.
   - Batch 4, initial review: check R2/R2.1 in `implementation-plan.md` (one ordered fold, per-stream counts, a notice only at index 0), the unchanged public `AgentMonitorStore` API, and the 150 ms throttle.
   - Batch 5, round 1: verify the fixes in `batch-5-notes.md` § "Review round 1". The turn snapshot reads current slot records, and the parse cache has a 32K entry cap and a ~1M total budget.
2. Lane mechanics that worked in this session:
   - Lanes cannot use the worktree as their working directory.
   - Write the diff to `D:\projects\ptah-extension\.ptah\tmp\task628\batchN.diff`.
   - Give the lane absolute worktree paths.
   - Name the deliverable exactly: `D:\projects\ptah-extension\.ptah\tmp\task628\code-logic-review-batch-N[-rK].md`. The role otherwise writes `code-logic-review.md` into the main checkout spec folder.
   - Move each review file into the worktree spec folder.
3. Handle the reviews:
   - If a review is APPROVED, commit that batch alone.
   - If a review requests changes, start a fresh `frontend-developer` subagent for round 2, which is the last round. If defects remain after round 2, report them to the user.
4. Write a follow-up commit that removes the two dead `tile-` cache clears. Batch 5 lists them as hand-offs in `batch-5-notes.md`. They are in `execution-tree-builder.service.ts` and `compaction-lifecycle.service.ts`.
5. Run scoped checks on the full branch, one at a time:
   - Run typecheck, lint and test for `@ptah-extension/chat-streaming`, `@ptah-extension/chat`, `@ptah-extension/chat-ui`, `@ptah-extension/chat-state`, `@ptah-extension/chat-types` and `@ptah-extension/chat-execution-tree`, with `--parallel=1`.
   - Keep `chat-transcript.display.spec.ts` passing.
6. Tell the user that the build is ready for the M-final trace, with the same scenario: 5–6 sessions that stream, with sub-agents and CLI lanes.
7. Analyze the traces (M0/M1/M2/M-final where available) and write `measurements.md`:
   - Recalculate Style time
   - Document count
   - Renderer private memory, with a 1.5 GB ceiling at 30 min
   - Forced GC frees less than 25%
8. Open the PR only after the user approves: push the branch, then run `gh pr create` against `main`. The title is under 70 chars. The body has a Summary and a Test plan. End commits with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. End the PR body with the Claude Code line.

## Rules (from the user and CLAUDE.md)

- Do not touch the canvas layout (TASK_2026_629). Do not reintroduce `content-visibility`. Do not use `--max-old-space-size`. Main-process growth is out of scope. Do not regress TASK_2026_336.
- Verification: test only the changed projects. Use Nx `--parallel=1` and Jest `--coverage=false --maxWorkers=2`. Run one heavy check at a time on the machine. Use the lock `D:\projects\ptah-wt-628\.ptah\tmp\heavy-check.lock`. Do not run workspace-wide checks, build, serve, e2e or package. Filter the output.
- Write commit messages with `[IO.File]::WriteAllText($f, $msg, (New-Object System.Text.UTF8Encoding($false)))`. PowerShell 5.1 files otherwise get a BOM, and git keeps it in the subject. This happened once, and the commit was rewritten.
- Subagents stop at 250,000 context tokens (`compaction.subagentHandoffTokens` in `~/.ptah/settings.json`, backup `settings.json.bak-task628`). The SDK shows that stop as "stopped by user" (TASK_2026_632, in the backlog). Keep subagent tasks small. On a stop, start a fresh subagent with a handoff.

## Coordination with TASK_2026_629

- The user opens a new session for TASK_2026_629. This session's name for that session: **TASK_2026_628_5ab5 orchestrator**. Branch `fix/task-628-renderer-memory`, worktree `D:\projects\ptah-wt-628`.
- Commitments that bind this task (also in `implementation-plan.md` § "Coordination with TASK_2026_629"):
  - The public `AgentMonitorStore` API stays the same. Batch 4 only adds `flushPendingOutput()`.
  - The `summarizeLive` and `summarizeFinalized` signatures stay the same.
  - Every status change still publishes.
  - Tiles use the `tab-<id>` tree key.
  - 628 edits no canvas file.
  - TASK_2026_629 owns the 500 ms sampler and hot spot 7.
- Batch 5 deviation: no "one buildTree per published tab snapshot" test existed to extend. A new test mounts two transcript components of one tab, not two ChatViews. Tell TASK_2026_629 about this.

## Known open items

- `agent-monitor.store.ts` was already over the 700-line lint limit before Batch 4 (1759 lines now). It needs its own extraction task.
- The Batch 4 hidden-window behavior was tested only with a simulated frame clock.
- Plan unverified items: `batch-2-notes.md` records the `structuralRevision` result, and `batch-4-notes.md` records `storeAgentIds` (`agent-monitor-tree-builder.service.ts:140`).
