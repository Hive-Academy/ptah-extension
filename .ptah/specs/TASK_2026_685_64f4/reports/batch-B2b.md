# Batch B2b report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\shared\src\lib\types\rpc.types.ts` — added the registry contract and method entry.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.schema.ts` — added validated history-page params.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.ts` — injected the existing history reader and registered the page handler.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-history-page.ts` — new pure clipping and page assembly module.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.spec.ts` — registration, validation, status, read failure, cursor specs and mock reader injection.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-history-page.spec.ts` — content, encoded byte, envelope, status and cursor specs.

## Acceptance

- B2b.1: `subagent:history-page` is in `RpcMethodRegistry` and `RPC_METHOD_ENTRIES`; the host-source baseline was left intact.
- B2b.2: Zod checks required session ID, safe tool/agent IDs, optional cursor and a 1024–262144 byte limit defaulting to 128 KiB.
- B2b.3: The handler calls B2a's `readSubagentEvents`, maps validation and read errors, and pages the returned events. The pure module applies content caps, then a 96 KiB serialized-event cap, and measures the full response envelope with a 64-character correlation ID, 32-character cursor and 128-character agent ID reservations. The page advances by event index, limits to 2000 events and trims the end if the final measurement exceeds the requested budget. A single event can exceed a small requested `maxBytes` but must fit the 256 KiB hard cap.

## Spec cases

- Registration includes seven methods; unsafe agent IDs and malformed cursors are rejected before reading; read failure yields a path-free message.
- 300 KiB text, 1 MiB tool result, 200 KiB tool input, 90,000 control characters and 90,000 multibyte characters are clipped; a small budget still advances one event; a near-full page respects 36- and 64-character correlation IDs; statuses and terminal cursors are distinct.
- The requested final cut-back branch has no direct spec. The current measurement uses the same reservation model during accumulation and final checking, so a multi-event overrun is not constructible through the public inputs.

## Guard specs

No guard specs were changed. The seven DI guard specs named in the plan are manifest-driven and use the existing `SubagentRpcHandlers` registration; `expected-resolvable.ts` needs no new token entry. The host-source contract baseline was intentionally not changed. The plan's separate `rpc-allowlist.spec.ts` is covered by the scoped rpc-handlers project test.

## Decisions

- Put clipping and paging in the new sibling pure module chosen by the team leader (versus embedding in the handler). Evidence: batch B2b.3 and plan Risk 13. Reversible: yes.
- Use decimal event offsets as cursors and reject malformed or out-of-range offsets (versus an encoded cursor). Evidence: page contract calls it an opaque event index; offsets advance without skipping. Reversible: yes.
- Encode a clipped tool input as `{ clipped: string }` after applying the head/tail marker to its JSON representation (versus trying to preserve arbitrarily nested object fields). Evidence: `toolInput` is an open record and the plan prioritizes bounded display content. Reversible: yes.
- Reserve the maximum agent ID and correlation ID in page measurement (versus current values). Evidence: plan D16 and the full-envelope requirement. Reversible: yes.

## Verification

No test, typecheck, lint, build, serve, e2e or package command was run, per lane brief. Scoped `ptah_get_diagnostics` was attempted twice and returned TypeScript unavailable after 45 seconds both times; AST parsing returned zero error nodes for the new page module and handler. Runtime and type correctness remain unverified.

Run one command at a time:

1. `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1`
2. `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1`
3. `npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1`
4. `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/host-source-registry.contract.spec.ts --coverage=false --maxWorkers=2`
5. `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts apps/ptah-extension-vscode/src/di/surface-composition.spec.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`
6. `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/rpc-surface.spec.ts apps/ptah-electron/src/di/surface-composition.spec.ts apps/ptah-electron/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`
7. `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/surface-composition.spec.ts --coverage=false --maxWorkers=2`
