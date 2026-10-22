# R2 revision 1 report

## Changes and evidence

| Defect | Change | Verification |
| --- | --- | --- |
| #1 session route lacks workspace segment | `protocol-dispatcher.ts:2355-2364` resolves the caller workspace through the session-aware `ptahAPI.workspace.getInfo()` path only when a caller session id exists. `artifact-tool-handlers.ts:44-47` keeps the missing-scope error. The workspace namespace uses `resolveSessionWorkspaceRoot` in `ptah-api-builder.service.ts:1059-1066`. | `artifact-tools.spec.ts` — `refuses missing scope and unsupported hosts without saving`; no dispatcher integration spec was added. |
| #2 advertised MCP input rejects fields | `artifact-tools.ts:8-30` retains generated `anyOf` branches and supplies the top-level object `properties` required by `MCPToolDefinition`. It removes only `$schema` and the incompatible root `additionalProperties`; branch strictness remains. | `artifact-tools.spec.ts` — `serves the contract schema and rejects extra scope fields`. |
| #4 list uses wrong session/workspace | `artifact.types.ts:22`, `artifact.schemas.ts:68-70` require a trimmed, bounded session id. `artifact-rpc.handlers.ts:43-59` resolves either tab or SDK id through `SessionLifecycleManager.find`, then lists with the record's `tabId` and `config.projectPath`; unknown ids return empty. `artifact.store.ts:20,52` reloads by active tab id and sends that same id. | `artifact.schemas.spec.ts` — `validates metadata and a bounded routing session list request`; `artifact-rpc.handlers.spec.ts` — `resolves a tab or SDK id and lists only its routing tab and workspace`, `returns only the registry session rows without saved paths`, `returns an empty list without a store or known session`; `artifact.store.spec.ts` — `reloads the active session and ignores other session records`. |
| #9 external link policy | `artifact-rpc.handlers.ts:17,75` calls existing Electron `isSafeExternalUrl` after HTTP(S) schema validation and returns `{ opened: false }` for a refusal. | `artifact-rpc.handlers.spec.ts` — `refuses a URL declined by the Electron navigation policy`. |
| #12 new artifact and private path | `artifact-tools.ts:19` and `artifact-tool-handlers.ts:74` state that each publish creates a new artifact. Tool output and notification retain no `savedPath` (`artifact-tool-handlers.ts:54-77`). Store implementation in R1 creates a new UUID and revision 1 (`electron-artifact-store.ts:133-146`) and projects list records without `savedPath` (`:177-188`). | `artifact-tools.spec.ts` — `publishes using trusted scope and sends only validated metadata`; `artifact-rpc.handlers.spec.ts` — `returns only the registry session rows without saved paths`. |
| Store errors | `artifact-tool-handlers.ts:28-29` maps `QUOTA` and `IO_ERROR` to fixed messages. `artifact-rpc.handlers.ts:60-67` maps typed list storage errors to a fixed `PERSISTENCE_UNAVAILABLE` error. | `artifact-tools.spec.ts` — `maps store errors without leaking source content`. |
| Reload failures | `artifact.store.ts:16,54-75` exposes `lastError` and preserves existing rows on RPC or parse failure. | `artifact.store.spec.ts` — `keeps existing rows and exposes a failure when list RPC fails`, `keeps notifications and warns when reload data is invalid`. |

## Session identity

The SDK MCP URL carries the routing tab id (`sdk-query-options-builder.ts:1900`); publish stores scope.sessionId (`electron-artifact-store.ts:139`). The webview store now buckets notifications by `record.sessionId` (`artifact.store.ts:44-47`) and reloads by `TabManagerService.activeTabId()` (`artifact.store.ts:20`), so both keys are the routing tab id.

## Decisions

- The MCP definition type requires root `properties` and a boolean `additionalProperties`, while Zod's union emits `anyOf`. I kept the generated branches and added root properties for the three documented inputs. This is reversible if the MCP definition type is widened.
- `isSafeExternalUrl` currently lives only in the Electron app. I imported that pure predicate directly into the RPC handler to use the existing policy. This is reversible if the policy moves to a shared library.

## Verification

- Shared artifact schema spec: 7 passed.
- VS Code LM tool artifact spec: 5 passed.
- RPC handler artifact spec: 10 passed.
- Frontend chat artifact store spec: 4 passed.
- Scoped `ptah_get_diagnostics` was attempted twice after edits; the TypeScript service reported that checks were still running after 45 seconds and returned no diagnostics.

## Remaining cross-lane work

- The display sheet, owned by R3, still indexes `artifactStore.records()` by `claudeSessionId` (`display-sheet.component.ts:125-129`). R3 must use `this.tabId()` so published rows can appear. R3 already reads `lastError` at `display-sheet.component.ts:88`.
- The dispatcher session-workspace path has no new transport-level integration spec in this lane. `getInfo()` is session-aware through `resolveSessionWorkspaceRoot`, but that resolver also has active-session/provider fallbacks; an unknown caller session id is not independently rejected by this change.
