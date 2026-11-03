# Batch 10d.V report

## Files and lines changed

- `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts:18-243` (new): lazy native factory, selected home and lane identity store, reviewed binary inspection, per-open child runtime, scope disposal, and the single D27 lane routing boundary.
- `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:1-290` (new): focused composition cases.
- `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:90,102-106,263-266`: bind the native factory before `registerCliAgentRuntimeServices`.
- `apps/ptah-extension-vscode/src/di/container.ts:53`: pass `context.extensionMode === vscode.ExtensionMode.Development` into phase 2.
- `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:37-50,92-148`: real `CliDetectionService` constructor selection and peer adapter guards.

## Spec cases

- Development selects `CodexAppServerLaneAdapter`; gate-closed production retains `CodexCliAdapter` without a factory; gate-admitted production selects native. Peer adapter classes stay the same.
- Native `create()` and `detect()` do not spawn. Missing binary makes detection fail and the probe rejects visibly.
- Selected `CODEX_HOME` reaches the lane profile; the native binary's SHA-256 is checked against the platform pin, which supplies its version without spawning during detection.
- Child scope closes once; an open failure closes and disposes it. The lane routing helper admits the gated runtime in production and the raw runtime only in development.
- User input is declined with a single kind-only output line. The adapter's existing approval sink handles the remaining approval kinds.
- An explicitly empty selected home yields one diagnostic and no process spawn.

## Decisions

- **Development mapping:** use `ExtensionMode.Development`, passed from `DIContainer.setup`. Alternative: read environment or infer from paths. Evidence: task D28 and `bootstrap.ts:92`; reversible by changing the phase 2 input.
- **Binary ownership:** resolve the VS Code host's native binary, verify its SHA-256 against `findCodexExecutablePin`, and derive the version from the matching reviewed pin. Alternative: import Electron's app-private inspection helper, which launches `--version` during detection. Evidence: the Electron helper lives inside `apps/ptah-electron`; the shared resolver is exported by `agent-sdk`; the task requires `detect()` to spawn nothing. Reversible by replacing this host-local inspection when a shared public helper exists.
- **Runtime scope:** create one child container per lane open and dispose it after `CodexRuntime.close()`. Alternative: a parent singleton. Evidence: D27 and the approved Electron lane pattern require child ownership and separate lane contexts; reversible within this host helper.

## Not done

- Tests, typecheck, lint, build, Nx, npm, verify, and `ptah_get_diagnostics` were not run because the task forbids them. The coordinator must run the stated checks and review the new specs.
- No live Codex App Server observation was made. No skill-loading tool was exposed to this lane; no optional skill was loaded.

Verify projects: ptah-extension-vscode, @ptah-extension/cli-agent-runtime, @ptah-extension/codex-runtime
