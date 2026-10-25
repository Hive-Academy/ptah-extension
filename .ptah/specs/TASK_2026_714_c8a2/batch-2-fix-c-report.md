# P2 review fixes — lane C

Implemented style findings 1 and 2 for TASK_2026_714_c8a2. Only lane-owned source/spec/fixture files and this report were written. No git commands were run.

## File layout

All paths below are relative to `libs/backend/codex-runtime/src/lib/`:

| File | Lines | Responsibility |
| --- | ---: | --- |
| codex-protocol-schemas.ts | 536 | Shared Zod schema constants |
| codex-protocol-methods.ts | 305 | Request, server-request and notification schema tables |
| codex-protocol-validator.ts | 247 | Dispatch, frame validation, error and public types; table re-exports |
| codex-protocol-validator.spec.ts | 782 | Existing validation assertions with library-local evidence input |
| codex-event-translator.spec.ts | 473 | Existing synthetic replay assertions with library-local evidence input |

Each split source file is below 700 lines. Prettier was run on all five TypeScript files and all six JSON fixtures.

## Public exports and behavior

Before/after `ptah_ast_analyze` export lists contain the same 15 names:

`codexRequestSchemas`, `codexServerRequestSchemas`, `codexNotificationSchemas`, `CodexRequestMethod`, `CodexNotificationMethod`, `CodexProtocolMethod`, `CodexRequestParams`, `CodexRequestResult`, `CodexProtocolErrorCode`, `CodexProtocolError`, `isUnmodeledCodexNotification`, `validateCodexParams`, `validateCodexResult`, `CodexProtocolFrame`, `validateCodexFrame`.

The three tables are explicitly re-exported from the original validator module. The other declarations remain in place. All existing importer paths remain valid. The extraction script compared original schema declarations (ignoring newly required export modifiers), table bodies, and the entire dispatch suffix before formatting: all were identical. No schema semantics or validation control flow were changed.

## Fixtures

The existing backend convention was checked in `libs/backend/agent-sdk/src/lib/helpers/history/__fixtures__/`; this library now uses `src/lib/__fixtures__/spike-run-6e.json` through `spike-run-6j.json`.

Fixtures are nested ordered event lists, retaining sequence boundaries but no case IDs. Each event has only a string `method` and an optional string `itemType`. Empty sequences and outbound events were omitted. Recursive extraction of inbound methods from each original evidence document was compared with the flattened fixture: exact ordered equality in all six runs.

| Run | Nonempty sequences | Inbound events |
| --- | ---: | ---: |
| 6e | 2 | 71 |
| 6f | 2 | 90 |
| 6g | 1 | 42 |
| 6h | 5 | 204 |
| 6i | 2 | 117 |
| 6j | 1 | 125 |

Total: 649 events, 16 distinct methods. Item types: userMessage, mcpToolCall, agentMessage, commandExecution. Validator replay still covers all six runs and asserts 16 methods; translator replay still covers 6h–6j, with synthetic payloads and synthetic replay identity. Existing validation, translation, tool-correlation and terminal assertions remain.

A structural scan confirmed that every fixture field is method/itemType and every value is a string. `rg` scans for credentials, tokens, paths, IDs and usage fields matched only the expected protocol method `thread/tokenUsage/updated`; no secrets, paths, IDs, user names or usage numbers are stored. A scan of both specs for `.ptah` and parent-directory traversal returned no matches (exit 1).

## Verification

PowerShell `Select-Object -Last` and `Select-String` replaced the requested shell `tail` and `grep` filters. Exit codes below were captured immediately after the underlying commands.

- `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts libs/backend/codex-runtime/src/lib/codex-event-translator.spec.ts --coverage=false --maxWorkers=2`: exit 0; 2 suites passed, 305 tests passed, 0 snapshots, 18.904 seconds. Node emitted an ES-module-loading warning for jest.config.ts; tests still passed.
- `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static`: exit 1. Filtered output: 8 problems (1 error, 7 warnings). Error: `480:7 Unexpected newline between object and [ of property access (no-unexpected-multiline)`. The requested filter omitted its filename, so attribution is unconfirmed; do not treat this as a clean lint result. The max-lines warning reported 2346 counted lines at 739:1, not any split validator source file. No max-lines warning for the validator split files appeared. No TypeScript error appeared in the filtered output; the combined check nevertheless failed. The failed check was not rerun to retrieve output.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 1; `libs/backend/codex-runtime: 1 FAIL (baseline 0)`; `TOTAL 277 unsuppressed site(s)`. Runtime failure: `codex-runtime.ts:608 [orphaned-suppression]` for the onFailure/unfinished-turn interrupt comment. That source belongs to lane A and was not edited.
- `ptah_get_diagnostics`, scoped to the five edited TypeScript files: unavailable after 45 seconds, five files unchecked; tool stated its TypeScript check continued in the background. This is not a diagnostics pass.
- `npx prettier --write` on the five TypeScript files and six JSON fixtures: exit 0.

The worktree was being edited by parallel lanes. Combined Nx and degradation failures above remain for the coordinator to reconcile; this lane did not modify other lanes' files.

## Decisions

1. Use the three-file schema/table/dispatch split explicitly suggested by the current assignment, rather than further schema subdivision. Evidence: existing source boundaries and the review finding; all resulting source files are below 700 lines. Reversible internal organization; existing validator exports are preserved.
2. Use nested JSON arrays containing only method/itemType rather than copying sanitized task documents wholesale. Evidence: the specs consume only inbound method order and item type, and backend agent-sdk already uses colocated fixtures. Sequence grouping preserves translator resets; synthetic identity replaces recorded IDs. Reversible fixture representation with unchanged assertions.
3. Follow the current lane assignment over the broader historical batch scope. Evidence: the user explicitly restricts source ownership and asks for these two review fixes; other lanes own runtime/process/profile/registration changes. No cross-lane edits were made.
