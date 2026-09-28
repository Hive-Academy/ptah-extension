# Code Logic Review — TASK_2026_494, Batch 15, round 2 (final)

## Summary

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED |
| New blocking / serious / moderate issues | 0 / 0 / 0 |
| Unresolved in-scope correctness findings | 0 |

The fixes close the four round-1 correctness findings and add the missing in-flight keystroke regression pin. The score reflects sound, tested behavior; the accepted liveness-observation limit and pre-binding reset follow-up prevent an exemplary end-to-end rating. Neither is a new finding or a revision gate under the coordinator's rulings.

Paths below use **A** = `libs/frontend/mcp-apps-page/src/lib` and **D** = `libs/frontend/declarative-dashboard/src/lib`. Line references are one-based.

## Scope and verification

Read the two round-1 reviews, fix report, Batch 15 requirements/rulings and revised switcher contract in `implementation-plan.md:666`. Inspected current component, session, reducer, submit and extraction implementations, their relevant test coverage, and read-only diffs. Source and specs were not modified.

Executed:

- Apps Jest project: **15 suites, 259 tests passed** (`npx jest -c libs/frontend/mcp-apps-page/jest.config.ts --runInBand`).
- Declarative-dashboard trust boundary: **1 suite, 22 tests passed** (`npx jest -c libs/frontend/declarative-dashboard/jest.config.ts --runInBand trust-boundary.spec.ts`).
- Required Apps spec typecheck: exit 2, **exactly eight baseline TS2352 errors**, at `libs/frontend/core/src/testing/mock-rpc-service.ts:54,60,66,69` and `libs/frontend/git-ui/src/lib/services/monaco-loader.service.ts:113,151,171,187`. No Apps spec errors.
- Scoped `ptah_get_diagnostics` independently returned the same eight errors (its displayed locations are zero-based). No workspace-wide verification was run.

## Confirm table

| # | Ruling | Evidence and impact |
| --- | --- | --- |
| 1 | RESOLVED — B1 | `A/services/apps-session.service.ts:375` captures workspace key, conversation and session before awaiting abort. Failure at `:382` patches only that owned conversation with a notice and returns without discarding. Success rechecks captured routing ownership at `:394` before `discardSlice(key)`. The page only delegates at `A/components/apps-page.component.ts:275`. Tests at `A/components/apps-page-conversation.spec.ts:322`, `:358`, `:396` and `:419` cover workspace switching, abort failure with retained claims/bubbles, replacement conversation and idle reset. |
| 2 | RESOLVED — S1 | `A/services/apps-submit-flow.ts:474` stamps immediately before sending; settlement forwards that stamp at `:591`, and `A/services/apps-surface-operations.service.ts:406` stores it. `A/components/apps-transcript-order.ts:25` orders chronologically, puts users before nodes on equal timestamps and preserves same-kind ties. Missing node timestamps sort last at `A/components/apps-transcript.component.ts:162`. Delayed acknowledgement after the response is pinned at `A/components/apps-page-conversation.spec.ts:511`; assertions at `:567`–`:568` verify order and a single submitted bubble. Comparator cases are pinned at `A/components/apps-transcript-order.spec.ts:25`. |
| 3 | RESOLVED — S2, under revised contract | Manual selection is slice state (`A/state/apps-surface-reducer.ts:61`), set even when clicking the already-active surface at `:496`. Snapshot activation at `:228` requires a new agent surface and no manual pick. Delete/eviction and read reconciliation clear a vanished pick at `:329` and `:464`. Reducer specs at `A/state/apps-surface-reducer.spec.ts:267` cover pinning, updates/new surfaces, removal/eviction, no-pick activation and reads. Panel specs at `A/components/apps-surface-panel.component.spec.ts:195`, `:223`, `:249`, `:267`, `:293` cover selection and actual focus preservation. The revised plan at `implementation-plan.md:666` agrees. |
| 4 | RESOLVED — invalid lastSubmit date | `A/components/apps-surface-panel.component.ts:68` validates status, finite/nonnegative time and a valid Date at `:77` before rendering. Boundary/value tests at `A/components/apps-surface-panel.component.spec.ts:479` and DOM test at `:508` establish that invalid time is omitted and no NaN appears. |
| 5 | RESOLVED — M1; M2 resolved within accepted limit; own type errors gone | Failed content is remembered per surface in `A/components/apps-surface-panel.component.ts:287`, checked by content identity at `:322` and recorded/pruned at `:396`. Switching between two failures does not retry either; new content can retry (`A/components/apps-surface-panel.component.spec.ts:411`). Pending turn state and baseline liveness live in `A/services/apps-workspace-slice.ts:47`, `:61`; `A/services/apps-session.service.ts:172` treats pending as processing even after binding, `:206` clears it on observed liveness change, and successful Stop clears it at `:362`. Tests: `A/services/apps-session.service.spec.ts:782`, `A/components/apps-page-conversation.spec.ts:571`. Required tsc and scoped diagnostics show only the eight external baseline errors. |
| 6 | CONFIRMED — extractions preserve existing behavior, apart from explicit fixes | `A/services/apps-conversation-claims.ts:44` preserves inbox-first claim ordering, interactive registration and rollback; `:66` preserves ordered, independently guarded releases. Session callback ownership remains at `A/services/apps-session.service.ts:531`. `A/services/apps-session-rpc.ts:25` preserves abort arguments, failure-result checks and transport-error conversion; callers still decide whether to retain/reset their slice. The comparator extraction at `A/components/apps-transcript-order.ts:25` is pure; send-time ordering and missing-time handling are the intentional fixes. No accidental lifecycle or RPC change was found. |
| 7 | CONFIRMED — no regression found | Synchronous view-state path remains panel `A/components/apps-surface-panel.component.ts:236`, `:372` → session `A/services/apps-session.service.ts:443` → reducer `A/state/apps-surface-reducer.ts:478`. It stores the identical emitted object without await; the reducer changes neither revision nor overlays. Identity is pinned at `A/components/apps-page.component.spec.ts:550`. The new in-flight lane/waiting-submit test at `A/components/apps-page-conversation.spec.ts:458` exercises five real keystrokes: zero new RPCs, unchanged revision/overlay identity and only the five input debounce timers. The interaction binding remains a computed at panel `:235`, `:335`. The source trust scan at `D/trust-boundary.spec.ts:329` passes. Markdown details below. |
| 8 | RESOLVED — all remaining round-1 items | The four numbered correctness findings are covered by rows 1–4. The additional requested keystroke stress pin is now present (row 7). SDK user-echo omission remains owned and tested by chat-streaming (`libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:340`, its spec `:304`), as accepted; an additional Apps integration test is not required. Existing prompt filtering, recreate/focus restoration, renderer-failure fallback and zero-transport presentation tests remain passing at `A/components/apps-page.component.spec.ts:431`, `:579`, `:507`, `:634`. No round-1 correctness finding remains partially or not resolved. |

