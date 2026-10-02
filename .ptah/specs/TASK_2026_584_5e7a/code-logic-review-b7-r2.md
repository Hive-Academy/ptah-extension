VERDICT: APPROVED
SCORE: 9/10

# Code Logic Review — `TASK_2026_584_5e7a` (Batch 7: Visual Revise Round 1 — Delta Review)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 1        |

Score rationale: 9/10 (exemplary). The executor addressed all 5 defects from `visual-review-b7.md` with idiomatic Angular 22 standalone architecture. In particular, the critical VS Code panel empty-tab defect was fixed cleanly in `requireTargetTab` without destabilizing workspace partitions, the agent badge was successfully moved inside the child tab item using a clean `<ng-content select="[tabItemLeading]">` slot without invalid interactive nesting, the banner was relocated without compromising virtual scroll or scroll anchoring, and contrast tokens were corrected. One moderate resource cleanup gap was identified where Floating UI `autoUpdate` is not explicitly cancelled when an active tooltip's tab is closed while the tooltip is visible.

---

## Verdict on Out-of-List Files

The executor modified three files outside the original Batch 7 list:

1. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`: **APPROVED**
   - Rationale: Required to resolve Visual Review Finding 1. On hosts without an active workspace partition (VS Code webview host), `findTabByIdAcrossWorkspaces` returns `null` because `activeWorkspacePath` is `null`. Checking `this.tabManager.tabs().find((t) => t.id === targetTabId)` first resolves the active tab directly and prevents a false-positive `Compaction reload target ${targetTabId} no longer owns session ${sessionId}` throw, which previously left late-adopted tabs blank.
2. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`: **APPROVED**
   - Rationale: Directly verifies the fix above with a dedicated spec (`loads history into a targeted tab when no workspace partition is active`) testing `activeWorkspacePath === null`.
3. `libs/frontend/chat-ui/src/lib/molecules/session/tab-item.component.ts`: **APPROVED**
   - Rationale: Required to resolve Visual Review Finding 3. Adding `<ng-content select="[tabItemLeading]" />` allows `ptah-tab-bar` to project the agent badge inside the tab element before the title. This preserves the strict dumb/presentational boundary of `chat-ui` without introducing agent domain coupling.

---

## Five Logic Questions

### 1. How does this fail silently?

In `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:235-238`, if a tab is closed or removed while its agent badge tooltip is visible, `visibleBadgeTip` evaluates to `null` and Angular removes `#badgeTooltip` from the DOM. However, `this.badgeTip` remains populated and `this.floatingUI.cleanup()` is never called. Floating UI's `autoUpdate` listeners and ResizeObserver remain active on the detached DOM node until another tooltip is opened or the entire tab bar is destroyed.

### 2. What user action produces unexpected behaviour?

Closing a tab while hovering or focusing on its agent badge leaves the detached tooltip observer active in memory until the next badge interaction.

### 3. What input data produces a wrong answer?

