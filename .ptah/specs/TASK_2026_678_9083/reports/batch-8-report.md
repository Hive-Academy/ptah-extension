# Batch 8 implementation report

## Results

| Task | Result | Evidence |
| --- | --- | --- |
| 8.1 | Pure owned-work projection with root ancestry, tab-to-SDK rekey, persisted descendants, terminal agents, and Tribunal grouping/derived phases | `libs/frontend/command-center/src/lib/model/work-projection.ts:18`; `work-projection.spec.ts:5,14` |
| 8.2 | Bounded, delimited status context using only IDs, states, and ages; default coordinator provider supplies current projected nodes | `status-context.ts:4`; `status-context.spec.ts:5,11,17`; `session-coordinator.ts:28,177-179` |
| 8.3 | Untrusted roster validation and page-owned confirmation gate; fixed answer, delayed registration, one launch per proposal ID | `tribunal-roster-proposal.ts:54`; `tribunal-run-coordinator.ts:16-67`; both corresponding specs |
| 8.4 | Existing swallowed-failure sites marked; new swallowed-failure sites marked; no unsuppressed catch site in the command-center source inventory | `session-coordinator.ts:42,83,171`; `tribunal-roster-proposal.ts:60`; `tribunal-run-coordinator.ts:63` |

## Verification

Command: `npx nx run-many -t test typecheck lint -p @ptah-extension/command-center --parallel=1 2>&1 | Select-Object -Last 60`.

Header: `NX   Running targets test, typecheck, lint for project @ptah-extension/command-center:`

Result: `NX   Successfully ran targets test, typecheck, lint for project @ptah-extension/command-center`

The final run passed all three targets. Nx Cloud also reported a disabled organization (401); local targets succeeded. Scoped `ptah_get_diagnostics` reported zero errors in changed files; it reported two pre-existing BigInt target errors in `libs/shared/src/lib/types/capability-id-codec.ts:262-263` outside batch ownership.

## Degradation-audit inventory

| Site | Detector kind | Classification |
| --- | --- | --- |
| `session-coordinator.ts:45` | `promise-catch-sentinel` | Suppressed by reported marker at :42; original promise is returned to caller, derived `finally` rejection is consumed. |
| `session-coordinator.ts:82` | `catch-return-sentinel` | Suppressed by reported marker at :83; safe restore failure reaches `fail`. |
| `session-coordinator.ts:100` | none | Retry catch has no literal return; the bounded read is retried. |
| `session-coordinator.ts:152` | none | Abort catch calls `fail` and has no literal return. |
| `session-coordinator.ts:170` | `catch-return-sentinel` | Suppressed by reported marker at :171; safe send failure reaches `fail`. |
| `tribunal-roster-proposal.ts:59` | `catch-return-sentinel` | Suppressed by reported marker at :60; bad JSON returns invalid proposal and caller answers Decline. |
| `tribunal-run-coordinator.ts:62` | `catch-return-sentinel` | Suppressed by reported marker at :63; failed discovery/registration withholds launch. |

No workspace-wide degradation audit was run (Decision D12). The table enumerates every `catch`/`.catch` in the lib's non-spec source files; the detector applies only to the listed sentinel sites.

## Session-coordinator changes

Exact changed lines: :12 imports `buildStatusContext`; :28 sets the default `statusContextProvider` to `() => buildStatusContext(this.store.nodes())`; :42 adds the dedupe-promise marker; :83 adds the restore marker; :171 adds the send marker. `sendStatusTurn` at :177-179 reads that provider and prepends its block. Ordinary `send` does not read it.

## A1 coverage

| Validation note | Evidence |
| --- | --- |
| Confirm delivers no affirmative answer text | `tribunal-run-coordinator.spec.ts:19-25` checks the exact fixed answer and excludes literal Confirm. |
| Launch once and only after registration; duplicate confirm ignored | `tribunal-run-coordinator.spec.ts:19-26`. |
| Non-Decline-first rejected | `tribunal-roster-proposal.spec.ts:6-11`; `tribunal-run-coordinator.spec.ts:28-34`. |
| Timeout answers Decline | `tribunal-run-coordinator.spec.ts:28-34`. |
| Discovery-turn spawn provisional and never registered | `tribunal-run-coordinator.spec.ts:35-43` checks registration waits for completion; `work-projection.spec.ts:5-13` includes provisional/rekey ancestry. |
| AT LIMIT lanes and saved preferences | `tribunal-roster-proposal.spec.ts:19-24`. |
| Two runs | `work-projection.spec.ts:14-22`; `tribunal-run-coordinator.spec.ts:58-64`. |
| Restart with manifest | Persisted child ancestry is covered by `work-projection.spec.ts:5-13`; full multi-run manifest restart is constrained by the existing one-manifest-per-root records schema. |
| Missing folder | `tribunal-run-coordinator.spec.ts:70-80` holds a role launch if `tasks:create` returns no folder. |
| Non-delivery and replay | `tribunal-run-coordinator.spec.ts:50-57`. |

## Risks and decisions

- **R4:** The coordinator never sends literal Confirm. Only `confirm()` may launch; it waits for discovery completion, registers, then sends one framed turn. A discovery-turn spawn can appear in the projection but cannot register a Tribunal run here. Host-side spawn hold remains outside batch ownership.
- **R7:** The status builder has a 2 KB cap and omits labels, providers, raw output, and errors. It is used only by `sendStatusTurn`.
- **R8:** No `MESSAGE_HANDLERS` provider, surface claim, or private listener was added.

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Reimplement launchability in this lib | Import private rule or mirror blocking logic | Narrow `@ptah-extension/tribunal-panel/phase` alias exports no `rosterIsLaunchable`; source `tribunal-roster-rules.ts:42-106` | Yes |
| Withhold role launch when folder allocation fails | Launch without manifest folder or withhold | `CommandCenterRunManifest.specTaskId` is required and nonempty in `command-center-records.ts:14-23`; A1 requires registration before launch | Yes |
| Snapshot parsed proposal for pending confirmation | Store shared card object or nested copy | Card could mutate lanes before click; coordinator revalidates its own copy | Yes |

## Integration limits

The page/card integration belongs to Batch 13, so no production caller yet constructs `TribunalRunCoordinator` or wires `ProposalTransport` to `tasks:create`, `CommandCenterRecordsService`, `answerQuestion`, and `sendLaunchTurn`. The coordinator contract and unit tests are implemented, but the paid-spawn flow is not end-to-end until that batch wires it. Existing `CommandCenterRecordsService` stores `runs` by `rootTabId` and writes one manifest per root; a second run overwrites the first on restart. That schema is outside this batch's owned files. The team leader should assign the multi-run persistence change before claiming AC15 restart support for two runs.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/work-projection.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/work-projection.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/status-context.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/status-context.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-roster-proposal.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/tribunal-run-coordinator.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/model/session-coordinator.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-8-report.md`
