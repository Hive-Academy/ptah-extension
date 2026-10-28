# Q2 backend report

## Changes

- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.ts`: default and read `autoHandoffAtLimit` through the existing strict boolean reader.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts`: pass the already-read config into every `composeState` call; emit `autoHandoff` on composed and disabled states, including retained-snapshot responses.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-config.provider.spec.ts`: defaults, explicit true/false, and invalid string/number/null/object/array coverage.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.spec.ts`: true/false propagation through live observations, loaded observations, retained snapshots after a setting change, and disabled states.
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-stage.spec.ts`: required state fixture field and expected object.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`: required state fixture field.
- `libs/backend/platform-core/src/file-settings-keys.spec.ts`: register/default/route assertion for the new key.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-budget.spec.ts`: required config fixture field.

`file-settings-keys.ts` needs no production edit: lines 71–77 derive defaults from `SESSION_BUDGET_SETTINGS`, line 284 spreads those keys into the writable registry, and line 465 spreads defaults. `settings-rpc.handlers.ts:172` uses `isFileBasedSettingKey` for settings:set admission.

## Verification

FAIL overall, exit 1. One foreground run:

```text
npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/platform-core,@ptah-extension/shared,@ptah-extension/rpc-handlers
NX   12 tasks: 8 succeeded, 4 failed
Run duration: 21m 46s
```

All four project typechecks passed; platform-core lint/test/typecheck passed. Failures:

- shared:test — `session-budget.types.spec.ts:89`, TS2741: required `autoHandoff` missing from the shared base fixture (coordinator-owned).
- agent-sdk:lint — `session-query-executor.accounts.spec.ts:174,183`, `no-unexpected-multiline` (outside this assignment).
- agent-sdk:test — `Test Suites: 5 failed, 2 skipped, 175 passed`; `Tests: 3 failed, 6 skipped, 3930 passed`. Failures resolve to `Could not locate module marked mapped as .../node_modules/marked/lib/marked.umd.js`. No budget spec or adapter fixture spec appears among the failing suites.
- rpc-handlers:test — `Test Suites: 72 failed, 104 passed, 176 total`; `Tests: 1 skipped, 2374 passed`. Same missing mapped `marked` dependency prevents suites including `chat-session-budget.spec.ts` from loading.

Existing Nx evidence logs (not generated deliverables): `/home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/11660882993031590253` (shared test), `15102788474343255164` (SDK lint), `17481308185772141557` (SDK test), `17801299010979478630` (RPC test).

Scoped Ptah diagnostics returned unavailable: TypeScript check still running after 45s; this is not counted as a pass. CLI-native skill discovery/invocation was unavailable; no skill was loaded. Native rg covered the requested backend/apps search instead of git grep because the lane role prohibits git. No Git mutations were performed.

## Decisions

- Reuse the current observation config in composition rather than reading settings again. Existing callers already hold validated config; this is a reversible signature-only internal change and keeps each observation consistent.
- Preserve automatic registry derivation instead of duplicating the setting in platform code. Evidence: shared-table spreads and settings:set guard above; reversible, no API change.

## Open questions / handoff

No product decisions remain. Coordinator/owning lanes must resolve the verification failures above. The explicitly excluded `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts:597` also contains a `SessionBudgetState` fixture missing `autoHandoff`; left untouched for its owner. Shared contract, frontend, CLI runtime, and .claude files were not edited.
