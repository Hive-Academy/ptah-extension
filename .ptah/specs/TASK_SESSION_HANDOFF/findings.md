# Session handoff — findings and recommendation

Status: investigation only. Nothing is implemented yet; waiting for the user's approval.
Paths are relative to the repo root.

## Q1 — What happens to background work when a session hands off?

### What `ptah_session_handoff` actually does

- `SessionHandoffService.guardAndStart`/`start`
  (`libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts:124-277`)
  starts the new tab and records `remember(callerTabId, {sdkSessionId, tabId})` (`:261`, `:352`).
  **It does not stop or interrupt the old session, its lanes or its child sessions.** The old tab
  stays open and live (`adoptHandoffTab` in `tab-manager.service.ts:1254` only places the new tab
  next to it).
- The only predecessor→successor mapping is the private map `handedOff` (`:79`). It holds at most
  64 entries and is used only for the `already-handed-off` refusal (`findHandedOff`, `:338`).
  Delivery code never looks at it.

### How delivery behaves

All delivery is keyed to the session that spawned the work. **Nothing is re-parented.**

| Work | Old tab still open (the default after handoff) | Old tab closed | Can the successor read it? |
|---|---|---|---|
| CLI lane `<agent-lane-completed>` | Pushed into the **old** session and **starts a turn there**, in a context that is already at its budget limit | **Lost.** `LaneCompletionNotifier.signal` refuses with `parent-session-not-active` (`lane-completion-notifier.service.ts:377`, `:660-677`), only logs it, and keeps no queue and makes no retry | **Yes, by lane id.** `ptah_agent_read`/`ptah_agent_status` check only the workspace (`agent-process-manager.service.ts:1461-1495`). The record is kept until 30 min after the lane finishes (`agent-process-manager-helpers.ts:54`) |
| Lane `ptah_agent_report` | Delivered to the old session | **Lost.** Refused back to the lane (`agent-report-router.service.ts:301-321`) | Only in the lane's own output, through `ptah_agent_read` |
| Child session completion | Pushed into the old session | **Held**, one per child (`heldCompletion`, `session-spawner.service.ts:1074-1088`). This is the "Held while this session was not live" text. It is drained only by the **original parent** (`takeHeldCompletions` `:771`, using `childrenOf([caller, sdkIdOf(caller)])`) | **No.** `ptah_session_status`/`read`/`stop` refuse with `not-a-child-of-caller` (`resolveOwned`, `:1103-1133`) |
| Child session `ptah_agent_report` | Delivered to the old session | Refused and counted, never queued (`agent-report-router.service.ts:461-472`) | No |
| SDK subagent (Task tool) | Keeps running inside the old session | Ending the old session marks subagents `interrupted` and aborts the query (`session-control.service.ts:177-180`, `subagent-registry.service.ts:654-668`) | No path for the result to reach the successor |

Two more points:
- Any completion that is already held when the handoff runs is appended to the **handoff tool's
  own reply** (`session-tool-handlers.ts:506`) and then marked delivered. Only the old session sees
  it.
- After the old session ends, `sdkIdOf` (`session-spawner.service.ts:1218`) returns undefined, so
  matching by SDK id fails without an error.

### The current SKILL.md guidance is inaccurate

§1 says a lane "pushes its report … into this session when it ends". That is true, but after the
handoff "this session" is the abandoned tab:
- If the user keeps the old tab open, each signal starts a **paid turn in the old, full context**.
- If the user closes the old tab as the skill asks, lane signals and reports are **lost**, and
  child sessions become **unreadable** from the successor.

### The three options

| Option | What it takes | Cost and risk |
|---|---|---|
| **A. Bounded wait** before the handoff | Skill text only. `ptah_agent_wait` returns after at most 45 s per call; the alternative is idling on the push signal | Every wait call, and every pushed signal, is a paid turn in a context that is already at 100%. That is the most expensive context in the session. Lanes can run for a long time, so with a bounded wait the leftover work is still stranded. It also delays the handoff and risks overflowing the context. **Not recommended.** |
| **B. Adopt at handoff**: re-parent the predecessor's live lanes and children to the successor | Backend, about 3 files. After `remember()` in `SessionHandoffService.start`: (1) for each tracked lane whose `parentSessionId ∈ {oldTabId, oldSdkId}`, set the parent to the successor's tab id. The existing tab-id→SDK-uuid rekey (`resolveParentSessionId`, `agent-process-manager.service.ts:1798`) then follows the successor. (2) For each live child (`registry.childrenOf`), update `parentSessionId`/`parentSdkSessionId`. (3) List the adopted ids in the handoff reply and in the successor's first prompt. Specs for each. | Moderate one-time code cost and no runtime token cost. Completions, reports and held child completions then reach the **new** session, which has a fresh context. `ptah_session_*` works from the successor. One risk: a completion can arrive while the successor is still reading HANDOFF.md. That is harmless, because it is a normal queued push. |
| **C. Keep the design and fix the guidance** | Skill text only | No code cost. Lane results stay readable by id for 30 min. Child sessions are still orphaned from the successor, and lane signals still wake the old tab or are lost. |

