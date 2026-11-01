# Batch DS1 implementation report

Task: TASK_2026_714_c8a2, Phase P5b. Date: 2026-10-25.

DS1.1 and DS1.2 are implemented. Final scoped verification passed. Task state files were not edited; no git commands were run.

## DS1.1: Pure dev-route reader

Created the readonly `CodexDevRouteOverride` contract and `readCodexDevRouteOverride`. The reader returns a frozen chat override only when `isPackaged === false` and the supplied environment contains exactly `PTAH_CODEX_RUNTIME_DEV=1`. All other inputs return null. The module has no imports, process access, or I/O.

The colocated spec covers the enabled case, object freezing, packaged hosts with every tested switch value, and unpackaged hosts with `true`, `0`, leading/trailing whitespace, empty string and undefined. All 14 reader cases passed within the project suite.

## DS1.2: Registration and gated resolution

Added `CODEX_RUNTIME_TOKENS.DevRouteOverride` and optional `devRoute?: CodexDevRouteOverride | null` registration input. Omitted and explicit null inputs register a null factory; supplied overrides register their value. Exported the reader and type from the public barrel; its existing token-object export exposes the new token.

The resolver still checks the parity gate first. With the gate disabled, only consumer `chat` with a registered chat override can resolve the existing cached runtime. Gateway and lane throw `Codex production routing disabled by parity gate`, before and after chat resolves. The registered `CodexRuntimeLogger.warn` port emits a warning naming `PTAH_CODEX_RUNTIME_DEV` as development-only once per container. A WeakSet tracks warnings without retaining disposed containers.

Registration specs cover absent and explicit null overrides, no runtime resolution when denied, cached chat runtime identity, gateway/lane denial before and after chat resolution, exactly one warning for each of two independent containers, no process spawn, and unchanged `enabled: false` gate decisions for all three consumers. The tests import the reader through the public barrel.

`codex-parity-gate.ts` was not edited: both its decision type and returned decision retain literal `enabled: false`. `codex-gateway-adapter.ts` was not edited; its `Omit<CodexRuntimeRegistrationPorts, 'sink'>` spread registration remains compatible, verified by its project typecheck.

## Risk handling

- **R7-1, packaged-build leakage:** the pure reader requires strictly false packaging state and exactly `1`, and returns a frozen object. Packaged + `1` is explicitly tested to return null. Passing the real Electron `app.isPackaged` value remains Batch 8a's composition responsibility, as specified in the Session 7 plan; this batch does not wire any host switch.
- **R7-2, gateway/lane bypass:** the override type permits only chat, and the resolver independently checks both requested consumer and registered override consumer. Regression assertions verify gateway and lane remain blocked even after successful chat resolution. Production gate decisions remain disabled.

## Decisions

- **Warning ownership:** used a module-local `WeakSet<DependencyContainer>` rather than an extra DI state token. Evidence: DS1.2 requires one warning per container, and existing registration already owns cached runtime instances per host. The WeakSet provides exactly that lifetime without keeping containers alive. Reversible internal implementation choice; no public API addition beyond the prescribed token and port.
- **Null registration:** used explicit registration branches rather than a conditional provider union. Evidence: local tsyringe overloads reject the union (TS2769); its existing null usage registrations use `useFactory: () => null`. Reversible implementation detail preserving the prescribed contract.

## Verification

All verification used the machine-wide FIFO lock through `npm run verify`, sequentially. No lock workaround, installation, workspace-wide check, build, serve, dev, e2e or package target was used. Static output was requested through the documented second `--` to expose project-count headers; logs were read rather than rerunning checks to retrieve output.

| Project | Target | Final result |
| --- | --- | --- |
| @ptah-extension/codex-runtime | lint | PASS, 0 errors / 8 warnings in untouched files |
| @ptah-extension/codex-runtime | test | PASS, 17 suites / 784 tests |
| @ptah-extension/codex-runtime | typecheck | PASS |
| @ptah-extension/gateway-chat-bridge | typecheck | PASS |
| @ptah-extension/auth-providers | typecheck | PASS |

First command: `npm run verify -- -p @ptah-extension/codex-runtime`.

Initial result: exit 1; lint passed, tests/typecheck failed on TS2769 in the conditional DI provider registration. The stored failure logs showed 16 passing suites, one suite blocked by compilation, and 777 passing tests. The registration was corrected to explicit branches. Scoped `ptah_get_diagnostics` then returned 0 errors / 0 warnings with clean coverage. This failure prompted the corrective rerun below.

Corrected command: `npm run verify -- -p @ptah-extension/codex-runtime -- --output-style=static`.

Selected header and tailed result:

```text
NX Running targets lint, test, typecheck for project @ptah-extension/codex-runtime:
Test Suites: 17 passed, 17 total
Tests:       784 passed, 784 total
8 problems (0 errors, 8 warnings)
NX Successfully ran targets lint, test, typecheck for project @ptah-extension/codex-runtime
[verify 2026-10-25T16:22:40.762Z] lock released after 36.2s, exit code 0
```

The singular named-project header confirms exactly the one requested project. Warnings are in untouched `src/lib/codex-runtime.ts` and `tools/evidence-harness.ts`. Jest also reported its config ES-module warning, an OS-forbidden symlink fixture skip, and a worker force-exit warning; the suite passed. No claim is made that the skipped fixture ran.

Next command: `npm run verify -- -t typecheck -p @ptah-extension/gateway-chat-bridge,@ptah-extension/auth-providers -- --output-style=static`.

Selected header and tailed result:

```text
NX Running target typecheck for 2 projects:
- @ptah-extension/gateway-chat-bridge
- @ptah-extension/auth-providers
> nx run @ptah-extension/auth-providers:typecheck
> tsc --noEmit --project libs/backend/auth-providers/tsconfig.lib.json
> nx run @ptah-extension/gateway-chat-bridge:typecheck
> tsc --noEmit --project libs/backend/gateway-chat-bridge/tsconfig.lib.json
NX Successfully ran target typecheck for 2 projects
[verify 2026-10-25T16:23:10.905Z] lock released after 29.7s, exit code 0
```

The header confirms exactly the two requested projects. Auth-providers lint was not requested or run.

Full command logs are temporary verification output, outside the repository:

- `C:/Users/abdal/AppData/Local/Temp/ptah-DS1-codex-runtime-verify.log`
- `C:/Users/abdal/AppData/Local/Temp/ptah-DS1-codex-runtime-verify-final.log`
- `C:/Users/abdal/AppData/Local/Temp/ptah-DS1-dependents-verify.log`

## Files created or modified

Created:

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-dev-route.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-dev-route.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-DS1-report.md`

Modified:

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/di/tokens.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/di/registration.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/di/registration.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/index.ts`

## Scope and follow-up

No DS1 implementation or required verification remains blocked. Source edits are limited to the six assigned codex-runtime files. No settings or task-state files were changed. The coordinator still owns the Session 7 phase-gate host checks, independent P5b code-logic review, task-state updates, and git delivery. Electron composition and live scenarios belong to subsequent batches.
