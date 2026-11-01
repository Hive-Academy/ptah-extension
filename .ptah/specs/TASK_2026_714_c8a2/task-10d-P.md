# Task 10d.P — native Codex lane parity proof (spec + proof document, no live run) (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call. A live run is a
  coordinator stop point that needs user authorization. Unit specs use test doubles only.
- Also apply every rule in T\task-10d-common-rules.md (section HARD RULES).
- Never strip, revert or comment out MCP. Do not convert line endings. UTF-8 without BOM.
- Touch ONLY the two files in Scope. Do not reopen any 10d.E/C/V file. If a proof row needs a code change, mark the
  row FAIL in the proof document and describe the needed change; do not make it.

## Objective

Plan section: T\plan-p10.md lines 105-109 ("10d.P — parity proof and activation gate"). Binding review rules:
T\plan-p10-review.md R1-R4 (R1 = D26: approval and sandbox row). Removal B (10e/10f) starts only after a signed
proof. Write the parity spec and the proof document. Compare to the merge-base legacy capability list (the
`@openai/codex-sdk` lane, `git -C W merge-base HEAD origin/main` and the legacy adapter in
W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\), not only to the 10a helper tests.

## Inputs

- Preserve list: T\parity-inventory.md (rows at :24-25, :53-55, :61, :67 and every lane row). Every row must appear
  in the proof with a status.
- Anchors: T\batches.md:3646-3650, T\decisions.md rows D26, D27, D28 (and :219, :222).
- Native adapter: W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts
  and its specs. Host wiring: W\apps\ptah-electron\src\di\codex-lane-composition.ts,
  W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.ts,
  W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.ts (+ their specs).
- Shared executable check: W\libs\backend\codex-runtime\src\lib\codex-executable-inspection.ts.

## Spec (CREATE W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-parity.spec.ts)

Cases (test doubles for the runtime/context; no process, no network):
1. One integrated run projection: a native lane run from spawn to terminal status produces the same lane output /
   status / session id surface that the legacy lane produces (assert the CliAgent contract fields the legacy lane
   sets).
2. Resume, queue and abort: resume by thread id uses the stored `consumer: 'lane'` identity; a queued message runs as
   the next turn; abort reaches the turn interrupt and gives the terminal status.
3. Profile isolation (R3): a lane profile never shares a CodexContext with chat; lane `consumer: 'lane'`,
   workspace-write limited to the working directory, `networkAccess: false` (R1/D26).
4. Approvals (R1/D26): each request kind (command, file change, permissions, MCP elicitation) is declined once, the
   turn reaches its terminal status, the one output line carries kind + names only.
5. Report / deliverable: the lane report and completion contract still reach the parent (renderLaneCompletionContract
   delivered, ptah MCP server config present in the lane profile — MCP is NOT stripped).
6. Negative inspection: the native adapter source and the host lane composition files do not import
   `@openai/codex-sdk` (read the files with fs, portable paths via path.resolve(__dirname, ...)).

Rules: no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`; `import 'reflect-metadata';` first if tsyringe is
used; Object.defineProperty for readonly mocks; no pending real timers; no excess properties in typed object
literals; Windows and Linux portable.

## Proof document (CREATE T\p10-lane-parity-proof.md)

- Table: preserve row (from parity-inventory.md) | legacy behavior (file:line at merge-base or current legacy
  adapter) | native evidence (spec name, file:line) | host coverage (Electron / CLI / TUI / VS Code) | status
  (PASS / FAIL / PENDING-LIVE / APPROVED-REMOVAL).
- Mark missing native behavior FAIL explicitly. Rows that only a real App Server run can prove are PENDING-LIVE with
  the exact observation the coordinator must make.
- Row "Approval and sandbox selection" records the accepted reduction (shell network, writes outside the working
  directory) with reference D26.
- Section "Host and binary identity": pin source, `inspectCodexExecutable`, platforms with a pin (win32/x64 only,
  review V-5).
- Section "Live run plan (needs user authorization)": the smallest live run per host that closes every PENDING-LIVE
  row (commands, expected observation, estimated model calls). Do not run it.
- Section "Signature": leave unsigned ("Signed: pending coordinator live run and user approval").
- `## Decisions`, `## Proposed Removals` (only rows the user must approve; none removed silently).

## Scope (only these files)

- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-parity.spec.ts (new)
- W\.ptah\specs\TASK_2026_714_c8a2\p10-lane-parity-proof.md (new)

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\p10-lane-parity-proof.md
(write a skeleton early). Also write the spec file. Reply `WROTE: <path>` plus one headline line.
