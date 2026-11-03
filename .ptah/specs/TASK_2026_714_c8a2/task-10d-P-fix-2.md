# Task 10d.P-fix-2 — parity spec revise round 2 of 2 (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md and in T\task-10d-P.md (HARD RULES and spec rules).
- Never strip MCP. Do not convert line endings. UTF-8 without BOM. Do not edit production code.
- This is the LAST revise round. Fix every item below; for anything you cannot prove, downgrade the proof row instead.

## Inputs

- Review: T\code-logic-review-10d-P.md (REVISE 6.5/10, defects D1-D7 with file:line).
- Your earlier outputs and reports: T\task-10d-P.md, T\task-10d-P-fix-1.md, T\batch-10d-P-fix-1-report.md.

## Fix list

1. D1 (moderate): rewrite the row-32 case in
   W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-parity.spec.ts (about :306-387) to use ONE adapter,
   ONE runtime provider and ONE identity store; run both same-home lanes through them interleaved (start A, start B,
   second turn A, resume B); assert the `open` call arguments per lane (cwd, disabled user MCP, instructions,
   permission level) and that no value of A appears in B's call or the reverse.
2. D2 (moderate): in W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-activation.spec.ts add ONE
   integration case that feeds the REAL native adapter (`CodexAppServerLaneAdapter` with test-double runtime, as in the
   parity spec harness) into the manager, so the native terminal usage segment reaches the resume gate / ledger and an
   attributed report reaches the router. Keep the stub-adapter cases, and in the proof label them "shared manager
   contract (adapter-agnostic)" instead of "native evidence".
3. D3 (moderate): after all spec edits, update every `P:` / `A:` line reference in T\p10-lane-parity-proof.md to the
   real line ranges of the cited case (read the final files and count lines).
4. D4 (minor): add a case where the runtime path emits the approval (through the adapter, not by calling the sink
   directly) and assert one decline and one output line; or reword the row to what the case really proves.
5. D5 (minor): include `'ptah'` in the fixture `userMcpServerNames` for the MCP case so the `name !== 'ptah'` filter
   (codex-lane-profile.ts:112) is exercised, and assert Ptah MCP stays enabled.
6. D6 (minor): assert the resume decision's `contextTokens` (20000) and its rollout source, and add the counter-case
   (> 150k gives `fresh`).
7. D7 (minor): assert `ledger.recordWindowEvidence`; add a completed run with usage; separate the usage-unknown case
   from the unknown-owner case.

## Scope (only these files)

- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-parity.spec.ts
- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-activation.spec.ts
- T\p10-lane-parity-proof.md (keep the Signature unsigned)

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-P-fix-2-report.md
(write a skeleton early): per item what changed (file:line), `## Decisions`, anything not done.
Reply `WROTE: <path>` plus one headline line.
