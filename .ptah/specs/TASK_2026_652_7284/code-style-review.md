# Code Style Review - TASK_2026_652_7284, Phase 1 (Batches 1-5)

- Score: 7/10
- Verdict: APPROVED WITH FIXES
- Review family: claude subagent (implementer: codex)
- Scope: `git diff 58d543298^..48fbb5673 -- libs/` (20 files with changes in the diffstat, plus the new proposal-store service and spec files). Whole files read: the port, the proposal store, the merge utility, the proposal types and schema, the `di.ts` wiring, and the `registerGetProposal` / `registerStartNewProject` handler hunks.
- Counts: Blocking 0, Serious 1, Moderate 3, Minor 4.

## Summary

Boundaries and wiring are sound.
- `rpc-handlers` already imports `PLATFORM_TOKENS` (`harness-rpc.handlers.ts:40`), so no new vscode-core import appears.
- The new RPC is registered in all three places the neighbouring methods use: the method list (`:187`), the registry and `RPC_METHOD_ENTRIES` (`rpc.types.ts:1802,3988`), and the baseline (`host-source-registry.baseline.ts:180`).
- The port is exported with `export type` and uses a `Symbol.for` token. `import type` is used throughout, and I found no new `any` or `@ts-ignore`.

The one real structural problem is that the store re-implements a file lock and a per-key queue that `harness-sync` already exports and that `rpc-handlers` already depends on. The remaining findings are contract documentation and type-precision gaps.

## Findings

### 1. Serious - hand-rolled lock and queue duplicate an existing, exported, tested primitive

- File: `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts:48` (static `queues` map), `:66-90` (queue chaining), `:150-180` (`acquireLock`), constants `:18-21`.
- Evidence: `libs/backend/harness-sync/src/lib/lock/file-lock.ts` exports `serializeByKey` (`:135`), `acquireFileLock` (`:234`) and `withFileLock` (`:298`). `withFileLock` throws `FileLockTimeoutError` on timeout, which is exactly the "lock failure rejects" requirement in batches.md Task 4.1. All of them are re-exported from `harness-sync/src/index.ts:114-122`, and `rpc-handlers` already imports that barrel (`harness-rpc.handlers.ts:38`, `mcp-directory-rpc.handlers.ts:56`).
- Impact: this is duplication with drift. The copy has its own stale threshold (5 s here, 30 s in `STALE_AFTER_MS`), its own wait deadline (1 s here, 5 s in `DEFAULT_MAX_WAIT_MS`), and its own error class. Lock fixes, such as the Windows and stale-lock handling documented in `file-lock.ts`, will not reach this copy. About 70 lines of the 223-line file are lock and queue mechanics, which dilutes the store's actual responsibility (proposal persistence).
- Fix: replace `queues` + `acquireLock` with `serializeByKey(file, ...)` wrapping `withFileLock(`${file}.lock`, ...)`. Drop `HarnessProposalLockError` in favour of `FileLockTimeoutError`. If the team decides not to reuse them (for example, to avoid a `harness-sync` dependency on this path), put a comment at `:48` saying why.

### 2. Moderate - typed errors are stranded outside the port contract

- File: `harness-proposal-store.service.ts:23-39`; `config/index.ts:3`; `libs/backend/platform-core/src/interfaces/harness-proposal-store.interface.ts:3-12`.
- Evidence: `HarnessProposalWorkspaceError` and `HarnessProposalLockError` are exported only from the service file. `config/index.ts` re-exports `HarnessProposalStore` alone. The port declares neither the errors nor the fact that `save` and `get` reject when no workspace is open.
- Impact: the port exists so that consumers outside `rpc-handlers` (the planned `vscode-lm-tools` caller) can use the store. Those consumers cannot import the errors and cannot learn the failure contract from the port. They can only string-match on `code`.
- Fix: document the rejection cases and their `code` strings on the port. Alternatively, move the error classes next to the port in platform-core. Re-export them from `config/index.ts` if they stay in `rpc-handlers`.

### 3. Moderate - port and token documentation is thinner than its siblings

