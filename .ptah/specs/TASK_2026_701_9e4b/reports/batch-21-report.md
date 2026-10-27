# Frontend implementation — `TASK_2026_701_9e4b`, batch 21

**Tasks completed**: 21.1 `LibraryChangeFeed` and `PluginCatalogService.configHome`

## Files

- CREATED `libs/frontend/marketplace/src/lib/services/library-change-feed.ts` — `providedIn: 'root'` `MessageHandler` for `library:changed`, `latest` signal `{workspaceRoot, status, reasons, at}`
- CREATED `libs/frontend/marketplace/src/lib/services/library-change-feed.spec.ts` — 15 cases (valid push, `at` stamp, failed status, identical repush, VS Code inert, 7 malformed payloads, other types, reasons copy)
- MODIFIED `libs/frontend/marketplace/src/services.ts` — exports `LibraryChangeFeed` and `type LibraryChange` from the services-only barrel
- MODIFIED `apps/ptah-extension-webview/src/app/app.config.ts` — imports from `@ptah-extension/marketplace/services` (narrow barrel), registers in `MESSAGE_HANDLERS` right after `HarnessHealthStore`
- MODIFIED `libs/frontend/core/src/lib/services/plugin-catalog.service.ts` — read-only `configHome` computed; snapshot carries `configHome`
- MODIFIED `libs/frontend/core/src/lib/services/plugin-catalog.service.spec.ts` — new `PluginCatalogService — configHome` describe (7 cases)

## Quality requirements -> evidence

| Requirement | Evidence |
| --- | --- |
| `providedIn: 'root'` MessageHandler | `library-change-feed.ts:41-42` (`@Injectable({ providedIn: 'root' })`, `implements MessageHandler`); `handledMessageTypes = [MESSAGE_TYPES.LIBRARY_CHANGED]` at `:47` |
| Registered next to existing MESSAGE_HANDLERS | `app.config.ts:406-419` — directly after the `HarnessHealthStore` entry (`:408`), the plan's `:403-407` anchor; import `app.config.ts:133-136` via the narrow `/services` barrel |
| Signal `{workspaceRoot, status, reasons, at}` | `LibraryChange` interface `library-change-feed.ts:9-17`; `latest` readonly signal `:50`; set at `:58` with `at: Date.now()` |
| Inert in VS Code (D3) | `library-change-feed.ts:56` returns unless `VSCodeService.isElectron` (read per message, since host config can arrive after construction); spec "ignores every push outside Electron (D3)" |
| Untrusted payload narrowed | `parseLibraryChanged` `library-change-feed.ts:63-83`; malformed push keeps last value (spec `it.each`) |
| `configHome` read-only | `plugin-catalog.service.ts:115-117` — a `computed`, no setter |
| `configHome` from `plugins:get-config` | `plugin-catalog.service.ts:250-256` splits `configHome` off `PluginConfigStateWithHome` so `config()` stays the saved state |
| Scoped and cleared on workspace switch | derived from `current()` (`:91-95`, scope-key guard), stale in-flight answers dropped by the existing guard (`:214`); `null` on failure paths `:240-245`, `:272-277`; spec "clears on a workspace switch and reads the new workspace notice" |
| No `webview-e2e-harness` import (A29) | grep of both new files and the catalog service: no match |
| No `any`, no `as unknown as` | same grep: no match; the only cast is `payload as Record<keyof LibraryChangedPayload, unknown>` after an object/null check |
| Host only via ClaudeRpcService / MESSAGE_HANDLERS | feed receives through `MESSAGE_HANDLERS`; catalog keeps its existing `ClaudeRpcService` calls; no new RPC |
| Initial bundle | the only eager addition is one small service (no component, no new dependency) through the services-only barrel that already loads `HarnessHealthStore` |

Contracts read, not changed: `LibraryChangedPayload` (`libs/shared/src/lib/types/messages/payload-map.ts:200`), `MESSAGE_TYPES.LIBRARY_CHANGED` (`message-constants.ts:355`), `PluginConfigHomeStatus` / `PluginConfigStateWithHome` (`rpc/rpc-misc.types.ts:608-619`), `plugins:get-config` result (`rpc.types.ts:1304-1308`).

## Verification

Command: `npm run verify -- -p @ptah-extension/marketplace,@ptah-extension/core,ptah-extension-webview`

Result: `NX 9 tasks: 7 succeeded, 2 failed` (exit 1). All test and typecheck targets passed for all three projects, and marketplace lint passed.

- `ptah-extension-webview:lint` failed. This is the accepted pre-existing failure: `app.routes.ts:224` circular dependency with `@ptah-extension/command-center`. Nothing reported in `app.config.ts`.
- `@ptah-extension/core:lint` failed with 2 errors (and 14 warnings), all outside this batch: `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:15:5` and `:28:5` (`@angular-eslint/template/interactive-supports-focus`). The file has no diff against `main` (last change `83e4958c7`), so the failure is pre-existing. No lint finding names `plugin-catalog.service.ts` or its spec. I did not re-run it, because nothing in this batch can fix it.

## Decisions

- `configHome` is split off the config record, and `config()` no longer carries it. Options were to leave it inside `config()` or to split it. Evidence: plan 1382-1384 asks for a separate signal, and `config()` is described as "the saved enable/disable state". Reversible.
- The feed is unscoped: it holds the last push, and consumers compare `workspaceRoot` with their own root. Evidence: the plan sets the signal shape to `{workspaceRoot, …}` and does not ask the feed to filter. Reversible.

**Plan deviations**: none.

**Out-of-scope observations**: `@ptah-extension/core:lint` fails because of the pre-existing `attention-permission-actions.component.ts` a11y errors above. It is not accepted the way webview lint is, so the batch's verify line cannot be fully green until that is fixed or accepted.
