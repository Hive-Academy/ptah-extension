# Code Logic Review - Batch 1c (Codex evidence harness)

Scope: `git diff HEAD` of `libs/backend/codex-runtime/tools/` plus new `evidence-failure-notes.ts` and `evidence-frames.ts`. Read whole of both new files and the changed regions of `evidence-harness.ts` (policy/override/compare 752-813, runCase 1015-1377, markerApprovalDecision 857-902, sanitize 77-135). No code or specs executed.

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Assessment | REVISE (small fixes; no fail-open found) |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 4 |
| Minor | 3 |

## Fail-closed assessment (no finding)

- Identity gates are unchanged. `fixed` is still computed from `markerApprovalDecision(..., ask/accept)` (harness:1113-1118) and `Unexpected request` still throws on `!fixed` (1129-1134). `recordCommandShape` runs only before the throw (1119-1128) and in the notification branch immediately before `throw new Error('Unexpected command')` (1173-1181) / `Unexpected file change` (1190-1199). Its result is never read by any decision. If it threw, the onRequest catch still declines and aborts; the notification path still fails the case (only the note text would become `unclassified error`).
- `approvalRequestObserved` (1056, 1091, 1360-1365) is write-only bookkeeping used solely for a note in `finally`. It does not touch `result.status` (1337-1340), which still requires `outcome && approvals.length === 1`. A case cannot pass without approval-before-effect: the `Side effect before approval` / `during approval` checks (1137-1142) are intact.
- Turn budget (`TurnBudget`, passed to turn/start and compact), `USAGE_CEILING` observe (1227-1237), `CASE_DEADLINE_MS` timer, 20 ms guard interval, and the `finally` cleanup order (clearInterval, clearTimeout, `rpc.stop()`, `children.delete`) are intact. The new note in `finally` cannot throw (`??=` on `result.notes`).
- Frame/envelope extraction (`evidence-frames.ts`) is a byte-faithful move of the decoder (compared with HEAD 195-233). The `failure-notes -> harness` import is `import type` (erased), so no runtime cycle.

## Policy, TOML and config compare

- `approval_policy={granular={sandbox_approval=true,rules=true,mcp_elicitations=true,request_permissions=true,skill_approval=true}}` (harness:795-806) is a well-formed TOML inline table, bare keys, lowercase bools. The contract report (section 5, line 101) records that 0.155.1 and 0.163.0 start with exactly this string. OK.
- `approvalPoliciesEqual` uses `isDeepStrictEqual`: key order insensitive, extra or missing keys rejected. Because all five flags are set true, echo-omits-defaults (`request_permissions`/`skill_approval` default false) cannot cause a false mismatch. Residual risk: if config/read echoes a normalized shape (e.g. omitted keys, kebab-case), the case fails closed with `Effective config differs from bounded profile`, which is acceptable for a spike but gives no diagnostic about which side differed (see M3).
- `approvalsReviewer: 'user'` is schema-backed on thread/start and turn/start; the note at 1276-1280 honestly says it is unconfirmed.
- `thread/start` receives `...selected`, which includes the non-schema key `sandbox` (pre-existing); unchanged.

## Findings

### Serious

**S1. Real home/profile paths in a model-supplied command are written verbatim to the artifact.** `evidence-failure-notes.ts:117-123,176-179`. Only experiment paths and `process.execPath` are replaced. `sanitize` (harness:77-110) redacts tokens/emails/ids but not filesystem paths. The exact scenario the note exists for is the model deviating from the fixed command; a deviation such as `type C:\Users\<name>\.codex\auth.json` or `cat ~/.codex/...` would persist the real username/home layout (and the intent to read credentials) into a spike artifact that is committed to docs. Fix: also replace the real `os.homedir()`, the source auth directory, `CODEX_HOME` of the invoking shell, `os.tmpdir()` and `process.cwd()` (same variant/ordering machinery), or fall back to a generic `<PATH>` regex for drive-letter/UNC/`/home|/Users` prefixes before `sanitize`.

### Moderate

**M1. 400-char truncation happens before `sanitize`** (`evidence-failure-notes.ts:178`: `(actual).slice(0, 400)` then `sanitize`). A secret straddling the cut boundary no longer matches the exact-secret `split(secret)` redaction (harness:83-84) and its prefix is emitted; regex rules such as the 48+ char token rule (109) likewise miss a truncated token. Fix: `sanitize` the full (post-placeholder) string, then slice; or slice after.

