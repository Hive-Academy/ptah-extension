# Context — TASK_2026_317

## What the user saw

Three symptoms from one New Project run in the `qa3elhamor` workspace
(Electron, evidence in `tmp/logs/log.md`):

1. The New Project Setup panel ran Stage A, called `AskUserQuestion`, and then
   showed nothing but `[Request interrupted by user for tool use]`.
2. Clicking **Resume New Project** on the Setup Hub did nothing at all.
3. Opening an unrelated session from the Canvas made the New Project question
   card appear **on that session's tile**.

In the user's own words: "we had that properly working in the chat tile but not
in the other interfaces like new project or setup wizard or the harness
builder… we struggle with this for ages now."

That framing is the diagnosis. The chat-tile path works because of a
coincidence, not because it is the correct path.

## Root cause 1 — the prompt carries an id nothing can resolve

There are three identities in this system, and the prompt-routing code only
knew two:

| identity                    | minted by                              | resolvable through                     |
| --------------------------- | -------------------------------------- | -------------------------------------- |
| `TabId`                     | `TabManagerService`                    | `TabSessionBinding`                    |
| `ClaudeSessionId`           | the SDK's `init` message               | `ConversationRegistry`                 |
| workflow **correlation id** | `HarnessWorkflowService.startWorkflow` | `WorkflowSessionClaimService` **only** |

A surface workflow calls `chat:start` with `tabId: <correlationId>` and
`surfaceMode: true` (`harness-workflow.service.ts:264`). Downstream:

- `SdkQueryOptionsBuilder.build` computes
  `routingId = sessionConfig?.tabId ?? sessionId` (`:646`) and hands the parsed
  result to `createCallback` as BOTH the session id and the tab id. For a new
  session that is unavoidable at build time — the SDK UUID arrives later, in
  the `init` message.
- `AskUserQuestionService` stamps `sessionId` and `tabId: tabId ?? sessionId`
  onto the request. Both are the correlation id.

Now the frontend:

- `StreamRouter.routeQuestionPrompt` tries `binding.conversationFor(tabId)` —
  the correlation id is not a tab, so it misses.
- It then tries `registry.findContainingSession(sessionId)` — the surface's
  conversation holds the REAL session id, appended from stream events and from
  `SESSION_ID_RESOLVED`. The correlation id is never in it, so it misses.
- No targets are attached, and `ChatViewComponent.resolvedQuestionRequests`
  falls through to `return isActiveTile`, so the card renders on whatever tile
  is focused. The harness view filters on `hasSurfaceQuestionTargets`, which is
  empty, so it renders nothing.

A chat tab never hits this: there `sessionConfig.tabId` IS a bound `TabId`, so
rung 1 resolves. The tile path was never more correct — it was luckier.

The same id defect silently disabled reload recovery:
`PendingResponseRegistry` indexes entries by the ids on the request, so
`chat:pending-questions` (called with the REAL session id by
`HarnessWorkflowService.restorePendingQuestions`) could never find a workflow's
outstanding questions.

Note the asymmetry that let this survive: the **stream-event** path has
consulted the claim map all along —
`ChatMessageHandler.renderedSurfaceFor(tabId)` →
`WorkflowSessionClaimService.surfaceFor` — which is why transcript content
renders correctly in the New Project panel while its prompts do not. Only the
prompt path was blind.

## Root cause 2 — the watchdog charges the user's thinking time to the provider

`NoActivityWatchdog` (180s, `no-activity-watchdog.ts:91`) aborts a session that
emits no SDK stream events for a full window. A turn parked in `canUseTool`
emits none _by construction_ — that is what "waiting for the user" looks like
on the wire. So:

```
[ERROR] [SessionLifecycle] Session 76ba87fa… produced no stream activity for 180s
        — stopping the stuck session
[INFO]  [SdkPermissionHandler] Cleaning up pending permissions:
        {"pendingPermissionCount":0,"pendingQuestionCount":1}
[WARN]  [SdkPermissionHandler] AskUserQuestion aborted
```

The question card advertises "No timeout" and the backend's own idle timer for
it is 5 minutes (`ASK_USER_QUESTION_IDLE_TIMEOUT_MS`). The 3-minute watchdog
beat both. This is not specific to New Project — any permission prompt a user
took three minutes over killed its session the same way.

