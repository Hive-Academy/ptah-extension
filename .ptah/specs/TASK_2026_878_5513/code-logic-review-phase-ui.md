# UI phase code logic review

## Verdict

**REVISE — 5/10.** The requested result lines and fixed action errors are mostly present, but two likely failure paths still make an action look successful or disclose a raw error. This is above the 3–4 band because the normal result and busy paths are wired; it is below 7–8 because the failure behavior is central to this task.

## Findings

1. **Serious — `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts:342-347,429-438`.** `loadStatus` silently ignores an unsuccessful RPC result. After an accepted start or resume, `runStartLike` then clears `_starting` with no action message, while the old status and last-run line remain. A user can click an action and see no evidence that the status refresh failed. Make `loadStatus` report failure to action callers and show a fixed sentence; keep an accepted/joined result distinguishable from a failed status read.
2. **Serious — `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts:168-175` and `libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.ts:214-216,334-336,407-410`.** The new Code index alert renders the shared `error()` signal, while refresh and stats failures store `err.message` there. Opening Code index during either failure displays raw backend or transport text, violating the explicit fixed-sentence rule. Give rebuild its own fixed error presentation, or sanitize every producer of the shared error before this view renders it.
3. **Serious — `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts:277-281`.** `INDEXING_FAILED` clears progress but swallows a rejected `loadStatus`. The previously loaded `status.running` can remain set, so `uiState` stays `indexing` and `isBusy` stays true after a failed run; no failure alert appears. Set a fixed failed action state and retire the stale running snapshot when status cannot be reloaded.
4. **Moderate — `libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-state.service.ts:188-207,225-235`.** The 30-second poll and a manual run share `_loading`. If a poll finishes while `runNow` is awaiting its RPC, `refresh()` clears `_loading`, re-enabling Run curator now and allowing a second concurrent click. Separate manual-run busy state from diagnostics refresh, and guard duplicate manual requests.
5. **Moderate — `libs/frontend/memory-curator-ui/src/lib/services/memory-state.service.ts:299-314,324-336`.** Rebuild writes its fixed error to the same `_error` that `loadStats` clears at start and writes on completion. A concurrent stats refresh can erase the rebuild failure immediately or replace it with a raw error. Keep the rebuild result and error independent of list/stats request state.

## Acceptance criteria check

- **Batch 6:** Manual result is stored from both successful and `success:false` RPC bodies (`memory-diagnostics-state.service.ts:230-235`), and `refresh` does not clear it (`:188-207`). Outcome wording and alert/status roles are present (`memory-diagnostics-accordion.component.ts:259-276,480-510`); curator-error block and settings action are present (`:344-365`); feed tone and reason text are present (`event-feed.component.ts:192-225`). The manual-run loading race remains (finding 4). The implementer explicitly chose to clear the previous result on a new click (`memory-diagnostics-state.service.ts:228`); that is reversible and does not remove a capability.
- **Batch 13:** The four actions catch thrown RPC errors (`workspace-indexing.service.ts:354-441`); failed push, running state and fixed action messages are wired (`:171-200,256-282`). Background label and join control appear (`workspace-indexing.component.html:123-166`); last-run lines appear in finished states (`:248-254,303-309,360-366`). Follow-up status and failed-push failures remain (findings 1 and 3). The raw error display was replaced with fixed text while Copy error details remains (`:385-400`), so no capability was silently removed.
- **Batch 14:** Rebuild has a separate busy signal and fixed failure (`memory-state.service.ts:299-314`); the named button, result line and Code index error alert are present (`memory-curator-tab.component.ts:137-175`). Shared error use causes findings 2 and 5. Banner action message is wired in `memory-indexing-banner.component.ts`.
- **Batch 18:** Optional counts are additive in `libs/shared/src/lib/types/rpc.types.ts`; harvest stores a result before refreshing and emits a fixed failure (`skill-synthesis-state.service.ts:268-299`). The component has a busy label, status result, alert and how-it-works text (`skill-specs-control.component.ts:27-56`). The implementer chose to clear the previous successful harvest on a failed new attempt (`skill-synthesis-state.service.ts:285-288`); this is reversible and does not remove a capability.

## Style notes

Changed components use OnPush, signals, typed contracts and shared public imports. The source review found no new `any`. The `tool-failure` feed snippet at `event-feed.component.ts:128-135` is the user-approved exception. The fixed `INDEXING_FAILED` recovery needs a scoped regression check with a rejected status RPC; existing passing happy-path checks would not establish it.

## Five logic questions

1. **Silent failure:** an accepted indexing start followed by an unsuccessful status wrapper has no visible result (finding 1).
2. **Unexpected user action:** a second Run curator now click becomes possible while the first is in flight (finding 4).
3. **Wrong-answer input:** a stale `status.running` after a failed push presents a failed run as still indexing (finding 3).
4. **Dependency failure/timeout/malformed reply:** a rejected failed-push status reload is swallowed; unsuccessful status wrappers are ignored (findings 1 and 3). Push payloads are type assertions without runtime validation (`workspace-indexing.service.ts:262-281`), so malformed payloads can also direct a reload to an invalid root.
5. **Requirement gap:** the criteria do not define how accepted action results should be shown when their follow-up status read fails. Preserve the accepted result and show a separate fixed refresh failure.

## Decisions

- **Decision:** Treat an accepted action plus failed status read as incomplete UI feedback. **Options:** ignore the read failure / show a fixed refresh failure while preserving acceptance. **Evidence:** `workspace-indexing.service.ts:342-347,417-438`; the task requires honest action results. **Reversible:** yes.
- **Decision:** Treat the shared Memory tab `error()` as unsafe for Code index display until all its producers are sanitized. **Options:** sanitize all producers / use rebuild-specific error state. **Evidence:** `memory-state.service.ts:214-216,334-336,407-410` and `memory-curator-tab.component.ts:168-175`. **Reversible:** yes.
- **Capability check:** The four implementer reports list no proposed removals. The Copy error details control remains available, while its visible text is fixed (`workspace-indexing.component.html:385-400`).

## Review limits

Read-only review of the supplied UI patch, task criteria, plan, implementer reports and affected source paths. No Nx, verify, build, test or git command was run, as requested. The Angular skill loader is not exposed in this lane, so no skill instructions were loaded. Ptah diagnostics was requested separately; its result is recorded below if available.

Ptah diagnostics returned **unavailable** for the three scoped TypeScript files because its check was still running after 45 seconds; no typecheck pass is claimed.