None found. In `tailPath()` (`tab-bar.component.ts:49-53`), paths with both POSIX (`/`) and Windows (`\`) separators are safely normalized via regex split `/[\\/]/` and truncated to the last 2 segments.

### 4. What happens when a dependency fails?

- If `switchSession` fails during late-adoption history load, `agent-session-adoption.service.ts:184-187` catches the error, logs a degradation audit warning, and clears `this.historyRequested.delete(tabId)` allowing a clean retry on subsequent re-activation.
- If `claudeRpcService.call('chat:resume')` fails or times out, `SessionLoaderService` handles the failure without corrupting tab messages or active state.

### 5. What is missing that the requirements never mentioned?

Explicit cleanup hook for Floating UI `autoUpdate` when an open tooltip's associated tab is closed or unmounted from `tabs()`.

---

## Detailed Analyses of Focused Areas

### 1. `requireTargetTab` Active-Set Fallback (`session-loader.service.ts:822-835`)

- **Can checking the active set first pick the wrong tab?**
  No. Lookup is keyed by `targetTabId: TabId`. Tab IDs are unique identifiers generated per tab instance. If `this.tabManager.tabs().find((t) => t.id === targetTabId)` matches, it is guaranteed to be the exact tab requested.
- **Can it match a tab with the same session in another workspace?**
  No. Tab IDs are globally unique, and line 829-835 explicitly validates:
  `const ownsDifferentSession = target?.claudeSessionId != null && target.claudeSessionId !== sessionId;`
  throwing if session ownership diverges.
- **Does the compaction-reload caller retain expected behavior?**
  Yes. Compaction reload passes `{ targetTabId, reason: 'compaction' }`. Since the compaction target is the active tab, checking `tabs()` first locates it immediately, eliminating the previous failure in VS Code webview hosts where `activeWorkspacePath` was `null`.

### 2. Tooltip Lifecycle & Escape Handling (`tab-bar.component.ts`)

- **Component Destroy:** `FloatingUIService` is provided at component level (`providers: [FloatingUIService]`). Its internal `DestroyRef.onDestroy` handler automatically sets `isDestroyed = true` and invokes `cleanup()`.
- **Keyboard Escape:** `(keydown.escape)="hideBadgeTip()"` on the badge button calls `this.hideBadgeTip()`. Crucially, it does NOT invoke `event.stopPropagation()` or `event.stopImmediatePropagation()`. Escape events bubble normally, ensuring modal and app-shell escape handlers are not swallowed.
- **Tab Removal:** Computed `visibleBadgeTip` drops the tooltip from DOM, but Floating UI's `autoUpdate` is not cancelled (documented in Moderate Issues).

### 3. Badge Inside Tab Item & Accessibility (`tab-item.component.ts` & `tab-bar.component.ts`)

- **Keyboard Activation:** The agent badge is a native `<button tabItemLeading type="button">`. When focused with keyboard, pressing Enter or Space triggers the native browser `click` event on that button. Handler `onAgentBadge(event: Event, parentTabId: string)` executes `event.stopPropagation()`. This prevents the `click` event from bubbling to the outer `<div (click)="tabSelect.emit(tab().id)">`, ensuring that activating the badge opens the parent without selecting the child tab.
- **Interactive Nesting:** In `tab-item.component.ts:38-43`, the outer element is a `<div>` with `(click)`. In HTML/ARIA specifications, placing a `<button>` inside a `<div>` is syntactically valid and does not violate the interactive content nesting prohibition (e.g. `<button>` inside `<button>` or `<button>` inside `<a>`).

### 4. Banner Placement & Virtual Scroll (`chat-view.component.html:61-78`)

- The transcript scroll container is `div.chat-scroll-container` internal to `ptah-chat-transcript`.
- The banner is placed as a sibling above `ptah-chat-transcript` within the outer flex container (`flex-1 flex flex-col min-h-0 relative`).
- With `flex-shrink-0` on the banner and `flex-1 min-h-0` on `ptah-chat-transcript`, the banner does not alter `#messageContainer` dimensions, break `ptahTranscriptPrependAnchor` scroll anchoring, interfere with `TranscriptRenderWindow` slot observation, or disrupt "scroll to bottom" behavior.
- Multi-tab rendering: `resolvedAgentOrigin` is computed reactively from `this.resolvedActiveTab()?.agentOrigin`. Switching tabs dynamically updates or unmounts the banner per tab.

### 5. Point 6: Duplicate `chat:resume`

- The executor is **CORRECT**.
- `SessionLoaderService.refreshResumableSubagentsForSession` (`session-loader.service.ts:1276-1347`) calls `chat:resume` solely to populate `resumableSubagents` and restore CLI session cards for a restored session (`without reloading the tab's messages`). It does not invoke `historyReplayer.replay()` and never mutates `tab.messages`.
- `SessionLoaderService.switchSession` (via `AgentSessionAdoptionService.loadAgentHistory`) is the sole caller that replays history and writes messages to the tab.
- Furthermore, `refreshResumableSubagentsForSession` is guarded by `restoredSessionChecked` and fires only once per webview lifetime. There is no message overwriting or race condition.

---

## Failure Modes

### FM-1: Floating UI autoUpdate leak on tab removal

- Trigger: User focuses or hovers the agent badge of an adopted tab (showing the Floating UI tooltip), and that tab is closed or removed while the tooltip is visible.
- Symptom: `#badgeTooltip` element is removed from DOM by `@if (visibleBadgeTip())`, but `FloatingUIService.cleanup()` is not called and `badgeTip` signal remains populated. Floating UI's `autoUpdate` event listeners and ResizeObserver remain active in memory.
- Evidence: `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:235-238,350-354`
- Current handling: `visibleBadgeTip` computes to `null`, but `hideBadgeTip()` is only called on `(mouseleave)`, `(blur)`, `(keydown.escape)`, or click.
- Recommendation: Add an effect or tap in `tabManager.closeTab` / `visibleBadgeTip` to call `this.floatingUI.cleanup()` when the active tip's tab is no longer in `tabs()`.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

### [MODERATE] Missing Floating UI cleanup on tab removal

- File: `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts:235-238`
- Scenario: An adopted tab with an active badge tooltip is closed via keyboard or external event without triggering `mouseleave` or `blur`.
- Impact: Unneeded `autoUpdate` callback executions on scroll/resize until next tooltip show or component destruction.
- Fix: In `TabBarComponent`, add an effect monitoring `visibleBadgeTip()`: if `this.badgeTip() !== null && this.visibleBadgeTip() === null`, invoke `this.hideBadgeTip()`.

---

## Data Flow

1. **Host Init / Tab Adoption:** `AgentSessionAdoptionService` discovers late-adopted child tabs with `messages: []` and registers origin metadata. [OK]
2. **Tab Activation:** User selects late-adopted tab. Root effect in `AgentSessionAdoptionService` triggers `sessionLoader.switchSession(sessionId, { targetTabId })`. [OK]
3. **Target Resolution:** `SessionLoaderService.requireTargetTab` checks active set `tabManager.tabs()` first, finding the tab even when `activeWorkspacePath === null`. [OK]
4. **History Replay:** `SessionLoaderService` calls `chat:resume` without `activate: true`, replays events through `historyReplayer.replay()`, and populates `tab.messages`. [OK]
5. **Badge & Tooltip Rendering:** `TabBarComponent` projects `<button tabItemLeading>` inside `ptah-tab-item`. Clicking badge invokes `stopPropagation()` and switches to parent tab without selecting child. [OK]
6. **Banner Display:** `chat-view.component.html` renders `<ptah-agent-origin-banner>` above transcript; policy text collapses under `<details>` on narrow viewports; no layout shift on transcript container. [OK]

---

## Requirements Fulfilment

| Requirement                                    | Status   | Gap                                                           |
| ---------------------------------------------- | -------- | ------------------------------------------------------------- |
| VF-1: Late-adopted tab empty screen fix        | COMPLETE | None; verified with null workspace path spec                  |
| VF-2: Light theme badge contrast & tokens      | COMPLETE | Uses `text-base-content`, `border-info`, gold focus ring      |
| VF-3: Badge position inside child tab          | COMPLETE | Projected via `<ng-content select="[tabItemLeading]">`        |
| VF-4: "Parent gone" badge appearance & tooltip | COMPLETE | Dims with `opacity-60`, `cursor-default`, Floating UI tooltip |
| VF-5: Banner duplication & disclosure          | COMPLETE | Heading deduplicated, responsive `<details>` disclosure       |
| VF-6: Duplicate `chat:resume` audit            | COMPLETE | Verified harmless; only B7 call writes messages               |

Implicit requirements not addressed: None.

---

## Edge Cases

| Case                                     | Handled | How                                                                                               | Concern         |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- | --------------- |
| Host with `activeWorkspacePath === null` | YES     | `requireTargetTab` checks `tabManager.tabs()` before partition lookup                             | None            |
| Parent tab closed                        | YES     | Badge dims to `opacity-60`, `cursor-default`, tooltip shows "(parent tab closed)", click is no-op | None            |
| Enter/Space pressed on badge             | YES     | `click` event fired with `stopPropagation()`, switches parent without selecting child             | None            |
| Escape pressed while tooltip open        | YES     | `(keydown.escape)` calls `hideBadgeTip()` without swallowing bubbling Escape                      | None            |
| Tab closed while tooltip open            | PARTIAL | Tooltip removed from DOM via signal, but `autoUpdate` not explicitly cleaned up                   | FM-1 (Moderate) |
| Narrow viewports (< sm)                  | YES     | Banner policy collapsed behind `<details>`, inline on sm+                                         | None            |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: None on critical path; minimal resource leak on edge-case tab closure while hovering badge.
- What a robust implementation would add:
  1. An effect in `TabBarComponent` calling `this.hideBadgeTip()` if `this.badgeTip()` is set but the tab is no longer present in `tabs()`.
