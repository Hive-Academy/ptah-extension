# Code Logic Review — TASK_2026_404_6fcd

## Verdict

REJECT — 58/100

While the component structure, styling boundaries, and isolated unit tests pass, critical defects prevent cross-workspace notification focus from opening the chat view, cause healthy idle sessions to be flagged as errors, and permanently silence notification audio after browser auto-suspension. Furthermore, Mojibake encoding errors corrupt status icons in the compact card, and signal coalescing drops completion pulses during concurrent turn completions.

## Findings

1. **Focus transaction sets view on the wrong workspace before switching**
   - **Severity**: CRITICAL
   - **Location**: `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.ts:39-41`
   - **Failure Scenario**: `NotificationFocusCoordinator.run(target)` calls `this.appState.setCurrentView('chat')` and `this.appState.setLayoutMode('grid')` _before_ calling `await this.workspaceCoordinator.switchWorkspace(target.workspacePath)`. `AppStateManager.setCurrentView()` delegates to `openViewInActiveSlice()`, which updates only the view slice of `this._activeWorkspacePath()` (the workspace the user is currently looking at when clicking the bell). When `switchWorkspace()` subsequently switches to the target workspace, the target workspace restores whatever `currentView` it previously had saved (e.g. `'thoth'`, `'marketplace'`, or `'tasks'`). Consequently, the target workspace is never switched to `'chat'`, `OrchestraCanvasComponent` remains unmounted, `this.appState.requestCanvasFocus()` hangs and times out after 5,000ms, and the transaction resolves to `{ success: false, outcome: 'missing' }`, leaving the notification unread.
   - **Fix**: Move `this.appState.setCurrentView('chat')` and `this.appState.setLayoutMode('grid')` to execute _after_ `await this.workspaceCoordinator.switchWorkspace(target.workspacePath)`.

