# Context

## What shipped, and what it is for

TASK_2026_306 made blocked harness paths legible. A blocked path is a desired
path an unowned file occupies — Ptah refuses to overwrite it, so it is reported
as both `foreign` and `missing`, and `writeFailed` stays `0`. Before the change
a user saw only `missing=13, writeFailed=0` in a log, which reads as a gap of
unknown cause.

Two surfaces now carry the list:

| Surface             | Component                                      | Where               |
| ------------------- | ---------------------------------------------- | ------------------- |
| Marketplace popover | `harness-blocked-paths.component.ts`           | Plugins panel badge |
| Dashboard card      | `ptah-harness-card`, _"Your harness is short"_ | Home, page flow     |

The Dashboard card exists specifically because **a log line cannot be clicked**.
It is the surface for a user who has no terminal.

## Gap 1 — no e2e references either surface

```
grep -rn "harness-blocked|ptah-harness-card|harness-health|repairBlocked|Your harness is short" \
  apps/ptah-electron-e2e/src apps/ptah-extension-vscode-e2e/src
→ no matches
```

(The `harness` hits that do exist in `ptah-electron-e2e` are the test suite's own
fixture harness — `_harness/docs-fixtures.ts` — not this feature.)

Both surfaces have thorough unit coverage. What unit specs cannot tell you is
whether the card is actually mounted in the running app. The asymmetry is the
point:

- A green e2e run today proves **nothing moved**.
- A green e2e run today would **also** stay green if either card vanished from
  the app entirely.

For a feature whose entire justification is "the user must be able to see this
without a terminal", silent disappearance is the failure mode that matters, and
it is the one nothing currently catches.

## Gap 2 — the Dashboard list is unbounded

The popover bounds itself, because a popover must fit:

```html
<!-- harness-health-badge.component.ts:95 -->
<div class="w-80 max-h-[26rem] overflow-y-auto p-3 space-y-2"></div>
```

The Dashboard card has no equivalent. It renders every blocked path in normal
page flow.

| Blocked paths | Effect                                                    |
| ------------- | --------------------------------------------------------- |
| 13            | Fine — this is the case that motivated the feature        |
| ~50           | The card dominates the first screen                       |
| 500           | Every other Dashboard card is pushed off the first screen |

500 is not hypothetical: a workspace where someone committed a full
`.claude/skills` tree produces exactly that. The disclosure surface would then
damage the surface hosting it.

## Fix for gap 2 — two options

**A — cap and scroll.** Match the popover: a `max-h` plus `overflow-y-auto`.
Simplest, and consistent with the sibling surface.

**B — first N, then "+M more".** Show a bounded head and route the remainder
into the popover. This matches an existing convention in the codebase:
`ptah harness doctor` prints 20 paths per group then `+N more`.

B is better product behaviour on a home screen — a nested scroll region inside a
card in a scrolling page is awkward — but A is cheaper and already precedented
in this feature. Either is acceptable; pick one and say which in the
implementation report.

Whichever is chosen, the count must stay exact and visible. The number of
blocked paths is the fact the card exists to convey; truncating the list must
never truncate the count.

## Scope

- E2E coverage for both surfaces, asserting each renders with a known blocked
  set and that the Dashboard card's control routes into the consent dialog.
  Mutation-test it: unmount the card and confirm the e2e goes red.
- A bound on the Dashboard card's list, with a spec at a path count large enough
  to prove it (500, not 13).

## Constraint

Do not change the wording of the action text on either surface. It is
safety-critical and guarded — see TASK_2026_309, which is about strengthening
that guard. A layout change here must leave the strings byte-identical.