- File: `harness-proposal-store.interface.ts:3-12`; `libs/backend/platform-core/src/di/tokens.ts:78`.
- Evidence: neighbouring ports state who the adapter is, when it is registered, and how consumers must inject it. See `session-organization-recorder.interface.ts:1-17` and the `SESSION_ORGANIZATION_RECORDER` token comment at `tokens.ts:63-70`. The new token comment is one line, with no adapter, no registration site, and no note on whether it is optional. The `save` doc does not say that it merges rather than replaces, what `complete` means, or that `sessionId` must be the SDK id (this is in the shared type only).
- Fix: add a header to the port: adapter is `HarnessProposalStore` in `@ptah-extension/rpc-handlers`, bound by `registerHarnessServices`, merge semantics, `complete` meaning, rejection cases. Extend the token JSDoc to match the neighbouring tokens.

### 4. Moderate - `HarnessProposalSchema.configUpdates` uses `z.custom` and keeps raw input

- File: `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:468-470`.
- Evidence: `z.custom<Partial<HarnessConfig>>(v => HarnessConfigUpdatesSchema.safeParse(v).success)` validates but discards the parsed (normalised) output. The annotation `z.ZodType<HarnessProposal>` then asserts the type rather than deriving it. The batches.md verification note already records this. From a style angle, it is the only place in the file where a boundary schema is bridged by assertion instead of by shape.
- Impact: type safety at the storage boundary rests on a comment, and the schema accepts un-normalised stored data.
- Fix: keep the bridge, but add a spec-pinned round-trip of a normalised record (batches.md Task 4.2). Add a one-line comment saying stored data must already be normalised. Longer term, align `HarnessConfigUpdatesSchema`'s output type with `Partial<HarnessConfig>` so that `z.custom` can go.

### 5. Moderate - merge utility widens types with `as` casts

- File: `libs/shared/src/lib/utils/merge-harness-config-updates.ts:14,48,63`.
- Evidence: `{ ...base.persona, ...update.persona } as HarnessConfig['persona']` (and the same for `prompt` and `claudeMd`) casts a spread of two optional partials to the full required section type. If both are partial, the result can lack required keys. This mirrors the frontend implementation (`harness-builder-state.service.ts:~335`), so it is consistent with existing practice, but it is a new copy of the cast.
- Fix: scheduled Task 8.1 deletes the frontend copy. Until then, type `merged` as `Partial<HarnessConfig>` and cast once per section with a short comment saying that partial sections are intentional in a proposal. Make sure Task 8.1 actually lands, because the duplication is only transient if it does.

### 6. Minor - `HarnessGetProposalParamsSchema` is not tied to its interface, and `sessionId` constraints are duplicated

- File: `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts:195-197` vs `rpc-harness.schemas.ts:466`; `rpc-harness-proposal.types.ts:12-14`.
- Evidence: `z.string().trim().min(1).max(256)` is written twice. The RPC param schema carries no `satisfies z.ZodType<HarnessGetProposalParams>` check, and no JSDoc (the sibling at `:186-193` has one).
- Fix: export one `HarnessSessionIdSchema` from `rpc-harness.schemas.ts` and use it in both places. Add `satisfies z.ZodType<HarnessGetProposalParams>`.

### 7. Minor - DI header not updated for the cross-token registration

- File: `libs/backend/rpc-handlers/src/lib/harness/di.ts:1-18` and `:60-63`.
- Evidence: the header says services are "bound to the tokens in `./tokens.ts`". The new binding uses `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE`, and the dependency DAG note omits it. The choice of a platform token is correct, because other libs must resolve it without importing `rpc-handlers`. The file just does not say so.
- Fix: add one comment line at `:60` explaining the platform-token binding. Add `workspace provider -> proposal-store` to the DAG comment.

### 8. Minor - stale doc comment on the changed contract

- File: `libs/shared/src/lib/types/rpc/rpc-harness.types.ts:509` (the "hand the New Project flow off to the chat surface" comment above `HarnessStartNewProjectParams`) and the line above the union; `libs/frontend/harness-builder/src/lib/services/harness-rpc.service.ts:285`.
- Evidence: the broadcast of `HARNESS_OPEN_WORKFLOW` was removed from the handler, and the result is now a seed payload. The union (`rpc-harness.types.ts:513-525`) has no JSDoc. The frontend comment still says the RPC "broadcasts HARNESS_OPEN_WORKFLOW" (Batch 6 owns that file).
- Fix: add a JSDoc to the union (the success arm is the hand-off payload and the client opens the workflow). Update the frontend comment in Batch 6.

### 9. Minor - static queue state on an injectable singleton

