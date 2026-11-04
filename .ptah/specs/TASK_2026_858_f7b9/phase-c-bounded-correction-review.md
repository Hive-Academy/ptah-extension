# Bounded correction review — TASK_2026_858_f7b9

Verdict: APPROVED
Score: 8/10
Review family: codex (implementer: claude)

## Scope and evidence

Reviewed the full corrected spec, its `git log -p --follow` history through `c50e62b4d`, `control-keys.ts`, `local-lock-client.ts`, the W10 discovery contract in `implementation-plan.md:507-548`, and the platform-core Jest/TypeScript configuration. The prior spec had no parent-home redirect and thus could discover the wrong directory (`control-endpoint.cross-process.spec.ts:21-34,64-70`; `control-keys.ts:11-23`). The reported prior failure is consistent with Jest's copied `process.env` and the native `os.homedir()` lookup; the repository history available for this file does not itself show the described parent env save/restore.

The fix is effective. `jest.requireActual('node:os')` supplies the real module export whose `homedir` property is spied on (`control-endpoint.cross-process.spec.ts:68-70`). `control-keys.ts:3,11-12` imports that `node:os` module and calls `homedir()` when each path is built. The platform-core Jest transform uses `ts-jest` with the spec's Node16 TypeScript settings (`libs/backend/platform-core/jest.config.ts:4-12`; `tsconfig.spec.json:3-9`), and `tsconfig.base.json:16` enables `esModuleInterop`; the namespace import remains a live binding to the module property. Thus `listLocalDriverLocks()` reads the child's temp-home directory (`local-lock-client.ts:78-91`), and `requestRelease()` reads the same key (`local-lock-client.ts:114-130`). The assertion requires the actual child PID, session ID, and live-record flag (`control-endpoint.cross-process.spec.ts:71-81`), so an empty list cannot pass. The `in-use`, `released`, and `not-held` assertions then check the protocol in sequence (`:82-93`).

The production use of `os.homedir()` follows the specified `~/.ptah/session-drivers/<pid>.key` discovery location (`implementation-plan.md:507-516`). Processes launched under different home directories will not discover one another's keys, even with the same OS user; that is a consequence of the chosen discovery contract, not a defect introduced or hidden by this test correction. The test deliberately gives parent and child the same discovery directory (`control-endpoint.cross-process.spec.ts:27-31,68-70`).

## Five logic questions

1. **How does this fail silently?** With the wrong home, directory absence yields `[]` (`local-lock-client.ts:80-84`) and a missing key yields `null` (`control-keys.ts:20-44`), but the corrected PID/session/live-record assertion fails rather than accepting the empty result (`control-endpoint.cross-process.spec.ts:71-81`).
2. **What user action produces unexpected behaviour?** The operator's list and release of a live holder are exercised: list finds the child, release returns `in-use`, then after orphaning it returns `released` and `not-held` (`control-endpoint.cross-process.spec.ts:71-93`). No unexpected operator result is evidenced by this correction.
3. **What input data produces a wrong answer?** A parent home different from the holder's home would select a different key directory (`control-keys.ts:11-17`); the temp home and spy align them in this test (`control-endpoint.cross-process.spec.ts:21,27-31,68-70`). Malformed keys are excluded by `readControlKey()` validation (`control-keys.ts:23-39`) and are outside this bounded case.
4. **What happens when a dependency fails?** Timeout kills the child (`control-endpoint.cross-process.spec.ts:37-40`); normal exit removes the temp home (`:35`); the test's `finally` restores the spy and kills the child after assertion failures (`:94-97`). A spawn error can leave the temp home because its error handler rejects without removal and `exit` is not guaranteed after a spawn error (`:21-22,35,48-50`).
5. **What is missing from the requirements?** The W10 contract specifies per-home discovery and live-record refusal (`implementation-plan.md:513-516,535-546`). It does not specify test fixture cleanup when process creation itself fails. That narrow gap is recorded below; no missing W10 behavior was found in this correction.

## New defects

- **Minor — temp directory may leak on child spawn failure.** `startHolder()` creates `home` before `spawn()` (`control-endpoint.cross-process.spec.ts:21-22`) and removes it only on `exit` (`:35`). Its `error` listener rejects without removing it (`:48-50`), while the test's `try/finally` begins only after `startHolder()` resolves (`:64-67`). A failed process creation can emit `error` without `exit`, leaving one empty temp directory. Clean the directory on the `error` path or use a once-only cleanup on `close`. This does not leave a running child or make the assertions vacuous.

## Decisions

- **Approve with the cleanup note.** Options were approve or revise. The correction makes the intended cross-process assertion non-vacuous and restores mocks on every path after holder startup (`control-endpoint.cross-process.spec.ts:67-97`); the remaining leak needs an uncommon spawn failure and affects test artifacts only. It is reversible by a small fixture cleanup change.

## Verification and limits

`ptah_get_diagnostics` reported zero TypeScript errors or warnings for the corrected spec. The orchestrator reported the spec alone passing and `npm run verify -- -p @ptah-extension/platform-core,degradation-audit` passing 4/4; I did not rerun those checks. I did not execute a forced spawn-failure injection, so the cleanup finding follows the control flow and Node child-process event contract rather than a reproduced failing check. Score 8/10 reflects a sound behavioral fix with that narrow resource leak; it falls below exemplary because startup failure cleanup is incomplete, and above the real-gap band because the core W10 assertions are effective.
