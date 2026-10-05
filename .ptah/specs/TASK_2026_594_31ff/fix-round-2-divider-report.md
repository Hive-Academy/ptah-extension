# Fix round 2 — vertical divider rule with text (TASK_2026_594_31ff)

Status: DONE. The vertical divider no longer relies on daisyUI's
::before/::after; the rule is two explicit segments, so it draws with and
without text. Only the two allowed files were changed. No git commands run.

## Files modified (absolute)

1. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-divider.component.ts`
2. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-divider.component.spec.ts`

## What changed

- The daisyUI class map is replaced by `DIVIDER_CONTAINER_CLASSES`
  (`dashboard-divider.component.ts:17-20`):
  - `horizontal: 'divider'` — unchanged: daisyUI's own rule and text slot.
  - `vertical: 'flex flex-col items-center self-stretch min-h-12 gap-1 mx-2
    text-sm'` — a column flex box, not a daisyUI divider.
- The vertical rule is now explicit: two `aria-hidden="true"` segments with the
  complete literal `'w-0.5 min-h-4 flex-1 bg-base-content/10'`
  (`VERTICAL_RULE_SEGMENT_CLASS`, `dashboard-divider.component.ts:26`),
  bound via `[class]` in the template
  (`dashboard-divider.component.ts:44,48`). The optional text span sits between
  them; with no text there are exactly two segments and no empty span
  (`dashboard-divider.component.ts:43-49`). Each segment is at least 16px
  (`min-h-4`) and flexes to fill the rest, so the rule draws even when text
  plus gaps would have left the old pseudo-elements 0px tall (round 3
  finding). `bg-base-content/10` is a theme token — the same 10% content fill
  daisyUI's own divider rule uses — so no hard-coded colour.
- Host binding for vertical is kept: `[class.flex]` / `[class.self-stretch]`
  bound to `isVertical()` (`dashboard-divider.component.ts:32-36,60`), so the
  host still stretches across the stack row; the horizontal host is untouched.
- `role="separator"` and `aria-orientation` equal to the contract direction
  stay on the container in both branches
  (`dashboard-divider.component.ts:39,51`). Plain text only, no `innerHTML`.

## Spec evidence (`dashboard-divider.component.spec.ts`)

- Exact class set per direction under both theme roots (`anubis` /
  `anubis-light`), sorted-token comparison because Ivy writes the class set
  in its own order; role and `aria-orientation` per direction
  (`:23-35`).
- Vertical with text: exactly two `aria-hidden` segments, each with the exact
  segment class set and empty text content; the text span is between them
  (checked with `compareDocumentPosition`); the text reads 'or'
  (`:37-55`).
- Vertical without text: still two segments, no text span, empty textContent
  (`:56-59`).
- Host: `flex` + `self-stretch` present only for the vertical divider;
  horizontal keeps the bare `divider` class with no explicit segments
  (`:61-73`).
- Plain text and hostile markup (`<img src=x onerror=alert(1)>`) stay text in
  both directions; no empty placeholder element in the textless horizontal
  case (`:75-86`).

## Verification

Command (foreground, worktree root):

```
npx nx run-many -t typecheck,test,lint -p declarative-dashboard --skip-nx-cache
```

Result: PASS —
`√ nx run @ptah-extension/declarative-dashboard:test`,
`√ nx run @ptah-extension/declarative-dashboard:typecheck`,
`√ nx run @ptah-extension/declarative-dashboard:lint`,
`Successfully ran targets typecheck, test, lint for project
@ptah-extension/declarative-dashboard`, 0 errors.

Jest summary: `Test Suites: 23 passed, 23 total; Tests: 250 passed, 250 total`
(one divider test more than the previous round). Scoped divider pre-check:
1 suite, 4 tests, all passed.

## Note for the team-leader

- The rendered rule colour/height was not re-measured in a browser here; the
  round 3 harness (`visual/status-kinds-r3.e2e.spec.ts`) is the acceptance
  evidence for the visible rule with text, and it should be re-run against a
  rebuilt dist.