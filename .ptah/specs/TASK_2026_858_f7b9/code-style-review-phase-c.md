# Code Style Review, Phase C (Batches 8-13) — TASK_2026_858_f7b9

Review family: claude (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REVISE |
| Blocking | 0 |
| Serious | 4 |
| Minor | 4 |
| Scope | `git diff 17ade5466..446c5f38b -- . ':!.ptah'`, 63 files; boundaries, wiring, formatting and test seams checked. Sibling comparison: other `PLATFORM_TOKENS` bindings, `run-*-contract` runners, `expected-resolvable.ts`. Not re-read line by line: the 925-line and 1140-line codex spec rewrites, and the kernel lock internals (the runtime review owns those). |

## Findings

### S1 (Serious): the new platform-core and registration code is not prettier-clean

`npx prettier --check` on the diff's `.ts` files lists 11 files. 6 are new files from this phase, one is touched by it, and the rest were already dirty at the base commit:

- New in this phase, dirty: `platform-core/src/session-driver-lock/control-endpoint.ts`, `control-keys.ts`, `local-lock-client.ts`, `control-endpoint.cross-process.spec.ts`, `kernel-session-driver-lock.cross-process.spec.ts`, `testing/contracts/run-session-driver-lock-contract.ts`.
- Touched by this phase, dirty only because of its added lines: `platform-cli/src/registration.ts`. It was clean at the base. The added lines, `registration.ts:69-73`, use an unformatted `useValue: process.platform === 'darwin' ? ... : ...` ternary.
- Already dirty at base, so not caused by this phase, but the added lines follow the same bad style: `platform-core/src/di/tokens.ts`, `platform-core/src/index.ts` (lines 407-415: multi-name export lines over 100 columns), `platform-electron/src/registration.ts`, `apps/ptah-electron/src/di/surface-composition.spec.ts`.

The base was already unformatted in places, but every new file here should be formatted. Fix: run `npx prettier --write` on the 7 files this phase created or newly dirtied. For the 4 pre-existing dirty files, format only the hunks this phase added. Do not format the whole file, which would create diff noise.

### S2 (Serious): inline fake coordinator duplicated across 19 specs, behind positional `undefined` padding

- `grep -rl "beginDrive: jest.fn" rpc-handlers/src` returns 19 files.
- In `chat-session-auth.spec.ts:131-150` the same 5-method literal is passed as the 26th positional constructor argument. It is preceded by 9 bare `undefined,` lines and cast with `as never`.
- The constructor parameter order is now load-bearing in 19 places. Any new optional parameter will silently shift the fake into the wrong slot, and `as never` hides it.
- Fix: add one `makeFakeDriverLockCoordinator()` factory under the chat/session test support area, with the five methods and sensible defaults. Where the arguments are positional, prefer a shared `makeChatSessionService(overrides)` factory over padding with `undefined`. Do not repeat the literal in each spec.

### S3 (Serious): `ChatSessionService` depends on the concrete coordinator class, and the optional injection is dishonest

- `chat-session.service.ts:421-422` injects `SessionDriverLockCoordinator`, the class. The sibling `hostRouting` takes the `ChatHostRouting` abstraction (`:411-413`). The 19 specs then have to cast to `never`.
- `@inject(..., { isOptional: true })` marks the coordinator optional. `lockCoordinator` (`:431-437`) then throws `SESSION_DRIVER_LOCK_UNAVAILABLE` for every call path whenever it is absent. Optional with a mandatory throw is neither optional nor fail-fast at construction. It also moves the failure from DI-lint time to the first chat turn.
- The same file, `:413-414`, says `hostRouting` is optional because VS Code and CLI hosts do not bind it. This coordinator has no such host: the platform is Electron-only and `registerChatServices` registers it unconditionally (`chat/di.ts:100-103`).
- Fix: declare a narrow `ChatSessionDriveLock` interface (`beginDrive`, `abandonDrive`, `assertDriveHeld`, `assertRecordAdmission`) next to `ChatHostRouting` and inject that. Make the injection required. The fake in S2 then needs no `as never`. If the optionality is kept for the old unit-test constructor shape, state that reason in a comment.

### S4 (Serious): `expected-resolvable.ts` was not updated for the new tokens

The root rules require `apps/ptah-electron/src/di/expected-resolvable.ts` to be updated when the resolvable surface changes. `grep DRIVER` on that file returns nothing. It lists neighbours such as `HOST_ROUTING_COORDINATOR` (`:42`) and `PLATFORM_TOKENS` entries, but not `PLATFORM_TOKENS.SESSION_DRIVER_LOCK` or `CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR`. The Codex gate resolves the coordinator lazily by token (`codex-runtime-composition.ts:773-783`), so an unregistered token would first surface at runtime, not in the lint. Fix: add both tokens to the expected list. Confirm with `tools/di-lint`.

### M1 (Minor): the contract runner is not exported and has no self-spec

- `run-session-driver-lock-contract.ts` is not in `testing/contracts/index.ts`. Every sibling runner is exported there (`index.ts:10-20`). The two specs import it by relative path (`kernel-session-driver-lock.spec.ts:1`).
- The runner has no `.self.spec.ts`, unlike the other runners.
- Neither adapter's `registration.ts` has a registration spec. `registration.workspace-state-storage.spec.ts` shows the precedent.
- Fix: export the runner from the barrel and add a self-spec.

### M2 (Minor): the `process.platform === 'darwin'` ternary is duplicated in two registrations

`platform-electron/src/registration.ts` (`+112-117`) and `platform-cli/src/registration.ts` (`+66-71`) carry the same branch. The rule is: the platform is chosen where the repository's host composition lives. Two copies will drift. Fix: add a `createSessionDriverLock()` factory in `platform-core/session-driver-lock/`, exported from the barrel, and register `useValue: createSessionDriverLock()` in both. Include a comment on why macOS gets the null lock.

### M3 (Minor): the `rpc-handlers/src/index.ts` export is misplaced, and symbol tokens are inconsistent

- `SessionDriverLockCoordinator` is exported at the top of the file (`:9`), above the alphabetical and grouped chat exports.
- `CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR = Symbol.for('SessionDriverLockCoordinator')` (`tokens.ts:15`) omits the `Chat` prefix that neighbouring tokens use (`'ChatSessionService'`, `'ChatSdkContextService'`). The `PLATFORM_TOKENS.SESSION_DRIVER_LOCK` value `'PlatformSessionDriverLock'` is correct. Fix: `Symbol.for('ChatSessionDriverLockCoordinator')`, and move the export into the chat group.

### M4 (Minor): the diff includes unrelated whitespace-only reformatting

Reflowed exports in `agent-sdk/src/index.ts:208-211` and `rpc-handlers/src/index.ts:165-168`. This is harmless and prettier-clean, but it is noise in a locking diff and should be noted for the commit.

## Notes 1-5

1. **Prettier.** Not clean. The 11 files are listed under S1. Of those, 6 are new files from this phase (the five under `session-driver-lock/` plus the contract runner), 1 is a touched file that was clean at the base (`platform-cli/src/registration.ts`), and 4 were already dirty at the base (`di/tokens.ts`, `platform-core/src/index.ts`, `platform-electron/src/registration.ts`, `surface-composition.spec.ts`). Run `npx prettier --write` on the first 7. The `.ts` files in the `session-driver-lock/` directory that the check did not flag are clean, including `kernel-session-driver-lock.ts`.
2. **Layering.** Pass.
   - Platform libs: no `@ptah-extension/agent-sdk` import (the single grep hit is a comment in `electron-state-storage-large-profile.perf.spec.ts:44`).
   - `agent-sdk` has no reference to the lock (`grep -rln "session-driver-lock|SessionDriverLock"` returns nothing). The codex gate is a port (`CodexChatDriverGate`) implemented in the composition root (`codex-runtime-composition.ts:773`).
   - `rpc-handlers`: the coordinator imports only the `@ptah-extension/*` barrels (`session-driver-lock-coordinator.ts:1-10`). No relative cross-lib path, no `import()` and no `eslint-disable` in the added lines. The only added `import('@ptah-extension/...')` forms are `typeof import(...)` in spec `jest.requireActual<>` type arguments.
   - The coordinator imports `RpcUserError` from `vscode-core`. Siblings in `chat-session.service.ts` do the same, so this is not a new leak.
3. **`SessionRegistry` export from the agent-sdk barrel.** The class is exported from the public barrel (`index.ts:261`) only so a cross-process spec can construct it (`session-driver-lock-coordinator.cross-process.spec.ts:11`). It widens the public surface permanently and is a deep path export, unlike its neighbours. Prefer a testing entry point or secondary export (a `testing` entry mapped in `tsconfig.base.json`, as other libs do) or build the registry through `SessionLifecycleManager`. Accept it only if neither is practical, and mark it `@internal` test-only. I rate this Minor (not enough to block).
4. **Fake coordinator.** Duplicated inline in 19 specs, not shared. See S2 for the cost and the fix.
5. **DI.**
   - Names: `PLATFORM_TOKENS.SESSION_DRIVER_LOCK` is correct (grouped object, `Symbol.for('Platform...')`, documented, `di/tokens.ts:103-104`). `CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR` lacks the `Chat` prefix (M3).
   - `registerSingleton` for the coordinator in `chat/di.ts:100-103` matches neighbours.
   - `useValue` with an eagerly constructed `KernelSessionDriverLock` in both platform `registration.ts` files matches the `PLATFORM_INFO` and `FILE_SYSTEM_PROVIDER` pattern, which also use `useValue` with `new`. Acceptable. But the branch is duplicated (M2), `expected-resolvable.ts` is missing both tokens (S4), and no registration spec was added (M1). The lock holds kernel resources, so who calls `dispose()` is a shutdown wiring question; I did not trace it here and the logic reviewer should confirm it.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| agnostic libs depend on ports, not adapters | PASS | `session-driver-lock.interface.ts`, `PLATFORM_TOKENS.SESSION_DRIVER_LOCK` |
| platform libs do not import agent-sdk | PASS | grep on `platform-*/src` |
| agent-sdk does not import the lock | PASS | port-only `CodexChatDriverGate` |
| rpc-handlers uses barrels only | PASS | coordinator imports |
| new port bound in both adapters | PASS | both `registration.ts` |
| contract runner for the new port | PARTIAL | M1: not in barrel, no self-spec |
| `expected-resolvable.ts` updated | FAIL | S4 |
| token naming conventions | PARTIAL | M3 |
| prettier clean | FAIL | S1 |
| no `as any` / `@ts-ignore` / `eslint-disable` added | PASS | grep of the diff |
| tests typed without `as never` bypass | FAIL | S2/S3 |

## Maintenance debt

- Introduced: a duplicated test fake in 19 specs, a positional-argument constructor that now carries 26 parameters, and a duplicated platform branch.
- Retired: nothing.
- Net: increasing.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (boundaries verified by grep; inner logic of the kernel lock and 1000-line spec rewrites were not read in full)
- Key concern: S2/S3 coupling the 19 specs and the service constructor to a concrete class and a positional slot.
- A 10/10 version would: ship prettier-clean files, give the service a narrow interface with required injection, share one fake factory, register tokens in `expected-resolvable.ts`, export the contract runner with a self-spec, centralise the platform branch in one factory, and expose `SessionRegistry` only through a testing entry.
