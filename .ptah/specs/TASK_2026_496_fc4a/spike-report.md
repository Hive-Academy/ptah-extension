# PASS

Gate 0 of the MCP Apps host work is open. Ptah can own the only upstream
connection to a third-party MCP server and hand that same server to the vendor
agent SDK again as an in-process SDK server. The model lists and calls the tools
through the SDK server, the names stay `mcp__<server>__<tool>`, `canUseTool`
still runs, and the host keeps the tool `_meta`, the resource list and the
resource bodies that the SDK path does not expose.

The PASS carries one mandatory condition, proved by experiment in A6 below:
**the session must set `strictMcpConfig: true`.** Without it, a settings-file
server with the same name starts a SECOND upstream process, silently, and takes
the name in `mcpServerStatus()`. That is the rejected two-connection state. It
arrives by default, not by choice. Ptah does not set this option today.

---

## 1. Environment

| Item                             | Value                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| Worktree                         | `<repo-root>` (branch `lane-b/task-496-497-spikes`) |
| Branch                           | `lane-b/task-496-497-spikes`                                       |
| `@anthropic-ai/claude-agent-sdk` | 0.3.278 (the root `package.json:101` pin)                          |
| `@modelcontextprotocol/sdk`      | 1.30.0, resolved from the root `package.json:111` range `^1.29.0`  |
| `zod`                            | 4.6.5 (the root `package.json:198` pin)                            |
| Node                             | v24.15.0                                                           |
| Model used for the live turns    | `claude-haiku-4-5-20251001`                                        |

The root `package.json` was not touched. Its MD5 before and after the spike is
`36673466c22d6df8e289a1129406e392`. The spike has its own `package.json` inside
`.ptah/specs/TASK_2026_496_fc4a/spike/`, and its `node_modules/` is gitignored.

**The task prompt's line numbers are from an older SDK build.** Every reference
below was re-read in this worktree at 0.3.278. See section 5.

## 2. How to run

```
cd .ptah/specs/TASK_2026_496_fc4a/spike
npm install
node run-host.mjs         # A1, A2, A3, A5, A6a. No model turn. Exits 0 on success.
node run-model.mjs        # A4. One real query() turn.
node run-collision.mjs    # A6. Two real query() turns.
node run-skills-check.mjs # Cost of strictMcpConfig. Breaks at init, no turn billed.
node run-dynamic.mjs      # D1, D2. No model turn.
```

`spike/README.md` describes each file. The fake upstream server writes one JSONL
record per `initialize`, `close`, `tools/call` and `resources/read` to
`out*/upstream.jsonl`, so "how many live transports" is counted, not asserted.

## 3. Assertions and results

### A1 - exactly ONE live upstream transport for one configured server

PASS. `node run-host.mjs`, real output:

```
PASS  A1  Exactly one live upstream session after connect
      initialize=1 close=0 live=1 session=85bc819a-50d6-4c71-9108-f18de0b32c9a
PASS  A1b  Still exactly one live upstream session after the model path call
      live=1 sessions seen=1
PASS  A1c  A second upstream transport for the same server is refused
      error = broker already connected: refusing a second upstream transport
PASS  A1d  No upstream session is left alive after teardown
      initialize=2 close=2
```

Live count = count(`initialize`) - count(`close`), taken from the fake server's
own log. The session ID is a UUID that the fake server generates once per
process, so the count tracks sessions, not only PIDs.

### A2 - close before replace on reconnect

PASS.

```
PASS  A2a  Reconnect closes the old session BEFORE the new session starts
      order = initialize:85bc819a -> close:85bc819a -> initialize:c81b70b8
PASS  A2b  Exactly one live upstream session after reconnect
      live=1 distinct sessions ever=2
```

`SingleOwnerBroker.reconnect()` awaits `close()` before `connect()`
(`spike/broker.mjs`, `reconnect`). The ordering is read back from the upstream
log, not from the broker's own bookkeeping.

### A3 - the host sees tool `_meta`, and lists and reads resources

PASS. These are exactly the capabilities the SDK path does not give the host.

