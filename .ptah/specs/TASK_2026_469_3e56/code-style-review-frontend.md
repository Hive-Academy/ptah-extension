# Code Style Review — `TASK_2026_469_3e56` (Frontend)

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 8/10           |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 0              |
| Serious issues  | 2              |
| Minor issues    | 4              |
| Files reviewed  | 14             |

## Five style questions

### 1. What breaks in six months?

Consumers outside `git-ui` (such as the Electron shell, e2e specs, or companion libs) needing to access stash state, trigger mutations, or provide mocks will be forced into deep imports because [`GitStashService`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L78-L84) was omitted from [`src/index.ts`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/index.ts#L13-L24). When the module boundaries linter or build configuration tightens to disallow secondary entry points, those deep imports will fail. Furthermore, writing signals inside an `effect()` in [`stash-popover.component.ts:188-191`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L188-L191) risks runtime cycle warnings under stricter Angular zone/signal scheduler updates compared to declarative `linkedSignal`.

### 2. What would a new team member misread?

A new engineer reading [`diff-tabs.service.ts:321`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L321) where `toTab()` sets `comparison: 'staged'` on historical diffs would misread that stash diffs are staged working-tree diffs capable of hunk-staging operations, rather than understanding that `'staged'` is merely an artificial value satisfying the strict wire union while `provenance.kind === 'historical'` overrides behavior.

### 3. What does this cost to maintain?

[`DiffTabsService`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts#L91) now stands at 883 lines. While this PR responsibly limited its addition to a clean 10-line tab updater without inlining stash logic, creeping additions to this service keep it well above the 700-line soft ceiling. Without an intentional facade extraction (`DiffHunkApplierService` or `DiffTabRevalidatorService`), future git features will continue to incrementally grow the file toward the 1,000-line hard ceiling.

### 4. Where is this inconsistent with the rest of the repository?

1. [`GitStashService`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L78) is the only state service in `src/lib/services/` not exported from [`src/index.ts`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/index.ts#L13-L24) (unlike `GitStatusService`, `GitBranchesService`, `WorktreeService`, `SourceControlService`, `DiffTabsService`, `EditorLauncherService`, and `GitReviewService`).
2. Imperative reset `this.confirmDrop.set(null)` inside an effect in [`stash-popover.component.ts:188-191`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L188-L191) deviates from modern Angular 21 `linkedSignal` usage for resetting local component state on input changes.
3. In [`open-in-button.component.ts:67`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts#L67), `@if (available().length > 0)` renders a dropdown caret even when exactly 1 target exists, creating a redundant single-item dropdown menu.

### 5. What would you have done differently?

Export `GitStashService` and `type GitStashMutation` in `src/index.ts`; use `confirmDrop = linkedSignal({ source: this.isOpen, computation: () => null })` in `stash-popover.component.ts`; and add contextual `aria-label="Apply stash@{N}"` / `aria-label="Drop stash@{N}"` attributes to repeated action buttons in the stash list for screen-reader parity.

---

## Blocking issues

_None._ The implementation has zero circular dependencies, zero forbidden imports, passes all 27 test suites (392 tests), and does not break application boundaries.

---

## Serious issues

### 1. `GitStashService` and `GitStashMutation` omitted from the public API barrel

- File: [`libs/frontend/git-ui/src/index.ts:13-24`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/index.ts#L13-L24)
- Problem: `libs/frontend/git-ui/CLAUDE.md` line 54 mandates: _"Single entry point. Everything is reached through `src/index.ts`; there is no secondary entry point and no deep import."_ All sibling domain services (`GitBranchesService`, `GitReviewService`, `EditorLauncherService`, etc.) are exported from `src/index.ts`. `GitStashService` is `@Injectable({ providedIn: 'root' })`, but cannot be consumed, tested, or mocked from outside `git-ui` without an illegal deep import into `src/lib/services/git-stash.service`.
- Tradeoff: Making it internal prevents external components from triggering stash mutations directly, but violates the library's single-entry-point architecture and breaks external testability.
- Recommendation: Export `GitStashService` and `type GitStashMutation` in [`libs/frontend/git-ui/src/index.ts`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/index.ts).

### 2. Signal write inside `effect()` instead of `linkedSignal`

- File: [`libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:188-191`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L188-L191)
- Problem: The constructor effect performs an imperative signal mutation:
  ```typescript
  effect(() => {
    if (this.isOpen()) void this.stash.loadList();
    else this.confirmDrop.set(null);
  });
  ```
  Angular 21 coding guidelines prescribe: _"State via signals (`signal`, `computed`, `linkedSignal`, `effect` sparingly)"_. Mutating signal state (`this.confirmDrop.set(null)`) as a reactive side-effect of `this.isOpen()` is antipattern in Angular 19+; `linkedSignal` exists specifically to link secondary state to an input signal.
- Tradeoff: `linkedSignal` declaratively resets `confirmDrop` to `null` whenever `isOpen` updates, separating pure state derivation from the async `loadList()` side-effect and preventing unintended effect write cycles.
- Recommendation:
  Refactor `confirmDrop` to use `linkedSignal`:
  ```typescript
  protected readonly confirmDrop = linkedSignal({
    source: this.isOpen,
    computation: () => null,
  });
  ```
  and keep the `effect()` focused solely on async data fetching:
  ```typescript
  constructor() {
    effect(() => {
      if (this.isOpen()) void this.stash.loadList();
    });
  }
  ```

---

## Minor issues

### 1. Repeated stash actions ("Apply", "Pop", "Drop") lack contextual `aria-label`

- File: [`libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts:99-143`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L99-L143)
- Problem: Inside the `@for (entry of stash.entries(); track entry.index)` loop, the action buttons render text nodes "Apply", "Pop", "Drop", and "Drop" (confirmation) without `aria-label`. When navigating via screen reader button rotor/landmarks, all buttons read identically with no indication of which stash entry is targeted.
- Impact: Suboptimal accessibility (WCAG 2.4.6 Headings and Labels).
- Fix: Add contextual labels:
  ```html
  <button ... [attr.aria-label]="'Apply ' + stashRef(entry)">Apply</button>
  <button ... [attr.aria-label]="'Pop ' + stashRef(entry)">Pop</button>
  <button ... [attr.aria-label]="'Drop ' + stashRef(entry)">Drop</button>
  <button ... [attr.aria-label]="'Confirm drop ' + stashRef(entry)">Drop</button>
  ```

### 2. Inaccurate `aria-label` when `behind` or `ahead` count is zero

- File: [`libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts:164,181`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L164-L181)
- Problem: `[attr.aria-label]="'Pull (' + gitStatus.branch().behind + ' behind)'"` produces `"Pull (0 behind)"` and `"Push (0 ahead)"` when the repository is in sync or has no upstream configured, even though the visible template cleanly displays plain `"Pull"` and `"Push"`.
- Impact: Confusing screen reader announcements for clean branches.
- Fix: Conditionally include counts in the label:
  ```html
  [attr.aria-label]="gitStatus.branch().behind ? 'Pull (' + gitStatus.branch().behind + ' behind)' : 'Pull'" [attr.aria-label]="gitStatus.branch().ahead ? 'Push (' + gitStatus.branch().ahead + ' ahead)' : 'Push'"
  ```

### 3. Focus not restored after selecting an item in `OpenInButtonComponent`

- File: [`libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:199-209`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts#L199-L209)
- Problem: While `closeMenu()` (line 184) restores focus to the caret button via `this.caret()?.nativeElement.focus()`, `choose(target)` sets `this.menuOpen.set(false)` without restoring focus. If a user triggers a menu item via keyboard (`Enter` or `Space`), the menu disappears from the DOM and focus drops to `document.body`.
- Impact: Keyboard navigation discontinuity.
- Fix: Add `this.caret()?.nativeElement.focus();` in `choose()` prior to or immediately following `this.open.emit(...)`.

### 4. `diff-tabs.service.ts` at 883 lines exceeds 700-line soft ceiling

- File: [`libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts:299-309`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts#L299-L309)
- Problem: The file size soft ceiling in `CLAUDE.md` is 700 lines. The PR's additions are modest (21 lines for `openHistoricalDiff` and skipping revalidation), but the file is now 883 lines long.
- Impact: Increased cognitive load and risk of gradual creep toward 1,000 lines.
- Fix: No code change required in this PR, but schedule a separate task to apply the repository's facade rule to extract hunk application (`DiffHunkApplierService`) or background revalidation (`DiffTabRevalidatorService`) as an injected collaborator.

---

## File-by-file

### `open-in/editor-brand-icon.component.ts`

Score 9/10 — [0 B, 0 S, 0 M]. Exemplary component design. Uses pure inline SVG and Lucide icons bound statically without any `[innerHTML]` (honoring the zero-sanitization-leak security standard). Declares `ChangeDetectionStrategy.OnPush`, sets `aria-hidden="true"` and `focusable="false"` on all glyphs, and widens the `target` input to `string` for forward-compatible host discovery.

### `open-in/open-in-button.component.ts`

Score 8/10 — [0 B, 0 S, 2 M]. Clean signal architecture and OnPush change detection. Properly filters out `terminal` when a file path is bound. Good keyboard handling for `Escape` and outside clicks. Minor issues: redundant caret when `available().length === 1` ([line 67](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts#L67)), and missing focus restoration when choosing a target via keyboard ([line 199](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts#L199)).

### `open-in/open-in-button.component.spec.ts`

Score 9/10 — [0 B, 0 S, 0 M]. Comprehensive 202-line unit spec. Verifies zero-editor fallback, single-editor direct execution, brand icon rendering, terminal path filtering, settings persistence, and outside-click/Escape keyboard focus restoration.

### `git-dock/git-dock-header.component.ts`

Score 8/10 — [0 B, 0 S, 1 M]. Correctly unifies push, pull, and fetch button states using a coordinated `syncing` signal that prevents concurrent remote operations. Preserves exact visual conventions (`text-warning` for behind, `text-info` for ahead) matching the existing header theme. Properly restores focus on popover dismissal. Minor issue: awkward `aria-label` displaying `"Pull (0 behind)"` / `"Push (0 ahead)"` when count is zero ([lines 164, 181](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L164-L181)).

### `git-dock/git-dock-header.component.spec.ts`

Score 9/10 — [0 B, 0 S, 0 M]. Thorough 256-line component spec. Fully verifies the always-visible Pull/Push buttons, mutual disabling during synchronization, status refresh triggers, stash viewer popover toggle, and Escape focus recovery.

### `services/git-branches.service.ts`

Score 9/10 — [0 B, 0 S, 0 M]. Refactors `push()`, `pull()`, and `fetch()` into a single, cohesive `remoteAction()` helper. Eliminates duplicated error handling, narrows `catch (err: unknown)` with `instanceof Error` per standard, and selectively refreshes the `lastCommit` slice only when `headMoves: true`.

### `services/git-branches.service.spec.ts`

Score 9/10 — [0 B, 0 S, 0 M]. Replaces redundant tests with a parameterized `describe.each(['push', 'pull', 'fetch'])` suite that cleanly verifies workspace scoping, debounce queuing, and transport error folding.

### `services/git-status.service.ts`

Score 10/10 — [0 B, 0 S, 0 M]. Minimal, purposeful 9-line addition adding `refresh(): Promise<void>` to allow callers that perform git mutations (pull, stash pop) to trigger explicit re-reads in environments lacking file watchers.

### `services/git-stash.service.ts`

Score 9/10 — [0 B, 0 S, 0 M]. Outstanding service design. Strictly adheres to git-ui Guideline 3 with workspace-partitioned signal state (`_states` map keyed by workspace path, with public signals derived from the `activeWorkspacePath()`). All async RPC writes capture `workspace` locally and check `activeWorkspacePath()` upon completion to prevent multi-root race conditions. Properly resolves commit refs for diffing and invalidates selection on positional mutations.

### `services/git-stash.service.spec.ts`

Score 9/10 — [0 B, 0 S, 0 M]. 217-line suite providing full branch coverage: workspace isolation, out-of-order response dropping, toggle selection, mutation error propagation, ref resolution caching, and historical tab construction.

### `services/diff-tabs.service.ts`

Score 7/10 — [0 B, 0 S, 1 M]. The added `openHistoricalDiff()` method (10 lines) and the revalidation bypass in `refreshDiffTab()` are well-placed and prevent unnecessary RPC traffic for immutable commits. However, the file now measures 883 lines, which exceeds the 700-line soft ceiling.

### `services/diff-tabs.service.spec.ts`

Score 9/10 — [0 B, 0 S, 0 M]. Verifies that historical diff tabs open correctly, update without duplicating, and are ignored by `refreshAllDiffTabs()`.

### `stash/stash-popover.component.ts`

Score 7/10 — [0 B, 1 S, 1 M]. Implements OnPush change detection, inline confirmation for destructive `Drop` operations, status-labeled file rows, and outside-click handling. Serious finding: signal write in `effect()` for `confirmDrop.set(null)` ([lines 188-191](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L188-L191)) instead of `linkedSignal`. Minor finding: missing contextual `aria-label` on repeated action buttons ([lines 99-143](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L99-L143)).

### `stash/stash-popover.component.spec.ts`

Score 9/10 — [0 B, 0 S, 0 M]. 101 lines testing entry listing, empty states, file diff triggering, apply/pop direct execution, inline drop confirmation, and `stashAge` unit formatting.

---

## Pattern compliance

| Repository rule or nearby convention                        | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChangeDetectionStrategy.OnPush` is mandatory               | PASS   | [`editor-brand-icon.component.ts:16`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/editor-brand-icon.component.ts#L16), [`open-in-button.component.ts:34`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts#L34), [`git-dock-header.component.ts:48`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts#L48), [`stash-popover.component.ts:48`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L48) |
| Standalone components (no NgModules)                        | PASS   | All 4 components specify `standalone: true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| State via signals and `inject()`, not constructors          | PASS   | All services and components use `inject()`, `signal()`, `computed()`, and `viewChild()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| No `[innerHTML]` on untrusted/rendered markup               | PASS   | SVG icons bound statically via template `@switch`, zero `[innerHTML]` bindings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Dependency direction: no import of `editor`, `chat`, `ui`   | PASS   | Zero forbidden imports across all reviewed files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Workspace partitioning for git state                        | PASS   | [`git-stash.service.ts:85-93`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L85-L93) partitions state map by active workspace                                                                                                                                                                                                                                                                                                                                                                                                          |
| Type safety: `catch (error: unknown)` with narrowing        | PASS   | [`git-branches.service.ts:552`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-branches.service.ts#L552), [`git-stash.service.ts:60,129,171`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/services/git-stash.service.ts#L60)                                                                                                                                                                                                                                                                                                          |
| Kebab-case naming, no helpers/utils fragments               | PASS   | All 14 files follow `kebab-case.{service,component,spec}.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Single entry point (`src/index.ts`)                         | FAIL   | [`src/index.ts:13-24`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/index.ts#L13-L24) fails to export `GitStashService`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Modern signal derivation (`linkedSignal` over effect write) | FAIL   | [`stash-popover.component.ts:188-191`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts#L188-L191) mutates `confirmDrop` inside `effect()`                                                                                                                                                                                                                                                                                                                                                                                              |

---

## Maintenance debt

- **Introduced**:
  - `confirmDrop` signal write in `effect()` in `StashPopoverComponent` requiring future cleanup to `linkedSignal`.
  - 21 additional lines in `diff-tabs.service.ts` bringing it to 883 lines.
- **Retired**:
  - Removed duplicated push/pull/fetch RPC dispatch and error conversion in `GitBranchesService`.
  - Consolidated duplicate branch test cases into clean parameterized spec suites.
- **Net**: Positive structural enhancement, requiring minor barrel and signal hygiene fixes.

---

## Verdict

- **Recommendation**: REVISE
- **Confidence**: HIGH
- **Key concern**: `GitStashService` is trapped inside `git-ui` due to omission from `src/index.ts`, and `confirmDrop` uses an imperative effect write instead of Angular 21 `linkedSignal`.
- **What a 10/10 version would do differently**:
  1. Export `GitStashService` and `GitStashMutation` in `src/index.ts`.
  2. Declare `confirmDrop = linkedSignal({ source: this.isOpen, computation: () => null })` in `stash-popover.component.ts`.
  3. Add contextual `aria-label` to "Apply", "Pop", and "Drop" buttons in `stash-popover.component.ts`.
  4. Conditionally format `aria-label` on Pull/Push buttons when ahead/behind counts are 0 in `git-dock-header.component.ts`.
  5. Restore focus to the caret button when selecting an option in `open-in-button.component.ts`.
