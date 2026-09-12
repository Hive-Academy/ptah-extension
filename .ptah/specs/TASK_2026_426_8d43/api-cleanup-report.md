# API Cleanup — `TASK_2026_426_8d43`

Bounded follow-up to the style review's **public-API** finding ("Six symbols added
to the public API with no consumer outside the lib") and the **`reset()` dead
code** minor. Removal only — no behaviour change, no structural finding started.

---

## 1. Public-API trim

### What the task actually added to the barrel

`git diff main -- libs/frontend/skill-synthesis-ui/src/index.ts` shows eight new
symbols across six added export statements:

| Symbol                    | Origin                            | Decision   |
| ------------------------- | --------------------------------- | ---------- |
| `CloneBulkRebaseService`  | `clone-bulk-rebase.service.ts`    | **REMOVED** |
| `BulkRebaseOutcome`       | `clone-bulk-rebase.service.ts`    | **REMOVED** |
| `BulkRebaseProgress`      | `clone-bulk-rebase.service.ts`    | **REMOVED** |
| `CloneBodyEditorComponent`| `clone-body-editor.component.ts`  | **REMOVED** |
| `CloneBodySaveRequest`    | `clone-detail-drawer.component.ts`| KEPT       |
| `BULK_REBASE_EXPLANATION` | `clone-action-gating.ts`          | KEPT       |
| `canEditCloneBody`        | `clone-action-gating.ts`          | KEPT       |
| `eligibleForBulkRebase`   | `clone-action-gating.ts`          | KEPT       |

No symbol was deleted. Only the `index.ts` re-export went; every one is still
exported from its own module and still used internally.

### The consumer search that justifies the removals

Workspace-wide, both `libs/**` and `apps/**`, `*.ts` and `*.html`, excluding
`libs/frontend/skill-synthesis-ui/` itself:

```
grep -rn "<symbol>" --include=*.ts --include=*.html . \
  | grep -v "^./libs/frontend/skill-synthesis-ui/" | grep -v node_modules
```

Run for all eight new symbols **and** for the ten pre-existing gating/drawer
exports (`KEEP_MINE_EXPLANATION`, `REBASE_EXPLANATION`, `cloneActionModel`,
`cloneStatusLabel`, `hasUpstreamSource`, `CloneActionModel`, `CloneActionState`,
`CloneEnhanceEligibility`, `CloneHistoryDiff`, `CloneHistoryRequest`).

**Result: zero hits for all eighteen.** The command exited 1 (no matches) with
no output at all.

Second search — who imports the lib at all:

```
grep -rn "skill-synthesis-ui" --include=*.ts --include=*.json .
```

Four real consumers, and they touch only three symbols between them:

- `libs/frontend/thoth-shell/.../thoth-shell.component.ts:26` —
  `SkillSynthesisTabComponent` (main entry point)
- `libs/frontend/thoth-shell/.../thoth-shell.component.spec.ts:7` —
  `SkillSynthesisStateService` (main entry point)
- `libs/frontend/dashboard/.../thoth-status.service.ts:22` +
  `.spec.ts:5` — `SkillSynthesisRpcService` (`/services` and main)
- `apps/ptah-extension-webview/.../app.config.ts:64` and
  `thoth-message-routing.spec.ts:50` — `SkillSynthesisLiveService` (`/services`)

The secondary entry point `src/services.ts` exports only
`SkillSynthesisLiveService` and `SkillSynthesisRpcService` and was **not
touched** — none of the removed symbols was ever in it.

So removing these four re-exports is not a breaking change: nothing outside the
lib named any of them, and the four external import sites are unaffected.

### Why each removal

- **`CloneBulkRebaseService`** — the important one. It is `@Injectable()` with
  `providedIn` deliberately omitted behind an
  `@angular-eslint/use-injectable-provided-in` disable and a paragraph of
  justification (`clone-bulk-rebase.service.ts:45-54`); its only provider is
  `skill-clones-view.component.ts`. A public export made a surface-scoped
  service look global and invited an injection that fails at runtime with
  `NullInjectorError` — the exact confusion the comment exists to prevent.
- **`BulkRebaseOutcome` / `BulkRebaseProgress`** — the service's own signal
  types. With the service internal they have no reachable public role.
- **`CloneBodyEditorComponent`** — used only by
  `clone-detail-drawer.component.ts`, which is itself public. This matches the
  task's own correct instinct for `CloneBulkToolbarComponent` and
  `BulkRebaseConfirmComponent`, both left internal.

### Why each keep

- **`CloneBodySaveRequest`** — it is the payload type of
  `CloneDetailDrawerComponent`'s `bodySaved` output
  (`clone-detail-drawer.component.ts:449`, interface at `:80`), and that
  component is public API. A consumer binding `(bodySaved)` needs the type to
  name its handler parameter. It sits beside `CloneHistoryRequest`, the
  identically-shaped type for `revertTo` / `historyDiffRequested` (`:445-446`),
  which was already public before this task. Reachable through an existing
  public surface, so it stays.
