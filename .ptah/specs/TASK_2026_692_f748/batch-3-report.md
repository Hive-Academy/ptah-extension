# Batch 3 report

## Completed

- Task 3.1: Implemented `MainRequestTracker` and `classifyCacheTtl`. O(1) frame handling, caller supplied timestamps, malformed frame guard, last request selection, TTL split classification, and D3 anchor. Specs cover A4's assistant usage split, read-only last request after a 1h write, the seven-minute delayed response anchored at send time, deduplication, and malformed/subagent frames.
- Task 3.2: Implemented pure `evaluateFireGate` with the plan's refusal order. Specs cover AC 3.1 through 3.9, including exact lateness boundary, expiry, OBSERVE_ONLY eligibility, and Codex proxy refusal.

## Verification

- Focused Jest command: 2 suites passed, 18 tests passed (`--coverage=false --maxWorkers=2`).
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/agent-sdk --parallel=1`: passed.
- `ptah_get_diagnostics` on the four changed source/spec files: 0 errors, 0 warnings.

## Risks and assumptions

- A1/D3: Applied `max(turnStartAt, lastNonRequestFrameAt - 5_000)`; the seven-minute first-response test confirms the anchor stays at the construction/send time. The plan's live TTFT comparison remains for the later integration probe.
- A4: A top-level assistant fixture with `message.usage.cache_creation` split confirms the existing parser and TTL classifier can observe a 1h write. Live SDK confirmation remains for the later integration probe.
- A2 and A3 concern the streamed `/compact` integration and event ordering; this pure batch does not send commands or process compaction completion. The plan assigns those checks to the live probe in later batches.

## Decisions

- The fire gate accepts the three resolved setting values as a small injected object (`idleCompactionEnabled`, `autoCompactEnabled`, `minTokens`). The plan names the checks and settings, but not the lookup object's property names. This keeps the function pure; the later service can supply its existing resolved values. Reversible by renaming the lookup fields.
- The tracker uses the existing `readSubagentRequestUsage` parser for main-thread assistant frames, as the plan directs. Its module transitively loads tsyringe, so the focused spec imports `reflect-metadata` first. Reversible if the parser is later separated from the monitor module.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-request-tracker.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-request-tracker.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-fire-gate.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-fire-gate.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-3-report.md`
