# Batch B2a logic review fix

## Findings

1. **Replay identity changes across reads.** Cause: preserve-mode replay passed `Date.now()` into fallback event timestamps and synthesized message ids; a missing tool id also used a random generator. Fix: use a fixed fallback time origin, derive missing message ids from the JSONL line index and UUID, and derive missing tool ids from the line and event index. Parseable JSONL timestamps and SDK message ids still take precedence. `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:490-496, 537-545, 578-581`. Spec: `session-replay.service.spec.ts:113` compares complete replay output from two calls with missing ids and an invalid timestamp.

2. **Interleaved lines orphan blocks.** Cause: `continued` skipped non-assistant lines, while `continues` inspected only the next raw line. Fix: scan forward to the next assistant line with array content, matching the main loop's skip rule before deciding whether to emit `message_complete`. `session-replay.service.ts:656-665`. Spec: `session-replay.service.spec.ts:131` asserts one start, two indexed blocks and one completion across an interleaved user line.

3. **Correlated id validation is reported as a read failure.** Cause: the outer catch wrapped the reader's own `SdkError('Invalid agent id')`. Fix: rethrow that validation error before logging and wrapping I/O failures. `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:218`. Spec: `session-history-reader.service.spec.ts:269` verifies the validation message and absence of a read-failure warning.

4. **The retained tail can begin inside a message.** Cause: `events.slice(-10_000)` cut at any event index. Fix: advance the cutoff to the next `message_start`; if the final message alone exceeds 10,000 events, retain it from its start so the returned stream still has an opening event. `session-history-reader.service.ts:197-213`. Spec: `session-history-reader.service.spec.ts:234` cuts a stream of complete message triplets and verifies the first retained event is the next start.

## Decisions

- **Fallback identity:** Chose line UUID plus ordinal for absent SDK ids and a zero-based deterministic timestamp origin over wall-clock time. The plan's component 6 requires synthetic identity only as a fallback, and D15 permits merge only on equal SDK message ids or shared tool-use ids; synthetic ids remain stable for cursors without claiming SDK identity. Reversible: yes.
- **Tail boundary:** Chose a complete message boundary over an exact 10,000-event count when one message alone exceeds the cap. The B2a page contract pages individual events but the replay contract requires `message_start` around blocks. Reversible: yes; this exception can be changed with an explicit continuation contract.
- **Validation surface:** Kept only the reader's own invalid-agent-id error distinguishable; unrelated dependency errors keep the generic read-failure message and path-free warning. The B2a error contract uses `SdkError` for validation and generic read failures. Reversible: yes.

## Verification and handoff

Scoped `ptah_get_diagnostics` reported zero TypeScript errors in the four changed source/spec files after the fix. No tests, typecheck, lint or build were run, per the lane brief. The invoking workflow should run the agent-sdk project checks.

Files written:

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\session-history-reader.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B2a-fix.md`
