# Batch 10d.fix-r2 Part S report

## Changes

- S1: `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.spec.ts:422-433` declares `this: CodexRuntime` on the `open` mock, eliminating implicit `any`. It explicitly checks that the inspector's digest differs from the fixture pin and reaches the runtime binary identity.
- S2: `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts:265-270` marks the logged cleanup failure with `// degradation-audit: reported - ...`; the original open error is still rethrown.
- S3: `apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:213-227` overrides inspection for the port assertion case with a digest distinct from the pin and checks that the runtime receives the measured digest.

## Decisions

- **Use a typed mock receiver for S1.** Options were resolving registered ports or typing the `open` mock receiver. The VS Code host spec already uses `this: CodexRuntime` and typed bracket access for the same runtime assertion (`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:223-227`); this keeps the existing CLI assertion with the smallest edit. Reversible.
- **Override only the VS Code port case for S3.** Options were changing the shared fixture or this case. The fixture's same-digest default supports other cases (`apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.spec.ts:71-80`); the per-case override isolates the regression assertion. Reversible.

## Not done

- No tests, typecheck, lint, build, Nx, npm, verification command, or `ptah_get_diagnostics` ran, as required by the task hard rules. The coordinator must run checks.
- No skill-loading tool was listed for this lane; no skill was loaded.
