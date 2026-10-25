# Batch 2i — Runtime and context

Implemented the isolated runtime/context lifecycle and fake-process regression suite. Production routing remains disabled. No entry point, DI registration, committed dependency, task state, or other lane's source was edited. No git operation or real Codex process was run.

## Files

- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/src/lib/codex-runtime.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/batch-2i-report.md`

## Composition and evidence

`CodexRuntime(options)` implements the committed runtime port. Options supply the existing process spawner, resolved executable and measured binary identity, identity store, approval sink, clock, sanitized logger, and optional dedicated question callback. One runtime owns the in-memory permission RuleStore; each context owns one process, translator, and approval bridge. Runtime `close()` closes contexts and disposes its rules; a closed runtime cannot reopen.

Repository conventions came from root CLAUDE.md and CONTRIBUTING.md; no covering nested instruction files were found. The process/spec, approval bridge/spec, protocol validator, event translator, and profile builder supply the local patterns and verified APIs. Scope follows batches.md Batch 2i and C1/C5; implementation-plan.md sections 2/5/6 are interpreted through the settled decisions and dependency reports.

## Lifecycle/state diagram

```text
runtime.open(profile, optional exact identity)
  -> reserve contextId + increment generation (never pool by home)
  -> opening: start pinned process / initialize
  -> thread/start OR thread/resume(exact threadId)
  -> await store.persist(identity)
  -> idle: expose immutable committed identity and context

idle -> startTurn (serialized RPC admission) -> running
running -> steer(expectedTurnId) -> same running turn
idle -> steer -> startTurn -> running
running -> interrupt -> interrupting
interrupting -> acknowledged RPC -> still interrupting
running/interrupting -> terminal notification -> idle

idle -> compact reservation -> thread/compact/start
  -> wait for compaction completion/terminal -> release reservation

opening/idle/running/interrupting -> failure or close -> closed
  -> invalidate approval replies and follow-up callbacks
  -> emit one failed terminal for a known unfinished turn
  -> close process and release listeners
  -> await any identity persistence already in progress
  -> markInactive(complete committed identity), retaining threadId
  -> release context registration only if it is still this context
