# Visual Review - Gate V 36, Agent Orchestration tab (TASK_2026_555)

**Disclosure: same-side review.** The authors of this tab were in-process subagents, and no image-capable CLI lane
was available, so this review is by the same side that wrote the code. Evidence is from committed captures read as
images, a fresh webview build, the committed Playwright specs, and a throwaway probe spec (deleted after the run).

## Summary

| Metric            | Value                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| Verdict           | **FAIL** (maps to NEEDS_REVISION: 0 visual-breaking, 4 serious; all four fixes are small) |
| Overall score     | 6/10                                                                                    |
| Visual breaking   | 0                                                                                       |
| Serious           | 4 (V36-1 .. V36-4)                                                                      |
| Moderate          | 3                                                                                       |
| Minor             | 3                                                                                       |
| Viewports tested  | 1024x768 only, vscode and electron hosts, anubis and anubis-light (4 combinations)      |
| Captures examined | 22 committed `current-orchestration-*` images + 2 prototype images + 1 probe screenshot |
| Components tested | policy bar, order popover, matrix, model / effort / permission / Copilot / Cursor popovers, tier and add modals, roles `<details>`, role popover |

The structure, density and fold work is sound. The four serious items are one real keyboard-access bug, two
legibility issues (size and contrast) and one coloured-text case that breaks approved deviation 6.

## Environment

- Worktree `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign`, head `e75a1cf31`.
- Build confirmed: `npx nx build ptah-extension-webview --skip-nx-cache` (fresh, exit 0, 52 s) before any browser run,
  served by the harness fixture server (`useAppBuild: true`).
- Harness run as specified: `settings-orchestration` + `settings-visual` specs, `--workers=2`: **36 passed**. The run
  logged the fold lines quoted below.
- Probe spec (temporary, removed): 16 + 4 + 4 + 4 scenes over the same 4 host/theme combinations: DOM text audit,
  Tab walk, axe-core 4.x, Esc / backdrop checks for 8 overlays.
- All 96 `current-*` files were backed up to `/tmp/g36-backup` before the runs and restored afterwards; `git status`
  shows no modified tracked file and no `baseline-*` touched. Probe outputs are kept in
  `screenshots/gate-v36/` (not `current-*`).
- Sizes: the repository's gate size is 1024x768 (batches.md Batch 36). No other widths were opened, so no claim is
  made for other widths. Standard applied: WCAG 2.2 AA (4.5:1 normal text, 3:1 components, 24x24 targets) plus the
  gate's own rules (helper text >= 12 px, no coloured text, table-xs).

## Fold, density and structure (checked)

| Check                                              | Result                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Order policy bar -> matrix -> roles `<details>`     | Matches the prototype in all 4 combinations                                                    |
| `table-xs` on the matrix and the roles table        | Yes, both (`table table-xs w-full`); row heights 33-95 px VS Code, 43-113 px Electron          |
| Roles `<details>` closed by default                 | Yes (captures; spec 36.1 asserts it)                                                           |
| VS Code fold (<= 660 px)                            | PASS: policy bar 125, matrix header 206, first row 247, roles summary 643, both themes         |
| Electron fold                                       | 779 px, 119 px over 660; logged, not enforced. **User item 4 / Batch 31 (a) / Batch 33 (a); not re-raised** |
| One primary action per region                       | Yes: bar none (Re-detect is outline), matrix `Add Ptah CLI Instance`, roles none; modals: `Done` / `Create Instance` only |
| Coloured TEXT (`text-primary/error/warning/success/info`) in the tab's own components | None. Colour is on icons, dots and badges only (deviation 6). Exception: V36-4, in the shared picker |
| Esc closes every overlay and returns focus          | Effort, permission, Copilot, Cursor, order, role, tier modal, add modal: yes. Model popover: two Esc (V36-5) |
| Backdrop click closes every overlay and returns focus | Yes for all 8 (clicks at x=1020 hit the headless page scrollbar and were discarded; the same clicks at other points closed the modals) |
| axe `nested-interactive`                            | 0 violations (also with every popover and modal open; no new nested-interactive)               |
| Visible focus ring on in-tab stops                  | Yes, every stop has a 2 px outline (VS Code and Electron, both themes; see V36-1 for the stops that are invisible by construction) |

## Defect table

