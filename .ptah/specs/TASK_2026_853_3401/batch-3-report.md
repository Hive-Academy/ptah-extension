# Batch 3 report: shared contracts (TASK_2026_853_3401)

## Files

- MODIFIED `libs/shared/src/lib/types/advanced-settings.types.ts`: group id `'display'` added to
  `AdvancedSettingGroupId` and `ADVANCED_SETTING_GROUPS` (title "Display"). New boolean descriptor
  `display.autoOpenArtifacts` (group `display`, label "Open artifacts when published", help "Opens the
  Display panel on a newly published artifact.", `default: true`, `apply: 'live'`).
- MODIFIED `libs/shared/src/lib/types/advanced-settings.types.spec.ts`: key count 25 -> 26, boolean list
  gains `display.autoOpenArtifacts`, new test pins its group, default and apply.
- CREATED `libs/shared/src/lib/types/rpc/rpc-display-window.types.ts`: plain types for the six methods,
  the action union, the snapshot and the push payloads.
- MODIFIED `libs/shared/src/lib/types/rpc.types.ts`: `export *` of the new module, six entries in
  `RpcMethodRegistry` and six in `RPC_METHOD_ENTRIES` (so `RPC_METHOD_NAMES` includes them).

## Methods (all exported from `@ptah-extension/shared`)

| Method | Params | Result |
| --- | --- | --- |
| `displayWindow:open` | `DisplayWindowOpenParams` (`Record<string, never>`) | `DisplayWindowOpenResult` = `{ok:true}` \| `{ok:false, reason: DisplayWindowUnavailableReason}` (`'desktop-only' \| 'not-ready'`) |
| `displayWindow:close` | `DisplayWindowCloseParams` (empty) | `DisplayWindowCloseResult` `{closed: boolean}` |
| `displayWindow:status` | `DisplayWindowStatusParams` (empty) | `DisplayWindowStatusResult` `{supported: boolean, open: boolean}` |
| `displayWindow:publishState` | `DisplayWindowPublishStateParams` = `DisplayWindowSnapshot` `{tabId, revision, state: DisplayWindowJsonObject}` | `DisplayWindowPublishStateResult` `{delivered: boolean}` |
| `displayWindow:getState` | `DisplayWindowGetStateParams` (empty) | `DisplayWindowGetStateResult` `{state: DisplayWindowSnapshot \| null}` |
| `displayWindow:action` | `DisplayWindowActionParams` = `{tabId, action: DisplayWindowAction}` | `DisplayWindowActionResult` `{relayed: boolean}` |

Other exports:
- `DisplayWindowAction`: `{type:'select', key}` | `{type:'fullscreen-closed'}` |
  `{type:'view-state', surfaceKey, viewState: DisplayWindowJsonObject}` | `{type:'open-file', path}` |
  `{type:'review'}` | `{type:'attach'}`. `DISPLAY_WINDOW_ACTION_TYPES` lists the six `type` values.
- `DisplayWindowJsonValue`, `DisplayWindowJsonObject`: readonly recursive JSON types.
- `DISPLAY_WINDOW_STATE_MAX_BYTES = 4 * 1024 * 1024` (plan D2 cap).
- `DISPLAY_WINDOW_PUSH_TYPES = { state: 'displayWindow:state', action: 'displayWindow:action',
  closed: 'displayWindow:closed' }`, `DisplayWindowPushType`, `DisplayWindowStatePushPayload`
  (= snapshot), `DisplayWindowActionPushPayload` (`{tabId, action}`). `closed` carries no payload.

## Decisions

- **Zod schemas are not in this file.** Options: (a) zod in `rpc-display-window.types.ts`, (b) plain types
  here and strict zod schemas in the batch 5 handler. Evidence: `rpc.types.ts` is re-exported by the
  main barrel, which must stay zod-free (`libs/shared/src/schemas.ts` header, `index.ts:33-37`,
  `rpc-surface.types.ts` header); plan D2 places "Zod strict schemas" in the handler. Chose (b).
  Reversible: a `rpc-display-window.schemas.ts` exported from `schemas.ts` can be added later if a second
  parser (e.g. the child renderer) needs them.
- **Snapshot is opaque JSON** (`state: DisplayWindowJsonObject`) wrapped with `tabId` and `revision`.
  The renderer owns the wire shape (`display-window-wire.ts`, batch 9), so shared imports no frontend
  code. Reversible.
- **Open result reasons** are only the two the plan names (`desktop-only`, `not-ready`); a window creation
  failure surfaces as an RPC error. Reversible.
- **Push type and 4 MiB constants** live here so batches 5, 7 and 9 agree on one literal each.
- Empty params use `Record<string, never>`, as `rpc-auth.types.ts` does.

## Verification

`npm run verify -- -p @ptah-extension/shared`:
- `NX  3 tasks: 3 succeeded` (lint, test, typecheck; cache 0/3 hit)
- `lock released after 63.2s, exit code 0`

## Expected follow-on failures (other batches own the fix)

- The three `rpc-surface.spec.ts` files and `manifest.spec.ts` / registration coverage will report six
  unowned `displayWindow:*` methods until batches 5 and 6 land (`ALLOWED_METHOD_PREFIXES`, manifest entry,
  handler, surface specs).
- `settings:set` and platform-core `FILE_BASED_SETTINGS_DEFAULTS` derive from the table, so no other edit
  is needed for the setting; any spec elsewhere that pins the descriptor count or group list (for example
  the chat settings groups) may need its count updated. Not checked outside `shared`.
