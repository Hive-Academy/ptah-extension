# Batch 12c report: sanitize raw RPC error text in the agent and provider handlers

Executor: backend-developer (in-process subagent). No git was run and `batches.md` was not edited.

## Files (4)

- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.ts`
  - The `agent:setConfig` outer catch now returns the fixed text `'Could not save the orchestration settings.'`.
  - A `SettingsPersistError` (from `@ptah-extension/platform-core`, exported at `platform-core/src/index.ts:320`) passes
    through with its own message, which is fixed by construction: `Settings could not be saved to disk (<code>)`.
  - The logger still receives the original error object.
  - The inner Cursor-key catch (`'Failed to update the Cursor API key'`) and the validation returns are unchanged.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.handlers.ts`
  - The outer catches of `provider:setModelTier` and `provider:clearModelTier` now return `'Could not save the model tier.'`
    and `'Could not reset the model tier.'` respectively.
  - Both use a module-level `clientTierError(error, fixedMessage)`, which lets a `SettingsPersistError` through the same way.
  - The logger and Sentry calls are unchanged and still receive the error object.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\agent-rpc.handlers.set-config.spec.ts`
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\provider-rpc.handlers.spec.ts`

## Result shapes (D15 compatibility)

- All three RPCs still return `{ success: boolean; error?: string }`. Success returns `{ success: true }` as before.
- `providers-commit.service.ts` reads only `.success` from `agent:setConfig` (`:186`) and from `provider:setModelTier`
  (`:198`).
- The `'conflict'` outcome is produced on the frontend, inside the operation's `write()` / `settle()` (`:329-338`). No
  handler returns it, so no conflict shape needed to be kept or changed.
- The Zod validation failures in the tier RPCs now also get the fixed text. The tests only assert `success: false` for
  those, and the UI does not show the Zod text.

## Specs

New specs, one per RPC:
- A thrown `Error` whose message contains `sk-test-FAKEKEY123` and `C:\Users\someone\.ptah\settings.json` never
  appears in `JSON.stringify(result)`, and the result carries the fixed text.
- The logger receives the original error. For the provider RPCs, Sentry also receives it with the same
  `errorSource`.

Also new, one per RPC: a `SettingsPersistError` still passes through unchanged.

Existing assertions I changed on purpose, because they asserted the raw message:
- `agent-rpc.handlers.set-config.spec.ts`, the test "preserves unrelated field errors ..." is renamed to "reports
  unrelated field errors with fixed text ...". It now expects `'Could not save the orchestration settings.'`.
- `provider-rpc.handlers.spec.ts`, `provider:setModelTier` "captures service failures ...": `'disk full'` →
  `'Could not save the model tier.'`
- `provider-rpc.handlers.spec.ts`, `provider:clearModelTier` "captures service failures ...": `'write blocked'` →
  `'Could not reset the model tier.'`

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers --parallel=2`:
  - Test Suites: 1 failed, 115 passed. Tests: 1 failed, 4 skipped, 3412 passed.
  - The only failure is the known `harness/selection/harness-skill-selection-rpc.service.spec.ts`.
- Re-run of `typecheck,lint` alone: "Successfully ran targets typecheck, lint".
- The two changed specs run directly with jest: 2 suites, 61/61 passed.
- Gate G (webview rebuild and the reachability spec) was not run by this executor. It is the team-leader's
  single-writer gate at commit time.

## Follow-ups (out of scope, unchanged)

These still return a raw `error.message`. The Settings UI does not call them. They belong in the Batch 37
parity-evidence "Follow-ups" section:

- `agent:permissionResponse` (`agent-rpc.handlers.ts` ~`:638`, `:745`; the lines shift by +3 because of the import
  change)
- `agent:stop` (~`:775`)
- `agent:resumeCliSession` (~`:898`)
- The typed `AgentContinueError` return (~`:806`) is fixed, code-bearing text by design.

## Plan deviations

None.