```

Failed persistence never adopts an orphan identity. A process exit during persistence waits for that result and marks the identity inactive only if the commit succeeded. Explicit resume requires context/home/provider/workspace/fingerprint equality and the exact returned threadId. Old active metadata is not used as proof of liveness. There is no automatic restart, turn retry, proxy fallback, or home-level pool.

## Ordering and implementation references

All source references below are relative to `libs/backend/codex-runtime/src/lib/`, after Prettier.

- Runtime admission, generation reservation, resume validation and release: `codex-runtime.ts:61`.
- Child lifecycle observation and approval composition: `codex-runtime.ts:161`. The process has no public lifecycle callback, so the existing spawner is wrapped to observe exit/close/error and stdin finish. Internal framing failures also close the context.
- Approval handler returns only `result.response`. An edited reply schedules the textual follow-up with `setImmediate`; the committed process's promise continuation writes the decline before that check-phase callback can invoke steer. The process remains the sole writer. Close cancels those callbacks. This ordering is exercised against the real process/validator with fake stdio.
- Initialize/home check, thread creation/resume and persistence-before-exposure: `codex-runtime.ts:224`. The in-flight 2j getter was present; runtime reads `verifiedCodexHome` through a narrow property-presence check and rejects a reported mismatch. It does not modify 2j or infer a verified home from unrelated process state.
- Event subscription, bounded per-subscriber queues and abort cleanup: `codex-runtime.ts:294`; validated notification translation, item attribution, terminal suppression and turn cleanup: `codex-runtime.ts:329`.
- Serialized operation admission: `codex-runtime.ts:391`; startTurn: `codex-runtime.ts:410`; pinned turn request/receipt handling: `codex-runtime.ts:444`.
- Steer: `codex-runtime.ts:491`. Running turns use `turn/steer` with the current `expectedTurnId`; idle contexts start a new turn. Interrupting contexts cannot steer or start a second turn. A failed/ambiguous steer closes the context without retrying.
- Interrupt: `codex-runtime.ts:532`. Aborts pending turn approval presentations before sending `turn/interrupt`. RPC acknowledgement alone does not free turn admission; a terminal notification does. Uncertain interruption closes the context and returns false. One bridge remains valid for the generation, so a later turn can still ask approvals.
- Revisioned next-turn settings: `codex-runtime.ts:553`. Model/effort changes are staged and reported as `nextTurn`; steer retains the current turn revision. Explicit undefined clears effort, while undefined model preserves the existing model. No effort aliases are invented.
- Compaction: `codex-runtime.ts:583`. Coalesces concurrent requests, uses the pinned `{threadId}` shape, holds serialized admission until completion, and releases on error/disposal.
- Close/terminal failure/inactive persistence: `codex-runtime.ts:613` and `codex-runtime.ts:646`.

## Failure behavior and integration limits

- Crash, malformed protocol traffic, ambiguous mutating RPC failure and explicit close terminate a known unfinished turn with one safe terminal failure. A terminal-before-response turn is not resurrected, and terminal-before-exit does not produce a second terminal.
- Late approval replies cannot authorize a new turn/generation. Missing presentation fails before execution; missing question presentation follows the existing bridge's empty-answer behavior. Unsupported edited-input semantics never become a modified command.
- Persist failures and operation errors expose fixed messages, not raw server/storage errors. Failure to mark an already committed identity inactive emits a fixed logger message; store consumers must continue treating active metadata as non-authoritative.
- Permission-level changes are explicitly rejected pending verified safe reconfiguration. They do not report immediate or staged permission success while retaining a different policy. Existing-level patches and model/effort staging are supported. This remains a permission-transition parity limitation, per plan section 5.
- Profiles requiring MCP secret resolution, lane suppressed-tool enforcement, lane budgets/turn limits or explicit lane full access are rejected before spawn. These contracts have no implemented enforcement/resolution boundary here; accepting and silently dropping them would be incorrect. This is not a new capability claim or removal of an enabled route. Profile-input/native parity remains gated by C10.
- System/developer instructions, instruction-source content and output-style text are mapped to pinned thread instruction fields. Initial enhanced prompt context and attachments accompany the first user turn only; subsequent steer does not repeat them. Files use the pinned mention input shape; images use data URLs. These are schema-level mappings, not new live native evidence.
- File/MCP remembered-rule attribution uses only validated current-turn item notifications. Unattributed requests remain interactive; no tool is inferred from elicitation prose.
- The process currently inherits `{...process.env, CODEX_HOME}`. Batch 2i does not construct or change that environment. A future 2d fix should accept an explicit sanitized child environment from 2k composition: allowlist only required platform launch variables and individually authorized MCP environment values, then force the selected CODEX_HOME. Do not copy the whole host environment or resolve arbitrary opaque references here. This P2 review item remains open outside 2i.
- No exports/host wiring were added. 2k must compose the options and retain the disabled rollout gates. Compaction wire shape is implemented; live native compaction parity is not claimed.

## Specs

20 passing cases in `codex-runtime.spec.ts` exercise the actual process, validator, bridge and translator with fake stdio:

1. Same-home chat/chat isolation.
2. Same-home chat/lane isolation.
3. Identity commit before exposure; duplicate context admission.
4. Persistence orphan closure and fresh subsequent thread/generation.
5. Inactive identity retention and exact explicit resume.
6. Serialized start/steer admission, expectedTurnId, and idle steer starting a new turn.
7. Edit decline written before follow-up steer; no modified command response.
8. Interrupt acknowledgement blocks admission until terminal; later approvals still work.
9. Failed interrupt closes the context and never retries turn/start.
10. Crash terminal and rejection of a late approval grant.
11. Terminal-before-reply and terminal-before-exit deduplication.
12. Revisioned model/effort staging, effort clearing, invalid settings and unsupported permission transition.
13. Compaction coalescing and admission reservation until completion.
14. Compaction reservation release on close.
15. Event subscription abort and input cancellation via interrupt.
16. Malformed protocol traffic while no RPC is pending.
17. Process exit during identity persistence.
18. Unsupported lane configuration rejected before spawn.
19. Valid pinned handshake fixtures.
20. Undefined model preservation and one-time enhanced prompt/attachment mapping.

After each case, child lifecycle/stdout/stdin listener cleanup is asserted. No real binary, live account, build or e2e was used.

## Exact verification results

PowerShell equivalents of the requested tail/grep filters were used, retaining native exit codes.

1. `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20; exit $LASTEXITCODE`
   - Final exit **0**: **1 suite passed; 20 tests passed; 0 snapshots; 8.213 s**.
   - Existing Node warning about loading the TypeScript Jest config as an ES module remained non-fatal.
   - Earlier runs exposed mock callback typing, an async state-narrowing error, and explicit undefined fields rejected by JSON frame validation. All were fixed. The penultimate run passed 19 cases; the final run includes the added model/input regression.
2. `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Select-String 'problems|Successfully|Failed| error ' | Select-Object -Last 10; exit $LASTEXITCODE`
   - Final exit **0**: `NX Successfully ran targets typecheck, lint for project @ptah-extension/codex-runtime`.
   - **4 problems (0 errors, 4 warnings)**. Filtered output included `1737:7 warning There is no cause attached to the symptom error being thrown preserve-caught-error`. No unrelated warning fixes were attempted.
3. `npx prettier --write libs/backend/codex-runtime/src/lib/codex-runtime.ts libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`
   - Exit **0**, both files formatted after the final Jest/Nx checks. Only the comment-only degradation-audit follow-up below changed source afterward.
4. Required scoped `ptah_get_diagnostics` after the final behavior/spec edits:
   - TypeScript compiler; **0 errors, 0 warnings; clean coverage** for both files.
   - Initial invocation was unavailable because its compiler check exceeded 45 seconds; the later completed scoped result above is authoritative.
5. Post-format AST inspection: parseStatus **ok**, errorNodeCount **0**, clean coverage.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Observe the child through the existing spawner | Modify committed process; wrap the existing spawner | 2d exposes request/start/close but no exit callback; scope prohibits editing it | Yes, replace observation when a lifecycle hook exists |
| Defer edited-text follow-up to the check phase | Send within bridge callback; add transport writer; defer | 2g returns response metadata; process dispatchApproval writes in a promise continuation. Fake-wire ordering test proves decline precedes steer | Yes, use an explicit post-write hook if later added |
| Keep interrupt admission blocked until terminal | Trust interrupt RPC ack; await terminal state | Plan requires uncertainty to block a second turn; validator models terminal notifications | Yes, only with stronger protocol evidence |
| Reject unsupported permission reconfiguration | Pretend applied; stage incompatible policy; fail explicitly | Plan section 5 explicitly allows unsupported transitions to fail and remain parity blockers | Yes, when safe transition is verified |
| Reject unenforceable MCP/lane configurations before spawn | Silently ignore; invent secret/enforcement APIs; fail | Committed ports provide no secret resolver or lane budget/tool enforcement contract; C10 keeps profile parity evidence-gated | Yes, when owned boundaries land |
| Include enhanced prompt and profile attachments only in the initial local turn | Drop profile input; resend on every steer; include once | Profile preserves enhancedPrompt/attachments; turn input and steer are separate contracts | Yes, schema mapping is local |
| Keep only next-turn claims for model/effort updates | Claim effectiveNow; report nextTurn | Updates take effect in the next acknowledged turn/start; in-flight steer uses the old revision | Yes |
| Do not change child environment construction | Edit 2d; override env in wrapper; document future allowlist boundary | User explicitly assigns the inherited-env P2 issue to 2k/2d-fix | Yes, at that authorized boundary |

## Degradation-audit follow-up

Added two accepted `degradation-audit: reported` comments in `codex-runtime.ts`; no runtime behavior or baseline changed:

- Serialized admission returns the original rejected operation promise to its caller. Only the internal queue tail recovers so later admission remains possible. The annotation documents existing propagation rather than swallowing an unreported caller error.
- Interrupt failure calls `onFailure()`, closes the context and emits a terminal error for an unfinished turn before returning false. The annotation documents that existing terminal reporting path.

Verification command (PowerShell filter equivalent):

```powershell
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String 'codex-runtime:|TOTAL'; exit $LASTEXITCODE
```

Exit **0**. Exact filtered output:

```text
degradation-audit: per-directory totals
degradation-audit: TOTAL 276 unsuppressed site(s)
```

**codex-runtime: 0 unsuppressed sites; baseline remains 0.** The checker prints directories appearing in either violation counts or explicit baseline entries. codex-runtime has neither, so its zero row is omitted; absent baseline entries default to zero. The 276 total comprises other directories. No baseline was raised or edited.

Scoped `ptah_get_diagnostics` after these comments: TypeScript compiler **0 errors, 0 warnings**, clean coverage. `npx prettier --write libs/backend/codex-runtime/src/lib/codex-runtime.ts`: exit **0**, unchanged. Jest and Nx results above remain the last behavior verification; no behavioral tests were repeated for comments alone. The spec file was unchanged in this follow-up.

Decision: use the audit's accepted `reported` annotations for already-propagated/reported failures rather than duplicate logging or change the queue/interrupt contracts. Evidence is the returned original promise and the existing terminal failure path, covered by the runtime specs. This local documentation choice is reversible.

No verification remains pending. The integration limitations above are not live native parity evidence and must remain gated.
