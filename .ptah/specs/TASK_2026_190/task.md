---
id: TASK_2026_190
status: done
type: BUGFIX
title: Replace stderr-pattern provider-error abort with a no-activity timeout
description: The permission-abort fix tightened isFatalUpstreamProviderError so a benign stderr line can no longer latch-kill a session, but the underlying un-hang mechanism is still a brittle stderr string match. Replace it with a no-stream-activity timeout so a genuinely stuck session (persistent 5xx, or a fatal error in an unrecognized format) surfaces an error instead of hanging, without pattern-matching stderr.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-09T00:00:00.000Z
---

## Description

### Origin

Follow-up to the permission-abort fix (commit `8764e753a`,
`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`). That fix
retightened `isFatalUpstreamProviderError` to stop benign stderr (bare numbers,
transient 429/5xx) from spuriously aborting a session — the "permission aborts
over and over, restart fixes it" report. This task addresses the residual gap
the fix deliberately left open.

### The residual gap

`onProviderError` exists to un-hang the UI when the SDK logs a fatal error to
stderr **without** forwarding it through the message stream. The fix made the
detector precise (fatal-only, signature-anchored). The trade-off, documented at
fix time: coverage shrank. A session that is genuinely stuck now hangs instead
of aborting when the error is either

- **persistent-transient** (a provider stuck returning 5xx that never resolves
  and never forwards a message), or
- **fatal but unusually formatted** (e.g. a bare `HTTP 401` with no reason
  phrase, or a proxy's custom error JSON that matches none of the anchored
  signatures).

The root problem is the mechanism: un-hanging by pattern-matching stderr strings
is inherently brittle in both directions (false positives killed healthy
sessions; false negatives let stuck ones hang).

### The better mechanism

A **no-activity timeout**: if the SDK query produces no stream activity
(no message, no partial event, no tool call, no thinking delta) for N seconds
while a turn is in flight, surface a timeout error / offer to abort, instead of
inferring "stuck" from stderr text. This covers the stuck-session case
regardless of error format and removes the stderr heuristic entirely.

### Scope / constraints

- Retire the stderr-pattern abort (`isFatalUpstreamProviderError` +
  `onProviderError` wiring in `session-query-executor.service.ts:185-212`) once
  the timeout covers its cases — do not run both.
- The timeout MUST NOT false-abort legitimately long operations: a long tool
  call, extended thinking, a slow-but-alive stream. Reset the timer on ANY
  stream activity, not just assistant text.
- Tie in with the existing `AbortController` teardown path; a timeout abort must
  resolve pending permissions cleanly (avoid re-introducing the benign
  "Stream closed" teardown as an error — see the session-lifecycle-abort memory).

### Acceptance criteria

1. A no-activity timeout that surfaces an error / abort when a turn produces no
   stream activity for a configured window.
2. Timer resets on any stream event (message, partial, tool_use, thinking).
3. The stderr-pattern provider-error abort is removed once the timeout subsumes
   it; no session is aborted on a stderr string match.
4. Tests: a stuck (no-activity) stream aborts after the window; a slow-but-active
   stream (long tool call / thinking) does NOT abort.

### Related

- Commit `8764e753a` — the predicate fix this supersedes at the mechanism level.
- Memory `session-lifecycle-abort`, `stream-closed-abort-benign-teardown` — the
  teardown-order invariants a timeout abort must respect.
