# Phase 1 code logic fix report

| Finding | Fix | File:line | Spec that covers it |
| --- | --- | --- | --- |
| S1 stale readiness after wizard | Card refreshes on mount, visibility return and focus; store dedupes simultaneous reads. | `project-setup-card.component.ts:51`, `setup-status.store.ts:60` | `project-setup-card.component.spec.ts:89` host flips before remount; `setup-status.store.spec.ts:96,107` refresh and dedupe |
| S2 catalog tracking | Scope effect reads only `scopeKey`; catalog load and status refresh run in `untracked`. | `setup-status.store.ts:46-56` | `setup-status.store.spec.ts:79` mock `ensureLoaded` reads a signal; catalog change and Retry issue only expected status calls |
| S3 Ready strip action | Added Open Library and retained all setup actions. | `project-setup-card.component.ts:12-18` | `project-setup-card.component.spec.ts:51` |
| S4 Aurora overlap | Single-chat hero isolates and clips the brand effect; brand layer fills only that hero behind content. | `chat-empty-state.component.ts:54`, `aurora-effect.component.ts:45` | `chat-empty-state.component.spec.ts` dark/light structural checks; `aurora-effect.component.spec.ts` CSS contract |
| M1 layout flip | Confirmed same-scope agent readiness remains available while a new read is pending. | `setup-status.store.ts:33-37` | `setup-status.store.spec.ts:91` |
| M2 unknown wording | Badge and rows distinguish active checking, unavailable status, and missing workspace. | `project-setup-card.component.ts:22-26` | `project-setup-card.component.spec.ts:69,104` |
| M3 no-workspace generation | Both generation actions disable without a workspace. | `project-setup-card.component.ts:29` | `project-setup-card.component.spec.ts:69` |
| M4 folder error | Folder-open failure has separate fixed-copy feedback and clears on next folder attempt. | `setup-status.store.ts:102-110`, `project-setup-card.component.ts:32` | `setup-status.store.spec.ts:112` |
| M5 detached popover anchor | Uses a connected external anchor or projected trigger; if neither is connected, shows and focuses the panel with a development diagnostic. | `native-popover.component.ts:220-232` | `native-popover.component.spec.ts:117` |
| M6 Aurora edge and animation | Widened animated layer to cover horizontal travel; blur is on the moving pseudo layer while parent mask stays static. | `aurora-effect.component.ts:47-73` | `aurora-effect.component.spec.ts` CSS contract |
| M7 singular agent count | Uses `agent` for one and `agents` otherwise. Last-updated omission is recorded below. | `project-setup-card.component.ts:26` | `project-setup-card.component.spec.ts:104` |
| Minor: persistent launch error | Successful independent status refresh clears old launch feedback; an in-progress failed launch retains its feedback. | `setup-status.store.ts:78,118-124` | `setup-status.store.spec.ts` failed-launch then refresh regression |
| Minor: missing spinner | Wizard actions show a small spinner while launching. | `project-setup-card.component.ts:15,26-27` | `project-setup-card.component.spec.ts:104` |
| Minor: stale/no-workspace spec gaps | Added no-workspace, stale failure, pending state, dedupe and remount specs. | `setup-status.store.spec.ts:107-151`, `project-setup-card.component.spec.ts:89` | Same specs |
| Minor: Aurora render hook | Review explicitly said no action needed. | `aurora-effect.component.ts:94` | Existing lifecycle spec |
| Degradation audit | Added the exact requested first-line catch suppression; no error detail is logged. | `setup-status.store.ts:89` | `setup-status.store.spec.ts` safe failure and stale failure specs |

## Proposed Removals

| Capability | Evidence | Recommendation |
| --- | --- | --- |
| Last-updated relative time on the setup card | The old widget showed relative time, but `design-spec.md` section 4 defines the new row as configured/update/loading/no-workspace/failure, and `prototype/start-screen.html` renders Skills, Agents and Project scan without any last-updated text. | Keep the approved design's omission. Ask the user to approve this removal; do not edit `decisions.md` in this lane. |

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep last-updated out of the new card pending approval | Approved design and prototype omit it; old widget had it. See Proposed Removals. | Yes |
| Keep the brand Aurora in the single-chat hero | `decisions.md` #15 explicitly approves it; clip and layer it inside the hero. | Yes |
| Expose an unpositioned, focused popover if all anchors disappear | M5 asks for a visible fallback; the existing positioning failure path already uses this behavior. | Yes |

## Verification and remaining work

- No Nx, Jest, TypeScript CLI, build, serve, or browser run was performed, per the single-check-slot instruction. Three scoped `ptah_get_diagnostics` attempts timed out with their files unchecked. The orchestrator must run the project checks.
- Dark/light contrast and Aurora CPU/GPU sampling need a browser with the effect visible. The specs verify containment and CSS geometry, not measured contrast or frame cost.

## Spec failure follow-up

| Failure | Cause | Fix |
| --- | --- | --- |
| Previous workspace response accepted | Spec: the constructor's initial request was still in flight, so `refresh()` returned its deduped promise and the one-shot mock was consumed by the new workspace request. | Await the initial request before installing the old-workspace deferred response; the stale-workspace assertion remains. `setup-status.store.spec.ts:49` |
| Safe failure had a null error | Spec: `refresh()` reused the successful initial request, so the later failure mock was never read. | Await the initial request before changing the RPC mock. `setup-status.store.spec.ts:61` |
| Retry made one rather than two total calls | Spec: one microtask did not settle the constructor request; Retry joined that in-flight request. | Await the initial request before counting calls, then verify catalog changes add none and Retry adds exactly one. The `ensureLoaded` mock still reads `loaded()` synchronously, so S2's tracking regression remains covered. `setup-status.store.spec.ts:83-88` |

No store change was needed; in-flight deduplication and the scope/id stale guard match S1, S2, M1 and M2. The requested focused Jest run passed: `Tests:       11 passed, 11 total`.
