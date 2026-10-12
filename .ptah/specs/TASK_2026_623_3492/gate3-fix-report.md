# Gate 3 Fix Report — TASK_2026_623_3492

## (a) Semantic trend and avatar contrast

**Fixed.** `surface-renderer.component.ts:84-111` mixed every semantic foreground only 35% toward `--bc` by default (50% in `anubis-light`), while its tint is 16% semantic colour over `--b3`. The resulting success text was below 4.5:1 in light and retro; the same shared `--dp-*-text` tokens also feed `dashboard-avatar.component.ts:24`.

`DISPLAY_TEXT_MIX` is now `65%` for both the default and `anubis-light` branches. This retains the semantic hue while meeting AA for success, warning, error and info against their tints. `surface-renderer.component.spec.ts` pins that value.

Changed files:

- `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts`
- `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts`

Contrast ratios (text on tint; `su / wa / er / in`) were calculated in OKLab from the app theme values in `apps/ptah-extension-webview/tailwind.config.js` and DaisyUI's `node_modules/daisyui/dist/themes.css`:

| Theme | Before | After |
| --- | --- | --- |
| anubis (dark) | 5.45 / 5.86 / 4.60 / 5.23 | 7.29 / 7.46 / 6.90 / 7.22 |
| anubis-light | 4.79 / 4.83 / 5.66 / 5.02 | 6.53 / 6.55 / 7.18 / 6.72 |
| retro | 3.16 / 3.10 / 3.24 / 4.05 | 5.15 / 5.11 / 5.21 / 5.69 |

## (b) Passed Bash test counted as unknown

**Fixed.** `libs/shared/src/lib/utils/turn-tests.utils.ts:43-75` only recognized Jest/Nx success forms such as `Tests: N passed` and `Successfully ran target`. A completed Bash node without `isError` whose Node 24 `node --test` output reported `ℹ pass 1` and `ℹ fail 0` therefore fell through to `unknown`; the `$tests` source and both summary renderers correctly propagated that incorrect outcome.

The matcher now recognizes a Node spec (`ℹ`) or TAP (`#`) reporter summary only when it contains both `pass N` (N >= 1) and `fail 0`. Its failure branch runs first, so `fail N` (N >= 1) wins even when a passing count is also present. The earlier fraction matcher was dropped: repository search found no real test-runner output in either fraction word order; its only occurrence was the superseded synthetic spec. `turn-tests.utils.spec.ts` reproduces the reviewed spec output, its TAP counterpart, and a mixed pass/fail result.

Changed files:

- `libs/shared/src/lib/utils/turn-tests.utils.ts`
- `libs/shared/src/lib/utils/turn-tests.utils.spec.ts`

Branch evidence: `git diff --name-status origin/main...HEAD -- libs/frontend/declarative-dashboard libs/frontend/chat libs/frontend/chat-ui libs/shared` reports `turn-tests.utils.ts` as branch-modified; the recap/host summary paths are branch additions.

## (c) Raw ptah-ui fence in collapsed transcript header

**Fixed.** `libs/frontend/chat/src/lib/utils/message-summary.utils.ts:48-62` selected the first text node and collapsed whitespace before rendering it as the group header. Its whole-text display-fence matcher only handled one complete fence, so prose adjacent to a fence, an unclosed streaming fence, and other `ptah-ui` fence kinds could expose transport syntax even though the display block rendered below it.

The summary now removes every `ptah-ui` fence through its close (or through end-of-text while streaming). It retains surrounding prose; when no prose remains it uses the first display title as `Display: <title>`, or `Display`. `message-summary.utils.spec.ts` uses the same whitespace-collapsed shape supplied by `walkNode` and covers prose before a display fence, prose after an inline fence, an unclosed display fence, and titled and untitled fence-only previews.

Changed files:

- `libs/frontend/chat/src/lib/utils/message-summary.utils.ts`
- `libs/frontend/chat/src/lib/utils/message-summary.utils.spec.ts`

Branch evidence: the utility itself predates the branch, but `git diff origin/main...HEAD` shows the `ptah-ui` display surface/chip integration as branch-added; that new input exposed the preview defect.

## (d) Completed recap card still labelled “Live”

**Fixed.** `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.ts:59-64` used `Live` for the `applied` state. Applied means “current in the display panel,” not that its turn is still streaming, so the label persisted after completion.

The badge now says `In display`, retaining the same current-surface state and action without asserting that execution remains live. The existing chip spec now pins the corrected label.

Changed files:

- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.ts`
- `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.spec.ts`

Branch evidence: both the component and its display-dock state service are branch-added in `git diff --name-status origin/main...HEAD`.

## Verification

Passed focused Jest commands:

Current review-round rechecks (these supersede the earlier counts below for the two amended specs):

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/utils/turn-tests.utils.spec.ts --coverage=false --maxWorkers=2` — 1 suite, 27 passed.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/utils/message-summary.utils.spec.ts --coverage=false --maxWorkers=2` — 1 suite, 5 passed.

- `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts --coverage=false --maxWorkers=2` — 1 suite, 57 passed.
- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.spec.ts --coverage=false --maxWorkers=2` — 1 suite, 28 passed.

Passed scoped static checks:

- `npx nx typecheck @ptah-extension/declarative-dashboard --parallel=1` — passed.
- `npx nx lint @ptah-extension/declarative-dashboard --parallel=1` — passed with 127 existing warnings, 0 errors.
- `npx nx typecheck @ptah-extension/shared --parallel=1` — passed.
- `npx nx lint @ptah-extension/shared --parallel=1` — passed with 6 existing warnings, 0 errors.

Not completed: `npx nx typecheck @ptah-extension/chat --parallel=1` exceeded the foreground tool window without returning a result; no overlapping heavy check was started. Chat and chat-ui lint/typecheck therefore remain unverified in this run. The scoped Ptah diagnostic request was likewise unavailable after 45 seconds (no diagnostic result), not a reported source error.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use 65% `base-content` mixing for semantic text | 65% mix; fully neutral base-content; per-theme status tokens | All 12 measured tone/theme pairs are >= 5.11:1 after the change; 65% retains semantic hue. | Yes; change `DISPLAY_TEXT_MIX`. |
| Recognize Node test-runner summaries | Leave unknown; retain fraction matcher; require `pass >= 1` plus `fail 0` | The reviewed `npm test` uses Node 24's spec reporter; repository search found no real fraction-form runner output. Failure is evaluated first. | Yes; matcher is isolated in `outputOutcome`. |
| Strip ptah-ui fence previews while retaining prose | Show raw fence; suppress preview; derive title only; remove every fence and retain prose | The grammar has both inline and display forms, and `walkNode` collapses whitespace before projection. Raw DSL is not useful collapsed-header text. | Yes; `summaryText` is a pure local projection. |
| Rename applied badge | Keep “Live”; add terminal-state plumbing; say “In display” | `applied` is a panel placement state, not stream liveness; wording removes the false implication without adding state coupling. | Yes; one copy constant and its spec. |
