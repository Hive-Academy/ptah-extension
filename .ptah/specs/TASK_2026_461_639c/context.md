# Task Context - TASK_2026_461_639c

## User Request

> Continue TASK_2026_439_1310 (Thoth rework umbrella) with PHASE 3: skills unblock.
>
> Manual promote path that bypasses only the frequency threshold and keeps dedup, schema and write
> checks · delete the creation-time fake invocation (every candidate writes one succeeded=true row,
> which is the 2,432/2,432) · delete the depth-only prefilter branch and require edit, tool or test
> evidence · a one-time cleanup of the 2,426-candidate backlog with a report · the candidate namer
> either wired after registration or deleted. Phase 5 is the evidence-first rewrite — do NOT start it.

Rules from the user (binding for every executor):

- Requirements source: `../TASK_2026_439_1310/tribunal/verdict.md` section B and `tribunal/brief.md`.
  Working rules: `../TASK_2026_439_1310/HANDOFF.md` (all 8).
- Ship a REACHABILITY PROOF: an integration spec where a fake-lane session eligible twice across
  contexts ends `promoted`, and a conversation-only session produces nothing. Prove it by mutation
  (remove the production call, show the spec fails, restore it) and paste both outputs.
- `npx nx run-many -t ... -p a b c` only; check the N-projects header. Quote `|` in
  `--testPathPatterns` as `'"a|b"'`. Run SQLite specs under both bindings. Keep
  `degradation-audit:lint` at baseline. No `nx reset` while other agents share the worktree.
- NEVER open `~/.ptah/state/ptah.sqlite*` or `ptah.pre-migration-*.sqlite`. Byte-copy to a
  fail-if-exists temp dir whose name does not start with `ptah`.
- Do not start phase 5 (evidence-first stage inversion, cross-session clustering, promotion from
  `skill_invocation_events`).
- Commits per batch after review, never skip hooks. Never commit or merge to main. Push and PR only on
  the user's word. Another session shares the machine; hold heavy runs when it asks.

## Task Type

FEATURE

## Complexity

Complex

## Strategy

Full depth. Gate 0.1 → architect (`implementation-plan.md`) → Gate 2 → team-leader batches → Gate 3
whole-branch review by a family that implemented none of it. No separate PM phase: the verdict is the
approved requirements source, and the plan carries the acceptance criteria.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock`, branch
`feat/task-439-phase3-skills-unblock`, based on `origin/main` 97239e814 (PR #521 merged 2026-09-16).

## CLI Lanes

Mode: enabled (user: prefer CLI lanes until they hit limits, then subagents).

`ptah_agent_list` 2026-09-16:

| Agent | Type | Status | Capabilities |
| ----- | ---- | ------ | ------------ |
| codex | cli | installed | messaging: queue, role delivery: preamble/developer-instructions |
| copilot | cli | disabled (installed) | messaging: queue, role delivery: preamble/task-prompt |
| cursor | cli | not installed | messaging: interrupt, role delivery: preamble/task-prompt |
| antigravity | cli | installed | messaging: none, role delivery: preamble/task-prompt |
| opencode | cli | not installed | messaging: none, role delivery: preamble/task-prompt |
| pi | cli | not installed | messaging: steer, role delivery: preamble/task-prompt |
| ollama cloud | ptah-cli | available | provider: Ollama Cloud, ptahCliId: pc-85830910-3d81-4248-84c1-4fa52752dd19, messaging: queue |
| claude cli | ptah-cli | available | provider: Claude (Subscription), ptahCliId: pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d, messaging: queue |

Roster (the phase 2 roster, reused):

| Phase | Lane | Spawn args | Deliverable |
| --- | --- | --- | --- |
| Architecture | claude cli | `{ ptahCliId: 'pc-effaa2c4-…', modelTier: 'opus', role: 'software-architect' }` | `implementation-plan.md` |
| Decomposition / verify | team-leader subagent | — | `batches.md` |
| Implement | codex | `{ cli: 'codex', role: 'backend-developer' }` | code + `batch-N-report.md` |
| Batch review | ollama cloud | `{ ptahCliId: 'pc-85830910-…', modelTier: 'opus', role: 'code-logic-reviewer' }` | `code-logic-review-batch-N.md` |
| Gate 3 branch review | antigravity | `{ cli: 'antigravity', role: 'code-logic-reviewer' }` | `code-logic-review-branch.md` |

Lane completion is watched with marker files (TASK_2026_438). Revise cap: 2 rounds. A lane that fails
twice is dropped and its work moves to a subagent.

## Conversation Summary

- 2026-09-16: PR #521 merged → worktree from `origin/main`. Filed as TASK_2026_461_639c.
- 2026-09-16: `implementation-plan.md` written by the claude cli lane (lane record lost on host restart;
  deliverable complete, 727 lines, marker present). Orchestrator spot-checked the core claims by grep:
  manual `promote`/`promoteBulk` call `evaluate` (`skill-synthesis.service.ts:1217,1268`); only the
  tracker calls `incrementSuccess` (`skill-invocation-tracker.ts:67`) and nothing resolves the tracker;
  `nameCandidate` has no caller; `depthOk` at `:1192-1195`. Gate 2 presented.
- 2026-09-16: Gate 2 APPROVED by the user with the recommended option of every decision: D1 (a) proof
  ends `promoted` through the manual path, automatic `evaluate` pinned `below-threshold`; D2 (a) delete
  `eligibilityMinTurns` and `prefilterMinChars` end to end; D3 (a) `write-failed` fails closed; D4 (a)
  any verdict protects, unreadable transcript without verdict is rejected; D5 (a) delete the namer;
  D6 (a) cleanup job deletes `context_id IS NOT NULL` invocation rows. Item 4d (gate stages skip
  rejected candidates) accepted with the plan.
- 2026-09-16: Roster changes. Batch 5 revise ran on a backend-developer subagent (lane host at its
  5-agent limit with other sessions' agents). The Batch 6 review lane (ollama cloud) exited 0 with no
  deliverable: `429 session usage limit`. Batch 6 review moved to a code-logic-reviewer subagent
  (Claude family, implemented nothing in Batch 6). antigravity stays reserved for Gate 3.
- 2026-09-16: Batch 7 measurement findings put to the user (AskUserQuestion):
  1. Corpus: the evidence-only prefilter keeps 1,639 of 1,641 phase-2-eligible sessions (removes 0.12%)
     because "tool evidence" counts any 2 tool calls, MCP included. User chose **tighten now**: tool
     evidence counts only non-MCP tools (name not starting with `mcp__`), threshold stays 2; edit and
     test evidence unchanged; re-measure the corpus and re-run the reachability proof.
  2. Byte copy: 1,859 of 2,418 candidates rejected as transcript unreadable (99.3% have no transcript
     on disk); 13 have a file present, likely because no workspace root resolves and the service skips
     the read (`skill-backlog-cleanup.service.ts:287`). User chose **keep, never reject**: reject as
     unreadable only when a read was attempted and failed; an unresolvable root keeps the candidate and
     is counted separately.
