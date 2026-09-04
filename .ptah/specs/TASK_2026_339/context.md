# Context — TASK_2026_339

## Where this came from

Noticed by the TASK_2026_332 implementer while updating the five call sites that
DO register, and correctly left alone as out of scope. Recorded in
`.ptah/specs/TASK_2026_332/implementation-report.md`.

## What TASK_2026_332 established

`ensureRegisteredForSubagents()` used to resolve successfully even when the
`.mcp.json` write never happened — a lock timeout was swallowed by a generic
catch, so five callers awaited it and proceeded believing the entry was on disk.

It now returns a typed `McpSubagentRegistration`
(`{ registered: boolean; reason?: 'not-started' | 'no-workspace' | 'lock-timeout' | 'write-failed' }`),
and every one of those five callers sets its `mcpServerRunning` flag from the
result. A contended config file degrades the flag instead of lying about it.

## The two paths that were not covered

`chat:resume --activate` and `ensureSessionActiveForRewind` resume a session with
`mcpServerRunning: true` and never call `ensureRegisteredForSubagents()` at all.

The flag they use is derived from the HTTP port being live. That is a different
claim from the one the flag makes. A live port means the MCP server is
listening. It says nothing about whether a `ptah` entry exists in **that
workspace's** `.mcp.json`, and the entry is what a spawned subagent actually
reads.

So a session resumed through either path can be told MCP is available when no
entry exists — for instance in a workspace that was never registered, or one
whose entry was removed, or one where an earlier registration hit a lock timeout
and correctly reported failure to a different caller.

## Why this is a decision, not a mechanical fix

There is no result to consume on these paths, because they never register. So
"thread the result through" does not apply. The real question is which of these
is right:

1. **Register on resume too.** The most likely correct answer — a resumed session
   spawns subagents exactly like a started one, so it needs the same guarantee.
   Cost: two more `.mcp.json` mutations on paths that are currently cheap, each
   able to wait up to the 2 s lock deadline.
2. **Report the truth without registering.** Read whether the entry exists and
   set the flag from that. Cheaper, but a read of a file another process may be
   mid-write on is exactly the race `withMcpConfigLock` exists to prevent.
3. **Leave it optimistic and document why.** Defensible only if something else
   guarantees the entry is present by the time either path runs. Nothing
   currently does, so this needs evidence rather than assumption.

Prefer 1 unless the added latency on the rewind path proves unacceptable.

## The related default

`autoResumeIfInactive` gained a trailing `mcpRegisteredForSubagents` parameter in
TASK_2026_332. It defaults to `true` **specifically so these two callers are not
silently downgraded** — they have no information to give, and defaulting to
`false` would have reported a failure that never happened.

That default is deliberate and documented. It also means a future caller that
forgets to pass the parameter inherits the optimistic answer. Whichever option
above is chosen, revisit whether the default should become required.

## Verification

Whichever path is taken, the acceptance test is the same shape as the one
TASK_2026_332 added for the gateway: resume a session in a workspace with no
`ptah` entry in `.mcp.json`, and assert the session is not told MCP is available
— or, if option 1 is chosen, assert the entry now exists and the flag is true.

Note `chat-session.service.ts` has no direct unit coverage today — 22 injected
dependencies and no `chat:start` harness. TASK_2026_332 pinned its contract only
at the two sites that have doubles (`chat-ptah-cli.service.spec.ts`,
`gateway-chat-bridge.spec.ts`). If this task needs a real harness for that class,
building one is worth more than the fix itself and should be said out loud rather
than absorbed silently.
