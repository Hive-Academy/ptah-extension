# Init-order logic/security re-review — D70

**Score: 8/10. Verdict: APPROVED for the scoped F1/F2 fixes.**

Blocking: **0**. Serious: **0**. Moderate: **0**. Minor defects: **0**. New demonstrated failure modes: **0**.

Compared `bugfix-init-order.diff` with `bugfix-init-order-r2.diff`, traced the current helper and both admission implementations, and inspected the changed test fixtures and D70 report. This verdict does not approve the whole named-accounts branch. The previous two blocking defects are closed at the reviewed application boundary. The remaining integration/test uncertainty below prevents a 9–10 score; no demonstrated logic gap warrants the 5–6 band.

Paths used below:

- **Gate:** `libs/backend/agent-sdk/src/lib/helpers/named-account-prompt-gate.ts`
- **Main:** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- **Lane:** `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`
- **Main spec:** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
- **Lane spec:** `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`

## F1 — closed, with an ordering clarification

Both paths install the shared all-tools `PreToolUse` matcher (Gate:61; Main:842; Lane:774). Before verified init their admission predicates return false; afterward they await admission, then check disposal/abort (Main:831; Lane:767). Main admits only after binding, attachment, metadata and the final identity read (Main:869, Main:880, Main:883). Lane similarly waits through persistence and its binding callback before release (Lane:815, Lane:855, Lane:866, Lane:870). Thus bypass mode and allow rules no longer depend on invoking `canUseTool` for this boundary.

