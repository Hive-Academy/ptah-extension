VERDICT: REVISE
SCORE: 8/10

# Code Logic Review — `TASK_2026_584_5e7a` (Batch 7: Angular Webview Tab Adoption)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 8/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Failure modes found | 2              |

The Batch 7 implementation is functionally solid, highly defensive, and well-tested across 18 files. Core invariants around tab placement, title preservation (`titleOrigin: 'user'`), non-theft of active tab focus (Risk R5), persistence round-tripping (`TabAgentOrigin`), defensive IPC message decoding, accessibility (aria roles and keyboard reachable buttons), and partitioned workspace isolation are properly respected.

Revision is requested to address a functional gap identified around Assumption A2 (activating a late-adopted tab leaves it blank until an explicit sidebar click), export adoption types in the public barrel, and add degradation-audit markers to error catch blocks.

---

## Findings Table

| #   | Severity | File:Line                                                                                                                                              | Description                                                                                                                                                                                                                                                                                                                    | Recommended Fix                                                                                                                                                                              |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | MAJOR    | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:987-995` & `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:617-624` | **Empty late-adopted tab on tab activation (A2 gap):** A late-adopted tab is created with `status: 'loaded'`, `messages: []`, and `hasLiveSession: undefined`. Activating the tab from the tab bar leaves the transcript completely blank; history is loaded only if the user discovers and clicks the session in the sidebar. | Auto-trigger history load via `SessionLoaderService.switchSession` upon first activation of a tab with `agentOrigin` that has not yet loaded history, or when activating a late-adopted tab. |
| 2   | MINOR    | `libs/frontend/chat-state/src/index.ts:11-16`                                                                                                          | **Missing barrel exports:** `AgentSessionAdoptionMode` and `AgentSessionAdoptionResult` are declared in `tab-manager.service.ts:74,84` but omitted from `chat-state`'s public barrel. Consumers must infer the mode via `Parameters<TabManagerService['adoptAgentSessionTab']>[1]`.                                            | Export `type AgentSessionAdoptionMode` and `type AgentSessionAdoptionResult` in `libs/frontend/chat-state/src/index.ts`.                                                                     |
| 3   | MINOR    | `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:122-124,158-160`                                                                | **Missing degradation-audit markers:** Catch blocks catching `error: unknown` log errors without `// degradation-audit:` markers, risking pre-commit lint failure under strict repository quality gates.                                                                                                                       | Add `// degradation-audit: optional-capability - ...` comment markers to catch blocks in `adoptLiveChildren` and `adopt`.                                                                    |

---

## Five Logic Questions

### 1. How does this fail silently?

