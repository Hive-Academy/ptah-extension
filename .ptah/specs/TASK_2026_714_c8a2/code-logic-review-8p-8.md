# Code Logic Review: batch 8p-8

Score: 8.5/10. Verdict: APPROVED WITH NOTES. Blocking 0, Serious 0, Moderate 0, Minor 1.

## Checks

1. SystemRoot trust (`codex-read-only-command.ts:33-39`)
   - Regex `^[a-z]:[\\/][^\\/]+[\\/]?$` rejects UNC, drive root, relative and nested roots.
   - `path.win32.normalize` and `join` cover forward slashes and case (lowercase compare). `pathWithin` is case-insensitive on win32 (`path.win32.relative`).
   - The in-thread-folder rejection works for a SystemRoot equal to, or inside, the thread folder.
   - The real path `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command '<body>'` is still trusted. The `-Command` regex and body handling (lines 41-46) are unchanged.
   - 8.3 names: the comparison is lexical, so a short-name executable string will not equal the long join and is refused (fail-safe). Junctions or symlinks inside the thread folder are not resolved, but the lexical path would have to equal `<SystemRoot>\System32\...`, so there is no bypass.
   - Minor (M1): the `[^\\/]+` name segment also matches `..` and `.`. `C:\..` normalizes to `C:\System32\WindowsPowerShell\v1.0\powershell.exe`, so a trusted root that is not one real folder below the drive is possible. It needs control of the environment, which already implies control of the executable. Tighten with `(?!\.\.?[\\/]?$)` if wanted. Not blocking.
2. `hasReason` (`codex-chat-approval-sink.ts:138-141`)
   - It is a boolean derived from a trimmed non-empty string, and the reason text is never logged. The spec at `codex-chat-approval-sink.spec.ts` asserts the text is absent from the log calls.
   - Auto-accept is not gated on it, as decided. OK.
3. Dispose guard in the edit follow-up (`codex-chat-approval-sink.ts:260-261`)
   - The check sits at the top of the `setImmediate` callback, so it is correct.
   - The dispose spec is inside the fake-timer describe (`beforeEach` at spec line 282) and uses `runOnlyPendingTimersAsync`, so it runs the scheduled immediate. Without the guard, `followUp.post` would be called, so the test would fail.
   - The abort/dispose realpath specs gate on a promise, not on timers, so fake timers do not block them. They exercise the post-await guard at sink lines 130-133.
   - Without that guard, an aborted signal would reach `presentRequest`, and a disposed sink would call `present` or log an accept. The test's `present` and `logger.info` assertions would catch both.
   - Residual: `acceptIfRealPathsStayInside` checks `signal.aborted` at line 161 but not `disposed`. The post-await guard covers this, so there is no defect.
4. `CodexRuntimeOptions` export
   - It is now exported from `index.ts:52` straight from `codex-context`. The shim in `codex-runtime.ts` is removed.
   - Importers: `codex-runtime.ts:11`, `registration.ts:13` and `codex-runtime.spec.ts:13` all import from `codex-context`. A repo-wide grep found no other importer, including in `apps/`.
5. `normalizedHome` comment (`codex-execution-profile.ts:283-284`)
   - It is accurate. Resume compares `normalizedHome` at `codex-runtime.ts:44` (identity mismatch throws), and `codex-context.ts:195` also checks `verifiedCodexHome`.
   - I did not verify the claim that accountId and consumer are absent from the digest. It is a comment only, with no behaviour impact.

## Verdict

APPROVE WITH NOTES. Confidence: HIGH. No real defects. The only note is M1, an optional hardening of the SystemRoot regex.
