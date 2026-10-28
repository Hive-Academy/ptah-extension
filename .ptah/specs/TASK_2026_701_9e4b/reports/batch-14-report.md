# Frontend implementation: `TASK_2026_701_9e4b`, batch 14 (F1)

**Tasks completed**: Task 14.1 (keep/replace control, row, diff disclosure, bulk bar, target choice, model note, state helper).

**Verdict**: Done. Every target in the batch's verify command passes except `ptah-extension-webview:lint`, the pre-existing D19 circular-dependency error (accepted).

## Files

Folder: `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\libs\frontend\setup-wizard\src\lib\components\preview-decisions\`

- CREATED `preview-decisions.state.ts`: the one decision-state helper shared by the modal, the sidebar and the pack prompt. It is pure functions over immutable `DecisionRow`/`DecisionSnapshot`.
  - Builders: `buildWizardRows`, `buildPackRows`.
  - Re-preview and target reset: `nextSnapshot`.
  - Choices: `setDecision`, `setAllDecisions` (skips forced keep).
  - Footer text: `summaryText` and `confirmLabel` (wizard modal, sidebar dialog and pack templates).
  - Bulk bar: `controllableCount`, `bulkCountLabel`.
  - Wire format: `decisionEntries` (`{decision, revision}` for each replace).
  - `targetsSignature`: the shared targets-changed signature that replaces the two copies in `agent-selection.component.ts` and `agent-selection-list.component.ts`. Those callers switch over in batches 15 and 16.
  - Paths: `agentsFolder`, `targetFolder`.
  - Labels and copy constants, taken verbatim from design-spec section 5.
- CREATED `keep-replace-control.component.ts` (C1).
- CREATED `file-decision-row.component.ts` (C2).
- CREATED `diff-disclosure.component.ts` (C3).
- CREATED `bulk-decision-bar.component.ts` (C4).
- CREATED `target-root-choice.component.ts` (C5).
- CREATED `model-origin-note.component.ts` (C6).
- CREATED a spec for each of the seven files above (`*.spec.ts`).
- NOT MODIFIED `libs/frontend/setup-wizard/jest.config.ts`. No mapper was needed. The diff spec swaps in a stand-in renderer with `jest.resetModules()` + `jest.doMock(...)`. The next section explains why, and what later batches need.

No file outside the batch list was edited. Nothing is exported from the lib barrel yet: the consumers in batches 15-17 are all inside `setup-wizard` and import by relative path.

## Stack observed

- **Framework**: Angular `~22.2.0` (root `package.json`).
  - Standalone, OnPush components with `input()`/`output()`/`computed()`, as in sibling `agent-preview-dialog.component.ts`.
  - Built-in control flow and `@let`.
- **Styling**: Tailwind 3.4 + DaisyUI 4.
  - Tokens come from `apps/ptah-extension-webview/tailwind.config.js` (`surface-1`, `surface-border`, `base-content-muted`) and `styles.css` (`--surface-border-strong`).
  - Solid warning fill follows `agent-selection.component.ts:517`.
  - Icons: `lucide-angular` `Check`, as `agent-selection.component.ts` uses it.
- **Lazy diff**: the runtime `import('@ptah-extension/git-ui/diff-renderer')` pattern from `skill-synthesis-ui/.../lazy-diff-view.component.ts`, including the structural `TextDiffInputs`, so there is no static git-ui import.
- **ThemeService** (`@ptah-extension/core`) supplies the light/dark mode for the renderer.

## Design fidelity

Sources: design-spec sections 2 (C1-C6), 3.1, 3.2, 3.5, 3.8, 4, 5 and 6, and `prototype/wizard-preview.html` + `packs.html` + `assets/proto.css`.

- **C1**: radiogroup of two `<button role=radio>`.
  - Roving tabindex. Arrows move and select; Space/Enter select.
  - Accessible names: "Keep my file <path>", "Replace <path> with generated|pack version", group "Keep or replace <path>". Forced keep adds the suffix "(not available: file could not be read)".
  - Forced-keep Replace: `aria-disabled="true"`, `tabindex=-1`, skipped by arrows, ignored by click and keys. It stays a real, enabled `<button>` so the existing trap query includes it. `aria-describedby` points to the explanation note.
  - Disabled while reloading.
  - 26px segments. Selected Keep is `bg-base-content`/`text-base-100` with a check mark; selected Replace is `bg-warning`/`text-warning-content` with a check mark.
  - Focus ring: 2px `base-content` outline with 2px offset, on every segment including the selected Keep.
- **C2**: path in mono with `overflow-wrap:anywhere`; it takes the full row under 640px.
  - Badges: "New", "Exists — may be replaced", "Already current", "Differs from local file", "Could not read file".
  - Notes:
    - D10 "Unchanged since the setup wizard wrote it".
    - The Library-copy note, Electron only.
    - The unreadable note.
  - New and already-current rows have no control. Unreadable rows have no "What changes".
  - The per-agent model note is projected into the row (`<ng-content>`).
- **C3**: "What changes" with `aria-expanded`/`aria-controls`. The collapsed region is `[hidden]`, so the planned `:not([hidden] *)` trap filter excludes it.
  - Wizard rows show "The generated content is not known until generation runs."
  - Pack rows lazy-load the renderer on the first expand only. A load failure or missing texts shows the unavailable state, and a failed load does not retry itself in a loop.
- **C4**: hidden when no row is controllable.
  - `role=group`, "Apply to all differing files".
  - Count label: wizard "N existing files"; pack "N files can be replaced".
  - Buttons: "Keep all" / "Replace all".
- **C5**: "Where should the agents be written?".
  - Cards: "Project root (recommended)" with the "Default" badge and the per-host helper, and "Opened folder only".
  - Choosing the opened folder shows the per-host solid warning (`role=alert`).
  - When the opened folder is the harness root, there is no choice, only the "Writing to" line.
  - While reloading: `aria-busy` and disabled cards.
- **C6**: the Electron and VS Code matrix strings exactly: applied, ignored, template, none.

Deviations:

1. **Diff colours.** The batch says diff colours `bg-success/15`/`bg-error/15`. Plan A32 (settled) requires reusing `@ptah-extension/git-ui/diff-renderer`, and that renderer paints add/delete rows with its own Pierre theme, which git-ui already contrast-audited (`pierre-config.ts`). The design spec makes `bg-success/15`/`bg-error/15` optional ("Implementer may use..."), so I followed A32 and did not write a second line-diff renderer. Reversible: a custom renderer would be a new primitive.
2. **Segment radius.** `rounded-md` (.375rem) in both themes. The design's light `--rseg` of .5rem is a prototype-only variable, and the rule is no new tokens. This is a proposal for the visual review.
3. **Disclosure label on pack rows.** The prototype's `packs.html` says "Show differences". Section 5 is the single copy source and says "What changes", so I used that.
4. **Copy section 5 does not define.**
   - Pack diff-unavailable text: "The differences could not be shown."
   - Loading text: "Loading differences...".
5. **Card unselected border.** `border-base-content/20` instead of `--surface-border-strong` (22%), because an Angular class binding cannot hold an arbitrary-value class name. The C1 border uses `--surface-border-strong` as a static class.

## States covered

- **Default**: every row is Keep (`nextSnapshot`).
- **Forced keep**: an unreadable file, or an unknown local state on an existing path from an older host. No click, arrow, key or bulk action changes it (D7, D13).
- **Bulk**: hidden at 0 controllable rows; Replace all skips forced keep.
- **Re-preview**: a Replace is carried only on an equal, defined revision. exists(A) → exists(B) and pack differs(A) → differs(B) both reset to Keep. A row that became unreadable resets too.
- **Target change**: resets all rows to Keep and sets the `role=status` line "Target changed. The comparison was run again and every choice is reset to Keep.".
- **Loading**: the control, bulk bar and target cards are disabled; the target group is `aria-busy`.
- **Diff**: collapsed, loading (`role=status`, `aria-busy`), ready, unavailable.
- **Themes**: only theme tokens are used (`base-content`, `base-100`, `warning`, `surface-*`), so light and dark both apply. No screenshots this batch, as instructed. The Electron visual review is at the end of P2.

## Verification

Command (one foreground run):
`npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview`

The run had 6 tasks: 5 succeeded, 1 failed, 0/5 cache hits.

| Project | Target | Result |
| --- | --- | --- |
| @ptah-extension/setup-wizard | test | PASS. 44 suites / 505 tests. 44 equals the lib's spec-file count, which includes the 7 new suites. |
| @ptah-extension/setup-wizard | lint | PASS. 0 errors; 175 warnings, all pre-existing in other files, none in `preview-decisions/`. |
| @ptah-extension/setup-wizard | typecheck (`ngc --noEmit`) | PASS. Only pre-existing NG8107 warnings, in chat-ui and chat. |
| ptah-extension-webview | test | PASS. 22 suites / 600 tests. |
| ptah-extension-webview | typecheck | PASS. |
| ptah-extension-webview | lint | FAIL, pre-existing and accepted (D19): `Circular dependency between "ptah-extension-webview" and "@ptah-extension/command-center"`. No file of this batch is involved. |

`ptah_get_diagnostics` on the 7 source files: 0 errors.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Pack diff uses the lazy git-ui renderer, not custom `bg-success/15` rows | custom LCS line diff; lazy Pierre renderer | plan A32 "settled"; design-spec section 4 makes the tints optional | yes |
| Stand-in renderer via `jest.resetModules` + `jest.doMock` in the spec; no `jest.config.ts` mapper | mapper + new `src/__mocks__` file (not in the batch list); doMock in spec | batch allows only the jest.config change "if needed"; a mock file would be an unlisted file | yes |
| An unknown `localState` on an existing path is forced Keep (shown as "Could not read file"); a missing one on an empty path is New | treat as exists; forced keep | plan F1 failure behaviour "unknown state → forced keep" | yes |
| `decisionEntries` sends only replace entries; omitted ids mean keep | send every row | shared `fileDecisions` doc "Absent = keep" | yes |
| The summary and the "kept" count cover only rows with a control (exists, differs, unreadable) | every row | prototype "3 kept, 2 to replace" matches the controlled rows | yes |
| Replace counts in the confirm label use "file"/"files" | literal "file(s)" | prototype `data-tpl-rep` uses `{files}` | yes |

## Plan deviations

None beyond the design deviations listed above.

## Notes for later batches

- **Batches 15, 16 and 17.** Specs that expand a pack `ptah-diff-disclosure` need the same `jest.doMock` stand-in, or the `jest.config.ts` `moduleNameMapper` plus a `src/__mocks__/ptah-git-ui-diff-renderer.ts` copy (the skill-synthesis-ui precedent). Wizard rows never load the renderer.
- **Callers of `targetsSignature`.** `agent-selection.component.ts:1038-1045` and `agent-selection-list.component.ts:350-360` still have their own copies. Batches 15 and 16 own those files and replace them with `targetsSignature`.
- **Batch 16 (sidebar).** The "Change" collapse ("Target: <path> (project root)") belongs to the sidebar dialog that owns C5; C5 itself is the expanded body.

## Out-of-scope observations

- `ptah_get_diagnostics` reports sibling errors in `generation-run-event-adapter.spec.ts` and `libs/shared` (BigInt target). They come from its own compiler settings; the project's `ngc`/jest runs pass.
