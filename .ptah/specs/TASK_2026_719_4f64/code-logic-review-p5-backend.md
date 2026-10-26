# P5 backend code logic review

Verdict: REVISE
Score: 6/10

Two confirmed failure modes: 0 Blocking, 1 Serious, 1 Moderate, 0 Minor. Findings are static control-flow traces, not runtime reproductions.

The implementation covers the normal transaction, queue, redaction and deadline contracts, but the new ambient path can leave a child alive indefinitely and can attribute a successful status to the wrong environment. These concrete gaps place it below the 7–8 sound band. The bounded callers, transactional name checks and narrow RPC boundary distinguish it from the 3–4 band requiring a broader redesign.

## Findings

### 1. Serious — a PID reported after kill grace never receives the requested kill

**Evidence:** `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:491` creates a retained close receipt after kill grace; `:494` completes the operation, setting `settled = true` at `:479`. The pending `whenSpawned` callback then returns at `:503` for a positive PID instead of calling `killProcessTree` at `:505`.

This is reachable through the configured worker-backed spawner, not merely an unconstrained fake: `libs/backend/auth-providers/src/lib/di/register.ts:164` injects the SDK spawner, and `libs/backend/agent-sdk/src/lib/di/register.ts:477` binds that token to `OffThreadProcessSpawner`. Its PID promise waits for a worker message (`libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:281`, `:424`); `spawnProcess` does not pass an abort signal to that worker plan (`:805`). The command itself only forwards command/args/env/cwd/detached/guard (`claude-account-command.ts:455`).

**Failure scenario:** An ambient status child is still awaiting its worker's PID report when an environment change aborts the attempt. No close arrives during the two-second grace. The command returns an unclosed receipt. When the worker finally reports the PID, the callback sees `settled` and skips the kill. A hung child can now remain alive indefinitely. The reader correctly retains its receipt and blocks subsequent probes (`libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts:175`, `:264`), so every later refresh remains blocked until that child closes or host cleanup intervenes. The 25-second caller deadline does not terminate it.

**Impact:** An aborted/timed-out probe can survive its owner’s completed operation and disable ambient status checking for the session. This is an inherited defect in the shared command runner exposed by the new ambient reader; it is not claimed to be a newly introduced line.

**Suggested fix:** Separate “operation promise settled” from “child close observed.” A late positive PID must still receive the pending tree kill while termination remains unproved. Preserve receipt/close ownership and avoid killing a PID after close was already observed. Add a deferred-`whenSpawned` regression that reports the PID after grace and verifies both the kill and eventual receipt release. The current ambient command fake resolves its PID immediately (`claude-account-command.ambient.spec.ts:22`), so its timeout case cannot cover this ordering.

### 2. Moderate — cache identity and child environment are captured on opposite sides of an await

**Evidence:** `libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts:174` computes the attempt key from the current environment, then stores it at `:181`. Certification is awaited at `:208`; the environment actually passed to the status child is independently read afterward at `:214`. Completion checks the original key against the then-current environment at `:226` and caches the result under that original key at `:230`.

**Failure scenario:** Environment A points to a signed-out ambient login. A read records key A and waits for executable certification. The host environment changes to B, which points to a signed-in login; certification completes and the child receives B. Before that child completes, the environment returns to A. No intervening read marks the attempt obsolete. Completion sees A equal to the original key and returns/caches B's `connected` result as A's, with a fresh timestamp. Subsequent ordinary reads can reuse it for 60 seconds (`:125`).

**Impact:** The caller receives a successful, current-looking answer for a login that was not probed. This violates the explicit “never returned for a key it was not probed under” requirement (`.ptah/specs/TASK_2026_719_4f64/implementation-plan-p5.md:261`). The mutable environment and environment-change handling are part of this reader's contract; this does not require a forged RPC parameter.

**Suggested fix:** Capture one immutable allowed environment when starting an attempt, derive its key from that exact snapshot, and carry the snapshot through certification into `ambientStatus`. Keep the current-environment/generation check at completion. Add a deferred-certification A → B → A case and assert that the child environment matches the recorded attempt key. Existing environment-change tests change the environment after the status call starts (`claude-ambient-login-status.spec.ts:244`); the fake certification resolves immediately (`:58`).

## Five logic questions

1. **How can failure look like success?** Finding 2 returns `connected` and a new `checkedAt` for the wrong environment (`claude-ambient-login-status.ts:214`, `:230`). Malformed status normally becomes `unknown/unreadable`, not signed-out (`:218`).
2. **What user action produces unexpected behavior?** Refresh after an abort involving a late PID can remain permanently blocked by the surviving child in finding 1 (`claude-account-command.ts:503`; `claude-ambient-login-status.ts:175`). Refresh joining, one queued follow-up and transfer of obsolete callers otherwise follow the explicit queue branches (`claude-ambient-login-status.ts:153`, `:222`).
3. **What input produces a wrong answer instead of an error?** A → B → A changes to allowed ambient directory settings around certification produce finding 2. Duplicate/reserved names instead produce a transactionally checked refusal (`provider-account.store.ts:314`, `:330`, `:344`).
4. **What happens on dependency failure, timeout or malformed output?** Certification failures map to closed reasons; thrown command failures become fixed-log `unknown/unreadable`; null parsed status becomes unreadable (`claude-ambient-login-status.ts:193`, `:207`). Each caller independently times out with null `checkedAt` after 25 seconds (`:64`), while receipt ownership prevents overlapping children (`:264`). Finding 1 is the lifecycle hole after the caller/operation has completed.
5. **What was left implicit?** The plan's serial-child contract needs explicit behavior for PID discovery later than kill grace; its key contract needs one environment snapshot across certification and launch. The current implementation does neither (findings 1–2). Existing duplicate-name migration was explicitly excluded, rather than forgotten (`implementation-plan-p5.md:177`).

