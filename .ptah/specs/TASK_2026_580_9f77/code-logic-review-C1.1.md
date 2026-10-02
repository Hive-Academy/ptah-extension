VERDICT: APPROVED

Score: 10/10

Counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 0

---

### Scope & Review Context

Batch C1.1 implements the frontend session organization presentation components in `@ptah-extension/chat` (TASK_2026_580, plan component 11):

- `SessionOrganizationChipsComponent` (atom): summary badges for the sidebar row (priority, status, live-phase dot, pin, agent badge, linked tasks with "missing" indicator [AC6], PR count).
- `SessionFilterBarComponent` (molecule): search input, status/priority multi-select, task id filter, pinned and has-PR toggles, sort and group dropdowns; normalized query emission with 250ms debounced text input (L17).
- `SessionOrganizationEditorComponent` (molecule): per-session dialog for mutating priority, workflow status, pin, task links, and PR links; external HTTPS link protection; worktree inspection with editor detection and path copy (Assumption A3).

Reviewed files (all new, untracked):

1. `libs/frontend/chat/src/lib/components/atoms/session-organization-chips/session-organization-chips.component.ts`
2. `libs/frontend/chat/src/lib/components/atoms/session-organization-chips/session-organization-chips.component.spec.ts`
3. `libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.ts`
4. `libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.spec.ts`
5. `libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.ts`
6. `libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.spec.ts`

---

### Verification Summary

1. **Nx Target Verification**:
   - `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`: PASSED (3/3 tasks succeeded).
   - `@ptah-extension/chat:test`: all test suites passed clean, including all 23 specs across the three new component test suites.
2. **Architecture & Guidelines**:
   - Angular 22 standalone components with `ChangeDetectionStrategy.OnPush` strictly adhered to across all files.
   - Clean signal integration using `input`, `output`, `signal`, `computed`, and `linkedSignal`.
   - Complete avoidance of `innerHTML` or raw DOM injection; PR links and task tags are safely rendered through Angular templates.
   - Proper lifecycle cleanup via `DestroyRef.onDestroy` for all timers and in-flight operations.

---

### Detailed Code-Logic Analysis

#### 1. Live Phase Computation & Registry Precedence

