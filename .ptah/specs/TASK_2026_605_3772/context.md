# TASK_2026_605 — type-check the chat, core and ui spec files

## Why

Recorded in TASK_2026_555 (Task 37.4, follow-up 5 in `TASK_2026_555/batches.md`). The `typecheck` target of
`@ptah-extension/chat`, `@ptah-extension/core` and `@ptah-extension/ui` uses the lib tsconfig, so the `*.spec.ts`
files under `tsconfig.spec.json` are not type-checked. Jest (ts-jest / jest-preset-angular) may run with isolated
modules or diagnostics off, so a spec can drift from the types it tests and still pass, or fail only at runtime.

## Scope

1. Confirm the gap: introduce a deliberate type error in a spec and show that no current target fails.
2. Add a `typecheck-spec` target (or extend `typecheck`) that runs `tsc -p tsconfig.spec.json --noEmit` for these
   libs, using the same Nx inference/plugin style as the existing typecheck targets.
3. Fix the type errors it finds (spec files only, unless a product type is wrong).
4. Gate it in CI (`main` job) and in the local verify command the agents use.
5. Consider the other frontend libs; list the ones with the same gap.

## Acceptance criteria

1. A spec type error fails the new target and the CI job.
2. The target is green on main for chat, core and ui.
3. CI time increase is stated in the PR.

## Out of scope

Changing test runners.