## Other requested checks

Paths abbreviated below are the files named in the findings unless a different path is supplied.

- **Uniqueness and concurrent writes:** Shared comparison trims and lowercases, and includes the reserved label (`libs/shared/src/lib/types/provider-account.types.ts:175`, `:185`). Add and rename check inside synchronous `BEGIN IMMEDIATE` transactions (`provider-account.store.ts:108`, `:307`, `:325`), excluding the renamed row and removed accounts (`:344`). Competing writers therefore cannot both pass the check and commit a newly duplicated label. Pre-existing duplicates remain readable by design; renaming one to a free name remains possible. Padded labels are rejected by existing validation before comparison (`:604`); the plan does not require silently trimming persisted input.
- **Replay:** The service returns the prior row for an identical request before insert, preserving the idempotent path (`libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:201`). The corresponding spec covers replay with the same label and refusal of a new request with its case variant (`provider-account.store.spec.ts:624`).
- **Child input/output and logs:** `ambientProbeEnv` copies only certified allowed keys plus the two ambient directory selectors and rejects newline-bearing values (`claude-ambient-login-status.ts:41`). The status argv is fixed and host-derived (`claude-account-command.ts:366`); RPC input supplies no env, path or argv. Output is bounded, stderr is drained, and stopped output is discarded (`:511`, `:514`). The reader exposes only closed state/reason plus a timestamp and logs fixed text on unexpected attempt failure (`claude-ambient-login-status.ts:193`, `:201`). No secret-bearing output path was confirmed in this reviewed flow.
- **RPC boundary:** Params are strict and limited to provider/optional boolean refresh (`libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.schema.ts:127`). The handler refuses other providers and projects only state, checkedAt and an unknown-state reason (`libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:391`). The method belongs to the `providerAccounts` capability group (`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:516`); absence is asserted for VS Code and CLI (`apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:121`; `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:55`).
- **Named-account guards and existing methods:** Current `status()` still revalidates its route, supplies the launch guard and revalidates after the child returns; logout has the same guard pattern (`claude-account-command.ts:343`, `:381`). Existing RPC registrations and implementations were read alongside the new read (`provider-account-rpc.handlers.ts:248`, `:355`, `:407`). No separate regression was confirmed there. Exact baseline equivalence is not asserted without the supplied diff.
- **Frontend type correction:** Excluding the ambient read from `AccountWriteMethod` is consistent with the write helper consuming a snapshot; it does not alter runtime behavior (`libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:574`, `:742`).
- **B3 reader-throw wording:** A plain thrown error reaching `refusalFrom` maps to `unavailable-storage` and “Account storage is unavailable.” (`provider-account-rpc.handlers.ts:188`, `:751`, `:806`). That wording would misdescribe an ambient-reader failure. Ordinary command/certification failures are already converted inside the reader (`claude-ambient-login-status.ts:191`, `:207`); no normal production-reachable escaping throw was confirmed. The handler test injects one artificially (`provider-account-rpc.handlers.spec.ts:1136`). Consequently this is not counted as a defect requiring revision, and “unreachable” is not claimed as a proof.

## Scope and verification

- Reviewed the named B1–B3 backend scope against plan revisions 1–2, sections 1–5, P5-D13–D16 and decisions D41–D44. The primary reader, command runner, store and handler implementations were read across their complete bodies; shared declarations, registration, host surface specs and worker-spawn dependencies were checked where relevant. No code-style-review document was found.
- No tests, builds, installs or git operations were run. The reviewer role prohibits git operations, so review used the caller's named file scope; a baseline diff was requested from the spawning session but was not available at report preparation. Claims about unchanged behavior are limited accordingly.
- Existing evidence reports 23 reader tests plus 36 command/auth-env tests passing (`.ptah/specs/TASK_2026_719_4f64/p5-batch-B2-report.md:100`). B3 reports 98 handler/allowlist/manifest tests, 14 shared tests, 38 Electron smoke tests, 14 CLI tests and 4 VS Code tests passing (`p5-batch-B3-report.md:67`). These are author-reported runs, not rerun by this reviewer. The immediate PID/certification fakes cited above leave the two confirmed orderings uncovered.
- The reviewer's scoped `ptah_get_diagnostics` attempt returned unavailable: TypeScript was still running after 45 seconds and all three requested files were unchecked. This is not a clean diagnostics result.
- `ptah_code_search_symbols` returned an empty index; targeted native text search was used as fallback. Findings rely on inspected source, not index coverage.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Include the inherited late-PID defect in this phase's verdict | Report its ambient impact; omit unchanged helper defects | New ambient read calls the shared runner and retains its receipts; finding 1 traces the configured worker path | Yes |
| Keep existing duplicates and padded-input refusal out of findings | Require migration/normalization; honor the stated write-only policy | Plan section 2 explicitly preserves existing duplicates; shared validation requires already-trimmed labels | Yes |
| Do not score the defensive storage-copy mismatch as a confirmed defect | Flag hypothetical copy; require a reachable production failure | Reader catches expected dependency failures; the handler spec fabricates a throw | Yes |

