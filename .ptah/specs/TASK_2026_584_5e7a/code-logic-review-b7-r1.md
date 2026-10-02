VERDICT: APPROVED
SCORE: 10/10

# Code Logic Review — `TASK_2026_584_5e7a` (Batch 7: Angular Webview Tab Adoption — Revise Round 1)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 10/10    |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0        |

All three findings from Revise Round 1 have been completely resolved with clean, idiomatic Angular signal architecture, verified by 25 unit tests. The implementation correctly handles lazy history loading on first activation of late-adopted tabs without regressions, avoids live stream interference, exposes public types cleanly, and complies with repository error audit conventions.

---

## Round-1 Defect Resolutions

| #   | Original Severity | Finding                                           | Status       | Evidence (file:line)                                                                    | Resolution Details                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------- | ------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MAJOR             | Empty late-adopted tab on tab activation (A2 gap) | **RESOLVED** | `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:131-161,175-193` | Added a root effect watching computed `pendingHistoryLoad` (`tabId\|sessionId`). When an empty late-adopted agent tab is activated, it invokes `sessionLoader.switchSession(session, { targetTabId })`. `targetTabId` guarantees `activate: true` is never sent (`session-loader.service.ts:700-702`). One-shot tracking via `historyRequested` set ensures at most one load per tab and prevents reload loops. |
| 2   | MINOR             | Missing barrel exports for adoption types         | **RESOLVED** | `libs/frontend/chat-state/src/index.ts:14-15`                                           | Exported `type AgentSessionAdoptionMode` and `type AgentSessionAdoptionResult` from `chat-state` index. The `Parameters<>` workaround was eliminated from `agent-session-adoption.service.ts:10`.                                                                                                                                                                                                               |
| 3   | MINOR             | Missing degradation-audit markers on catch blocks | **RESOLVED** | `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:184,216,255`     | Added structured `// degradation-audit: optional-capability - ...` comment markers to all three catch blocks (`loadAgentHistory`, `adoptLiveChildren`, and `adopt`).                                                                                                                                                                                                                                            |

---

## Tab with messages (Verification of 1(c))

### Analysis of Late-Adopted Tabs with Pre-Activation Streamed Turns

**Scenario:** A child session is adopted `late` after webview reload (status `'loaded'`, `messages: []`, `claudeSessionId` known). Before the user ever activates the tab, the backend streams one or more turns into the tab.

**1. Is the tab still usable?**
**YES.**
When turns stream into the background tab, `TurnStateApplier` and `StreamingHandlerService` route events by `tabId` to the tab. The tab's status updates, messages are appended (`tab.messages.length > 0`), and `tab.hasLiveSession` is set to `true`. The user can activate the tab, see the streamed messages, type new prompts in the composer, and continue chatting normally.

**2. Does it show only post-adoption turns forever, or can earlier history be loaded?**

- In this specific edge case, the tab shows the turns that streamed during the current webview session.
- `AgentSessionAdoptionService.needsAgentHistoryLoad` (`agent-session-adoption.service.ts:27-38`) deliberately skips any tab where `tab.messages.length > 0` or `tab.hasLiveSession === true`.
- If the user clicks the session in the sidebar, `SessionLoaderService.switchSession` (`session-loader.service.ts:617-624`) checks:
  ```ts
  if (opts?.reason !== 'compaction' && existingTab?.hasLiveSession) {
    const inActiveWorkspace = this.tabManager.tabs().some((t) => t.id === existingTab.id);
    if (inActiveWorkspace) {
      this.tabManager.switchTab(existingTab.id);
      return { staleSnapshot: false };
    }
  }
  ```
  Because `hasLiveSession` is `true`, `switchSession` simply switches tab focus and immediately returns `{ staleSnapshot: false }`. It does **NOT** dispatch `chat:resume` and does **NOT** clear or overwrite the in-memory messages.
- Therefore, **no streamed turns are ever wiped out, truncated, or duplicated**.

**3. Is this acceptable against Plan A2 or a defect?**
**ACCEPTABLE (NOT A DEFECT).**

- Plan Assumption A2 (`implementation-plan.md:163-167`) and Component 8 (`:774-777`) specify lazy loading history specifically for:
  > _"A tab adopted with a known `claudeSessionId`, status `loaded` and **no messages**"_
- The plan's design specifically targets tabs that have not yet received any content.
- If a tab has already received active live streaming turns, replacing `messages` wholesale would destroy in-flight assistant responses and user turns, as `SessionLoaderService.applyResumingSession` wipes `messages` before replaying from disk.
- Furthermore, on any subsequent full webview reload or session switch when the session has idled, the consolidated transcript on disk contains both pre-reload and post-reload turns; loading with 0 messages will then fetch the full history.
- Skipping history loading when `messages.length > 0` or `hasLiveSession === true` is the correct defensive posture that guarantees transcript integrity.

---

## Detailed Checks of Round-1 Fixes

### 1(a): Load Invariants

- **At most one load per tab:** Enforced by `historyRequested.has(tabId)` in `loadAgentHistory` (`agent-session-adoption.service.ts:176,180`). Switching away and back does not re-request history.
- **No `activate: true`:** `switchSession` is called with `{ targetTabId }`. In `session-loader.service.ts:700-702`, `...(opts?.activate === true && !targetTabId ? { activate: true } : {})` guarantees that when `targetTabId` is supplied, `activate: true` is never sent to the backend.
- **Live tabs never trigger:** `needsAgentHistoryLoad` checks `tab.hasLiveSession !== true`. Tabs adopted `live` have `hasLiveSession: true`, permanently blocking this loader.

### 1(b): Retry Logic on Load Failure

- When `switchSession` rejects, the catch block executes `this.historyRequested.delete(tabId)` (`:187`).
- While the user remains on the active tab, `pendingHistoryLoad` returns the exact same string value (`${tab.id}|${tab.claudeSessionId}`). Because Angular computed signals evaluate to the same primitive string, the effect does not re-fire, preventing an infinite retry loop.
- When the user switches to another tab and subsequently re-activates the failed tab, `pendingHistoryLoad` transitions from `null` back to `${tab.id}|${tab.claudeSessionId}`, safely triggering a single retry.

### 1(d): Lifecycle & Resource Invariants

- `AgentSessionAdoptionService.start()` creates exactly two root effects (`:146-161`) bound to `this.injector`.
- No `setInterval`, `setTimeout`, `MutationObserver`, or per-tab subscriptions are introduced.
- Lifecycle is bound to the root Angular injector.

---

## New Defects

None found.

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: None. The implementation satisfies all functional requirements, maintains persistence and stream routing invariants, and cleanly resolves all round-1 issues.
