# Phase C fix round 1 — lane A

## Findings

- **F2:** `kernel-session-driver-lock.ts:66-74` now refuses acquisition of a releasing or stranded entry. `control-endpoint.ts:176-189` checks live ownership again immediately before operator release. Regression specs: `kernel-session-driver-lock.spec.ts:83-130` tests acquisition while close is pending and `control-endpoint.spec.ts:44-57` tests ownership becoming live during the operator request. The socket-based specs could not execute in this sandbox (binds returned unavailable); see checks.
- **F3:** `endpoint-names.ts:3-9` and `control-keys.ts:90-100` derive Windows names from the normalized lowercase username, without USERDOMAIN. The incorrect SID comment was corrected. `kernel-session-driver-lock.spec.ts:132-153` compares names with USERDOMAIN unset and changed; it passed.
- **F5:** `codex-chat-session-controls.ts:109-125` moves synchronous close steps inside the safe closing promise and keeps lease release in `finally`. `codex-chat-adapter.spec.ts:220-242` injects a synchronous sink disposal error and checks one lease release; the agent-sdk suite passed.
- **F7:** `create-session-driver-lock.ts:1-17` centralizes host selection and emits one process-wide warning on darwin. `platform-core/src/index.ts:411`, `platform-electron/src/registration.ts:115`, and `platform-cli/src/registration.ts:69` use the factory. No logger exists in either registration file; the factory uses `console.warn` once.
- **Cross-process timeouts:** `spawn-driver-lock-holder.ts:1-55`, `control-endpoint.cross-process.spec.ts:1-85`, and `kernel-session-driver-lock.cross-process.spec.ts:1-91` use per-child temporary HOME, transpile-only ts-node, 30 s ready timers, SIGKILL cleanup, and 45 s Jest timeouts.
- **S1 and style:** Ran Prettier write on the listed lane A files, including `local-lock-client.ts`, `run-session-driver-lock-contract.ts`, and CLI registration, plus all other changed platform-core and agent-sdk files. Added the contract barrel export at `testing/contracts/index.ts:61` and null-adapter self spec at `run-session-driver-lock-contract.self.spec.ts:1-4`. Only the added lines were formatted in the already-dirty `platform-core/src/index.ts` and Electron registration.

## Checks

- `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/agent-sdk,@ptah-extension/platform-electron,@ptah-extension/platform-cli,degradation-audit`: blocked before targets by Nx daemon/plugin socket EPERM.
- `npx eslint` on lane A changed files: 0 errors, 2 existing non-null-assertion warnings in `local-lock-client.ts:124,126`.
- `npx prettier --check` on changed files: failed only on already-dirty `platform-core/src/index.ts` and `platform-electron/src/registration.ts`. Excluding those two whole files, all other changed files pass.
- Direct Jest agent-sdk adapter spec with project config: 109 passed. Direct Jest Windows naming regression: 1 passed. Direct platform-core kernel/control suite: 3 passed, 6 failed because this sandbox cannot bind the kernel/control sockets. The newly added socket race specs therefore remain unverified here.
- `ptah_get_diagnostics` after edits: clean on the final changed-spec check; initial broad check timed out while TypeScript continued in background.
- No git commands, commits, pushes, or edits under rpc-handlers or apps/ptah-electron.

## Decisions

- Refuse an acquisition while a local entry is releasing or stranded. This preserves exclusion without introducing a wait that can hang on a stranded close; callers may retry after release settles. Reversible.
- Use a normalized lowercase username for Windows names, as permitted by the finding. A real SID would require an additional Windows lookup. Reversible, though changing the name affects concurrently running old versions.
- Use one factory in platform-core for host selection and the darwin warning. Neither registration file has an existing logger; the factory emits one process-wide warning via `console.warn`. Reversible.

## Fix round 2

- **Degradation audit:** `control-endpoint.ts:129-138,161-164,187-190` uses one fail-closed live-record helper for listing and both operator-release checks. Its catch has the required `reported` annotation; uncertain ownership appears as a live record or `in-use`. This replaces the two invalid catch annotations. Audit passed with platform-core at 7 sites, matching its baseline.
- **Stranded acquisition:** `kernel-session-driver-lock.spec.ts:67-76` now checks refusal while the injected `close()` failure persists, then checks that a later acquisition of the same session retries the stranded close and succeeds after the failure is removed. The previous assertion expected refusal after recovery, contradicting W10's retry-on-next-lock-call contract. The production lock already implements the planned retry; no production behavior was changed. The test could not reach these assertions here because the initial socket bind fails in this sandbox.
- **Cross-process discovery:** `control-endpoint.cross-process.spec.ts:8-51,63-98` makes the child's temporary home available to the parent client and restores the parent's `HOME` and `USERPROFILE` after the scenario. Previously the child wrote its control key under its temporary HOME while the parent searched its own home, so the listing assertion failed before the live-record check. The test still covers listing a live holder, refusal with `in-use`, and release after orphaning. The socket-based test could not run in this sandbox.

### Checks

- `npx ts-node tools/degradation-audit/check-degradation.ts`: passed; platform-core 7 sites (baseline 7).
- `npx eslint` and `npx prettier --check` on the three changed source/spec files: passed.
- Scoped `ptah_get_diagnostics` on those files after edits: 0 errors, 0 warnings.
- `npx jest -c libs/backend/platform-core/jest.config.ts kernel-session-driver-lock.spec --runInBand --coverage=false`: 3 passed, 4 failed at initial acquisition because socket binding is unavailable in this sandbox. The cross-process control spec was not run for the same reason.

### Decisions

- Keep W10's retry-on-next-lock-call behavior. While an attempted close still fails, acquisition refuses the stranded entry and leaves it visible; after a successful retry, acquisition can bind a fresh lock. This preserves fail-closed exclusion and is reversible.
- Share one fail-closed live-record check across listing and release to retain the audit baseline. A check failure is surfaced as live ownership or `in-use`; reversible.
