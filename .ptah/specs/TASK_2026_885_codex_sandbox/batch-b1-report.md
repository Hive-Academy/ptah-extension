# B1 backend report

## Files changed
- `libs/shared/src/lib/types/advanced-settings.types.ts`, `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`
- `libs/backend/platform-core/src/file-settings-keys.ts`, `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`, `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts`
- `libs/backend/codex-runtime/src/lib/codex-execution-profile.ts`, `codex-runtime.types.ts`, `codex-runtime.ts`, `codex-context.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-profile.ts`
- `apps/ptah-electron/src/di/codex-lane-composition.ts`, `codex-runtime-composition.ts`
- `libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts`
- Specs: `codex-execution-profile.spec.ts`, `agent-rpc.handlers.set-config.spec.ts`, `file-settings-keys.spec.ts`

## Contract
Exported the four sandbox modes, default `workspace-write-network`, and Zod schema through the existing shared public index. `agent:getConfig` returns the effective mode. `agent:setConfig` validates before writes and returns a named field error on invalid input. The value is stored at `agentOrchestration.codexSandboxMode`, included in file settings defaults and export. Profile resolution maps all four choices for chat, gateway and lanes; approval mapping remains consumer-specific. The choice is snapshotted and fingerprinted, and thread/turn policies carry full access. Electron and CLI lane composition and chat/gateway composition read the saved choice. Electron WRITE_DAC prewarm and lane preflight apply only for workspace-write.

## Tests and checks
- `npm run verify -- -p codex-runtime`: failed; header showed one project, Nx plugin loading failed with `spawn EPERM`. Not retried.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/codex-runtime/tsconfig.lib.json`: passed.
- Same command with `libs/backend/codex-runtime/tsconfig.spec.json`: passed.
- Same command with `apps/ptah-electron/tsconfig.app.json`: passed after correcting the history profile path.
- Same command with `libs/backend/cli-engine/tsconfig.lib.json`: passed.
- Same command with `libs/shared/tsconfig.lib.json`: passed.
- `node node_modules/jest/bin/jest.js --runInBand -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-execution-profile.spec.ts --coverage=false`: passed, 51 tests. Includes all four policies, default, invalid value, and fingerprint change.
- Same Jest form with `libs/backend/rpc-handlers/jest.config.ts` and `agent-rpc.handlers.set-config.spec.ts`: passed, 84 tests. Includes default, override, and invalid write.
- Same Jest form with `libs/backend/platform-core/jest.config.ts` and `file-settings-keys.spec.ts`: passed, 151 tests before the final new assertion.
- `codex-runtime.spec.ts`: failed 127 tests with `CodexHomeMismatchError` in the app-server fixture; this prevents runtime integration confidence in this sandbox.
- `ptah_get_diagnostics` after edits: unavailable; compiler remained running beyond the 45-second tool window.

## Decisions
- Kept the saved mode optional in the execution profile interface for existing direct profile fixtures; the builder always populates it from the validated default. Reversible when all profile fixtures are migrated.

## Open issues
- Coordinator should run the official verify outside this sandbox.
- Runtime fixture failures need investigation before claiming end-to-end app-server coverage.
- CLI-agent-runtime and rpc-handlers scoped typechecks initially reported concurrent lane messaging edits in `agent-process-manager.service.ts` (`pendingMessages` string versus record). Those files are owned by another executor and were left untouched.