```
PASS  A3a  Host lists tools WITH _meta
      spike_remember._meta = {"openai/outputTemplate":"ui://spike/card.html",
      "spike/uiResource":"ui://spike/card.html","spike/ownerSession":"85bc819a-..."}
PASS  A3b  Host lists resources
      resources = ui://spike/card.html, spike://memory
PASS  A3c  Host reads a resource
      read ui://spike/card.html -> <!doctype html><p data-session="85bc819a-4c...
```

For contrast, the same server as the vendor SDK reports it, from
`node run-model.mjs`:

```
--- mcpServerStatus(): [
  { "name": "spike", "status": "connected",
    "serverInfo": { "name": "spike", "version": "0.0.0" },
    "scope": "dynamic", "source": "sdk",
    "tools": [ { "name": "spike_remember", "annotations": {} },
               { "name": "spike_recall",  "annotations": {} } ] } ]
```

No `_meta`. No resources. No tool description in this build. The host cannot
build an MCP Apps surface from `mcpServerStatus()`. It needs the owned client.

### A4 - the model lists and calls tools through the in-process SDK server

PASS, with a real `query()` turn. `node run-model.mjs`, real output:

```
--- tool_use blocks the model emitted:
[ { "name": "ToolSearch", "input": { "query": "select:mcp__spike__spike_remember,mcp__spike__spike_recall" } },
  { "name": "mcp__spike__spike_remember", "input": { "value": "model-turn" } },
  { "name": "mcp__spike__spike_recall",   "input": {} } ]
--- canUseTool invocations:
[ { "toolName": "mcp__spike__spike_remember", "input": { "value": "model-turn" } },
  { "toolName": "mcp__spike__spike_recall",   "input": {} } ]
--- upstream tools/call records:
[ { "session": "36e3654f-...", "pid": 42532, "role": "broker-owned", "tool": "spike_remember" } ]
--- distinct upstream sessions: 1 [ '36e3654f-b87e-413e-b476-8977be4bad93' ]
--- assistant text:
**mcp__spike__spike_remember result:** stored:model-turn session:36e3654f-... calls:1
**mcp__spike__spike_recall result:**   denied by the spike canUseTool gate
```

Four facts in that output:

1. The tool names are `mcp__spike__spike_remember` and `mcp__spike__spike_recall`.
   The `mcp__<server>__<tool>` identity survives the re-exposure, because the SDK
   server is created with the upstream server name.
2. `canUseTool` ran for both calls. The permission flow is intact.
3. The spike denied `spike_recall`. The upstream log has NO `tools/call` record
   for it. A denial stops the call before the upstream server sees it.
4. One upstream session served the whole turn.

### A5 - the re-exposed server is a real MCP server, and both paths share state

PASS.

```
PASS  A5a  createSdkMcpServer returns type "sdk" with a live instance, named after upstream
      type=sdk name=spike instance=yL
PASS  A5b  Model path lists the tools through the SDK server
      tools = spike_remember, spike_recall
PASS  A5c  Model path calls a tool through the SDK server
      result = stored:written-by-model-path session:85bc819a-... calls:1
PASS  A5d  Host resource read sees the model path write (one session, one memory)
      spike://memory = {"memory":"written-by-model-path","session":"85bc819a-...","calls":1}
```

A5d is the state-consistency check. The fake server is stateful on purpose. A
write through the model path is visible through the host's resource read, and
both report the same session ID. Two processes would give two memories.

### A6 - a settings-file server with the same name as a broker registration

PASS for the implemented behaviour, and it records a real hazard.

**What I implemented: the broker refuses to start.** `assertNoSettingsCollision`
(`spike/broker.mjs`) scans the settings sources for a name the broker owns and
throws. `run-host.mjs`:

```
PASS  A6a  Same-name settings server makes the broker refuse to start (fail closed)
      error = MCP name collision, refusing to start: settings files declare spike,
              which the broker owns. Rename the settings entry or remove it.
```

I did NOT implement "the broker-owned registration wins", because the experiment
below shows that the SDK does not let the host claim that outcome by name alone.

**What the SDK does without help.** `node run-collision.mjs` builds a project
whose `.mcp.json` declares a stdio server also called `spike`, then starts a
session that also passes the broker's SDK server under that name.

