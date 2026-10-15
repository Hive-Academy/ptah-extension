# Batch 22 report

## Changes

- `libs/shared/src/lib/types/rpc/rpc-setup.types.ts:34,38`: corrected resume and phase-status documentation to version 4. At `:49,61`, documented `AnalysisStatus` and that `analysisDir` is workspace-relative with `/` separators.
- `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:407-408`: placed `wizard:analysis-status` before `wizard:cancel` in code-unit order.
- `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.ts:20,27`: corrected resume documentation to version 4 and documented the no-parameters status schema.

## Verification

- `npx prettier --check libs/shared/src/lib/types/rpc/rpc-setup.types.ts libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.schema.ts` — PASS: `All matched files use Prettier code style!` (exit 0).
- `npx nx run-many -t typecheck,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1` — PASS: `Successfully ran targets typecheck, lint for 2 projects` (exit 0).
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 --maxWorkers=2` — PASS: header `Running target test for 2 projects`; `Successfully ran target test for 2 projects` (exit 0).

## Decisions

- Kept the `legacy-v3` reason unchanged because it denotes a genuine legacy manifest. No type shape or behavior changed.
- Used the baseline's existing code-unit order and edited the single misplaced entry directly.

## Not done

- No behavior changes or tests were added for this documentation and ordering batch. The separate Ptah diagnostics request timed out while its TypeScript check was still running; scoped Nx typecheck and lint subsequently passed. Nx Cloud reported a disabled organization, but both Nx verification commands exited 0 locally.
