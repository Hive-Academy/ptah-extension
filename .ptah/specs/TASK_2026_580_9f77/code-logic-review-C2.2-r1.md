VERDICT: APPROVED

Score: 10/10

Counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 0

---

### Scope & Review Context

Round-1 code-logic review of uncommitted batch C2.2 revisions (TASK_2026_580, AC2/C.3), addressing layout shift and accessibility findings raised in visual review round 0:

- **Eager Surface-Scoped Fetch**: Pre-fetching `session:listForTasks` when the Tasks surface opens in parallel with `tasks:board` rather than waiting for individual cards to mount, eliminating card expansion layout shift on initial board loads.
- **Cache Persistence & Background Refetch**: Retaining the session links map across view switches to show cached rows immediately upon return, while triggering a background refresh.
- **Staleness & Race Condition Guards**: Immediate synchronous cache clearing on workspace switch, discarding out-of-date workspace responses, serializing requests to eliminate out-of-order race conditions, and handling push updates (`session:organizationChanged`) even when zero cards are mounted.
- **Card-Mount De-duplication**: Suppressing redundant RPC fetches when cards mount, unmount, and remount within a single visit (e.g. during column/filter toggling).
- **Two-Line Responsive Template & WCAG Enhancements**:
  - Line 1: MessagesSquare icon, up to 5 phase dots, optional `+N` marker with descriptive `aria-label`/`title`, and count label.
  - Line 2: All active phases spelled out in words with `flex-wrap` (addressing WCAG 1.4.1 fallback truncation), sorted with `failed` first.
  - 10px dots equipped with a 1px `border-base-content/70` ring ensuring ≥ 3:1 non-text contrast (WCAG 1.4.11) across dark and light themes, with `bg-transparent` distinguishing "not open" by shape.
- **Timing & Behavior Verification**: Comprehensive unit and integration specs covering all surface lifecycle and timing assertions.

Files reviewed:

1. [`libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts)
2. [`libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts)
3. [`libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts)
4. [`libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts)
5. [`libs/frontend/tasks-ui/src/services.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/services.ts)
6. [`apps/ptah-extension-webview/src/app/app.config.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/apps/ptah-extension-webview/src/app/app.config.ts)

---

### Verification Summary

1. **Nx Verification Target**:
   - `npx nx run-many -t typecheck,test,lint -p @ptah-extension/tasks-ui ptah-extension-webview`: **PASSED** (6/6 targets succeeded).
   - `@ptah-extension/tasks-ui`: 642 tests passing across 14 test suites with 0 failures.
   - `ptah-extension-webview`: 18 tests passing across 2 test suites with 0 failures.
2. **Lint & Formatting**:
   - All files pass TypeScript strict checking, ESLint rules, and module boundaries.
   - Clean DI usage; standalone Angular 22 signals and `OnPush` components preserved.

---

### Scrutiny of Round-1 Behavioural Changes

#### 1. Surface Visit Detection & View Leakage Prevention

- **View Detection Mechanism** ([`task-session-links.service.ts:100-109, 152-168`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L100-L168)):
  - The service registers an Angular `effect` monitoring `this.appState.currentView() === 'tasks'` and `this.appState.workspaceInfo()?.path`.
  - Inside `untracked(() => this.onContextChange(path, onTasksView))`, transitions are precisely tracked:
    - `entered = onTasksView && !this.onTasksView`
    - `left = !onTasksView && this.onTasksView`
  - Seeded in the constructor (`this.lastWorkspacePath = this.appState.workspaceInfo()?.path ?? null;`), preventing an accidental initial false "switch" trigger.
- **Leakage Prevention on Other Views**:
  - When the app is on other surfaces (e.g. `'chat'`, `'orchestrator'`, `'memory'`), `onTasksView` is `false`, so `entered` is `false`.
  - `isActive()` returns `this.onTasksView || this.consumers > 0`. On non-tasks views with no board cards mounted, `isActive()` is `false`.
  - Push handler gate ([`task-session-links.service.ts:142`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L142)): `if (!this.isActive()) return;` immediately discards push messages if the Tasks view is not active and no cards are mounted.
  - No fetches are initiated or leaked while navigating non-tasks views.
  - Verified by spec: `fetches nothing until a consumer mounts` and `ignores pushes while no board is mounted` ([`task-session-links.service.spec.ts:91-96, 140-148`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L91-L148)).

#### 2. Cache Persistence, Staleness & Race-Condition Immunity

- **Workspace Switching** ([`task-session-links.service.ts:153, 159, 165`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L153-L165)):
  - When `path !== this.lastWorkspacePath`, `this._links.set(EMPTY_MAP)` executes synchronously, immediately clearing any prior workspace session links.
  - If the Tasks view is active (`this.isActive()`), a new fetch is initiated for the new workspace.
- **Stale / Out-of-Order RPC Responses** ([`task-session-links.service.ts:210, 238-239`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L210-L239)):
  - `workspacePath` is captured at the beginning of `fetchOnce()`.
  - Prior to applying the response: `if (this.appState.workspaceInfo()?.path !== workspacePath) return;`. Stale responses from a previous workspace cannot overwrite the active state.
  - **Single In-Flight Loop**: `load()` guards with `if (this.inFlight) { this.reloadQueued = true; return; }` and runs sequentially in a `do ... while (this.reloadQueued && this.isActive())` loop. Concurrent requests are serialized, rendering out-of-order response overwrites impossible.
