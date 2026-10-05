# Batch 17 report — Lane run accounting in `AgentMonitorStore`

Executor: frontend-developer. Task: 17.1. No git was run. `batches.md` was not edited.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-streaming\src\lib\agent-monitor.store.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-streaming\src\lib\agent-monitor.retention.spec.ts`

No other file was touched. No settings path, dashboard file, backend lib, or `session-stats-summary.component.*` was changed. `PlanLimitsStore` is not imported.

## Task 17.1 evidence

| Requirement | Where |
| --- | --- |
| `MonitoredAgent` gains `usageTotals`, `role?`, `failureKind?`, `quotaOwner?` | Appended at the end of the interface, after `workflowName`, to keep the R5 overlap with 597 to one hunk. `quotaOwner` is the full `QuotaOwnerRef` (G3), not a key string. `failureKind` is `AgentFailureKind` from `AgentProcessInfo`. |
| Usage folded with `addCliUsage` **before** `capSegments` | `onAgentOutput`. The fold runs over the raw `delta.segments`, before the text-run merge and before `capSegments`. The merge keeps only the earlier segment's fields (`...existing[lastIdx]`), so folding after the merge would also lose usage. `addCliUsage` is imported from `@ptah-extension/shared` (Batch 2). |
| Spawn copies `role`, `failureKind`, `quotaOwner` | `onAgentSpawned`. Fresh and replacement cards start at `usageTotals: null`. A re-open of the same id keeps the folded usage and the owner (`info.quotaOwner ?? existing`) and takes `failureKind` from the new payload, which clears an old failure. |
| Exit copies the fields | `onAgentExited`: `failureKind` from the exit payload. `quotaOwner` is `info.quotaOwner ?? agent.quotaOwner`, so the backend's unknown-to-known upgrade lands. `role` prefers the payload. |
| Restore path | `loadCliSessions`: `usageTotals: null`. Persisted segments are deliberately not folded (Decision 8, Req 8.4). `quotaOwner: ref.quotaOwner` may be absent. `role`/`failureKind` do not exist on `CliSessionReference`, so they stay absent. |
| Unknown never 0 | A lane with no usage-bearing segment stays `null`. `addCliUsage` keeps unreported fields `undefined`. Both are pinned by specs. |

`capSegments` itself (`agent-output-retention.ts`) is unchanged. The fold sits beside its call site, so totals no longer depend on it.

### Specs added

- `agent-monitor.retention.spec.ts`:
  - **Exact totals past 600 segments.** The run streams 800 segments: interleaved text-merge pairs and `tool-call` segments, all carrying usage. The spec asserts that the trim marker exists and the length is ≤ 600. `usageTotals` equals the full sum of input and output tokens and keeps the latest model and cost.
  - **Null with no usage.** 800 segments without usage leave `usageTotals` `null`.
- `agent-monitor.store.spec.ts`, describe `lane run accounting (TASK_2026_596)`, 6 cases:
  - A live lane starts with `null` usage and copies role and owner (full ref).
  - Every usage segment in a delta is folded.
  - Exit copies `failureKind:'quota'` and upgrades an unknown owner to a known one.
  - Exit with neither field keeps the spawn owner and role.
  - Re-open clears the failure but keeps the usage and owner.
  - Restore gives `usageTotals` `null` (even with usage-bearing persisted segments). The owner is copied when present and `undefined` when absent (legacy).

## Verification

- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-streaming` (foreground, no extra flags): **3/3 targets succeeded** (typecheck, lint, test). Cache 0/3 hit.
- Count read from a direct jest run of the same config (`--maxWorkers=2`): **24/24 suites, 536 passed, 1 skipped (pre-existing), 0 failed**. The 8 new cases were confirmed with a `-t` filtered run: 8 passed.
- Not run: `@ptah-extension/chat` and `@ptah-extension/tribunal-panel`, which consume `MonitoredAgent`. They are outside Batch 17's verification line. Every new field is optional, so their existing object literals still type-check.

## Plan deviation

- **`usageTotals` is optional (`usageTotals?: CliUsageTotals | null`), not the required `CliUsageTotals | null` that Component 14 names.**
  - A required field breaks the `MonitoredAgent` literals in 9 spec files outside this batch's ownership:
    - `libs/frontend/chat/**`: `agent-card-unified`, `cli-agent-output`, `stdout-visibility`, `agent-continue-input`, `agent-monitor-panel`, `agent-lane-panel`, `chat-view`
    - `libs/frontend/tribunal-panel/**`: `tribunal-state`, `tribunal-progress`, `vendor-card`
  - Every store writer sets the field explicitly (`null`, or a folded total), so store-produced agents never lack it.
  - **Consumers (Batch 18/19) must treat `null` and `undefined` alike as "unknown".**

## Carry-forwards

1. **Batch 18/19.** Read `usageTotals == null` as unknown, never 0. A non-null total can still carry `undefined` token, cost or model fields; each also reads "unknown".
2. **Batch 20.** Derive `ownerKeys` from `agent.quotaOwner?.key`. A run with no owner contributes no key and is shown as an unknown owner, never the current one.
3. **Phase 6 review (Minor, not fixed).** A same-id re-open of a card rebuilt by `loadCliSessions` would fold the new run's usage onto `null` and show a partial total as known. Backend resumes use a new `agentId` (`resumedFromAgentId` → replacement card with `usageTotals:null`), so this needs a restored id to be reused live. That path was not observed.
4. **Phase 6 review (behaviour choice).** `failureKind` is taken from each spawn and exit payload, so it is never carried forward. A re-open or a later exit without it clears an old classification.
5. **R5 / 597.** The `MonitoredAgent` edit is one appended block at the end of the interface. The other hunks are small, field-level additions in `onAgentSpawned` (3 sites), `onAgentOutput` (fold before merge and cap), `onAgentExited` and `loadCliSessions`. No 597 behaviour was added.
