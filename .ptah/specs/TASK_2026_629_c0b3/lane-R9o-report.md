# Lane report: R9o, panel Turn summary in the inline mini-card style

TASK_2026_629_c0b3. Batch R9o, item 11, decisions 76 and 77. Executor: Claude frontend-developer (fd-R9o). No git was run.

## Files changed (under `libs/frontend/chat-ui/src/lib/`)

| File | Change |
| --- | --- |
| `organisms/display-panel/turn-summary-mini-card.styles.ts` (new) | Holds the shared look. `TURN_SUMMARY_MINI_STYLES` (:21) has the collapse pattern, `dp-toggle`/`dp-chevron` and the auto-fit `.ts-mini-grid`. It also exports `MINI_SECTION_CLASS` (:42), `MINI_CARD_CLASS` (:46), `MINI_LABEL_CLASS`, `MINI_VALUE_CLASS`, `MINI_WORD_CLASS` and `MINI_CAPTION_CLASS` (:49-60), plus `miniValueClass()` (:66), `MINI_PILL_CLASS` (:77, the chip's old one-line pills) and `MINI_CARD_PILL_CLASS` (:91, pills that wrap inside a 104 px card). |
| `molecules/turn-recap/turn-summary-chip.component.ts` | Its local `CHIP_STYLES`, `METRIC_CLASS`, `MINI_*` and `isStatusWord` are gone. It now imports them from the shared file (:14-26, `styles` :83, card :144, `miniValueClass` :346). The rendered classes are byte-identical, so the chip looks the same. |
| `organisms/display-panel/turn-summary.component.ts` | Rewritten in place. The section is flat `base-200`, built from `MINI_SECTION_CLASS`. Each stat is a chip mini card and also a toggle (`MINI_CARD_TOGGLE_CLASS` :392). The grid is :219. The `actionError` alert (:292) sits under the grid. The open detail regions (:305) stack under it in card order. Files detail is at :330 and Tests detail at :339. `SUMMARY_STYLES` (:84) holds only the panel's hover, open ring and failed-tests ring, all as inset shadows so nothing shifts. Duration is labelled "Time" (:69). |
| `organisms/display-panel/turn-summary.component.spec.ts` | Updated for the new head (captions replace units and pills). Added tests: Time label :185, Tokens in·out caption :200, detail rows for Lines/Tokens/Cost/Time :209, Escape on an open card toggle :296, fixed grid with stacked details :311, alert position :489, mini-card look :584-616. The styles file is added to the D14 import check (:644). |
| `molecules/turn-recap/turn-summary-chip.component.spec.ts` | Added test :457, which checks that the chip uses the shared section and card classes and `TURN_SUMMARY_MINI_STYLES`. |
| `organisms/display-panel/turn-summary-files.component.ts` | Unchanged. It renders correctly inside the new `base-300` detail well. |
| `organisms/display-panel/turn-summary-tests.component.ts` | Unchanged, same reason. |
| `organisms/ptah-ui/ptah-ui-display-chip.component.spec.ts` | Unchanged. It was run as a regression check. |

`display-panel.component.ts` is not touched, and its inputs are unchanged (decision 77). Its `ptah-turn-summary` binding `[summary] [actionError] (openFile) (review)` is the same. The test ids it uses (`turn-summary-card-toggle-files`, `turn-summary-file-action`, `turn-summary-review-all`) still exist.

## Kept from the old panel summary (parity checklist)

- [x] **71**: Compact Files/Lines/Tokens/Cost/Time cards with detail. The cards are mini cards in an auto-fit grid. That is 1 column below about 104 px, then as many columns as the panel width allows: 6 in one row at about 700 px, 3 per row at about 360-400 px. Every card expands. The section toggle stays open by default and collapses with Escape.
- [x] **106**: Files mini card ("6 / changed") with per-file actions. Expanding it shows `ptah-turn-summary-files` with status badges, rename origin, counts, Review/Resolve per file, Review all, pages of 50, "+N more files not listed" and the reconciled `<details>` group. Pills show "N conflicted" and "baseline missing".
- [x] **107**: Lines mini card reads `+45 −8`, or `?` with "counts unavailable". The detail shows Added and Removed.
- [x] **108**: Tokens card shows the total with the caption "180.0k in · 4.2k out", which is the chip's string. The detail shows Input and Output.
- [x] **109**: Cost card keeps "unavailable" as a word and never shows $0. It adds the caption "not reported", and its detail shows Turn cost and the "No cost was reported" note. The Time card's detail shows Elapsed.
- [x] **110**: Tests card shows `1/3` with the caption "1 passed, 1 failed, 1 unknown". Pills show "in background" and "incomplete". When `polarity: 'bad'` the card has an error ring. The detail is `ptah-turn-summary-tests`: progress bar, runs, failure lines and Full command.
- [x] **111**: A conflict still forces Files open until the user toggles it. The `actionError` `role="alert"` sits under the cards. It is outside every inert or collapsible region, so it shows even while Files is collapsed.
- [x] Keyboard and accessibility: every card is a native button with `aria-expanded`/`aria-controls`. Each region has `role="region"` and `aria-labelledby`, and collapsed regions are `inert` and `visibility:hidden`. Escape on an open card, or inside its detail, collapses that card and refocuses its toggle; otherwise Escape collapses the section. Cards show a focus-visible outline. Motion runs only under `prefers-reduced-motion: no-preference`. Axe reports no violations, collapsed or expanded.
- [x] Theme: only DaisyUI/Tailwind tokens (`base-200/300`, `--bc/--p/--er/--b3` via `color-mix`, `diff-add-text`/`diff-del-text`). No hard-coded colours.

## Spec results

All three were run one at a time from W through `node .ptah/tmp/check-run.mjs R9o -- npx nx test @ptah-extension/chat-ui --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`:

| Spec | Result |
| --- | --- |
| `turn-summary.component.spec.ts` | 1 suite, **32 passed**, 32 total |
| `turn-summary-chip.component.spec.ts` | 1 suite, **24 passed**, 24 total |
| `ptah-ui-display-chip.component.spec.ts` | 1 suite, **28 passed**, 28 total (the lock waited 70 s) |

`ptah_get_diagnostics` on the three changed source files found no errors. The sibling errors it lists are already in the tree and none is in an R9o file: `streaming-quotes`, `compact-session-*` specs, `mock-rpc-service.ts`, `capability-id-codec.ts`. TC and LINT for chat-ui are left to Mode 2, as the batch says.

## Decisions

- **R9o-D1: details stack under a fixed grid.** The old design spanned an open card across the row. Expanded details now sit under the card grid, in card order, and the grid never reflows. With an auto-fit mini grid, a row-spanning card would leave holes in the row or reorder the cards, which looks broken on video. Several details can still be open at once (forced Files plus user picks). Each detail well repeats its card's icon and label (aria-hidden) so stacked details stay readable.
- **R9o-D2: no hero gradient, Host pill kept.** The warm hero gradient and the "host-built" subtitle (decision #13) are dropped in favour of the chip's flat `base-200` surface (decision #70), as decision 76 asks. The Host pill still marks the section as host-built.
- **R9o-D3: values match the chip exactly.** Value and caption strings match the chip's for the same turn (Lines `+a −d`, Tokens caption, Tests caption = `card.label`, "Time"). The chip builds its own strings, and the panel builds the same ones in `headOf`. A shared builder would need a ninth file, so it was not added.
- **R9o-D4: captions replace most pills.** Status that the chip shows as a caption is a caption in the panel too ("counts unavailable", "changed", "not reported", the tests label). Pills remain only for panel-only flags: conflicted, baseline missing, in background, incomplete. Inside cards they use `MINI_CARD_PILL_CLASS`, which wraps, so "baseline missing" never overflows a 104 px card.
- **R9o-D5: files and tests children unchanged.** `turn-summary-files.component.ts` and `turn-summary-tests.component.ts` read well inside the new detail well, so I left them alone. That keeps every per-file and per-run selector stable for `display-panel.component.spec.ts` and the e2e specs.
- **R9o-D6: shared styles live in organisms.** Per the plan, the shared file is in `organisms/display-panel/`. The chip, a molecule, imports it from there. No lint rule inside the library forbids this, but it is an upward import in atomic-design terms. Moving the file to a neutral folder is a possible follow-up.

## Risks

- `display-panel.component.spec.ts` and `libs/frontend/chat` host specs were **not run**, because this lane is limited to its three specs. They depend on preserved hooks: `turn-summary-card-toggle-files`, file action and Review all. Mode 2 should include `display-panel.component.spec.ts`, or a full chat-ui run.
- The visual check is still open: jsdom cannot lay out the auto-fit columns or the hover and ring states. Electron re-check step 10 should capture dark and light screenshots of the compact Turn summary in the Rail dock and the single-view dock, at 320, 400 and 700 px panel widths.
- Contrast: the muted label and caption text on `bg-base-300` uses the same tokens the chip already ships, and was not newly measured. Include it in re-check step 11 for `anubis-light`.
- In a 104 px card, a long Lines value such as `+12345 −6789` wraps at its space onto two lines. Cards in the same row stretch to equal height, so the grid stays aligned.

## Fix round (codex-review-R9o.md)

Finding 1 (Serious): a new turn inherited the previous turn's card and section choices, so a saved `files=false` hid Files on a new conflicted turn. Fixed. `display-panel.component.ts` and its inputs are unchanged (decision 77).

### Change

- `libs/frontend/chat-ui/src/lib/organisms/display-panel/turn-summary.component.ts:105-123`: new `turnKeyOf(summary)`. `TurnSummaryModel` has no turn id (`turn-summary.model.ts:138-154`). The key is therefore `files.changeSet.sessionId` + `turnStartedAt` (`rpc-change-set.types.ts:47-52`, the prompt submission that started the turn). Marks and late test outcomes never change it. A turn with no files falls back to its test runs' `project` + `command` list. That list stays stable while outcomes resolve (running to passed).
- `turn-summary.component.ts:428-451`: `turnKey = computed(...)`. `sectionOpen` (default `true`) and `userOpen` (default empty map) are now `linkedSignal({ source: turnKey, ... })`. They were plain `signal`s. Because the source is a string, a re-render of the same turn (new model object, same key) keeps every choice. A different key restores the defaults. `linkedSignal` already has local precedent (`declarative-dashboard/.../surface-layout.component.ts`, `chat/.../local-tts-panel.component.ts`; Angular 22.1.7 per `package.json:97`). `isOpen`, `toggleCard` and `collapseCard` are unchanged.
- `turn-summary.component.ts:144-146` (class doc) and `:465-469` (`isOpen` doc) record the per-turn lifetime and the conflict rule.

### Rule chosen

- **Disclosure lifetime: one turn.** Card choices and the section choice reset when `turnKeyOf` changes. They survive any re-render with the same key.
- **Conflict force-open (parity 111):** Files is forced open for every turn whose Files card has `conflictedCount > 0`, unless the user toggled Files during that same turn. Within one turn, the user's choice wins, as before ("until the user toggles it", parity section 2). A closed Files stays closed if a later mark update of the same turn adds a conflict.
- **Known limit (documented in `turnKeyOf`):** two consecutive file-less turns that ran exactly the same test commands read as one turn and keep the choices. No better stable identity exists in the model without changing the host's inputs.

### New cases (`turn-summary.component.spec.ts:358-421`, describe "disclosure state lasts one turn")

1. Turn A (conflicted): close Files. New conflicted turn B: Files `aria-expanded="true"`, region not inert, file rows rendered.
2. Turn A: open Tokens and Tests, and collapse the section. New turn B: every card `aria-expanded="false"` and the section `aria-expanded="true"` (defaults).
3. Same turn re-render with changed marks: the closed Files stays closed despite the conflict, and the open Tokens stays open.
4. File-less turn: Tests opened while running stays open when the outcome becomes passed (same commands). A turn with different commands resets it to closed.

### Spec results (lock runner, one at a time, from W)

- `node .ptah/tmp/check-run.mjs fix-R9o -- npx nx test @ptah-extension/chat-ui --testFile=turn-summary.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: 1 suite, **36/36 passed** (32 earlier + 4 new).
- Same command with `--testFile=display-panel.component.spec.ts`: 1 suite, **18/18 passed**.
- `ptah_get_diagnostics` on both changed files: 0 errors. The 10 sibling errors already existed outside these files, as in the review.

### Minor items

The review lists no Minor findings. The browser check (dark/light, narrow widths, contrast) remains open as recorded under Risks, and is outside this fix's files.