- **Liveness Precedence** ([`session-organization-chips.component.ts:270-276`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/atoms/session-organization-chips/session-organization-chips.component.ts#L270-L276)):
  - Reads `SessionLivenessRegistry.statuses().get(session.id)`. When active in the client registry, this real-time stream status takes precedence over the snapshot `session.livePhase`.
  - Driven by a single `computed` signal without creating per-row RxJS subscriptions or timer intervals, preventing memory leaks and excessive change detection runs across large session lists.
  - Verified by tests: `uses the row livePhase when the registry does not track the session` and `lets the liveness registry win over the row livePhase` ([`session-organization-chips.component.spec.ts:161-182`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/atoms/session-organization-chips/session-organization-chips.component.spec.ts#L161-L182)).

#### 2. Accessibility & Non-Color Reliance (WCAG 1.4.1)

- **Color Independence & Visual Distinctions** ([`session-organization-chips.component.ts:127-249`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/atoms/session-organization-chips/session-organization-chips.component.ts#L127-L249)):
  - Priority and status chips display clear textual labels (`{{ priorityLabel() }}`, `{{ statusLabel() }}`) on high-contrast base backgrounds; semantic colors are applied strictly to borders and backgrounds.
  - Live states use distinct visual indicators: pulsing dot for running, moon icon for background, and alert icon for failure, alongside `[attr.aria-label]="'Live: ' + livePhaseLabel()"`.
  - Deleted/missing tasks display visible text `missing`, line-through styling, and explicit accessible naming (`[attr.aria-label]="taskLabel(...)"`) satisfying AC6.
  - Verified by tests: `labels a missing linked task with visible text and its aria label (AC6)` and `labels priority, status, pin and PR count with text, not colour alone` ([`session-organization-chips.component.spec.ts:78-159`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/atoms/session-organization-chips/session-organization-chips.component.spec.ts#L78-L159)).

#### 3. Filter Bar Debounce, Coalescing & Deduplication

- **Debounce & Single Pending Change** ([`session-filter-bar.component.ts:432-464`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.ts#L432-L464)):
  - Free-text inputs (`text`, `taskId`) are debounced by 250ms (`SESSION_FILTER_TEXT_DEBOUNCE_MS`), while structural filters (status, priority, pin, sort, groupBy) trigger an immediate flush.
  - Immediate changes cancel any pending timer and flush the current draft, safely bundling any pending typed input without losing keystrokes or emitting redundant intermediate queries.
  - Pending timers are cleanly cancelled on component destruction via `DestroyRef.onDestroy`.
  - Output deduplication: `flush()` compares `key` against `baseline` (derived from `seed` or previous emission), preventing infinite reload loops when parent components re-pass emitted queries.
  - Verified by tests: `debounces search text by 250 ms and sends only the settled value`, `emits sort and group changes at once, carrying the pending text`, `does not emit a query equal to the seed`, and `releases the pending timer on destroy` ([`session-filter-bar.component.spec.ts:66-151`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/molecules/session-filter-bar/session-filter-bar.component.spec.ts#L66-L151)).

#### 4. Editor Mutation Safety & Race Condition Prevention

- **RPC Failure Paths & Inline Alerts** ([`session-organization-editor.component.ts:711-736`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.ts#L711-L736)):
  - All mutations check `result.isSuccess()` for transport/network failures and `outcome.ok` for business rejections. Both error types are captured in `error` signal and rendered via `role="alert"` without throwing unhandled exceptions.
  - Interactive controls are disabled (`[disabled]="busy()"`) during in-flight mutations.
  - Session race guard: captures `const sessionId = this.sessionId()` before awaiting RPC calls and confirms `if (this.destroyed || this.sessionId() !== sessionId) return false;` before writing results, discarding stale responses if the user switches sessions or closes the modal.
  - Verified by tests: `shows ok:false and transport failures inline and keeps the record` ([`session-organization-editor.component.spec.ts:269-294`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.spec.ts#L269-L294)).

#### 5. URL Safety & External Link Protection

- **HTTPS Scheme Enforcement & Validation** ([`session-organization-editor.component.ts:72-82, 633-647`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.ts#L72-L647)):
  - `httpsUrlOrNull` enforces URL protocol `https:`, maximum length cap of 2048 characters, and parses safely via `new URL`.
  - Non-HTTPS inputs (e.g. `http://`, `javascript:`, malformed URLs) are rejected on submit with user-facing validation errors before hitting the RPC layer.
  - Stored URLs: existing PR links with non-HTTPS protocols are rendered as safe text spans rather than clickable links. Clickable links enforce `target="_blank" rel="noopener noreferrer"`.
  - Verified by tests: `adds an https PR link, refuses any other scheme, and removes one`, `renders a stored non-https PR link as text, never as a link`, and `accepts only https URLs within the length cap` ([`session-organization-editor.component.spec.ts:200-267, 356-364`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.spec.ts#L200-L364)).

#### 6. Dialog Accessibility & Keyboard Navigation

- **Focus Management & Keyboard Dismissal** ([`session-organization-editor.component.ts:108-136, 544-550, 575-578, 752-770`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.ts#L108-L770)):
  - Dialog carries `role="dialog"`, `aria-modal="true"`, and `[attr.aria-labelledby]="titleId"`.
  - Traps initial focus by shifting focus to the close button via `afterNextRender`.
  - Caches `document.activeElement` when opened and restores focus (`this.returnFocus.focus()`) to the originating element upon closure.
  - Handles `Escape` keyboard events via `(keydown.escape)="onEscape($event)"`, preventing default browser behavior and cleanly emitting `closed`.
  - Verified by tests: `stays closed without a session and opens as a labelled dialog` and `emits closed on Escape and from the close button` ([`session-organization-editor.component.spec.ts:111-121, 344-354`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/molecules/session-organization-editor/session-organization-editor.component.spec.ts#L111-L354)).

---

### Deviations Assessment

1. **Default Priority 'normal' and Status 'active' Chips Hidden**:
   - _Implementation_: `SessionOrganizationChipsComponent` suppresses chips when `priority === 'normal'` or `status === 'active'`.
   - _Judgment_: **ACCEPTED**. Because all new or unorganized sessions possess default status and priority, rendering those two badges on every single sidebar row would cause severe visual clutter without providing differentiated information.
2. **Filter Bar Contains Its Own Search Input**:
   - _Implementation_: `SessionFilterBarComponent` bundles the search input alongside the Filters popover rather than relying exclusively on an external shell search.
   - _Judgment_: **ACCEPTED**. This encapsulates full query state (search text + filters + sort + grouping) inside the molecule, facilitating atomic query normalization and clean handover in Batch C1.2 when the sidebar search input is replaced.
3. **Components Not Exported from `components/index.ts`**:
   - _Implementation_: Components are kept private to `@ptah-extension/chat` and will be consumed internally by `app-shell.component.ts` in C1.2.
   - _Judgment_: **ACCEPTED**. Internal feature presentation components should not unnecessarily pollute public barrels until external consumers require them.
4. **Editor Emits Only `closed`**:
   - _Implementation_: Mutations update local state directly and the broader application relies on the server's `session:organizationChanged` push (implemented in C0.2) rather than synthetic parent output events.
   - _Judgment_: **ACCEPTED**. Server-pushed synchronization ensures a single source of truth across windows/webviews without redundant parent event forwarding.

---

### Finding Log

- **Blocking**: 0
- **Serious**: 0
- **Moderate**: 0
- **Minor**: 0

The implementation is robust, correct, thoroughly tested, and ready for integration in Batch C1.2.
