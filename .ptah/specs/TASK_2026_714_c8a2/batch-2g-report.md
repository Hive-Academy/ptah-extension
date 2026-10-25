# Batch 2g — Approval bridge

Implemented the bridge and its focused specs. Production routing remains disabled; no registrations, exports, committed dependency files, or execution-profile files were changed. No git commands were run.

## Files

- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/src/lib/codex-approval-bridge.ts`
- `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/libs/backend/codex-runtime/src/lib/codex-approval-bridge.spec.ts`
- This report: `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/batch-2g-report.md`

## Request-kind → response

References below are relative to `libs/backend/codex-runtime/src/lib/`.

| Server request | Validated response | Implementation |
| --- | --- | --- |
| `item/commandExecution/requestApproval` | `{ decision: accept | acceptForSession | decline | cancel }` | `codex-approval-bridge.ts:347` |
| `item/fileChange/requestApproval` | Same four decisions; no modified command or patch is sent | `codex-approval-bridge.ts:348` |
| `item/permissions/requestApproval` | Accept grants exactly requested permissions with `scope: turn`; acceptForSession uses `scope: session`; refusal returns `{ permissions: {}, scope: turn }` | `codex-approval-bridge.ts:350` |
| `mcpServer/elicitation/request` | Accept returns `{ action: accept, content }` only for satisfiable forms; otherwise `{ action: decline }`. Cancel returns `{ action: cancel }`. No `_meta.persist` | `codex-approval-bridge.ts:355`; form filling at `:70` |
| `item/tool/requestUserInput` | `{ answers: { [questionId]: { answers: string[] } } }`, filtered to requested IDs; unavailable/failed/aborted interaction returns empty answers | `codex-approval-bridge.ts:361` |

All inbound frames use the committed validator. Every returned wire response passes `validateCodexResult`. The bridge imports the committed permission policy and RuleStore rather than reproducing their logic.

## Lifecycle and integration

`handle(frame, turnId, signal)` returns `{ response, editNotSupported?, followUpMessage? }`. Batch 2i must return **only** `response` from `CodexAppServerHandlers.onRequest`. The committed process remains the sole wire writer and retains its 128-pending-request cap. The consumer must deliver the decline response before sending a follow-up through steer; this batch does not send turns or execute commands.

Create one bridge per process generation, supplying its thread identity, current-correlation predicate, writability predicate, close callback, Clock, ApprovalSink, and runtime-owned RuleStore. Correlation includes context, generation, thread, turn, and typed request ID (`:144`). The seen-key set survives request completion and is cleared when that generation's bridge is disposed. Duplicate calls reject without a second sink presentation or wire response (`:175`); the existing process also rejects duplicate pending wire IDs.

Stale thread/turn/generation replies never authorize anything or record a rule. Null/absent elicitation turn IDs are associated with the caller's nonempty current turn, matching the observed wire evidence. An external abort cancels approvals; disposal and the default 240-second timeout decline. The timeout precedes the process's 300-second approval timeout. Sink rejection declines without propagating its potentially sensitive message. All settlement paths dispose the timer, remove the abort listener, abort presentation, and ignore late sink results (`:295`, `:380`). Unwritable transport invokes close and throws a fixed, payload-free error (`:241`), leaving no default acceptance.

Edited replies are declined and return `editNotSupported` (`:207`). If an adapter provides string text in `followUpMessage`, `editedInput`, `modifiedInput`, or `updatedInput`, that text is returned only as `followUpMessage`. The committed ApprovalSink's edit marker itself contains no text: in that case the consumer retains its original user text and receives the marker, rather than fabricated text. Neither original nor replacement command is authorized by an edit reply.

Rules are recorded only for a live, validated acceptForSession grant (`:252`). Commands require exact command/cwd and exclude stdin/network approval variants. File paths and MCP server/tool attribution must come from the supplied resolver of validated item evidence (`:45`, `:271`); grantRoot, arbitrary elicitation prose, and unknown targets never manufacture a reusable rule. Permissions and questions have no reusable RuleStore target. Unsupported MCP forms do not record a grant. Plan mode is checked again before returning an authorization.

Questions use the separate optional `requestUserInput` interaction (`:49`), because the committed ApprovalSink returns decisions, not answer maps. No approval choice is coerced into a question answer. This boundary still needs composition by batch 2i; an absent handler returns no invented answers.

## Spec list

40 passing cases in `codex-approval-bridge.spec.ts` cover:

- All four command/file decisions and full correlation, including numeric versus string IDs.
- Duplicate pending/completed requests, mismatched thread/turn, and late stale-generation grants.
- Timeout, presentation abort, disposal, process-close/writability failure, pre-aborted requests, and sink failure.
- Edited reply refusal/text handoff and the committed text-free edit marker.
- Exact command/cwd session reuse across process generations, provider isolation, accept-once behavior, and plan-mode refusal.
- All four permissions outcomes and exclusion from remembered command grants.
- MCP decline/cancel; required booleans, recognized enum values, defaults, and null turn ID.
- Unfillable, missing, constrained, or invalid-default required fields; URL elicitation refusal.
- Explicit MCP attribution and file-path attribution; no inference from prose or grantRoot.
- Dedicated question routing, answer-ID filtering, missing interaction, and late answers after cancellation.
- Permission-mode change while awaiting approval; no command-rule reuse for stdin/network variants.
- No remembered grant for an unsatisfiable MCP form; malformed input rejection before presentation.

These are deterministic unit tests against the committed protocol validator. No new live native side-effect experiment was run or claimed. Reviewed evidence includes `evidence-harness.ts:1177` and `:1535`, spike runs 6i/6j, and the task's T3 approval research.

## Verification

Executed in the assigned Windows worktree. PowerShell `Select-Object -Last` and `Select-String` replace the requested `tail`/`grep`; each command explicitly exits with `$LASTEXITCODE` so filtering cannot hide failure.

1. `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-approval-bridge.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20; exit $LASTEXITCODE`
   - Final exit **0**. **1 suite passed; 40 tests passed; 0 snapshots; 7.617 s**.
   - Node emitted an ES-module-loading warning for the existing Jest configuration; the suite completed successfully.
   - Earlier run passed 36 tests; the final run followed four additional boundary cases.
2. `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Select-String 'problems|Successfully|Failed| error ' | Select-Object -Last 10; exit $LASTEXITCODE`
   - Final exit **0**. `NX Successfully ran targets typecheck, lint for project @ptah-extension/codex-runtime`.
   - Lint reported **4 problems (0 errors, 4 warnings)**. Filtered output included the `preserve-caught-error` warning at 1737:7. No warning suppression or out-of-scope fix was made.
   - Initial project run also passed; repeated after the additional specs.
3. `npx prettier --write libs/backend/codex-runtime/src/lib/codex-approval-bridge.ts libs/backend/codex-runtime/src/lib/codex-approval-bridge.spec.ts`
   - Final exit **0**. Source unchanged; spec formatted. This was the final source-file operation, as requested.
4. Scoped `ptah_get_diagnostics` on both files after implementation/spec edits:
   - Final **0 errors, 0 warnings**, clean coverage.
   - An earlier scoped invocation reported a JSON-module-resolution diagnostic in the existing protocol validator; final diagnostics and both authoritative project checks passed. Initial mock-typing errors in the new tests were fixed before successful verification.

## Decisions

- **Keep transport ownership in the committed process.** Options: return a validated response envelope to the runtime, or introduce another writer. Chose the former because `CodexAppServerHandlers.onRequest` returns the result that `dispatchApproval` writes exactly once. Reversible at the bridge boundary; no process modifications.
- **Keep edits as refusal plus follow-up metadata.** Options: execute replacement, invent text for the marker, or decline and retain supplied text. Chose decline plus supplied string text, following C1 and runs 6i/6j. No native edited-input parity is claimed. The result adapter is reversible; refusal is the settled requirement.
- **Use a separate optional question callback.** Options: coerce decisions into answers, change the committed ApprovalSink, or expose dedicated interaction locally. Chose local dedicated interaction because the shared contract has no answer map and plan section 6 requires questions to remain independent. Reversible when batch 2i composes the interaction.
- **Require explicit item attribution for file/MCP reuse.** Options: infer broad grants from descriptions/grantRoot, or require exact validated evidence. Chose exact evidence, as required by the 2f RuleStore target contract. Without it, requests still prompt and do not create rules. Reversible through the resolver; scope semantics remain subject to the later native parity gate.
- **Support only safely fillable standard MCP forms.** Options: guess values/constraints, or decline unsupported required fields and modes. Chose conservative filling of validated defaults/recognized enums and evidenced required booleans; no persistence metadata, per C4. Reversible through added proven schema support.
- **Decline on timeout before the process deadline.** Options: wait for the process's 300-second failure or settle locally earlier. Chose 240 seconds by default with Clock cleanup so the live process can transmit a refusal. Reversible via the validated timeout option.

## Remaining integration boundary

No assigned implementation or verification is blocked. Batch 2i still owns process-handler composition, current-turn tracking, attributed item lookup, question presentation, and sending an edited-text follow-up after the decline. Production routing and native parity gates remain outside this batch.
