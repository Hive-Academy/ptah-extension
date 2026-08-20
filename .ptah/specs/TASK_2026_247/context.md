# TASK_2026_247 — a config change kills every in-flight permission

Filed 2026-08-15, from a live incident during TASK_2026_180 B3.5. **This has been
diagnosed more than once and re-diagnosed each time**, because the symptom the
model sees is indistinguishable from a decision the user made. That
indistinguishability is half the defect.

## The chain, verified end to end

```
ConfigWatcher watches 'authMethod', 'anthropicProviderId',
  and ANY secret key starting 'ptah.auth.'
    libs/backend/agent-sdk/src/lib/helpers/config-watcher.ts:57-70

  → emitConfigChanged                       config-watcher.ts:121
  → onConfigChanged handler                 sdk-agent-adapter.ts:144
  → sessionLifecycle.disposeAllSessions()   sdk-agent-adapter.ts:148
  → cleanupPendingPermissions()   ← NO sessionId argument
                                            session-control.service.ts:180
  → for EVERY pending request in EVERY session:
      resolve({ decision: 'deny', reason: 'Session aborted' })
                                            sdk-permission-handler.ts:869-873
```

**No user action appears anywhere in that chain.**

## Defect 1 — the cleanup is global, the trigger is not

`endSession(sessionId)` scopes its cleanup to one session
(`session-control.service.ts:120` → the `if (sessionId)` branch at
`sdk-permission-handler.ts:843`, which filters on
`pending.tabId === sessionId || pending.sessionId === sessionId`).

`disposeAllSessions()` passes nothing, taking the `else` branch that walks the
whole map. So an auth-method change in one window denies in-flight permission
requests in every other window, tab and background subagent in the process.

Re-authenticating is a reason to refresh credentials. It is not a reason to deny
a subagent's file read three tabs away. Either scope the disposal to the affected
sessions, or re-auth in place without tearing the world down.

**Cross-session is not hypothetical.** During this same incident a second Ptah
session was demonstrably live — it allocated `TASK_2026_246` at 19:11 while this
session was mid-batch.

## Defect 2 — the reason is laundered before the model sees it

Ptah sets `reason: 'Session aborted'` (`sdk-permission-handler.ts:849, 872`).
What reaches the agent is Claude Code's canned string:

> The user doesn't want to take this action right now. STOP what you are doing
> and wait for the user to tell you how to proceed.

Every agent is instructed — correctly — that a permission denial is a deliberate
user decision, never to be retried or worked around. So on an abort-deny an agent
does the worst available thing: it stops cleanly, reports politely, and waits.
Nothing logs as an error. The only external signal is an agent returning suddenly
with "context gathering only, no files written".

`AbortError: Stream closed` on an in-flight Edit is the same event seen from the
CLI control-request side, already recorded in memory as a benign teardown race
(`session-control.ts` resolves Ptah's side before `query.interrupt()` closes the
stream). Benign for the SESSION; not benign for the agent, which reads it as a
wall.

## Why it looks intermittent

A config change is a one-shot edge. Resume the agent and there is no second edge,
so it works — which is exactly the signature that makes it get re-diagnosed
instead of fixed.

## Suspected aggravator: TASK_2026_180's own feature

Phase 1 of TASK_2026_180 is lane auth routing — `IProviderAuthResolver` snapshots
with `scope: 'lane'`, per-lane provider/model settings, background lanes resolving
credentials off the foreground quota. Anything on that path that writes
`ptah.auth.*` fires this watcher. **The feature may be killing its own background
agents.** Worth confirming: `LaneResolverService` obtains an
`OneShotAuthOverride` and is documented as inert with respect to globals, so it
SHOULD not write a secret — but a token refresh underneath it might.

## What a fix has to do

1. **Scope the permission cleanup to the sessions actually being disposed.** The
   per-session branch already exists and is already used by `endSession`.
2. **Propagate the deny reason to the model.** `interrupted` and `denied` must be
   distinguishable at the tool-result layer. Then the agent rule becomes
   unambiguous: a real deny stops the agent; an abort-deny is retryable, and the
   agent can say which one it hit instead of guessing.
3. **Consider whether an auth change needs `disposeAllSessions()` at all**, or
   whether it can re-initialize credentials without ending live sessions.

## Verification

The failure is reproducible by construction: start a background subagent that
will request a permission, then change `authMethod` or write a `ptah.auth.*`
secret from any window. Expect the subagent to receive a deny it did not earn.
A regression spec belongs beside `session-lifecycle-manager.spec.ts:484`, which
already pins the teardown ORDER — this pins its SCOPE.

## Related

- `libs/frontend/chat-routing/src/lib/stream-router.service.ts:444-448` — a
  SECOND auto-deny path, for prompts arriving on a surface-only conversation.
  `libs/frontend/chat-routing/CLAUDE.md` asserts surfaces "run full-auto with
  auto-allow at the SDK layer". If that assumption is false for background
  subagents, it is the same failure from a different origin. Check it while here;
  do not assume it is the same bug.

---

## What shipped 2026-08-15, and what did not

Fixes 1 and 2 are done and verified. Fix 3 is deliberately NOT done.

