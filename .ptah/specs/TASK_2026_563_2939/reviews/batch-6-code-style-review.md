# Code Style Review — `TASK_2026_563_2939`, Batch 6

## Summary

| Metric          | Value                       |
| --------------- | --------------------------- |
| Overall score   | 8/10                        |
| Assessment      | APPROVED                    |
| Blocking issues | 0                           |
| Serious issues  | 0                           |
| Minor issues    | 1                           |
| Files reviewed  | 7 batch files, read in full |

Scope: `rpc-memory.types.ts`, `rpc.types.ts`, `memory-rpc.schema.ts`, `memory-rpc.schema.spec.ts`, `memory-rpc.handlers.ts`, `memory-rpc.handlers.spec.ts`, and `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`. All file reads and operations are strictly confined to `D:\projects\ptah-extension-memory-quality-source`.

The implementation of Batch 6 adheres cleanly to the architectural and structural conventions of the repository:

1. **Naming and Wire Contracts:** Method names (`memory:listQuarantined`, `memory:restoreQuarantined`), parameter/result types (`MemoryListQuarantinedParams`, `MemoryListQuarantinedResult`, `MemoryRestoreQuarantinedParams`, `MemoryRestoreQuarantinedResult`), wire representation (`QuarantinedMemoryWire`), and Zod schemas follow established `memory:*` precedent (e.g. `MemoryListResult`, `MemoryPurgeJunkParams`, `MemoryWire`).
2. **Registry and Surface Synchronization:** Placed contiguously and consistently in `libs/shared/src/lib/types/rpc.types.ts` (`RpcMethodRegistry`, `RPC_METHOD_ENTRIES`), `MemoryRpcHandlers.METHODS`, and sorted alphabetically into `VSCODE_EXPECTED_ABSENT_METHODS` in `rpc-surface.spec.ts`.
3. **Handler Structure and Error Boundaries:** Follows the `memory:purgeJunk` precedent for parameter validation, workspace authorization, and error sanitization (`PERSISTENCE_UNAVAILABLE`, `INVALID_PARAMS`, `UNAUTHORIZED_WORKSPACE`), never leaking raw database exceptions or internal messages across the RPC boundary.
4. **Boundary-Safe Test Harness:** The real-store test harness in `memory-rpc.handlers.spec.ts` uses local SQLite bindings and a minimal transaction shim, strictly respecting Nx module boundaries without deep-importing private test helpers from sibling packages.

The code sits firmly in the sound 7–8 band. A single stale file-level docstring in `memory-rpc.handlers.ts` and the continued positional growth of the handler surface keep it below the exemplary 9–10 band.

## Five style questions

### 1. What breaks in six months?

- **Regex constraint on quarantine reasons:** In `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.schema.ts:114-117`, `QuarantineReasonSchema` enforces `^rule:[a-z0-9-]+$`. If future quarantine rules introduce hierarchical namespaces or dots (e.g., `rule:commitlint.scope` or `rule:subsystem:rule-id`), the schema will reject them at the boundary with `INVALID_PARAMS`.
- **Registry and surface synchronization:** Adding new RPC methods requires synchronized edits across four locations: `rpc-memory.types.ts`, `rpc.types.ts`, `memory-rpc.handlers.ts:METHODS`, and `rpc-surface.spec.ts:VSCODE_EXPECTED_ABSENT_METHODS`. In this batch, all four are maintained in lockstep.

### 2. What would a new team member misread?

- **Stale file header count:** In `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:4-6`, the top-level JSDoc states:
  > `Surfaces 8 memory:* methods backed by the @ptah-extension/memory-curator library: list / search / get / pin / unpin / forget / rebuildIndex / stats.`
  > `MemoryRpcHandlers.METHODS` now registers 17 methods (`:117-135`). A newcomer relying on the file comment would misunderstand the class's full API surface (Finding 1).
- **Failure envelope for `memory:pin` / `memory:unpin`:** When an inactive or quarantined row is targeted, `setPinned` returns `false`, causing the handlers to return `{ success: false, pinned: false }` (`:278`, `:297`). While this follows existing missing-id and catch semantics (`:277`, `:287`), a reader might briefly confuse `pinned: false` with an assertion that the database record is unpinned, rather than representing an operation-level failure envelope.

