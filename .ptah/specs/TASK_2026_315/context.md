# Context — TASK_2026_315

## User intent

The user asked for an analysis of `tmp/logs/log.log`, with particular attention
to "actions and events being executed without guardrailing if a proper
workspace is opened or not". The analysis found four such defects plus nine
other issues in the same log. Asked to scope the fix, the user chose
**everything in the log report** — all thirteen findings — and chose **not** to
enable CLI agents as junior helpers (sub-agent developers only).

## Strategy

BUGFIX. Research phase is already complete: this document IS the research
output. Every finding below was confirmed by reading the cited source, not
inferred from the log alone. Flow is therefore Team-Leader MODE 1 →
developers → QA.

## The log

`tmp/logs/log.log`, 1177 lines, captured 2026-08-23. One Electron dev session
(`nx serve ptah-electron`). The workspace timeline the log records:

1. Boot with `D:\projects\property-hub` restored from persisted state (log:84)
2. `workspace:removeFolder` on property-hub → **zero folders open** (log:925)
3. `workspace:addFolder` + `workspace:switch` to `D:\projects\angular-3d-showcase` (log:963, 1015)
4. `workspace:removeFolder` on angular-3d-showcase → **zero folders open** again (log:1148)

Steps 2 and 4 are what expose group A. There are no timestamps in the log, so
ordering claims below rest on line order, which for a single-process logger is
emission order.

---

## Group A — No-workspace guardrails (the user's stated concern)

### A1. Removing the last folder starts an OAuth proxy server

**Severity: high.** Leaks a listening socket and burns an OAuth token refresh.

Fired by `workspace:removeFolder`, log:926-960:

```
[SdkAgentAdapter] Active auth changed on workspace switch → thirdParty/openai-codex, reconfiguring
[CodexAuth] Refreshing expired OAuth token...
[CodexProxy] Translation proxy started at http://127.0.0.1:55305
```

`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:186` subscribes to
`onDidChangeWorkspaceFolders`. The handler `handleWorkspaceChanged` (`:243`)
guards only on `this.initialized` — never on whether any folder remains open.
With zero folders, `resolveActiveAuth()`
(`libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:25`)
falls through to the global default, here `openai-codex`, which differs from the
workspace-scoped `ollama-cloud` that was active. The differing pair defeats the
early-return at `:257-263`, so a full reconfigure runs.

The ordering makes it worse. `workspace-rpc.handlers.ts:268` fires
`workspaceLifecycle.removeFolder(path)` — which emits the event — and only then,
at `:273`, calls `providerProxyPool.disposeForScope(params.path)` to tear down
that workspace's proxies. The adapter's new proxy is started between those two
lines and is registered under the global scope, not `params.path`, so the
dispose cannot reach it. It outlives the workspace for the rest of the session.

The sibling subscriber in `apps/ptah-electron/src/activation/wire-runtime.ts:351`
gets this right (`const active = ...; if (active) { ... }`). The adapter's does
not. Note that a bare `if (!active) return;` is **not** obviously the whole fix
— consider whether closing the last folder should instead tear the previous
auth down. Decide deliberately and write the reasoning into the code comment.

**Files**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (:186, :243-284),
`libs/backend/rpc-handlers/src/lib/handlers/workspace-rpc.handlers.ts` (:258-288).

### A2. `tasks:board` refetches forever against no workspace

**Severity: medium.** Wrong UI state, repeated pointless RPC.

Nine `WORKSPACE_NOT_OPEN` rejections: log:939, 962, 965, 1154, 1167, 1171, 1173,
1175, 1177.

The backend is correct. `tasks-rpc.handlers.ts:1455-1469` (`resolveRoot`) throws
a typed `RpcUserError('No workspace folder open.', 'WORKSPACE_NOT_OPEN')`, and
its doc comment at `:1429` explains why that one check is the whole namespace's
boundary. Do not change it.

The gap is `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`.
`TasksStore` has no "is a folder open" gate. `setupVisibilityReconcile` (`:2195`)
refetches on every `focus` and `visibilitychange`, guarded by
`_loaded() && !_loading()` — but `fetchBoard`'s `finally` sets `_loaded = true`
even on the error path (`:2160-2165`), so the guard never latches and each
window focus buys another rejection. The user sees the error banner set at
`:2158` where a "no workspace open" empty state belongs.

`tasks-view.component.ts` already has an empty state with a create CTA; the
no-workspace state is a distinct third case (not-loaded / empty / no-workspace)
and should read differently — there is nothing to create without a folder.

**Files**: `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts`
(:2136-2166, :2195-2220), `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`.

### A3. `.mcp.json` register/unregister are path-asymmetric

**Severity: medium.** Leaves a dead-port entry in a user's repo indefinitely.

