# Batch 4 report — PLAN LIMITS card (`variant="inspector"`)

Executor: frontend-developer subagent. Worktree: `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock`.

## Tasks

### Task 4.1 — card template and `planCardClass` — done

- `stats-tile.styles.ts`: new exported `planCardClass(tone)` =
  `block w-full relative overflow-hidden rounded-md border border-surface-border bg-surface-1 border-l-2`
  + the module-private `ROW_ACCENT[tone]`. It has no `min-h-[56px]` and no `pr-5`.
- `plan-limit-tile.component.ts`: the template is now `@let t = tile(); @if (variant() === 'inspector') { card } @else { strip }`.
  - Strip branch: the old markup moved under `@else` byte for byte. Only its indentation changed (+2 spaces).
    Angular collapses that whitespace, so the rendered output is identical, and the 18 strip cases pass unchanged.
  - Card container `div` (`[class]="cardClass()"`, `data-testid="plan-limit-card"`).
  - Expandable kinds: a `<button type="button">` with the plan's class string (`p-2.5 border-0 bg-transparent`,
    `hover:bg-base-content/5`, inset focus ring `focus-visible:-outline-offset-2 focus-visible:outline-base-content`).
    It carries `aria-expanded`, `aria-controls`, `data-testid="plan-limit-tile"` and `(click)="toggled.emit()"`.
    The button is followed by a sibling panel `div` inside the card: `[id]=panelId`, `[hidden]="!open()"`,
    `data-testid="plan-limit-panel"`, class `border-t border-surface-border px-2.5 pt-2 pb-2.5 text-xs`.
    The panel content is the same as before: `ptah-plan-window-detail [showSummary]="false"` plus detail lines.
  - `status` / `local-usage`: a face `div.p-2.5` with `data-testid="plan-limit-tile"`. It has no button,
    chevron, `aria-*` or panel.
  - The face rows live in one `ng-template #cardFace`, used by both faces through `NgTemplateOutlet`.
    All rows are phrasing `span`s.
    - Header (`flex min-w-0 items-center gap-2`): label `min-w-0 flex-1 truncate text-xs text-base-content` + `title`;
      chip `chipClass(tone) shrink-0` with an `aria-hidden` glyph; in-flow chevron
      `size-3 shrink-0 text-base-content-muted`, expandable only.
    - Centre (`mt-2`), one of three:
      - `status` → `block text-[11px] leading-snug text-base-content-muted break-words`, `value · resetLine`,
        `title`=`statusTitle()`.
      - `hasBar()` → `flex min-w-0 items-center gap-2`: the bar (`h-2`, every aria/title/testid kept) and the value
        (`shrink-0 whitespace-nowrap ...`). The reset line follows as its own `block mt-1` row, with no indent.
      - Otherwise (unknown window, cooldown, local usage) → the status block style. The value span keeps
        `plan-limit-tile-value`, followed by `· resetLine`.
    - Footer: `mt-1.5 flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-base-content-muted` with the caption
      (`plan-limit-caption`, `title`; the lead is `truncate` while closed and `break-words` while open) and
      `sourceChipClass` chips (+ `max-w-full break-words`). The omission logic is unchanged
      (`captionShared` / `ownSources`).
  - TS: added the `NgTemplateOutlet` import and `cardClass = computed(planCardClass(tone))`. `faceClass` now
    returns `planRowClass(tone)` only. Its old inspector ternary (`min-h-[56px] ... p-2.5`) became unreachable
    once the inspector variant got its own branch. The host bindings (`block min-w-0`, `data-tile-id`) are unchanged.
- I found no semantic text colour in either branch. The spec regex `text-(error|warning|success|info)` passes on both variants.

### Task 4.2 — inspector describe block — done

`plan-limit-tile.component.spec.ts` has a new top-level `describe('PlanLimitTileComponent (variant="inspector")')`
with 12 tests, 13 cases with the `it.each`. They set `variant` through `setInput`. The strip `describe` (old lines
70-347) is untouched. Coverage:

- the card container wraps the face and the panel; the card has the expected classes and no `min-h-[56px]` / `pr-5` (AC 7.6);
- the header holds the label and the chip; the centre is a separate sibling row with `mt-2`; the chevron is in flow (AC 7.2);
- the status text sits in its own `block break-words` row with no `pl-[4.5rem]` (AC 7.3);
- the bar keeps `role=progressbar` and its aria values, uses `h-2` (not `h-1.5`), has the value beside it and the
  reset line below (AC 7.4);
