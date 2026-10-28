# Visual review P2 - TASK_2026_701_9e4b

Verdict: ISSUES (Blocking 0, Serious 1, Moderate 5, Minor 3). No P2 surface breaks at 1280 or 400 px. One Serious layout issue at 400 px (sidebar dialog title); the rest are prototype-fidelity and fixture-gap items.

## Environment

- Renderer dist `dist/apps/ptah-electron` built 16:41; no source file under libs/ or apps/ is newer, so it is not stale (head 292e775d5).
- Isolated Electron per scenario through `launchPtah()` + `UiDriver` (temp `--user-data-dir`, temp `PTAH_DB_PATH`, `NODE_ENV=test`, `PTAH_E2E=1`). All RPC mocked in the main process. Every launch ran as `node scripts/verify.mjs --exec --task visual-p2 -- node tmp/p2.cjs <scenario>`. The user's app was never touched.
- Driver: `tmp/visual/p2.ts` (bundled to `tmp/p2.cjs`). Per-shot metrics (scrollWidth, overflow list, computed colours) are in `reviews/visual/p2/<scenario>.json`.
- Themes `anubis` / `anubis-light`; widths 1280 and 400 (`setContentSize`); viewport PNGs only. 56 screenshots in `reviews/visual/p2/`.
- Surfaces were reached with the Angular dev-mode `window.ng` hook (wizard state set directly: recommendations, completion data) and a pushed `setup-generation:open` event for the sidebar shell. This proves rendering, not backend behaviour.
- Cleanup note: one Electron process (pid 9872, started 16:36, temp profile `ptah-e2e-udd-ytZxDj`) was already running before this review started. It is a leftover from the earlier visual review, not from this run; I did not kill it. All instances launched in this review exited.

Path prefix for screenshots: `reviews/visual/p2/`. Names are `<scenario>__<state>__<dark|light>__<wide|narrow>.png`; in the table `{d,l}x{w,n}` stands for the four theme/width combinations.

## Results (surface x theme x width)

| # | Surface (prototype) | dark 1280 | dark 400 | light 1280 | light 400 |
|---|---|---|---|---|---|
| 1 | Wizard preview modal (`wizard-preview.html`) `wizard-preview__modal__*` | PASS | PASS | PASS | PASS |
| 1w | Same, with backend warning `wizard-preview-warning__modal__*` | PASS | PASS | PASS | PASS |
| 2 | Sidebar preview dialog (`sidebar.html`) `sidebar__dialog__*` | PASS | FAIL (finding 1) | PASS | FAIL (finding 1) |
| 3 | Pack install prompt, unreadable + bulk rows (`packs.html`) `packs__prompt__*` | PASS | PASS | PASS | PASS |
| 4a | Completion, mixed outcome + diverged `completion-diverged__page__*`, `__bottom__*` | PASS (finding 3) | PASS (stepper/Quick Start clip, finding 8) | PASS (finding 3) | PASS (finding 8) |
| 4b | Completion, harness-root default `completion__page__*`, `__bottom__*` | PASS | PASS (finding 8) | PASS | PASS (finding 8) |
| 4c | Completion, opened-folder notice `completion-opened__page__*`, `__bottom__*` | PASS (finding 3) | PASS (finding 8) | PASS (finding 3) | PASS (finding 8) |
| 5 | Wizard warning solid fill (contrast) | PASS 6.61:1 | PASS 6.61:1 | PASS 5.67:1 | PASS 5.67:1 |
| 6a | Library cards, provenance badges (`library.html`) `library__list__*` | PASS | PASS | PASS | PASS |
| 6b | Library drawer, badge `library__drawer__*` | PASS (finding 6) | PASS | PASS | PASS |
| 6c | Library drawer, diverged `library-diverged__drawer__*` | PASS (finding 6) | PASS | PASS | PASS |
| 7 | Repair prompt state 4c | NOT REACHED | | | |

Fixture count per surface: wizard modal 3 agents (existing, long id with unreadable file, new; rival definite and conditional rows; model-origin notes); packs 3 files plus one new (differs, unreadable, new); completion 4 outcomes (written, kept, changed-since-preview, current); library 5 clones covering setup-wizard, plugin active, plugin uninstalled ("Orphaned"), skills.sh and workspace.

## Item 5: warning contrast (measured)

Computed styles on `[data-testid="preview-warning"]` (`wizard-preview-warning.json`), converted from OKLCH to sRGB relative luminance:

| Theme | Text (warning-content) | Fill (warning) | Ratio |
|---|---|---|---|
| anubis | oklch(0.1886 0.0081 285.6) | oklch(0.7049 0.1867 47.60) | 6.61:1 |
| anubis-light | oklch(0.28 0.066 53.8) | oklch(0.72 0.18 55) | 5.67:1 |

Both match the figures in the source comment (`generation-preview-modal.component.ts`, 6.61 dark / 5.67 light) and pass WCAG AA 4.5:1 for normal text. Same fill and text at 400 px (the box wraps to two lines, no clipping).

## Findings

### Serious

1. **Sidebar preview dialog: title is covered by the app header at 400 px.** `sidebar__dialog__dark__narrow.png`, `sidebar__dialog__light__narrow.png`. With the sheet open at 400 px the dialog is taller than the viewport; its title sits at y 29-57 and `elementFromPoint` at that position returns the app header (`DIV.flex.items-center.h-10.bg-surface-1`, header band y 56-95 plus the top bar). Title "Review generation targets" is half hidden and cannot be scrolled clear of the bar. The Confirm button is at y 970-1002 (viewport 900) and is reachable only by scrolling the dialog (`scrollIntoView` brought it to 855-887 and it was hit-testable, so it is not lost). At 1280 the dialog is fully visible. Source: `agent-preview-dialog.component.ts` (dialog sizing) with the app-shell layering; the dialog existed before this task but the added rows (model-origin note, rival-CLI info, forced-keep text) lengthen it. Likely pre-dates in cause, aggravated by P2 content. Suggested fix: cap the dialog height with `max-h-[calc(100dvh-...)]` below the header and scroll its body, as the wizard modal does (`wizard-preview__modal__*narrow` shows a contained, scrolling modal with the title clear of the header).

