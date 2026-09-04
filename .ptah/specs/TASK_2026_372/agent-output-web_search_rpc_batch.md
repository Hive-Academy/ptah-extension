# Web-search RPC batch

## Summary

- Added the non-empty `WebSearchProvidersSchema` while preserving the existing provider enum, allowlist, and secret-key prefix.
- Migrated RPC config reads/writes to ordered provider arrays, including legacy single-key fallback, invalid-entry filtering/warnings, and legacy-key clearing on writes.
- Changed `webSearch:test` to test every configured provider concurrently with `Promise.allSettled`, isolated per-provider results, independent 10-second timeouts, and timer cleanup in `finally`. Aggregate success now means at least one provider passed.
- Updated colocated specs for array validation, legacy fallback, filtering, legacy clearing, and partial provider success. The three per-provider API-key handlers remain unchanged.

## Files

- MODIFIED `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/web-search-rpc.handlers.ts`
- MODIFIED `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/web-search-rpc.handlers.spec.ts`
- MODIFIED `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/web-search-rpc.schema.ts`
- MODIFIED `D:/projects/ptah-extension/libs/backend/rpc-handlers/src/lib/handlers/web-search-rpc.schema.spec.ts`

## Stack observed

TypeScript 5.9 in an Nx 22.6 library, with tsyringe constructor injection, platform-core workspace/secret ports, Zod 4 RPC-boundary validation, and Jest tests (`package.json`, `libs/backend/rpc-handlers/project.json`, and the existing handler/schema files).

## Verification

- `npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers` — PASS; one project checked successfully.
- `npx nx run-many -t test -p @ptah-extension/rpc-handlers` — PASS; 91/91 suites passed, 2,637 tests passed, 31 skipped.
- `npx nx run-many -t lint -p @ptah-extension/rpc-handlers` — PASS; 0 errors and 19 existing warnings in unrelated files.
- Ptah scoped TypeScript diagnostics — PASS; 0 errors and 0 warnings after implementation.
- `git diff --check` on the four owned source/spec files — PASS.

## Plan deviations

None.

## Out-of-scope observations

The shared worktree contains unrelated concurrent changes; none were edited or reverted by this batch.
