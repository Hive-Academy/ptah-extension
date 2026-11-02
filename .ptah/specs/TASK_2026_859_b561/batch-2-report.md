# Batch 2 Report — Registry Provider and RPC Error Propagation

Status: COMPLETE

## Scope

- Task 2.1 is complete: current registry endpoints, envelope validation, coded shape errors, fixtures, and unit tests.
- Task 2.2 is complete: coded search/popular results, details code logging, and unit tests.
- Worktree: `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api`.

## Files Created or Modified

- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry.provider.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-registry.provider.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/__fixtures__/mcp-registry/list-page.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/__fixtures__/mcp-registry/detail-remote-only.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/__fixtures__/mcp-registry/detail-env-vars.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/cli-agent-runtime/src/lib/mcp-directory/__fixtures__/mcp-registry/detail-404.json`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/.ptah/specs/TASK_2026_859_b561/batch-2-report.md`
- `/home/amun/ptah-extension/.claude-worktrees/mcp-registry-api/node_modules` (local git-ignored dependency symlink)

## Task 2.1 Evidence

- The provider uses `metadata.nextCursor` and returns the internal `next_cursor` field.
- The detail URL uses `encodeURIComponent(name)` and `/versions/latest`.
- The Zod schemas validate the current `{ server, _meta }` envelope. Legacy flat entries are rejected.
- Every accepted package has a required `transport` object. Registry and transport type strings remain permissive.
- The provider maps official `publishedAt` and `updatedAt` timestamps and sets `source: 'official'`.
- `McpRegistryShapeError` carries `code: 'MCP_REGISTRY_SHAPE_UNKNOWN'`.
- List envelope failures, invalid JSON, and all-invalid non-empty lists throw the coded error.
- A malformed item is dropped with the existing warning when another item is valid. Logs contain names and issue paths, not wire values.
- Detail 404 and network failures return `null`. Detail shape failures throw the coded error.
- The spec uses all four recorded fixtures and covers packages, remotes, pagination, cache behavior, URLs, and failure paths.

## Task 2.2 Evidence

- Search and getPopular capture and log the error, then return `errorCode` and the shared user-safe message for a registry shape error.
- Other errors keep their existing empty-list behavior.
- getDetails keeps its `{ name }` fallback and logs `errorCode` for a registry shape error.
- The RPC spec has one shape-error case for search, getPopular, and getDetails.
- `git diff --check` passed for the four TypeScript source/spec files.

## Plan Validation Handling

### R1

Search and getPopular no longer swallow a coded provider shape failure into an unmarked empty list. They return the optional `errorCode` and `error` fields added in Batch 1.

### R7

`getServerDetails` rethrows `McpRegistryShapeError` and returns `null` only for 404 or request failures. The RPC details handler preserves its result contract and logs the code.

### D6

Pagination reads only `metadata.nextCursor` from the wire response. The public internal response keeps `next_cursor` unchanged.

## Fixture Comparison

`cmp` exited 0 for each pair:

- `list-page.json`: byte-identical.
- `detail-remote-only.json`: byte-identical.
- `detail-env-vars.json`: byte-identical.
- `detail-404.json`: byte-identical.

## Verification

1. The first command queued behind other repository checks and acquired a slot. The background harness stopped it at its 30-minute limit before it produced results.
2. The second command completed with Nx exit code 1: four targets succeeded or used cache, and both test targets failed. The saved logs showed that `node_modules/marked/lib/marked.umd.js` was absent. This worktree had no `node_modules`; the main checkout had the dependency. No assertion failure was reported.
3. Added the git-ignored `node_modules` symlink to `/home/amun/ptah-extension/node_modules`, matching other worktrees. Confirmed that the Marked UMD path resolves.
4. The final required command passed: Nx exit code 0, six successful targets, four cache hits. Nx marked both test targets as flaky because their earlier dependency-load failures were followed by passes.

Final command:

```bash
npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers 2>&1 | tail -40
```

Final output tail:

```text
[verify 2026-11-01T16:53:09.919Z] lock slot 1 acquired after 400s: verify lint,test,typecheck (@ptah-extension/cli-agent-runtime,@ptah-extension/rpc-handlers)

 NX   6 tasks: 6 succeeded, 4 cached


Re-run with --output-style=static to inline logs.


 NX   Nx detected 2 flaky tasks

  @ptah-extension/rpc-handlers:test
  @ptah-extension/cli-agent-runtime:test

Flaky tasks can disrupt your CI pipeline. Automatically retry them with Nx Cloud. Learn more at https://nx.dev/ci/features/flaky-tasks

  Run duration:      12m 7s
  Cache:             4/6 hit (67%)
  Critical path:     6m 48s (1 task)
  Recoverable time:  5m 18s (44% of the run)

  Recommendation: Increase parallelism to recover up to 5m 18s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
[verify 2026-11-01T17:05:28.092Z] lock released after 738.2s, exit code 0

[exited with code 0]
```

## Decisions

- Used a code-property type guard in the RPC handlers instead of exporting `McpRegistryShapeError` from the runtime barrel. The batch explicitly permits this option and keeps the change inside the assigned files.
- Kept unknown package transport strings parseable with optional transport URLs. Known remotes still require `url`. This lets the shared mapper return a transport-support error instead of a shape error.
- Required `description` and `version` on official server entries, matching the recorded 2025-12-11 server.json schema.
- Added the local dependency symlink after confirming the same pattern in other worktrees. No package manifest or lockfile changed.
- Made no install-scope changes and ran no git state-changing commands.
