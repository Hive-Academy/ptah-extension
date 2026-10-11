# Batch 8 report — TASK_2026_626_7b3e (Header estimate marker, chat-ui)

Executor: frontend-developer (sub-agent). No git commands run; the working tree is left dirty.

## Task 8.1: `~` marker and tooltip line — implemented

Plan reference: implementation-plan.md:963-981 (C9). Acceptance taken from batches.md Task 8.1.

### Files

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts
  - Module constant `ESTIMATE_TOOLTIP_LINE` = "Live estimate while the turn runs; final figures replace it when it ends."
    and a module function `withEstimateLine(tooltip)` (puts the line first, then a blank line, then any existing tooltip;
    returns the line alone when there is no tooltip).
  - `readonly isEstimate = computed(() => this.snapshot()?.provisional === true)`.
  - `costTooltip` and `tokenTooltip` stay computeds over the unchanged `costTooltip()` / `tokensTooltip()` helpers
    from `session-budget-format.ts`. They add the estimate line only when `isEstimate()` is true. Otherwise they return
    exactly the previous value, so the cost tooltip stays `null` and `[attr.title]` stays absent when there is no budget.
  - `ChangeDetectionStrategy.OnPush` unchanged.
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.html
  - The chips are in the external template, so it is in scope as the batch allows. The marker is added under
    `@if (isEstimate())` in four places:
    collapsed TOKENS chip (before `stats-tokens`), collapsed COST chip (before the budget-text/badge branch),
    expanded Tokens card (before `stats-tokens`), and expanded Cost card (first child inside both `stats-cost-budget`
    and `stats-cost`, so it sits inline with the value instead of on its own line).
  - Marker markup: `<span data-testid="stats-{tokens|cost}-estimate"><span aria-hidden="true">~</span><span class="sr-only">estimated</span></span>`.
  - Insert-only: with `provisional` not `true`, the rendered DOM is identical to before. No existing element,
    test id or class was moved or changed.
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts
  - New `describe('in-turn estimate (TASK_2026_626 C9)')` with 7 cases:
    1. Markers in both layouts for a provisional snapshot: visible `~` is `aria-hidden`, and the `sr-only` text is "estimated". The figures are unchanged (`14.9M`, `$38.18`).
    2. The tokens tooltip starts with the estimate line, followed by the breakdown. The cost tooltip is exactly the estimate line when there is no budget. Both checked in both layouts.
    3. A cost budget gives the estimate line, a blank line, then "Session budget: 40% used ($38.18 of $30).".
    4. The weighted-fallback budget text that replaces the badge still gets the marker in both layouts.
    5-6. `it.each` with `provisional` absent and `false`: no marker in either layout, no estimate line in the tokens tooltip, the cost chip/card has no `title`, and `isEstimate()` is false.
    7. An authoritative snapshot (no `provisional`, higher revision) replacing a provisional one removes the marker and the tooltip line.

### Stack observed

- Angular standalone components with signal `input()`/`computed()` and OnPush. Read from the component itself and `atoms/cost-badge.component.ts`.
- Tailwind/daisyUI utilities. `text-base-content-muted` is the label ink already used on these chips. `sr-only` is
  already used in chat-ui (`change-set-card.component.ts:240`, `mcp-directory-browser.component.ts:214`).
- `SessionStatsEntry.provisional?: boolean` is confirmed in `libs/shared/src/lib/types/rpc/rpc-session.types.ts:429` (Batch 1).

### Edge cases (as instructed)

- `provisional` not `true` (absent, `false`, or any other value): no `~` and no tooltip line. The check is a strict `=== true`, and spec cases 5-7 cover it.
- OnPush stays. There is no animation, transition class or timer.

### Accessibility

The visible `~` is hidden from assistive technology so it is not read as "tilde". Screen readers get the word "estimated"
before the figure. The full sentence is on the chip/card `title`, which is the existing tooltip path the plan names.

## Verification

- `mcp__ptah__ptah_get_diagnostics` scoped to the component `.ts` and `.spec.ts`: **0 diagnostics in the requested files**.
  It also reported 8 errors in sibling files outside this batch, which I did not touch: `streaming-quotes.component.spec.ts`,
  `compact-session-activity.component.spec.ts`, `libs/frontend/core/src/testing/mock-rpc-service.ts`,
  and `libs/shared/src/lib/types/capability-id-codec.ts`. They look like a mismatch between the tool's compiler config and the projects' configs.
  The template is not covered by this tool.
- Not run, per instruction (one heavy check at a time machine-wide; the team-leader runs these serially):
  - `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts --coverage=false --maxWorkers=2`
  - `npx nx typecheck @ptah-extension/chat-ui --parallel=1`, then `npx nx lint @ptah-extension/chat-ui --parallel=1`

## Risks carried by this batch

| Risk (batches.md plan validation) | Handling |
| --- | --- |
| The header marker is a rendered UI change, and typecheck/test does not prove it (LOW). Mode 3 requires before/after dark and light screenshots, with "before" from `69a2b835e`. | Not done by me: no build/serve is allowed for executors. The change uses only existing tokens (`text-base-content-muted`, `sr-only`) and adds no colour, so dark/light contrast matches the existing chip labels. Screenshots remain a Mode 3 / visual-review obligation. |
| A live estimate overwrites authoritative figures (HIGH, cross-batch). | The UI part: the marker depends only on the snapshot currently shown. Spec case 7 shows that an authoritative replacement clears the marker and the tooltip line, so no stale `~` survives. Revision ordering itself belongs to Batches 2/6/7. |
| Parallel tracks exhaust RAM. | I ran no jest/nx command, only scoped diagnostics. |

## Plan deviations

- None in substance. One placement detail: in the expanded Cost card, the value element is a block `div`, so the marker
  goes inside `stats-cost` / `stats-cost-budget` rather than before it. While an estimate is shown, the text of those test
  ids in the expanded layout therefore also includes "~estimated". Existing tests use non-provisional snapshots and are unaffected.
- The estimate line is placed first in both tooltips (the plan says the tooltips "gain" the line and does not set an order).

## Out-of-scope observations

- The sibling diagnostics listed under Verification. They were not touched.
