# TASK_2026_598 — confirm before a stored-key change ends running chat sessions

## Why

Found during TASK_2026_555 (Settings redesign, PR #631), recorded as follow-up 7 in
`TASK_2026_555/batches.md` and in `TASK_2026_555/write-path-trace.md` §5. It is pre-existing: TASK_2026_555 did not
change this code. Read from code; no live run was made.

`ConfigWatcher` (`libs/backend/agent-sdk/src/lib/helpers/config-watcher.ts`, the watch callback around lines 57-71,
started from the agent-sdk DI `register.ts` around line 633) ends **every live chat session** on any `ptah.auth.*`
secret write. The Settings actions that cause it, with no confirm and no warning:

- Providers → connection drawer → Credentials: Replace key, Delete key.
- Agent Orchestration → Cursor credential (store or remove).
- A Ptah CLI instance key change.

`auth:copilotLogin` and `auth:codexLogin` (`libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts`) reset
the SDK directly with the same effect.

A user who replaces a key for a provider that no running session uses still loses all running sessions.

## Decision needed (user gate before code)

1. **Confirm first:** the Settings action shows "This ends N running chat sessions" and asks before the write.
2. **Scope the reset:** only sessions that use the changed provider's key end (or restart), others keep running.
3. **Refresh in place:** running sessions pick up the new credential at their next request, nothing ends.

Option 2 or 3 needs research into what the SDK session holds (env vars pinned at spawn).

## Scope

- Map each `ptah.auth.*` key to the provider and to the sessions that use it.
- Implement the chosen option in the agent-sdk and the Settings write paths (all three hosts).
- Keep D15: "Saved" only after the write's own result.

## Acceptance criteria

1. A key write for a provider no session uses ends no session (options 2 and 3), or the user confirmed it (option 1).
2. A session that uses the changed key never continues with the old credential silently.
3. Specs for the watcher and each Settings write path; a live check in VS Code and Electron recorded in a report.

## Out of scope

The secret store itself; the Settings layout.
