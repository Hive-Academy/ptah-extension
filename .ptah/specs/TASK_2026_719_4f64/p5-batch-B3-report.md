# Backend implementation - `TASK_2026_719`, P5 batch B3 (RPC wiring)

**Tasks completed**: implementation-plan-p5.md B3 (WP-a, then WP-b) and §5 (RPC `provider:getAmbientClaudeStatus`).

## Files (8: the 7 from the D8 exception, plus 1 the coordinator authorized)

WP-a (shared):

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/shared/src/lib/types/rpc/rpc-provider-accounts.types.ts`
  - `'provider:getAmbientClaudeStatus'` is now the last entry of `PROVIDER_ACCOUNT_RPC_METHOD_NAMES`.
  - New `ProviderGetAmbientClaudeStatusParams { provider; refresh?: boolean }`. It takes no workspace root.
  - New `ProviderGetAmbientClaudeStatusResult = ProviderAccountRpcResult<{ readonly status: ProviderAmbientClaudeStatus }>`.
  - New registry-slice entry for the method. `ProviderAccountRpcRegistryInSync` still holds.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/shared/src/lib/types/rpc.types.ts`
  - Adds `'provider:getAmbientClaudeStatus': true` to `RPC_METHOD_ENTRIES`, after `provider:setAccountDefault`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts`
  - Adds a sample params entry for the method.
  - Adds `refresh` to the public param keys.
  - Adds the method to the reads set (no `requestId`).
  - Updates the expected tuple.

WP-b:

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts`
  - New `ProviderGetAmbientClaudeStatusSchema = z.object({ provider: ProviderSchema, refresh: z.boolean().optional() }).strict()`.
  - Adds the schema to the `PROVIDER_ACCOUNT_RPC_SCHEMAS` map. The mapped type checks it against the shared params.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts`
  - New exported type `ProviderAccountAmbientStatusReader = Pick<ClaudeAmbientLoginStatusReader, 'read'>`.
  - New constructor parameter: `@inject(ClaudeAmbientLoginStatusReader) ambient`. It is injected by class, the same way as `ProviderAccountService`, and B2 already registers it.
  - New handler: `this.on('provider:getAmbientClaudeStatus', ...)` calls `getAmbientClaudeStatus`.
    - Another provider is refused with `refusal('wrong-provider')`.
    - Otherwise the handler calls `ambient.read({ refresh: params.refresh === true })`.
    - The status is copied field by field: `state` and `checkedAt`, plus `reason` only when the state is `unknown`. Nothing else in the reader's object can reach the caller.
    - There is no workspace check, no ledger entry and no broadcast.
    - A throw, which should not happen because the reader never throws, goes through the existing `refusalFrom`. That logs the code only and returns fixed or verified-safe copy.
  - `METHODS` still points at the tuple, so it now has 11 entries.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts`
  - The jest mock of `@ptah-extension/auth-providers` now also provides `ClaudeAmbientLoginStatusReader`.
  - New `FakeAmbientReader`, registered in `setup` by the class token.
  - The registration test title now says eleven methods.
  - New describe block `ambient Claude login status (P5)`:
    - `refresh: true` is forwarded.
    - An omitted or `false` refresh reads with `refresh: false`.
    - Strict params reject an env bag, a workspace root, a config dir, a non-boolean refresh, an unknown provider and missing params, all with `RpcUserError INVALID_PARAMS` and no read.
    - `codex` is refused with `wrong-provider` and no read.
    - A reader object with extra email, path and stdout fields comes back as exactly `checkedAt`, `reason` and `state`, with no broadcast.
    - A `reason` on a state other than `unknown` is dropped.
    - A reader throw becomes a refusal with no secret text in the result or the logs.
  - New A3 case: a duplicate-name store refusal on add and on rename (to the reserved label) shows `PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY`, with no broadcast.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/apps/ptah-electron/src/di/container.smoke.spec.ts`
  - Imports `ClaudeAmbientLoginStatusReader` from `@ptah-extension/auth-providers`.
  - Registers a `read` stub for it in the provider-accounts case.
  - The title now says eleven methods, with new assertions for the new method name and `toHaveLength(11)`.
- MODIFIED (8th file, authorized by the coordinator) `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`
  - Line 158: title `ten` changed to `eleven`. Line 159: `toHaveLength(10)` changed to `toHaveLength(11)`. Nothing else.

## Stack observed

- Wiring: tsyringe, with `@inject` by class token for the auth-providers classes (`provider-account-rpc.handlers.ts`, the constructor's `ProviderAccountService` parameter). B2 registers the reader by class with `instanceCachingFactory` in `libs/backend/auth-providers/src/lib/di/register.ts`.
- Validation: strict zod schemas in `provider-account-rpc.schema.ts`. `parse()` throws `RpcUserError('INVALID_PARAMS')` before the handler runs.
- `ALLOWED_METHOD_PREFIXES` already covers `provider:`. Source: the comment at `rpc.types.ts:3193-3195`, and `rpc-allowlist.spec.ts` passes.

## Verification

All runs used `node scripts/verify.mjs --exec --task b3-jest -- npx jest -c <config> <specs>`:

- shared `rpc-provider-accounts.spec.ts`: 14 passed.
- rpc-handlers `provider-account-rpc.handlers.spec.ts`, `rpc-allowlist.spec.ts` and `manifest.spec.ts`:
  - First run: 7 failed. Six were my own assertion shape (`code` where the repository uses `errorCode`); I fixed them. The seventh was the `rpc-allowlist` count.
  - Rerun after the fix and the authorized edit: **98 passed, 98 total**.
- ptah-electron `container.smoke.spec.ts`: 38 passed.
- cli-engine `rpc-surface.spec.ts`: 14 passed. It still lists the method as absent, as B1 left it.
- ptah-extension-vscode `rpc-surface.spec.ts`: 4 passed. It still lists the method as absent, as B1 left it.
- `ptah_get_diagnostics` on the handler, schema, spec, shared types, shared spec and Electron smoke spec: 0 errors in those files. Its sibling-file errors come from an unrelated tsconfig context (missing `Thenable` and jest globals in agent-generation and memory-curator) and none are in B3 files.
- Not run, per the brief: `npm run verify`, lint, nx typecheck and builds. The team-leader runs the batch verify (N = 10 in the plan).

## Plan deviations

- Plan §5 said `rpc-allowlist.spec.ts` needed no change because it "reads the tuple". It also pins the count at 10, so it failed. I reported it to the coordinator and edited it only after authorization: two literals, as above.
- Besides the method's own cases, the handler spec also checks that `reason` is dropped when the state is not `unknown`, and that a reader throw is redacted.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Copy the status field by field in the handler instead of passing the reader's object through | pass-through; explicit projection | §5 Security: "result carries only the three fields". B2's reader already freezes a three-field object, so the copy is a boundary guard at no cost. | yes |
| Send a reader throw through the existing `refusalFrom` | let it propagate as an RPC error; `refusalFrom` | Same pattern as `getAccountStatus`. It logs the code only, and the degradation audit accepts a coded refusal. The reader is not expected to throw (B2). | yes |
| Inject by class with a narrow `Pick` type | a new token; by class | §5 names `@inject(ClaudeAmbientLoginStatusReader)`. It matches the `ProviderAccountService` precedent and lets a fake stand in for tests. | yes |

## Open points

- With a plain `Error`, the reader-throw refusal reuses `refusalFrom`'s `unavailable-storage` copy ("Account storage is unavailable."). That wording is odd for an ambient check, but it is unreachable in practice. F1 shows any refusal as "Could not check" (`localFailure`).
- The VS Code and CLI rpc-surface specs still list the method as absent, which is correct because it is Electron-only through `providerAccounts`. No change is needed.
