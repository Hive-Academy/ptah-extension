# Batch 2 fix A — runtime and process

Implemented the assigned P2 runtime/process review fixes. Only the six assigned source/spec files were edited; this report is the sole task-folder deliverable. No git, install, build, real Codex binary, or workspace-wide verification was run.

## Findings and regression evidence

All source paths below are relative to `libs/backend/codex-runtime/src/lib/`.

| Finding | Change | Spec |
| --- | --- | --- |
| S2, recoverable RPC rejection | `codex-app-server-process.ts:54,321` introduces a typed sanitized rejection with operation, RPC code, retryability and a stale-turn classification. `codex-runtime.ts:529,560,599,660` propagates these without closing; rejected start restores idle, rejected interrupt restores running if still active. Internal steer/abort callbacks also distinguish rejection from failure. Transport/protocol errors still close. | `codex-runtime.spec.ts:431` covers all four rejected mutations and subsequent successful turns; `codex-app-server-process.spec.ts:372` verifies stale-turn classification and secret removal. |
| S5, eager events | `codex-runtime.ts:304` registers on events() call and returns an explicit iterator. Abort, return, and context close release registration/listeners even before the first next(). | `codex-runtime.spec.ts:472` emits a complete turn and closes before iteration, then receives exactly one terminal. |
| Approval during interrupt | `codex-runtime.ts:199` admits interrupting-state requests into the existing bridge with the already-aborted turn signal, producing cancel without presenting UI. | `codex-runtime.spec.ts:459` checks cancel, no sink call, and open stdin. Existing decline-before-steer and abort tests pass. |
| Unknown server request | `codex-app-server-process.ts:279` validates a bounded JSON envelope and replies -32601 with constant text for unsupported server methods. Known outbound request direction errors still fail closed; pending approval ID collisions remain fatal. | `codex-app-server-process.spec.ts:361` checks reply and a successful subsequent RPC. |
| Bounded interruption/compaction | `codex-runtime.ts:583,644` applies 30-second completion watchdogs. Expiry closes the context, releases the serialized queue, and emits the existing single failed terminal for an unfinished active turn. Timers clear on completion, rejection or close. | `codex-runtime.spec.ts:507` covers acknowledged interruption and compaction without completion; existing coalescing/close tests pass. |
| Bounded child close | `codex-app-server-process.ts:409,434` forces SIGKILL after the existing one-second grace and releases listeners/resolves even if no close event arrives. Resolution does not assert that the OS confirmed exit. | `codex-app-server-process.spec.ts:527` verifies idempotence, one kill, and settled close without a stdio-close event. |
| Slow subscriber | `codex-runtime.ts:350` replaces only the overflowing subscriber's buffer with a sanitized codexSubscriberOverflow event, detaches it, and continues delivery to remaining subscribers. Context remains usable. | `codex-runtime.spec.ts:484` exceeds 1024 events, reads overflow and end, then successfully starts another turn. |
| Home verification | `codex-runtime.ts:240` rejects missing or unequal verified home; `:119` preserves CodexHomeMismatchError through open cleanup. | `codex-runtime.spec.ts:246` covers undefined and wrong verified homes and confirms no persisted identity. |
| Style 3 | `codex-protocol-manifest.ts:19` uses Pick<CodexExecutableManifestRow, ...>; removes CodexProtocolManifest and dead binaryPath. Existing process call at `codex-app-server-process.ts:122` already passes the correct row and needs no adapter. | `codex-protocol-manifest.spec.ts:33` and the other 12 manifest cases pass with portable identity fields. |

The two owned fixtures were also aligned with lane B's removal of the unused experimentalApi profile field. The wire initialize capability remains true.

## Verification

Commands used PowerShell Select-Object/Select-String equivalents of the requested tail/grep filters. Logs were retained in the OS temporary directory to inspect failures without rerunning to obtain output.

- Prettier: all six assigned files formatted, exit 0; the final spec formatting uses a named iterable to avoid no-unexpected-multiline.
- Assigned Jest command with `--coverage=false --maxWorkers=2`: exit 0; **3 suites, 74 tests passed**, 0 snapshots, 10.942 seconds. Initial run had two fixture compile failures after the parallel profile-field removal; those owned fixtures were updated. Node's jest.config.ts ES-module-loading warning did not prevent execution.
- Initial scoped ptah diagnostics: unavailable; compiler still running after 45 seconds, three files unchecked. This is not a clean diagnostic result.
- Initial Nx checks caught no-unexpected-multiline in the new overflow spec; corrected by naming the iterable. Final result recorded below.
- Initial degradation audit found one orphaned pre-existing suppression marker in the edited interrupt catch. Removed the obsolete marker. Final result recorded below.

## Decisions

