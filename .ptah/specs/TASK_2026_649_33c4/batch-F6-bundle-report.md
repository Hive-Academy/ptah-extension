# Batch F6: webview initial bundle reduction

The eager `HarnessWorkflowMessageHandler` registration remains in `app.config.ts`. Its value imports now stop at the handler, Angular/core, shared constants, and a small pure utility. A workflow message loads `HarnessWorkflowRequestService`; a proposal message loads `HarnessProposalHydrationService`. The handler serializes messages while imports resolve, retaining arrival order and logging dispatch failures.

## Changes

| File:line | Change |
| --- | --- |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts:8,25-75` | Replaced static service imports and eager DI with type-only imports, dynamic imports, `Injector.get`, instance caching, and a serialized message queue. The handler itself remains eager. |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-utils.ts:1-56` | Holds root normalization, registry-derived platform options, and intake validation without Angular, Zod, records, request, or hydration imports. |
| `libs/frontend/harness-builder/src/lib/services/harness-builder-records.service.ts:9-11` | Imports and re-exports `canonicalHarnessRoot` so existing callers retain the same API. Its module-level Zod schemas no longer enter through the handler. |
| `libs/frontend/harness-builder/src/lib/services/new-project-intake.ts:1-9` | Imports and re-exports platform options so existing callers retain the same API. |
| `libs/frontend/harness-builder/src/services.ts:5-11` | Clarifies that the barrel's re-exports need tree shaking; exports stay intact for existing imports. |
| `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.spec.ts:39-128` | Awaits lazy dispatch for workflow, invalid workflow, navigation failure, and proposal cases; adds arrival-order coverage. |

## Eager graph impact

- `HarnessWorkflowRequestService` and its imports (`ChatStore`, `TabManagerService`, RxJS operators, records, RPC, intake formatting) move behind the workflow message import.
- `HarnessProposalHydrationService` and its `HarnessProposalSchema` import move behind the proposal message import.
- `HarnessBuilderRecordsService` and its module-level Zod schemas plus `HarnessConfigUpdatesSchema` no longer enter through root normalization. Root normalization uses the pure utility directly.
- `new-project-intake.ts` is no longer imported by the handler. The platform list and intake validator use the existing shared stack registry in the utility. The shared registry remains eager because validation needs it.
- Search of `apps/` and `libs/frontend/` found the webview `app.config.ts` and a message-routing spec as consumers of the services barrel. The latter also imports request and hydration services for tests. `services.ts` still re-exports those services; production tree shaking must omit unused re-exports for the bundle saving to materialize.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the handler eager and split its dependencies by message type | Eager services; lazy one or both services | `app.config.ts` registers the handler before the builder opens; early `harness:open-workflow` messages must be received. The two message types use separate services. | Yes; restore static imports if production bundling shows no benefit. |
| Put shared pure helpers in a local utility and re-export old symbols | Import records/intake modules; duplicate logic; move and re-export | The records module constructs Zod schemas at module load. Re-exports keep existing callers working and avoid duplicated root or platform rules. | Yes; callers can migrate gradually if desired. |
| Serialize handler dispatch while an import is pending | Let imports race; queue messages | The router calls handlers without awaiting them, so an independently resolved later import could overtake an earlier message. | Yes; remove the queue if the router gains awaited dispatch. |
| Preserve the services barrel exports | Remove exports; keep them tree-shakeable | `unit5-message-routing.spec.ts` imports request and hydration services through the barrel. Changing the barrel API would break those callers. | Yes; a dedicated handler-only entry point could be added later if tree shaking is insufficient. |

## Estimate and risks

Expected initial-bundle saving is **more than 15 kB**, plausibly tens of kB, because the request and hydration services and their transitive modules leave the handler's static import graph. This is an inference from imports, not a measured bundle result. The orchestrator/CI must measure whether it clears the 3.70 MB budget with margin. Barrel tree shaking and modules shared with other eager imports can reduce the actual saving.

No checks, build, lint, typecheck, or tests were run, as required for this edit-only batch. The next scoped check should cover the handler spec, and CI should compare the production initial bundle. The first relevant message now waits for a lazy chunk; navigation and error reporting otherwise follow the prior handler flow. A chunk load failure is logged through `LoggingService`, but cannot report a Hub error before the request service loads.

## Follow-up: unit5 spec

In `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts:116-123`, added `flushHarnessHandler()` to let the router drain and then await the handler's pending lazy work through its no-op return path. The existing `HarnessWorkflowRequestService` provider override remains in place, so `Injector.get` still resolves the test mock. At lines 274-292 and 311-329, the three harness-related routing tests now await this helper before every assertion, including the negative `requestAndNavigate` assertion for a malformed relay. All previous assertions remain. No checks were run under the edit-only instruction.
