# Batch B2a — structured subagent history read

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\shared\src\lib\types\subagent-registry.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\helpers\history\history-event-factory.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\helpers\history\history-event-factory.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\helpers\history\session-replay.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\session-history-reader.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B2a.md`

## Acceptance by task

- **B2a.1:** Added the exact request and result page fields to the existing shared subagent types file. Its existing shared barrel already exports this file. No RPC registration was added.
- **B2a.2:** Added agent-scoped thinking deltas in content order. Main replay retains synthetic identity and timing. The public per-agent replay uses JSONL message IDs and timestamps, groups adjacent lines with the same ID, and carries block indices across those lines.
- **B2a.3:** Added `readSubagentEvents` with direct or correlated agent ID, path-segment validation before joins, nested/legacy/workflow lookup, existing JSONL parsing with its 50 MB guard, 10,000-event tail retention, and safe error text. It distinguishes `not-found` and `unresolved`.

## New spec cases

- Factory: agent thinking delta fields and parent linkage.
- Replay: real ID/timestamp, thinking/text/tool ordering, consecutive-line grouping, and empty thinking; updated existing collector assertion for main-history thinking.
- Reader: three locations, known missing agent, correlation, unresolved ID, unsafe ID, oversized read error text, and event-tail truncation.

## Plan risks handled

- A3/A6/A7: per-agent identity and running block index come from JSONL; main replay continues to use synthetic IDs.
- Missing IDs resolve through the existing Task-to-agent correlation logic; no match is reported as `unresolved`.
- Path traversal is rejected before file joins; read errors expose only a generic message. The existing JSONL reader retains the 50 MB limit.
- The RPC wire-size and clipping risks in D16 belong to B2b; no RPC handler, schema, or registry was changed here.

## Decisions

- **Correlation placement:** Reused the correlation service through a small `SessionReplayService.correlateAgentId` method, rather than adding a new reader DI dependency. Evidence: the replay service already injects `AgentCorrelationService` and uses the same Task and agent maps. Reversible: yes.
- **Project lookup:** Enumerated the JSONL reader's existing sessions directories, then checked the parent session file before reading an agent. Evidence: `readSubagentEvents` has no workspace path, while `JsonlReaderService.listSessionsDirectories` already exposes those directories. Reversible: yes.
- **Failure surface:** Kept status values for absent history and used a generic `SdkError` for read failures. Evidence: the page contract distinguishes `not-found`/`unresolved` but has no error status; file paths must not enter user-visible errors. Reversible: yes.

## Verification

No test, typecheck, lint, build, serve, e2e, or package command was run, as the lane brief requires. Ptah AST parsing returned `ok` with zero error nodes for the edited reader, replay service, and reader spec. Scoped `ptah_get_diagnostics` was attempted but reported TypeScript unavailable after 45 seconds, with all seven files unchecked.

Team-leader commands, one at a time:

1. `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/agent-sdk --parallel=1`
2. `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/agent-sdk --parallel=1`
3. `npx nx run-many -t lint -p @ptah-extension/shared @ptah-extension/agent-sdk --parallel=1`