**Fix 1 — the cleanup is scoped.** `SessionControl.disposeAllSessions()` now
cleans up per disposed record, by `rec.tabId` and — when it is present and
differs — `rec.realSessionId`, because a CLI-path request is keyed by the real
session id with no tabId. The no-arg global branch of
`cleanupPendingPermissions` is untouched and keeps its spec. The cleanup still
runs BEFORE the interrupt/abort work, so `session-lifecycle-manager.spec.ts:484`
(which pins the ORDER) is unaffected. **The intended consequence: a pending
request whose session is not in the registry is no longer denied at all. It stays
pending and its owner can still answer it.**

**Fix 2 — a system abort no longer launders itself as a user decision.**
`sdk-permission-handler.ts` gained a file-local
`InternalPermissionResponse = PermissionResponse & { readonly systemAbort?: true }`.
The marker is deliberately NOT on the wire type: `PermissionResponse` is what the
WEBVIEW sends, and a system abort never originates there. Both branches of
`cleanupPendingPermissions` set it, and a new branch ahead of the hard-deny
returns `interrupt: false` with a message that states no human saw the prompt and
the operation may be retried.

**The `interrupt: false` half is REASONED, not empirically verified.** The
canned "the user doesn't want to take this action" string comes from the bundled
Claude Code CLI binary, which is not readable source. The inference: the
`deny_with_message` branch already pairs `interrupt: false` with a rich message
and is the path designed to reach the model, while the hard-deny branch pairs
`interrupt: true` with a short one and is the path that produced the canned
string in the incident. If a future incident shows the message still not landing,
this is the assumption to re-test first.

### Verification

Both specs were mutation-tested twice — once by the implementer, once
independently by the orchestrator. Reverting the scope fix kills 2 of the 6
tests in `session-lifecycle-manager-dispose.spec.ts`; stripping the marker kills
2 of the 28 in `sdk-permission-handler.spec.ts`. The scope spec drives a REAL
`SdkPermissionHandler` inside a real `SessionLifecycleManager` rather than
mocking the assertion, covers both keying paths, and proves the untouched
request is still ANSWERABLE rather than merely un-denied. The mapping spec
asserts the user-deny control keeps `interrupt: true` and its own message, so the
two paths are provably distinguishable. `agent-sdk`: 68 suites, 903 passed, 0
failed (baseline 898).

### Still open — do not assume this task closed them

1. **Fix 3 was not attempted.** Whether an auth change needs
   `disposeAllSessions()` at all is a product decision, not a refactor.
   `sdk-agent-adapter.ts:144-153` is untouched. Note the sibling
   `onAuthFileChanged` handler at `:154-166` already models the "re-init only
   when unhealthy" pattern with a written rationale — that is the shape to copy
   if this is ever taken up.
2. **`SdkPermissionHandler.dispose()` has no callers anywhere in the repo.**
   Which means the no-arg global sweep inside `disposeAllSessions()` was in
   practice the only global pending-permission drain on deactivate, and it is now
   scoped. Inert in a real deactivate (the process is going away), but wiring
   `dispose()` into `SdkAgentAdapter`'s deactivate path is the belt-and-braces
   answer.
3. **`stream-router.service.ts:444-448` is the same laundering from a different
   origin, and this task's fix does NOT cover it.** It synthesises
   `{decision:'deny', reason:'auto-deny: prompt arrived for surface-only
conversation'}`, which arrives over the webview wire and so correctly carries
   no `systemAbort` marker — landing on the hard-deny path with `interrupt: true`
   and the canned string, with no human involved. The cheapest correct fix is to
   change that literal to `deny_with_message`, which is already the
   `interrupt: false` path whose text reaches the model, and needs no backend
   change. Its existence also contradicts `libs/frontend/chat-routing/CLAUDE.md`'s
   claim that surfaces "run full-auto with auto-allow at the SDK layer".
4. **The reproduction in "Verification" above was never run.** The fix is pinned
   by unit specs, not by the live auth-change reproduction. Worth doing once.

---

## A FOURTH laundering path, found and fixed 2026-08-16

The unroutable-request deny timeout (`sdk-permission-handler.ts:847`, added by
`8d4056003` for TASK_2026_155 F2 — before this task's marker existed) resolved a
bare `{decision:'deny'}` with no `systemAbort`. It therefore landed on the
hard-deny branch with `interrupt: true` and produced the canned user-denial
string for a request **no human could have seen** — by construction, the timeout
only arms when there is no UI surface to route the prompt to (gateway `gw-*`
tabs, headless/background lanes). Same defect as Fix 2, different origin, and it
is the one that reaches BACKGROUND agents rather than foreground tabs.

Fixed by marking that resolve `systemAbort: true`. The system-abort message text
was widened to name the second cause ("or the prompt could not be routed to any
UI surface before its deny window expired") so one branch stays accurate for
both. Pinned by extending the existing timeout spec
(`sdk-permission-handler.spec.ts:738`) — it previously asserted only
`behavior: 'deny'`, which passed either way; it now asserts `interrupt: false`
and the "NOT a user decision" text. Mutation-tested: dropping the marker fails
exactly 1 of 28. `agent-sdk`: 68 suites, 903 passed, 0 failed (baseline 903).

Open item 3 (`stream-router.service.ts:444-448`) was deliberately NOT taken up
with it. The `deny_with_message` swap this file proposed as "the cheapest correct
fix" is cheap but not correct: that branch's message
(`sdk-permission-handler.ts:653`) hard-codes "Permission denied by user … The
user reviewed this tool call and explicitly chose to deny it", so it drops the
interrupt while still asserting a human refused. A correct fix needs the
system/user distinction to survive the webview wire, which is a design decision
about `PermissionResponse` — not a one-literal change.
