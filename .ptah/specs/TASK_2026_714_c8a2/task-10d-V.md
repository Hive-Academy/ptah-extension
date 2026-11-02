# Task: batch 10d.V — VS Code native Codex lane wiring, minimal (TASK_2026_714_c8a2)

Read first and follow: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\task-10d-common-rules.md
(hard rules, Electron pattern, D26/D27, R1-R4). W and T below are defined there.

## Objective

Add the minimum VS Code host ports so the same native Codex lane factory works in the VS Code extension, following
the Electron pattern and D27. No VS Code UI feature (Electron first). Plan text: T\plan-p10.md section "10d.V" (its
"select native by default" is replaced by D27/D28 below).

D27 mapping for VS Code (coordinator decision D28, reversible): "unpackaged (dev)" means
`context.extensionMode === vscode.ExtensionMode.Development` (see W\apps\ptah-extension-vscode\src\activation\bootstrap.ts:92).
Bind the factory when that is true or when the lane parity gate admits 'lane'. Otherwise bind no factory and keep the
legacy lane. One VS Code helper is the single lane routing boundary (gated runtime when admitted; raw runtime only
under the dev default). Pass the dev flag into phase 2 the smallest way the existing composition allows.

## Scope (files you may touch)

- MODIFY W\apps\ptah-extension-vscode\src\di\phase-2-libraries.ts (bind before registerCliAgentRuntimeServices, about :261)
- MODIFY W\apps\ptah-extension-vscode\src\di\container.smoke.spec.ts
- CREATE W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.ts and codex-lane-runtime-composition.spec.ts
- If the dev flag must come from the caller of phase 2, the minimum change in that caller file; list it.

Do not modify anything else.

## Spec cases

- Dev mode: the real CliDetectionService constructor selects CodexAppServerLaneAdapter.
- Production mode + gate closed: legacy adapter and no factory. Production + gate admitted: native via the gated runtime.
- Selected home and executable pin.
- create()/detect() spawn nothing.
- Dispose: scope disposed once; a failed open disposes the scope.
- An unavailable native binary fails visibly.
- Other adapters unchanged.

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-V-report.md

Write it first as a skeleton, then fill it in: files and lines changed, spec cases, `## Decisions`, `## Not done`, and
"Verify projects: ptah-extension-vscode, @ptah-extension/cli-agent-runtime, @ptah-extension/codex-runtime".
Reply only `WROTE: <absolute path>` plus a one-line headline. Call ptah_agent_report once before the final message.