**Caller hooks can execute concurrently with ours, including completing before it.** Prepending is registration order, not a side-effect barrier. However, a caller's `allow` cannot override our `deny`: Claude's documented merge chooses the most restrictive decision. Returning `{}` after admission supplies no permission grant and preserves the existing permission flow. These conclusions use the [official hook execution and decision rules](https://code.claude.com/docs/en/hooks#pretooluse-decision-control), together with Gate:48 and Gate:63. No requirement to suppress arbitrary caller-hook side effects is implemented or claimed by this approval.

Refusal/abort/disposal settles the main decision false synchronously (Main:900, Main:926); lane disposal aborts and wakes its launch promise (Lane:758, Lane:948). A hook's own cancellation also returns deny (Gate:25, Gate:49). The 600-second hook timeout exceeds the bounded post-init chain: at the production 15-second per-await deadlines, main has at most five sequential waits and lane seven after verified init (Main:703, Main:869; Lane:494, Lane:815). Dependency timeout therefore aborts admission before the hook timeout under these production defaults.

Gate:28 does not remove the losing abort listener when admission wins. This is not a demonstrated accumulating session leak: the installed SDK creates a controller per control request and deletes it in `finally` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:127`, `handleControlRequest`). The listener and unresolved loser become collectible with that request. Explicit `finally` removal would improve helper reuse with shared signals, but is not required to close F1 in these paths.

## F2 — closed

Disposal first marks the flow terminal and resolves admission false, then closes gates/child and aborts pending waits (Main:926). The wait's post-resolution check rejects late storage/identity success (Main:725); the final check prevents committing the prompt gate or returning a proxy after such disposal (Main:882). Later-turn identity refusal takes the same terminal path (Main:840). Already-completed storage can remain bound, but cannot reopen the flow.

The natural-exit exception is correctly limited to an already-admitted child: the termination continuation is installed after `settleAdmission(true)` and `gate.commit()` (Main:883–885). Before admission, `childEnded` remains false and disposal must abort. Explicit disposal of a running child also aborts synchronously before the termination promise's continuation can set that flag. After an observed post-admission exit, leaving the controller alone preserves normal stream completion; `disposed` still denies tools and closes input (Main:831, Main:928, Main:932). This flag signifies observed termination, not proof of exit code zero.

## Original invariant cross-check

F1/F2 and invariants 1–7 below refer specifically to `code-logic-review-init-order.md`, including its **Data flow and invariant assessment** table. Rechecking those definitions does not change this scoped verdict.

| Original invariant | D70 assessment and current evidence |
| --- | --- |
| 1. Same-child identity proof before any user message | Preserved: proof precedes first-turn release (Main:844–846; Lane:776–784). |
| 2. Later turns held until admission and revalidated | Preserved: main waits for commit before later pulls (Main:663); lane retains exact-object first-turn exemption and subsequent validation (Lane:724). |
| 3. Tool admission and terminal denial | F1/F2 closed at the reviewed boundary by the all-tools hook and terminal predicates (Gate:48–61; Main:831, Main:926; Lane:767, Lane:948); caller-hook concurrency caveat above applies. |
| 4. No output before admission | Preserved: buffering precedes proxy publication; terminal checks prevent late publication after disposal (Main:853, Main:882–889; Lane:795, Lane:869–873). |
| 5. No binding before verified init | Preserved: init validation precedes binding (Main:855–869; Lane:801–815). Existing reservation/lease settlement is retained; this is not a broader audit of that policy. |
| 6. First message exactly once | Preserved: main releases the same source stream once; lane queues and commits the first object once (Main:649, Main:846; Lane:782–784). |
| 7. Fixed refusal fields; no secret-bearing logs | No new violation found: hook denial uses fixed text and main launch failures retain the fixed refusal path (Gate:8–17; Main:900–902). No new swallowed-error catch was introduced by D70. |

## Five logic questions

1. **Silent failure?** No new success-looking refusal found: main settles false before cleanup and rejects late success (Main:725, Main:926); lane checks terminal state before publishing its query (Lane:869).
2. **Unexpected user action?** YOLO/allowed-tool execution now encounters the hook gate. Caller-hook side effects are not ordered by its array position (Gate:61); do not interpret the test title as proving otherwise.
3. **Wrong-answer input?** D70 does not widen identity/init acceptance. Main still validates version/key source before binding (Main:855); lane does likewise (Lane:801). The lane's first-turn exemption remains keyed to the exact message object (Lane:724).
4. **Dependency failure/timeout?** Admission waits abort on deadline, terminal predicates deny held tools, and failure cannot publish the query (Main:722, Main:899; Lane:525, Lane:948). Hook cancellation independently denies (Gate:49).
5. **Missing requirement/evidence?** Real CLI dispatch, conflicting caller decisions, and the post-admission natural-exit exception need stronger executable evidence; current tests principally invoke callbacks directly (Main spec:326; Lane spec:1138).

## Verification limits and report claims

The new disposal test actually holds both permission paths during the last identity read, disposes, then releases that read and asserts refusal/no later turn (Main spec:370). Hook hold/abort cases exercise the intended state transitions (Main spec:338, Main spec:356; Lane spec:1169, Lane spec:1190). Pending-proof tests now establish zero prompts before proof (Main spec:303; Lane spec:1142). No D70 regression to prompt cardinality, output buffering, binding order or fixed refusal text was identified (Main:846, Main:853, Main:887; Lane:782, Lane:795; Gate:8).

The report's “ahead of caller hooks” wording should be read only as array placement. Its tests do not dispatch both hooks or prove execution order (Main spec:323; Lane spec:1161). Recommended follow-up evidence: real CLI auto-approval with a conflicting caller `allow`; held-hook deadline/storage rejection; disposal during metadata persistence; and an observed child exit after admission with final output still drained. These are coverage limitations, not additional demonstrated defects.

No builds, tests, npm/nx commands, git operations, credential access or source edits were performed. Reported passing suites remain author-supplied evidence. Scoped `ptah_get_diagnostics` returned **Unavailable**, with all three production files unchecked because its TypeScript check exceeded 45 seconds; it supplied no clean diagnostic result. Symbol search returned an empty index, so native text search supplied the references.

## Decisions

Accept D70's shared hook and `{}` after admission rather than an affirmative `allow`; Gate:48 preserves the existing permission policy. Treat callback-order wording as a verification qualification, not a tool-gate bypass, because documented deny precedence still enforces the boundary. Both choices are reversible; no user decision or source change was needed.
