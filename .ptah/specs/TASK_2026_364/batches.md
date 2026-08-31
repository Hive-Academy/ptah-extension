# Batches — TASK_2026_364

Decomposed by the orchestrator from `implementation-plan.md` (user approved
2026-08-31). Four batches, cut so no two concurrent batches share a file.

Execution order: **A and B in parallel → C → D.** C's resolver implementation
consumes the request context A adds. B touches nothing A or C touches.

Executors are CLI agents. Every executor writes `batch-<X>.report.md` into this
folder and does NOT commit; the orchestrator verifies and commits each batch.

**Spawn ceiling: 60 minutes.** The first architect run burned it and produced
nothing. Every batch below is scoped to be finishable well inside it, and each
executor is told to write its report before it runs out of room.

---

## Batch A — request-scoped workspace identity (`vscode-lm-tools`)

Status: PENDING

Files:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/workspace-root-resolver.ts`
- their specs

Adds `callerWorkspaceRoot` to the AsyncLocalStorage context, parses
`/workspace/{encoded}` off the request URL beside the existing `/session/{id}`,
and inserts the declared workspace as the new tier 1 of the resolver
precedence — above the caller session id, because a caller that STATES its
workspace outranks one we infer.

Grammar decision to pin in a spec: which segment orders are accepted. Pick one
and assert it; do not accept an open-ended combination.

## Batch B — write the scoped URL (`vscode-lm-tools` + `cli-agent-runtime`)

Status: PENDING

Files:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/ptah-mcp-slots.ts`
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/{codex-cli,cursor-cli,copilot-sdk,opencode-cli,antigravity-cli}.adapter.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`
- their specs

`ptahMcpEntry(port)` becomes `ptahMcpEntry(port, workspaceRoot)`; each adapter
builds the same scoped URL from the working directory it is already spawning
into. Mechanical, but one hazard: `jsonToConfig` infers the transport from the
URL and returns `sse` only when it contains `/sse`. A `/workspace/...` segment
must still read back as `http`, or read-compare-write rewrites `.mcp.json` on
every pass. Pin that with a spec.

## Batch C — the agent surface (`platform-core`, `shared`, `cli-agent-runtime`)

Status: PENDING — depends on A

Files:

- `libs/backend/platform-core/src/interfaces/` — new `ICallerWorkspaceResolver`
  port + token
- `libs/backend/vscode-lm-tools/src/lib/code-execution/` — the implementation,
  reading A's `getCallerWorkspaceRoot()`
- `libs/shared/src/lib/` — `normalizeWorkspaceRoot` moved here from
  `apps/ptah-electron/src/activation/workspace-root-key.ts`, with that app
  re-exporting or importing it
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts`
- the three composition roots' registration
- their specs

`AgentProcessManager` resolves caller → session → provider through the port,
never by importing `vscode-lm-tools` (that would invert the dependency
direction). No implementation registered ⇒ falls back to the platform provider,
so the CLI host and single-workspace hosts are unchanged.

`getStatus()` filters by `workingDirectory`; `getStatus(agentId)` for an agent
owned by another workspace says so instead of `Agent not found`.

## Batch D — the ambiguity refusal

Status: PENDING — depends on A and C

An anonymous call, with more than one workspace folder open, to a
workspace-resolving agent tool returns an error naming the open folders. Gated
on the folder count, so single-folder hosts and the CLI host never see it.

---

## Verification (every batch)

```
npx nx run-many -t typecheck,lint,test -p <the projects it touched>
```

Never `nx test a b c` — that runs only the first project and exits 0.

**All three composition-root smoke specs must run** whenever a constructor or a
DI registration changes: `apps/ptah-extension-vscode`, `apps/ptah-electron`
AND `apps/ptah-cli`. TASK_2026_361 shipped a commit that missed the third.
