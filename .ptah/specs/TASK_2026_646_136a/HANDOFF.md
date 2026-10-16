# HANDOFF - TASK_2026_646_136a (2026-10-16, end of session 8)

Status at handoff: worktree clean, branch in sync with origin at `2777dfb34`, no lanes or subagents running.
PR #731 stays a draft: Batch 22 is not built and phases P4, P5, P6 (plus the P2 36b re-review) are not accepted.

## Goal

An optional decision model for orchestration routing, plus a lane evaluation loop:
- A "Decision model" background role (Ollama, TypeSafe Jev via `/v1/systemone`, or any structured-output model).
- A `ptah_route_decide` MCP tool (HTTP and stdio dispatchers).
- A lane and subagent outcome record, with `ptah_outcome_report`.
- A capability matrix as data (`source`, `asOf`).
- A spread rule across every spawnable lane.

Approved requirements: `task-description.md` (revision 3). Approved plan: `implementation-plan.md` (+ part-a, part-b),
Gate 2 PASSED (decision #52). Work is in `batches.md` (40 batches, incl. P3 fix batches 37 and 37b).

Final user decisions (do not reopen): #12, #13, #18 (as amended by #22), #19, #96 (P3 accepted, LT-P3-5 deferred).
Keep `skillSynthesis.enabled=false` in `~/.ptah/settings.json`. Leave memory untouched. Lanes: mode `enabled`,
Approval `lane-review`. User preference (#82): use CLI lanes for parallel work where possible.

## Lane rule

The temporary "no Claude subagents" rule EXPIRED 2026-10-16 00:00 local time. The team-leader, reviewer and
visual-reviewer subagent flow may resume. CLI lanes still need confirmed room; run `ptah_agent_list` before each spawn.
At handoff (2026-10-16): codex Weekly 30% (confirmed room), opencode Monthly 92% (near limit), grok unknown
(API key, no plan), antigravity unknown (reader failed), Glm AT LIMIT.

## Done

Branch `feat/decision-model-routing`, worktree `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`,
draft PR https://github.com/Hive-Academy/ptah-extension/pull/731 (keep it a draft until the task is complete).
Batch count: **39/40 COMPLETE**. Phases accepted: **P1, P2** (#85), **P3** (#96).

Commits this session (orchestrator Mode 2 and commits; decisions #91-#98):

| Commit | What | Executor (family) |
| --- | --- | --- |
| 3ce35ddb9 | Batch 30a - lane-routing host registration | grok (xAI) |
| d2de2093f | Batch 18 - decision-model config RPC | grok (xAI) |
| 3f932ea7d | Batch 27 - failure classifier (+ #91 spec fix) | grok (xAI) + orchestrator |
| cc34e1624 | Batch 25 - `agent:outcomeSignals` handler; P3 reviews | grok (xAI) |
| 8d29af556 | Batch 37 - P3 fix round | grok (xAI) |
| 623644993 | Batch 37b - P3 bounded correction | grok (xAI) |
| f08e93af5 | Batch 29 - MCP registration of both tools; P3 accepted | grok (partial) + codex (OpenAI) |
| 4b2da5a97 | Batch 31 - skill text | codex (OpenAI) |
| e082c0cbe | Batch 30 - host wiring of lane-outcomes (+ #98 spec fixes) | codex (OpenAI) + orchestrator |

| 2777dfb34 | Session 8 handoff | orchestrator |

All pushed and confirmed in sync with origin.

## Open

- **Batch 22 (A12, UI decision-model settings row)** - PENDING. Needs R-10 "before" screenshots (dark + light) of
  orchestration settings from c57a9a1e7 by the visual-reviewer subagent, and the TASK_2026_658 overlap check first.
- **Reviews due:**
  - P4 (14, 18, 19, 22): codex lane (code-logic) + visual review, after Batch 22.
  - P5 (8, 23, 24, 25, 28, 32): Anthropic subagents (code-logic + code-style + visual). Notes for it in `batches.md`
    Batch 25 (`logger.error` context object; local reader interface).
  - P6 (26, 29, 30, 30a): **Anthropic** subagent now (decision #95; codex implemented 29 and 30). Notes in
    `batches.md` Batch 29 (~55 adapter lines in `protocol-dispatcher.ts`) and Batch 30 (inline disposer
    `Symbol.for`).
  - Anthropic code-logic re-review of the 36b commit (P2) is still listed as pending in `batches.md` line 3.
- **Later tasks:** P2c (LT-P2-17, -18, -19: `lane-outcomes:build` cannot resolve `vscode`, verify only with a build the
  user asks for), P3c (LT-P3-1..5), FE-21a, FE-23a/b/c, FE-24a/b/c/d.
- P4 review notes (TL-59 run): `getStatus()` rejection fails the whole `agent:getConfig`; the decision-model spec's
  state-set guard checks lane-routing's DTO, not the shared mirror type.

## Lessons from this session

- `nx test ptah-cli` runs ~36 dependency `build` tasks. Do not use it. Use
  `PTAH_ALLOW_SKIP_UNBUILT=1 npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src --coverage=false --maxWorkers=2`.
- `apps/ptah-cli` and `libs/backend/cli-engine` Jest configs are `jest.config.cjs`.
- Do not commit while any lane edits the worktree (lint-staged hides unstaged files during the hook).
- Codex lanes take messages only as `queue-next-turn`; a brief error needs a stop and a re-spawn, not a message.
- Never start a push with a shell `&`; use the Bash tool's background mode.

## Key files

- Task folder: `.ptah/specs/TASK_2026_646_136a/` - `task-description.md`, `implementation-plan.md` (+ part-a/b),
  `batches.md`, `decisions.md` (#1-#98), `reviews/`, `reports/`.
- Libs: `libs/backend/lane-routing/`, `libs/backend/lane-outcomes/`.
- MCP: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-dispatcher.ts` (+ mcp-stdio).
- Hosts: `apps/{ptah-extension-vscode,ptah-electron}/src/di/phase-2-libraries.ts`,
  `libs/backend/cli-engine/src/lib/{container.ts,lane-outcomes-wiring.ts}`.
- Batch 22 target lib: `libs/frontend/chat` (orchestration settings).

## Verification commands (one at a time, prefix `NX_NO_CLOUD=true`)

- Lib tests: `npx nx test <project> --parallel=1` (e.g. `lane-routing`, `lane-outcomes`, `rpc-handlers`, `chat`).
- Specs only: `npx jest -c <lib>/jest.config.ts <spec...> --coverage=false --maxWorkers=2`.
- CLI app: `PTAH_ALLOW_SKIP_UNBUILT=1 npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src --coverage=false --maxWorkers=2`.
- Audits: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` must stay `TOTAL 296` with no `FAIL`; di-lint runs on pre-push.

## Next steps (from 2026-10-16)

1. Read this file, `batches.md` rules (21-60) and the Batch 22 section, and `decisions.md` #91-#98. `git status -sb`.
2. Batch 22: visual-reviewer "before" screenshots, then a frontend lane or subagent, then Mode 2
   (`J(libs/frontend/chat, <changed specs>)`, `npx nx lint @ptah-extension/chat`), then "after" screenshots.
3. P4 review (codex) after Batch 22; P5 and P6 reviews (Anthropic subagents). One fix round each (lean rule 4).
4. Completion (team-leader Mode 3): write-path trace inputs are in `reports/batch-30-report.md`; then mark PR #731
   ready only when every phase is accepted.
5. Checks per changed project only, one heavy check at a time, `NX_NO_CLOUD=true`; commit in the foreground,
   push in the background; never `--no-verify`; never raise a degradation baseline (TOTAL 296).
