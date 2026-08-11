# Context — `aria-required-children` violation on `role="tablist"` (accepted trade)

## Origin

`TASK_2026_173` Batch 9 register, item 4 of 17. Raised by Batch 6 report §6 + review, Integration Risk.
**Settled by explicit user decision on 2026-08-10.** Filed for tracking, not as an open question.

## Finding (from the register)

> `aria-required-children` ownership violation on `role="tablist"` — **INTRODUCED by Batch 6 and
> ACCEPTED BY USER DECISION.** De-nesting the tab close button onto a `role="presentation"` wrapper
> makes axe descend through the wrapper, which re-parents the close button onto the `tablist`; ARIA
> permits only `tab` as an owned element. **This is a regression on a rule that previously passed** —
> the batch trades one critical axe violation for another. The user ruled the trade favourable and
> instructed that the `tablist`/`tab` shape be kept: `nested-interactive` was a real operability
> defect, while here the close button stays reachable, focusable, labelled and operable and only its
> ownership is wrong. The one clean resolution changes what a screen reader announces ("button,
> current" vs "tab, selected") and deserves its own D1 AC4 review in a task of its own.

## Constraints on any future fix — read before touching this

**Do not re-litigate the trade.** The user has already accepted it. Three alternative resolutions were
evaluated during TASK_2026_173 and explicitly **ruled out** — do not propose them again without new
information:

1. `role="toolbar"` + `aria-current` instead of `role="tablist"` + `aria-selected`
2. `aria-owns` to re-parent the close button outside the tablist's DOM ownership
3. Hoisting the close buttons out of the tab strip's DOM subtree entirely

## Fix

None filed as a one-liner — per the register's own text, "the one clean resolution ... deserves its
own D1 AC4 review in a task of its own." This record exists so the regression is tracked and a future
reviewer does not rediscover it as a surprise, not so it gets fixed opportunistically.

## Closed 2026-08-11 — cancelled as accepted, not fixed

Dispositioned by the user during the Batch 10 run. The carrier is set to `cancelled` because
that is what it always was: a tracking record for a trade that was already settled, not an open
defect. Cancelling it stops the board reading it as unfinished work on every scan.

Nothing about the trade changed. The `tablist`/`tab` shape stays, the close button stays
reachable, focusable, labelled and operable with only its ownership wrong, and the three
alternatives listed above stay ruled out. If the clean resolution is ever wanted, it gets a new
task with its own D1 AC4 review — per this carrier's own `## Fix` section — rather than a
reopening of this one.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 4; `TASK_2026_173/batch-9-dispatch.md` §4.5;
`TASK_2026_173/batch-6-report.md` §6; user decision 2026-08-10.
