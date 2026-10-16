# Code logic review — Phase B batch 8FG

## Summary

| | |
| --- | --- |
| Score | 9/10 |
| Assessment | Approved. The diff closes the re-review Serious (in-flight confirm after page exit) and the records Moderate (run key vs root key). D18 and Amendment A1 do not regress. The new `cancel()` catch is a used `reported` marker, not an empty catch. |
| New Blocking | 0 |
| New Serious | 0 |
| New Moderate | 0 |
| New Minor | 0 |
| Reviewer family | grok |
| Implementer family | codex |
| Range | ea106f685..433aab5ad |

Reviewed only `tribunal-run-coordinator.ts`, its spec, `command-center-records.ts`, and its spec, against `phase-b-8fg.diff`. Tests were not re-run (lane rule). The team-leader note of a green 2-project `test` / `typecheck` / `lint` run is accepted as the scoped check, not re-executed here.

## Re-check

| ID | Status | Evidence (file:line) | Pinning spec (file:line or "no spec") |
| --- | --- | --- | --- |
| RR-S1 | CLOSED | `tribunal-run-coordinator.ts:119-123` sets `answered` to `cancelled`, deletes it, and consumes it. No `answer` and no launch. `isCancelled` (`:249-251`, `pending.get(id) !== entry`) runs after `discoveryComplete` resolves (`:175`) and rejects (`:172`), and after `createTask` resolves, returns null, or throws (`:194`, `:197` before the null failure at `:198`). All four are before `writeManifest` (`:216`). `cancel` (`:253-261`) calls `removeManifest` once when `runId` is set, then `failure('cancelled', false)` (`:264-269`), which is `{ ok: false, reason: 'cancelled', retryable: false }` and one `reportFailure`. Message text is `:29-30`. A later `confirm` hits `:131-132` (`not-launchable`, `retryable: false`) because the id is consumed and not pending. A send that resolves `true` still `terminate`s to `launched` and returns `{ ok: true }` (`:228-234`) even though `pageExit` already dropped the id. A `false` or thrown send rolls the manifest back (`:239-243`) and returns `cancelled`, not `launch-send-failed` (`:244-246`). | `batches.md:137` (D26); detail `batches.md:1656` |
| RR-M2 | CLOSED | `command-center-records.ts:64-82`. A stored key equal to `runId` replaces a root-keyed body (`:77`, `isRunKeyed && !runKeyed.get(runId)`) and is then marked run-keyed, so a later root key cannot replace it in either enumeration order. Between two root-keyed bodies, only `startedAt > previous.startedAt` replaces (`:78`); a tie keeps the first. The winner is stored at `runs[runId]`. The next `write` persists that object (`writeRunManifest` `:142-144`, and every other writer goes through `read` then `write`). Schema `:12-21`, storage `key()` `:37-38`, and the public methods are unchanged. The `write()` catch marker is still the 8F0.2 line at `:94`. | `batches.md:138` (D27); detail `batches.md:1704` |
| D18 contract / A1 | CLOSED | No regression in this diff. Concurrent `confirm` still returns the same `inFlight` promise and clears it on settle (`tribunal-run-coordinator.ts:127-138`). Non-cancel failures keep their reasons and retryable flags: lanes `:150`, undelivered answer `:164`, discovery `:173`, post-discovery roster `:184`, task throw `:195`, task null `:198`, manifest write `:217`, send `:246`. `terminate` (`:271-278`) does not read `pending`, so a success after `pageExit` still consumes the id (`:233`). A1: the discovery answer (`:14-15`) is the fixed non-Confirm sentence; `decline` / `timeout` (`:108-112`) only `Decline` an `open` entry that is not in flight (`:280-284`); `pageExit` does not launch; a cancelled in-flight confirm returns before `writeManifest` and `sendLaunchTurn`. Nothing in the diff answers timeout or auto-resolve with a launch. | `batches.md:129` (D18); `implementation-plan.md:124` (A1) |

Catch classification (read of `tools/degradation-audit/check-degradation.ts`, not re-run). The one new site is `tribunal-run-coordinator.ts:257-259`. Its body is only `// degradation-audit: reported — cancellation is reported even if an earlier manifest cannot be removed`. `isTrulyEmpty` (`check-degradation.ts:521-524`) requires zero statements and a brace interior that trims to empty, so a comment-only body is not an `empty-catch`. The non-empty branch (`:533-549`) flags only a literal return with no throw and no `.error()` call. This catch returns no literal. Zone 2 (`:399-408`, wired at `:511-514`) is the comment run on the first line inside the brace. `parseMarkerLine` (`:365-372`) accepts `reported` with a non-empty reason, and `resolveSuppression` (`:426-427`) consumes that line, so the orphan pass (`:662-671`) does not report it. The discovery and `createTask` catches keep their marker as the first body line; the added lines return `this.cancel(entry)` / `this.failure(...)`, not literals. That matches the recorded audit exit 0.

## New issues

None.

## Verdict

- Recommendation: APPROVE. Phase B can close on this diff.
- Confidence: HIGH. Both required behaviors were traced on the current files, including `createTask` null and throw and a thrown `sendLaunchTurn`, which share the checked branches. Specs cover discovery resolve/reject, Relay resolve, retry-then-exit, send `false`, and send `true`, plus both record key orders and the newer root body. The `startedAt` tie and a `createTask` null/throw after `pageExit` are closed by reading the branches, not by a dedicated spec.
- Top risk: `removeManifest` returning `false` is still ignored on `cancel()` (`:256`) and on the failed-send rollback (`:240`). Decision D29 recorded that and kept it out of this batch. A cancelled confirm does not retry, so a false removal can leave a manifest for a run that did not launch. That is the recorded minor, not a new defect.

Verdict: APPROVED