- In `AgentSessionAdoptionService.adoptLiveChildren` (`libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:114-125`), if the `chat:agent-sessions` RPC fails or rejects, a warning is logged to `console.warn` and execution returns cleanly without notifying the user. While non-fatal degradation is intended, any running children whose tabs were missed will not appear in the tab bar and are only visible in the sidebar session list.
- In `TabManagerService.adoptAgentSessionTab` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:899-906`), if `payload.parentTabId` is not present in this webview panel, it returns `'parent-absent'`. No error is raised, and the session remains un-adopted in this panel (as intended by Risk R6).

### 2. What user action produces unexpected behaviour?

- **Webview reload followed by tab click:** A user who reloads the webview while a child session is running will see the child tab re-created (either via localStorage restore or late adoption). When the user clicks the tab in the tab bar, the tab opens with an empty transcript (`messages: []`). The user expects the transcript to appear. The transcript only loads if the user specifically navigates to the sidebar and clicks the session item there (`libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:514-519`).

### 3. What input data produces a wrong answer?

- In `tab-persistence.ts:219-243` (`restoredAgentOrigin`), if `startedAt` is `NaN`, `Infinity`, or non-numeric, the entire `agentOrigin` object is dropped as malformed, causing the tab to restore as a regular user chat tab without the agent badge or origin banner. While this preserves tab viability, the origin metadata is lost.

### 4. What happens when a dependency fails?

- **`chat:agent-sessions` RPC failure:** Contained in `AgentSessionAdoptionService.adoptLiveChildren` (`libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:109-125`). The call catches errors and returns `void`; existing open tabs are unaffected.
- **Parent tab closed:** Handled cleanly in `TabBarComponent` (`libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:244-255`) and `AgentOriginBannerComponent` (`libs/frontend/chat/src/lib/components/molecules/agent-origin-banner/agent-origin-banner.component.ts:81-86`). The badge sets `aria-disabled="true"`, updates its tooltip to note that the parent tab is closed, and ignores clicks. The banner displays `"an agent session whose tab is closed"` and hides the "Open parent" action button.

### 5. What is missing that the requirements never mentioned?

- **Automatic history loading on tab activation:** Assumption A2 assumed `openSessionTab` or tab activation would automatically trigger the lazy history loader. In reality, history loading in the webview is exclusively driven by sidebar session clicks via `SessionLoaderService.switchSession`. Activating an already opened tab simply sets `_activeTabId`, doing no data fetching.

---

## Failure Modes

### FM-1: Empty transcript on late tab activation

- **Trigger:** Webview reloads or restarts while a child session is in progress, followed by user clicking the child tab in the tab bar.
- **Symptom:** The child tab is selected and displays the Agent Origin banner, but the chat transcript is completely blank (0 messages).
- **Evidence:** `libs/frontend/chat-state/src/lib/tab-manager.service.ts:987-995`, `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:617-624`.
- **Current handling:** Tab status is `'loaded'` with `messages: []`. Tab activation in `TabBarComponent` calls `tabManager.switchTab(tabId)`, which only mutates `_activeTabId`.
- **Recommendation:** When activating a tab that has `agentOrigin` and `status: 'loaded'` with empty messages and a known `claudeSessionId`, trigger `SessionLoaderService.switchSession(claudeSessionId)` to load its transcript.

### FM-2: Public barrel type omission forcing ad-hoc type queries

- **Trigger:** External consumers in `@ptah-extension/chat` importing tab adoption types.
- **Symptom:** Developers must write `Parameters<TabManagerService['adoptAgentSessionTab']>[1]` instead of importing `AgentSessionAdoptionMode`.
- **Evidence:** `libs/frontend/chat-state/src/index.ts:11-16`, `libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:7-9`.
- **Current handling:** Types are unexported from `chat-state`.
- **Recommendation:** Export `AgentSessionAdoptionMode` and `AgentSessionAdoptionResult` from `libs/frontend/chat-state/src/index.ts`.

---

## Deviation Rulings

### (1) Live push routes through `AgentSessionAdoptionService.adopt` with settled memory

- **Status:** **ACCEPTABLE**
- **Rationale:** The in-memory `settled = new Set<string>()` (`libs/frontend/chat/src/lib/services/agent-session-adoption.service.ts:86`) tracks tabs that were successfully adopted or found to exist. When a user deliberately closes a child tab during a session, the next workspace switch queries `chat:agent-sessions`; without this memory, the closed tab would immediately respawn against the user's intent. Because this set is instantiated per-webview (separate per panel) and is memory-only (cleared on full page reload), it cannot block legitimate adoptions in other panels or across reloads. The set is bounded by the number of spawned sessions (UUID strings), consuming negligible memory (< 10 KB). Furthermore, `'parent-absent'` is deliberately excluded from `settled` (lines 153-157), allowing unvisited workspace partitions to adopt their children when activated.

### (2) Payload parser lives in `agent-session-adoption.service.ts`

- **Status:** **ACCEPTABLE**
- **Rationale:** `libs/shared` was off-limits for Batch 7 modifications. Locating `parseAgentSessionOpenedPayload` in `agent-session-adoption.service.ts` and exporting it keeps the wire parsing defensive, isolated, and unit-tested without violating cross-batch boundaries.

### (3) `addTabToWorkspace` takes a third argument `afterTabId`

- **Status:** **ACCEPTABLE**
- **Rationale:** Implementation plan line 772 explicitly dictates `order = right after the parent tab`. In a background partition, appending to the end would violate this invariant. Passing `afterTabId` to `insertTabAfter` ensures the child tab is positioned directly adjacent to its parent even when inserted into an inactive workspace partition.

### (4) Banner says "for a limited time" instead of explicit deny window value

- **Status:** **ACCEPTABLE**
- **Rationale:** `AgentSessionOpenedPayload` (`libs/shared/src/lib/types/messages/agent-session.ts:10-30`) does not carry `denyWindowMs`, and configuration settings are backend-resident. Displaying "for a limited time" accurately conveys the unattended policy to the user without hardcoding assumptions or requiring protocol modifications.

### (5) Workspace-switch trigger is a root effect on `activeWorkspacePath$`

- **Status:** **ACCEPTABLE**
- **Rationale:** `WorkspaceCoordinatorService` was outside Batch 7. Installing an Angular root effect on `tabManager.activeWorkspacePath$()` in `AgentSessionAdoptionService.start()` (`app.config.ts:180`) provides a clean reactive trigger for both initial bootstrap and subsequent workspace switches. Double adoption and race conditions with the live push are completely prevented by `TabManagerService.locateTabInPanel` idempotency (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:896`) and `AgentSessionAdoptionService.settled` tracking.

