# P4 correction review

Verdict: **APPROVED**  
Score: **9/10**  
Review family: reviewer **codex**, implementer **Claude**

Scope: the uncommitted diff against HEAD in `provider-accounts-state.service.ts` and its spec, limited to items 1–2 under "New defects / remaining gaps" in `code-logic-review-p4-rereview.md` and preservation of original P4 finding 2. Read both fix reports and the original review.

## Items 1–2

Paths are relative to the repository root.

| Item | Status | File:line evidence |
| --- | --- | --- |
| 1. Refused overlap invalidates an earlier successful pending reply | **Closed** | `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:655` allocates a sequence without advancing acceptance or invalidation. Refusals exit at `:614` before the acceptance gate at `:633`; busy/conflict and other non-timeout refusals share that branch. `libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts:486` covers sign-in/sign-out contenders, busy/conflict, both response orders, preserved script/handle, and Cancel ownership. |
| 2. Status replies restore stale operations or delete newer ones | **Closed** | `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:338` captures a ticket before RPC; `:350` guards both insertion/deletion at `:359` and fallback deletion at `:366`. Ticket creation at `:655` creates a clock even without any prior local write. Generation and invalidation checks at `:683`, plus the accepted-sequence check at `:693`, reject superseded state. `libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts:564`, `:593`, `:604`, and `:623` cover reset/terminal invalidation, deletion after newer sign-in, and newer accepted status results. |

Terminal/removal snapshots advance invalidation for every tracked profile absent from the pending set (`provider-accounts-state.service.ts:508`, `:513`) and clear handles/scripts (`:516`, `:523`). Workspace reset clears clocks and response-only state (`:441`); the generation captured at `:663` rejects old tickets even if a clock is recreated. None of these checks can be bypassed by the same-operation exception.

An accepted newer operation wins in either response order: acceptance advances monotonically with `Math.max` (`:694`), and an older different operation fails the gate (`:690`). Refusal never rolls the clock back. The successful-overlap tests at spec `:406` and `:433` exercise the older reply arriving last, including equal snapshot revisions; the opposite order follows the increasing sequence check.

Original finding 2 remains closed for the requested interleavings. The write path checks the currently held pending snapshot (`provider-accounts-state.service.ts:632`, `:702`) independently of whether `apply()` accepted the response snapshot, preserving push-first delivery (spec `:357`). Terminal and reset tests (`:370`, `:449`) prevent restoration of old scripts/operations. A newer status reply naming the same operation may precede its sign-in reply: the identity exception (`service :690`) permits that reply's sole script without reducing the accepted watermark (spec `:532`). Older status replies naming the already-held operation are harmless identical handle writes; different-operation insertion and no-operation deletion remain blocked after newer acceptance.

## New defects

None identified within this bounded correction. No fallback logging or module-namespace `jest.spyOn` was added.

## Validation

Ran once:

`npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/provider-accounts-state.service.spec.ts --maxWorkers=2`

Result: **1 suite passed, 36/36 tests passed**, exit 0. Jest emitted a configuration ES-module loading warning and completed successfully. Source and spec files were not edited; no git state-changing commands were run.

## Not checked

- Other P4 findings, backend corrections, or unrelated task requirements.
- Live Electron/Claude behavior, transport timing, builds, installs, full suites, e2e, lint, typecheck, or `npm run verify`.
- No new executable tests were added. Status removal, non-busy/conflict refusals, and the older-success-first successful-overlap ordering were assessed through their shared code paths rather than additional dedicated tests.
- The second fix report's inherited broad invalidation on unrelated non-pending snapshots was not reopened; this review is limited to the two specified corrections and the original stale-restoration rules.