## Regression details and data flow

1. **View state — OK:** renderer output synchronously updates the active slice with the exact object. Reads preserve current view state (`A/state/apps-surface-reducer.ts:375`); an agent content replacement intentionally resets it (`:221`).
2. **Reconciliation — OK:** the existing operations effect (`A/services/apps-surface-operations.service.ts:124`) rechecks existing work; it does not create change/select/action work from presentation state. In-flight/empty queue and revision guards remain at `A/services/apps-surface-lanes.ts:354`, `:377`; wait timers are retained at `:402`. Submit advancement retains its phase/timer guards (`A/services/apps-submit-flow.ts:384`). Reconciliation still scans held records and lanes; it is not constant-time, but no extra transport, timer storm, overlay fight or feedback loop was found or observed in the new stress test.
3. **Submission — OK:** send-time stamp travels through result settlement into the merged transcript. Active-operation ownership prevents a later result/poll from appending a second bubble (`A/services/apps-submit-flow.ts:488`, `:552`, `:634`).
4. **Trust boundary — OK:** assistant text is rendered by **ExecutionNodeComponent**, whose text branch uses ngx-markdown's **MarkdownComponent** (`<markdown>`) with **SurfaceMarkdownPipe from @ptah-extension/markdown** (`libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:136`; recursive message children at `:234`). The existing provider uses the shared sanitizer (`libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:490`). Agent-supplied surface fields and user/submitted strings render literally; no new innerHTML, bypassSecurityTrust or DomSanitizer sink exists in Apps source.
5. **Failure fallback — OK:** failed identities now persist across surface switches, while the existing fallback branch excludes the renderer and retains transcript/composer (`A/components/apps-surface-panel.component.ts:211`; page spec `:507`). Host rejections still enter interaction issues through the operations facade (`A/services/apps-surface-operations.service.ts:160`, `:417`).

## Five logic questions

1. **How does this fail silently?** No new silent-success path was found. Failed reset abort now preserves the target slice and displays a status notice (`A/services/apps-session.service.ts:382`; page `:152`). The accepted pre-binding abort gap remains a separate follow-up.
2. **What user action produces unexpected behavior?** Switching workspace during reset, replacing the conversation during its await, and selecting a surface before another agent update now retain the intended ownership/selection (conversation spec `:322`, `:396`; reducer `:228`). The accepted unobserved liveness cycle can still require Stop.
3. **What input produces a wrong answer?** Previously problematic out-of-range finite dates are rejected (panel `:77`); response-before-ack ordering and absent timestamps are handled (submit flow `:474`; comparator `:25`; transcript `:162`). No new counterexample was found in the reviewed paths.
4. **What happens when a dependency fails?** Abort failure returns a reason without clearing the conversation (`apps-session-rpc.ts:25`; session `:382`). Partial claim failures roll back and rethrow; individual release failures do not prevent remaining cleanup (`apps-conversation-claims.ts:59`, `:76`). Renderer failures remain visible as the mono fallback (panel `:322`).
5. **What remains outside the requirements?** Full desktop/browser end-to-end timing and visual behavior were not exercised here. The coordinator expressly accepts the unobserved idle→streaming→idle cycle and records New conversation between start completion and binding as follow-up work; this review does not reclassify them as new defects.

## New findings and exact fix list

**No new correctness findings. No additional code fixes required for this final review.**

Residual limits: the liveness effect can only react to statuses it observes (`A/services/apps-session.service.ts:206`); reset cannot abort an as-yet unbound session through its resolved-session path (`:378`). Both limits are explicitly accepted for this batch. Real SDK user-echo suppression was traced and relies on its existing chat-streaming test, rather than a newly added Apps integration test.

## Verdict

**APPROVED — 8/10; high confidence in the reviewed component/service contracts, with the coordinator's recorded limits retained.**

One-line summary: All round-1 correctness findings are resolved under the revised rulings; 281 tests pass and the spec typecheck contains exactly the eight accepted baseline errors.

