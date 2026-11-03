# Batch 6f CORE report

Implemented P6 fix 7 native model listing and the P6 home-key contract test. Verification remains pending; no passing test claim is made.

## Work completed

1. `libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts:108`: strict model/list request and response schemas matching the pinned v2 ModelListParams, ModelListResponse, Model and nested model definitions. Includes nullable/optional cursor, includeHidden and uint32 limit; validates all known catalog metadata rather than accepting arbitrary nested objects.
2. `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts:238`: exact CodexModelInfo interface; CodexContext.listModels at line 247. Public type export in `src/index.ts:24`.
3. `libs/backend/codex-runtime/src/lib/codex-runtime.ts:671`: sends model/list through the context's existing process.request JSONL path, which validates request and response and supplies the existing request timeout. Serializes with existing context operations, asserts readiness, fetches up to 100 pages at requested page size 100, detects repeated opaque cursors, and fails rather than returning partial results. Existing CodexRequestRejectedError remains sanitized; other failures use “Codex model listing failed” and the existing failure/close path. Already closed contexts receive “Codex context is not ready”.
4. `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts:264`: success mapping, empty opaque cursor pagination, null/absent final cursor, malformed response and unknown-field rejection, repeated cursor, 100-page bound, sanitized rejection, closed context, and strict request parameter cases.
5. `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts:87`: added model/list fixture to existing exhaustive request coverage. No validator production wiring is needed because the registry already derives its methods/types from codexRequestSchemas.
6. `libs/backend/codex-runtime/src/lib/codex-home-path.spec.ts:16`: parameterized shared identity contract for drive root, UNC root/nested, POSIX root/nested and Windows nested homes, using explicit platform arguments.
7. `libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts:59`: added only listModels to its CodexContext fake.

## model/list field mapping

| Wire field                                  | CodexModelInfo field                                       |
| ------------------------------------------- | ---------------------------------------------------------- |
| id                                          | id (unchanged; not replaced with the distinct model field) |
| displayName                                 | displayName                                                |
| description                                 | description                                                |
| isDefault                                   | isDefault                                                  |
| supportedReasoningEfforts[].reasoningEffort | supportedEfforts[]                                         |

The pinned schema requires description and supportedReasoningEfforts, so valid responses always supply these optional public-contract fields. No defaults or invented display/effort values are added. Other catalog metadata is validated but not exposed through this narrow contract.

## Verification

All eight changed TypeScript files were formatted with the repository Prettier executable.

Requested ptah_get_diagnostics on changed files. The completed intermediate result reported one owned error (schema not exported from the shared root) and concurrent agent-sdk sibling errors. Fixed the owned error by using the existing shared/schemas entry point. Post-fix diagnostics did not finish within the tool response window:

> Source: typescript-compiler — Unavailable
> TypeScript check still running after 45s. It was not cancelled — retry shortly and the completed result is served from cache.
> Coverage: qualified — 8 files unchecked.

Started exactly one scoped command:

```text
npm run verify -- -p @ptah-extension/codex-runtime
```

Last captured output:

> [verify 2026-10-25T21:07:22.360Z] waiting on pid 8396 [verify lint,test,typecheck (@ptah-extension/agent-generation,ptah-electron,ptah-extension-vscode,ptah-cli)] in D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment since 2026-10-25T21:01:03.036Z (queue position 3)

The command remains running/queued at handoff (exec session 88659); its output is written to `$env:TEMP/ptah-6f-core-verify.log`. One completion check returned still running. No second suite or workspace-wide verification was run. The team leader must consume its result or run the authoritative verification. No live/paid model calls, dependency installation, host edits or git commands were used.

## Decisions

- **Bound pagination at 100 pages, requesting 100 entries per page; detect repeated cursors.** Options: unbounded fetching, silent truncation, bounded explicit failure. Evidence: pinned ModelListParams/ModelListResponse expose opaque cursors; the assignment requires bounded fetching of all pages. Selected explicit failure to avoid a misleading partial catalog. Reversible: yes.
- **Use the existing serialized context/process path and safe-error pattern.** Options: separate process/client or existing process.request. Evidence: runtime context methods and CodexAppServerProcess already own validation, timeouts and sanitized rejection. Selected the existing path as required. Reversible: yes.
- **Import SessionRuntimeIdentitySchema from @ptah-extension/shared/schemas.** Options: shared root or existing schema entry point. Evidence: shared/src/schemas.ts exports session-runtime.schemas; shared root does not; diagnostics confirmed the missing root export. Selected the existing entry point without expanding ownership. Reversible: yes.
- **Update the validator specification fixture without changing validator source.** Options: change dynamic validator plumbing or extend its exhaustive fixtures. Evidence: validator registry/types are derived from codexRequestSchemas; validator.spec asserts exact fixture method coverage. Selected fixture-only wiring. Reversible: yes.

## Absolute files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-protocol-methods.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.types.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-home-path.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/gateway-chat-bridge/src/lib/codex-gateway-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6f-core-report.md
