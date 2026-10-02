VERDICT: APPROVED

Score: 9.5/10

Counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 3

---

### Scope & Review Context

Batch C2.3 implements the linked sessions list section and "Open session" action in `TaskDetailComponent` (`libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts` and its spec `task-detail.component.spec.ts`) per TASK_2026_580 (implementation-plan.md:1045–1046, :1063–1085, batches.md C2.3):

1. **`TaskDetailComponent` Sessions Section (`task-detail.component.ts:457–564`)**:
   - Always rendered header `Sessions (N)` preventing layout shift when the links map loads asynchronously.
   - Quiet empty state (`No sessions linked to this task`, `task-detail-sessions-empty`) when unlinked or when host organization store is unavailable (e.g. VS Code).
   - Per-row live phase dot (`role="img"`, `[attr.aria-label]`, non-color reliance WCAG 1.4.1, `bg-transparent` hollow ring for `'none'` / not open).
   - Display name with fallback to `'Untitled session'` and hover title tooltip.
   - Metadata line: `role · source · phaseLabel` (e.g. `Primary · started from the board · running`).
   - PR links: strict `https:` validation via `new URL(url).protocol === 'https:'`; non-https or unparseable URLs safely render as plain text `#N (not linked)` with tooltip `Pull request #N is not linked: only https addresses open`. Valid links render external with `target="_blank" rel="noopener noreferrer"`.
   - "Open session" action button: invokes `AppStateManager.requestOpenSession({ sessionId, name })`.
2. **Reactivity & Lifecycle (`task-detail.component.ts:742–758`)**:
   - `sessionRows` computed over `TaskSessionLinksService.linksFor(detail()?.id)` without local fetch or per-component retain timer.
   - Clean delegation to `AppStateManager.requestOpenSession`.
3. **Spec Coverage (`task-detail.component.spec.ts:627–868`)**:
   - 32 total tests in the suite (8 dedicated to linked sessions). Verifies rendering, metadata formatting, empty state, in-place map arrival, "Open session" event publishing, and non-https URL suppression.

---

### Verification Summary

1. **Unit Tests**:
   - `npx nx test @ptah-extension/tasks-ui --testFile=task-detail.component.spec.ts`: **PASSED** (32/32 tests passed, 0 failures).
2. **Typecheck**:
   - `npx nx run @ptah-extension/tasks-ui:typecheck`: **PASSED** clean with zero errors.
3. **Lint**:
   - `npx nx run @ptah-extension/tasks-ui:lint`: **PASSED** (0 errors, 6 pre-existing warnings in unrelated files).
4. **Prettier Format Check**:
   - `npx prettier --check libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts`: PASSED clean.
   - `npx prettier --check libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.spec.ts`: **FAILED** (code style formatting issue found; see Finding 1).

---

### Detailed Code-Logic Analysis

#### 1. Map Activation Without `retain()`

