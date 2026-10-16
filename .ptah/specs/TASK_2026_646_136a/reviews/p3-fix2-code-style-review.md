# P3 final code style re-review — TASK_2026_646_136a

Scope: committed Batch 37b (`623644993`) under `libs/backend/lane-routing` only. This is a structure and API review; LT-P3-2 and LT-P3-3 remain outside scope. I inspected the changed source, the prior review, the Batch 37b report, committed external imports, and the sibling queue in `rotation.store.ts:189-231`. The supplied checks passed: lane-routing 18 suites / 388 tests, lint and typecheck, plus agent-sdk and rpc-handlers typecheck. Scoped `ptah_get_diagnostics` found zero errors or warnings. I did not run Nx, Jest, or a build.

## Summary

| Metric | Result |
| --- | --- |
| Score | **8/10** |
| Verdict | **APPROVED** |
| Blocking / Serious / Moderate / Minor | **0 / 0 / 0 / 0** |

The previous serious public API finding is closed. The new state coordination is legible and local to `DecisionModelConfig` (`decision-model.config.ts:103,305-336,621-677`). The 712 physical lines remain a maintenance watch point, but the repository's `max-lines` rule counts 578 lines here and lint passed; there is no concrete split required by this correction. The explicit queue and second status path keep this below the exemplary 9–10 band; no unresolved structural gap warrants 7 or lower.

## Findings status

| Area | Status | Evidence and impact |
| --- | --- | --- |
| Serious 1 rest — public barrel | **CLOSED** | `src/index.ts:10-59` now exports tokens, registration, ports, route contracts, service, and decision-model settings/status types. The probe constants and result types, unsupported-mark key/schema/type, and control path are absent from the barrel (`src/index.ts:19-26`). A committed-tree search of every import from `@ptah-extension/lane-routing` outside this library found all imported names still exported, including the multiline imports in `structured-decision.adapter.ts:22-25`, `agent-rpc.handlers.ts:51-54`, `route-namespace.builder.ts:14-20`, and `route-tool-handlers.ts:12-15`. The remaining unconsumed exports are host-facing types or contracts, rather than persistence and probe internals. |
| Mark-write chain | **ACCEPTED** | `decision-model.config.ts:103,305-336,621-643,671-677` keeps storage ordering inside the config that owns the mark, with the same `then(work, work)` queue shape as `rotation.store.ts:215-222`. No extra layer or public API was introduced. |
| Bounded status retry | **ACCEPTED** | `decision-model.config.ts:247-281,443-490,649-669` makes the one retry explicit and keeps the no-probe fallback private. The boolean is local to two call paths and names the policy it carries. |
| Transport detail helper | **ACCEPTED** | `system-one.client.ts:193-198,207-238` keeps classification next to the client request and routes the fixed detail through the existing `failure` and `logged` methods. |

## New issues

None in the changed source. The remaining uncertainty is future growth of `DecisionModelConfig`; its current 578 counted lines pass the repository limit, and the new queue has one owner (`decision-model.config.ts:89-103,621-677`).

## Five style questions

| Question | Answer |
| --- | --- |
| What breaks when requirements change in six months? | Mark storage or probe changes remain internal after the barrel trim (`src/index.ts:19-26`); status coordination remains concentrated in `decision-model.config.ts:247-281,443-490,621-677`. |
| What might a new team member misread? | `currentRowWithoutProbe` could be mistaken for an independent status source; its comment and private call sites identify it as the bounded retry fallback (`decision-model.config.ts:649-669,451-455`). |
| What does the shape cost to maintain? | The queue, retry flag, and fallback add paths to a large class (`decision-model.config.ts:103,256-281,621-677`), but each serves a present requirement and remains private. |
| Where does it differ from sibling code? | It does not differ in queue structure: `enqueueMark` uses the established `RotationStore.enqueue` shape (`decision-model.config.ts:621-628`; `rotation.store.ts:215-222`). |
| What would I do differently, and why? | No change in this correction. Extracting a queue utility for these two owners would add a shared abstraction without a third use; the local methods make ownership clearer (`decision-model.config.ts:621-628`; `rotation.store.ts:215-222`). |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Close Serious 1 | Keep partial for unused host contracts / close after removing probe and storage internals | `src/index.ts:10-59`; committed external import blocks cited above; prior review identified the removed internal names at old `index.ts:20-29,32-33,38` | Yes |
| Keep the queue in `DecisionModelConfig` | Shared queue helper / owner-local method | `decision-model.config.ts:621-628`; sibling `rotation.store.ts:215-222`; only two uses | Yes |
| Accept the current class size | Split immediately / retain cohesive status and mark ownership | `decision-model.config.ts:89-103,247-281,621-677`; 578 counted lines and passing lint in the Batch 37b report | Yes |