S1, `settingSources: ['project']`, `strictMcpConfig` unset:

```
settings-file copy spawned an upstream process: true
tool calls served by role(s): broker-owned
mcpServerStatus() entry for "spike":
  { "name": "spike", "status": "connected",
    "serverInfo": { "name": "fake-upstream", "version": "1.0.0" },
    "config": { "type": "stdio", "command": "...node.exe", "args": ["...fake-mcp-server.mjs"] },
    "scope": "project", "source": "project", ... }
```

The raw upstream log for S1 shows both processes alive at the same time:

```
broker-owned   c9a84812 30796   initialize
broker-owned   c9a84812 30796   tools/list
settings-file  e5504643 19488   initialize
settings-file  e5504643 19488   tools/list
settings-file  e5504643 19488   resources/list
broker-owned   c9a84812 30796   tools/call spike_remember
settings-file  e5504643 19488   close stdin-end
broker-owned   c9a84812 30796   close stdin-end
```

That is the rejected design, reached by accident: two stdio processes, two
memories, and a status surface that describes the wrong one. No error was
raised. Note the mismatch - the tool call went to the broker-owned process while
`mcpServerStatus()` reported the settings-file process under the same name. The
host cannot trust the name.

S2, the same project, with `strictMcpConfig: true`:

```
settings-file copy spawned an upstream process: false
tool calls served by role(s): broker-owned
mcpServerStatus(): [ { "name":"spike", "status":"connected",
    "serverInfo":{"name":"spike","version":"0.0.0"}, "scope":"dynamic", "source":"sdk", ... } ]
assistant text: stored:collision-probe session:1a4b0443-... / Project Magic Token: PTAH-SPIKE-7731
```

Summary block from the same run:

```
{ "s1_settingsSpawned": true,  "s1_servedBy": ["broker-owned"],
  "s2_settingsSpawned": false, "s2_servedBy": ["broker-owned"],
  "s2_projectInstructionsStillLoaded": true,
  "s3_refused": true }
```

So with `strictMcpConfig: true` the broker-owned registration wins outright, one
process runs, and the project `CLAUDE.md` is still in context. The
`source: "sdk"` field is the trust signal. The SDK's own comment says to key
trust on `source`, not on the name (`sdk.d.ts:1195`, field at `:1197`).

**Belt and braces.** Both halves are needed. `strictMcpConfig` makes the
broker-owned registration win. The preflight refusal is the second half, because
`strictMcpConfig` is a session option that a future code path can forget to set,
and because a user who declared `spike` in `.mcp.json` expects that server to
work. A clear refusal is better than a silent replacement of the user's
configuration.

### A6-cost - does `strictMcpConfig` cost project instructions, skills or plugins?

`node run-skills-check.mjs` reads the `system`/`init` message and stops before a
model turn:

```
===== strictMcpConfig unset =====
mcp_servers: [firecrawl(project), davinci-resolve(project), ptah(project), spike(project),
              claude.ai Claude Docs(claudeai), ... ]
slash_commands includes spike-cmd: true
skill surface: ["spike-skill","agent-lanes","angular-3d-scene-crafter", ...]
tools includes Skill: true
plugins: [{"name":"agents-md","path":"builtin","source":"agents-md@builtin"}]

===== strictMcpConfig true =====
mcp_servers: []
slash_commands includes spike-cmd: true
skill surface: ["spike-skill","agent-lanes","angular-3d-scene-crafter", ...]
tools includes Skill: true
plugins: [{"name":"agents-md","path":"builtin","source":"agents-md@builtin"}]
```

`strictMcpConfig: true` removed every settings-file MCP server, including the
`claudeai` proxy servers. It removed nothing else. Skills, project and user slash
commands, the built-in plugin and `CLAUDE.md` (proved by the S2 token echo) all
survived. This answers `context.md` question 2 for skills, commands and
instructions. For plugin-supplied MCP servers see the unknowns.

### D1 - `_meta` survives the SDK re-exposure as well

`node run-dynamic.mjs`, the tool as the in-process SDK server reports it:

