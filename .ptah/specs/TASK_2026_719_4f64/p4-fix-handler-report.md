# P4 fix — finding 1 (refused sign-out destroyed the live sign-in handle)

**Verdict**: FIXED. All checks pass: tsc lib and spec, eslint (0 problems), jest 62/62.

## Change

File: `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts`, `signOut()`.

- `:505-513`: the sign-out operation is no longer written to the shared `operations` map. The
  `try/finally` that set the entry and then settled it is removed. The operation ID still goes
  to the actions port and back to the caller in the success reply. Sign-out settles before the
  port returns, so no other request can observe it as in flight. A refusal (`conflict`, `busy`,
  or any non-`ok` code) now leaves an existing sign-in handle as it was.
- `:517-518`: once the port accepts the sign-out, `this.operations.delete(params.profileId)`
  removes any operation the profile still has. This keeps the old success behavior: after an
  accepted sign-out, `getAccountStatus` returns no operation.
- Unchanged: the refusal mapping (`actionRefused`), the committed revision bump, the snapshot
  and push, the reply shape `{ ok, snapshot, operation: { kind: 'sign-out' } }`, and request
  ledger replay. The fallback is never logged; this path does not touch it.

## Tests added

File: `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.spec.ts`

- `:1136` `it.each(['conflict','busy'])` 'a sign-out refused with %s keeps the live sign-in
  handle'. The test starts a sign-in, which goes pending with an operation ID and a posix
  fallback. A competing sign-out (`REQ(2)`) is refused by the fake. `getAccountStatus` must
  then still return the original `{ operationId, kind: 'sign-in' }`. Replaying the sign-in
  request returns the original reply, fallback included. The port command log must read
  `startSignIn, signOut, readStatus`, so the replay made no second start.
- `:1186` 'an accepted sign-out clears the profile operation'. After a pending sign-in, an
  accepted sign-out leaves `getAccountStatus` returning `{ ok: true, account }` with no
  operation.

Under the old code the refused-sign-out cases fail: `set` replaced the sign-in entry and the
`finally` deleted it, so status came back without an operation.

## Checks

- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.lib.json`: exit 0, no output.
- `npx tsc --noEmit -p libs/backend/rpc-handlers/tsconfig.spec.json`: no output.
- `npx eslint <2 files>`: 0 problems. The first run reported one unused-variable warning in the
  new test; it was fixed and the second run was clean.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts .../provider-account-rpc.handlers.spec.ts --maxWorkers=2`:
  1 suite passed, 62 tests passed.
- Not run, as the brief instructed: `npm run verify`, build, and git.

## Decisions

- Chose the brief's preferred option: the sign-out operation is never installed, instead of an
  ownership check. Evidence: sign-out settles before the port returns (the original code
  comment), and `getAccountStatus` reads `operations` only to show a cancellable sign-in.
  Reversible.
- An accepted sign-out clears the profile's entry, to keep the old success behavior. Before
  this fix, a successful sign-out also removed whatever entry the profile had. Reversible.