- **Unavailable `{ available: false }` & Error Handling** ([`task-session-links.service.ts:221-234, 260-264`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L221-L264)):
  - Hosts without organization support return `{ available: false }`; `toLinkMap` safely returns `EMPTY_MAP` without logging errors.
  - Rejected RPC calls or failed responses log `console.error` once and reset `_links` to `EMPTY_MAP`.
- **Push Events with Zero Mounted Cards** ([`task-session-links.service.ts:142, 170-173`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L142-L173)):
  - Because `isActive()` checks `this.onTasksView || this.consumers > 0`, an open Tasks view with 0 cards (e.g. empty board, filtered column, or pending card load) correctly accepts `session:organizationChanged` pushes and queues `load()`.
  - Verified by spec: `reloads on a push while the surface is open with no card mounted` ([`task-session-links.service.spec.ts:330-341`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L330-L341)).

#### 3. Within-Visit Card Mount / Unmount De-duplication

- **Visit-Scoped Fetch Tracking** ([`task-session-links.service.ts:98, 125, 133-135, 160-164`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L98-L164)):
  - Entering the Tasks surface calls `startFetch()`, setting `this.fetchedThisVisit = true`.
  - When individual cards mount on the board, `retain()` checks `if (this.consumers === 1 && !this.fetchedThisVisit) this.startFetch();`. Since `fetchedThisVisit` is already `true`, no fetch is fired.
  - When cards unmount (e.g. filter changes, column collapses) and `consumers` drops to 0, `fetchedThisVisit` is NOT reset while `this.onTasksView` is `true`.
  - When cards remount, no secondary fetch occurs.
  - When navigating away (`left`), `this.fetchedThisVisit` resets to `false` when all consumers unmount (or upon the next `entered`), guaranteeing the next visit triggers a fresh background fetch.
  - Verified by spec: `does not refetch when cards mount, unmount and remount in one visit` and `issues one fetch when cards mount before the visit is observed` ([`task-session-links.service.spec.ts:294-313`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L294-L313)).

#### 4. Template & WCAG Compliance Structure

- **Two-Line Responsive Layout** ([`task-card.component.ts:458-524`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L458-L524)):
  - Line 1: `MessagesSquareIcon`, dot cluster (capped at `MAX_SESSION_DOTS = 5`), optional overflow badge `+N`, and total session count label.
  - Line 2: Phase summary container with `flex flex-wrap gap-x-1 min-w-0`, preventing text truncation at 240px card width.
  - PR link is anchored with `flex items-start gap-1.5` beside both lines.
- **Dot High-Contrast Rings & Shape Distinctions** ([`task-card.component.ts:90-101, 483-489`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L90-L489)):
  - Every dot has `w-2.5 h-2.5 rounded-full border border-base-content/70` (6.18:1 light, 7.69:1 dark against the card background), fulfilling WCAG 1.4.11 non-text contrast regardless of phase fill.
  - `none` phase uses `bg-transparent`, providing a hollow ring shape distinction for sessions not currently open.
- **Overflow Marker Accessibility** ([`task-card.component.ts:491-500, 794-804`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L491-L804)):
  - For tasks with > 5 sessions, renders `+{{ hiddenSessionCount() }}` with `[attr.aria-label]="hiddenSessionsLabel()"` (e.g. `2 more sessions not shown as dots`).
- **Phase Words Grouping & Priority Ordering** ([`task-card.component.ts:104-111, 812-828`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L104-L828)):
  - Sorted via `SESSION_PHASE_ORDER = ['failed', 'generating', 'awaiting-background', 'sleeping', 'idle', 'none']`.
  - Attention-demanding states (`failed`, `generating`) appear first.
  - Groups identical phases: e.g. `1 failed · 1 running · 1 background work · 1 sleeping · 3 idle`.
  - For single sessions, prints the singular phase name (e.g. `running`).

#### 5. Spec Assertion Rigor

- **Service Timing Suite** ([`task-session-links.service.spec.ts:284-342`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.spec.ts#L284-L342)):
  - Explicitly asserts fetch runs on view entry before card mounts (`expect(listCalls()).toHaveLength(1)`).
  - Explicitly asserts mount/unmount/remount within one visit does not refetch (`expect(listCalls()).toHaveLength(1)`).
  - Explicitly asserts visit switch (`tasks` → `chat` → `tasks`) keeps cached map and refetches on re-entry (`expect(listCalls()).toHaveLength(2)`).
  - Explicitly asserts push updates reload while on surface with 0 cards mounted.
- **Component Card Suite** ([`task-card.component.spec.ts:876-1085`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts#L876-L1085)):
  - Asserts two-line phase text grouping, `+N` overflow badge accessibility, contrast rings on dots, hollow fill for `not open`, and keyboard/click isolation.

---

### Finding Log

- **Blocking**: 0
- **Serious**: 0
- **Moderate**: 0
- **Minor**: 0

The round-1 changes are architecturally clean, fully tested, solve the accessibility and layout shift issues identified in round 0, and maintain strict type safety and framework conventions.
