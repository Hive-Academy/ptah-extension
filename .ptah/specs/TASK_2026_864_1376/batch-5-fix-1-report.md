# Batch 5 fix round 1

- `libs/backend/auth-providers/src/lib/providers/codex/codex-login.service.spec.ts:35`: `openExternal = jest.fn(async () => true);` -> `openExternal = jest.fn<Promise<boolean>, [string]>(async () => true);`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-login.service.spec.ts:36`: `killTree = jest.fn(async () => undefined);` -> `killTree = jest.fn<Promise<void>, [number]>(async () => undefined);`

Checked the remaining mocks: `choose` has a zero-argument mock type and matches its initializer; the mocks inside the dependency object are not assigned to typed `jest.Mock` variables with parameters. Test behavior and assertions are unchanged.

Could not verify compilation: scoped `ptah_get_diagnostics` reported the TypeScript worker unavailable because another run had timed out. Per the task sandbox instructions, I did not run Jest, Nx, TypeScript, npm verification, or git.
