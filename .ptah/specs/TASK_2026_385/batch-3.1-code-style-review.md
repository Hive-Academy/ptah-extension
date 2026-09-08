# Code Style Review — `TASK_2026_385` Batch 3.1 (Git dock)

## Summary

| Metric          | Value    |
| --------------- | -------- |
| Overall score   | 88/100   |
| Assessment      | APPROVED |
| Blocking issues | 0        |
| Serious issues  | 0        |
| Minor issues    | 2        |
| Files reviewed  | 5        |

## Five style questions

### 1. What breaks in six months?

Nothing structural. `GitDockHeaderComponent` (`libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts:114-132`) duplicates `GitStatusBarComponent`'s push-arming logic (`libs/frontend/editor/src/lib/git-status-bar/git-status-bar.component.ts:145-174`) verbatim — same `isPushing` signal, same try/finally `onPush()`. Both live simultaneously until Phase 4 deletes `@ptah-extension/editor`. A behaviour fix to push handling applied to one and not the other during that window would silently diverge; the plan accepted this as the cost of an incremental port rather than a shared abstraction, so it is not a defect, only a fact to track (see Maintenance debt).

### 2. What would a new team member misread?

The comment at `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:252` — "keeps monaco out of the VS Code extension bundle" — describes a rationale that belongs to the old `EditorPanelComponent` era, when the same lazy-load pattern served both the VS Code extension and Electron. `ElectronShellComponent` is Electron-only (confirmed: no VS Code call sites reference it), so a reader could conclude this file is shared with the VS Code extension host when it is not. See Minor issues.

### 3. What does this cost to maintain?

Two components (`GitDockHeaderComponent`, `GitStatusBarComponent`) now read the identical `gitStatus`/`gitBranches` push state and render nearly the same markup, one with the branch picker and one without. That is deliberate scope-limiting per `batches.md:534` ("branch-picker dropdown and details popover ... not ported"), so the cost is bounded and time-limited — it disappears when `@ptah-extension/editor` is deleted in Phase 4, not open-ended debt.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere material. Both new components use `inject()` exclusively, `ChangeDetectionStrategy.OnPush`, standalone imports, and the new `@if` control-flow block — consistent with every sibling in `git-ui` (e.g. `source-control-panel.component.ts`) and with `chat`'s documented conventions (`libs/frontend/chat/CLAUDE.md` "Angular Conventions Observed").

### 5. What would you have done differently, and why is that better rather than merely other?

I would have named the constructor-arming block as a private method (e.g. `armGitSurface()`) on `GitDockComponent` rather than four bare statements in the constructor body (`git-dock.component.ts:83-92`). It is a matter of taste, not a defect — the constructor is short and the doc comment above the class already explains the sequence in full — so it is not raised as a finding.

## Blocking issues

None.

## Serious issues

None. Import boundaries, required test hooks, and the "no inputs/outputs" contract are all met (see Pattern compliance below).

## Minor issues

