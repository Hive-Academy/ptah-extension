# PR #784 tile visual fix, revision 1

Worktree: `D:/projects/ptah-extension/.claude-worktrees/plan-limit-tiles`.

## Changes by defect

1. **Stale status duplication.** `plan-tile-view.model.ts:530-531,953-958` now gives `stale` no footer chip and retains its specific cached-data refresh-failure notice. The windowless pill rule remains. `plan-tile-view.model.spec.ts:953-968` and `provider-account-tile.component.spec.ts:474-485` verify one rendered stale message and the separate cooldown. The prior DOM icon test now uses a CLI failure, which still has a chip (`provider-account-tile.component.spec.ts:462-472`).
2. **Cut-off qualifier.** `provider-account-tile.component.html:23-29` lets the qualifier wrap with `break-words` and gives both the truncated name and qualifier their own full-text titles. `provider-account-tile.component.spec.ts:398-420` verifies the title attributes and non-truncating qualifier class.
3. **Unbounded content.** `plan-tile-view.model.ts:894-928` shows at most three secondary window chips, followed by `+N more` with each remaining window's facts in its title. `plan-tile-view.model.ts:959-969` shows at most two evidence notices, followed by `+N more` with the remaining full notices in its title. `plan-tile-view.model.spec.ts:992-1011` covers both caps; the existing active/expired/estimated evidence test now checks the estimated fact in the overflow title (`:774-833`).
4. **Quota and failure regressions.** `plan-tile-view.model.spec.ts:969-991` checks a Codex weekly bar with its 5-hour chip and OpenCode Go monthly with 5-hour and weekly chips, each without duplicate status. The stale model and DOM cases above verify that the failure notice and cooldown remain distinct. Jest passed all 63 tests across the two changed specs.
5. **Task-specific comments.** Removed task and PR references from comments in `provider-account-card.component.ts:1-3,54-58`, `plan-tile-view.model.ts:1-15,129-136,510-513,941-953`, `provider-account-tile.component.ts:25-33,117-120`, and `provider-account-tile.component.html:1-3,14-18,81-83,144-146`. The `provider-account-tile` and `tile-cooldown` test IDs remain.

## Verification

Command: `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.spec.ts libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts --coverage=false --maxWorkers=1`.

Jest tail:

```text
Test Suites: 2 passed, 2 total
Tests:       63 passed, 63 total
Snapshots:   0 total
Time:        9.717 s
```

Scoped `ptah_get_diagnostics` after edits: no diagnostics in the requested files. It reported seven errors in untouched siblings: four in `libs/frontend/core/src/testing/mock-rpc-service.ts`, one in `skill-selection-card.spec.ts`, and two in `libs/shared/src/lib/types/capability-id-codec.ts`. UTF-8/text search found no listed mojibake sequences or task/PR references in the six changed files. The supplied dark screenshot was inspected as before-fix evidence.

## Decisions

1. **Show the stale notice, omit the stale chip.** Options: keep the notice or keep the chip with a tooltip. Evidence: the notice says refresh failed and may include its time; the chip only says “Cached data.” This is a reversible, status-kind-specific mapping.
2. **Keep first-visible facts in source order and summarize the rest.** Options: cap in the view model or render every fact. Evidence: `grid-auto-rows: 1fr` made one large tile enlarge every row; overflow titles retain the remaining values. Reversible.
3. **Keep cooldown separate from status.** Evidence: it tells the user when retry is possible, while the stale notice explains the failed refresh. Reversible.

## Not done

No post-edit Electron screenshot or visual measurement was produced. No Nx, build, lint, typecheck, serve, dev, or e2e command was run, per the lane's strict verification rule. Unrelated diagnostics were not changed because they are outside batch ownership.
