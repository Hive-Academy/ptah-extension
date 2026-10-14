Verdict: NEEDS_REVISION — 4/10

# Code logic review — commit 3404ddca4

## Summary

Two blocking failure schedules can make the durable pointer lie or disappear. The normal stop order is sound, but the record's visible state is not safely tied to a completed write or a final stop outcome. Score 4 reflects substantial working paths and focused tests; a 5 would require reliable recovery from these schedules, while a 3 would mean the ordinary stop path itself is broken.

## Blocking

1. **A retryable stop can lose its only durable reminder.** `subagent-budget-monitor.ts:952-969,983-994,1186-1205` keeps and publishes a pending record after `stopSubagent` rejects, then retries the same stop on a later request. Meanwhile `subagent-handoff-index.ts:47-51` and `subagent-handoff-record.ts:136-139` explicitly tell the parent to mark it `dismissed` if the subagent is still running; `subagent-handoff-index.ts:298-303` then removes it from pointers. A parent following that instruction between attempts can dismiss the record before the later stop succeeds. If the in-memory send is then lost, the completed stop has no durable prompt reminder. **Fix:** leave a running subagent's record pending while a stop can retry; only instruct dismissal after a confirmed terminal outcome, and test reject → parent prompt → later successful retry.

2. **A failed or unfinished write is discoverable as a handoff.** `subagent-handoff-record.ts:473-484` writes directly to the final `*.handoff.md` name with `wx`, then reports a write error without removing a file that was already created. `subagent-handoff-index.ts:205-221,298-307` discovers that name and lists both `pending` and malformed heads; the pointer may therefore tell a parent to continue a truncated record for a subagent that was never stopped (`subagent-budget-monitor.ts:1097-1109`). It can also scan a file while the write is in progress. **Fix:** write under a name the index ignores, finish and close it, then publish the final name exclusively and atomically; clean up owned temporary files on every failure. Add a fault test that fails after creation and a reader/write overlap test.

## Serious

3. **A stalled head read loses the promised timeout pointer.** `subagent-handoff-index.ts:251-260,285-292,310-328` awaits the first head read without a deadline; the 600 ms check happens only before later reads. At 1 s, `user-prompt-submit-hook-handler.ts:127-145` wins its outer race with `undefined`, yielding `{continue:true}` without even the directory timeout line (`:64-76`). Repeated slow reads can overlap later prompts and keep file operations alive. **Fix:** race a head visit against the remaining index deadline, return the directory timeout line when it expires, and prevent abandoned visits from moving the cursor; test a head read that never settles.

## Moderate

4. **Concurrent prompts can repeat a rotation window and miss the agreed prompt bound.** `subagent-handoff-index.ts:244-260` reads a cursor, awaits each file, and only then updates it. Three simultaneous prompts for one session can all start at the same first ten candidates, so after three prompts an eleventh pending record remains unnamed, exceeding the agreed `ceil(C/10)+1` bound when `C=11`. A late visit can also move the cursor backwards. **Fix:** serialize pointer collection per cursor key, or reserve a disjoint window before awaiting reads; test concurrent calls with a gated head read.

5. **A hook callback can put raw prompt text into logs.** `user-prompt-submit-hook-handler.ts:59,102-115` passes the user prompt to callbacks and logs an arbitrary callback exception's raw `message`. A callback that includes its input in an error exposes prompt text despite the privacy requirement. **Fix:** log only an error type and safe code, as the new pointer error branch does at `:135-142`.

## Five logic questions

1. **Silent success:** dismissal during a rejected-stop retry hides a later successful stop; a failed partial write can still be listed (`subagent-budget-monitor.ts:983-994,1186-1205`; `subagent-handoff-record.ts:477-484`; `subagent-handoff-index.ts:298-307`).
2. **Unexpected user action:** a parent follows the explicit “still running” dismissal instruction before a retry, or submits concurrent prompts that repeatedly name the same first ten files (`subagent-handoff-index.ts:47-51,244-260`).
3. **Wrong answer from input:** a final-name record containing truncated frontmatter or body is treated as pending or malformed and offered for continuation (`subagent-handoff-record.ts:149-174,477-484`; `subagent-handoff-index.ts:305-307`).
4. **Dependency failure:** a write error can leave a visible partial file; a head read that stalls suppresses the directory pointer; callback errors can leak raw messages (`subagent-handoff-record.ts:477-484`; `subagent-handoff-index.ts:285-292`; `user-prompt-submit-hook-handler.ts:109-115`).
5. **Missing requirement:** the design does not specify when an invoked but retrying stop may safely be dismissed, nor an atomic visibility point for a complete record (`subagent-budget-monitor.ts:952-969,1186-1205`; `subagent-handoff-record.ts:477-484`).

## Data flow and checks

- The normal path prepares files, writes a record, marks it invoked, calls `stopSubagent`, publishes it, then sends the handoff and writes an optional stub (`subagent-budget-monitor.ts:910-1025`). A failed handoff write skips the stop (`:1097-1109`); the accepted safety-stop exception is explicit (`:1110-1119`). After invocation, withdraw is guarded by `invoked` (`subagent-handoff-record.ts:345-375`); release forgets the writer but not the file (`subagent-budget-monitor.ts:642-659`).
- The filename includes the owner hash and strict grammar (`subagent-handoff-record.ts:51-52,94-99,110-130`); malformed frontmatter remains pointer-visible (`:149-175`; `subagent-handoff-index.ts:298-307`). The writer map shares a tool-use id across rekeyed stops (`subagent-handoff-record.ts:301-342`; `subagent-budget-monitor.ts:586-625`).
- The index rescans names after 60 s, merges publishes, visits at most ten heads, and names per-entry read failures (`subagent-handoff-index.ts:192-229,232-292`). Resolved records alone are eligible for deletion after seven days (`:298-303`); the accepted cleanup race is documented. The per-session cursor is present (`:104-105,244-260`), subject to finding 4.
- Task-folder stubs require real `.ptah`, `specs`, and target directories, a direct child of `specs`, and `wx` (`subagent-handoff-record.ts:503-537`). The host directory guard rejects links and paths outside the workspace (`:243-274`). The accepted trusted-filesystem limit remains.
- `UserPromptSubmit` excludes `agent_id` and uses the monitor even with an empty callback registry (`user-prompt-submit-hook-handler.ts:52-76,91-94`); DI registers the monitor and record/index dependencies (`di/register.ts:305-306,497-540`). A search of `libs/backend/agent-sdk/src` and `libs/shared/src` found no removed retry symbols; `notesPath` remains for the separate near-budget warning (`subagent-handoff-message.ts:36-50`).

## Verification and limits

Scoped Jest: six changed agent-sdk spec files, 156 tests passed. Scoped `ptah_get_diagnostics` reported zero errors. Existing tests cover late writes, rekeyed stops, 60 s rescan, unreadable entries, and hook gating (`subagent-budget-monitor.spec.ts:1719,1870`; `subagent-handoff-index.spec.ts:311,327,356`; `user-prompt-submit-hook-handler.spec.ts:207-267`). They do not exercise the failure schedules in findings 1–4. No build or e2e run. The task folder has no `context.md`, `task-description.md`, `implementation-plan.md`, `code-style-review.md`, or batch file; `implementation-plan-e.md`, `decisions.md`, and `batch-e-report.md` supplied the intended behavior.