- `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:252` — the inline comment "keeps monaco out of the VS Code extension bundle" is stale/misleading for an Electron-only shell; a small wording fix (e.g. "keeps monaco out of the initial Electron renderer bundle") would prevent a future reader from assuming this file is shared with the VS Code extension host.
- `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts:121-132` and `libs/frontend/editor/src/lib/git-status-bar/git-status-bar.component.ts:152-174` — identical `isPushing`/`onPush()` blocks now exist in two libraries with no shared helper. Accepted as a time-boxed migration cost (see Five style questions, #1/#3), not something to fix in this batch, but worth a one-line note in the git-dock header's doc comment cross-referencing the duplication so Phase 4's deletion pass knows to check for behavioural drift before deleting the original.

## File-by-file

### git-dock-header.component.ts

Score 9/10 — 0B, 0S, 1M (duplication note above). Faithful port of `git-status-bar.component.ts:40-141`: same markup, same `data-testid="git-dock-header"`/`role="status"`/`aria-label="Git status"` (`:39-41`) and `data-testid="git-push-button"` (`:92`), branch-picker button and popovers correctly dropped in favor of a plain read-only `<div>` (`:45-73`), no `BranchPickerDropdownComponent`/`BranchDetailsPopoverComponent` import. No inputs/outputs. `OnPush`, `inject()` only, standalone.

### git-dock.component.ts

Score 9/10 — 0B, 0S, 0M. `data-testid="git-dock"` on the host div (`:47`). Constructor arms `GitStatusService.startListening()` + `GitBranchesService.startListening()`/`refreshBranches()` and `destroyRef.onDestroy` disarms both (`:83-92`), matching `batches.md:532` exactly. Imports only `@ptah-extension/core` (`rpcCall`, `VSCodeService`) plus its own library's `DiffViewComponent`/`SourceControlPanelComponent`/`GitDockHeaderComponent`/services — no `chat`, `ui` or `editor` import anywhere in the file. No inputs/outputs. `file:open` routing (`:94-97`) is correctly typed against the existing `FileOpenParams` contract per the batch report.

### git-dock.component.spec.ts

Score 8/10 — 0B, 0S, 0M. Exercises arm-on-construct, disarm-on-destroy, idempotent re-arm, and the `file:open` routing — the four behaviours the acceptance evidence names. `rpcCall` is mocked at the module boundary consistent with `git-status.service.spec.ts`. The suite never calls `fixture.detectChanges()`, so `GitDockHeaderComponent`/`SourceControlPanelComponent`/`DiffViewComponent` are never rendered — a deliberate isolation choice the report explains, not an oversight, and it does not undercut the arming assertions this batch is scoped to prove.

### index.ts (git-ui)

Score 9/10 — 0B, 0S, 0M. Adds exactly `GitDockComponent` and `GitDockHeaderComponent` to the barrel (`:28-29`), nothing else touched; `MonacoLoaderService` and `git-read-error-messages` remain unexported as the header comment (`:8-10`) requires. Single entry point preserved.

### electron-shell.component.ts

Score 8/10 — 0B, 0S, 1M (stale comment, above). `dockComponent` signal correctly renamed from `editorComponent` (`:294`), dynamic import now resolves `@ptah-extension/git-ui`'s `GitDockComponent` (`:307-309`), sidebar tab label changed to `"Git"` (`:278`), and — critically — `layout.editorPanelVisible()` (`:253`, `:280`) and `layout.editorPanelWidth()` (`:264`) are untouched, so the shell's right-dock slot state machine still exists. No static import of `@ptah-extension/editor` or `@ptah-extension/git-ui` remains in the file (only the dynamic `import()`), matching the lazy-load intent.

## Pattern compliance

| Repository rule or nearby convention                                              | Status     | Evidence                                                                                     |
| --------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `git-ui → core → shared` only, never `chat`/`ui`/`editor`                         | PASS       | `git-dock.component.ts:1-13`, `git-dock-header.component.ts:1-13` — no such imports          |
| `ChangeDetectionStrategy.OnPush` mandatory                                        | PASS       | `git-dock.component.ts:74`, `git-dock-header.component.ts:112`                               |
| `inject()` only, no constructor param injection                                   | PASS       | `git-dock.component.ts:77-81`, `git-dock-header.component.ts:115-116`                        |
| New control flow (`@if`/`@for`)                                                   | PASS       | `git-dock.component.ts:61`, `git-dock-header.component.ts:35,57-72,76,89`                    |
| Header is a faithful port of `git-status-bar.component.ts:40-141`, not a redesign | PASS       | Markup/classes match line-for-line except the dropped branch-picker button and popovers      |
| Branch-picker dropdown / details popover not ported                               | PASS       | No `BranchPickerDropdownComponent`/`BranchDetailsPopoverComponent` import in either new file |
| `data-testid="git-dock"`                                                          | PASS       | `git-dock.component.ts:47`                                                                   |
| `data-testid="git-dock-header"`                                                   | PASS       | `git-dock-header.component.ts:39`                                                            |
| `data-testid="git-push-button"`                                                   | PASS       | `git-dock-header.component.ts:92`                                                            |
| `role="status"` / `aria-label="Git status"`                                       | PASS       | `git-dock-header.component.ts:40-41`                                                         |
| No inputs, no outputs on either component                                         | PASS       | No `input()`/`output()` calls in either file                                                 |
| `layout.editorPanelVisible()`/`editorPanelWidth()` retained                       | PASS       | `electron-shell.component.ts:253,264,280`                                                    |
| Sidebar tab reads `label="Git"`                                                   | PASS       | `electron-shell.component.ts:278`                                                            |
| `kebab-case.ts` file naming                                                       | PASS       | `git-dock.component.ts`, `git-dock-header.component.ts`, `git-dock.component.spec.ts`        |
| Single entry point — public API is `src/index.ts` only                            | PASS       | `index.ts:28-29` adds both new components, no secondary entry point touched                  |
| 700-line soft ceiling                                                             | PASS (n/a) | All five files well under the ceiling                                                        |

## Maintenance debt

- Introduced: `GitDockComponent`/`GitDockHeaderComponent` as the Electron shell's new git-surface host, replacing the arming that lived in `editor-panel.component.ts` for this call site.
- Retired: nothing yet — `GitStatusBarComponent` and `editor-panel.component.ts` remain live in `@ptah-extension/editor` until Phase 4 deletes the library, per the batch's own scope.
- Net: a temporary increase (two components doing overlapping work across two libraries) that is scheduled to net back to zero at Phase 4. Worth tracking so the Phase 4 deletion pass diffs the two `onPush()`/`isPushing` implementations before removing the original, in case either one picked up an independent bug fix in the interim.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the only carried risk is the time-boxed duplication between `GitDockHeaderComponent` and `GitStatusBarComponent`, which the task's own phasing already accounts for.
- What a 10/10 version would do differently: fix the stale "VS Code extension bundle" comment in `electron-shell.component.ts:252`, and add a one-line cross-reference in `GitDockHeaderComponent`'s doc comment pointing at `GitStatusBarComponent` so Phase 4's deletion pass checks for drift before removing the original.
