# Phase C fix B report

## Findings

- **F1:** Admission failures now exist only during an explicit start attempt and are cleared on every start exit; record removal clears them when no admission is active. Rebinding drops the old record even if binding the new one fails. [coordinator](../../../libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.ts#L154), [service](../../../libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L1106). Regression specs cover a refused then healthy start on one tab and failed rebind releasing the old lock ([spec](../../../libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.spec.ts#L91)).
- **F4:** Continue, resume activation, and rewind release provisional ownership in `finally`; successful binding transfers it to the record. [service](../../../libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L1928), [coordinator](../../../libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.ts#L154). A spec covers abandonment and kernel release ([spec](../../../libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.spec.ts#L174)).
- **F6:** Lifecycle notification promises and handoff cleanup now log rejections through the injected logger ([coordinator](../../../libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.ts#L45)).
- **S2:** Replaced the five-method inline coordinator in 19 chat specs with a shared typed fake ([factory](../../../libs/backend/rpc-handlers/src/lib/chat/session/testing/fake-driver-lock-coordinator.ts#L1)). The duplicated positional `ChatSessionService` construction remains; a shared service factory was not completed.
- **S3:** `ChatSessionService` uses a narrow `ChatSessionDriverLock` contract and a non-optional tsyringe token; the missing-registration runtime guard was removed ([contract](../../../libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.interface.ts#L1), [service](../../../libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L421)). The parameter retains a TypeScript default because it follows existing optional constructor parameters; tsyringe injection itself is required.
- **S4:** Electron's resolvable-token census now includes both lock tokens ([expected-resolvable.ts](../../../apps/ptah-electron/src/di/expected-resolvable.ts#L44)).
- **Style minor:** The symbol description uses the local `Chat` prefix ([tokens.ts](../../../libs/backend/rpc-handlers/src/lib/chat/tokens.ts#L15)).
- **S1:** Prettier wrote the changed rpc-handlers and Electron DI files, including `surface-composition.spec.ts`. The broad `*spec.ts` glob also formatted unrelated session specs; those formatting changes were not reverted. No files in lane A's paths were edited by this lane.

## Checks

- `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,degradation-audit`: blocked by Nx daemon/plugin-worker Unix socket `EPERM` in the sandbox.
- `npx eslint` on the scoped chat and Electron DI files: 0 errors, 6 warnings.
- `npx prettier --check` on the same files: pass.
- `npx tsc -p libs/backend/rpc-handlers/tsconfig.spec.json --noEmit --pretty false`: pass.
- Project-config Jest: coordinator spec 6/6; auth, host-routing, and resume-activate specs 45/45.
- `ptah_get_diagnostics`: unavailable; TypeScript check did not finish within its 45-second tool window. Direct `tsc` above completed.

## Decisions

- **Admission lifetime:** Keep tab-keyed refusal only while `chat:start` is waiting for admission. Evidence: `assertRecordAdmission(tabId)` must still read a failure after lifecycle removal; clearing it immediately on removal would turn a refused start into success. Reversible: yes.
- **Rebind cleanup:** Drop old ownership in `finally`, independent of new binding. Evidence: the old record otherwise becomes unreachable from `heldByRecord`. Reversible: yes.
- **DI compatibility:** Keep the existing positional constructor layout while making the token non-optional in tsyringe. Evidence: many direct service constructions use the trailing coordinator slot. Reversible: yes.

## Fix round 2

- Moved the shared Jest fake from `src/lib/chat/session/testing/` to `src/test-utils/fake-driver-lock-coordinator.ts:3`, updated its interface import, and updated all 19 session spec imports (for example, `src/lib/chat/session/chat-session-auth.spec.ts:1`). The old file and empty directory were removed. No library barrel export was added.
- The coordinator's `bound` catch (`src/lib/chat/session/session-driver-lock-coordinator.ts:249-255`) now logs its error with the injected logger before calling `failRecord` and returning `false`.
- Prettier ran only on the coordinator, fake, and 19 specs with changed imports; all were already formatted. The unrelated session specs restored by the orchestrator were untouched.

### Round 2 checks

- `npx tsc -p libs/backend/rpc-handlers/tsconfig.lib.json --noEmit --pretty false`: pass.
- `npx ts-node tools/degradation-audit/check-degradation.ts`: pass; rpc-handlers 1 unsuppressed site (baseline 1).
- `ptah_get_diagnostics` scoped to changed implementation files: unavailable after 45 seconds; direct `tsc` passed.
- Focused Jest on all 19 changed specs: 19 suites, 339 tests passed.
- ESLint on the coordinator, fake, and 19 changed specs: 0 errors, 5 existing spec warnings.
- Prettier check on those same 21 files: pass.
- Nx verify was not rerun in this lane because the sandbox blocks it with Unix socket `EPERM`; the orchestrator previously ran it and supplied the round 2 failures.

### Round 2 decisions

- Kept the fake's Jest API unchanged because `src/test-utils` is already excluded from the library compilation and other test fakes there use Jest. Reversible: yes.
- Logged the actual admission failure in the catch; this preserves existing fail-closed behavior and satisfies the audit's explicit `.error(...)` criterion. Reversible: yes.
