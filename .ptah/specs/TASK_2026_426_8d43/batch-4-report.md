# Batch 4 report — TASK_2026_426_8d43

Skills-UI integration: diverged filter, per-kind count, bulk rebase, body save,
deep-link arrival. Tasks 4.1 – 4.4 complete. No git commit was created.

## Files

CREATED

- `libs/frontend/skill-synthesis-ui/src/lib/components/clones/bulk-rebase-confirm.component.ts`
  — `ptah-bulk-rebase-confirm`; the consent gate. Names the count, renders
  `BULK_REBASE_EXPLANATION`, `role="dialog" aria-modal="true"`, real Cancel
  button. Output is `cancelled`, not `cancel`.
- `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-bulk-toolbar.component.ts`
  — `ptah-clone-bulk-toolbar`; the filter toggle (`aria-pressed`), the count
  readout with the `(M in other kinds)` residual, and the bulk control with its
  disabled reason. The only place a count becomes English.

MODIFIED

- `.../src/lib/services/skill-synthesis-rpc.service.ts` — `saveCloneBody(kind,
  slug, body)` wrapper at `PROMOTE_MS`, beside `keepClone`.
- `.../src/lib/services/skill-clones-state.service.ts` — `saveCloneBody()`
  delegates then reloads `detail`; errors propagate so the view owns the toast.
  `divergedCount` left untouched.
- `.../src/lib/components/clones/skill-clones-view.component.ts` — `divergedOnly`,
  `bulkEligible`, `divergedInOtherKinds`, `bulkConfirmOpen`, `bodySaving`,
  `actionsLocked`, `canEditSelectedBody`, `divergedFilterRequested` input,
  `onConfirmBulkRebase()`, `onSaveBody()`. Provides `CloneBulkRebaseService` on
  the component.
- `.../src/lib/components/clones/skill-clones-view.component.spec.ts` — 12 new
  tests across three describe blocks.
- `.../src/lib/components/skill-synthesis-tab.component.ts` — injects
  `AppStateManager`; one `effect()` consumes `consumeSkillsDivergedRequest()`,
  sets `_subView` to `clones` and raises `_clonesDivergedFilter`, which is bound
  down as `[divergedFilterRequested]` on `<ptah-skill-clones-view>` (previously
  bound to nothing).
- `.../src/lib/components/skill-synthesis-tab.component.spec.ts` — 3 new tests.
- `libs/frontend/skill-synthesis-ui/CLAUDE.md` — deleted the Guidelines bullet
  "Do not Electron-gate this tab — skills work on VS Code too." (task 4.4). The
  `Runtime: ELECTRON-ONLY` section is untouched.

NOT touched: `src/index.ts` (batch 3 owns it; no new export was needed — both new
components are internal to the view), any `project.json`, `rpc-handler.ts`. No
`npx nx reset` was run.

## Acceptance criteria

- **R1.1** — the bulk control renders whenever the kind tab is active. At zero
  eligible it is `disabled` with a visible reason (`clones-bulk-disabled-reason`,
  wired via `aria-describedby`), never absent. Pinned by a test.
- **R1.2** — the batch loops the existing `skillSynthesis:rebaseClone` through
  batch 3's `CloneBulkRebaseService`; no second rebase path.
- **R1.3** — nothing is written before the confirm click; the confirmation names
  `bulkEligible().length` and renders `BULK_REBASE_EXPLANATION`. Pinned.
- **R1.5** — `state.refreshClones()` is called exactly once after the batch
  settles. Pinned by call-count (1 from `ngOnInit` + 1 = 2).
- **R1.7** — `actionsLocked()` = `bulk.running() || busySlug() !== null ||
  bodySaving()`. Disables the bulk control, Refresh, both confirm buttons, and
  marks every card and the drawer `[busy]`. Pinned.
- **R2.1 / R2.3** — `visibleClones` gained `&& (!divergedOnly() || c.diverged)`;
  an emptied filter renders the `clones-empty` branch with distinct copy.
- **R2.5 (arrival half)** — Concern 3 as decided: the **tab** consumes the
  read-and-clear exactly once; the view receives a plain `input()` and does not
  inject `AppStateManager`. A second tab mount does not re-filter. Pinned.
- **R3.2 / R3.4** — `onSaveBody()` → `state.saveCloneBody()` (which reloads
  detail) → `refreshClones()`. A failure toasts `toMessage(err)` and leaves the
  editor open with the draft; pinned.
- **R3.1 / R3.9** — `canEditBody` is fed from `canEditCloneBody()`; no
  eligibility rule is re-spelled in a template. The whole view is behind the
  Electron placeholder.
- Counter residual — `(M in other kinds)` appends when other kinds hold eligible
  clones. Inert: no action, no write. Pinned.
- No `[innerHTML]` anywhere; the preview stays `ptah-markdown-block`.

## Facade rule / line count

`skill-clones-view.component.ts` is **747 raw lines** (585 before). ESLint's
`max-lines` does **not** flag it — the rule's own count (blank lines and comments
excluded) is under 700, confirmed by running `npx eslint` on the file directly:
0 problems.

The plan's pre-authorised extraction was applied, and a second one with it:

