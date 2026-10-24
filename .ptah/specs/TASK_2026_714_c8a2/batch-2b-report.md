# Batch 2b report � TASK_2026_714_c8a2

Implemented Tasks 2b.1 and 2b.2. Production routing remains disabled; no registrations, index exports, task state, generated protocol artifacts, or Batch 2a files were edited.

## Files

Workspace: `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`.

Created:

- `libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts`
- `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts`
- `libs/backend/codex-runtime/src/lib/codex-protocol-manifest.ts`
- `libs/backend/codex-runtime/src/lib/codex-protocol-manifest.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-2b-report.md`

Modified:

- `libs/backend/codex-runtime/package.json:8`: declares `zod` at workspace version `4.6.5`.

No tsconfig changes were needed: tests load pinned JSON with Node filesystem APIs and validate its structure with Zod. Runtime code has no generated executable imports or schema-generation path. No installs or git commands were run.

## Implemented contracts

`validateCodexParams`, `validateCodexResult`, and `validateCodexFrame` reject unknown methods, malformed envelopes, params, and results with `CodexProtocolError`. Known literal methods have inferred params/result return types. Frame validation requires a pending request method for responses and validates the result before the caller settles its correlation entry. Error responses retain their error envelope rather than being accepted as successful results. The validator owns no correlation map or dispatch side effects.

Schemas cover all 19 pinned ThreadItem discriminators. Tests assert every modeled method exists in the pinned JSON schema, modeled top-level parameter field names exist there, required parameter fields are represented, and every pinned ThreadItem discriminator has a fixture. Structured method fields are validated; arbitrary JSON payloads such as tool arguments, configuration values, schema content, and metadata remain JSON data.

`verifyCodexBinary({executablePath, versionOutput, sha256, platform, arch}, manifest)` is pure and returns `{status: 'ok'}` or `{status: 'mismatch', reason}`. Reasons are `unsupportedPlatform`, `versionMismatch`, and `sha256Mismatch`. It compares the supplied reviewed manifest row and never reads or regenerates binaries or schemas.

## Modeled methods

Client requests (8), including results:

- `initialize`
- `thread/start`
- `thread/resume`
- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `thread/compact/start`
- `account/rateLimits/read`

Notifications (8):

- `initialized`
- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `turn/started`
- `turn/completed`
- `thread/tokenUsage/updated`
- `error`

Server requests (5), including responses:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`

## Decisions

1. Preserve the pinned manifest's existing single platform/architecture row rather than inventing a distribution registry. Evidence: `src/lib/protocol/codex-app-server-protocol.manifest.json:3` and Batch 2b.2. Implementation: `codex-protocol-manifest.ts:25`. The reviewed row is win32/x64; other platform/architecture combinations return `unsupportedPlatform`. Reversible when additional reviewed distributions exist.
2. Binary paths are diagnostic only. Compare trimmed exact `codex-cli <pinnedVersion>` output and well-formed SHA-256 hex, case-insensitively; do not compare paths or regenerate on mismatch. Options were path identity versus version/digest/platform identity; the latter is mandated by C9 and plan line 126. Implementation: `codex-protocol-manifest.ts:30`. Tests explicitly reject global 0.163.0 even with matching digest/path. Reversible only through reviewed manifest updates.
3. Require initialization capabilities with `experimentalApi: true`, even though the upstream schema allows omitted capabilities. Evidence: settled C2 and the batch contract. Implementation: `codex-protocol-validator.ts:539`. Reversible if the runtime no longer requires the experimental granular policy.
4. Command/file approvals accept only `accept`, `acceptForSession`, `decline`, and `cancel`; extra edited-input keys and amendment objects fail validation. Evidence: settled C1/C3. Implementation: `codex-protocol-validator.ts:12`, `:622`. This deliberately narrows the upstream decision alternatives; reversible only with a changed product contract.
5. Preserve distinct native responses: permissions use `{permissions, scope?, strictAutoReview?}`; MCP elicitation uses `{action, content?, _meta?}` and accepts the four pinned elicitation modes. Options were a generic decision response or native method-specific responses; the pinned schema and C4 require native shapes. Implementation: `codex-protocol-validator.ts:665` and `:692`. Reversible with a reviewed protocol revision.
6. Use strict modeled envelopes/objects rather than silently stripping misspelled fields. A response requires its pending method before result validation; downstream correlation/dispatch must call this boundary first. Evidence: plan lines 124�128 and Batch 2b.1. Implementation: `codex-protocol-validator.ts:745`, `:826`. Reversible if explicit extension handling is later required.

Paths in decision citations are relative to `libs/backend/codex-runtime/` (source filenames under `src/lib/`).

## Verification

Required commands were run in the requested order, with PowerShell `Select-Object -Last 30` replacing Unix `tail -30`.

- Scoped Jest: **2 suites passed, 120 tests passed, 0 snapshots**, final run 8.684 seconds. An earlier run passed 100 tests before adding the 19 item fixtures and discriminator completeness test. Final run covers all current semantic edits. Node emitted a non-fatal module-loading warning for the existing `jest.config.ts`.
- `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static`: **2 targets succeeded**, **0 lint errors**, **3 warnings**, **0/2 cache hits**, 13.0 seconds. The three reported warnings were in the unmodified `tools/evidence-harness.ts`: max-lines (739), preserve-caught-error (1737), and no-useless-assignment (2232). No Batch 2a errors were reported.
- Required `npx prettier --write`: completed on all five changed source/spec/package files after checks. No semantic changes followed the passing tests/typecheck/lint. The report was formatted separately.
- Final scoped `ptah_get_diagnostics` on the four source/spec files after formatting: **0 errors, 0 warnings**, clean coverage, TypeScript compiler source.

No workspace-wide verification, build, serve, e2e, install, or real evidence harness was run. Broader transport integration and exports belong to later/parallel batches. No requested work was blocked.
