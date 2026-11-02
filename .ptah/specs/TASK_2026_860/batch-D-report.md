## Frontend implementation — TASK_2026_860, batch D

**Files changed**

- Created `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-session-actions.component.ts`, `.html`, and `.spec.ts` — scoped header actions, responsive More menu, rename dialog, and action tests.
- Modified `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.ts`, `.html`, and `.spec.ts` — running input and action child before the persistent panel toggle.
- Modified `libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts` and `.spec.ts` — pass and test running state for docked and sheet inspectors.
- Modified `libs/frontend/chat/src/lib/services/chat.store.ts` — targeted confirmation facade.
- Modified `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts` and `.spec.ts` — captured abort target and tab-switch/failure regression coverage.

**Behavior**

Persisted sessions expose Rename and available Organize actions. Running inspector sessions expose Stop; a running draft shows a disabled Stop with a reason. Header content narrower than 320px uses a single More menu; selection or Escape closes it and restores its trigger focus. The panel toggle stays visible. Rename uses `SessionRowActionsService`; Organize uses `SessionOrganizerService`. Stop captures the inspector tab and branded session ID before querying agents and retains them through confirmation, abort, queue cleanup, resumable marking, and local failure fallback. Cancel sends no abort. A tab rebound to another session is not idled locally.

**Tests added**

Action child: persisted/draft/running availability, 280px and 320px menu behavior, Escape and selection focus return, organizer target, rename duplicate-submit guard and recoverable failure, Stop target. Inspector component: action placement in docked and sheet headers. Canvas inspector dock: running input in both presentations. Conversation service: active-tab switches before confirmation and on query rejection, single targeted abort, queue and resumable cleanup, cancel without abort, abort failure fallback, and rebound-tab safety.

**Verification**

Ran exactly once: `npm run verify -- -p @ptah-extension/canvas,@ptah-extension/chat` (foreground; exit 1). Three of six tasks succeeded, including `chat:test` and both project lint tasks. `canvas:test` had 7 failures in `canvas-rail-card.component.spec.ts`, `canvas-lane-tabs.component.spec.ts`, `canvas-rail-board.component.spec.ts`, and `dock-overflow-duration.spec.ts`; these are batch B/C surfaces and were not edited by D, except that D added a separate passing dock spec. Both project typechecks stopped at TS1005 in `libs/frontend/chat-ui/src/lib/atoms/agent-avatar/agent-avatar.component.ts:200-201`, a batch A file. Those failures prevent a confirmed typecheck of batch D. After the verify run, the action target was corrected from `string` to branded `SessionId`; the required single verify run was not repeated. `ptah_get_diagnostics` was requested after edits but remained unavailable after its 45-second TypeScript check timeout.

Rendered screenshot inspection was unavailable because this lane's verification rules prohibit serve/dev targets and no running UI was supplied.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Observe one parent header for the 320px action switch. | Observe header or each button. | Design specifies header content width; plan asks for one observer. | Yes |
| Keep a running draft's Stop visible but disabled. | Hide or disable. | Implementation plan explicitly asks for a missing-ID disabled reason. | Yes |
| Re-resolve the captured tab before local abort mutation. | Use active tab or captured tab. | Revision 1 requires tab-switch and replacement-session safety. | Yes |

**Unmet verification:** Typecheck and full canvas tests remain red because of files owned by other batches. No backend protocol was changed.