1. `BulkRebaseConfirmComponent` — the batch consent dialog (plan-authorised).
2. `CloneBulkToolbarComponent` — the filter / count / bulk-control row.

Both are nameable collaborators with their own inputs and outputs.
`ptah-skill-clones-view` keeps its selector, its state and every behaviour. No
`helpers` / `utils` file was created. I stopped at two: a third sub-150-line
split would be the fragment sprawl the root `CLAUDE.md` guardrails warn about,
and the rule is already satisfied.

## Verification — commands and observed results

`npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/agent-generation @ptah-extension/core @ptah-extension/marketplace @ptah-extension/skill-synthesis-ui`

> `Running target typecheck for 6 projects` → **`Successfully ran target
> typecheck for 6 projects`**

`npx nx run-many -t lint -p <same 6>`

> `Running target lint for 6 projects` → **`Successfully ran target lint for 6
> projects`**. 0 errors. Warnings are pre-existing (`max-lines` on
> `rpc.types.ts` and `skill-synthesis-tab.component.ts`, non-null assertions,
> unused vars in `agent-generation`). `npx eslint` scoped to the four
> production files I authored or edited: **0 problems.**

`npx nx run-many -t test -p <same 6> --skip-nx-cache`

> `Running target test for 6 projects` — **N = 6, confirmed in the header.**
>
> | Project              | Suites             | Tests                          |
> | -------------------- | ------------------ | ------------------------------ |
> | shared               | 56 passed          | 1375 passed                    |
> | rpc-handlers         | 94 passed          | 2741 passed, 31 skipped        |
> | core                 | 28 passed          | 666 passed                     |
> | marketplace          | 12 passed          | 241 passed                     |
> | skill-synthesis-ui   | 26 passed          | **397 passed**                 |
> | agent-generation     | 3 failed, 28 passed| 4 failed, 966 passed           |
>
> **`NX Running target test for 6 projects failed`** — solely on
> `@ptah-extension/agent-generation`.

### The agent-generation failures are the documented pre-existing flakiness

Every failure is `thrown: "Exceeded timeout of 5000 ms for a test."` — Jest's
default timeout on the temp-filesystem `user-layer-*` suites, which is the exact
condition recorded in `batches.md` ("Pre-existing flakiness — not this task's").

Evidence it is not mine:

- `git status --porcelain` lists **nine** paths, **all** under
  `libs/frontend/skill-synthesis-ui/`. This batch changed **zero** files in
  `agent-generation`.
- The failing set is non-deterministic across runs — three separate runs failed
  4, 6 and 3 tests respectively, on overlapping-but-different test names
  (`user-layer-activation-sequence`, `user-layer-mirror.service`,
  `rebase-origins`, the deleted-upstream reap). A real regression does not move.
- **Honest correction to the batch file:** the flakiness reproduces when
  `agent-generation` is run **ALONE** too (`npx nx test
  @ptah-extension/agent-generation --skip-nx-cache` → 3 failed / 967 passed).
  Running it alone reduces the failure count but does not eliminate it, so the
  batch-1 note that it "passed alone: 31 suites / 970" is not reliably
  reproducible on this machine. The cause is unchanged (a 5000 ms default against
  real temp-FS I/O); the mitigation is a per-suite `jest.setTimeout`, which is a
  `future-enhancements.md` item, not a batch-4 change.

**Gate status for this batch's own projects: green.**
`@ptah-extension/skill-synthesis-ui` — 26 suites / 397 tests, all passing,
including `skill-clones-state.service.spec.ts` (the `divergedCount` semantics
pin) and the 15 tests added here.

## Plan deviations

- **The body editor's cancel output is `cancelled`.** The plan says `cancel`;
  batch 3 renamed it for `@angular-eslint/no-output-native`. The drawer already
  wires it internally, so this batch binds only `[canEditBody]`, `[bodySaving]`
  and `(bodySaved)`. My own `BulkRebaseConfirmComponent` follows the same naming.
- **No new RPC method.** `skillSynthesis:saveCloneBody` already exists from batch
  1, so none of the five registration sites — including
  `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` — needed an edit.
- **A second facade extraction** beyond the one the plan pre-authorised. See
  above.
- **`bodySaving` joins `actionsLocked()`.** The plan lists only `bulk.running()`
  and `busySlug()`. A body save is a write to the same slug lock, so excluding it
  would let a rebase start mid-save.
- **`bulk.progress()` is gated on `bulk.running()`** when bound into the toolbar:
  `CloneBulkRebaseService.progress` is not cleared when a batch finishes (only by
  `reset()`), so an ungated binding would leave the button reading
  "Rebasing N of N…" after the batch ended.

## Out-of-scope observations (reported, not touched)

- `@ptah-extension/agent-generation`'s temp-FS suites need an explicit
  `jest.setTimeout`. Pre-existing; see above.
- `skill-synthesis-tab.component.ts` is 1175 lines and already warns on
  `max-lines`. It was over before this batch and my change adds 20 lines. A split
  is its own task.
- `libs/frontend/skill-synthesis-ui/CLAUDE.md` does not yet document the Library
  surface's new bulk rebase or body editor. Documentation was not in this batch's
  file list beyond the 4.4 deletion.
