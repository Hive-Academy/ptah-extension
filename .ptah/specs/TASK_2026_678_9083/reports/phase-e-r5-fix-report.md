# Phase E round 5 fix report

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-turn-status.ts` — classify the failed-start tab state as an error and show the fixed toast.
- `libs/frontend/command-center/src/lib/components/command-center-workspace-binding.ts` — follow active workspace changes, serialize opens, and clear a closed workspace binding.
- `libs/frontend/command-center/src/lib/components/command-center-workspace-binding.spec.ts` — cover initial open deduplication, workspace rebinding, and null workspace.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts` — wire workspace tracking and block sends to a stale binding.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts` — cover failed start, late success pulse, workspace switch, null workspace, and send guard.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts` — remove rail wheel containment.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts` — assert that the rail lacks wheel containment.

## N-1 signal

`ChatLifecycleService.settleFailedSessionStart` calls `TabManagerService.markSessionStartFailed` (`libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts:383-396`). The latter sets the root tab to `loaded`, sets `hasLiveSession: false`, and leaves `claudeSessionId` null (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1168-1194`). The page reads these existing tab fields at the streaming-to-idle transition. It never displays the appended backend error message. A successful no-pulse settle remains idle; the spec also delivers its success pulse afterward and checks that no toast appears.

## N-2 design

`activeWorkspacePath$` is a readonly Angular signal (`libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:122`). The new tracker reacts to changes in that signal and calls `coordinator.openOrResume()` for a non-null path different from the store binding. It compares the first signal value with the path observed at tracker creation; repeated values cause no open. Concurrent requests share one promise, and a changed path is handled after an in-flight open completes. A null path clears the tab/session/workspace binding and shows `Open a workspace to use Command Center.` The `sendCommand` guard refuses a send when the active path is null or differs from the stored path, showing the same fixed text. No model text is sent by the binding logic; Tribunal Confirm remains in its existing card action.

## R4-4 CSS

Before: the two-column `.rail` had `overflow-y: auto`, a bounded `max-height`, and `overscroll-behavior: contain`. After: `overscroll-behavior: contain` is removed from `.rail`; its overflow and height remain. The stacked `.work-list-region` containment remains.

## Verification

Changed-spec Jest run: **3 suites passed, 70 tests passed** (`--coverage=false --maxWorkers=2`). After the tracker initialization refinement, its focused spec passed again: **1 suite, 1 test**. `git diff --check` found no whitespace errors. Controller line count: **699**.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use failed-start tab state | Existing tab signal or no-reply fallback | `markSessionStartFailed` writes `loaded`, `hasLiveSession: false`, and no SDK session; this distinguishes the observed failed start from a successful no-pulse settle. | Yes |
| Refuse stale sends | Rebind inside send or return a fixed toast | The workspace tracker already starts rebinding; refusing prevents a turn reaching the old tab while an open is pending. | Yes |
| Serialize workspace opens | Let each signal change open or share one pending open | `openOrResume` itself caches a pending open; serializing in the tracker lets a later workspace change run after it. | Yes |

## Anything not done

No full test, typecheck, lint, build, or e2e run; the orchestrator owns broader checks. Pre-existing changes to `batches.md`, `future-enhancements.md`, and `HANDOFF.md` were not made or altered by this fix.
