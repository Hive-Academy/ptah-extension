# CI fix round 2 — PR #916

## Failure 1 — ChatView Codex re-auth

- Verdict: stale test.
- Evidence: `codex-sign-in-block.component.ts:122-159` reads `state`, `refreshFailed`, `nothingSeen`, `start`, `restart`, `cancel`, and `checkAuthStatus`. The real service exposes these at `codex-sign-in.service.ts:19-28,48-54,93-99,132-147`; the harness stub at `chat-view.component.spec.ts:553-560` omitted `nothingSeen` and `restart` (and the public `refreshing` signal).
- Change: completed the harness stub in `chat-view.component.spec.ts:531-566` with `nothingSeen`, `refreshing`, and `restart`.

## Failure 2 — launched login state

- Verdict: stale test.
- Evidence: `providers-connection-setup.service.ts:283-314` deliberately leaves a launched Codex attempt `in-flight` until its status becomes succeeded, failed, or cancelled; `:233-239` initializes `message` to null. The FB report calls this the intended settlement path. The old expectation at `providers-settings-state.service.spec.ts:1145-1148` described pre-FB behavior.
- Change: `providers-settings-state.service.spec.ts:1145-1146` now expects `in-flight` with a null message while no final status has arrived.

## Failure 3 — metadata flush quit dependencies

- Verdict: stale test.
- Evidence: `shutdown.ts:146-150` requires `codexSignIn` on every `QuitSequenceDeps`; `main.quit-path.spec.ts:229` and `shutdown.spec.ts:74` already provide inactive stubs.
- Change: added the same inactive stub to all five `handleWillQuit` calls in `main.metadata-flush.spec.ts:73,144,221,299,328`.

## Failure 4 — expected resolvable token order

- Verdict: product bug in the resolvable-token list order; the smoke assertion remains valid.
- Evidence: `container.smoke.spec.ts:1001-1002` registers only phase 4 before checking index zero. `git show origin/main:apps/ptah-electron/src/di/expected-resolvable.ts` confirms `HOST_ROUTING_COORDINATOR` was first; the branch had prepended three phase 2 Codex registrations at `expected-resolvable.ts:44-46`.
- Change: moved the three Codex entries after the existing entries in `expected-resolvable.ts:43-54`, retaining all tokens and restoring the index-zero contract.

## Failure 5 — Codex login quit composition

- Verdict: stale test fixture.
- Evidence: `codex-login-composition.ts:29-55` captures the per-container login instance for the quit handle. `codex-login.service.ts:77-99,113` marks a valid attempt active synchronously, but `codex-login-composition.ts:36-38` throws when the test has not registered `SelectionSnapshot`; the launch catches that and settles the attempt. The first composition test already registers a pending selection at `codex-login-composition.spec.ts:38-46`. `phase-2-libraries.ts:223-227` registers SDK services before the Electron Codex override, so the merge did not change the instance used here.
- Change: registered a pending selection snapshot in the second composition test at `codex-login-composition.spec.ts:65-72`; resolved it after stopping the first container's attempt. The test still checks that only the first handle sees the active login.

## Decisions

- Four failures were stale tests. The token-list ordering was a product contract bug; no product service was changed.
- The Angular frontend patterns skill was read before changing the Angular specs. Ptah workspace analysis and native `rg`/file reads supplied the source evidence.
- Validation: `git diff --check` passed. Tests, typechecks, Nx, npm verification, builds, and application targets were not run because this round forbids them; CI is the verification gate. No commit was made.
