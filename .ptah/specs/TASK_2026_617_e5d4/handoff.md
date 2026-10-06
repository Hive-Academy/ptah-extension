# TASK_2026_617 — handoff (2026-10-06)

## Where things stand

The Grok CLI lane over ACP is implemented and both review phases have passed. Batches 1–9 and the Phase 2
fix round are committed on branch `feat/task-617-grok-acp`, in worktree
`D:\projects\ptah-extension\.claude-worktrees\task-617-grok-acp`. The branch is pushed and **draft PR #665**
is open. The team-leader's completion mode (Mode 3) ran on 2026-10-06. Task status: **COMPLETE-PENDING-QA**:
the code and reviews are done, and QA evidence plus a live smoke test are still open.

The user asked to pause before Batch 8, but the pause arrived after Batches 8 and 9 had been committed.
History was not rewritten; `b720f2f18` is the last pre-Batch-8 commit. Resetting to it is destructive, so it
needs the user's explicit approval. The default is to keep the current history.

### Commits

| Item                                                       | Commit           |
| ---------------------------------------------------------- | ---------------- |
| Batch 0 probe, fixtures, plan                              | `6ca659432`      |
| Batch 1: SDK loader and dependency wiring                  | `d9b964db0`      |
| Batch 2: host bundle externals                             | `0ba619bcc`      |
| Batch 3: transport, update mapper, permission policy       | `1b2ad5f30`      |
| Batch 4: vendor profile, session runner, fake ACP peer     | `eff0a4292`      |
| Phase 1 review fixes and review files                      | `6163b042e`      |
| Batch 5: `grokModel` shared types and file key             | `cd6ec1f57`      |
| Batch 6: settings export and agent RPC get/set             | `91554e5ef`      |
| Batch 7: frontend providers state and e2e fixture          | `2c551c7e1`      |
| Merge of origin/main                                       | `72b5677d0`      |
| Batch 8: `'grok'` in `SYSTEM_CLI_TYPES` and every consumer | `9966bd35d`      |
| Batch 9: Grok profile, adapter, registration               | `ff87f761d`      |
| Phase 2 review fixes                                       | `c66722ee4`      |
| HEAD (Phase 2 review and completion record)                | see `git log -1` |

`batches.md` holds the per-batch evidence, the deviation notes, both phase review sections and the Mode 3
completion notes. `future-enhancements.md` consolidates every deferred item and review Minor.

### Phase 1 review (Batches 1–4): passed

- Logic review: APPROVED 7/10 (`code-logic-review.md`).
- Style review: REVISE 7/10 (`code-style-review.md`). After the fix round, the re-review was APPROVED 8.5/10
  (`code-style-rereview.md`).

### Phase 2 review (Batches 5–9): passed

- Logic review: REVISE 7/10 (`code-logic-review-phase2.md`). Style review: REVISE 7.5/10
  (`code-style-review-phase2.md`).
- One fix round (`phase2-fix-backend.md`, `phase2-fix-frontend.md`), committed as `c66722ee4`.
- Re-reviews: logic APPROVED 8.5/10 (`code-logic-rereview-phase2.md`); style APPROVED 8.5/10
  (`code-style-rereview-phase2.md`).
- After the fix round, scoped `typecheck,test,lint` passed for cli-agent-runtime, rpc-handlers, ptah-cli, chat,
  tasks-ui and webview-e2e-harness, and the degradation audit exited 0.
- Reviewer independence: the authors and reviewers were all in-process sub-agents (the user pinned the reviewer
  types). There was no cross-vendor review, so the independence evidence is weaker.
- The loose ends from the previous handoff are closed: the `it.each` now covers grok, stdin backpressure is
  handled, and `agent-models.store.ts` needs no grok entry (it is keyed by `AgentModelProvider`).

## Next steps

1. **Fix N2 before QA** (one line): `CLI_MODELS_FIXTURE` in
   `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts` lacks a `grok` key, so
   the Grok model picker renders empty in the harness. Consider N1 (`parseGrokModels` footer line) at the same
   time. Both are listed in `future-enhancements.md`.
2. **QA screenshots**: a dark and light matrix of the Orchestration CLI settings. Include the new Grok row, its
   `Auto-approve` permission note and the model popover. Take the "before" from the base commit.
3. **Live Grok smoke test**, once the grok.com free quota resets (it was exhausted on 2026-10-06, rolling 24 h):
   spawn the lane, call a Ptah MCP tool and `ptah_agent_report`, send a mid-turn message (queued to the next
   turn), stop, idle release, then `resume_session_id`. If possible, also run the `XAI_API_KEY`-only probe
   (future-enhancements L-D3).
4. **Mark PR #665 ready only when the user asks.** Do not push, change the PR or rewrite history without that
   instruction. The PR body ends with the Claude Code attribution line. Note the formatter churn in the PR body
   (style finding 4).
5. Known, untouched: merge commit `72b5677d0` has the default message without the Co-Authored-By line. Leave it
   alone. The `rpc-handlers:test` parallel-load flake is recorded in `future-enhancements.md` (X-2).

## Rules for the next session

- Work only in the task-617 worktree. The main checkout `D:\projects\ptah-extension` must stay clean.
  Something kept writing `.claude/skills/ptah-surface-authoring/*` there earlier.
- Lanes: opencode, codex (pass `effort: "high"`; `minimal` fails on gpt-5.6-terra), or Glm (ptahCliId
  `pc-355b645d-35af-4974-84cf-9cf961ea0164`). **Never antigravity.**
- Run the degradation audit before every commit:
  `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`.
- Use scoped checks only: `npx nx run-many -t typecheck,test,lint -p <projects>`.
- The ESM-only SDK is loaded only by `acp/acp-sdk-loader.ts`. Specs reach it through `connectAcp`, and type
  imports use `import type` only.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Related work outside this task

- PR #658 (opencode exit-1 fix and queue-next-turn, TASK_2026_591): all CI checks were green after
  `59bed7b84`, and it is ready to merge.
  - Still to check on a rebuilt host: opencode shows `messaging: queue`, and a long lane that recovers from a
    provider error ends as completed.
  - The opencode move to ACP and the TASK_2026_591 `opencode serve` Phase 2 are paused by the user.
- A possible new task: codex lanes fail when reasoning effort is `minimal` on `gpt-5.6-terra`. The adapter
  should map `minimal` to `low`/`none` for models that reject it.
- `~/.grok/leader.lock` and `leader.log` exist from earlier probes. Delete them only with the user's
  permission.