### (6) Adoption result/mode types omitted from `chat-state` index

- **Status:** **DEFECT (MINOR)**
- **Rationale:** While functional within Batch 7, omitting these types from `libs/frontend/chat-state/src/index.ts` forced `agent-session-adoption.service.ts:7-9` to write `Parameters<TabManagerService['adoptAgentSessionTab']>[1]`. Exporting them aligns with repository API design standards.

---

## A2 Ruling

### Question (a): Is an empty late tab until a sidebar click a functional gap?

**YES.**
Plan Assumption A2 (`implementation-plan.md:163-167`) and Component 8 (`:774-777`) specify that a tab adopted late with a known `claudeSessionId` and status `'loaded'` should load its history. In the current implementation:

1. `adoptAgentSessionTab` creates the tab with `status: 'loaded'`, `claudeSessionId`, and `messages: []` (`tab-manager.service.ts:987-995`).
2. Tab bar activation (`TabBarComponent`) only switches the active tab signal (`tabManager.switchTab(tabId)`).
3. The history loading machinery (`SessionLoaderService.switchSession`, `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:597`) is exclusively invoked when a user clicks the session item in the sidebar (`app-shell.component.ts:514-519`).
4. Therefore, after a reload or workspace switch, a user switching to an adopted child tab in the tab bar sees a blank transcript with zero messages, until and unless they happen to find and click the session in the sidebar. This constitutes a functional gap against the requirement that child tabs remain fully usable and present their history.

### Question (b): Does a sidebar click on a LIVE child send `chat:resume` into a still-streaming session, and could that start a second SDK session or break the live stream?

**NO.** Backend analysis confirms there is **ZERO RISK** of starting a second SDK session or breaking the live stream.

- **Frontend guard for live tabs:** When a child is adopted `live`, `hasLiveSession` is set to `true` (`tab-manager.service.ts:987`). When the user clicks the session in the sidebar, `SessionLoaderService.switchSession` checks:
  ```ts
  // session-loader.service.ts:617-624
  if (opts?.reason !== 'compaction' && existingTab?.hasLiveSession) {
    const inActiveWorkspace = this.tabManager.tabs().some((t) => t.id === existingTab.id);
    if (inActiveWorkspace) {
      this.tabManager.switchTab(existingTab.id);
      return { staleSnapshot: false };
    }
  }
  ```
  It immediately switches tabs and returns without dispatching `chat:resume`.
