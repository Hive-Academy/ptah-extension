# Batches - TASK_2026_700_dcce

Source: `implementation-plan.md` (Gate 2 APPROVED in `implementation-plan-review-r1.md`).
Decisions D1-D9 in `decisions.md` are binding (D9: no Open tab; D7: dock slot = Start new).

## Run order

| Phase | Batches | Parallel? | Status |
| --- | --- | --- | --- |
| C rail | C1, C2 | yes (file-disjoint) | done (review NEEDS_FIXES -> 1 fix round -> checks pass) |
| D canvas | D1, then D2 + D3 | D2 and D3 parallel after D1 | pending |
| B dock | B1 | - | pending |
| A page | A1, then A2a, then A2b | strictly sequential | pending |

Per phase: codex lanes implement -> orchestrator runs scoped checks -> Anthropic
`code-logic-reviewer` -> at most one codex fix round -> commit (scope `command-center`).

## Check rule (user standing rule)

Parallel lanes run NO nx or jest. The orchestrator runs the checks once per phase, one at a time:
typecheck, lint, test for `command-center` (`--parallel=1`, Jest `--maxWorkers=2`), the
`no-alpha-base-content` spec for template changes, and the degradation audit (must stay 294).
A single lane that runs alone may run the same scoped checks, sequentially.

## Gate 2 addenda (from `implementation-plan-review-r1.md`, apply in every brief)

- **N1 DOM text contracts.** Keep every text string that existing specs assert (for example
  `'7 messages'`, `'~12.3k tokens'` in `components/command-center-page.component.spec.ts:245-284`,
  and the overlay and integration specs). If the approved design needs different wording, keep
  the asserted wording and report the conflict. Do not edit a spec that the batch does not own.
- **N2 Page spec selectors.** A2b owns `components/command-center-page.component.spec.ts`.
  It must keep or update every selector in that spec (including `header .badge:last-of-type`
  and `.stage .left-5.top-5 p:nth-child(2)`), and it must rewrite the rail-scroller test at lines
  527-545 to assert the approved fill-height scroller (the old test asserts the opposite).
- **N3 ResizeObserver guard.** Every new `ResizeObserver` (C2, A2b, D2) is created only when
  `typeof ResizeObserver !== 'undefined'`, as the repository already does elsewhere, and is
  disconnected on destroy. The six integration specs run without `ResizeObserver` and stay
  unmodified.
- **Minor.** The stats band overlays the scene's measured box; do not reserve its height twice.
  At exactly 1100px use the one-row 72px band (`min-width: 1100px`). C2 adds a test for the
  child rail-row glyph. A2b adds a test for the new `toggleTheme()` controller method.
