# Phase B fix C report

## Changed files

- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:195`: `SaveCloneBodyResult` now carries `currentContentHash`; no-write paths return null, and both post-write helpers return the mirror-computed hash when hashing succeeds, including when later sidecar bookkeeping fails.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1499`: enhancement saves pass the returned hash to `markEnhanced`; a null hash skips the stamp, warns, and marks enhancement metadata incomplete. Repropagation remains after this branch.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts:1499`: enhancement save asserts the mirror's exact hash reaches the registry; null hash asserts no stamp, incomplete metadata, and continued repropagation. Updated all local save result fakes.
- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.spec.ts:708`: asserts returned hashes for skill and flat-file saves, including sidecar-less and corrupt-sidecar cases; asserts null on stale and absent clones.
- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-save-reconcile.spec.ts:357`: updates the no-write result expectation with null hash.

## Removed code

- Removed `hashCommittedClone` and its `createHash`, `relative`, and `ORIGIN_SIDECAR_FILENAME` imports from the RPC handler.
- Removed the enhancement branch's `getUserLayerRoots` and `bodyPath` computation that served only the duplicate hash.

## Specs

- Updated the two affected service specs and the RPC handler spec. All five edited TypeScript files returned AST parse status `ok` with zero error nodes.
- Test, build, lint, typecheck, and diagnostics commands were not run, per fix-round instructions; the orchestrator owns verification.
- Confirmed all edited files have LF line endings.

## Projects touched

- `agent-generation`
- `rpc-handlers`

## Decisions

- Preserve a successfully computed hash if a later sidecar read or write fails. The result describes the post-write re-hash separately from sidecar bookkeeping, and the handler can use that hash without recomputing it. Reversible.
- Keep the RPC null-hash guard even though the mirror currently pairs a re-hash failure with `metadataIncomplete: true`; the guard explicitly prevents registry stamping and qualifies the response. Reversible.