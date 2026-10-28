# CI bundle budget fix — `TASK_2026_701_9e4b`

## Problem

On PR #832, `ptah-extension-webview:build` exceeded the 4.00 MB initial budget by 5.89 kB. The
`setup-wizard` route loads eagerly, so every setup-wizard component that a parent lists in its
`imports: [...]` ends up in the initial bundle. That includes the new P1/P2 dialogs and the
completion views. I did not raise the budget.

## Change: move on-demand UI behind `@defer`

With Angular 22, a standalone component that a file uses only inside a `@defer` block is
compiled into a dynamic `import()`. Its code, and any code reachable only through it, goes to a
lazy chunk. Each parent below now uses the moved component only inside its `@defer` block. The
component still appears in the parent's `imports` array, and the compiler turns that entry into
the block's dependency loader.

| Parent (eager) | Deferred block | Trigger |
| --- | --- | --- |
| `agent-selection.component.ts` | `<ptah-generation-preview-modal>` | `when preview.isOpen()` |
| `agent-selection.component.ts` | `<ptah-pack-install-prompt>` | `when packRequest() !== null` |
| `community-packs-panel.component.ts` | `<ptah-pack-install-prompt>` | `when request() !== null` |
| `agent-selection-list.component.ts` | `<ptah-agent-preview-dialog>` | `when previewOpen()` |
| `completion.component.ts` | outcome-summary, grade-expectation, library-stale-notice | `on immediate` |
| `agent-next-steps.component.ts` | the same three completion views | `on immediate` |

Supporting edits:

- **New file `completion/outcome-rows.ts`.** It now holds `OutcomeFileRow` and
  `libraryReachable()`, which used to live in `outcome-summary.component.ts`.
  `completion.component.ts` and `agent-next-steps.component.ts` call `libraryReachable()`
  eagerly. Had it stayed in the component file, that eager import would have kept
  `OutcomeSummaryComponent`'s module in the initial graph. `outcome-summary.component.ts` and
  `grade-expectation.component.ts` now import from `outcome-rows.ts`. No re-export shim was
  added.
- **`agent-selection-list.component.ts`.** The `PreviewRowDecision` type import is now a
  separate `import type`, so the component import declaration is used only by the defer block.

Behavior:

- A `when` trigger fires once. After a dialog loads it stays mounted, and its `[open]`,
  `[request]` and other bindings work exactly as before.
- `NativeModalComponent` opens the dialog from an effect, so a dialog first rendered with
  `open=true` still calls `showModal()`.
- No RPC, store or `providedIn` change was made.
- The completion views appear one microtask after their parent instead of in the same render.
  There is no `@placeholder`, so nothing flashes.

## Static check: moved code is no longer in the eager graph

I grepped `libs/frontend` and `apps` for each class name, excluding specs:

- `GenerationPreviewModalComponent`: referenced only from `agent-selection` (deferred).
- `PackInstallPromptComponent`: referenced only from `agent-selection` and
  `community-packs-panel` (both deferred). `community-packs-panel` also mentions it in a JSDoc
  `{@link}`, which is a comment, not code.
- `AgentPreviewDialogComponent`: referenced from `agent-selection-list` (deferred) and the
  barrel `src/index.ts`. No app or lib imports it from the barrel, so tree-shaking drops the
  unused re-export.
- `OutcomeSummaryComponent`, `GradeExpectationComponent`, `LibraryStaleNoticeComponent`:
  referenced only from `completion` and `agent-next-steps` (both deferred).
- The preview-decisions components (`BulkDecisionBar`, `FileDecisionRow`, `ModelOriginNote`,
  `TargetRootChoice`, `DiffDisclosure`, `KeepReplaceControl`): referenced only from the three
  deferred dialogs and from each other.

These files stay eager because eager stores or the list use them:

- `preview-decisions.state.ts` (used by `GenerationPreviewStore` and `AgentSelectionListComponent`)
- `pack-install-result.ts` and `safe-failure-copy.ts` (used by `PackInstallStore` and the panels)
- `generation-preview.store.ts` and `pack-install.store.ts`

## Estimated size moved

The source moved to lazy chunks totals **about 82 kB** (`wc -c`):

