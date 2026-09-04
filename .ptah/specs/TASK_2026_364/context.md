# TASK_2026_364 — CLI agent spawning ignores the calling session's workspace

## User intent (verbatim)

> that's another error why would the mcp server get bounded to the wrong project
> when we open more than one workspace in our electron application, i thought
> that was fixed before if its not lets file a task for it

## What actually happens

The MCP server is not bound to a project. There is one HTTP MCP server per Ptah
process. The value that moves is `ElectronWorkspaceProvider.activeFolder`, which
is process-global. Opening or activating a second workspace repoints it for the
whole backend, including callers that belong to the first workspace.

Measured on 2026-08-31 with `ptah-extension` and `property-hub` both open:

```
ptah_agent_spawn failed: Working directory must be within workspace root.
Got: D:/projects/ptah-extension/.claude-worktrees/native-loop
Expected prefix: D:\projects\property-hub
```

`ptah_agent_status` also reported an empty registry for agents that were
demonstrably alive — five `claude.EXE` children of the same `Ptah.exe`, two of
them actively writing files. So the whole `ptah_agent_*` surface went dark for
the non-active workspace while the agents kept running unattended. A second
session (`ptah-extension-38`, TASK_2026_361) hit the same failure independently
and began hand-fighting an agent it could not see.

## Root cause

The session-aware fix already exists and is correct:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/workspace-root-resolver.ts`
  — `resolveSessionWorkspaceRoot` with precedence caller session → active
  session → platform provider.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/session-aware-workspace-provider.ts`
  — a `Proxy` whose `getWorkspaceRoot()` routes through that resolver.
- The caller identity is available: `handleMCPRequest` runs every `tools/call`
  inside `runWithMcpRequestContext({callerSessionId})`
  (`protocol-dispatcher.ts:174`), backed by `AsyncLocalStorage`, so concurrent
  calls from different sessions never clobber each other.

It is wired into exactly one place — `ptah-api-builder.service.ts:480-483` —
which hands `sessionAwareWorkspaceProvider` to the core, system, analysis, ast
and json namespace builders. Those are covered.

`AgentProcessManager` is not. It injects the raw singleton:

```ts
// libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:276
@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
private readonly workspace: IWorkspaceProvider,
```

```ts
// :1726
private getWorkspaceRoot(): string {
  return this.workspace.getWorkspaceRoot() ?? require('os').homedir();
}
```

`validateWorkingDirectory` (`:1763`) compares against that value, so it reads
tier 3 of the precedence and skips tiers 1 and 2.

The exclusion looks deliberate but is scoped too narrowly. The comment at
`ptah-api-builder.service.ts:475-479` says the proxy is "deliberately NOT
registered globally" because non-MCP callers (webview RPC, watchers, indexer
warm-up) have no caller session id. That reasoning is sound and must be kept —
but it does not argue against passing the proxy to `AgentProcessManager`,
because the resolver already degrades to the provider root when no caller
session id is present. A UI-initiated spawn therefore behaves exactly as it does
today.

## Second root cause: an EXTERNAL caller has no session id at all

Added 2026-08-31 by `ptah-extension-38` after hitting this failure a second time
during TASK_2026_361. The analysis above is correct and incomplete: it assumes
tier 1 of the precedence can fire. For the caller that actually failed, it
cannot.

The caller session id reaches the resolver through the URL PATH. Ptah's own SDK
sessions get a scoped URL:

```ts
// libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1266
url: `http://localhost:${PTAH_MCP_PORT}/session/${encodeURIComponent(routingSessionId)}`,
```

That builder THROWS when the routing id is missing, and its own error message
names this bug: "without it every call arrives anonymous and `ptah_agent_spawn`
attributes the agent to whichever session was most recently active."

Every OTHER consumer gets a bare URL with no session segment:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/ptah-mcp-slots.ts:231`
  — the `{ws}/.mcp.json` entry, read by Claude Code, Codex and Copilot.
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:174`
  and each rival-CLI adapter (`codex-cli.adapter.ts:580`,
  `cursor-cli.adapter.ts:304`, `copilot-sdk.adapter.ts:301`,
  `opencode-cli.adapter.ts:356`, `antigravity-cli.adapter.ts:342`).

So a user's own Claude Code session — the caller in the measured failure — is
anonymous BY CONSTRUCTION. `getCallerSessionId()` returns `undefined`, tiers 1
and 2 miss, and it lands on tier 3, the process-global active folder. Passing
the session-aware proxy to `AgentProcessManager` is necessary and does NOT fix
this caller: the proxy would resolve the same tier 3 value.

Consequence for the fix: there is no channel today that tells the server which
workspace an external caller belongs to. One must be added, or the anonymous
case must be made to fail loudly instead of answering for an unrelated tree.

## Scope

In scope: make `AgentProcessManager` resolve the workspace root with the same
caller → active → provider precedence the namespace builders already use, AND
give an anonymous external caller a way to identify its workspace (or a clear
refusal when it cannot).

Out of scope: registering the session-aware proxy globally against
`PLATFORM_TOKENS.WORKSPACE_PROVIDER`. Two prior investigations rejected that,
and it would change behaviour for callers with no caller session id.

Not a bug, verified: the fourteen other `getWorkspaceRoot()` call sites in
`namespace-builders/*` receive the proxy and are already correct.

## Open questions for the architect

1. Which seam — inject the proxy into `AgentProcessManager` at its construction
   site, or give `cli-agent-runtime` its own resolver port so it does not depend
   on `vscode-lm-tools`? The second respects the current dependency direction
   (`vscode-lm-tools` → `cli-agent-runtime`, never the reverse).
2. Should `ptah_agent_status` / `ptah_agent_read` filter the registry by the
   caller's workspace? Today the registry appears global. An empty result for a
   live agent is the more dangerous half of this bug — it invited two sessions
   to overwrite work an invisible agent was actively producing.
3. Should a spawn record its workspace root so a later status call from another
   workspace still resolves it? Note `AgentProcessInfo.workingDirectory`
   (`libs/shared/src/lib/types/agent-process.types.ts:79`) ALREADY records it —
   `getStatus` (`agent-process-manager.service.ts:645`) simply does not filter
   on it.
4. How does an anonymous external caller identify its workspace? Three candidates,
   in the order they should be evaluated:
   - **MCP `roots`.** The protocol lets a client declare its workspace roots at
     `initialize`. If Claude Code and Codex send them, this is the correct
     channel and costs no config rewrite. MEASURE this before designing anything
     else.
   - **A scoped `.mcp.json` URL**, `http://localhost:PORT/workspace/{encoded}`,
     decoded beside `_callerSessionId`. Same mechanism as `/session/{id}` with a
     second key. Cost: it rewrites the `ptah` entry in every existing user's
     `{ws}/.mcp.json`. The `claude` slot is deliberately NOT routed through a
     facet for exactly this reason (see `vscode-lm-tools/CLAUDE.md`), so this
     choice reverses a standing decision and needs to be worth it.
   - **Refuse instead of guessing.** When a call is anonymous AND more than one
     workspace folder is open, return an error naming the ambiguity rather than
     an answer for the active folder. Weakest fix, but it converts a silent
     wrong answer into a loud one, and it is compatible with either of the above.
5. `getStatus` returning `[]` for a live agent is the dangerous half. Whatever
   the resolution, an empty list must never be ambiguous between "none of yours"
   and "none at all" — two sessions read it as the latter on 2026-08-31 and both
   began overwriting files a live agent was writing.

## Regression test

Two sessions with different `projectPath` values, one `AgentProcessManager`, the
platform provider pointing at workspace B. A spawn whose caller session belongs
to workspace A and whose `workingDirectory` is inside A must succeed. Today it
throws.
