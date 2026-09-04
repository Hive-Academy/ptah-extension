# TASK_2026_364 — Implementation plan

Author: orchestrator (`ptah-extension-38`), 2026-08-31.

The first architect run (CLI agent `1b399c50`) hit the 60-minute spawn ceiling
and wrote nothing. 60 minutes is the maximum `ptah_agent_spawn` accepts, so the
job was re-scoped rather than retried: the orchestrator settled the one
measurement that decides the design, and the remaining work is small enough to
specify directly.

## 1. Measured facts

Every claim below was read from this repository or from the installed SDK.

### F1 — The MCP `roots` capability is NOT available to this server

`@modelcontextprotocol/sdk` is at **1.29.0** and does define roots
(`dist/esm/types.js:441` client capability, `:1939` `roots/list`, `:1952`
`notifications/roots/list_changed`).

`roots/list` is a **server → client** request. Ptah's HTTP MCP server cannot
issue one. `handleHttpRequest`
(`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:254`)
is one-shot JSON-RPC over HTTP POST: it buffers the body, calls
`onMCPRequest`, writes one response, and ends. There is no SSE stream, no
streamable-HTTP session and no other channel back to the client. A request
without an `id` is answered `204` and dropped (`:304`).

`handleInitialize` (`protocol-dispatcher.ts:204`) advertises
`protocolVersion: '2024-11-05'`, declares only `tools: {}`, and reads nothing
from `request.params.capabilities` — it logs `clientInfo` and discards the rest.

**Conclusion: candidate 1 of open question 4 is dead** without replacing the
transport with streamable HTTP plus per-client sessions. That is a far larger
change than this bug justifies, and it would touch every rival-CLI adapter's
config. Not proposed.

_Unverified and deliberately not pursued:_ whether Claude Code or Codex would
send roots if we could ask. It does not matter — we cannot ask.

### F2 — The URL is the only channel that exists today

`extractCallerSessionId` (`http-server.handler.ts:245`) parses
`^/session/([^/?]+)` off `req.url` and sets `_callerSessionId`. That is the
whole caller-identity mechanism, and it already works for Ptah's own sessions
(`sdk-query-options-builder.ts:1266`).

Every external consumer gets a bare URL: `ptahMcpEntry(port)`
(`ptah-mcp-slots.ts:231`) returns `{ type: 'http', url: 'http://localhost:PORT' }`
for the `.mcp.json` entry, and each rival-CLI adapter builds the same bare URL
at spawn time.

### F3 — The standing "do not rewrite `.mcp.json`" decision does not block this

`vscode-lm-tools/CLAUDE.md` explains that the `claude` slot is not routed
through a facet because doing so "would rewrite that entry in every existing
user's repository to say the same thing differently, **for no capability**".
The objection is to a COSMETIC rewrite. A workspace-scoped URL buys a
capability — correct workspace attribution for every external CLI — so the
rationale does not apply. It is still a rewrite and must be stated as a cost.

One hazard, from the same file: `jsonToConfig` infers the transport from the
URL, and `inferTransportType` returns `sse` only when the URL contains `/sse`.
A `/workspace/...` segment does not, so the entry still reads back as `http`
and read-compare-write stays stable. Verified against the comment at
`ptah-mcp-slots.ts:219-230`.

### F4 — The registry already holds the answer it refuses to use

`AgentProcessInfo.workingDirectory` is recorded per agent
(`libs/shared/src/lib/types/agent-process.types.ts:79`). `getStatus`
(`agent-process-manager.service.ts:645`) returns every tracked agent unfiltered,
and `getStatus(agentId)` throws a bare `Agent not found: <id>`.

### F5 — The spawn guard reads tier 3 unconditionally

`AgentProcessManagerService` injects `PLATFORM_TOKENS.WORKSPACE_PROVIDER`
(`:276`); `getWorkspaceRoot()` (`:1726`) reads it directly;
`validateWorkingDirectory` (`:1763`) compares against that. Confirms the
existing context.md analysis.

## 2. Decision on open question 4

**Adopt candidate 2 and candidate 3 together.**

- **Candidate 2 — scope the external URL.** Write
  `http://localhost:PORT/workspace/{encodeURIComponent(folder)}` into
  `{ws}/.mcp.json` and into each rival-CLI spawn config. Parse it beside
  `_callerSessionId`. This is the existing `/session/{id}` mechanism with a
  second key; it needs no new concept and no transport change.
- **Candidate 3 — refuse instead of guessing.** When a call is still anonymous
  AND more than one workspace folder is open, a workspace-resolving tool must
  return an error naming the ambiguity rather than an answer for the active
  folder. This covers stale `.mcp.json` files written before the upgrade, and
  any consumer we do not control.

Cost, stated plainly and CORRECTED after measurement: the `ptah` entry's `url`
value changes once per workspace. `registerInMcpJson` is already
read-compare-write and per-folder, so it is one rewrite, not one per pass.

This repository ignores `.mcp.json` (`.gitignore:53`), so there is no diff here
at all. The cost lands only on a user whose own repository TRACKS the file —
some teams commit it to share MCP servers with the team — where the rewrite
appears once as a modified line. No file is created that Ptah does not already
write, and no permission or ownership changes.

An earlier draft of this plan described the cost as "a diff in every existing
user's repository". That overstated it.

## 3. Component design

Four concerns, cut so they are file-disjoint.

### Batch A — request-scoped workspace identity (`vscode-lm-tools`)