1. **Typed, sanitized RPC errors instead of forwarding remote messages.** Options: expose arbitrary server text, generic rejection, or allowlisted stale-turn classification plus operation/RPC code. Chose the latter using the validated error envelope in the process and the existing runtime failure boundary. Avoids leaking raw payloads while distinguishing turn-end races. Reversible without changing the request wire format.
2. **Thirty-second completion watchdogs; one-second process close ceiling.** Options: unbounded waits, new public settings, or reuse existing transport deadline/grace values. Existing process ordinary RPC timeout is 30 seconds and kill grace is one second. Use those values without adding configuration. Reversible constants; uncertain terminal state remains fail-closed.
3. **Detach an overflowing subscriber rather than drop arbitrary deltas.** Options: coalesce text, silently drop events, close context, or end just that subscriber with a coded error. The existing event contract supports error events and bounded queues. Chosen behavior preserves process health and explicitly tells that consumer its stream is incomplete. Reversible local iterator policy.
4. **Keep unknown-request handling in the process.** The validator belongs to lane C; a local strict envelope validation permits a method-not-found response without weakening known-method payload checks. The existing error-envelope writer validates against a known response method because error payload shape is method-independent. Reversible internal implementation; no new public contract.
5. **Do not attach raw error causes to public sanitized errors.** The runtime's existing security boundary deliberately strips server/transport payloads. Preserve that boundary despite preserve-caught-error lint warnings. Reversible only with an independently sanitized cause representation.

## Final verification results

- `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static`: **exit 0**, both targets successful; **0 errors, 7 warnings**. Four warnings concern deliberately omitted raw error causes in runtime; three are in the existing evidence harness. No out-of-ownership files were changed to address warnings.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`, filtered by `codex-runtime|TOTAL`: **exit 0**, **no codex-runtime FAIL**, TOTAL 276 unsuppressed sites across the repository under its existing ratchet.
- Final scoped `ptah_get_diagnostics`: TypeScript compiler, **clean coverage, 0 errors, 0 warnings**, no sibling diagnostics.
- All requested verification completed. The final changes after the passing Jest run were formatting of the test iterator into a named variable and removal of the orphaned audit comment; no runtime behavior changed.

## Follow-up: approval bridge integration

- Rechecked the two reported gate sites: `codex-runtime.spec.ts:486` already assigns `context.events(...)` to `events` before accessing Symbol.asyncIterator; the obsolete interrupt suppression is already deleted. The only remaining runtime degradation marker explains admission-queue recovery.
- `codex-approval-bridge.ts:203` now passes `request.details` as the fourth argument to codexPermissionPolicy, after the rule-hit argument. No policy logic was duplicated in the bridge.
- Added integration coverage in `codex-approval-bridge.spec.ts:123` for plain auto-edit file change accepting without a sink prompt; `:131` for grantRoot prompting and honoring a sink decline; `:149` for ask remaining interactive both with and without grantRoot (four new test cases).
- The first integration run exposed a separate policy allowlist omission: protocol approvalIds requires startedAtMs, but lane B's policy treated that field as unknown widening. Reported the evidence to the coordinating session; the owning lane added startedAtMs to the allowlist. This lane did not edit codex-permission-policy.ts.
- First four-suite Jest run: exit 1, 117 passed / 1 failed (plain auto-edit unexpectedly prompted because of that policy omission). Final post-policy-fix results follow below.
- Prettier on both bridge files: exit 0. Scoped ptah_get_diagnostics for bridge source and spec: clean TypeScript compiler coverage, 0 errors, 0 warnings.

### Follow-up decision

Pass the complete validated request details unchanged into the existing policy. Alternatives were stripping timestamp metadata in the bridge or duplicating auto-edit routing there. The validator requires startedAtMs and the policy owns its safe-field allowlist, so the omission was resolved in the owning lane instead. This preserves a single policy decision point and keeps scope-widening fields visible. Reversible one-argument bridge change.

### Follow-up final verification

- Four requested Jest specs, `--coverage=false --maxWorkers=2`: **exit 0; 4 suites, 118 tests passed**, 0 snapshots, 12.46 seconds.
- `npx nx run-many -t test typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static`: **exit 0; all three targets successful; 703 tests passed** (project test duration 26.842 seconds); lint **0 errors, 7 warnings**. Nx ran one target at a time; project Jest inherited the repository preset's maxWorkers 50% cap.
- The full project test run emitted a worker force-exit/possible teardown-leak warning, plus the existing jest.config.ts ES-module-loading warning. Tests and targets passed; no extra diagnostic test run was added outside the requested verification. The four directly requested suites did not report the worker force-exit warning.
- Final degradation audit (`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`, filtered by `codex-runtime|TOTAL`): **exit 0; no codex-runtime findings or FAIL; TOTAL 276 unsuppressed sites** under the existing repository ratchet.
- Follow-up complete. Additional files written: `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/src/lib/codex-approval-bridge.ts` and `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/src/lib/codex-approval-bridge.spec.ts`; this existing report was updated. No lane-B-owned file was edited.

## Orchestrator policy-fix confirmation rerun

Confirmed `codex-permission-policy.ts:33` includes startedAtMs before running the requested verification again. No source files were edited in this confirmation turn, including the policy.

- Four requested Jest specs including bridge integration: **exit 0; 4 suites, 118 tests passed**, 0 snapshots, 9.058 seconds. Plain auto-edit fileChange accepts without prompting; grantRoot still prompts; ask remains interactive.
- Project Nx test/typecheck/lint command: **exit 0; all three targets successful; 703 tests passed; 0 lint errors and 7 warnings**. Nx output again included the previously recorded worker force-exit warning; cached target output is distinguished below where applicable.
- Nx reused matching cached outputs for test and lint (2/3 tasks); typecheck ran. The 703-test result and worker force-exit warning in this invocation are replayed from the successful prior full project run. The four-spec Jest run above executed afresh.
- Degradation audit: **exit 0; no codex-runtime findings/FAIL; TOTAL 276** under the existing ratchet. All requested verification is complete against the orchestrator's policy fix.