### 3. What does this cost to maintain?

- **Local SQLite test harness in `memory-rpc.handlers.spec.ts`:** Lines `:1751-1822` define `openRawTestDb()` and a `transaction()` wrapper around `:memory:` SQLite databases. Because `@ptah-extension/persistence-sqlite` does not export test-support helpers from its public barrel (`libs/backend/persistence-sqlite/src/index.ts:1`), importing them directly would violate Nx module boundary linting (`enforce-module-boundaries`). The local harness is a necessary boundary-safe solution, but if low-level migration mechanics change, this harness must be kept aligned with sibling test fixtures.
- **Handler complexity:** The class remains cohesive as an RPC gateway. All business logic and storage manipulation remain delegated to `MemoryStore` and `MemoryCuratorService`.

### 4. Where is this inconsistent with the rest of the repository?

- **Logging key naming:** Parse errors log with `{ err: String(err) }` (`:771`, `:830`), while unhandled store errors log with `{ error: message }` (`:804`, `:861`). This mirrors the pre-existing logging in adjacent methods within the file (e.g. `:535` vs `:471`), but represents minor internal inconsistency.
- **Stale header comment:** Sibling handler files accurately describe their domain or do not hardcode a fragile count of registered methods.

### 5. What would you have done differently?

- Update the stale header comment at `memory-rpc.handlers.ts:4` from "8 memory:* methods" to a general description without a fragile numeric count.
- In `memory-rpc.schema.ts`, export `RESTORE_QUARANTINED_MAX_IDS` for clarity and test reusability, though keeping it module-private is acceptable encapsulation.
- All other structural patterns — including the Zod refinements for mutual exclusion of restore selectors, strict `workspaceRoot` typing with explicit `null` support, and isolation testing on real SQLite — represent best-in-class adherence to the monorepo's standards.

## Blocking issues

None found within the reviewed scope.

## Serious issues

None found within the reviewed scope.

## Minor issues

### 1. Stale method count in header comment

- **Severity:** Minor
- **File:** `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:4`
- **Problem:** The header docstring states:
  ```ts
  * Surfaces 8 `memory:*` methods backed by the `@ptah-extension/memory-curator`
  * library: list / search / get / pin / unpin / forget / rebuildIndex / stats.
  ```
  Following Batch 6, `MemoryRpcHandlers.METHODS` defines 17 methods.
- **Impact:** Misleads developers reading the file overview regarding the actual size and responsibilities of `MemoryRpcHandlers`.
- **Recommendation:** Update the docstring to omit the fixed count, e.g.: `Surfaces memory:* RPC methods backed by the @ptah-extension/memory-curator library.`

## File-by-file

### `libs/shared/src/lib/types/rpc/rpc-memory.types.ts`

Score 9/10 — 0 B, 0 S, 0 M. Clean type definitions adhering to naming conventions (`MemoryListQuarantinedParams`, `QuarantinedMemoryWire`, `MemoryListQuarantinedResult`, `MemoryRestoreQuarantinedParams`, `MemoryRestoreQuarantinedResult`). All fields are declared `readonly`, comments cite linked types, and the excerpt limit is explicitly documented.

### `libs/shared/src/lib/types/rpc.types.ts`

Score 9/10 — 0 B, 0 S, 0 M. Synchronized imports, `RpcMethodRegistry` entries, and `RPC_METHOD_ENTRIES` runtime mappings. Placed contiguously after `memory:getTriggers` and before `mem:searchIndex`, maintaining proper namespace grouping.

### `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.schema.ts`

Score 8/10 — 0 B, 0 S, 0 M. Defines `QuarantineReasonSchema`, `RESTORE_QUARANTINED_MAX_IDS` (500), `MemoryListQuarantinedParamsSchema`, and `MemoryRestoreQuarantinedParamsSchema`. Uses `z.union([z.string().min(1), z.null()])` for `workspaceRoot` in restore to forbid omitted/empty parameters, and `.refine()` to enforce that exactly one selector (`ids`, `reason`, `all`) is provided.

### `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.schema.spec.ts`

