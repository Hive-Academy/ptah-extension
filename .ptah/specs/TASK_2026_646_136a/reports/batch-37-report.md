# Batch 37 (P3f) report

Lib: `libs/backend/lane-routing`. Branch `feat/decision-model-routing`. No git writes. Jest/Nx not run (decision #53). `libs/backend/rpc-handlers` not touched.

## FE-12a

Moved the probe and discriminator helpers out of `decision-model.config.ts` into `decision-model.probe.ts` (229 lines). The config imports `buildProbeUrls`, `checkVersion`, `discriminate`, `toRowState`, `isLocalUrl`, `normaliseBaseUrl`, `keyOf`, `errorMessage`, and `ProbeAnswer`. Discriminator behaviour is unchanged.

`decision-model.config.ts` is 634 physical lines (was 803).

## S-1

`system-one.client.ts:160-170` no longer builds `detail` from the provider body. Auth and provider-error details are `http <status>`. `notFound` is still HTTP 404 or 405. The body is still read and is not copied into the result or any log line.

Specs:

- `system-one.client.spec.ts:180` plain-text 404 detail is `http 404`.
- `system-one.client.spec.ts:197` a JSON `error` field is not the detail.
- `system-one.client.spec.ts:213` a body that echoes `SECRET-PROMPT` is absent from `detail` and from debug, info, warn, and error. That `detail` is the string the unsupported mark persists and logs.

## S-3

`decision-model.config.ts:255-259` (`getStatus`) and `:344-349` (`recheckAfterLiveNotFound`) capture `keyOf(selection, normalisedBaseUrl)` before the await. `applyProbe` at `:422-424` drops the result when `currentProbeKey()` differs and does not mark or persist. `markUnsupported` at `:284-292` takes the selection snapshot and returns before any write when that key is no longer current.

Specs: `decision-model.config.spec.ts:737` (probe A then selection B) and `:759` (live-404 recheck). Neither calls `storage.update`, and `isMarkedUnsupported()` is false.

## M-3

`decision-model.config.ts:551-561` `loadMark` catches `storage.get`, logs `{ name }` only, and returns null. The catch uses the same `degradation-audit: reported` marker as `rotation.store.ts`.

Spec: `decision-model.config.spec.ts:777`. The config constructs, the mark is null, one warn, and `SECRET-PROMPT` is not in the warn payload.

## S-2

`model-call.ts:107-136` races `completer.complete` (abort signal still passed) against `DECISION_REQUEST_TIMEOUT_MS + DECISION_RETURN_MARGIN_MS` (`:252-253`, helper `:259-298`). Deadline wins → existing `timeout` outcome (`requestCause: 'timeout'`). A late rejection is logged with `structuredFacts` (name and kind only). `clearTimeout` runs in `finally`.

`decision-model-failure-classifier.ts:171-186` does the same. Deadline wins → `null`. The budget is `timeoutMs()`, which defaults to that sum (`FAILURE_CLASSIFICATION_TIMEOUT_MS`), so a seam override stays aligned with the abort signal. Helper `:416-454`.

Specs: `model-call.spec.ts:39` (fake timers advance past the budget, `timeout`, `clearTimeout` called). `decision-model-failure-classifier.spec.ts:427` (classifier resolves null, timer cleared).

## M-1

`rotation.store.ts:204-231` `save` re-reads under `writeChain` (`enqueue` at `:213-220`) and `withPick`s only the keys present in the document it is given. Other stored keys stay. A throwing re-read does not write. `record` (`:189-197`) uses the same lock. The `save` signature is unchanged, so `RouteRotation` in `gather.ts` was not edited.

`route-decide.service.ts:372-381` now saves only this call's picks. A stale full snapshot can no longer overwrite keys this call did not touch.

Specs: `rotation.store.spec.ts:292` (two concurrent saves, different keys, both persist) and `:315` (same key, later pick wins, the other key stays `kept`).

## Style Serious 1

`src/index.ts` is 72 physical lines (was 190). Lane-routing specs do not import the barrel (search for `from '@ptah-extension/lane-routing'` under the lib: no matches; no relative `index` imports either). No spec import was rewritten.

Consumer search: `rg -n "from '@ptah-extension/lane-routing'" apps libs -g "*.ts" -g "!libs/backend/lane-routing/**"` — 18 hits. Names actually imported outside the lib:

- `LANE_ROUTING_TOKENS`
- `registerLaneRoutingServices`
- `StructuredDecisionCompleter`, `StructuredDecisionRequest`
- `RouteCandidateSource`, `RouteDecideService`, `RouteDecideArgs`, `RouteDecideResult`, `RouteDecideArgsSchema`
- `DecisionModelConfig`, `DecisionModelSelection`, `DecisionModelStatusDto`

Call sites: `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`, `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/container.smoke.spec.ts`, `apps/ptah-cli/src/di/container.smoke.spec.ts`, `libs/backend/cli-engine/src/lib/container.ts`, `libs/backend/agent-sdk/src/lib/di/register.ts`, `libs/backend/agent-sdk/src/lib/lane-routing/structured-decision.adapter.ts` and its spec, `libs/backend/vscode-lm-tools` route namespace, route tools, and route tool handlers (plus specs), `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`, `agent-rpc.handlers.ts`, `agent-rpc.handlers.decision-model.spec.ts`.

Kept in `src/index.ts`: those names, plus the logger port (`LaneRoutingLogger`, `LaneRoutingLogMeta`), `SystemOneTarget`, the decision-model settings/status DTO block, `RouteDecideDependencies`, the route args/result schema blocks (including their enum constants and result types), and the lane-model listing port (`LaneModelEntry`, `LaneModelListing`).

Removed:

- routing constants and their types (`CLOSENESS_BAND` through `TieBreakStep`, including `DECISION_REQUEST_TIMEOUT_MS` and the rotation key constants)
- matrix types, `CapabilityMatrixStore`, matrix diagnostic strings, `deriveLocalMatrix`, `AUTOMATIC_MATRIX_MODEL`, `CAPABILITY_MATRIX_VERSION`, `FAMILY_PROFILE_MODEL`, `MATRIX_CELL_SOURCES`, and the matrix cell types
- `score`, `spread`, and their input/result types
- `RotationStore`, `emptyRotationState`, `lastCandidateId`, `rotationKey`, `withPick`, rotation document types and constants
- `DecisionModelFailureClassifier`, `FAILURE_CLASS_QUESTION_KEY`, `FAILURE_CLASSIFICATION_TIMEOUT_MS`, `acceptedFailureClass`, `buildFailureClassificationPayload`, `failureClassificationSchema`, and the classifier payload/seam types
- test seams `DecisionModelConfigSeams` and `RouteDecideSeams` (the types remain on the classes; specs import them by relative path)

## Line counts (physical)

| File | Lines |
| --- | --- |
| `src/index.ts` | 72 |
| `decision-model.probe.ts` | 229 |
| `decision-model.config.ts` | 634 |
| `system-one.client.ts` | 244 |
| `model-call.ts` | 334 |
| `decision-model-failure-classifier.ts` | 466 |
| `rotation.store.ts` | 277 |
| `route-decide.service.ts` | 437 |

All under 700. Config shrank.

## Checks

- eslint on the changed files: exit 0, no findings.
- prettier `--check` on the same files: `All matched files use Prettier code style!` (exit 0).
- `tsc -p libs/backend/lane-routing/tsconfig.lib.json --noEmit`: exit 0, no `error TS` lines. Specs are excluded by that tsconfig.
- degradation audit: `TOTAL 296`, no `FAIL` line, exit 0. Baseline not raised. The new `loadMark` catch is suppressed.
- di-lint last line: `di-lint OK: 1846 @inject sites all resolve to a registered token (815 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`. Exit 0.

## Decisions

1. **Probe file exports the helpers the class calls, including `ProbeAnswer`.** Options: leave the type in the config, or move it with the discriminators. Evidence: `send` returns it and `checkVersion` / `discriminate` take it. Reversible: yes, it is a file split only.

2. **Provider-error and auth details are `http <status>`.** Options: status only, or status plus a fixed cause word. Evidence: S-1 says fixed text from the cause and the HTTP status, and the cause is already a separate field on the failure and in the log. `notFound` stays on the status code. Transport messages and schema messages are not provider bodies and were left as they were. Reversible: yes.

3. **A stale probe re-enters `getStatus` for the current selection.** Options: return a placeholder row, or probe the current selection. Evidence: `getStatus` is the status of the selection now; the stale result is not applied and is not persisted. The new probe is bound to the new key. Reversible: yes.

4. **`save` still takes one document. Keys in that document are the keys this call touched.** Options: add `touchedKeys` (and edit `RouteRotation` in `gather.ts`), or treat the document as the touch set. Evidence: the batch allows a `route-decide` edit only if the save call must change, and `gather.ts` is outside the batch file list. `route-decide.service.ts:372-381` now passes only this call's picks, so a stale full snapshot cannot clobber other keys. Concurrent saves of different one-key documents both persist. Reversible: yes.

5. **Classifier deadline uses `timeoutMs()`.** Options: always the constant sum, or the same budget as the abort signal. Evidence: `FAILURE_CLASSIFICATION_TIMEOUT_MS` is that sum, and the seam exists so tests and hosts can shorten both together. Reversible: yes.

6. **Barrel drops `DecisionModelConfigSeams` and `RouteDecideSeams`.** Options: keep every name in the old lines 49-78 and 139-168, or drop test seams. Evidence: Serious 1 says remove test seams; no file outside the lib imports those two types. Reversible: yes.

## Not done

Jest and Nx were not run, by the batch hard rule. The orchestrator runs those tests.

`ptah_*` tools are not on this client, so symbol search and diagnostics used the compiler, eslint, and ripgrep instead.
