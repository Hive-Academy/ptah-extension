# Frontend fix commit re-review — TASK_2026_626_7b3e

## Verdict: NEEDS_FIXES

**Score: 7/10.** The prior runtime routing defect and requested style issues are resolved in the single commit. The added test has two new type errors, so this remains in the sound (7–8) band rather than exemplary (9–10); there is no evidence of a new runtime defect that would place it in the 5–6 band. Scope: committed `820e89eda..b44707139` frontend changes only. No Jest, Nx, build, or source edits.

## Prior findings

| Finding | Resolution and evidence |
| --- | --- |
| Logic #1: first background tab only | **Resolved.** `findBackgroundTabsBySessionId` gathers all matching background IDs (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:617-620`; `tab-workspace-partition.service.ts:352-361`). The aggregator unions them with active tabs and deduplicates by ID (`libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:255-264`). Both live and authoritative paths use that list (`:129-157`, `:223-238`). Multi-workspace estimate and settle cases are covered in `session-stats-aggregator.service.spec.ts:1478-1565`. Impact: each bound tab can receive the update, including when an active tab exists. |
| Style #1: tab-manager growth | **Resolved.** Context fill derivation moved into the pure `libs/frontend/chat-state/src/lib/live-context-stats.ts:1-71`, and the old private helper was removed from `tab-manager.service.ts` near `:2167`. Impact: the new calculation is outside the already large service. |
| Style #2: duplicate install path | **Resolved.** The single `installSessionStats` accepts optional context (`tab-manager.service.ts:2236-2255`); the live handler calls it (`session-stats-aggregator.service.ts:229-237`). Impact: one admission and budget patch path remains. |
| Style #4: inline context shape | **Resolved.** The parameter and pure helper use shared `SessionStatsLiveContext` (`tab-manager.service.ts:31,2240`; `live-context-stats.ts:3,62`). Impact: wire-shape changes are checked through the shared type. |
| Style #7: sr-only spacing | **Resolved.** All five estimate markers include `estimated `, for example `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.html:69,95,314,348,360`; the spec checks the trailing space (`session-stats-summary.component.spec.ts:493`). Impact: the spoken label is separated from the value. |

## Required behavior checks

- **Per-tab admission:** each target is passed to `installSessionStats` separately (`session-stats-aggregator.service.ts:229-238`). Admission checks the target tab and the session revision floor (`tab-manager.service.ts:2342-2365`); `SessionStatsRevisionFloor.admit` rejects revisions below its floor while allowing equal revisions to fan out (`session-stats-snapshot.ts:75-89`). The tests exercise two tabs in one background workspace, another background workspace, a mixed active/background case, a stale revision, and an authoritative settle (`session-stats-aggregator.service.spec.ts:1478-1565`). Impact: a lower revision cannot replace an installed snapshot in any tab.
- **Context gate:** context is calculated only after admission and only for `snapshot.provisional === true`; the optional spread writes a live reading only when the model and token checks return one (`tab-manager.service.ts:2242-2254`; `live-context-stats.ts:59-70`). Impact: authoritative snapshots never acquire the provisional context fill.
- **Old call compatibility:** three-argument callers still pass `(tabId, snapshot, budget)` to the same admission and update logic (`tab-manager.service.ts:2236-2254`; `session-stats-aggregator.service.ts:135-156`). With `context === undefined`, no live-reading field is added; existing callers ignore the new boolean result. Impact: prior runtime behavior is unchanged.
- **References and boundary:** repository source search found no remaining `installLiveSessionStats` reference. The pure module imports only `@ptah-extension/shared` and a local type (`live-context-stats.ts:1-5`); `chat-state` does not import `chat`. Impact: removal leaves no call-site hole or Nx dependency inversion.

## New finding

1. **Minor — new aggregator test fixtures fail branded ID type checking.** The added `makeTab({ id: 'bg-a' })` and `makeTab({ id: 'bg-b' })` calls use plain strings where `TabId` is required (`libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts:324-325`). Scoped `ptah_get_diagnostics` reports TS2322 at both lines. The file already had the same error at `:290`, so these do not establish a new production failure, but they add errors to the changed project's diagnostic output. Use valid `TabId` fixtures in the new test.

## Five logic questions and limits

1. **Silent success:** the prior background routing silently skipped tabs; the union and per-tab loop close that path (`session-stats-aggregator.service.ts:255-264,229-238`).
2. **User action:** switching workspaces with multiple tabs open on one session now reaches all matching tabs, as the multi-workspace case asserts (`session-stats-aggregator.service.spec.ts:1478-1565`).
3. **Wrong-answer input:** a lower revision is rejected by the floor; malformed/nonpositive context fill returns null (`session-stats-snapshot.ts:81-89`; `live-context-stats.ts:24-32`).
4. **Dependency failure or wrong shape:** missing tabs fail admission without a write, and an invalid snapshot fails validation (`tab-manager.service.ts:2346-2353`); no new asynchronous dependency is introduced by this commit.
5. **Unspecified case:** the fix covers mixed active/background workspaces and deduplication (`session-stats-aggregator.service.ts:255-264`). The unchanged result footer handler is outside this commit's scope; this review makes no claim about its separate fan-out.

Scoped diagnostics reported no errors in the three changed production TypeScript files, but report many existing sibling errors and the two new spec errors above. Tests were not executed under the task's instruction; test assertions are inspection evidence only.
