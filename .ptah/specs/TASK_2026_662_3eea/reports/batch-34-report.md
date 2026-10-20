# Batch 34 report

| Old key | New key | Preserved assertion | Validator evidence |
| --- | --- | --- | --- |
| `skillSynthesis.replayValidation.minConfidence` | `internalQuery.queueTimeoutMs` | An in-range bounded number (`1_500`) is accepted and written. | `libs/shared/src/lib/types/advanced-settings.types.ts:242-250` defines a number bounded from 1,000 to 600,000 ms; `:490-510` validates it. `libs/backend/platform-core/src/file-settings-keys.ts:435` registers the key. |
| `skillSynthesis.judgePanel.disagreementThreshold` | `internalQuery.maxConcurrentPerLane` | A missing value is rejected with its bounded-number error; no write occurs. | `libs/shared/src/lib/types/advanced-settings.types.ts:229-237` defines a number bounded from 1 to 16 queries; `:499-508` formats and returns the asserted error. `libs/backend/platform-core/src/file-settings-keys.ts:434` registers the key. |
| `skillSynthesis.judgeModel` | `skills.enhancement.model` | Clearing a global-only model key succeeds without clearing an override or resetting the SDK. | `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:514-516` and `:530-532` give both keys `appScopable: false` and `supportedTargets: ['global']`. |

## Acceptance

`rg -n "replayValidation|judgePanel|judgeModel" libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/handlers/config-scope-rpc.handlers.spec.ts`: **0 hits**.

## Decisions

- Used retained advanced settings with bounded-number descriptors for the settings RPC fixtures. Their exact ranges differ, so the fixture values and expected error follow the new descriptors.
- Preserved the existing global-only scope behavior with `skills.enhancement.model`, which has the same scope metadata as the removed key.
- Ran only read/search and diff checks; no test, typecheck, lint, build, serve, or e2e command was run.

## Clarifications Needed

none
