# Batch 10b-2b report

## Summary

Implemented native Codex binary detection and pin validation, read-only credential checks, and a `CodexContext.listModels()` catalog path in the lane adapter. An explicit validated binary path now reaches the runtime-provider port. The native adapter no longer throws capability-pending errors for these operations.

No verification, test, lint, typecheck, build, Nx, npm, or diagnostics command was run, as required by this batch.

## Files changed

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-binary.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-binary.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-auth.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-auth.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-models.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-catalog.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10b-2b-report.md

## Preserve-row mapping

| Row | Code | Spec case |
| --- | --- | --- |
| Detection and actual native binary | `NativeCodexLaneBinaryProbe.resolve`, adapter `detect` and `runSdk`; agent-sdk native path resolver preserves packaged Electron and both vendor layouts; SHA-256 is checked before version probe and runtime open | Absent binary; packaged root with `bin` and `codex` layouts; explicit valid path, changed hash and missing path; mismatch before runtime open; reported path/version |
| Credential check and account home | `FileCodexLaneCredentialProbe.check`, adapter `ensureTokensFresh`; selected `CODEX_HOME` only, Zod auth parse, shared stale-token rule, warning for stale/unreadable | Explicit home precedence with valid default-home credential; missing selected home; stale token; unreadable auth; adapter warning; no login path |
| Model selection and catalog | Adapter `listModels` uses `CodexContext.listModels`, 30-second binary-keyed cache, warned curated fallback; `runSdk` projects requested/default model; label is ` (Ptah lane default)` | Catalog projection and label; cache reuse and expiry; visible fallback; requested/default profile model. Pagination is implemented and covered in existing `codex-runtime.spec.ts` model-list cases at lines 512-628. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Validate binary SHA-256 before invoking `--version`; then require exact pinned output | Version first, package version, hash first | `codex-executable-pin.ts` exposes the reviewed pin; `codex-protocol-manifest.ts` checks version and hash. Hash-first ensures a mismatched binary is never spawned even for a version probe. | Yes |
| Add a binary path parameter and separate `openCatalog` method to the injectable runtime-provider port | Resolve container in adapter, reuse a running chat context, narrow port | The adapter owns neither host composition nor chat contexts; review amendment R3 forbids sharing a chat context. Host wiring belongs to 10d. | Yes |
| Retain the legacy seven-model curated fallback and 30-second catalog cache, with a warning on failure | Empty list, silent fallback, warned fallback | Legacy `codex-cli.adapter.ts` defines the seven models, label and 30-second TTL; `CodexContext.listModels` handles cursor pagination. | Yes |
| Read auth only from selected `CODEX_HOME`, and report stale/unreadable via injected logger | Default-home retry, refresh/login, read-only check | Legacy token spec and shared `isCodexAccessTokenStale` rule establish the read-only behavior. | Yes |

## Proposed Removals

None of the three preserve rows. Removed the now-unused exported `CodexLaneCapabilityPendingError` class after replacing all pending throws; a workspace text search found no other references.

## Clarifications Needed

None.

## Not done

- Host wiring for `openCatalog` and the validated binary path is deferred to batch 10d by the task scope; no `apps/*` files were touched.
- Batch 10d must bind the credential probe and catalog context to the lane's selected account home, and add the 10d.E spec proving the catalog context is distinct from the chat context (review defect 9).
- Requested verification was prohibited. Specs were written but not executed; compile and runtime results remain unverified.
- Skill discovery found the local `.claude/skills/agent-lanes/SKILL.md`, which was read. No invocable skill command was exposed in this CLI, so the local file read was the fallback.

## Revision 1

| Item | Fix | Spec case |
| --- | --- | --- |
| A1 / B1 | Keep the catalog probe in a local variable before awaiting its output. | Adapter catalog success/cache case exercises the local probe. |
| A2 | Map `ENOENT` and `ENOTDIR` auth reads to `missing`; other read or parse failures remain `unreadable`. | Explicit missing `CODEX_HOME`, auth beneath a file, and invalid auth cases. |
| B2 | Resolve the binary inside the catalog `try`; warn with the error class and return the curated catalog on failure. | Binary probe rejection falls back without opening a context. |
| B3 | Bound catalog open and list to 8 seconds; close the context once, including one that opens after timeout. | Fake-timer open and list hangs return fallback; both the late and already opened contexts close. |
| B4 | Memoize verification by realpath, size, mtime, and pin; check the 30-second catalog cache before binary resolution. | Repeated binary resolution reads the stream once; changed mtime rehashes; catalog cache test checks probe count. |
| B5 | Clear a rejected catalog promise when it is still the current cache entry. | A catalog failure is followed by a fresh catalog open rather than replaying the failure. |
| B6 | Catch detection probe errors, warn with the error class, and return `installed: false`. | Detection pin mismatch reports not installed without opening a process. |
| B7 | Label `ptah-default` only when the default was applied; otherwise use the supplied source or `unknown`. | Explicit `gpt-6-sol` rejection uses unknown-source advice; applied default uses Ptah-default advice. |
| B8 | Treat an empty requested model as absent and choose the resolved model or lane default. | Empty `options.model` reaches the profile as `gpt-6-sol`. |

Review defect 9 remains in **Not done** for batch 10d. The coordinator's failed verify results are addressed in code, but no verification command was run in this lane under the hard rules. Skill invocation was unavailable; the previous lane read the local agent-lanes skill directly.