| Moved file | Size |
| --- | --- |
| generation-preview-modal | 12.6 kB |
| agent-preview-dialog | 15.1 kB |
| pack-install-prompt | 13.7 kB |
| bulk-decision-bar | 2.3 kB |
| diff-disclosure | 7.0 kB |
| file-decision-row | 3.9 kB |
| keep-replace-control | 6.7 kB |
| model-origin-note | 2.7 kB |
| target-root-choice | 7.5 kB |
| outcome-summary | ~7.5 kB |
| grade-expectation | 2.0 kB |
| library-stale-notice | 1.0 kB |

The compiled and minified size is smaller than the source. A conservative guess is 30–40 kB
removed from the initial bundle, against a 5.89 kB overage. The real number can only come from
CI's build, which I was not allowed to run.

## Spec updates

The tests use Angular's default `DeferBlockBehavior.Playthrough` and wait for the deferred
blocks to load:

- `completion.component.spec.ts`: tests that run change detection now `await settle()`, which
  runs `detectChanges`, then `whenStable`, then `detectChanges`.
- `agent-next-steps.component.spec.ts`: `render()` is now async and awaits `whenStable`.
- `agent-selection.component.spec.ts`:
  - Added a top-level `settle()` that runs three passes of change detection plus `whenStable`.
    It replaces the nested community-tab `settle()` and is also used in the Generate-agents
    tests.
  - The prompt is now located with `querySelector('ptah-pack-install-prompt dialog')`. The old
    `querySelectorAll('dialog')[1]` assumed the preview modal was always rendered.
- `community-packs-panel.component.spec.ts`: `settle()` now runs three passes.
- `agent-selection-list.component.spec.ts`: `openWithSelection()` now renders until the
  deferred dialog has loaded.
- `generation-workflow-shell.component.spec.ts`: the dialog is now expected to be absent until
  it is first opened. I changed the assertion and added a comment saying so.
- `outcome-summary.component.spec.ts` and `grade-expectation.component.spec.ts`: they now import
  `libraryReachable` and `OutcomeFileRow` from `./outcome-rows`.

## Verification

1. Targeted tests:
   - Command: `npm run verify -- -t test -p @ptah-extension/setup-wizard -- --testPathPatterns="(agent-selection|community-packs-panel|completion|agent-next-steps|generation-agent-sidebar|generation-workflow-shell|outcome-summary|grade-expectation)"`
   - First run, before the spec updates: 34 tests failed in 6 suites.
   - After the spec updates: `1 task: 1 succeeded`.
2. Final scoped verify:
   - Command: `npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview`
   - Result: `6 tasks: 5 succeeded, 1 failed`. The failed task is
     `ptah-extension-webview:lint`, which you accepted as a pre-existing failure. The log shows
     no lint details, but I did not touch any webview app file.
   - Setup-wizard lint, test and typecheck, plus webview test and typecheck, all passed.
3. Not run: `build`, as instructed. CI checks the bundle budget after push.

## Files

New:

- `libs/frontend/setup-wizard/src/lib/components/completion/outcome-rows.ts`

Changed:

- `libs/frontend/setup-wizard/src/lib/components/agent-selection.component.ts` and its `.spec.ts`
- `libs/frontend/setup-wizard/src/lib/components/agent-selection-list.component.ts` and its `.spec.ts`
- `libs/frontend/setup-wizard/src/lib/components/community-packs-panel.component.ts` and its `.spec.ts`
- `libs/frontend/setup-wizard/src/lib/components/completion.component.ts` and its `.spec.ts`
- `libs/frontend/setup-wizard/src/lib/components/agent-next-steps.component.ts` and its `.spec.ts`
- `libs/frontend/setup-wizard/src/lib/components/completion/outcome-summary.component.ts` and its `.spec.ts`
- `libs/frontend/setup-wizard/src/lib/components/completion/grade-expectation.component.ts` and its `.spec.ts`
- `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.spec.ts`

I did not touch `libs/backend`, `libs/shared`, `apps`, any task-control file, or git state.

## Decisions

- **Also defer `AgentPreviewDialogComponent`.** It shares all six preview-decisions children
  with the generation modal, so leaving it eager would have kept them in the initial bundle.
  - Options: defer only the generation modal, or defer both dialogs.
  - Evidence: the class-name grep above.
  - Reversible: yes.
- **Use `on immediate` for the completion views.** They render as soon as their parent does, and
  `on immediate` keeps the visible behavior the same.
  - Options: `on viewport`, or `on idle`.
  - Reversible: yes.