log:688: `[CodeExecutionMCP] Registered ptah in D:\projects\property-hub\.mcp.json (port 51820)`.

In `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`:

- `ensureRegisteredForSubagents` (`:129`) is one-shot behind a
  `registeredInMcpJson` boolean.
- `unregisterFromMcpJson` (`:237`) resolves its target via `getMcpJsonPath()`
  (`:274`) — the **current** workspace root, not the path it actually wrote.

Two consequences. `property-hub/.mcp.json` keeps a `ptah` entry pointing at a
dead port 51820 forever, because at shutdown the resolver returns a different
path or `null`. And `angular-3d-showcase` never gets an entry at all, because
the one-shot flag is already `true` — so subagents spawned in the second
workspace cannot discover the Ptah MCP server, which is the entire stated
purpose of the mechanism (`:192-199`).

Fix shape: store the written path next to the flag, unregister from _that_
path, and re-register on workspace change. Note the write at `:218` is a
blocking `fs.writeFileSync` into a user-owned file — preserve the existing
read-merge-write so a hand-authored `.mcp.json` is not clobbered.

**Files**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts` (:50, :129-143, :200-278).

### A4. `memory:stats` with no workspace returns every workspace's memories

**Severity: low-medium.** Cross-workspace count leak into a no-workspace UI.

log:941 and 1156: `[memory] stats: {}` — succeeded, no workspaceRoot.

`libs/backend/memory-curator/src/lib/memory.store.ts:614`:

```ts
const whereSql = workspaceRoot !== undefined ? 'WHERE workspace_root IS ?' : '';
```

`undefined` drops the predicate entirely, so the count spans every workspace in
`~/.ptah/state/ptah-dev.sqlite`. `memory-rpc.handlers.ts:270` passes
`params?.workspaceRoot ?? undefined` straight through, so the no-workspace call
lands in exactly that branch. `codeSymbols.count(workspaceRoot)` at `:273` has
the same shape.

Note the tri-state is deliberate elsewhere: `null` means "global/unscoped
memories" (`WHERE workspace_root IS NULL`) and is distinct from `undefined`
meaning "no filter". Any fix must preserve that distinction —
`memory:purgeBySubjectPattern` (`:341-346`) already refuses `undefined`
explicitly, and that refusal is the precedent to follow.

`skillSynthesis:listCandidates`, `cron:list` and `gateway:*` also run unguarded
with no workspace (log:943-950), but those are genuinely global surfaces. Not
defects. Do not "fix" them.

**Files**: `libs/backend/memory-curator/src/lib/memory.store.ts` (:614-640),
`libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts` (:265-280).

---

## Group B — Boot ordering

### B1. Boot-time curator LLM query runs before MCP is up

**Severity: medium.** Unrequested token spend, and the query runs tool-less.

log:611 enqueues a session for synthesis with `"source":"boot"`. log:613-624
then drives a real LLM query through `SdkQueryRunner`, and log:618 warns:

```
[WARN] [SdkQueryRunner] MCP disabled (server not running)
```

MCP only comes up at log:682 (`[SubsystemBringUp] Starting MCP server...`,
port 51820 at log:686). So the boot query is issued before
`bringUpSubsystems` and gets `mcpServerRunning: false`
(visible in the log:614 payload), while the second identical query at log:907
— after bring-up — correctly gets `mcpServerRunning: true, mcpPort: 51820`.

Two problems, and they are separable: the ordering (a boot-triggered query
should either wait for MCP or declare it does not need it), and the fact that
boot alone spends tokens with no user action.

**Files**: `apps/ptah-electron/src/activation/wire-runtime.ts` (bring-up order,
:372-385), the skill-synthesis boot enqueue path, `SdkQueryRunner`.

### B2. Two renderer messages dropped before the window exists

**Severity: low.** Silent loss, not a crash.

log:612 and 653: `[IpcBridge] Cannot send to renderer: no window available`,
from `apps/ptah-electron/src/ipc/ipc-bridge.ts:123`. Boot events fired before
the `BrowserWindow` is created in `post-window.ts`. The message is discarded,
not queued. Determine what the two events were and whether either matters — if
neither does, the fix may be to stop emitting them that early rather than to
add a queue.

**Files**: `apps/ptah-electron/src/ipc/ipc-bridge.ts` (:123),
`apps/ptah-electron/src/activation/post-window.ts`.

---

## Group C — Misreported outcomes and noise

### C1. `unrecognized_model` on session-title generation

log:644 and 922, both via SDK stderr:

```
[claude-code:unrecognized_model] {"model":"deepseek-v4-flash:0731-cloud","query_source":"generate_session_title"}
```

The tier mapping resolves `haiku` to the Ollama Cloud id correctly (log:615,
`Resolved 'haiku' → 'deepseek-v4-flash:0731-cloud' via ModelResolver`), but
`generate_session_title` hands that raw provider id to the CLI, which does not
recognise it. Titles are presumably not being generated. Confirm the
user-visible symptom before choosing a fix.

### C2. Cron reports success for drains that did nothing

Four pairs — log:680/683, 1126/1127, 1130/1131, 1168/1169 — each of the form:

```
[DEBUG] [skill-synthesis] drain skipped: {"tier":"frequent","reason":"daily-token-budget-exhausted"}
[DEBUG] [cron-scheduler] run succeeded: {"jobId":"@ptah/skills-drain-frequent","runId":"..."}
```

Roughly once a minute. The runner cannot distinguish "did the work" from "did
nothing because the budget is gone", so `cron:runs` history is misleading
exactly when a user would go looking for why synthesis stopped. A skipped run
needs its own outcome state.

**Files**: `libs/backend/cron-scheduler/` (run store + job runner),
`libs/backend/skill-synthesis/` (drain service).

### C3. Worker heap over its stated budget, no action

log:905: `[Ptah Electron] Worker heap after warmup: 246.0 MB (budget: 200 MB)`.
23 percent over, logged and ignored. Either the budget is wrong and should be
raised deliberately, or exceeding it should do something. Decide which.

### C4. Repeated ENOENT for a broken skills.sh install

log:793, 844, 1012 — once per `plugins:list-available`:

```
[DEBUG] [PluginLoaderService] Skipping skill without a readable SKILL.md:
{"path":"C:\\Users\\abdal\\.ptah\\plugins\\ptah-skillssh-oso95-scroll-world\\skills\\scroll-world\\SKILL.md",
 "error":"ENOENT: no such file or directory, ..."}