- `mcp-core/mcp-request-context.ts` — add `callerWorkspaceRoot?: string` to
  `McpRequestContext`, plus `getCallerWorkspaceRoot()`. Same AsyncLocalStorage.
- `mcp-http/http-server.handler.ts` — add `extractCallerWorkspaceRoot`, parsing
  `^/workspace/([^/?]+)`, symmetric with `extractCallerSessionId`. Both segments
  must be accepted, in either order is NOT required — pick one grammar and pin
  it in a spec.
- `mcp-core/protocol-dispatcher.ts` — thread the new field into
  `runWithMcpRequestContext` at `:174`.
- `code-execution/workspace-root-resolver.ts` — insert the caller workspace root
  as the new tier 1, above the caller session id. A caller that states its
  workspace outranks one we infer from a session.

### Batch B — write the scoped URL (`vscode-lm-tools` + `cli-agent-runtime`)

- `mcp-http/ptah-mcp-slots.ts` — `ptahMcpEntry(port)` becomes
  `ptahMcpEntry(port, workspaceRoot)`. `planPtahMcpSlots` already knows the
  folder per slot.
- The rival-CLI adapters (`codex-cli`, `cursor-cli`, `copilot-sdk`,
  `opencode-cli`, `antigravity-cli`) and
  `ptah-cli/helpers/ptah-cli-spawn-options.service.ts:174` — build the same
  scoped URL. They already know the working directory they are spawning into.

### Batch C — the agent surface (`cli-agent-runtime`)

- `AgentProcessManagerService.getWorkspaceRoot()` resolves caller → session →
  provider. **Seam decision for open question 1:** do NOT import
  `vscode-lm-tools` (the dependency runs the other way). Define a narrow port in
  `platform-core` — `ICallerWorkspaceResolver` with one method — implemented in
  `vscode-lm-tools` and registered by each host. `cli-agent-runtime` injects the
  port. When no implementation is registered it falls back to the platform
  provider, so the CLI host and single-workspace hosts behave exactly as today.
- `validateWorkingDirectory` compares against the resolved root.
- `getStatus()` filters by `workingDirectory` under the resolved root, using a
  normalized comparison. `normalizeWorkspaceRoot`
  (`apps/ptah-electron/src/activation/workspace-root-key.ts`) is the existing
  implementation and should move to `libs/shared` so three consumers share one
  definition rather than three.
- `getStatus(agentId)` for an agent owned by another workspace must say so
  ("agent belongs to workspace X"), not `Agent not found`.

### Batch D — the ambiguity refusal

- An anonymous call, with more than one workspace folder open, to any
  workspace-resolving agent tool returns an error naming the open folders and
  telling the caller to re-read `.mcp.json`. Single-folder hosts and the CLI
  host never see it.

## 4. Failure behaviour

| Case                                                | Behaviour                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| Anonymous caller, one folder open                   | Unchanged. Resolves to that folder.                                         |
| Anonymous caller, several folders open              | Refused with the ambiguity error. Never answers for the active folder.      |
| Scoped caller whose workspace is not open           | Refused, naming the workspace it asked for.                                 |
| CLI host (`ptah-cli`)                               | No resolver registered, one root. Unchanged.                                |
| UI-initiated spawn (webview RPC, no caller context) | Unchanged — falls to the platform provider, as today.                       |
| Stale `.mcp.json` with a bare URL                   | Behaves as "anonymous caller" above; self-heals on the next reconcile pass. |

## 5. Verification seam

The regression test context.md already names, extended to the case that
actually failed:

1. Two sessions, different `projectPath`, one `AgentProcessManager`, platform
   provider pointing at workspace B. A spawn whose CALLER SESSION belongs to A,
   with a `workingDirectory` inside A, must succeed. Fails today.
2. **The anonymous external caller.** Same setup, no caller session id, a
   `/workspace/{A}` URL segment. Spawn into A must succeed. Fails today, and is
   NOT fixed by the session-aware proxy alone — this is the case that made the
   whole surface go dark on 2026-08-31.
3. Anonymous, no workspace segment, two folders open: must refuse, not answer
   for B.
4. `getStatus()` from A with a live agent in B: returns `[]` for A's caller AND
   states that agents exist elsewhere. Must never be indistinguishable from
   "no agents at all".
5. A `.mcp.json` entry carrying `/workspace/...` still reads back as transport
   `http`, so a second reconcile pass rewrites nothing (guards F3's hazard).

## 6. Risks

| Risk                                                                              | Mitigation                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `.mcp.json` rewrite surprises users with a diff in a version-controlled file. | One rewrite, not one per pass (read-compare-write). Note it in the release notes.                                                                                                                                 |
| A new `platform-core` port is over-engineering for one consumer.                  | It is the only shape that does not invert `vscode-lm-tools` → `cli-agent-runtime`. If the team-leader finds a second consumer, the port is already right; if not, it is still one interface and one registration. |
| The refusal in Batch D breaks a working single-workspace flow.                    | Gated on "more than one folder open". Pinned by a spec that asserts the single-folder path is untouched.                                                                                                          |
| Three composition roots must keep resolving every handler.                        | Run all three `container.smoke.spec.ts` files — vscode, electron AND cli. TASK_2026_361 shipped a commit that missed the third.                                                                                   |

## 7. Scale

Roughly 12 files across four batches, of which 6 are rival-CLI adapters making
the same one-line URL change. This is smaller than the spec implies. Batches A
and C carry the real design; B is mechanical; D is one guard.