2. **`terminalStatus` classifies null terminalReason as error**
   - **Severity**: CRITICAL
   - **Location**: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts:441`
   - **Failure Scenario**: In `terminalStatus(reason)`, the guard checks only `if (reason === undefined) return null;`. When a session is idle, loaded, or freshly reset, its `terminalReason` is `null` (`TabState.lastTerminalReason` and `SessionTurnState.terminalReason` are typed `SdkTerminalReason | null | undefined`). In JavaScript, `null !== undefined`, so passing `null` skips all valid checks (`completed`, `aborted_*`, `blocking_limit`) and falls through to line 454: `return { text: 'Needs attention', icon: '!', tone: 'error' };`. This causes `selectStatus()` at line 424 to return an error tone and "Needs attention" status text for every healthy, ordinary idle session, completely bypassing the `'Idle'` / `'Ready'` / `'Draft'` branches (lines 428-435).
   - **Fix**: Change line 441 to `if (reason == null) return null;` so both `null` and `undefined` cleanly return `null`.

3. **AudioContext permanently silenced on auto-suspend due to premature gesture listener removal**
   - **Severity**: MAJOR
   - **Location**: `libs/frontend/notification-center/src/lib/notification-sound.service.ts:28-29,69`
   - **Failure Scenario**: The constructor removes both `pointerdown` and `keydown` window event listeners immediately upon observing the first trusted user gesture, setting `this.gestureObserved = true`. In `playBurst()`, line 69 returns `false` if `context.state !== 'running'`. Chromium automatically transitions idle or background `AudioContext` instances to `'suspended'` after brief periods of inactivity to save power. When an agent finishes a turn minutes later, `context.state` is `'suspended'`. Because `playBurst()` does not attempt `context.resume()` and all gesture listeners were permanently removed, notification audio fails silently for all subsequent completions for the remainder of the application lifecycle.
   - **Fix**: In `playBurst()`, attempt `context.resume()` if `context.state === 'suspended'`; or re-attach the gesture listener when `context.onstatechange` signals suspension so the next user interaction resumes the context.

4. **Single-value signal drops intermediate completion pulses under concurrency**
   - **Severity**: MAJOR
   - **Location**: `libs/frontend/chat-state/src/lib/tab-manager.service.ts:167,1285` and `libs/frontend/notification-center/src/lib/notification-center.store.ts:77`
   - **Failure Scenario**: `TabManagerService` publishes completions using a single-value Signal: `private readonly _terminalTurnPulse = signal<TerminalTurnPulse | null>(null);`. When multiple tabs or background tasks finish turns within the same event loop tick or synchronous batch (e.g. concurrent background agents or batch turn finalization), `applyTurnState()` calls `_terminalTurnPulse.set()` in rapid succession. Because Angular signals represent state rather than discrete event streams and signal effects are coalesced asynchronously, intermediate pulse values are overwritten before `NotificationCenterStore`'s `effect()` can observe them. All intermediate completions are silently dropped, violating Acceptance Criterion 9 and 11.
   - **Fix**: Buffer terminal turn pulses in an append-only queue signal (`signal<readonly TerminalTurnPulse[]>([])` with a drain method, mirroring `canvasFocusRequests` in `AppStateManager`), or emit through an RxJS `Subject` that ensures every pulse reaches subscribers.

5. **Initial resolve check blocks reopening sessions whose tabs were closed**
   - **Severity**: MAJOR
   - **Location**: `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.ts:36-37,74-82`
   - **Failure Scenario**: At line 36 of `NotificationFocusCoordinator.run()`, `const initial = this.resolve(target); if (!initial) return { success: false, outcome: 'missing' };` aborts the transaction before any navigation begins. `resolve(target)` only checks `TabManagerService.findTabByIdAcrossWorkspaces` and `findTabBySessionIdAcrossWorkspaces`, which only search open tabs. If a background session completed and the user subsequently closed the tab, `resolve(target)` returns `null`. This early exit prevents execution from reaching `OrchestraCanvasComponent.processFocusRequest()` (which explicitly contains logic to reopen closed sessions via `addTileFromSession`, lines 506-517) and prevents `run()`'s own single-view fallback (`openSessionTab`, lines 57-63).
   - **Fix**: Check `chatStore.sessions()` when `resolve(target)` returns `null`, and allow targets with a valid `sessionId` to proceed to the canvas request.

6. **Mojibake UTF-8 encoding corruption in compact summary and stats**
   - **Severity**: MAJOR
   - **Location**: `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts:411,419,421,422,427,431,435,443,445` and `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.ts:54`
   - **Failure Scenario**: Source files were authored or saved using an ANSI/Windows-1252 editor encoding that misinterpreted multibyte UTF-8 characters, embedding literal corrupted character strings directly into source code:
     - `'â†»'` instead of `↪` (`\u219B`) for Compacting
     - `'â—†'` instead of `◆` (`\u25C6`) for Running agent
     - `'âš™'` instead of `⚙` (`\u2699`) for Using tools
     - `'â€¢'` instead of `•` (`\u2022`) for Responding
     - `'Ã—'` instead of `×` (`\u00D7`) for Failed
     - `'â—‹'` instead of `○` (`\u25CB`) for Idle/Ready
     - `'âœ“'` instead of `✓` (`\u2713`) for Finished
     - `'â– '` instead of `■` (`\u25A0`) for Stopped
     - `'Cost â€”'` instead of `Cost —` (`\u2014`) for empty cost
       Users see corrupted text glyphs in the status line and metrics footer.
   - **Fix**: Replace all corrupted character literals with their standard Unicode escape sequences (e.g. `'\u219B'`, `'\u25C6'`, `'\u2699'`, `'\u2022'`, `'\u00D7'`, `'\u25CB'`, `'\u2713'`, `'\u25A0'`, `'\u2014'`).

7. **Notification panel does not close on row activation and lacks click-outside dismissal**
   - **Severity**: MINOR
   - **Location**: `libs/frontend/notification-center/src/lib/notification-center.component.ts:252-258`
   - **Failure Scenario**: In `NotificationCenterComponent`, `activateCompletion()` and `activatePrompt()` invoke focus routing but never call `this.close(false)`. Furthermore, the panel has neither a backdrop nor a document click listener. When a user clicks a notification to view a tile or respond to a prompt, focus moves to the canvas underneath, but the notification panel remains open at `z-50`, continuing to obstruct the top-right portion of the canvas until the user manually hits Escape or clicks the bell icon again.
   - **Fix**: Call `this.close(false)` inside `activateCompletion` and `activatePrompt`, and add a click-outside directive or `@HostListener('document:click')`.

8. **`dismissCompletion` is dead code unexposed to user**
   - **Severity**: MINOR
   - **Location**: `libs/frontend/notification-center/src/lib/notification-center.component.ts:104-127` and `libs/frontend/notification-center/src/lib/notification-center.store.ts:108-114`
   - **Failure Scenario**: `NotificationCenterStore` defines `dismissCompletion(id: string)`, and filters `!entry.dismissed` in `unreadCount` and `groupCompletions`. However, `NotificationCenterComponent` template does not render any dismiss/close action button on completion rows. Completed notifications can only be marked read, never dismissed individually.
   - **Fix**: Render a dismiss action button (e.g. an 'X' icon button) on each notification row or remove the unused dismissal plumbing.

## Known gaps — my judgment

1. **No test covers Enter and Space activation on the notification rows.**
   - **Judgment**: ACCEPTABLE
   - **Reason**: Notification rows are native HTML `<button type="button">` elements with standard Angular `(click)` event bindings (`notification-center.component.ts:105,140`). Per the W3C HTML5 specification and browser implementations, native `<button>` elements dispatch `click` events upon receiving Enter and Space keypresses without requiring custom JavaScript keyboard handlers. While the omission in unit test coverage is real, the runtime behavioral contract is natively satisfied by the browser.

2. **No test covers a reduced-motion fallback.**
   - **Judgment**: ACCEPTABLE
   - **Reason**: `compact-session-activity.component.spec.ts:80-91` explicitly verifies the presence of the `motion-reduce:transition-none` class in the template. In `NotificationCenterComponent`, reduced motion is implemented via standard CSS `@media (prefers-reduced-motion: reduce)` in the component `styles` block (`notification-center.component.ts:194-201`). Testing CSS media queries inside Jest/jsdom is unviable because jsdom does not evaluate CSS rules or layout styles. The implementation is present, standards-compliant, and functional.

3. **The exact unread-count semantics are not pinned by any test.**
   - **Judgment**: REAL DEFECT
   - **Reason**: `NotificationCenterStore.unreadCount` has zero direct assertions in `notification-center.store.spec.ts`. This unpinned state conceals multiple real behavioral discrepancies:
     - Unresolvable prompts (`target === null`, "Target unavailable") are rendered in the panel but excluded from `unreadCount` (`entry.target !== null`, line 65), causing visual disagreement between the badge count and the list.
     - Multi-tab prompt fan-out (`projectPrompt` returning multiple entries) causes a single pending question to be counted multiple times in the unread count badge.
     - `dismissCompletion` decrements `unreadCount`, yet dismissal is completely unreachable from the UI.

4. **Two host-level items that no unit test can settle: whether the notification panel is actually mounted in a host application, and whether any audio asset file ships.**
   - **Judgment**: ACCEPTABLE
   - **Reason**: Both host applications explicitly mount `<ptah-notification-center />` in their primary templates: VS Code webview via `app-shell.component.html:668` under `@if (!isElectron)`, and Electron via `electron-shell.component.ts:226` in the global action header. These composition points are guarded by architectural regression tests (`app-shell.notification-center.spec.ts` and `electron-shell.notification-center.spec.ts`). The absence of an audio asset file is an intentional, documented architectural choice: synthesized Web Audio API envelopes avoid CSP `media-src` restrictions and packaging bloat.

## What I verified and found correct

- **Fixed-height, zero-scroll compact card contract**: Verified `CompactSessionCardComponent`, `CompactSessionActivityComponent`, and `CompactSessionStatsComponent`. Roots use `h-full min-h-0 overflow-hidden`, content is bounded with `line-clamp-2`, and all horizontal scrolling (`overflow-x-auto`) has been removed from session stats.
- **Reactive prompt routing without state duplication**: Verified that `PermissionHandlerService` cleanly invalidates `routingTargetRevision` across all target attachments (`attachPromptTargets`, `attachQuestionTargets`) and cleanup paths (`clearQuestionTargets`, `cancelPrompt`, `cancelQuestion`, `dropQuestionRequest`, `handlePermissionResponse`, `handleQuestionResponse`, `cleanupSession`, and expired question timeouts).
- **Prompt content precedence**: Verified `selectContent()` in `compact-session-summary.ts` enforces the exact requested priority: oldest question → oldest permission → newest error → newest assistant prose → newest tool result → compaction summary → idle.
- **Ledger deduplication and cap**: Verified `NotificationCenterStore.appendCompletion()` enforces deduplication by `${pulse.sessionId}:${pulse.revision}` and caps total completion history at 75 entries.
- **Audio burst coalescing and cooldown**: Verified `NotificationSoundService` limits oscillator playback to one envelope per 350ms aggregated burst and enforces a strict 2,000ms cooldown window. Mute preference correctly reads and writes from `localStorage` under `ptah:notification-center:sound-muted:v1` with try/catch fallback.
- **Accessible ARIA implementation**: Verified `NotificationCenterComponent` uses a native `<button>` with exact count in `aria-label`, visual `9+` badge, `aria-haspopup="dialog"`, `aria-expanded`, focus restoration to the bell on Escape, and an isolated `role="status"` `aria-live="polite"` live region.

### Five Logic Questions

1. **How does this fail silently?**
   - When Chromium auto-suspends an idle `AudioContext`, `NotificationSoundService.playBurst()` returns `false` silently on line 69. Because gesture listeners were permanently detached after the first click, sound is permanently killed without error or recovery.
   - When concurrent completions arrive, `_terminalTurnPulse` signal overwrites earlier values in the same tick, silently losing completion records.
2. **What user action produces unexpected behaviour?**
   - Clicking a notification for a background workspace when that workspace was previously left on 'thoth' or 'marketplace': the workspace switches, but the view remains on Thoth/Marketplace. The canvas is not visible, the focus request times out after 5 seconds, and the notification is not marked read.
   - Clicking on a completed notification whose tab was closed: the user receives a silent failure (`outcome: 'missing'`), even though the session exists and the canvas store possesses the logic to re-open it.
   - Clicking any notification in the panel navigates in the background, but leaves the panel open on screen obscuring the view.
3. **What input data produces a wrong answer?**
   - A tab with `terminalReason: null` causes `terminalStatus(null)` to return `{ text: 'Needs attention', tone: 'error' }`, incorrectly styling healthy idle sessions as errors.
4. **What happens when a dependency fails?**
   - If `AppStateManager.requestCanvasFocus` is not consumed (e.g. canvas unmounted), the 5,000ms timeout safely recovers, resolving `{ success: false, outcome: 'missing' }`, and `activateCompletion` leaves the notification unread rather than corrupting state.
   - If `localStorage` throws, `NotificationSoundService` and `NotificationCenterStore` cleanly catch and fall back to in-memory defaults.
5. **What is missing that the requirements never mentioned?**
   - Closing the notification panel upon row activation or on outside click.
   - Handling multi-tab target fan-out in the unread count calculation.
