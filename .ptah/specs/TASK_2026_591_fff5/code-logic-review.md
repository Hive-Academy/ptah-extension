# Code logic review — TASK_2026_591, batch 1

## Verdict

**Score: 5/10 — REVISE**  
**Findings: 1 blocking, 1 serious, 0 moderate, 2 failure modes.**

The adapter correctly centralizes turn spawning and the exercised first-turn / successful-continuation paths pass, but it does not clear the completed child's PID and it loses the supplied resume session ID from the handle's observable state. These break lifecycle safety and resumability outside the happy path. This is below the 6/10 band because stopping an idle lane can target a recycled, unrelated PID and a resumed lane can become unrecoverable after release. It remains above the 3–4 band because the reviewed JSONL parsing, recovered-exit rule, per-turn parser state, same-emitter streaming, and live-turn abort path are implemented and the scoped 65-test suite passes.

## Defects

1. **Blocking — stale completed PID can make `stop` tree-kill an unrelated process.**  
   **Locations:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:695-697`, `:812-820`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1915-1917`, `:2548-2555`.  
   **Failure scenario:** The first or a continued `opencode run` exits; `activeChild` remains its child object because the close handler settles the promise but never clears it. The lane is intentionally retained in an idle continuation-capable state. If the user then stops it (or host shutdown releases it), the manager aborts the handle and calls `getPid()`, which returns the already-exited child's PID, then calls `killProcessTree` on that PID. Once the OS has reused that PID, Ptah can terminate an unrelated process tree, potentially discarding that process's work. The adapter's own abort listener has already been removed on close, so it does not supply a compensating live-child check.  
   **Suggested fix:** Associate the active child with its individual turn and clear `activeChild` in that turn's `close` and `error` settlement paths only if it is still that child. `getPid()` must return a PID only while the corresponding child is live. Add a test: complete a turn, assert `getPid()` is `undefined`, then exercise manager release/stop and assert no tree-kill is attempted for the completed child.

2. **Serious — a resumed session is usable for one follow-up but is never recorded as the lane's session.**  
   **Location:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:706-717`.  
   **Failure scenario:** A lane is spawned with `resumeSessionId: 'ses_old'` and its output contains no parseable event with `sessionID` (for example, an immediate text-only/CLI failure or a stream shape that omits it). `resumableSessionId()` correctly uses `options.resumeSessionId`, so `continue()` can issue `--session ses_old`; however `getSessionId()` returns only `capturedSessionId`, i.e. `undefined`. The manager therefore never stores `cliSessionId` (`agent-process-manager.service.ts:924-929`), and after idle release it tells the caller to resume with `<unknown>` (`agent-process-manager.service.ts:1799-1809`). The conversation has a valid ID but becomes unrecoverable through the normal release/restart flow.  
   **Suggested fix:** Initialize the handle's effective/captured session ID from `options.resumeSessionId`, or have `getSessionId()` return `capturedSessionId ?? options.resumeSessionId`; preserve that value for manager tracking and update it if a newly reported authoritative session ID is expected. Add a spec asserting `getSessionId()` exposes the resume ID before output and after a no-session-ID first turn.

## Five logic questions

1. **How does this fail silently?** A resumed session's ID is silently absent from `getSessionId()` even though `continue()` still uses it; the manager later reports `<unknown>` rather than preserving a resumable conversation.
2. **What user action produces unexpected behaviour?** Stopping an idle opencode lane after a completed turn can tree-kill the stale PID retained by the adapter rather than a live opencode child.
3. **What input data produces a wrong answer rather than an error?** A resumed run whose stream contains no `sessionID` yields an incorrect `undefined` session ID while the correct value is already supplied in `resumeSessionId`.
4. **What happens when a dependency fails, times out, or returns an unexpected shape?** The reviewed 2.x and top-level error shapes are surfaced, and an error after a stop remains failed; however a text-only/non-session-id stream loses resume identity, so the dependency's omitted field breaks later recovery.
5. **What is missing that requirements never mentioned?** The release/stop lifecycle needs an explicit ownership/liveness invariant for a PID returned by a continuation handle; retaining completed child state is unsafe once the manager may stop an otherwise idle record.

## Scope and verification

Reviewed the complete opencode adapter and its spec, the `SdkHandle` contract, message router and relevant manager continuation/exit/stop paths, plus Pi/Cursor continuation patterns and the changed agent-lanes skill text. The changed skill wording is consistent with queue-only opencode messaging and has no separate logic finding. Ran `npx nx test cli-agent-runtime --testFile=opencode-cli.adapter.spec.ts`: 65/65 passed. Scoped TypeScript diagnostics for the changed adapter and spec: 0 errors, 0 warnings. The passing checks do not cover idle-stop PID clearing or manager persistence of a supplied resume ID.