### Moderate

2. **Rival-CLI "information only" block is always expanded and its conditional line reads oddly.** Prototype wizard-preview shows a collapsible "Also copied for other CLIs" disclosure (chevron) per agent; the build shows an always-open dashed box (`generation-preview-modal.component.ts`, `data-testid="info-only-targets"`). With a long list this lengthens the modal at 400 px. The conditional row renders "May also write, if <condition>" so a fixture condition "Written only if ..." reads "if Written only if" (copy depends on the backend condition string; check the string produced by `generation-preview.service.ts`). New in P2.
3. **Completion warnings use a tinted fill, not the solid warning fill.** Stale-Library notice and opened-folder notice render as `warning/16%` background with base-content text (`completion-diverged__bottom__*`, `completion-opened__page__*`; computed bg `oklch(0.7049 0.1867 47.6 / 0.16)`). `packs.html` D and `completion.html` show solid orange with warning-content, and `prototype/README.md` lists the solid fill as a project rule. Contrast is fine (text on tint is far above 4.5:1), so this is fidelity only. Files: `completion/library-stale-notice.component.ts`, `completion/outcome-summary.component.ts:196`. New in P2.
4. **Completion layout differs from `completion.html`.** Real page keeps "Setup Complete!" hero, "Generated Agents (4)" heading, a Quick Start Guide and a bottom "Close" button; in the prototype the "Open the Library" is the single primary action next to "Done", and the outcome panel is the whole card. The Library/grade/stale notices and counters match in wording and order. "Open the Library" is a secondary-styled button inside the diverged notice (`completion-diverged__bottom__dark__wide.png`) instead of the one primary action. Pre-existing hero/guide; the primary-action placement is P2.
5. **Orphaned badge on Library cards is a 9% tint, not the solid orange pill in `library.html`.** `library__list__*` shows "Orphaned" as tinted outline (`badge-warning` at ~9%, computed bg `oklch(0.72 0.18 55 / 0.09)`); prototype uses a solid orange pill. Also the "Diverged" state in the drawer header is dot-plus-text rather than the prototype's solid orange badge. Text contrast is adequate. `provenance-badge.component.ts` (`PLUGIN_STATE_WORD`, `badge-warning`).
6. **Library drawer differs from prototype D.** Real diverged drawer (`library-diverged__drawer__light__wide.png`): actions "Rebase to upstream" / "Keep mine", origin row shows "Setup wizard" only (no "written to <path>"), heading "Upstream changed since this copy was made." Prototype: primary "Review changes and rebase" + "Keep my copy", "Origin: Setup wizard - written to .claude/agents/<file>", and a "Claude model" editor. The model editor did not appear because the `skillSynthesis:getAgentModels` mock returned no lists (fixture gap, not a defect claim). Label drift is real; it is probably pre-existing wording that the prototype changed. File: `clone-detail-drawer.component.ts` (line near 155 for the badge).

### Minor

7. Wizard modal at 400 px: the footer (Confirm/Cancel) is inside the scrolling body and below the fold until scrolled (`wizard-preview-warning__modal__dark__narrow.png` shows the scrollbar); reachable, matches the dialog pattern.
8. Pre-existing, not P2: at 400 px the wizard stepper and Quick Start Guide scroll horizontally (`completion*__bottom__*__narrow.png`, scrollWidth equals viewport, content clipped inside the container). The new P2 blocks (counters, per-file rows, notices) wrap and fit.
9. Sidebar dialog "Other CLIs (information only)" block is not collapsible either (same as finding 2).

## Prototype fidelity

- Wizard preview, pack prompt, sidebar dialog and counters/copy strings: MATCH in structure, copy and single primary action; deviations are findings 2-6.
- Keep/replace control (selected check mark, forced-keep Replace dimmed), bulk bar, target radiogroup with "Default" tag, "Writing to" line, Exists/New/Could not read file badges: match in dark and light.
- Provenance labels on cards match `provenanceLabel` mapping: "Setup wizard", "Plugin: Acme Toolkit", "Plugin: Gone Plugin" + "Orphaned", "skills.sh: acme/skills", "Workspace file".

## Item 7: repair prompt state 4c

Not reached, not forced. The previous review's repair scenario already reported it unreachable: the post-confirm Library notice appears only after the kept-items repair confirm resolves with a Library pass result, and the mocked `plugins:replace-kept-items` reply used there did not produce the notice element in the prompt. I did not extend that fixture in this review (out of the P2 list scope). Treat 4c as unverified visually.

## Not covered

- Sidebar list itself at 400 px (the shell hides it behind the sheet); only the preview dialog was captured at that width.
- Wizard preview loading / error / changed-since-preview states and Library-edited note (`libraryCopyEdited`), ignored-override model note: not rendered in this pass.
- Pack install result/failure states.
- Library drawer model editor and "plugin turned off" state.

## Files

- Driver: `tmp/visual/p2.ts`, `tmp/p2.cjs`.
- Screenshots and metrics: `reviews/visual/p2/` (56 PNG + one JSON per scenario).