```
{ "name": "spike_remember", "description": "Store a value in this session memory.",
  "inputSchema": { ... }, "execution": { "taskSupport": "forbidden" },
  "_meta": { "openai/outputTemplate": "ui://spike/card.html",
             "spike/uiResource": "ui://spike/card.html",
             "spike/ownerSession": "4e8709db-..." } }
```

`_meta` is preserved on the wire out of the SDK server. The host does not depend
on this, because it reads `_meta` from its own client. The fact is recorded
because it means the broker does not have to strip `_meta` before re-exposure.

### D2 - the tool list can change after `createSdkMcpServer()`

```
D2 tools after late registration: spike_remember, spike_recall, spike_added_later
D2 list_changed notifications seen: 1
D2 late tool call result: [{"type":"text","text":"late tool ok"}]
```

The returned `instance` is a live `McpServer` with `registerTool`,
`sendToolListChanged` and `sendResourceListChanged`. A tool added after
construction is listed, is callable, and produces one
`notifications/tools/list_changed`. This answers `context.md` question 4 at the
protocol level. Whether the CLI acts on that notification mid-turn is an unknown.

## 4. Exit criteria from `context.md`

| Criterion                                                      | Result | Evidence     |
| -------------------------------------------------------------- | ------ | ------------ |
| One process and one live upstream session                       | PASS   | A1, A4       |
| Stable tool names                                               | PASS   | A4           |
| The model lists and calls tools through the SDK server          | PASS   | A4, A5b, A5c |
| The host lists tools with `_meta`, lists and reads resources    | PASS   | A3           |
| Metadata and results agree between the two paths                | PASS   | A5d          |
| Permission prompts kept                                         | PASS   | A4           |
| The same-name settings server follows the fail-closed rule      | PASS   | A6           |
| During reconnect, the old session closes before the new starts  | PASS   | A2           |

No criterion needed a second connection to one stdio server. The design under
test has one.

## 5. File and line references, all re-read in this worktree

SDK paths are relative to
`.ptah/specs/TASK_2026_496_fc4a/spike/node_modules/@anthropic-ai/claude-agent-sdk/`
at version 0.3.278. The prompt's numbers are in the third column where they moved.

| Reference                                       | Line in 0.3.278 | Prompt said  | What it shows                                                                                                |
| ----------------------------------------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| `sdk.d.ts` `createSdkMcpServer`                 | `:543`          | `:463`       | Creates an in-process MCP server                                                                             |
| `sdk.d.ts` `CreateSdkMcpServerOptions`          | `:545-576`      | -            | `name`, `version`, `instructions`, `tools`                                                                   |
| `sdk.d.ts` `McpSdkServerConfig` `type: 'sdk'`   | `:1127-1128`    | `:1014`      | The config kind the SDK accepts                                                                              |
| `sdk.d.ts` `McpSdkServerConfigWithInstance`     | `:1139-1141`    | -            | Carries the live `McpServer` instance                                                                        |
| `sdk.d.ts` `McpServerConfig` union              | `:1146`         | -            | An SDK server is a legal `mcpServers` value                                                                  |
| `sdk.d.ts` `McpServerStatus`                    | `:1165-1211`    | `:1036-1076` | name, status, serverInfo, error, config, scope, source, tools. NO `_meta`, NO resources                      |
| `sdk.d.ts` `McpServerStatus.source` comment     | `:1195-1197`         | -            | "Key trust on this, not on the name"                                                                         |
| `sdk.d.ts` `mcpServerStatus()`                  | `:2841`         | -            | The only server surface the SDK gives the host                                                               |
| `sdk.d.ts` `setMcpServers()` and its limitation | `:2981-3001`    | `:2305`      | "Servers configured via settings files are not affected" at `:2989`. Plugin servers are exempt at `:2989-2994` |
| `sdk.d.ts` `SdkMcpToolDefinition`               | `:4988-4995`    | `:3207-3214` | `_meta?: Record<string, unknown>` at `:4993`                                                                 |
| `sdk.d.ts` `tool()` helper                      | `:9228-9232`    | -            | Its `_extras` has no `_meta`. Build the definition object literally                                          |
| `sdk.d.ts` `Options.mcpServers`                 | `:1867`         | -            | -                                                                                                            |
| `sdk.d.ts` `Options.settingSources`             | `:2151`         | `:942`       | When omitted, all sources load                                                                               |
| `sdk.d.ts` `Options.strictMcpConfig`            | `:2200`         | -            | Ignores project `.mcp.json`, user settings, plugins and agent frontmatter MCP                                |

