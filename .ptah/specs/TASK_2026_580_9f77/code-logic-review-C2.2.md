VERDICT: APPROVED

Score: 10/10

Counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 0

---

### Scope & Review Context

Batch C2.2 implements the frontend task session links service and task board card linked-sessions row (TASK_2026_580, AC2/C.3):

- Single `session:listForTasks` RPC query for all board cards.
- Reactive signals integration with Angular 22 `OnPush` components.
- Push notification handling (`session:organizationChanged`, `session:turnEnded`, `session:turnFailed`).
- WCAG 1.4.1 non-color reliance, WCAG 2.5.8 target sizing, sanitized PR URLs, and roving keyboard tab order.
- Scope extension: `services.ts` barrel export and `app.config.ts` multi-provider registration for `MESSAGE_HANDLERS`.

Reviewed files:

1. `libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts` (NEW)
2. `libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts` (NEW)
3. `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts` (MODIFIED)
4. `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts` (MODIFIED)
5. `libs/frontend/tasks-ui/src/services.ts` (MODIFIED)
6. `apps/ptah-extension-webview/src/app/app.config.ts` (MODIFIED)

---

### Verification Summary

1. **Nx Target Verification**:
   - `npx nx run-many -t typecheck,test,lint -p @ptah-extension/tasks-ui ptah-extension-webview`: PASSED (6/6 tasks succeeded).
   - `@ptah-extension/tasks-ui:test`: 635 passed tests across all suites, including all new service and card specs.
2. **Architecture & Dependency Injection**:
   - `npx nx run di-lint:lint`: PASSED (1637 `@inject` sites valid; all container-constructed classes verified).
3. **Formatting & Code Style**:
   - `npx prettier --check` on all 6 batch files: PASSED clean.
   - Standalone Angular components, signals (`signal`, `computed`, `input`, `asReadonly`), and `ChangeDetectionStrategy.OnPush` strictly maintained. No `innerHTML` used.

---

### Detailed Code-Logic Analysis

#### 1. Lifecycle & Reference-Counted Consumer Tracking

- **Reference Counting** ([`task-session-links.service.ts:110-118`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L110-L118)):
  - `retain(): () => void` increments `consumers`. The first consumer (`consumers === 1`) triggers `load()`.
  - The returned release callback uses an idempotent boolean guard (`released`) and decrements safely with `Math.max(0, this.consumers - 1)`.
  - In [`task-card.component.ts:729-731`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L729-L731), `TaskCardComponent` wires cleanup via `inject(DestroyRef).onDestroy(this.sessionLinks.retain())`.
  - No memory leaks or negative counter drifts occur. When all cards unmount, consumers reach 0; when a board mounts again, the 0 → 1 transition refetches fresh data.
  - Verified by tests: `fetches once for the board when the first consumer mounts, never per card` and `refetches on the next board load after every consumer left` ([`task-session-links.service.spec.ts:93-114`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L93-L114)).

#### 2. Trigger Coalescing & Race Condition Prevention

- **In-Flight Coalescing** ([`task-session-links.service.ts:153-168`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L153-L168)):
  - Managed via `inFlight: boolean` and `reloadQueued: boolean` in a `do { this.reloadQueued = false; await this.fetchOnce(); } while (this.reloadQueued && this.consumers > 0)` loop, wrapped in `try ... finally { this.inFlight = false; this.reloadQueued = false; }`.
  - Any push or mount arriving while a fetch is underway sets `reloadQueued = true` and returns immediately. Exactly one subsequent fetch runs once the in-flight operation finishes.
  - Verified in `coalesces pushes that land during a fetch into one more fetch` ([`task-session-links.service.spec.ts:158-176`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L158-L176)).
- **Stale Workspace Answers** ([`task-session-links.service.ts:171, 197-200`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L171-L200)):
  - `workspacePath` is captured prior to the asynchronous RPC call.
  - Post-fetch guard: `if (this.appState.workspaceInfo()?.path !== workspacePath) return;`. Stale responses from a previous workspace are discarded and cannot overwrite the newly active workspace state.
  - Switching workspaces triggers `onWorkspaceChange(path)` ([`task-session-links.service.ts:134-139`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L134-L139)), which immediately resets `_links` to `EMPTY_MAP` before queueing a load.
  - Verified in `clears and refetches for the new workspace on a switch` and `discards an answer for a workspace that is no longer active` ([`task-session-links.service.spec.ts:244-278`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L244-L278)).

#### 3. Push Message Routing & Webview Integration

