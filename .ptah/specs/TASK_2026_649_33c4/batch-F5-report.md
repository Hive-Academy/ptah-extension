# Batch F5 report

## M1 — preserve turn attribution across equivalent roots

- Changed `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-turn-attribution.service.ts:8,52-58` to compare the active session root and requested root with `sameWorkspaceRoot`. Equal root strings still match; equivalent Windows casing and trailing separators now match too.
- Added `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-turn-attribution.service.spec.ts:95,102` cases for a trailing separator and Windows case difference.

## M2 — give closed workspace roots actionable guidance

- Added `HarnessProposalWorkspaceNotOpenError` with code `HARNESS_PROPOSAL_WORKSPACE_NOT_OPEN` in `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts:43-50`; `requireRoot` throws it at line 196 when the pinned root is not an open folder.
- Added a dedicated non-retry MCP message in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:2759-2766`. It asks the user to reopen the workspace and omits the underlying path.
- Updated `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts:245-263` to assert the class and error code for capture, save, and get. Added `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts:683-701` to assert the new guidance and path redaction.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `sameWorkspaceRoot` in capture | Strict string comparison; shared root comparison | The store already uses this helper for persisted roots, and F4 identified a spelling mismatch at capture. | Yes |
| Add a separate coded error class | Plain Error; extend the existing no-workspace class; separate class | The existing `HARNESS_PROPOSAL_NO_WORKSPACE` identifies a different condition; a separate code lets the dispatcher give precise guidance. | Yes |
| Map the new code before generic file-system handling | Generic retry text; dedicated non-retry text | A closed folder cannot be fixed by retrying the proposal. | Yes |

## Not done

- No checks were run (no Nx, Jest, TypeScript, lint, build, serve, or e2e), as requested. Runtime results are unverified.
- No changes were made for F4's M3 or minor note; both are outside this batch's scope.