- File: `harness-proposal-store.service.ts:48`.
- Evidence: `private static readonly queues` is process-global state on a class registered with `registerSingleton`. It is only needed because the spec constructs several instances. It goes away if finding 1 is taken up (`serializeByKey` owns the map).

## Boundary and conventions check

| Rule or convention | Status | Evidence |
| --- | --- | --- |
| Port is `I`-prefixed and exported with `export type` | PASS | `platform-core/src/index.ts:125` |
| `Symbol.for` token in the token object | PASS | `tokens.ts:79` |
| New port belongs in platform-core given a single implementation | PASS, with a note | The consumer is `vscode-lm-tools`, which cannot depend on `rpc-handlers` (implementation-plan.md:24). Precedent: `SESSION_ORGANIZATION_RECORDER`, whose adapter sits in another lib. No consumer outside `rpc-handlers` exists in Phase 1, so the justification rests on Batch 9. Keep the port; tie it to that batch in the token JSDoc (finding 3). |
| No new vscode-core import for runtime-agnostic code | PASS | The store imports `Logger`/`TOKENS` as `HarnessConfigStore` does (`harness-config-store.service.ts:21`). The port imports `shared` only. |
| Barrel-only cross-lib imports; `import type` for types | PASS | `harness-proposal-store.service.ts:5-16` uses `@ptah-extension/shared/schemas`, matching `harness-config-store.service.ts:22` |
| DI registration style | PASS | `di.ts:60-63` uses `registerSingleton`, as its neighbours do |
| RPC registration triple (list, registry, baseline) | PASS | `harness-rpc.handlers.ts:187,353`; `rpc.types.ts:1802,3988`; `host-source-registry.baseline.ts:180` |
| Zod at the boundary, params parsed in the handler | PASS | `harness-rpc.handlers.ts:912`, same style as `:927,945` |
| Handler resolves services via `resolveService` | PASS | `harness-rpc.handlers.ts:913`, same helper as `:870` |
| Logger rather than console | PASS | `harness-proposal-store.service.ts:219` |
| File naming (kebab-case, role suffix) | PASS | `harness-proposal-store.service.ts`, `harness-proposal-store.interface.ts`, `rpc-harness-proposal.types.ts`. The `utils/` directory is mixed (`result`, `pick-primary-model.ts` vs `*.utils.ts`), so the unsuffixed util name is acceptable. |
| Public API surface | PASS | The shared barrel adds one `export *` line and one named util export. `HarnessProposalSchema` is available through the `schemas` entry point only. No leaked internals; the store class is exported from the rpc-handlers config barrel as `HarnessConfigStore` is. |
| Reuse of existing shared primitives | FAIL | Finding 1 |
| Spec structure vs neighbouring specs | PASS | `harness-proposal-store.service.spec.ts` sits beside its subject, with temp-dir fixtures, `createMockLogger` and `reflect-metadata`, like the sibling store specs. The handler spec adds a `describe('harness:get-proposal')` block in the existing file rather than a new file. |
| `HarnessStartNewProjectResult` union is a discriminated union with `success` | PASS | `rpc-harness.types.ts:513-525` |

## Answers to the five style questions

1. Six months out: the store's lock constants and stale policy will diverge from `harness-sync`'s (finding 1). Consumers in other libs will string-match on `code` because the errors are not on the port (finding 2).
2. A new team member would misread `configUpdates` as validated-and-normalised on read when it is validated-only (finding 4). They may also wonder why a store implemented in `rpc-handlers` carries a platform token (findings 3 and 7).
3. Cost: roughly 70 lines of lock and queue code, plus a third lock variant to reason about (finding 1). The repo already carries one in `harness-sync`.
4. Inconsistency: the lock mechanism (finding 1) and the thinner port and token docs (finding 3).
5. I would use `serializeByKey` + `withFileLock` and reduce the store to read, merge, write, prune. I would also give the port a full contract header and keep one shared `sessionId` schema.

## What a 10/10 version would do differently

- Reuse `withFileLock` and `serializeByKey`, which shrinks the store to about 120 lines.
- Document the port contract and the throws, and surface the error types with the port.
- Share a single `sessionId` schema and `satisfies` the param schema against its interface.
- Drop the section-level `as` casts, or confine them to one commented helper.
- Document the union result and the platform-token DI binding.

## Verdict

Approve once finding 1 is reused or explicitly justified in a code comment, and findings 2 and 3 are documented. Findings 4 to 9 can ride along in the same fix commit or in the next batch that touches the file.