**Recommendation: B + C together.** Adopt at handoff (B), which is narrow, local to the handoff
service and needs no new hold store. Then correct the SKILL.md wording (C): after the handoff,
background work belongs to the new session, so record the ids in HANDOFF.md and do not wait. The
skill should also tell the user that closing the old tab is now safe for lanes and children.
Keep Task-tool subagents out of scope: they live inside the SDK query and cannot move. The skill
should say to let foreground subagents finish, or to record them as lost, before handing off.

## Q2 — Auto-handoff at 100%

### What already exists

There is **no** automatic action today (no `autoHandoff` anywhere). These pieces exist:
- **Stage:** backend `observeLive` (`session-budget.service.ts:201-244`) feeds
  `SESSION_STATS_LIVE`, which sets `TabManagerService.setLiveBudgetStage`
  (`tab-manager.service.ts:2681`). The authoritative `tab.sessionBudget.stage` arrives with each
  `session:stats` snapshot.
- **Manual action:** `SessionBudgetActionsService.sendWrapUp()`
  (`libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:182`). It sends
  `/session-handoff This session has used X tokens.` if the skill exists, otherwise an inline
  wrap-up prompt.
  - It goes through `ChatStore.sendOrQueueMessage(…, {tabId})`, which **already queues while the
    tab is streaming** and sends after the turn (`message-dispatch.service.ts:181-237`).
  - A command behind other queued text is held, and is dropped on Stop or a failed turn
    (`conversation.service.ts:192-274`).
- **Once-per-session guard:** the `wrapUpSessions` set (`:110`). It is in memory and per view, and
  it is cleared when the send fails.
- **Cancel:** the queued message can already be cancelled (`chat-view.component.ts:1336`, which
  calls `cancelQueue`, which calls `ChatStore.clearQueuedContent`).
- **Setting conventions:** `SESSION_BUDGET_SETTINGS` (`libs/shared/src/lib/types/session-budget.types.ts:149`)
  together with `SessionBudgetConfig` gives the key registry, the default and the write permission
  automatically (`platform-core/src/file-settings-keys.ts`). Then add the reader
  (`session-budget-config.provider.ts:121`) and the settings card
  (`libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.ts`, `BooleanKey`).

### Proposed smallest design

1. **Setting:** add `sessionBudget.autoHandoffAtLimit` (boolean, default `false`) to
   `SessionBudgetConfig` and `SESSION_BUDGET_SETTINGS`. Add a `readBoolean` line in the provider and
   a toggle in the Session budget card ("Hand off automatically at 100%"), plus the e2e settings
   fixture.
2. **Delivery to the webview:** add `autoHandoff: boolean` to `SessionBudgetState` (composed in
   `SessionBudgetService.composeState`). That needs no new RPC, and a changed setting applies with
   the next snapshot. Update the snapshot validator in `chat-state`.
3. **When it fires:** an `effect` in `SessionBudgetActionsService`, firing only when all of these
   hold:
   - `displayStage() === 'limit'`
   - `budget.autoHandoff` is on
   - the handoff skill is available (auto mode never sends the inline fallback prompt)
   - the session is not in the root auto-fired/cancelled set

   It calls the existing `sendWrapUp()`. If the stage is reached mid-turn, the existing
   `sendOrQueueMessage` queues the command, so it runs after the current turn and never interrupts
   the stream.
4. **Once per session:** a small **root** service, following the pattern of
   `SessionRotationKeepService`, keyed by sessionId and marked **before** the send. A failed send
   resets only the manual button, not this guard, so it does not retry in a loop. Because the
   guard is root-scoped, two views of the same session (conductor tiles) cannot both fire.
   - Assumption: the guard lives in memory. After a reload, a session that is still at the limit
     could fire once more. In that case the backend's `already-handed-off` refusal and the skill
     fallback stop a second new session.
5. **Same tab:** `sendOrQueueMessage(…, {tabId})` with the view's own tab, as the manual button
   does today. The trigger only runs for a tab that is shown in a view. Assumption: a session in a
   background tab fires when the user switches to it. That is acceptable for v1.
6. **Cancel:**
   - The banner gets an "Auto hand-off queued — Cancel" state. Cancel clears the queued command
     and marks the session cancelled so it never re-fires.
   - Stop and the existing queue cancel do the same.
   - Once the command has been sent, the user stops it like any turn (Stop).
7. **Refusal:** no new code. The skill's Fallback (§ Fallback) prints a paste-able continuation
   prompt, and the guard stays set, so there is no retry. Optional: a one-line notice in the
   banner ("Auto hand-off ran — see transcript").

**Projects to verify:** `shared`, `agent-sdk`, `platform-core`, `chat`, `chat-state`,
`webview-e2e-harness`, plus the dependent hosts for typecheck (`ptah-extension-webview`,
`ptah-electron`, `ptah-extension-vscode`). The TUI does not use the budget.
