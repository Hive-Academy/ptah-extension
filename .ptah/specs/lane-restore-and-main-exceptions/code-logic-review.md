# Code Logic Review

Review family: implementer Codex (both lanes); reviewer Claude (orchestrator,
in-process). Weaker-evidence label: the reviewer is the coordinating agent, not
an independent lane. Every other vendor lane was unavailable: OpenCode (free
usage limit), Grok (402 balance exhausted), Antigravity (exit 1 at start),
Kimi (5-hour limit hit mid-review, wrote only a skeleton), GLM (weekly limit).

## Findings

1. **major — fixed.** `apps/ptah-electron/src/main.ts` `onGoal` resolved Logger
   and SentryService after the boot guards were removed. A throw from
   `resolve` would itself be an uncaught exception, which is the native modal
   this change exists to prevent. A null container skipped the guard with no
   trace. Fix: `installMainProcessErrorGuardFrom` in
   `apps/ptah-electron/src/activation/main-process-error-guard.ts` checks
   registration, catches resolve errors, and reports through
   `reportBootFailure`. Pinned by three new spec cases.
2. **minor — accepted.** Post-boot errors are captured by the guard and,
   when `@sentry/electron` registers its own `OnUncaughtException` listener,
   possibly by Sentry as well (duplicate event). With another listener
   present Sentry does not exit the process, which is the intended outcome.
3. **minor — accepted.** The resume bypass for `host-restart` has no age cap.
   It is gated on the explicit marker plus a matching CLI session id, and the
   context-size rule still applies. Listed as an open question.
4. **checked, no defect.** RpcBridge `cleanup`/`timer` ordering: every call of
   `cleanup` happens after both constants are initialized (timer callback and
   `closed` listener run later), so there is no TDZ error.
5. **checked, no defect.** A resumed lane gets a new record; the gate reads the
   latest lane record, so an old `host-restart` marker does not leak into a
   later lane that completes normally.

## Score and Verdict

8/10 — APPROVED after the fix in finding 1.
