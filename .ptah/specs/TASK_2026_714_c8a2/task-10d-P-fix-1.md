# Task 10d.P-fix-1 — parity spec repair and FAIL-row tests (TASK_2026_714_c8a2, revise round 1 of 2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md and in T\task-10d-P.md (HARD RULES and spec rules).
- Never strip MCP. Do not convert line endings. UTF-8 without BOM.

## Inputs

- Original task: T\task-10d-P.md. Your outputs: T\p10-lane-parity-proof.md and
  W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-parity.spec.ts.

## 1. Repair the spec (coordinator ran it on Windows: 8 failed, 1 passed of 9)

All 8 failing cases throw `Unverified or invalid profile path` at
W\libs\backend\codex-runtime\src\lib\codex-execution-profile.ts:251 (`normalize`, called from
`buildCodexExecutionProfile` :285, via `CodexAppServerLaneAdapter.runSdk` adapter :224 and directly at spec :243).
The `paths.entries` map in the spec fixture has no entry for the key that `normalize` computes (read
codex-execution-profile.ts:230-290 for how the key is built — resolve and, on win32, the case/normalization rule).
Every path that the profile reads (home, cwd, and any other entry the builder looks up) needs an entry with the exact
normalized key and `kind: 'directory'` + absolute `realpath` where a directory is required. Build the fixture from
real tmp directories (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`, `realpathSync`) and the same helper the
host specs use (see `paths()` in W\apps\ptah-electron\src\di\codex-lane-composition.ts and its spec), so it passes on
Windows and Linux. Clean up tmp dirs in afterEach.

## 2. Add tests for the four FAIL rows of the proof

Add cases to the same spec file (or, only if the manager/notifier needs a different harness, ONE new file
W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-activation.spec.ts). Test doubles only.
a. Row 32 "Same-home effective configuration": two native lanes on the same CODEX_HOME with different user MCP
   suppression, developer instructions, cwd and policy produce two separate effective profiles/contexts; a second
   turn and a reopen (resume) keep each lane's own values (no bleed).
b. "Last-request rollout usage / resume gate": process-manager level — the resume gate uses the last-request usage
   for a native lane, not the cumulative value (see codex-rollout-usage.reader.ts:61-76,151-188 and
   lane-resume-gate.ts:35 and agent-process-manager.service.ts).
c. "Plan-limit ledger": the manager records completed / failed / aborted native lane runs and an unknown-usage run in
   the ledger the same way it does for the legacy lane (agent-process-manager.service.ts:126-140,913-933).
d. "Report attribution / deliverable": an attributed ptah_agent_report from a native lane reaches the parent route,
   and the post-exit deliverable check reports missing / empty / valid (lane-completion-notifier.service.ts:103-186,
   281-327; agent-report-router.service.ts; agent-process-manager.service.ts:808-814,1009-1020).
If a case shows that native behavior is really missing (not a test-harness problem), keep the case as `it.todo` with
a one-line reason, leave the row FAIL, and describe the needed code change in the proof. Do not edit production code.

## 3. Update the proof

Update T\p10-lane-parity-proof.md rows 32, resume gate, ledger and report/deliverable with the new spec names and
file:line, and set each to PASS (static, spec-backed) or keep FAIL with the reason. Keep the Signature unsigned.

## Scope (only these files)

- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-parity.spec.ts
- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-activation.spec.ts (new, only if needed)
- T\p10-lane-parity-proof.md

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-P-fix-1-report.md
(write a skeleton early): per item what changed (file:line), `## Decisions`, anything not done.
Reply `WROTE: <path>` plus one headline line.
