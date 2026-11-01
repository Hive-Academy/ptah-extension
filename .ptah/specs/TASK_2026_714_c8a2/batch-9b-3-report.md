## Changes

- `libs/backend/codex-runtime/src/lib/codex-dev-route.ts:2`: Replaced the single chat consumer with a frozen chat and gateway list; `:6` adds the coverage helper, which always excludes lane.
- `libs/backend/codex-runtime/src/index.ts:48`: Exported the coverage helper.
- `libs/backend/codex-runtime/src/lib/di/registration.ts:106`: Tracks warnings by container and consumer; `:118` admits a disabled consumer only when the override covers it and names that consumer in the warning.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:79`: Computes chat and gateway capability flags from their separate parity gates or covered development override.
- `apps/ptah-electron/src/di/codex-binding.types.ts:32`: Added the gateway capability to the Electron routing contract.

## Readers updated

- Searched all TypeScript files under `apps/` and `libs/` for override declarations, `readCodexDevRouteOverride`, and direct `.consumer`/`.consumers` access using PowerShell `Select-String`. The only production readers of the old override `consumer` field were `libs/backend/codex-runtime/src/lib/di/registration.ts:124` and `apps/ptah-electron/src/di/codex-runtime-composition.ts:82`; both now call `codexDevRouteCovers` at lines 121 and 83/86 respectively.
- `libs/backend/codex-runtime/src/index.ts:48` exports the new helper. Other search hits were the override declaration, specs, and source-surface guards in `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts` and `libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts`; they do not read the old field.
- `rg` was unavailable (`Access is denied`), and `ptah_lsp_references` could not resolve the worktree path. PowerShell `Select-String` supplied the reader census.

## Specs added

- `libs/backend/codex-runtime/src/lib/codex-dev-route.spec.ts:4`: Covers frozen consumer list, chat/gateway admission, lane exclusion, and absent override.
- `libs/backend/codex-runtime/src/lib/di/registration.spec.ts:54`: Confirms gateway without DS1 is gated; `:77` confirms gateway and chat runtime admission with one named warning per container per consumer, while lane remains gated.
- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:163`: Covers packaged and default capability flags; `:186` checks gate values without DS1; `:196` checks both development capabilities and gateway runtime admission.

## Decisions

- DS1 covers chat and gateway only in unpackaged hosts. Packaged hosts receive no override. Lane remains parity gated.
- Electron capability flags remain hints; runtime admission still passes through `resolveGatedCodexRuntime`.

## Not done

- No verify, test, lint, typecheck, build, Nx, diagnostics, or package command was run, per lane instruction. The coordinator owns checks.
- The CLI did not expose a skill loader; the local `agent-lanes` skill was read directly. No UI work was involved.