- **`BULK_REBASE_EXPLANATION`, `canEditCloneBody`, `eligibleForBulkRebase`** —
  the review asked for these to be decided **as a set** with the gating symbols
  already in the barrel: "either the gating module is public API or it is not."
  It already is. `cloneActionModel`, `cloneStatusLabel`, `hasUpstreamSource`,
  `KEEP_MINE_EXPLANATION`, `REBASE_EXPLANATION`, `CloneActionModel`,
  `CloneActionState` and `CloneEnhanceEligibility` were all exported before this
  task (confirmed by the `git diff` above — they are context lines, not added
  lines). Those have no external consumer either, so removing the three new ones
  while leaving eight siblings would produce a barrel that is *more*
  inconsistent than it started, and it would go beyond removal-only by
  narrowing a pre-existing surface this task did not create. The module is a
  pure, framework-free, single-file "correctness layer" the lib's `CLAUDE.md`
  names as such — a coherent unit to export whole or not at all. Keeping the set
  whole is the conservative half of that choice; narrowing the whole gating
  module is a separate, larger decision and belongs with the follow-up the
  orchestrator is already recording.

No removed symbol carried a runtime provider, DI token, or template reference
outside the lib, so nothing about how the app boots or renders changed.

---

## 2. `reset()` deleted

- `clone-bulk-rebase.service.ts` — removed
  `public reset(): void { this._progress.set(null); this._outcomes.set([]); }`
  (was lines 100-104).
- Callers: none. `grep -rn "reset()" libs/frontend/skill-synthesis-ui/src/`
  returned exactly two hits — the declaration itself, and one spec.
- `clone-bulk-rebase.service.spec.ts` — deleted the
  `it('reset() clears the last report', ...)` case, per the instruction that a
  test of dead code is dead weight. The remaining 12 cases in that file cover
  `run()`, sequencing, the never-abort-early contract, `failedSlugs`, and the
  empty-set path; none referenced `reset()`.

Behaviour is unchanged: `run()` already re-initialises `_outcomes` and
`_progress` at its top (`this._outcomes.set([])` then
`this._progress.set({ done: 0, total })`), so no surface depended on `reset()`
to clear stale state, and no caller lost a capability.

---

## Files changed

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/index.ts`
  — dropped 4 re-exports (2 statements); 8 lines removed.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.ts`
  — deleted the unused `reset()` method.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/skills-tab-clone-management-681582aee5c4/libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.spec.ts`
  — deleted the `reset()` test.

No `project.json` edited. No `npx nx reset` run. No commit created; the working
tree is left dirty.

---

## Verification

All commands run from the worktree root with `--skip-nx-cache`, and via
`run-many` so the `Running target ... for N projects` header could be read.

| Command | Result |
| ------- | ------ |
| `npx nx run-many -t test -p @ptah-extension/skill-synthesis-ui --skip-nx-cache` | **PASS** — header `Running target test for project @ptah-extension/skill-synthesis-ui`; `Test Suites: 26 passed, 26 total`, `Tests: 417 passed, 417 total`, 28.8 s. Suites and tests both ran — not a zero-test green. |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/skill-synthesis-ui --skip-nx-cache` | **PASS** — `Successfully ran targets typecheck, lint`. `typecheck` = `npx ngc --noEmit --project .../tsconfig.lib.json`, clean. `lint` = `0 errors, 1 warning`. |
| `npx nx run-many -t typecheck -p @ptah-extension/dashboard @ptah-extension/thoth-shell ptah-extension-webview --skip-nx-cache` | **PASS** — header `for 3 projects`, all three named projects ran (`tsc` for the webview app, `ngc` for both libs), `Successfully ran target typecheck for 3 projects`. |

The single lint warning is **pre-existing and out of scope**:
`skill-synthesis-tab.component.ts:731 — File has too many lines (1175). Maximum
allowed is 700 (max-lines)`. It is warn-level, it is the finding the orchestrator
explicitly excluded, and this cleanup touched neither that file nor its line
count.

Note on the review's blocking issue: the style review recorded `lint` 1 error and
`typecheck` exit 255 from the unescaped backticks in
`clone-body-editor.component.ts:133-135`. Both gates are green now — that was
fixed by the concurrent session before this cleanup began, and my runs confirm it
uncached.

The consumer typechecks are the proof that no removal broke a consumer: the three
projects are exactly the set found by the import search, they are the only
projects that resolve `@ptah-extension/skill-synthesis-ui` or its `/services`
entry point, and all three compile against the narrowed barrel.

---

## Out-of-scope observations (recorded, not started)

Not touched, per instruction — listed only so the follow-up has them:

- The gating module's eight **pre-existing** barrel exports also have zero
  external consumers. Deciding the whole module's public status is the larger
  call this cleanup deliberately left open (see "Why each keep").
- `libs/frontend/skill-synthesis-ui/CLAUDE.md`'s `## Public API` section still
  names four symbols against a barrel of ~21, and `## Internal Structure` still
  names two files. The trim makes that drift slightly smaller but does not close
  it; the review's `CLAUDE.md` finding stands.
- The four review findings the orchestrator reserved — copy having four homes,
  moving the toolbar string builders into `clone-action-gating.ts`, extracting
  the inline reconcile modal, and the `skill-synthesis-tab.component.ts` line
  count — were not started, not partially started, and not touched.
