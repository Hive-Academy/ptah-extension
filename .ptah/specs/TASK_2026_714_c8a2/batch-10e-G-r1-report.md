# Batch 10e.G revision 1

1. `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:180-185` — kept the separate runtime scope and approval sink assertions; added packaged win32/x64 admission and moved the packaged parity rejection to linux/x64. A source scan of `apps/ptah-electron/src` found no other stale packaged win32/x64 lane rejection; the remaining `resolveGatedCodexRuntime` rejection tests still target the closed shared gate.
2. `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:202-209` — registered `createMockLogger()` under `TOKENS.LOGGER` and passed `scope.resolve<Logger>(TOKENS.LOGGER)`, matching the fixture pattern. The existing parameterized test now also checks the packaged signed-admission info log.
3. `apps/ptah-electron/src/di/codex-lane-composition.ts:54-57,261-263` — documented that the shared lane gate is closed until P14 and that the win32/x64 literal mirrors `codex-parity-gate.ts:201-212`. Routing behavior is unchanged.
4. `apps/ptah-electron/src/di/codex-lane-composition.ts:247-251` — emit one info line when a packaged Electron factory is registered through D29 signed admission while the shared gate is closed.
5. `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:125-130` — assert that the production Codex adapter detects as `{ cli: 'codex', installed: false, messagingMode: 'none' }`, matching `unavailableCodexAdapter`.

The edited specs use explicit platform inputs or fixture path syntax instead of the real `process.platform`. The Electron symlink fixture uses a directory junction type, which Node ignores on non-Windows hosts. No test, typecheck, lint, build, diagnostic, or install command was run, as instructed. The Ptah symbol index was empty, so source inspection used PowerShell. No CLI skill invocation mechanism was exposed for this lane.

## CR byte counts

- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts`: 0
- `apps/ptah-electron/src/di/codex-lane-composition.spec.ts`: 0
- `apps/ptah-electron/src/di/codex-lane-composition.ts`: 0
- `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`: 0
- `.ptah/specs/TASK_2026_714_c8a2/batch-10e-G-r1-report.md`: 0
