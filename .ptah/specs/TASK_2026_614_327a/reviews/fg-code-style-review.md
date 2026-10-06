# Code Style Review (Stage F+G) - TASK_2026_614_327a

Scope: `git diff 55f245619..49fba1097`, F.2 structure plus the new public API. R1 pass, bounded by the context and tool-call limit. I did not read whole files for the backend items.

| Metric | Value |
|---|---|
| Score | 7.5/10 |
| Verdict | APPROVED WITH FIXES (none required this round) |
| Blocking / Serious / Moderate / Minor | 0 / 1 / 2 / 3 |

## Five style questions
1. Six months out: `SessionBudgetView` is a hand-written bridge of three signals that `chat-view` has to wire through `connect()` (chat-view.component.ts:1064). A fourth view-derived input means touching both sides. Acceptable now.
2. A new reader could misread `connect()` as optional. Before it is called, `NO_VIEW` (session-budget-actions.service.ts:35) makes every action a silent no-op.
3. Maintenance cost: `chat-view.component.ts` is 1675 lines, so the extraction is a small start. The component is still the big cost.
4. Consistency: `SessionBudgetActionsService` matches its siblings (`ActionBannerService`, `SessionRotationKeepService`): `@Injectable()`, `inject()`, signals, `*.service.ts`. The `*-format.ts` files have no role suffix; see Minor 1.
5. Alternative: pass the view signals as an `InjectionToken` provider instead of `connect()`, or have the service derive tab and session itself from `TabManagerService`. Not required.

## Serious
**S1. `session-stats-summary.component.ts` still has an ~620-line inline template.**
- Evidence: the template spans lines 85-705 of the 1027-line file, and styles span 705-781. That leaves the 885 counted lines (blanks and comments skipped) over the 700 `max-lines` warning (eslint.config.mjs:514).
- Problem: Batch 36 moved out only the pure formatters. The humanize-library goal of small focused files is not met, because the bulk is the template.
- Fix: a later task. Move the budget and limits sections into child components under `plan-limits/`, as the existing tile components already do, or move the template to `templateUrl`.
- This breaks no lane config and loses no data, so it is not fixed this round.

## Moderate
**M1. Public-API naming drift from the `SubagentBudgetDispatcherPort` rename (Batch 30).**
- `SubagentBudgetDispatcherPort` is defined at subagent-budget-monitor.ts:249 and used at :268.
- A grep for `SubagentStopPort` finds no leftover reference, so the rename is complete.
- It follows the `SubagentBudgetSink` naming in session-query-executor.service.ts:158. This is a note, not a defect.
- It is exported only from the monitor file and not from a barrel. That is fine while only the spec uses it.

**M2. `TabManagerService.clearSessionBudgets()` (tab-manager.service.ts:~2280) reaches into `workspacePartition.findBackgroundTabIds` with an inline predicate.**
- Fine structurally. The new method is documented, and the partition method is read-only and generic.
- The risk is that it iterates `_workspaceTabSets` while `updateTabInternal` mutates it. The ids are collected first, so this is safe as written.
- It rewrites background tabs without touching signals, so check that `updateTabInternal` handles a background tab correctly. This belongs to the logic reviewer.

## Minor
1. `session-stats-format.ts` and `session-budget-format.ts` have no role suffix. They are pure helpers named `*-format`, in line with other util naming. Suffixing them `.utils.ts` would match `pricing.utils.ts` in shared. Low cost.
2. `SessionBudgetActionsService.runStateAction` (service:~124) is a one-line pass-through of `runAction`. It exists to narrow the action type. The comment explains this, so keep it.
3. The `rpc.types.ts` `resumeDecision` uses an inline `import('./agent-process.types').AgentResumeOutcome`. That is inconsistent with a top-level `import type`, but inline imports are common in this file.

## Pattern compliance
| Rule | Status | Evidence |
|---|---|---|
| Standalone, OnPush, signals and `inject()` in the new service | PASS | session-budget-actions.service.ts:46-58 |
| Service is component-provided, one instance per view | PASS | chat-view.component.ts:203-209 |
| `chat-ui` must not import `chat` | PASS | grep of chat-ui for `@ptah-extension/chat` found 0 hits |
| Budget logic is out of the view (humanize goal) | PASS | chat-view.component.ts delegates to `_budgetActions` |
| File naming with role suffix | PASS, with Minor 1 | `*.service.ts`, `*.component.ts` |
| Barrel exports minimal and typed | PASS | cli-agents/index.ts (+`GatedResume`, `PreparedSdkHandleSpawn` as `export type`) |
| `runningCheckPids` has a real consumer | PASS | apps/ptah-electron/src/activation/shutdown.ts:412 |
| `restore-failed` and `readStatus` are optional and documented in the shared type | PASS | session-budget.types.ts |
| `currentSessionId` on the sink uses `Pick<>` of the real monitor | PASS | session-query-executor.service.ts:160 |
| File size within the `max-lines` warning | FAIL (warning only) | the component is 885 counted lines (see S1); chat-view.component.ts is 1675 total lines, pre-existing |

## Maintenance debt
- Introduced: one service, two format modules, five small public API additions.
- Retired: about 150 lines from chat-view and about 140 from the stats component.
- Net: improving, but two files are still over the 700-line limit.

## Verdict
APPROVED WITH FIXES. There are no must-fix items this round. S1, M1 and M2 go to later tasks.
- Confidence: MEDIUM. The backend diffs were sampled, not read in full.
- A 10/10 version would split the template of `session-stats-summary.component.ts` into child components, avoid the `connect()` bridge, and use the `.utils.ts` suffix.
