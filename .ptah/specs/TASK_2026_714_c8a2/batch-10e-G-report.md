# Batch 10e.G report

## Files changed

- `apps/ptah-electron/src/di/codex-lane-composition.ts:51`: exported pure Electron admission helper for unpackaged builds, a shared-gate admission, or the signed win32/x64 row. Lines 245 and 254 use it for factory binding and runtime routing. An admitted packaged lane with the shared gate closed resolves the raw `Runtime` token. The existing pin and binary inspection calls at lines 167 and 204 are unchanged.
- `apps/ptah-electron/src/di/codex-lane-composition.spec.ts:106`: fixture can represent packaged layout. Lines 185-212 cover admission, factory binding, raw runtime resolution and denial. Line 215 checks that a packaged binary digest mismatch rejects before spawning.
- `apps/ptah-electron/src/di/container.smoke.spec.ts:1222`: phase-2 fixture uses a mock platform. Lines 1407-1419 retain packaged denial on linux/x64 and assert native binding on win32/x64.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:108`: the expected no-factory state now logs a warning with the same message and `Error` context; the unavailable adapter remains. The factory-throws error and Sentry path at line 100 are unchanged.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts:157`: the no-factory assertion now expects `logger.warn`; the factory-throws assertion remains on `logger.error`.
- `.ptah/specs/TASK_2026_714_c8a2/batch-10e-G-report.md:1`: this report.

## Spec cases added/changed

- Packaged win32/x64: admission true, factory bound, raw runtime resolved; phase-2 detection selects the native adapter.
- Packaged darwin/arm64 and linux/x64: admission false, no factory, runtime resolution throws. The existing packaged-unavailable phase-2 assertion now uses explicit linux/x64.
- Unpackaged darwin/arm64 and linux/x64: admission true, factory bound, raw runtime resolved. Existing unpackaged win32/x64 adapter cases remain.
- Packaged win32/x64 with rejected binary inspection: mismatch propagates and no process spawns.
- No registered Codex factory: warning includes the same `Error` context and the Codex adapter stays unavailable. The factory-throws error/Sentry spec is unchanged.
- Per the task's first rules, no Jest, Nx, TypeScript compiler, lint, build, verify or diagnostics commands were run. The TypeScript parser returned zero syntax diagnostics for the edited spec; Ptah AST parsed the source and smoke spec cleanly but reported recovery on the lane spec.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Admit the native packaged Electron lane only on win32/x64 through one Electron-local helper. | Leave packaged Electron unavailable; open the shared gate for every host; admit the signed Electron row locally. | `p10-lane-parity-proof.md` Signature signs Electron live runs r2-r5; D29 selects Electron-only admission; `codex-parity-gate.ts:201-212` identifies win32/x64 as the reviewed row. | Yes: remove the local admission row after a later shared-gate release or revoke Electron admission. |
| Keep the gate's runtime route when it admits and otherwise use the raw token only after Electron admission. | Resolve gated token exclusively; allow raw token without admission; use raw token for signed Electron admission. | D27's routing boundary and D29's signed Electron exception; packaged pin and binary inspection stay in the existing open path. | Yes: change only this Electron helper and routing branch. |
| Log missing Codex factory as a warning while preserving the unavailable adapter. | Error log for both absence and factory failure; warning for expected absence and error/Sentry for factory failure. | Gate-closed CLI/TUI and production VS Code intentionally have no factory under D29; a throwing factory remains an actual composition failure. | Yes: restore the previous log level if host policy changes. |

## Proposed Removals

None.

## Clarifications Needed

None.

## CR byte check

PowerShell byte counting equivalent to `tr -cd '\r' < file | wc -c`:

| Written file | CR bytes |
| --- | ---: |
| `apps/ptah-electron/src/di/codex-lane-composition.ts` | 0 |
| `apps/ptah-electron/src/di/codex-lane-composition.spec.ts` | 0 |
| `apps/ptah-electron/src/di/container.smoke.spec.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.spec.ts` | 0 |
| `.ptah/specs/TASK_2026_714_c8a2/batch-10e-G-report.md` | 0 |
