# Fix round report — radial-progress neutral tone (visual review S4)

Status: DONE. Worktree W: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds`.

## Finding

Visual review S4 (`visual-review.md:50-52`): the neutral radial-progress ring rendered as
`radial-progress text-neutral`, which gave 1.12:1 contrast against the dark page — the 0% ring
showed as a faint dot. Fix requested: map `neutral` to a complete literal
`radial-progress text-base-content` class string.

## What changed

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.ts:16`
  — `neutral: 'radial-progress text-neutral'` → `neutral: 'radial-progress text-base-content'`.
  The doc comment (`:6-13`) now records why: `text-base-content` keeps high contrast in both
  themes; `text-neutral` measured 1.12:1 in the dark theme (S4). All five other tone strings are
  unchanged complete literals, and `[style.--value]` at `:32` stays the only style binding.
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.spec.ts:19`
  — the expected neutral class literal updated to `'radial-progress text-base-content'`. The
  per-tone test (`:28-38`) still asserts the exact class string under both theme roots
  (`anubis`, `anubis-light`), so the spec now pins the new mapping. The custom-property and
  hostile-input tests are unchanged.

## Track remainder (checked, left as is)

daisyUI 4.12.24's `radial-progress` draws no track: the component is an `inline-grid` whose
`::before` is the conic-gradient arc only, with no remainder-rule style in the shipped CSS.
Per the instruction, no custom CSS colour was added.

## Verification

Run in the foreground from W:

```
npx nx run-many -t typecheck,test,lint -p declarative-dashboard
Successfully ran targets typecheck, test, lint for project @ptah-extension/declarative-dashboard
Cache: 0/3 hit (0%) — all three targets ran fresh
```

Scoped evidence for the changed component:

```
npx jest --config libs/frontend/declarative-dashboard/jest.config.ts "dashboard-radial-progress\.component"
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

## Files touched (absolute paths, complete list)

1. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.ts`
2. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.spec.ts`

No alert or divider file was touched. No git commands were run.