# Code Style Re-review, Phase C — TASK_2026_858_f7b9 (final)

Review family: claude (implementer: codex)
Diff: `446c5f38b..8cdb176b7` (c50e62b4d, 8cdb176b7). `control-endpoint.cross-process.spec.ts` ignored as instructed.

## Verdict: APPROVED, 8/10 (blocking 0, serious 0, minor 3)

## Per finding

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 prettier | Fixed | `npx prettier --check` on every `.ts` file in `17ade5466..8cdb176b7` now lists only 3 files: `platform-core/src/di/tokens.ts`, `platform-core/src/index.ts`, `platform-electron/src/registration.ts`. All three were already dirty at base (confirmed in the first review). This phase's added lines no longer introduce new dirt. Leaving them is acceptable. |
| S2 shared fake | Partly fixed | One factory: `rpc-handlers/src/test-utils/fake-driver-lock-coordinator.ts:3-13`, typed `jest.Mocked<ChatSessionDriverLock>`. The 19 specs now call it (about 9 lines changed each), and the `as never` literal is gone. Not done, as the implementer reported: a shared `ChatSessionService` factory. The nine positional `undefined,` lines remain, for example `chat-session-auth.spec.ts` around the former 131-150. This is residual maintenance cost, not blocking. |
| S3 abstraction | Fixed, with a smell | `session-driver-lock-coordinator.interface.ts:1-13` defines `ChatSessionDriverLock` (a `Pick` of the class). `chat-session.service.ts` injects it without `isOptional` and the "unavailable" throw is removed. See N1 for the `undefined!` default. |
| S4 expected-resolvable | Fixed | `expected-resolvable.ts` adds both `SESSION_DRIVER_LOCK` and `SESSION_DRIVER_LOCK_COORDINATOR`. |
| M1 contract runner | Fixed | exported from `testing/contracts/index.ts`; `run-session-driver-lock-contract.self.spec.ts` added. No registration spec (the original asked for one in passing). |
| M2 darwin branch | Fixed | `create-session-driver-lock.ts:7-17` is the single factory. It is exported at `platform-core/src/index.ts:411` and used in both registrations (`useValue: createSessionDriverLock()`). |
| M3 token naming | Fixed | `tokens.ts` now `Symbol.for('ChatSessionDriverLockCoordinator')`. Export placement in `rpc-handlers/src/index.ts` not re-checked. |
| M4 noise | Left | Unrelated reformatting noted before. Harmless. |
| Note 3 `SessionRegistry` barrel export | Not changed | `agent-sdk/src/index.ts:261` still exports it, used only by the cross-process spec (`session-driver-lock-coordinator.cross-process.spec.ts:12,26`). Still minor. |

## New issues

- **N1 (minor): `driverLock: ChatSessionDriverLock = undefined!`.** The service now injects the lock as required but declares a non-null-assertion default of `undefined` to keep the old positional test constructors compiling. It hides a missing argument from the type checker, which is the same hole `isOptional` left. Fix: drop the default and pass the fake explicitly. Doing so is consistent with the leftover S2 work: a shared service factory would remove it.
- **N2 (minor): `console.warn` in `create-session-driver-lock.ts:11`.** platform-core has no logger at that layer, and the module flag `warnedDarwin` is module state. Acceptable, but check whether sibling platform-core code uses a logger port. If so, route the warning through it.
- **N3 (minor): `ChatSessionDriverLock` is a `Pick` of the concrete class.** It narrows the surface but still ties the interface file to the class by type import (`session-driver-lock-coordinator.interface.ts:1`). It is fine today. If a second implementation appears, invert this: define the interface and `implements` it in the class.

## Maintenance debt

- Introduced: positional-parameter padding in specs persists; the small `undefined!` default.
- Retired: 19 duplicated inline fakes, the duplicated darwin branch, `expected-resolvable` gap, runner export gap.
- Net: decreasing.

## Confidence

MEDIUM-HIGH. The service fix was reviewed from the diff, not by reading all 2,600 lines of the service.