Score 9/10 — 0 B, 0 S, 0 M. Comprehensive spec coverage for valid inputs (named workspace, explicit null, rule reason, 500 ids boundary) and invalid inputs (omitted workspaceRoot, empty string, 0 selectors, 2 selectors, `all: false`, empty ids array, 501 ids, and invalid regex patterns).

### `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`

Score 8/10 — 0 B, 0 S, 1 M. Correctly registers `memory:listQuarantined` and `memory:restoreQuarantined`. Adapts `memory:get` to use `store.getActiveById(id)`, and handles `store.setPinned(id, boolean)` return status in `memory:pin` and `memory:unpin`. Implements workspace authorization and translates exceptions into `RpcUserError` with `PERSISTENCE_UNAVAILABLE`. Finding 1 notes the stale header comment.

### `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.spec.ts`

Score 8/10 — 0 B, 0 S, 0 M. Extends unit tests with `getActiveById`, `setPinned` matching behavior, and invalid param rejection. Implements a boundary-compliant SQLite test harness (`openRawTestDb` with `node:sqlite` fallback and migration runner) to assert cross-scope isolation (null vs named workspaces), list mapping, `memory:get` filtering, and pin behavior on real SQLite tables.

### `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`

Score 9/10 — 0 B, 0 S, 0 M. Adds `'memory:listQuarantined'` and `'memory:restoreQuarantined'` to `VSCODE_EXPECTED_ABSENT_METHODS` in strict alphabetical order, maintaining RPC surface partition tests green.

## Pattern compliance

| Repository rule or nearby convention                                    | Status         | Evidence                                                                         |
| ----------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| Wire types follow `*Wire` and `*Params`/`*Result` conventions           | PASS           | `libs/shared/src/lib/types/rpc/rpc-memory.types.ts:133-181`                      |
| RPC methods registered in `RpcMethodRegistry` & `RPC_METHOD_ENTRIES`    | PASS           | `libs/shared/src/lib/types/rpc.types.ts:1731`, `:3732`                           |
| Surface partition test updated in alphabetical order                    | PASS           | `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:96`, `:101`               |
| Zod validation at RPC boundaries (`INVALID_PARAMS` error code)          | PASS           | `memory-rpc.handlers.ts:770`, `:825`                                             |
| Authorization via `isAuthorizedWorkspace` with `UNAUTHORIZED_WORKSPACE` | PASS           | `memory-rpc.handlers.ts:842-848`                                                 |
| Error sanitization (`catch (err: unknown)` + `RpcUserError`)            | PASS           | `memory-rpc.handlers.ts:801-811`, `:858-868`                                     |
| No deep cross-lib imports into sibling internals                        | PASS           | `memory-rpc.handlers.spec.ts:24-31` imports only via `@ptah-extension/*` barrels |
| Parameterized SQL queries (no string interpolation)                     | PASS           | `memory-rpc.handlers.spec.ts:1840`, `:1852`, `:1859`                             |
| Strict OnPush / Standalone Angular conventions                          | NOT_APPLICABLE | Backend and shared RPC definitions only                                          |
| No secret leakage in error logs                                         | PASS           | `memory-rpc.handlers.ts:804`, `:861` logs only error message, no memory content  |

## Maintenance debt

- Introduced: A local `:memory:` SQLite harness and transaction shim in `memory-rpc.handlers.spec.ts:1751-1822`, which duplicates similar test harness patterns in `skills-synthesis-rpc.digest.spec.ts` to preserve Nx module boundaries.
- Retired: The silent false-success defect in `memory:pin`/`memory:unpin` on quarantined rows; stale assumption that `memory:get` can directly read quarantined memories.
- Net: Neutral to slightly positive. The architecture remains strongly decoupled and type-safe.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH — Full source inspection across all 7 files, verification of git diff, static type-checking, and execution of test suites (`memory-rpc` schema and handlers: 129/129 passed; `rpc-surface.spec.ts`: passed).
- Key concern: The stale method count in `memory-rpc.handlers.ts:4` should be corrected in a future cleanup pass to maintain documentation accuracy.
- What a 10/10 version would do differently: Update the stale header comment at `memory-rpc.handlers.ts:4`; export `RESTORE_QUARANTINED_MAX_IDS` from `memory-rpc.schema.ts`.
