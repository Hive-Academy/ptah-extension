# Frontend implementation — `TASK_2026_719`, phase P5, batch F1

**Tasks completed**: F1, the webview ambient status service (implementation-plan-p5.md §6).

## Files

- CREATED `libs/frontend/core/src/lib/services/claude-ambient-status.service.ts`.
  `ClaudeAmbientStatusService` is `providedIn: 'root'` and uses `inject()` for
  `ClaudeRpcService` and `VSCodeService.isElectron`. It exposes
  `view: Signal<ClaudeAmbientStatusView>` (`status: 'inert'|'idle'|'checking'|'ready'`,
  `result`, `localFailure`) and `read(refresh)`.
  - Reads are ordered by a monotonic `seq`, so only the latest reply is applied.
  - The RPC timeout is 30 s, which is above the host's 25 s deadline (P5-D16).
  - A transport failure, refusal, rejected promise or malformed reply sets
    `{ ready, result: null, localFailure: true }`. No webview `checkedAt` is created
    (P5-D15).
  - The host reply is checked at the boundary: `state` and `reason` must be known
    values, and `checkedAt` must be a string or null. The view keeps only the three
    contract fields.
  - The service is inert on non-Electron hosts. It disposes through `DestroyRef`, the
    same way `provider-accounts-state.service.ts` does.
  - It never throws, and it has no timers, polling or constructor I/O.
- CREATED `libs/frontend/core/src/lib/services/claude-ambient-status.service.spec.ts`
  (17 cases, listed below).
- MODIFIED `libs/frontend/core/src/lib/services/providers-settings-state.service.ts`.
  It re-exports `ClaudeAmbientStatusService` and `type ClaudeAmbientStatusView` next to
  `ProviderAccountsStateService`, as §6 asks. **No `index.ts` change is needed**:
  `libs/frontend/core/src/index.ts:7` already has
  `export * from './lib/services/providers-settings-state.service'`.

## Spec cases added (17 tests)

1. Inert on a non-Electron host: no RPC, inert view.
2. Starts `idle` and makes no call before `read()`.
3. Passes the refresh flag, provider `claude` and a 30 s timeout. This is an `it.each`
   over true and false, so it counts as 2 tests.
4. `checking` while the request is in flight, then `ready` with the host value.
5. A refresh after a ready result shows `checking` until it settles.
6. Out of order: an older reply that arrives after the newer one is ignored.
7. Out of order: an older reply that lands first leaves the view in `checking` while the
   latest request is still pending.
8. Transport failure after an earlier `connected` reply gives `result: null` and
   `localFailure: true`. The serialized view has no `checkedAt` and no `connected`.
9. A host refusal is treated as a local failure.
10. A rejected transport promise resolves without throwing and is a local failure.
11. A malformed host reply is a local failure. This is an `it.each` over unknown state,
    non-string `checkedAt`, unknown reason and missing status, so it counts as 4 tests.
12. Extra host fields are stripped; only `state`, `checkedAt` and `reason` are kept.
13. Recovery: a later host reply clears `localFailure`.
14. A reply after the injector is destroyed is ignored, and later reads make no call.

## Verification

- Focused jest run under the machine lock:
  `node scripts/verify.mjs --exec --task f1-jest -- npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/claude-ambient-status.service.spec.ts libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts`
  Result: **Test Suites 2 passed / 2; Tests 118 passed / 118**, exit code 0. Jest also
  printed a harmless ESM warning about loading `jest.config.ts`.
- `ptah_get_diagnostics` on the 3 files: **no diagnostics in the requested files**.
  - It did list errors in sibling spec files I did not touch:
    `auth-state.service.spec.ts`, `autopilot-state.service.spec.ts`,
    `effort-state.service.spec.ts` and `electron-layout.service.spec.ts`. They are
    RpcResult/never typing errors from the tool's compiler view.
  - I did not check whether they also appear in Nx `typecheck`. The batch verify will
    show that.
- Not run, as the brief requires: `npm run verify` (the batch command is
  `-t lint,test,typecheck -p @ptah-extension/core,@ptah-extension/chat,ptah-extension-webview,ptah-electron,ptah-extension-vscode`,
  N = 5), lint, builds.

## Plan deviations

- §6 does not mention boundary validation or field stripping. I added both because of the
  boundary rule and the "result carries only the three fields" security note in §5. A
  malformed reply is handled like a transport failure (local failure, no `checkedAt`).
- §6 does not mention a rejected `rpc.call` promise. I catch it so that "never throws"
  holds; the catch block has a comment explaining why.
- The brief asks for fake timers for timer logic, but this service has no timers. The
  only timeout belongs to `ClaudeRpcService`, and the spec checks that the 30 s option is
  passed. The 30 s "Last checked" timer (P5-D9) belongs to the ambient row in F2.
- A transport failure keeps no earlier result. This follows §6 and Revision 1, finding 4.

## Decisions

- **Provider argument.** `read(refresh)` always sends `provider: 'claude'` and takes no
  provider parameter.
  - Options: a provider parameter, or a fixed `'claude'`.
  - Evidence: the §6 signature `read(refresh: boolean)`, and the service name scopes it
    to Claude.
  - Reversible: yes.
- **State during a refresh.** While a refresh is checking, the earlier `result` stays in
  the signal and only `status` changes to `checking`.
  - Options: clear `result`, or keep it with `status: 'checking'`.
  - Evidence: §6 makes consumers responsible for not showing Connected, a count or an
    age while checking, and §7 `connectedAccountCount` and `ambientRowModel` gate on
    `status`.
  - Reversible: yes.

## Open points

- F2 and F5 must gate on `status === 'ready'` and `localFailure === false` before they
  show Connected, a count or an age. During `checking`, the stale `result` is still in
  the view.
- Nothing calls `read()` yet. The page-show read with `refresh: false` (P5-D10) and the
  drawer refresh are wired in later batches.
