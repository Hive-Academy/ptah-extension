# Batch B6b report

## Files changed

- Modified `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\helpers\subagent-message-dispatcher.ts`: removed the unused SDK transcript reader, normalization, text renderer, local types, and their imports.
- Modified `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\helpers\subagent-message-dispatcher.spec.ts`: removed only the reader mock, reader tests, and obsolete test description.
- Modified `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\shared\src\lib\types\subagent-registry.types.ts`: removed the three obsolete transcript interfaces and documentation.
- Created `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B6b.md`: this report.

## Evidence

- The remaining dispatcher methods and shared history-page interfaces parsed cleanly under `ptah_ast_analyze` (zero syntax errors in all three changed TypeScript files).
- Scoped `ptah_get_diagnostics` returned zero TypeScript errors and warnings with clean coverage.
- No tests, typecheck, lint, build, serve, e2e, or package commands were run, per the lane brief.
- `libs/shared/src/index.ts` uses a wildcard export of the type file, so no explicit barrel export required removal.

## Final requested search

Command: `rg -n "getSubagentTranscript|SubagentTranscriptMessage|SubagentTranscriptParams|SubagentTranscriptResult|SubagentTranscriptSchema|SubagentTranscriptInput|SubagentTranscriptSdkModule|normalizeTranscript" libs apps --glob '!**/host-source-registry.baseline.ts'`

Output: none (zero hits).

## Risk 11

`SubagentTranscriptProbe` and `probeSubagentTranscript` remain in `chat-ptah-cli.service.ts` and continue to be used by `chat-subagent-context-injector.service.ts`. Their supporting code and specs were untouched. `subagent:history-page` and its shared request/result types remain. `host-source-registry.baseline.ts` was untouched.

## Decisions

| Decision                                                                              | Options                      | Evidence                                                                                                                          | Reversible |
| ------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Remove `renderMessageText` and `RawSubagentSessionMessage` with the transcript reader | Keep as helpers / remove     | `renderMessageText` was called only by `normalizeTranscript`; the raw type was used only by the removed SDK module and normalizer | Yes        |
| Leave the shared barrel unchanged                                                     | Edit wildcard export / leave | `libs/shared/src/index.ts` exports the type module with `export *`; the removed interfaces disappear automatically                | Yes        |
