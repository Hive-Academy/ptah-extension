# Code logic review R2 — d319c80e7

## Verdict

**NEEDS_REVISION.** F1 and F2 are fixed. F3 is partial because a concurrent toggle can leave another tab showing the saved default instead of its live permission level.

## Prior findings

| Finding | Status | Evidence and impact |
| --- | --- | --- |
| F1 — unknown parent level could inherit saved `yolo` | **FIXED** | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:655-675,709-714` passes the resolved child level to SDK launch and maps an absent parent level to `ask`; it no longer reads saved autopilot config. A missing lifecycle record cannot gain authority from the saved default. |
| F2 — sessionless tab could re-gate another session | **FIXED** | `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:357-375,424-430` persists the default, then maps explicit `null` to no live target; omission still selects the legacy active-session fallback. `libs/frontend/core/src/lib/services/autopilot-state.service.ts:284-288` sends `sessionId: null` for a sessionless tab. Thus this tab's toggle cannot directly re-gate another live session. |
| F3 — tab displayed global level instead of its own live level | **PARTIAL** | The host returns the requested lifecycle level at `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:457-463`, and the popover derives its label from the tab's ID at `libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts:198-218`. Yet the shared write epoch can discard a different tab's in-flight read, after which `stateFor` falls back to the global default (`libs/frontend/core/src/lib/services/autopilot-state.service.ts:144-153,172-180,267-283`). See N1. |

## New findings

### N1 — Serious: toggling tab A can make tab B display A's level

**Evidence:** `libs/frontend/core/src/lib/services/autopilot-state.service.ts:172-180` captures one global `writeEpoch` and discards a live-level response whenever *any* toggle increments it at `:267-268`. The toggle also changes the saved default at `:275-283`. If B has no cached entry, `stateFor(B)` returns that default at `:144-150`. The popover's ID-change effect is a normal way B starts the read (`libs/frontend/chat-ui/src/lib/molecules/chat-input/autopilot-popover.component.ts:205-218`).

**Failure scenario:** B's live session is `auto-edit`; A's is `ask`. B's first `config:autopilot-get` is pending while A enables `yolo`. A's toggle advances the global epoch and saves `yolo`; B's correct `auto-edit` response is discarded. B's label now shows Full Auto even though its session remains `auto-edit`, and a child from B inherits B's actual level. The label persists until B is refreshed again. The existing stale-read test in `libs/frontend/core/src/lib/services/autopilot-state.service.spec.ts:474-495` exercises a read and toggle for the **same** session, so it does not catch this case.

**Suggested fix:** Track write generations per session, and invalidate a read only when its own session is re-gated. Keep a read of B valid across A's toggle. Add a test that delays B's first read, toggles A, then resolves B's response and checks B's displayed level.

## Five logic questions

1. **Silent success:** N1 gives B a success-looking Full Auto label despite B remaining at `auto-edit` (`autopilot-state.service.ts:144-153,172-180`).
2. **User action:** Open B while its level loads, then enable Full Auto in A before B's read completes (`autopilot-popover.component.ts:213-218`; `autopilot-state.service.ts:267-283`).
3. **Wrong answer from valid data:** A valid `auto-edit` response for B is discarded solely because A changed (`autopilot-state.service.ts:173-180`).
4. **Dependency failure or timeout:** A failed or delayed read leaves the previous cache or default in place; `refreshSession` returns without updating on an unsuccessful RPC (`autopilot-state.service.ts:174-180`). The popover suppresses a rejected read (`autopilot-popover.component.ts:252-255`).
5. **Requirement gap:** The per-tab display needs a rule for concurrent reads and writes across tabs; the implementation uses a global generation (`autopilot-state.service.ts:91-92,172-180,267-268`).

## Verification scope

Reviewed commit `d319c80e7`, the prior review, fix report, and recorded decision. The fix report records targeted Jest runs (70 passed, 1 skipped for backend; 23 core; 7 chat UI; 68 chat). I did not rerun tests. Scoped diagnostics found no error in `autopilot-state.service.ts`; the project also reports errors in sibling spec files, so diagnostics do not establish a clean project check. The race above is an interleaving missing from the recorded tests.

