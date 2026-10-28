# PR fix 5 — missing `resolveStoredModel` in the router accounts spec

## Change

- MODIFIED `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.accounts.spec.ts`
  lines 172-173: the fake `WorkspaceProviderProfileResolver` (constructor arg 7) now has
  `resolveStoredModel: (_path: string, model: string) => model || 'default'`.
  No production code changed.

Why this shape: the router (`chat-slash-command-router.service.ts:279-284`) uses
`params.model || resolveStoredModel(workspacePath ?? '', selectedModel)` and passes the
result to `resolveProviderProfileForWorkspace`, which this spec already stubs. The accounts
tests assert nothing about the model. The fake is a copy of the sibling spec
`chat-slash-command-router.idle-coalesce.spec.ts:81` that main added.

Other task specs: `chat-session.account-binding.spec.ts:136` already fakes
`resolveStoredModel`. No other spec under `chat/session` was missing it, and the full folder
passes.

## Checks

- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/chat/session --maxWorkers=2`:
  Test Suites 24 passed of 24; Tests 340 passed of 340. This includes the 3 tests that
  failed before.
- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.spec.json`: no output (clean).
- `npx eslint libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.accounts.spec.ts`:
  exit 0, no findings.

## Decisions

- The fake passes the model through with a `'default'` fallback, matching the sibling spec
  instead of a `jest.fn`, because no test inspects its calls. Options: a bare pass-through or a
  `jest.fn` mock. Evidence: idle-coalesce spec line 81. Reversible.
- No new `as unknown as` cast was added. The object literal goes into the file's existing
  `as unknown as Args[7]` cast, which was already there and is unchanged.