- **`MESSAGE_HANDLERS` Multi-Provider** ([`apps/ptah-extension-webview/src/app/app.config.ts:83-86, 209-213`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-extension-webview/src/app/app.config.ts#L83-L213)):
  - Registered as `{ provide: MESSAGE_HANDLERS, useExisting: TaskSessionLinksService, multi: true }` alongside `TasksStore`.
  - Exported through secondary entry point [`libs/frontend/tasks-ui/src/services.ts:25-28`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/services.ts#L25-L28) preventing cross-lib deep imports and respecting module boundaries.
- **Push Handling Filtering** ([`task-session-links.service.ts:72-76, 121-132`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L72-L132)):
  - Handles `session:organizationChanged`, `session:turnEnded`, and `session:turnFailed`.
  - Pushes arriving when `consumers === 0` are dropped (next card mount fetches).
  - Verified in `registers for the three pushes it reloads on` and `ignores pushes while no board is mounted` ([`task-session-links.service.spec.ts:77-84, 135-143`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L77-L143)).

#### 4. Defensive Parsing & Failure Resilience

- **Unsupported Hosts & Call Failures** ([`task-session-links.service.ts:177-195, 221-224`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L177-L224)):
  - Hosts lacking the store (VS Code) return `{ available: false }`; `toLinkMap` produces `EMPTY_MAP` without logging errors.
  - Network/RPC failure or rejected calls log exactly once to `console.error` and yield `EMPTY_MAP`.
  - Verified in `gives an empty map when the host has no organization store (VS Code)` and `empties the map and logs one error when the call fails` ([`task-session-links.service.spec.ts:178-210`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L178-L210)).
- **Item-by-Item Validation** ([`task-session-links.service.ts:226-256`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L226-L256)):
  - Validates `sessionId` and `name` strings, and constrains `livePhase` to `TURN_PHASES` (`'generating'`, `'awaiting-background'`, `'sleeping'`, `'idle'`, `'failed'`) or `null`.
  - PR links are filtered to objects containing valid `url: string`.
  - Malformed entries are filtered individually without failing unaffected tasks or crashing the board.
  - Verified in `drops malformed entries instead of failing the board` ([`task-session-links.service.spec.ts:212-234`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L212-L234)).

#### 5. Task Card Accessibility & Interaction Soundness

- **DOM Absence on Empty State** ([`task-card.component.ts:443`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L443)):
  - `@if (sessions().length > 0)` guarantees no container or margin artifact is rendered when a task has no linked sessions.
  - Verified in `renders no sessions row when the task has no linked session (or the host is unavailable)` ([`task-card.component.spec.ts:863-866`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts#L863-L866)).
- **WCAG 1.4.1 Color Independence** ([`task-card.component.ts:448-486, 755-773`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L448-L773)):
  - Colored phase dots are `aria-hidden="true"`.
  - Count (`{{ sessionCountLabel() }}`) and active phase (`· {{ firstSessionPhase() }}`) are rendered as plain text.
  - `role="note"` provides comprehensive accessible naming via `[attr.aria-label]="sessionsSummary()"` describing each linked session and its phase in text (e.g. `3 linked sessions: Board start, running; Review, idle; Untitled session, not open`).
  - Verified in `shows the count, one dot per session and the first phase in words` ([`task-card.component.spec.ts:875-917`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts#L875-L917)).
- **PR URL Sanitization & Link Protection** ([`task-card.component.ts:103, 490-508, 776-793`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L103-L793)):
  - Strict regex `HTTP_URL = /^https?:\/\//i` blocks non-http schemes (e.g. `javascript:`, `file:`).
  - Link has `target="_blank" rel="noopener noreferrer"`.
  - Target size complies with SC 2.5.8 (`min-h-6 min-w-6 px-1`).
  - Keyboard roving tab stop is preserved: `[attr.tabindex]="rovingTabIndex()"`.
- **Card Selection & Keyboard Isolation**:
  - Mouse click on PR link stops propagation: `(click)="$event.stopPropagation()"` ([`task-card.component.ts:500`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L500)).
  - Keyboard activation on descendant elements does not trigger card opening or toggling because `onCardEnter` and `onCardSpace` explicitly guard `if (event.target !== event.currentTarget) return;` ([`task-card.component.ts:1076, 1083`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L1076-L1083)).
  - Verified in `links the first http(s) PR in session order, without opening the card` and `keeps the PR link out of the tab order on a non-roving card` ([`task-card.component.spec.ts:932-965, 209-212`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts#L932-L965)).

---

### Deviations Assessment

1. **Load Triggered by First Card Mount (Reference Counting)**:
   - _Plan context_: §12 stated "calls `session:listForTasks` for the active workspace when the board loads", but did not define a board coordinator.
   - _Judgment_: **APPROVED**. Reference counting via `retain()` inside `TaskCardComponent` avoids hard coupling to route transitions or container components, completely de-duplicates fetching across multiple cards, and automatically sleeps when navigating away from the board.
2. **Turn Pushes Skipped for Unlinked Sessions**:
   - _Implementation_: `SESSION_TURN_PUSHES` (`session:turnEnded`, `session:turnFailed`) verify `isLinkedSession(sessionId)` before triggering `load()`. If `sessionId` is missing (`null`), it safely defaults to refetching.
   - _Judgment_: **APPROVED**. Chat turns complete frequently in workspaces with concurrent agents. Filtering out turn settles for sessions not attached to any task card prevents wasteful round-trips and layout recalcs, while `session:organizationChanged` remains unconditional.

---

### Finding Log

- **Blocking**: 0
- **Serious**: 0
- **Moderate**: 0
- **Minor**: 0

The implementation is robust, adheres to all architectural constraints and Angular 22 / WCAG guidelines, and is ready to merge.
