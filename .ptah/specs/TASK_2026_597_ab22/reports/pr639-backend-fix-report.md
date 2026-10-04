# PR #639 — CI fix: `SessionHandoffWriter › returns writeError and warns once when the directory is unwritable`

**Status: fixed.** All three mandated checks pass.

## Failing CI unit (Linux runner)

- File: `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-writer.spec.ts`
- Test: `SessionHandoffWriter › returns writeError and warns once when the directory is unwritable`
- Error: `logger warn — Expected number of calls: 1, Received number of calls: 3`

## Root cause

The spec makes `~/.ptah` a **file** (not a directory), so every `write()` fails at the
`fs.mkdir(this.handoffsDir, { recursive: true })` step
(`session-handoff-writer.ts:124`, pre-fix) and lands in the write catch. That catch calls
`removeTemp(temp)` (`:128`), whose `fs.rm(temp, { force: true })` **throws ENOTDIR on Linux** —
a path component (`~/.ptah`) is a file, and Node's `rm` only suppresses ENOENT when `force: true`
(verified against `node:internal` rimraf semantics; `force` is documented to ignore only
"path does not exist"). The catch in `removeTemp` then warned via a **raw** `this.logger.warn`
(pre-fix `:198`) on every failed write, with no once-guard.

Per-write warn tally on Linux (pre-fix):

| source                                                        | write #1 | write #2                       |
| ------------------------------------------------------------- | -------- | ------------------------------ |
| `removeTemp` — "Could not remove a temp file" (`:198`)        | 1        | 1                              |
| `failure()` → `warnOnce('write:<code>')` (`:210`, `:218-226`) | 1        | 0 (same signature, suppressed) |
| **total**                                                     | **2**    | **1** → **3** (expected 1)     |

On Windows the same `fs.rm(temp, { force: true })` maps the path-resolution failure to **ENOENT**
(`ERROR_PATH_NOT_FOUND` → ENOENT), which `force: true` already swallows — so `removeTemp` stayed
silent and the test saw exactly 1 warn. Verified live on this Windows machine with the exact
spec scenario: `mkdir(recursive)` threw `ENOTDIR` and `rm(force)` was **silent, no throw**.
That asymmetry (silent ENOENT on Windows vs thrown ENOTDIR on Linux) is why the test passed
locally and failed on the Linux CI runner with 3 warns.

The intended contract is "warn once": the class doc (`session-handoff-writer.ts:15`) says
"Each distinct failure is WARNed once", and `failure()` already implements it via
`warnOnce`. The single real failure in this scenario is the write failure; the `removeTemp`
ENOTDIR is **not a real failure** — the temp file was never created, so there is nothing to
remove. The bug was in the **writer**, not the spec's expectation.

## Fix (writer only — `removeTemp`)

`libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-writer.ts:196-213`

`removeTemp` now treats `ENOENT`/`ENOTDIR` from `fs.rm` as "the temp file was never created,
nothing to remove" and returns silently; any other removal failure (e.g. EACCES on an existing
temp) still warns. This normalizes the platform asymmetry inside the writer: both the
Windows-ENOENT (already swallowed by `force: true`) and the Linux-ENOTDIR cases are now
recognised as "nothing to remove", so the write failure is the only warn — exactly once,
on every platform. The deliberate swallow carries a `degradation-audit: optional-capability`
justification comment, matching the in-file precedent at `:159` and the audit tool's
Zone-2 placement contract (leading comment lines inside the catch body).

After the fix, the unwritable-directory scenario warns **1** time on both platforms
(`write:<code>` via `warnOnce`; the second write is suppressed by the once-guard).

### Spec: intentionally unchanged

The spec's simulation (a FILE where `.ptah` should be) is deterministic cross-OS — `mkdir`
with `recursive: true` reliably fails on every platform when a parent exists as a file, and the
spec's assertions are error-code-agnostic (`/^Could not write the handoff file/`). No
OS-permission tricks (no chmod), no fs mocking needed: the platform dependence lived entirely in
the writer's `removeTemp`, now normalised. Per the task rules, the expected count (1) was NOT
changed to 3.

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-writer.ts` — only
  `removeTemp` (`:196-213`) and its doc comment (`:190-195`); everything else untouched.

## Check results

| command                                                                             | result                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx run agent-sdk:test --testPathPattern=session-handoff-writer --maxWorkers=2` | exit 0 — `PASS .../session-budget/session-handoff-writer.spec.ts` (the pattern was forwarded but Jest ran the whole project suite: **136/138 suites passed, 2 skipped; 2803 tests passed, 3 skipped, 0 failed**). The previously failing test now passes. |
| `npx nx run-many -t typecheck,lint -p agent-sdk`                                    | exit 0 — `typecheck` and `lint` both `√` ran successfully.                                                                                                                                                                                                |
| `npx nx run degradation-audit:lint`                                                 | exit 0 — `libs/backend/agent-sdk: 4 ok (baseline 4)`; the changed file has **zero** findings (no unjustified swallow); TOTAL 294, every directory at or below baseline.                                                                                   |

Note: an intermediate version of this fix placed the `degradation-audit:` marker _inside_ the
`if` branch; the audit tool correctly rejected it (`catch-return-sentinel` +
`orphaned-suppression`, agent-sdk 6 vs baseline 4). The marker was moved to the top of the
catch body (Zone 2 per `tools/degradation-audit/check-degradation.ts:39-41`), after which the
audit returned to baseline. Directories in `libs/frontend/*` and `apps/*` that sit below their
baselines in the audit output were already below baseline before this change — not touched by
this fix (they belong to the concurrent frontend lane / pre-existing state).

## Platform evidence summary

- Windows (this machine, spec scenario reproduced with `fs` directly): `mkdir(recursive)` →
  throws ENOTDIR; `rm(force)` on a temp path under the file → **silent** (ENOENT swallowed).
- Linux (CI): same scenario → `rm(force)` throws **ENOTDIR** (not suppressed by `force`),
  which produced the 2 extra warns. Both behaviours now converge to 1 warn.
