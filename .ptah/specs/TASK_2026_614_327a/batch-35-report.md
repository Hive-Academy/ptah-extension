# Batch 35 report: budget flows moved out of chat-view (F.2 / PR3-S1, style M1 + M2)

Status: Tasks 35.1 and 35.2 done. Behaviour-preserving; no copy, RPC or template changes. Not committed.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat\src\lib\services\session-budget-actions.service.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat\src\lib\services\session-budget-actions.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts`
- Template `chat-view.component.html`: unchanged (binding names kept).

## What moved where

From `ChatViewComponent` into `SessionBudgetActionsService`:

| chat-view (before) | service (after) |
| --- | --- |
| `budgetScope` | private `scope` |
| `_budgetActionState` (linkedSignal) | private `actionState` |
| `_budgetPreview` (linkedSignal) | private `preview` |
| `budgetActionBusy` (writable signal) | `busy` (read-only; private `_busy`) |
| `resolvedSessionBudget` computed | `budget` |
| `currentBudgetPreview` | private `currentPreview` |
| `budgetPreviewText` / `budgetPreviewFailed` | `previewText` / `previewFailed` |
| `onBudgetAction` body | `runStateAction(action)` |
| `onBudgetPreview` body | `loadPreview()` |
| `onBudgetContinue` body ("Continue in new session") | `continueInNewSession()` |
| `onBudgetRotate` body ("Rotate session") | `rotateSession()` |
| `runBudgetAction` | private `runAction(action)` |

The Continue and Rotate flows repeated "run action, read seed, report a missing seed" and "create tab, adopt into the
canvas in grid layout"; these are now the private helpers `handoffSeed(action)` and `openTabForHandoff()`. Same call
order as before: action call, seed check, `createTab`, `layoutMode` read, `requestCanvasTab` in grid, then send
(Continue) or `requestComposerPrefill(seed, grid ? tabId : null)` (Rotate).

chat-view keeps thin delegates with the same names the template binds: `resolvedSessionBudget`,
`budgetActionBusy`, `budgetPreviewText`, `budgetPreviewFailed` (aliases of the service signals) and
`onBudgetAction` / `onBudgetPreview` / `onBudgetContinue` / `onBudgetRotate` (one-line calls). `budgetContextTokens`
stays in chat-view (it reads `liveModelStats`, not budget action state). Unused imports removed: `linkedSignal`,
`SessionBudgetAction`, `SessionBudgetActionResult`, `SessionBudgetState`. Net chat-view.component.ts: about -150 lines.

## Public API of the new service

`@Injectable()` (not `providedIn: 'root'`): provided in `ChatViewComponent.providers`, one per view, because the action
state belongs to that view's tab and session (canvas tiles each have their own). Not exported from the lib barrel (only
chat-view uses it).

- `connect(view: SessionBudgetView): void` — chat-view calls it once in its constructor with
  `{ activeTab: resolvedActiveTab, tabId: resolvedTabId, sessionId: resolvedSessionId }`.
- `SessionBudgetView` = `{ activeTab: Signal<{ sessionBudget?: SessionBudgetState | null } | null>; tabId: Signal<string | null>; sessionId: Signal<string | null> }`.
- `SessionBudgetStateAction` = `'dismiss' | 'extend' | 'restore-window'`.
- Signals: `budget`, `busy`, `previewText`, `previewFailed`.
- Methods: `runStateAction(action)`, `loadPreview()`, `continueInNewSession()`, `rotateSession()` (all `Promise<void>`).
- Injects: `ClaudeRpcService`, `ActionBannerService`, `TabManagerService`, `AppStateManager`, `ChatStore`. All in or below
  the `chat` lib; nothing from `chat-ui` imports it, so the presentational boundary is unchanged.

## Specs (Task 35.2)

- The 21 budget cases in `chat-view.component.spec.ts` moved to `session-budget-actions.service.spec.ts`, rewritten
  against the service with plain signal and mock providers (no chat-view harness). Every original case is kept;
  two assertions were added for paths the old cases did not pin: Continue's "Could not start the new session: …"
  banner, and Rotate's missing-seed banner.
- `chat-view.component.spec.ts` keeps a 4-case wiring block (same describe name): tab budget pass-through, a banner
  action hitting `session:budgetAction` and reporting on the view's tab, a tab switch clearing action state and
  preview (proves `connect` uses the view's scope), and Continue/Rotate opening a tab from the seed.

## Checks (Git Bash, worktree root)

- `npx nx run-many -t typecheck,lint -p chat chat-ui chat-state --parallel=2` — exit 0 ("Successfully ran targets
  typecheck, lint for 3 projects"); no lint output for the touched files.
- `npx nx run-many -t test -p chat chat-ui chat-state --parallel=2 -- --maxWorkers=2` — exit 0 ("Successfully ran
  target test for 3 projects").
- `npx jest -c libs/frontend/chat/jest.config.ts session-budget-actions chat-view.component.spec --maxWorkers=2` —
  2 suites, 91 tests passed (confirms both specs ran).
- `npx nx run di-lint:lint` — exit 0.
- `npx nx run degradation-audit:lint` — exit 0.
- No PNG baselines were rewritten (`git status` shows no `.png` changes). No screenshots taken (Stage C).

## Open notes

- degradation-audit lists `session-budget-actions.service.ts:229 [catch-return-sentinel]` as a warning. This is the
  `runAction` catch moved unchanged from chat-view (it shows the error banner, then returns `null`). The audit exits 0;
  the finding moved with the code and is not new.
- The working tree also has unrelated backend and `libs/shared` changes from the parallel team-leader batch
  (agent-process-manager, agent-rpc.handlers, agent-wait.tool.spec, rpc.types.ts). None of them were touched here. Stage
  only the four paths above for this batch.
- Tool calls used: about 30 (within R1).