Repository references:

| Reference                                                                      | What it shows                                                            |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:967`       | `mcpServers: configuredMcpServers` (the prompt and the critique said `:916`) |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:970`       | `canUseTool: canUseToolCallback`                                           |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:988-991`   | `settingSources` is `['user','project','local']` or `['project','local']`   |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1508-1539` | `buildMcpServers()` returns only the `ptah` HTTP entry                     |
| `grep -rn "strictMcpConfig" libs/ apps/ --include=*.ts`                         | No hit. Ptah does not set the option today                                 |
| `package.json:101,111,198`                                                     | The version pins in the table above                                        |

The critique's claim is therefore confirmed and sharpened. Ptah has no canonical
server inventory today, and its current `settingSources` value is the exact
configuration under which the A6 / S1 double spawn happens.

## 6. What this does NOT prove

1. **The JSON Schema to Zod conversion.** `SdkMcpToolDefinition.inputSchema` wants
   a Zod raw shape, and an upstream server sends JSON Schema. The spike ships a
   20-line converter for flat string, number and boolean properties
   (`spike/broker.mjs`, `shapeFromJsonSchema`). Real servers send `oneOf`,
   `$ref`, nested objects, arrays, enums and `additionalProperties`. A lossy
   conversion changes what the model may send. This is the largest piece of
   unproved work in the design. The smallest next experiment is to run a
   converter over the tool schemas of three real third-party MCP servers and
   compare the round trip.
2. **Plugin-supplied MCP servers.** No third-party plugin was installed, so the
   only plugin present was the built-in `agents-md`, which ships no MCP server.
   `sdk.d.ts:2989-2994` states that plugin servers are exempt from
   `setMcpServers()` removal, and `:2196-2200` states that `strictMcpConfig`
   ignores plugin MCP config. The second statement is not verified by experiment.
3. **A mid-session `tools/list_changed` that reaches the model.** D2 proves the
   notification leaves the SDK server. It does not prove that the CLI refreshes
   the model's tool list during a turn.
4. **Upstream authorization.** The fake server needs no OAuth. `needs-auth`,
   device-code flows and token refresh through one owned connection are not
   tested. The SDK reports `needs-auth` as a status value (`sdk.d.ts:1173`) and
   gives no host-usable detail beyond it.
5. **Cancellation and progress forwarding.** Not tested. A broker that owns the
   connection must forward `notifications/cancelled` and progress between the SDK
   side and the upstream side. The spike's forwarding handler does neither.
6. **HTTP and SSE upstreams.** Only a stdio upstream was tested. Stdio is the hard
   case for a double spawn, so it is the right first case, not the whole case.
7. **The other vendor SDKs.** `createSdkMcpServer` is Anthropic-specific. Codex,
   Copilot and Cursor need the loopback proxy that Revision 4 defers. Nothing here
   says anything about them.
8. **Concurrency.** One session, one broker. Two Ptah sessions that want the same
   upstream server, and the reference counting that implies, are untested.

## 7. Consequences for the design

1. A single-owner broker is buildable on the pinned SDK. Revision 4's replacement
   for the rejected dual-connection design holds.
2. `strictMcpConfig: true` becomes a requirement of any session that hosts MCP
   Apps, not an option. Ptah must then re-register every settings-file server
   itself through the broker, because that flag removes all of them from the
   agent. That work is on the critical path, and it is larger than "ownership".
   It includes the read of `.mcp.json` and of the user and local settings, which
   the SDK previously did for Ptah.
3. `mcpServerStatus()` is not a host inventory. It has no `_meta` and no
   resources, and under a name collision it described a process that did not
   serve the call. The broker's own client is the only inventory.
4. The JSON Schema to Zod conversion is the first item the next task must prove.
   A silent narrowing of a tool's input schema is a correctness fault that no
   test in this spike would catch.