- **Backend safety for late tabs:** When a child was adopted `late` while still streaming, `hasLiveSession` is left `undefined`, so `switchSession` calls `chat:resume` with `{ sessionId, tabId, workspacePath }` (without `activate: true`).
- In `ChatSessionService.resumeChatSession` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:950-1105`):
  1. `chat:resume` reads the transcript JSONL via `historyRead.readForResume(sessionId, ...)` (`:958-962`).
  2. Because `params.activate !== true`, the activation block (`:1051-1085`) is completely bypassed.
  3. No call to `autoResumeIfInactive` occurs.
  4. Even if `activate: true` were passed, line 1052 guards:
     ```ts
     if (!this.hasLiveSessionStream(sessionId, params.tabId))
     ```
     `hasLiveSessionStream` (`:1291-1299`) checks `this.sdkAdapter.isSessionActive(sessionId)` and `this.streamBroadcaster.isStreaming(tabId)`. Since the stream is live, it detects the active stream, sets `activated = true`, and skips session creation.
- **Conclusion:** A sidebar click or programmatic `switchSession` on a streaming session is completely safe. It reads the on-disk transcript and feeds it to `historyReplayer`, which claims an event fence (`:662`) to prevent stream interleaving. Therefore, auto-loading history upon tab activation for late tabs is safe to implement.

---

## Data Flow

1. **Live Push Entry:** `agentSession:opened` message arrives at webview.
2. `ChatMessageHandler.handleMessage` (`chat-message-handler.service.ts:192`) matches `MESSAGE_TYPES.AGENT_SESSION_OPENED`.
3. `parseAgentSessionOpenedPayload` validates shape (`agent-session-adoption.service.ts:22-59`). [OK]
4. `AgentSessionAdoptionService.adopt(payload, 'live')` checks `settled` set (`:146`). [OK]
5. `TabManagerService.adoptAgentSessionTab(payload, 'live')`:
   - Validates `TabId.safeParse` (`tab-manager.service.ts:895`). [OK]
   - Checks idempotency (`locateTabInPanel`) -> returns `'exists'` if present. [OK]
   - Checks parent presence (`locateTabInPanel(payload.parentTabId)`) -> returns `'parent-absent'` if missing. [OK]
   - Constructs tab with `titleOrigin: 'user'`, `status: 'streaming'`, `hasLiveSession: true`, initial user message containing `displayPrompt`, and `agentOrigin` (`:944-988`). [OK]
   - Inserts immediately after parent (`insertTabAfter`) in active `_tabs` or background partition (`addTabToWorkspace`). [OK]
   - Does NOT touch `_activeTabId` (R5 preserved). [OK]
6. **Late Adoption Entry:** Webview bootstraps or workspace switches (`app.config.ts:180` -> `AgentSessionAdoptionService.start`).
7. Effect triggers `adoptLiveChildren(workspaceRoot)` -> RPC `chat:agent-sessions`.
8. Live children descriptors parsed and adopted with mode `'late'` (`:107-138`). [OK]
9. **UI Rendering:**
   - `TabBarComponent` computes `tabTitles` map and renders `<button ... data-test="tab-bar-agent-badge">` before tab item for tabs with `agentOrigin` (`tab-bar.component.ts:69-89`). [OK]
   - Clicking badge calls `tabManager.switchTab(origin.parentTabId)` (`:258-261`). [OK]
   - `ChatViewComponent` detects `resolvedAgentOrigin` and renders `ptah-agent-origin-banner` (`chat-view.component.html:63-71`). [OK]
   - Banner displays parent title, worktree, branch, and "Open parent" button (`agent-origin-banner.component.ts:27-70`). [OK]

---

## Requirements Fulfilment

| Requirement                                       | Status   | Gap                                                                                                      |
| ------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `TabState.agentOrigin` typed and persisted        | COMPLETE | None. Persisted through `tab-persistence.ts` and validated via `restoredAgentOrigin`.                    |
| `adoptAgentSessionTab` idempotency & parent check | COMPLETE | Gated on `parentTabId` in panel; idempotent by `tabId`.                                                  |
| Tab ordering right after parent                   | COMPLETE | Handled via `insertTabAfter` in active and background partitions.                                        |
| Active tab never changes on adoption (R5)         | COMPLETE | `_activeTabId` is never updated during adoption.                                                         |
| Title preserved with `titleOrigin: 'user'`        | COMPLETE | Explicitly set to prevent auto-titling overwrite.                                                        |
| Background partition insertion                    | COMPLETE | `TabWorkspacePartitionService.addTabToWorkspace` implemented and tested.                                 |
| Defensive IPC parsing                             | COMPLETE | Handled in `parseAgentSessionOpenedPayload`; throws contained.                                           |
| Accessible agent badge in tab bar                 | COMPLETE | Real `<button>`, `aria-label`, tooltip, disabled when parent closed.                                     |
| Accessible origin banner in chat view             | COMPLETE | `role="note"`, keyboard reachable "Open parent" action, composer stays enabled.                          |
| Late adoption on reload/workspace switch          | PARTIAL  | Tabs are adopted with status `'loaded'`, but transcript remains blank until explicit sidebar click (A2). |

---

## Edge Cases

| Case                                                | Handled | How                                                                                           | Concern                 |
| --------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| Child opened when parent is in background workspace | YES     | Inserted into background partition via `addTabToWorkspace`, persisted, reverse index updated. | None.                   |
| Child opened when panel does not own parent         | YES     | Returns `'parent-absent'`; no tab created.                                                    | None (conforms to R6).  |
| Child tab closed by user                            | YES     | `AgentSessionAdoptionService.settled` prevents next workspace switch from re-adopting.        | None.                   |
| Parent tab closed after child opened                | YES     | Badge sets `aria-disabled="true"`; banner states parent tab closed and omits button.          | None.                   |
| Webview reloaded mid-stream                         | PARTIAL | Tab restores or adopts late, but transcript is blank until user clicks session in sidebar.    | Addressed in Finding 1. |
| Corrupted `agentOrigin` in localStorage             | YES     | `tab-persistence.ts:204-243` drops malformed origin; tab restores as regular tab.             | None.                   |
| Child tab ID already exists in panel                | YES     | Returns `'exists'`; leaves existing tab state untouched.                                      | None.                   |

---

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH**
- Top risk: Users navigating to late-adopted child tabs after webview reload see blank transcripts until clicking the session in the sidebar.
- What a robust implementation would add:
  1. Auto-loading transcript history via `SessionLoaderService.switchSession` on first activation of a late-adopted tab.
  2. Exporting `AgentSessionAdoptionMode` and `AgentSessionAdoptionResult` from `libs/frontend/chat-state/src/index.ts`.
  3. Adding `// degradation-audit:` markers to error catch blocks in `agent-session-adoption.service.ts`.
