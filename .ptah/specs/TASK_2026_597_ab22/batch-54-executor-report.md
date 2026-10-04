# Batch 54 executor report: N7 stage machine and `SessionBudgetService`

Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-597-session-budget`. Nothing is committed. Only Batch 54
files were touched.

## Files

All files are new and sit under `libs/backend/agent-sdk/src/lib/helpers/session-budget/`.

- `weighted-tokens.ts` and its spec. Weights are input 1, cache write 1.25, cache read 0.1 and output 5. The plan
  fixture (177M read, 7.7M write, 1.1M out) gives 32.8M.
- `session-budget-stage.ts` and its spec. These are pure functions with no DI:
  - `measureSessionBudget` (the F6 rules);
  - `sessionBudgetPercentBand`, which compares `used×100 ≥ band×limit` so an exact boundary never rounds down;
  - `nextSessionBudgetStage`, which applies the compaction trigger and lets stages only rise unless `resetStage`;
  - `acceptsSessionBudgetSnapshot`, the F5 revision rule;
  - `evaluateSessionBudget`. When a snapshot has no figure, it keeps the previous figure, so `undefined` is never
    coerced to 0.
- `session-budget.service.ts` and its spec (`SessionBudgetService`). The public methods are `observe`,
  `observeLoaded`, `recordCompaction`, `canSend`, `act`, `release` and `clearAll`.

## Behaviour that matters for Batches 55-57

- **Constructor (DI):** `(TOKENS.LOGGER, SessionBudgetConfigProvider, SDK_SESSION_STATS_OWNER,
SDK_SESSION_LIFECYCLE_MANAGER, SessionHandoffBuilder, SessionHandoffWriter)`.
  - Each collaborator is typed as a narrow `Pick`.
  - The provider, builder and writer are injected by class token.
  - **Batch 55 must register `SessionHandoffWriter`** with a factory, `new SessionHandoffWriter(logger)`. It is a
    plain class, and tsyringe cannot build it unregistered.
  - The lifecycle manager provides `applySessionAutoCompactWindow` and `getSessionWorkspace`. The workspace path is
    what the builder needs.
- **`observe(snapshot | undefined)` is synchronous.**
  - Its return value is what goes on `{...stats, budget}`.
  - Stage actions run after it returns, chained per session, and never reject.
  - Their results (`window`, `handoff`) appear on the next published state and on `act`, which waits for pending
    actions first.
- **Figure:** `used` is the snapshot's `tokenCount`, the same snapshot the chip shows. Weighted tokens are used only
  for unit `cost` with nothing priced.
- **Actions run once per stage entry:**
  - tighten calls session control only when `tightenWindowTokens` is set. Otherwise it reports
    `window {target: 0, applied: false, reason: 'disabled'}` (A1 defaults stay null, so the stage only advises).
  - handoff does a build and a write.
  - limit does a fresh write, and `blocked = blockAtLimit`.
  - A jump of several stages writes once.
  - After `extend` or a settings change lowers the stage, re-entering a stage runs its action again. So crossing an
    extended limit writes a fresh handoff and blocks again.
- **`observeLoaded`** recomputes the stage and the block but runs no actions. The first live figure runs them, so a
  resume never applies a window to a query that is not live.
- **`canSend`** checks the state first. With no state it evaluates `statsOwner.snapshot` on the fly, without storing
  anything. Otherwise, or on a throw, it returns `{ok: true}` (fail-open, with a WARN). A refusal returns
  `{ok: false, state}`.
- **`act`:**
  - `extend` works at `limit` only, adds 20% of the base per extension and logs INFO.
  - `restore-window` takes Batch 52's failed restore (`applied: true, reason: 'failed'`) and returns
    `success: false` with that window.
  - `write-handoff` returns `{content, path, seed}`. A write failure gives `path: null` with the content kept in
    memory, plus `state.handoff.writeError`.
  - `preview-handoff` returns the copy kept in memory. If there is none, it builds one and does not write it.
  - Every action except the two handoff actions needs a state; without one it returns
    `{success: false, error: 'No budget state for this session'}`.
- **`sessionBudget.enabled = false`:**
  - The next figure publishes `stage: 'unknown', used: null, blocked: false`, which removes both the block and the
    banner.
  - Re-enabling counts as a settings change.
- **Logging:** INFO is one line per stage change, plus one each for extend and the tighten result. WARN fires once per
  session per failure kind (`observe`, `can-send`, `tighten:*`, `handoff`, `handoff-write`, `handoff-read`).
- **Workspace unknown:** if session control has no workspace for the session, the handoff is assembled from no
  transcript lines and a WARN is logged.

## Checks

| Command                                                                                      | Result                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk`                             | both succeeded; `eslint` on `helpers/session-budget/` printed nothing                                                                                                 |
| `npx nx run-many -t test -p @ptah-extension/agent-sdk --maxWorkers=2`                        | "Successfully ran target test"                                                                                                                                        |
| `npx jest -c libs/backend/agent-sdk/jest.config.ts …/helpers/session-budget/ --maxWorkers=2` | the six budget suites (the three new ones plus 51/53's) pass: the service suite and the 51/53 suites gave 174 tests, the stage and weights suites 48 tests            |
| `npx nx run degradation-audit:lint --skip-nx-cache`                                          | passed, `libs/backend/agent-sdk: 4 ok (baseline 4)`; no new site. The one suppression (`observe` catch, `reported`) is attached, so there is no orphan or bare marker |

Prettier was run on the new files.

## Deviations

- `window.target` is `0` (`SESSION_BUDGET_NO_WINDOW_TARGET`) when the tighten stage is advisory. The shared type
  requires a number, and the plan asks for `reason: 'disabled'` with no window value.
- The F7 overshoot spec simulates the order the service sees: 99.9% (ok), then the crossing result (blocked), then the
  held follow-up's result (still blocked, no second write). The `onTurnEnd` release itself happens in the adapter
  (Batch 55).
- The F7 overshoot is stated in the service doc comment.
- No other deviations.
