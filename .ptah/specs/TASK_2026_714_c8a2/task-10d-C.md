# Task: batch 10d.C — CLI and TUI native Codex lane wiring (TASK_2026_714_c8a2)

Read first and follow: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\task-10d-common-rules.md
(hard rules, Electron pattern, D26/D27, R1-R4). W and T below are defined there.

## Objective

Wire the native Codex App Server lane factory into the CLI engine (used by ptah-cli and ptah-tui), following the
Electron pattern and D27. Plan text: T\plan-p10.md section "10d.C" (its "select native by default" is replaced by
D27/D28 below).

D27 mapping for CLI/TUI (coordinator decision D28, reversible): the CLI has no dev/unpackaged signal, so bind the
factory ONLY when the lane parity gate (the same gate check the Electron helper uses, `CodexParityGate` /
`resolveGatedCodexRuntime(scope, 'lane', platform)`) admits 'lane'. Gate closed -> bind no factory -> legacy Codex SDK
lane. Lane opens resolve the runtime through one CLI helper (the gated runtime). Add no TUI-specific product surface.

## Scope (files you may touch)

- MODIFY W\libs\backend\cli-engine\src\lib\container.ts (bind before registerCliAgentRuntimeServices, about :768)
- MODIFY W\libs\backend\cli-engine\src\lib\surface-composition.spec.ts
- CREATE W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.ts and codex-lane-runtime-composition.spec.ts
- MODIFY W\apps\ptah-cli\src\di\container.smoke.spec.ts
- If cli-engine's project.json or package.json needs a dependency entry for an imported lib, the minimum change; list it.

Do not modify anything else.

## Spec cases

- CLI resolution through the real CliDetectionService constructor: gate closed -> legacy adapter and no factory;
  gate admitted -> CodexAppServerLaneAdapter.
- TUI resolves through the same engine container.
- create()/detect() spawn nothing.
- Thread identity persist/resume with the 'lane' marker.
- Stop/dispose: scope disposed once; a failed open disposes the scope.
- Missing executable pin is refused visibly.
- Queue mode.
- The same CODEX_HOME reaches profiles, credentials, catalog and user MCP discovery.

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-C-report.md

Write it first as a skeleton, then fill it in: files and lines changed, spec cases, `## Decisions`, `## Not done`, and
"Verify projects: @ptah-extension/cli-engine, ptah-cli, ptah-tui, @ptah-extension/cli-agent-runtime, @ptah-extension/codex-runtime".
Reply only `WROTE: <absolute path>` plus a one-line headline. Call ptah_agent_report once before the final message.
