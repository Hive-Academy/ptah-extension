# Batch 9 report — Electron artifact host wiring

## Files changed

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.spec.ts`
- `libs/backend/vscode-lm-tools/src/index.ts`
- `apps/ptah-electron/src/di/phase-3-storage.ts`
- `apps/ptah-electron/src/di/container.smoke.spec.ts`
- `apps/ptah-electron/src/di/surface-composition.spec.ts`

## Wiring

The shared HTTP MCP server builds the dispatcher dependencies at `http-mcp-server.service.ts:389-409`. It optionally injects `PLATFORM_TOKENS.ARTIFACT_STORE` and the host notification token at lines 316-320, then passes both to `handleMCPRequest` at lines 402-403. Electron registers the store in `libs/backend/platform-electron/src/registration.ts:190-192` and its notification factory at `phase-3-storage.ts:53-68`, called at line 156. VS Code and CLI do not register either optional port, so their tool keeps the unsupported-host result.

The Electron callback resolves `TOKENS.WEBVIEW_MANAGER` when the notification arrives, after the renderer has been registered. It enumerates `getActiveWebviews()` and awaits `sendMessage(viewType, 'artifact:published', metadata)` at `phase-3-storage.ts:57-66`. This follows the surface push pattern in `dashboard-namespace.builder.ts:123-169`; the Electron adapter forwards it through `IpcBridge.sendToRenderer` at `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:47-53`. The artifact tool handler validates the metadata before calling this callback (`artifact-tool-handlers.ts:51-59`).

## Guard specs and verification

- `container.smoke.spec.ts:686-687` verifies the phase-0 Electron store registration and resolution.
- `surface-composition.spec.ts:58-89` verifies late renderer registration and the exact `artifact:published` renderer envelope.
- `http-mcp-server.service.spec.ts:336-354` verifies both ports reach the HTTP dispatcher dependency object.
- `NX_NO_CLOUD=true npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/container.smoke.spec.ts apps/ptah-electron/src/di/surface-composition.spec.ts --coverage=false --maxWorkers=2`: **2 suites, 34 tests passed**. Jest emitted its pre-existing worker-exit warning.
- `NX_NO_CLOUD=true npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.spec.ts --coverage=false --maxWorkers=2`: **1 suite, 69 tests passed**.
- `NX_NO_CLOUD=true npx nx typecheck ptah-electron --parallel=1`: **passed**.
- `NX_NO_CLOUD=true npx nx typecheck vscode-lm-tools --parallel=1`: **passed**.
- Scoped `ptah_get_diagnostics` was invoked after edits but its TypeScript worker remained in progress beyond the tool timeout; the explicit Nx typechecks passed.

## Decisions

- **Use optional ports in the shared dispatcher builder.** Options were a host-specific server builder or optional DI ports in the existing builder. The store is registered only by Electron and the builder already accepts optional platform dependencies (`http-mcp-server.service.ts:284-309`). This preserves other hosts without duplicate servers. Reversible by moving port construction to host composition.
- **Resolve the Electron webview manager at notification time.** Options were early capture or lazy resolve. Phase 3 runs before renderer registration, as the existing surface composition guard documents and tests. Lazy resolve follows that established pattern. Reversible if host boot order changes.
- **Keep `expected-resolvable.ts` and VS Code/CLI guards unchanged.** `EXPECTED_RESOLVABLE` lists RPC handler classes, while the new entries are optional DI ports. The Electron guard covers its registered store; other hosts intentionally leave both ports absent. Reversible if the guard contract expands to ports.

## Anything not done

- No live Electron UI or end-to-end run was performed; the task explicitly limited verification to targeted Jest and typechecks.
