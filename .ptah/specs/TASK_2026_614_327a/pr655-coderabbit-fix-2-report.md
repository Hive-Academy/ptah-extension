# PR #655 CodeRabbit fix 2 — scope held-start cleanup to a resolved parent session

**Comment addressed** (`subagent-hook-handler.ts`, ~463-465): a stop with no
registry record and an unresolved parent session passed `undefined` to
`discardHeldUnboundStarts`, and the store treated `undefined` as "delete every
held start for that agent ID" — so a same-ID held start of another session was
lost before its Task result bound it.

## What changed

### `libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.ts`
- `HeldUnboundStart.parentSessionId` is now optional (`readonly
  parentSessionId?: string`, ~48-53): a start can be held WITHOUT a resolved
  parent session, and that unresolved id is its OWN exact key — never a
  wildcard over every session's held starts.
- `holdUnboundStart()` (~327-339) normalises the parent-session key with
  `blankToUndefined` before storing and de-duplicating: `''` (or a blank id)
  and a missing id hold and discard as one — the unresolved key.
- `discardHeldUnboundStarts()` (~351-369) signature unchanged
  (`agentId: string, parentSessionId?: string): number`). `undefined` no longer
  means "all sessions": the argument is normalised to an exact key, and only
  held starts whose own stored key equals it are dropped — `undefined`/blank
  drops only starts held without a resolved session; a resolved id drops only
  that session's starts. Still returns the dropped count. This is the fix the
  CodeRabbit comment asked for: the discard is NOT skipped (that would
  re-open the running-zombie bug), it is scoped.

### `libs/backend/vscode-core/src/services/subagent-registry.service.ts`
- `bindHeldStartToToolCall()` outcome doc (~835-836): `already-registered` now
  documented as dropping held starts of the record's own parent-session key
  (was "nothing held for the same agent is kept").
- Public `discardHeldUnboundStarts()` doc (~890-899): documents the exact-key
  scope — unresolved drops only no-session starts; a resolved id drops only
  that session's; another session's held start survives until its own Task
  result binds it.

### `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts`
- The SubagentStop discard (~458-471) is unchanged in code and still uses the
  SAME payload-first `resolveParentSessionId(input.session_id, parentSessionId)`
  for the discard as for the hold (no closure-id bug reintroduced). The
  comment now states why the call is kept when the id is unresolved: a
  no-session held start is still dropped (no zombie), while `undefined` is the
  no-session key — never "every session".

## Every caller of `discardHeldUnboundStarts` and its semantics now

| Caller | Call | Semantics now |
|---|---|---|
| `subagent-registry.service.ts` `bindHeldStartToToolCall` (~853) | `store.discardHeldUnboundStarts(agentId, existing.parentSessionId)` | Drops held starts of the existing record's own key: resolved → that session's; `undefined` → starts held without a session only. (Under the old store semantics the `undefined` case silently deleted ALL sessions' held starts for the agent — the same cross-session loss; now scoped.) |
| `subagent-registry.service.ts` `bindHeldStartToToolCall` (~875) | `store.discardHeldUnboundStarts(agentId, start.parentSessionId)` | Drops exactly the held start being bound (its own key). Unchanged. |
| `subagent-registry.service.ts` public `discardHeldUnboundStarts` (~896) | `store.discardHeldUnboundStarts(agentId, parentSessionId)` pass-through | Same exact-key semantics as the store. |
| `subagent-hook-handler.ts` `handleSubagentStop` (~466) | `registry.discardHeldUnboundStarts(input.agent_id, resolved ?? undefined)` | Resolved parent session → that session's held starts; unresolved → only starts held without a session (the zombie case), never another session's. |

**No remaining caller relies on the old "all sessions" meaning.** The only
call sites that ever passed `undefined` were the hook-handler stop (the bug
being fixed) and the `bindHeldStartToToolCall` record-without-session case
(~853), which silently inherited the same cross-session loss and now gets the
scoped behaviour. No separately named "discard-all" method was needed; a
repo-wide search found no other callers of the store method or the public
service method.

## Specs added

- `subagent-state-store.spec.ts`:
  - `treats an unresolved parent session as its own key, never every session` —
    held starts for agentId `shared-agent` in session `parent-a` AND with no
    session; `discard(X, undefined)` removes only the no-session one, then
    `discard(X, 'parent-a')` removes only A's.
  - `holds a blank parent session under the unresolved key` — a start held
    with `parentSessionId: ''` is dropped by a discard with an omitted
    (unresolved) id.
- `subagent-hook-handler.spec.ts`:
  - `it.each` — `drops only the held start without a session when a stop from
    {a new-session closure | a one-shot query closure} resolves no parent
    session`: a stop with no registry record and an unresolved parent session
    (payload `session_id: ''`, blank/undefined closure) still calls
    `discardHeldUnboundStarts('shared-agent', undefined)` and does NOT remove
    the same-agentId held start of session `parent-a`; the held start stored
    without a session IS removed (no zombie: a later Task result naming the
    agent has no held start left to bind).

Existing held-start specs (`store` scoped-discard test, handler
TASK_2026_295 tests, `task-result-agent-binding.spec.ts` real-registry tests)
still pass unchanged — they only exercise resolved keys, whose behaviour is
identical.

## Checks (each run once; exit codes captured in the same PowerShell session)

| Command | Exit code |
|---|---|
| `npx nx run-many -t typecheck,lint,test -p agent-sdk vscode-core --outputStyle=static` | 0 ("Successfully ran targets typecheck, lint, test for 2 projects"; Tests: 3173 passed, 3 skipped, 0 failed) |
| `npx nx run degradation-audit:lint` | 0 |
| `npx nx run di-lint:lint` | 0 |

Nx Cloud 401 "organization has been disabled" banners appeared on all three
runs (declared noise). No known flake re-run was needed —
`session-handoff-writer.spec.ts` and `subagent-message-dispatcher.spec.ts`
were not reported failing.

## Files changed (absolute paths)

- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry\subagent-state-store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry\subagent-state-store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.spec.ts`

LF line endings preserved; no other files touched; no git commands run.