## Root cause 3 — two sources of truth for "which view am I on"

`WebviewNavigationService` held `_navigationState.currentView`, written only by
its own `navigateToView`, and `navigateToView` returns early when the target
equals it. But the Electron navbar sets the view straight on
`AppStateManager.setCurrentView` (`electron-shell.component.ts:348`), as does
the host's `switchView` message. Sequence:

1. Setup Hub → **Resume** → `navigateToView('harness-builder')`. Both agree.
2. Back to Setup via the navbar tab → app state is `setup-hub`, the mirror
   still says `harness-builder`.
3. **Resume** again → target equals the stale mirror → returns `true`, changes
   nothing. A dead button that reports success.

## Fixes

1. **Real session id on the prompt** — `createCallback` takes a
   `sessionIdResolver`, bound by `SessionQueryExecutor` to
   `rec.realSessionId`. Prompts raised after `init` carry the id the frontend
   routes on; `tabId` keeps the correlation id. Cleanup paths already match on
   either field.
2. **Claim-map lookup in the router** — `routeQuestionPrompt` /
   `routePermissionPrompt` resolve a correlation id through
   `WorkflowSessionClaimService`, gated on the surface being registered
   interactive. Closes the asymmetry with the stream-event path, and covers the
   pre-`init` window where no real id exists yet.
3. **Fallback no longer poaches owned prompts** — `ChatViewComponent`'s
   active-tile net stands down when the question's correlation id is claimed.
   The net stays for genuinely unowned prompts.
4. **Watchdog hold/release** — `canUseTool` is wrapped so the inactivity window
   is suspended for the whole tool call and a FULL fresh window starts on
   release. Reference-counted for concurrent subagent calls; released in a
   `finally` so a throwing gate cannot wedge it off.
5. **One source of truth for the view** — `WebviewNavigationService.currentView`
   is now `computed(() => appState.currentView())`, and `previousView` records
   where the user actually was.

## Why it looked like "all the workflows"

Because it was. All four Setup Hub cards navigate through
`WebviewNavigationService`, and all four are reachable from the navbar's Setup
tab — so root cause 3 broke every one of them identically. Reverting that fix
fails 12 navigation tests spanning all four cards.

The prompt half is narrower, and the audit is worth recording because the four
cards are four different shapes, not four copies:

| card               | host                      | claims a correlation id          | surface       |
| ------------------ | ------------------------- | -------------------------------- | ------------- |
| New Project        | `HarnessWorkflowService`  | yes (not a tab)                  | interactive   |
| AI Team Builder    | `HarnessWorkflowService`  | yes (not a tab)                  | interactive   |
| Workspace Analysis | `SetupWizardStateService` | no                               | background    |
| Tribunal           | `TribunalRunService`      | yes — its **conductor TAB's** id | never adapted |

- The two harness modes share one path (`surfaceMode: true` appears nowhere
  else in the frontend), so both had the identical prompt defect.
- Workspace Analysis cannot raise a prompt at all: its phases run
  `SdkQueryRunner`'s `oneShot` mode — `bypassPermissions`, no `canUseTool`. Its
  non-interactive surfaces and the auto-answer guard are correct as they stand.
- Tribunal claims a **real tab id** against a surface it never adapts. That
  makes any raw "is this claimed?" test the wrong question, and the first cut
  of the `chat-view` guard got it wrong — it would have hidden the conductor's
  own prompts. The guard now delegates to the router's interactive-gated
  resolver, so the view and the routing cannot disagree about who owns a
  prompt.

## Deliberate non-changes

- The `isActiveTile` fallback in `ChatViewComponent` is kept for prompts nobody
  owns. `awaitQuestionResponse` runs with `timeoutAt: 0`, so a silently dropped
  question still hangs a tool call; the net earns its keep there.
- A webview permission prompt keeps its unbounded wait
  (`classifyPermissionRoute`). The watchdog hold makes that contract true in
  practice rather than nominally; it was already the documented intent.
- `routePermissionPrompt`'s return type stays `readonly TabId[]` per the
  chat-routing guideline — surface targets are attached as a side effect, as
  the existing interactive-surface branch already does.
