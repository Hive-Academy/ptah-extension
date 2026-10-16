# Prototype Delta 1 notes (decisions rows 21-23; aligned to design-spec.md 4.6, D27-D33)

Files touched: `index.html`, `assets/app.js`, `assets/app.css`, `assets/capture.mjs`, `assets/sprite-extra.js`, `screenshots/`. Checks: `node assets/capture.mjs checks` = 122 PASS, 0 FAIL
(Section K is new). `node assets/contrast-check.mjs` = 34 themes, 34 pass (no colour added: the pill and links reuse the measured `--state-ink-*` and `--ptah-link` tokens).

## Item to implementation to check

| Item | Where | States and check |
| --- | --- | --- |
| 1 TASK section (between AGENTS and TODOS, D-order) | `app.js`: `taskHTML()`, `taskSec()`, `taskIdRow()`, `tpill()`, `taskStage()`; section id `taskSec`, `--i:7`; `app.css`: block "Inspector TASK section" | K1 order check (AGENTS < TASK < TODOS), ID + title + pill + stage, no horizontal overflow, docked and 400 px sheet |
| Status pill: outline, measured inks, `TASK_STATUS_LABELS` words (D29) | `tpill()`, `TASK_LABEL`, `TASK_INK` (`s-run`, `s-need`, `s-err`, `s-done`, muted); CSS `.task-pill` (transparent fill, `border-color: color-mix(currentColor 55%)`, 120 ms colour transition) | K1: text "In Progress", computed background transparent, solid border |
| Stage (derived), not Phase (D31) | `STAGE_LADDER`, `taskStage(files)`; row `.task-stage` with `title` "Derived from the documents in the task folder"; omitted when nothing derivable | K1: "Stage: Design", no "Phase" word; K4 partial: Stage hidden |
| Documents list, `+N more documents` | `.task-files` (`ul`, aria-label "Task documents"), 6 rows at rest of 9 mock files, button `data-act="task-more"` (`aria-expanded`, aria-label "Show 3 more documents") | K1: 6 native buttons >= 24 x 24, "+3 more documents" >= 24 x 24, Tab order, Enter expands to 9, focus stays |
| Row action opens the file | `data-act="task-open"`; mock only: a prototype-only hint (`taskProtoHint`, `aria-hidden`, class `proto-out`) says the editor opens the file. The product shows no toast and announces nothing (4.6) | K1: no live-region text after open, focus stays on the row, ExternalLink visible without hover, 2 px focus ring |
| `task=multi`: `+2 related tasks` | `data-act="task-rel"`; related rows are plain `li` (no controls, D30) | K2: button >= 24 x 24, `aria-expanded`, 2 rows, zero interactive descendants, focus stays |
| `task=loading` | `taskHTML()` skeleton (12 x 160, 16 x 224, 20 x 96, two 24 px bars), `aria-busy="true"` | K4 |
| `task=error` | ID row + `role="alert"` + Retry (`aria-label` "Retry loading task", 42 x 24); busy: `aria-busy`, `loader-circle` spinning, message kept; success moves focus to the task title (`#taskTitle`) | K3 |
| `task=partial`, `task=notfound`, `task=openfail` (extra states of 4.6) | "No documents yet" (`role=status`), "Task folder not found" (no Retry), row-level `role=alert` "Could not open task.md" + Retry under the section content, focus stays on the row | K4 |
| `task=none` (D27) | `taskHTML()` returns `''`: no heading, no row. Also not rendered for `body=empty` / `body=loading` (link unresolved) | K4, K5 |
| `task=live` (D32) | `taskFlip()`: after 2 s the pill text and ink change in place (In Progress to In Review). No skeleton, no `aria-busy`, no announcement, no animation beyond the 120 ms colour transition | K4: before/after text, empty live region |
| Sprite icons | `sprite-extra.js`: added `folder-kanban`, `external-link` (lucide paths); `file-text`, `loader-circle`, `triangle-alert` already present | rendered in screenshots |
| 2 B-16 time and "You" visible at rest | `index.html`: `<p class="cs-user-meta">You · <time datetime title>` under each user bubble; CSS `.cs-user-meta`. There was no hover-only rule in the prototype to revert (the meta line did not exist); none was added | K6: both turns, opacity 1, visible |
| 3 B-14/B-15 hover reveal only | `app.css`: removed `.cs-user-actions:focus-within` from the reveal rule; hover, `parity=1`, `hover: none` and the 639 px container rule are unchanged | K6: opacity 0 at rest, 0 on keyboard focus, 1 on hover |
| 4 capture + screenshots | `capture.mjs` section K; `shots` adds `{dark,light}-task-{linked,multi,loading,error,partial,notfound,none}` and interaction shots `task-multi-related-open`, `task-docs-expanded`, `task-open-failed`, `task-live-flipped`, `task-artifact-opened`, `task-artifact-focus`, `task-narrow-400-sheet` | 79 PNGs regenerated, dark and light |

New query values: `task=linked|multi|live|loading|error|partial|notfound|openfail|none` (default `linked`); new proto-bar group "Task".

## Decisions and flags

- Mock data: lead `TASK_2026_677_efcd` has 9 files (stage derives to Design because `implementation-plan.md` is absent), two related tasks. The coordinator's earlier brief listed an
  `implementation-plan.md` row and a "Phase" line; both were superseded by 4.6 (derived Stage, `+N more documents`), so they are not shown.
- Row-level open failure sits at the end of the section (not directly under the list) so that Retry is last in tab order as 4.6 requires. Reversible.
- RESIDUAL RISK (user decision row 23, kept as instructed): with the focus reveal reverted, Branch and Rewind are in the Tab order (docked order stops 3-4 and 15-16) but are invisible
  while focused (opacity 0). That is a WCAG 2.4.7 focus-visibility gap that exists in today's product too. The spec designer should list it as an accepted limitation or a follow-up.
- The prototype-only hint after opening a document is a prototype device and is not a product element; it is `aria-hidden` and carries `proto-out` styling.