```

A skills.sh install left a directory tree with no `SKILL.md`. Two questions:
why did the install leave a half-tree (`skills-sh` staging is supposed to verify
at least one readable slug before moving — see the rpc-handlers CLAUDE.md
"skills.sh source roots" section), and should a permanently-broken root be
reported once rather than on every list call.

### C5. AgentDiscovery ENOENT bypasses the logger

log:849, 873, once per `autocomplete:agents`:

```
[AgentDiscovery] Directory C:\Users\abdal\.claude\agents not accessible: ENOENT: ...
```

No `[DEBUG]`/`[INFO]` prefix — this is a raw `console` write, unlike every
other line in the log. A missing `~/.claude/agents` is the normal case for a
user who has never made a user-level agent; it should not be a per-call
console emission.

### C6. Harness reconcile runs twice at boot with the same warning

log:654-655 (`reason: activation`) and log:661-663
(`reason: content-download-complete`) — two full six-target passes back to
back, both reporting the identical `blocked: 13` list under `.claude/skills/*`,
both `found: 106/119`.

The refusal behaviour is **correct** and must not change: Ptah will not touch a
file it cannot prove it wrote, and the second pass is a legitimate re-run after
content download. The question is only whether the second pass needs to re-emit
the full thirteen-path warning payload when nothing changed between them.

### C7. sqlite-vec primary resolver fails on every boot

log:568-586. Overall `ok: true` — the fallback
(`require-resolve-platform-pkg`) loads `vec0.dll` fine (log:560). But the
primary resolver's failure prints as a full multi-line diagnostic block naming
two paths that do not exist under Electron. Expected-path failures should not
look like errors.

---

## Constraints for implementers

- **Windows absolute paths** for every Read/Write — there is a Claude Code bug
  with relative paths in this workspace.
- `.ptah/**` is gitignored. An overwrite there has no undo.
- Hexagonal rule holds: backend libs depend on `platform-core` ports, never on
  `platform-{vscode,electron,cli}` adapters. A1 touches `agent-sdk`, which must
  not learn about Electron.
- Frontend must not import backend libs (A2). `libs/shared` is the one bridge.
- `catch (error: unknown)`, narrow with `instanceof Error` before `.message`.
- Every behavioural fix needs a test that fails before it and passes after.
  A1, A3 and C2 are all "the wrong thing happened silently" — a test is the
  only thing that stops them recurring.
- Do not bypass commit hooks. If one fails, stop and report.

## Out of scope

- Changing the `tasks:*` namespace-wide workspace guard (`resolveRoot`) — it is
  correct.
- Gating `skillSynthesis:listCandidates`, `cron:list` or `gateway:*` on a
  workspace — they are global by design.
- Changing harness-sync's refusal-on-unowned-path rule (C6 is about log volume
  only).
- Resolving the user's own thirteen blocked `.claude/skills/*` paths. That is a
  data condition on this machine, not a code defect.