| ID     | Severity | Capture / scene                                                                                       | What is wrong                                                                                                                                                                                                                                                                                                                                                                                                            | What the prototype / pattern requires                                                                                                                                                       |
| ------ | -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V36-1  | Serious  | Probe "hidden dialog focus", all 4 combos. Evidence `screenshots/gate-v36/hidden-vscode-anubis.txt`, `hiddenfocus-vscode-anubis.png`, `focus-vscode-anubis.json` | Keyboard focus enters the **closed** add-instance and tier-mapping dialogs. After the last matrix control (Install guide for Pi), Tab lands on `Close`, the Instance name input, the provider select, `Cancel`, a full-viewport `close` backdrop button, then the tier dialog's `Close` and `Done`, about 10 stops in total. The dialogs have no `open` attribute but compute `display:grid; visibility:visible; opacity:0; pointer-events:none`, so the controls are focusable and invisible. The screenshot at that moment shows no focus indicator anywhere. Cause: the shared `NativeModalComponent` template (`libs/frontend/ui/src/lib/native/modal/native-modal.component.ts:75-89`, class `modal`) uses daisyUI `.modal`, whose `display:grid` overrides the UA `dialog:not([open]){display:none}`. | A closed dialog is not in the tab order or the accessibility tree (WCAG 2.4.3, 2.4.7). Fix in the shared modal (e.g. `dialog.modal:not([open]){display:none}` or `inert` while closed). The same component serves the Providers modals, so re-check them. |
| V36-2  | Serious  | `current-orchestration-*` (all); probe `dom2-*.json`                                                   | Non-badge helper text is below 12 px. 10 px: matrix subtitle "Click model or effort cells..." (matrix `:83` area), version and provider sublines ("v1.4.0", "OpenAI Codex"), "Uninstalled CLI agents" group header, the roles-summary list, the Judging & enhancement note, the Test result line (`cli-orchestration-matrix.component.ts:270`), the order arrows. 11 px: "Order:" label and the five order chips (custom `text-[11px]`, not badges), the roles-table helper line. **In Electron the Provider column is hidden and the provider name survives only as the 10 px subline** ("OpenAI Codex", "Ollama Cloud", "GitHub Copilot" in `current-orchestration-electron-anubis-1024x768.png`), so a data value is carried at 10 px. Accepted and not counted: badges (9 px `badge-xs`), `btn-xs` labels (11 px), shared `table-xs` column headings (11 px). | Helper text >= 12 px (gate rule). Move these to `text-xs` (12 px); the provider name in the narrow layout should be at least 12 px. |
| V36-3  | Serious  | `current-orchestration-vscode-anubis-light-*`, `electron-anubis-light-*`, `...-anubis-1024x768` (header); probe `axefull-*.txt` | Muted text fails AA at the small sizes. Light: "Order:" label 4.45:1 (#81636e on #efeae6, 11 px), matrix subtitle 4.45:1 (10 px), "Uninstalled CLI agents" header **4.14:1** (#81636e on #e7e2df, 10 px), roles-table helper line 4.45:1 (11 px). Dark: the same "Uninstalled" header **4.39:1** (#8e8887 on #242430, 10 px), in both hosts. | 4.5:1 for normal text. Gate V 50 decision 4 (shared muted token raised in anubis-light, after the merge) covers the three light 4.45 cases, but **not** the 4.14 header (darker row background) and **not** the dark 4.39 header. Use `text-base-content` (as the roles summary already does, deviation 6 comment) or raise the dark token too. |
| V36-4  | Serious  | `current-orchestration-role-popover-vscode-anubis-light-1024x768.png` and `...-electron-anubis-light-...`; probe axe (judge popover open) | The "3 models . 2 support tool use" pill in the role popover is **coloured text**: `text-xs text-info` on `bg-info/10` (`libs/frontend/ui/src/lib/native/provider-model-picker/provider-model-picker.component.ts:246`). Measured 2.35:1 in light (#00a4f2 on the tint). | Deviation 6 (approved): colour on icons/dots/badges, text stays `text-base-content`. AA 4.5:1. Fix: keep the info tint and icon, set the label to `text-base-content`. The pill is shared with the Providers drawers. |
| V36-5  | Moderate | Probe "overlays", all 4 combos                                                                         | The Model popover (compact searchable field) needs **two Esc** to close: the first closes the field's list (focus is on a `combobox` with `aria-expanded=true`), the second closes the popover and returns focus to the cell (verified, second Esc returns focus). The same family as user item 8 (tier modal), but this one is not on the user list. | Esc closes the overlay (one press), or the two-step is accepted once for all searchable fields. Add to item 8's decision. |
| V36-6  | Moderate | `current-orchestration-roles-open-*`                                                                  | The roles table has a **Scope** column heading with an empty cell in every role row, both hosts. The prototype's roles table has no such column.                                                                                                                                                                                                                                                                         | A column that never shows content should not take a heading and width; show it only when a workspace override exists, or hide the header. |
| V36-7  | Moderate | `current-orchestration-electron-anubis-*`                                                              | Electron matrix: Status and Provider collapse into the Agent cell (acceptable), but the Ptah-instance Actions stack to three lines (Tiers+Edit / Test / Delete), driving the Glm row to 113 px and the Cursor/Antigravity rows to 61 px. Fold overrun contributor (see item 4).                                                                                                                                                        | Prototype row is a single line; no action wrapping. Part of user item 4's decision, listed here so the decision sees the cause. |
| V36-8  | Minor    | Probe axe, order popover open                                                                          | `heading-order` (moderate in axe): the popover title `#policy-order-title` skips a level.                                                                                                                                                                                                                                                                                                                              | Heading levels do not skip; or use a non-heading title.                                                                                                                                     |
| V36-9  | Minor    | `current-orchestration-popover-model-vscode-anubis-1024x768.png`                                      | The model search field's placeholder is cut off at the right edge ("Search models (e.g. gpt-5, sonnet").                                                                                                                                                                                                                                                                                                                | Shorter placeholder or smaller example text.                                                                                                                                                |
| V36-10 | Minor    | `current-orchestration-vscode-anubis-1024x768.png`                                                     | The Actions column is empty for Codex, Antigravity, Copilot and OpenCode; the prototype shows a per-row Test (and Details). Only Ptah instances have Test. It reads as an empty column.                                                                                                                                                                                                                                  | Confirm with the user (item below); no capability exists for Test on system CLIs.                                                                                                            |

## Prototype fidelity

- Approved prototype: `prototypes/final/orchestration.html`, `screenshots/orchestration-{anubis,anubis-light}-1024x768.png`.
- Fidelity assessment: **MATCHES** in structure and hierarchy, with recorded deviations (all approved or on the
  user list). Not a unapproved substitution of badges, tooltips or hints.
- Matches: policy bar above the matrix above a collapsed Background Model Roles; badge components for status,
  permission and tier; "i" info buttons beside permission badges; "Uninstalled CLI agents" group with Install guide;
  Ptah CLI row with tier badges and Tiers/Delete; one primary button.
- Deviations: density is table-xs (41-61 px rows) against the prototype's 56 px (plan 1049-1052, not a defect);
  "Order:" instead of "Preferred Order:" and no "lanes" suffix (Batch 33 (c), user list); Electron order chips fade
  after the third chip (Batch 33 (b), user list); the prototype's "Sandboxed Port" copy is replaced by "Follows
  Autopilot" (item 2, user list); Copilot and Ptah-instance permission copy (item 1, user list); Pi package name
  (item 3); install-guide copy (item 4 of Batch 30); Edit and Credentials actions are additions the prototype does
  not show; the prototype's per-row Test and "Quota reached / Ready (112ms)" statuses are fixture-dependent and not
  rendered in the captures (V36-10).
- Both themes and the narrow (Electron, ~660 px content) versus wide (VS Code, 830 px content) layouts compared.

## Viewport results

| Combination                  | Elements checked                                   | Status | Evidence                                                    |
| ---------------------------- | -------------------------------------------------- | ------ | ----------------------------------------------------------- |
| vscode / anubis, 1024x768    | tab, 6 popovers, 2 modals, roles open, fold         | pass with V36-2/3 | `current-orchestration-*-vscode-anubis-*` |
| vscode / anubis-light        | same                                               | pass with V36-2/3/4 | `...-vscode-anubis-light-*`                          |
| electron / anubis            | same plus fold                                     | fold 779 px (item 4); V36-2/7 | `...-electron-anubis-*`                         |
| electron / anubis-light      | same                                               | same plus V36-3/4 | `...-electron-anubis-light-*`                        |

No horizontal scroll in the harness fold lines (`scroll 0/0`). No other viewport was opened.

## Component and interaction results

| Component                  | States tested                                              | Status                         |
| -------------------------- | ---------------------------------------------------------- | ------------------------------ |
| Order popover              | open, Esc, backdrop, disabled ends, held-save focus (spec) | pass (V36-8 minor)             |
| Model / effort popovers    | open, Esc, backdrop, focus return                          | model: 2 Esc (V36-5); effort pass |
| Permission, Copilot, Cursor popovers | open, Esc, backdrop, focus return                | pass                           |
| Tier and add modals        | open, Esc, backdrop, focus return, Tab containment         | pass when open; V36-1 when closed |
| Roles details / role popover | closed default, open, Esc, backdrop                      | pass (V36-4 pill, V36-6)       |
| Matrix focus walk          | 44-stop Tab order in VS Code, DOM order, ring on each      | pass; V36-1 appended stops     |

## Accessibility audit

- axe (scoped to the tab, closed and with roles open): VS Code dark 1 `color-contrast` (V36-3 header); light 3-4
  (V36-3); Electron the same. 0 `nested-interactive`, 0 label or name failures. With overlays open the only extras
  were V36-4 and `heading-order` (V36-8).
- Targets (probe focus walk): ghost `btn-xs` actions 24 px tall (>= 24 AA); the `i` info buttons 20x20 (below the
  24x24 AA minimum, but spaced from neighbours by the 24 px spacing exception); toggles and model/effort text buttons 16 px
  tall (inline controls inside 41 px rows; spacing exception applies). Recorded, not filed. The 44 px figure is vendor
  guidance and is not applied.
- Focus: ring width 2 px on every in-tab control. V36-1 is the only keyboard defect.

## Design system compliance

- Colour-only-on-icons (deviation 6): honoured in `cli-orchestration-matrix`, `orchestration-settings`,
  `provider-consumer-assignments`; violated once in the shared picker (V36-4).
- Density `table-xs`: honoured (class check in the probe).
- Helper-text size: violated, see V36-2.

## Visual performance

No layout shift was observed in the harness runs (`scroll 0/0`, settled before capture). The matrix loads from a
deferred chunk with a 22 rem placeholder (`orchestration-settings.component.ts:45`), so a loading state is visible.
Animation was not measured.

## Items for the user's review

Not re-raised as defects (already on the Batch 36 list in batches.md): 1 Copilot and Ptah-instance permission copy; 2
the dropped "Sandboxed Port" copy; 3 Pi package name; 4 (Batch 30) install-guide copy, and open item 4, the Electron
fold (779 px); Batch 31 (a)-(c) (Cursor stacking, Undo then Esc, Cursor key without a check); item 8 (two Esc in the
tier modal); Batch 33 (a)-(c) (fold, order chips clip, "Order:" label); Batch 34 copy (#45 model count, "Test
failed: {reason}").

New for the user:

1. **Model popover Esc (V36-5):** extend the item 8 decision to every searchable field: one Esc or two?
2. **Per-row Test on system CLIs (V36-10):** the prototype shows Test for Codex, Antigravity, Copilot; the build has it
   only for Ptah instances. Keep as is (no capability) or add?
3. **Provider name in Electron (V36-2):** once it is at 12 px the Agent cell grows further, which adds to item 4. The
   user's fold choice should be made with that in view.
4. **V36-1 and V36-4 touch shared components** (`NativeModalComponent`, `provider-model-picker`) used by the Providers
   tab; the fix needs a Providers re-check.

## Verdict

- Recommendation: **REVISE** (FAIL: 4 serious, 0 visual-breaking).
- Confidence: HIGH for V36-1 to V36-4 (measured, reproduced in all 4 combinations); MEDIUM on the overall score.
- Key concern: V36-1, keyboard users tab through about ten invisible controls from the two closed modals.
- Score: 6/10 (works with real gaps). What separates it from 7-8: a reproducible keyboard-access bug and AA misses in
  both themes. What separates it from 4-5: structure, density, fold (VS Code), overlay behaviour and axe
  `nested-interactive` are clean.