- the unknown 5-hour window is an expandable `BUTTON` with no bar, a value of `unknown`, and no `0%` (decision 8, AC 7.4);
- the caption and sources are inside the card footer, omitted when shared, and differing sources are kept (AC 7.5);
- toggle emits `toggled`; `aria-controls` points to the panel inside the card; the panel is hidden and empty while
  closed and shown when open; the open caption is not truncated (AC 7.6);
- `status` and `local-usage` cards render a `DIV` face with no `button`, `lucide-angular`, `aria-expanded`,
  `aria-controls` or panel (AC 7.6);
- local usage text sits in the centre row with no bar;
- every testid appears once, `data-tile-id` is set, and the first `button` is the disclosure face (lane link) (AC 7.7);
- class-level overflow guards (AC 7.9, structural): header `min-w-0`, label `min-w-0 truncate`, chip `shrink-0`,
  `whitespace-nowrap` value only in the bar row (not on the unknown value), `break-words` on the unknown and status
  centres, no `pl-[4.5rem]`;
- semantic colour is used only on the card accent and the bar fill.

## Verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts --coverage=false --maxWorkers=2`
  → `Test Suites: 1 passed`, `Tests: 31 passed, 31 total` (18 strip + 13 inspector).
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui --parallel=1`
  → `Successfully ran targets typecheck, test, lint for project @ptah-extension/chat-ui`. The test target includes
  `session-stats-summary.component.spec.ts`. The only other output line was the usual "Nx Cloud encountered some problems" notice.
- I did not run build, serve, e2e or package, and no workspace-wide check.

## Risks and decisions

- **R6 (hooks)**: `data-testid="plan-limit-tile"` sits on the clickable button for expandable cards and on the
  face `div` otherwise. `data-tile-id` stays on the host. `plan-limit-tile-value`, `plan-limit-status`,
  `plan-limit-caption`, `plan-limit-panel`, `-progress`, `-progress-fill` and `-chip` are all kept.
  `InspectorLimitsLanesComponent.openPlanTile` (`tile.querySelector('button')`) still finds the disclosure button,
  and the AC 7.7 test asserts it. The e2e harness click (`plan-limits-visual.e2e.spec.ts:169-170`) lands on the
  button, and the panel it expects to see becomes visible. Status cards have no button, so the lane link's
  `?.focus()` does nothing for them. Before this change it also did nothing: the old button was `disabled`.
- **R7 / D-I (measured overflow)**: the spec checks class-level guards only. The measurement
  `scrollWidth <= clientWidth` at dock 300 / 560 and the 760 sheet stays a QA item, as the spec comment notes.
- **Decision 8**: the unknown 5-hour window (kind `window`, no percent) renders as an expandable plan-window
  card: a button with a chevron and a panel. It uses the status-style wrapping centre and never draws a bar.
  The test asserts this.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Share the face rows between the button and the static `div` through one `ng-template` + `NgTemplateOutlet` | duplicate the face markup | plan :474 allows `ng-template`s for card-only fragments | yes |
| Add card-only hooks `plan-limit-card`, `-card-header`, `-card-centre`, `-card-footer`, `-label`, `-reset` | query by class or structure | no existing hook was renamed; the new ones make the AC 7.2-7.5 structure tests stable | yes |
| Add `max-w-full break-words` to the card's source chips and `max-w-full` to its caption | leave them as in the strip | AC 7.9 asks for no horizontal overflow at 300 px; a long chip in a `flex-wrap` row could otherwise exceed the card | yes |
| Simplify `faceClass` to `planRowClass(tone)` | keep the dead inspector ternary | after the split, the ternary's inspector arm is unreachable (the instructions say to delete unused code) | yes |

## Deviations

- The strip markup changed only in indentation (+2 spaces) because it moved under `@else`. The rendered output
  is unchanged.
- Process: I ran one read-only `git diff --stat` by mistake to check line endings. It modified nothing. I ran no
  other git command.

## Files

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\stats-tile.styles.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\libs\frontend\chat-ui\src\lib\molecules\session\plan-limits\plan-limit-tile.component.spec.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\.ptah\specs\TASK_2026_699_833e\batch-4-report.md

Peer-owned files (`chat-transcript.component.css/html`, `message-bubble.component.css/html`,
`chat-input.component.ts`), `batches.md` and `task.md` were not touched.