- **Finding**: Safe and behaviourally correct.
- **Analysis**:
  - `TaskDetailComponent` deliberately does not call `sessionLinks.retain()` or trigger a fetch. It reads exclusively from `TaskSessionLinksService.linksFor(detail()?.id)`.
  - In `TaskSessionLinksService` ([`task-session-links.service.ts:100–109`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L100-L109)), an Angular effect monitors `appState.workspaceInfo()?.path` and `appState.currentView() === 'tasks'`.
  - In `app.routes.ts:152–158`, the `/tasks` route loads `TasksViewComponent`. Thus, whenever the Tasks surface is open, `currentView()` is `'tasks'`, which sets `this.onTasksView = true` and triggers `this.startFetch()`.
  - `TaskDetailComponent` is only ever instantiated inside `TasksViewComponent` ([`tasks-view.component.ts:583–601`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts#L583-L601)) when `store.selectedTaskId()` is active. There is no other template instantiation or route rendering `TaskDetailComponent` in the repository.
  - When deep-linking into `/tasks`, the route initializes `onTasksView = true`, initiating the fetch before or concurrent with board data.
  - Even if all cards are filtered out or before cards mount, `onTasksView` alone satisfies `isActive() === true` and keeps push message handling active for `session:organizationChanged`, `session:turnEnded`, and `session:turnFailed`.
  - This design strictly respects the batch constraint and architectural rule: _"one fetch per board load or push, never one per card; no per-card timer"_ (implementation-plan.md:1079).

#### 2. `computed` Correctness on Task ID Change & Workspace Switch

- **Task ID Change**:
  - `sessionRows` is defined as:
    ```typescript
    protected readonly sessionRows = computed<readonly SessionRow[]>(() => {
      const taskId = this.detail()?.id;
      const sessions = taskId ? this.sessionLinks.linksFor(taskId) : NO_SESSIONS;
      return sessions.map(toSessionRow);
    });
    ```
  - It tracks two signals: `this.detail()` (input signal) and `this.sessionLinks._links` (via `linksFor`).
  - When the user selects a different task on the board, `detail()` emits the new task object, and `sessionRows` synchronously re-evaluates with the new `taskId`. If `detail()` is `null`, `taskId` is undefined and `NO_SESSIONS` (`[]`) is returned.
- **Workspace Switch**:
  - When the active workspace changes, `TaskSessionLinksService.onContextChange` synchronously executes `this._links.set(EMPTY_MAP)` ([`task-session-links.service.ts:159`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L159)).
  - Because `_links` is cleared synchronously, `sessionRows` immediately recalculates to `[]`, preventing stale rows from the old workspace from remaining on screen.
  - The in-flight fetch for the new workspace checks `if (this.appState.workspaceInfo()?.path !== workspacePath) return;` ([`task-session-links.service.ts:238`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/services/task-session-links.service.ts#L238)), ensuring late responses from an abandoned workspace are discarded. Once the new workspace results arrive, `_links.set(next)` updates `sessionRows` reactively.

#### 3. PR URL Safety & Scheme Inconsistency

- **Safety**:
  - Validated in `isHttpsUrl(url: string)` ([`task-detail.component.ts:87–94`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts#L87-L94)):
    ```typescript
    function isHttpsUrl(url: string): boolean {
      try {
        return new URL(url).protocol === 'https:';
      } catch {
        return false;
      }
    }
    ```
  - Any non-https scheme (`http:`, `javascript:`, `file:`, `data:`, or malformed URLs) throws or returns `false`.
  - Non-https URLs render as unlinked text: `<span ...>{{ pr.label }} (not linked)</span>` with `title="Pull request #N is not linked: only https addresses open"`.
  - Linkable anchors render with `target="_blank" rel="noopener noreferrer"`.
  - Tested against `http`, `javascript`, and `relative` inputs in `task-detail.component.spec.ts:848–868`.
- **Inconsistency with `task-card.component.ts` (Finding 2)**:
  - `task-card.component.ts:117` uses `HTTP_URL = /^https?:\/\//i`, permitting unencrypted `http://`.
  - `task-detail.component.ts` strictly permits only `https:`.
  - _Severity Judgment_: Minor. All legitimate GitHub pull requests are `https:`. The detail component is strictly more secure and resilient against protocol poisoning. Documented as a minor consistency note.

#### 4. Open Session Parameter Handling (Empty / Undefined Name)

- `toSessionRow` keeps the raw `name: session.name` and derives `displayName: session.name || 'Untitled session'`.
- `onOpenSession(session)` passes `{ sessionId: session.sessionId, name: session.name }` to `AppStateManager.requestOpenSession`.
- In `AppStateManager.requestOpenSession` ([`app-state.service.ts:1330–1337`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/core/src/lib/services/app-state.service.ts#L1330-L1337)):
  ```typescript
  this._sessionOpenRequest.set({
    sessionId,
    ...(request.name ? { name: request.name } : {}),
  });
  ```
  If `request.name` is empty string (`''`) or `undefined`, `request.name ?` evaluates to false, and `name` is omitted entirely from `SessionOpenRequest`.
- In `SessionOpenBridgeService` ([`session-open-bridge.service.ts:42–45`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts#L42-L45)):
  - In `grid` layout: `requestCanvasSession(request.sessionId, request.name)` accepts optional `name?: string`. When `name` is undefined, `OrchestraCanvasComponent` safely defaults to session metadata.
  - In `single` layout: `sessionLoader.switchSession(request.sessionId)` ignores `name` and switches by ID only.
- Empty or undefined names do not cause crashes, unexpected token conversions, or UI errors.

#### 5. Unknown Role/Source Fallback & XSS Immunity

- In `toSessionRow`:
  ```typescript
  role: SESSION_ROLE_LABELS[session.role] ?? session.role,
  source: SESSION_SOURCE_LABELS[session.source] ?? session.source,
  ```
- If an unrecognised role or source string is received, it gracefully falls back to the raw string value without throwing.
- Template rendering at `task-detail.component.ts:490–492` uses standard Angular interpolation:
  `{{ session.role }} · {{ session.source }} · {{ session.phaseLabel }}`.
- Angular standard interpolation strictly HTML-escapes all dynamic values. No `[innerHTML]` binding is used anywhere in `TaskDetailComponent` (the markdown body is routed strictly through `MarkdownBlockComponent`, the DOMPurify chokepoint). Script injection via role, source, name, or PR text is impossible.

#### 6. Duplicated Phase Maps & Dot Classes

- `SESSION_PHASE_LABELS` and `SESSION_PHASE_DOT_CLASSES` in `task-detail.component.ts:50–71` are identical copies of those in `task-card.component.ts:80–101`.
- Within the scope of Batch C2.3 (strictly constrained to 2 files: `task-detail.component.ts` and `task-detail.component.spec.ts`), copying the local presentation dictionary maintains batch isolation and avoids touching `task-presentation.ts` or `task-card.component.ts`.
- Noted as a minor maintenance follow-up (Finding 3) for future consolidation into `libs/frontend/tasks-ui/src/lib/task-presentation.ts`.

#### 7. Specification Quality

- `task-detail.component.spec.ts:627–868` provides 8 high-fidelity tests asserting:
  - Role, source, and phase labels in words for all standard phases and `none` (`'not open'`).
  - Untitled session fallback (`'Untitled session'`).
  - Accessible name and WCAG 1.4.1 compliance on phase dot (`role="img"`, `[attr.aria-label]`).
  - External PR anchor attributes (`href`, `target="_blank"`, `rel="noopener noreferrer"`, aria-label with repo and state).
  - Quiet empty state without alert styling.
  - In-place reactive rewrite upon late link-map arrival without DOM replacement or layout shift.
  - Correct delegation to `AppStateManager.requestOpenSession` with ID and name.
  - Sanitization of non-https PR schemes (`http`, `javascript`, relative paths).

---

### Finding Log

- **Blocking**: 0
- **Serious**: 0
- **Moderate**: 0
- **Minor**: 3

#### Finding 1 (Minor - Code Style): Prettier formatting issue in spec file

- **File**: `libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.spec.ts:825`
- **Evidence**: `npx prettier --check` fails with code style issues. At line 825:
  ```typescript
  linked({ sessionId: 'sess-2', name: 'Review pass', role: 'related' }),
  ```
  Prettier requires multi-line wrapping for the object literal:
  ```typescript
  linked({
    sessionId: 'sess-2',
    name: 'Review pass',
    role: 'related',
  }),
  ```
- **Remediation**: Run `npx prettier --write libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.spec.ts` prior to commit to ensure `lint-staged` pre-commit checks pass cleanly.

#### Finding 2 (Minor - Consistency): PR URL validation divergence between Card and Detail

- **File**: `libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts:87-94` vs `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts:117`
- **Evidence**: `task-card.component.ts` uses regex `HTTP_URL = /^https?:\/\//i` which permits unencrypted `http://`, whereas `task-detail.component.ts` strictly requires `new URL(url).protocol === 'https:'`.
- **Impact**: Detail is strictly more secure. If an `http://` link ever appeared, it would be linked on the card but unlinked plain text in detail.
- **Remediation**: In a future cleanup, align `task-card.component.ts` to use `https:`-only matching.

#### Finding 3 (Minor - Maintenance): Duplicated Phase Dictionaries

- **File**: `libs/frontend/tasks-ui/src/lib/components/detail/task-detail.component.ts:50-71`
- **Evidence**: `SESSION_PHASE_LABELS` and `SESSION_PHASE_DOT_CLASSES` duplicate definitions in `task-card.component.ts:80-101`.
- **Remediation**: Extract both dictionaries to `libs/frontend/tasks-ui/src/lib/task-presentation.ts` in a follow-up refactoring.

---

### Conclusion

Batch C2.3 is verified to be behaviourally and architecturally sound, thoroughly tested, and safe against reactive glitches and XSS. The implementation is **APPROVED** to merge once Finding 1 (prettier formatting) is applied by the executor before committing.