**M2. File-change diagnostic carries no information.** `recordCommandShape(..., 'file change')` reads only `command`/`commands`, which a `fileChange` item does not have, so the note is always `Unexpected file change shape: <missing command>` plus the keys of the notification envelope (`threadId, turnId, item`), asserted as such in the spec (spec "never records file-change contents"). It is safe, but the stated intent (diagnose why the file edit was rejected) is not served: no change count, no whether path is outside target, no kind. Emit bounded booleans (`changeCount`, `pathIsTarget`, `kind` from an allowlist) computed in the caller. It also appends to the same notes list, so a rejected file case adds noise without evidence.

**M3. Config-mismatch is undiagnosable.** `Effective config differs from bounded profile` (harness:1270-1275) lumps output bounds, sandbox and approval policy into one coded message; `result.effectiveConfig` (summary via configSummary) contains `approval_policy`, so the artifact does show the echoed value, but only if the case result is written before abort. Low risk; consider a separate coded message for approval-policy mismatch since this is the first run of granular against a real binary.

**M4. `granular ask: no approval request observed` is emitted in situations where it is misleading.** `finally` (harness:1360-1365) fires for any granular case that terminated early (RPC timeout, config mismatch, model/list failure, child died before turn/start). For `level: undefined` cases, such as plan or read-only-without-approval ones, granular is also selected (policy 770), so a case that legitimately expects no approval gets a note implying a defect. Gate the note on `turnId` having been set / terminal reached, and on the case expecting an approval.

### Minor

- m1. `evidence-failure-notes.ts:168`: wrapper regex handles `pwsh -NoProfile -Command` but not `-NoLogo`, `-ExecutionPolicy Bypass`, or `-File`; these classify as `other`. Diagnostic only; harmless.
- m2. `evidence-failure-notes.ts:137-141`: marker script replacement is case/quote exact and happens before path replacement, so a script copy containing a path variant is partially replaced; cosmetic.
- m3. Placeholder substitution is prefix-based (`<WORKSPACE>2` for `...workspace2`), cosmetic.

## Spec coverage

- Good: ordering of specific paths before root, slash variant, `''` quote variant, wrapper classification x3, quoting vs other, one-shape-per-case, key allowlist, redaction of `Bearer`, TOML string, structural compare (reorder, changed, missing, extra, string).
- Gaps:
  - Nothing exercises `runCase` wiring: approvalsReviewer on thread/start and turn/start, the `granular ask: no approval request observed` note, or that `approvalRequestObserved` does not change status. These are the batch's main behavior changes and are untested (report concedes the note has not been exercised).
  - "matches path casing only on Windows" (spec, last test of the shape describe) is conditional on `process.platform`, so on each platform it asserts only one branch; acceptable but not a cross-platform proof.
  - The shape tests use only `C:\evidence` roots, so POSIX-path and JSON-escaped (`\\`) variants are not asserted although variant code exists.
  - No test that a real-home path is replaced (matches S1).
  - The `'k'.repeat(40)` and `'bad key'` assertions depend on the regex `^[a-z][A-Za-z0-9]{0,31}$`; real, but `env`/`stderr` keys pass, which is fine.
  - Policy spec change (`if (level !== 'ask')`) drops the `ask` approvalPolicy assertion from that test, though the new describe covers it.

## Five questions

1. Silent failure: none that converts failure to success; the new note-only paths are advisory (S1/M4 are accuracy of notes, not outcomes).
2. Unexpected user action: running the spike on a machine with a username in the temp/home path reveals it only if the model emits it (S1).
3. Wrong answer from data: truncated secret (M1); granular note misleading for no-approval cases (M4).
4. Dependency failure: if the binary echoes a different approval_policy shape the case fails closed with a non-specific message (M3).
5. Missing: tests for the runCase wiring; a documented expectation of what `true` means per flag stays an assumption (acknowledged in decisions).

## Verdict

REVISE, 7/10. Fail-closed gates, budget, deadline and cleanup are intact and the moves are faithful. Fix S1 and M1 (cheap, leak-related), tidy M2/M4, and add a spec that drives the `runCase`/finalization note or at least extracts it as a pure function.
