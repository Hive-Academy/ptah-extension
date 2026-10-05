# Batch A3 report — badges use shared formatters; tests row; turn-recap entry

## Files

| Task | File | Change |
| ---- | ---- | ------ |
| A3.1 | `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts` | MODIFIED — local `formatCost` deleted; template calls shared `formatUsdCost` (`@ptah-extension/shared`) exposed as `protected readonly formatUsdCost` |
| A3.1 | `libs/frontend/chat-ui/src/lib/atoms/duration-badge.component.ts` | MODIFIED — local `formatDuration` deleted; template calls shared `formatDurationMs` |
| A3.2 | `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.ts` | CREATED — `ptah-turn-tests-row`, standalone, `ChangeDetectionStrategy.OnPush`, `runs = input.required<readonly TurnTestRun[]>()` + `incomplete = input<boolean>(false)`, summary via `summarizeTurnTests` in `computed()` |
| A3.2 | `libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.spec.ts` | CREATED — 11 tests incl. axe |
| A3.3 | `libs/frontend/chat-ui/src/turn-recap.ts` | CREATED — secondary entry point exporting only `TurnTestsRowComponent`, copying `change-set-card.ts` |
| A3.3 | `tsconfig.base.json` | MODIFIED — added `@ptah-extension/chat-ui/turn-recap` → `./libs/frontend/chat-ui/src/turn-recap.ts` directly after the `change-set-card` entry (same format) |

No other file was touched.

## Badge specs were NOT edited

`cost-badge.component.spec.ts` and `duration-badge.component.spec.ts` were read only; both pass
byte-for-byte unchanged (counts below). The "cost unavailable" ghost branch with
`data-testid="cost-unavailable"` is untouched, and `formatUsdCost`'s `null` return can never reach it:
the `knownCost` computed passes only finite numbers into the known branch, so the null-cost path keeps
the exact pre-existing behaviour.

## Behaviour notes

- Badge output is identical: `formatUsdCost` / `formatDurationMs` are the shared copies of the deleted
  local code (committed in A2). The cost badge's raw-value `title` tooltip (`$0.5000 USD`) keeps its
  own 4-decimal rendering — the existing spec pins it, and it deliberately differs from the badge text
  for costs >= $0.01, so it is not a duplicate of the shared formatter.
- `TurnTestsRowComponent` renders nothing for an empty list (`@if (summary().total > 0)`), summarizes
  the outcome as text — "2 passed, 1 failed", counting every category present, and just "unknown"
  when nothing resolved — marks aborted turns "(incomplete)", and lists one row per run in execution
  order as outcome word + command. The outcome is always text; colour is a secondary cue via the
  AA-measured `diff-add-text` / `diff-del-text` overrides and `text-base-content-muted`. The root is
  `role="status"` with `aria-label` ("Tests: 1 passed, 1 failed (incomplete)"). No file or +/- counts
  content appears (Req 1.12 — the change-set card owns that).
- One lint fix during verification: a static `class` beside `[class]` on the same span tripped
  `@angular-eslint/template/no-duplicate-attributes` (2 errors); the layout classes moved into the
  `outcomeClass()` binding value, after which lint passed.

## Verification

1. `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.spec.ts libs/frontend/chat-ui/src/lib/atoms/duration-badge.component.spec.ts libs/frontend/chat-ui/src/lib/molecules/turn-recap/turn-tests-row.component.spec.ts`
   — **3 suites passed, 25/25 tests** (cost-badge 8, duration-badge 6, turn-tests-row 11). The
   turn-tests-row suite includes an axe run (`color-contrast` and `target-size` disabled, the repo
   precedent from git-ui): zero violations. Theme contrast itself is carried by the measured classes
   the webview pins (`status-badge-contrast.spec.ts`); jsdom cannot resolve theme variables.
2. `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-ui --parallel=1`
   — **both tasks succeeded** (`√ nx run @ptah-extension/chat-ui:typecheck`,
   `√ nx run @ptah-extension/chat-ui:lint`). The 8 remaining lint warnings are pre-existing in files
   this batch did not touch (copy-button, agent-card-output, compact-session-activity,
   session-stats-summary, plugin-catalog-panel, subagent-transcript-viewer, code-output,
   diff-display); warnings do not fail the target.

## Not done / limitations

- `role="status"` announces on appearance (turn end) — per the task's example; flagged in case the
  integrator (A4) prefers `role="group"` once the `@defer` wiring lands.
- Nothing else outstanding; no clarifications needed.
