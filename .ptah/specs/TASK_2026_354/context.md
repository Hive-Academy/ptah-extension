# TASK_2026_354 — Boot log hygiene

Five independent faults found in the 2026-08-28 boot log
(`tmp/logs/log.log`). They share a symptom class (noisy or misleading log
output) but not a cause, so each is diagnosed and fixed separately.

## 1. `CodeExecutionMCP server started` logged twice

### Evidence

```
550  [WARN] MCP port 51820 unavailable (EADDRINUSE), retrying with 51821
551  [INFO] CodeExecutionMCP server started on http://localhost:51821: CodeExecutionMCP
552  [INFO] CodeExecutionMCP server started on http://localhost:51821: CodeExecutionMCP
```

Two lines, one server, the SAME port on both. So this is not two servers —
it is one `'listening'` event delivered to two listeners.

### Root cause

`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:55-85`
(`tryListen`).

`startHttpServer` creates ONE `http.Server` and then calls `tryListen` once per
port candidate against that same object. `tryListen` passes its success
callback as the third argument of `server.listen(port, host, cb)`, which Node
registers as a one-time `'listening'` listener.

On the failing attempt the `'error'` listener is removed but the
`'listening'` listener is not — it never fired, so `once` never consumed it. It
stays attached to the shared server. When the next candidate binds
successfully, the single `'listening'` event is delivered to BOTH the leftover
listener from attempt 1 and the one from attempt 2.

Consequences: `logger.info` runs once per ATTEMPTED port (2 attempts → 2
lines, which is exactly what the log shows), and so does
`workspaceState.update('ptah.mcp.port', actualPort)`. `resolve` is called twice
too, harmlessly, because a settled promise ignores the second call — which is
why the defect stayed invisible.

The count is a function of attempts, so a machine that fell back twice would
print the line three times.

### Fix

Attach the success handler explicitly (`server.on('listening', …)`) alongside
the error handler and remove BOTH on either outcome, so a failed attempt leaves
nothing behind on the shared server.

## 2. `.mcp.json` rewritten in the user's repo on every workspace switch

### Evidence

```
1142 [INFO] [CodeExecutionMCP] Unregistered ptah from D:\projects\qa3elhamor\.mcp.json
1143 [INFO] [CodeExecutionMCP] Registered ptah in D:\projects\property-hub\.mcp.json (port 51821)
```

Repeated at 1546-1547, 1733-1734, 2000-2001, 2088-2089, 2176-2177 — six moves
in one session, each a write into a file inside a repository the user owns and
has under version control.

### Root cause

Two files together:

- `libs/backend/vscode-lm-tools/.../http-mcp-server.service.ts:608` —
  `getMcpJsonPath()` resolves through `IWorkspaceProvider.getWorkspaceRoot()`,
  i.e. the ACTIVE folder, and the service tracks exactly ONE owned entry
  (`registeredMcpJsonPath`). `syncMcpJsonRegistration` (line 355) therefore
  reads "target != registered" and MOVES the entry: unregister old, register
  new.
- `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:171`
  — `setActiveFolder()` fires `onDidChangeWorkspaceFolders`, and
  `libs/backend/rpc-handlers/src/lib/handlers/workspace-rpc.handlers.ts:329`
  calls it on every `workspace:switch`.

So a tab switch between two ALREADY-OPEN folders fires the folder-change event
even though the folder SET did not change, and the service dutifully moves the
entry. Both repositories are open; only one is allowed to advertise the server
at a time, for no reason the user can observe.

### Fix

Track one registration per OPEN workspace folder instead of one for the active
root: `registrations: Map<mcpJsonPath, port>`, reconciled against
`getWorkspaceFolders()`.

- A folder in the set that we do not own yet gets an entry (register).
- A folder we own that has left the set gets its entry removed (unregister).
- A switch between open folders changes neither set, so it writes nothing.

Plus read-compare-write inside `registerInMcpJson`: if the `ptah` entry already
on disk deep-equals the desired one, skip both the write and the log line. That
also removes the redundant write when the same folder is re-registered after a
port-preserving restart.

`ensureRegisteredForSubagents()` keeps its existing contract and reports on the
ACTIVE root (that is the root a session is about to spawn in); the other open
folders are reconciled in the same pass.

The `mcpOpQueue` / `repointGeneration` / `stopped` machinery from TASK_2026_332
is KEPT. Serialization is still needed (the map and the disk are mutated
together) and `stop()` cancellation is still needed. Set-reconcile happens to
make the "stranded intermediate workspace" race structurally impossible as
well, but the queue is what stops two reconciles interleaving.

## 3. Port-fallback warning does not say who holds the port

### Evidence

```
550  [WARN] MCP port 51820 unavailable (EADDRINUSE), retrying with 51821
```

"retrying with" describes an attempt, not an outcome — a reader cannot tell
from this line whether 51821 worked. And nothing points at the overwhelmingly
likely cause: a second Ptah instance (Electron app + VS Code extension, or two
Electron windows) already listening on the default port.

### Root cause

`http-server.handler.ts:137-139` — the message is attempt-shaped and
cause-free.

### Fix

Name the likely holder and state the chosen port as a fact, once the fallback
has actually succeeded. `EADDRINUSE` and `EACCES` get different causes:
in-use means another Ptah instance; `EACCES` on Windows is an OS-reserved
range, not a peer.

## 4. Broken plugin surfaces only as a DEBUG line

### Evidence

```
740  [DEBUG] [PluginLoaderService] Skipping skill without a readable SKILL.md:
     {"path":"C:\\Users\\abdal\\.ptah\\plugins\\ptah-skillssh-oso95-scroll-world\\skills\\scroll-world\\SKILL.md","code":"ENOENT",…}
```

`plugins:list-available` immediately after reports `{"pluginCount":10}` with no
indication that one of those ten is unusable. The plugin renders in the browser
modal as a normal entry with `skillCount: 0`.

### Root cause

`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1169`
(`reportUnreadableSkill`) — deliberately DEBUG, with a comment arguing "the
user cannot act on a log line either way". That reasoning is right about the
LOG and wrong about the conclusion: the user CAN act (uninstall or reinstall
the skill), they just need it on a surface they look at. The RPC payload is
that surface, and it carried nothing.

`discoverSkillsForPlugins` (line 1099) drops the failure on the floor — it
`continue`s, so the caller building `PluginInfo` never learns a skill directory
was skipped.

### Fix

- Split an internal `scanPluginSkills(paths) → { skills, issues }` out of
  `discoverSkillsForPlugins`, which keeps its signature and returns `.skills`.
- Add `status: 'ok' | 'broken'` and `issues?: PluginHealthIssue[]` to
  `PluginInfo` (`libs/shared/src/lib/types/rpc/rpc-misc.types.ts`), optional so
  legacy payloads still parse.
- All four `describe*` producers stamp the status from the scan.
- Promote `reportUnreadableSkill` to `warn`. The per-path/per-errno dedupe from
  TASK_2026_315 C4 stays, so this is one warn per broken path per failure mode,
  not one per call.

## 5. Em dashes print as `â€”`

### Evidence

```
632  … "note":"No env credentials â€” SDK will use CLI credential store"
692  [INFO] [SdkQueryRunner] SDK options built â€” launching query: …
```

But in the SAME log, from the same console:

```
1017 [INFO] [memory-curator] boot-scan cold start — bounded to the last 7 days
     [DEBUG] [task-specs] index rebuild write skipped — store not ready yet
```

renders correctly. So the console is NOT the variable. The difference is the
source bytes.

### Root cause

The corruption is baked into the SOURCE FILES, not introduced at print time:

| file                                                        | bytes for the dash                |
| ----------------------------------------------------------- | --------------------------------- |
| `agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:267` | `c3 a2 e2 82 ac e2 80 9d` → `â€”` |
| `agent-sdk/src/lib/helpers/sdk-model-service.ts`            | `c3 a2 e2 82 ac e2 80 9d` → `â€”` |
| `memory-curator/src/lib/triggers/boot-scan-runner.ts`       | `e2 80 94` → `—` (correct)        |

`c3 a2 e2 82 ac e2 80 9d` is UTF-8 for the three characters `â` `€` `”` — a
UTF-8 em dash that was once decoded as CP1252 and re-encoded as UTF-8. Some
past edit went through a pipe with the wrong codepage and the double-encoded
result was committed.

A repo-wide byte scan (excluding `.claude-worktrees`, `node_modules`, `dist`)
finds **344 occurrences across 65 `.ts` files**. This is not a vscode-lm-tools
problem and it is not fixable by repairing two strings; and most of those files
are being edited concurrently by other tasks (349/350/352/353 in agent-sdk
alone), so editing them here is out of bounds.

### Fix

Repair at the single point where a log line reaches the console, not at 344
call sites. `Logger.writeToConsole`
(`libs/backend/vscode-core/src/logging/logger.ts:322`) is the one console writer
for every host, Electron main included, and the fix touches no log string in
any other lib — which is the constraint this task set.

New pure helper `libs/backend/vscode-core/src/logging/console-text.ts`:

1. **Repair** the known double-encoded sequences back to the character that was
   meant (`â€”` → `—`, `â€™` → `’`, …). Longest-first so `â€”` is not eaten by a
   shorter prefix.
2. **Fold** a curated set of typographic punctuation to ASCII (`—` → `-`, `’` →
   `'`, `…` → `...`), so the line also renders on a legacy console codepage.

Deliberately narrow: only typographic punctuation is folded. Accented
characters, CJK and anything else non-ASCII pass through untouched — a log line
quoting a user's file path must not be mangled to make a dash pretty. The
file-backed `IOutputChannel` write is left alone; it is UTF-8 and correct.

## Files

| file                                                                        | change                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `libs/backend/vscode-lm-tools/.../mcp-http/http-server.handler.ts`          | listener leak; fallback warning wording                        |
| `libs/backend/vscode-lm-tools/.../mcp-http/http-server.handler.spec.ts`     | single-start-log test; new warning text                        |
| `libs/backend/vscode-lm-tools/.../mcp-http/http-mcp-server.service.ts`      | per-folder registrations; read-compare-write                   |
| `libs/backend/vscode-lm-tools/.../mcp-http/http-mcp-server.service.spec.ts` | multi-folder + no-op-write tests                               |
| `libs/backend/vscode-lm-tools/CLAUDE.md`                                    | ownership rule now reads "per open folder"                     |
| `libs/shared/src/lib/types/rpc/rpc-misc.types.ts`                           | `PluginHealthStatus`, `PluginHealthIssue`, `PluginInfo.status` |
| `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`           | `scanPluginSkills`; status stamping; warn level                |
| `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.spec.ts`      | broken-plugin status tests                                     |
| `libs/backend/vscode-core/src/logging/console-text.ts`                      | new — mojibake repair + ASCII fold                             |
| `libs/backend/vscode-core/src/logging/console-text.spec.ts`                 | new                                                            |
| `libs/backend/vscode-core/src/logging/logger.ts`                            | apply the helper in `writeToConsole`                           |

## Plan

1. `http-server.handler.ts`: fix the listener leak, reword the fallback warning.
2. `http-mcp-server.service.ts`: replace the single-path registration record
   with a per-folder map + set reconcile; add read-compare-write.
3. `rpc-misc.types.ts` + `plugin-loader.service.ts`: surface broken plugins.
4. `console-text.ts` + `logger.ts`: repair and fold console text.
5. Tests for each; `run-many -t test` and `-t typecheck` over the touched
   projects.

## Acceptance criteria

- One `CodeExecutionMCP server started` line per successful start, whatever the
  number of port attempts. `ptah.mcp.port` written once.
- The port-fallback warning names the likely holder and states the chosen port.
- Switching between two open workspace folders performs NO `.mcp.json` write
  and emits no register/unregister line.
- Registering when disk already holds the identical `ptah` entry performs no
  write and emits no line.
- Removing a folder from the workspace removes its `ptah` entry; `stop()`
  removes every remaining owned entry.
- A plugin with an unreadable `SKILL.md` comes back from
  `plugins:list-available` with `status: 'broken'` and a populated `issues`
  array, and is reported at WARN once per path per errno.
- A log message containing `â€”` reaches the console as `-`; a message with a
  real `—` also reaches it as `-`; non-punctuation non-ASCII is untouched.

## Test projects

`@ptah-extension/vscode-lm-tools`, `@ptah-extension/agent-sdk`,
`@ptah-extension/vscode-core`, `@ptah-extension/shared`.

## Implementation notes

### 1. Duplicate start line

`tryListen` now attaches the success path as an explicit `'listening'` listener
and removes BOTH listeners on either outcome, instead of handing the callback to
`server.listen(port, host, cb)`. Confirmed the diagnosis rather than assuming
it: the count is a function of ATTEMPTS, and the regression test asserts one
`server started` line and one `ptah.mcp.port` write after a real EADDRINUSE
fallback against a real socket.

### 2. `.mcp.json`

Ownership moved from `registeredMcpJsonPath: string | null` to
`registrations: Map<mcpJsonPath, port>`, reconciled against
`getWorkspaceFolders()` ∪ the active root. `unregisterFromMcpJson` takes a path
argument; `stop()` drains every owned path through a new
`unregisterFromAllMcpJson`. `registerInMcpJson` compares the `ptah` key on disk
against the entry it would write (structurally, so field order does not force a
rewrite) and skips the write AND the log line when they match.

The queue, the generation counter and the `stopped` flag from TASK_2026_332 are
untouched — set-reconcile removes one of the two races structurally, but
serialization of the map+disk mutation and `stop()` cancellation are still
load-bearing. All six re-pointing-queue specs pass unchanged.

**One deliberate behaviour change to an existing test.** TASK_2026_332's
"does not register in the new workspace when the old entry could not be removed"
enforced a coupling that only existed because the single slot meant a write to B
DESTROYED the record that A still held an entry. Per-path records make that
impossible, and keeping the coupling would now report `mcpServerRunning: false`
for a session in an open folder whose entry is on disk and usable, because an
unrelated CLOSED folder's config file was contended. The test was rewritten to
assert the invariant that actually matters and is now strictly stronger: the
failed removal's record SURVIVES, the open folder is registered and reported
honestly, and the retry at `stop()` cleans A up.

`http-mcp-server.service.ts` is now 724 lines, just over the 700-line warn
ceiling. Not split: the growth is documentation of the ownership rule, and the
extractable piece (`reconcileRegistrations` + the two mutation helpers) is the
class's whole reason for existing — pulling it out would be fragment sprawl, not
a facade.

### 3. Port fallback warning

Restructured from one warning per ATTEMPT to one warning per START, emitted
after the outcome is known so it can name the port actually chosen. `EADDRINUSE`
and `EACCES` get different likely causes — a peer Ptah instance versus an
OS-reserved range — because blaming a process for a Hyper-V excluded port range
sends the reader hunting for something that does not exist. ASCII only, asserted
by the spec.

### 4. Broken plugin

`scanPluginSkills` is the new private body; `discoverSkillsForPlugins` keeps its
signature and returns `.skills`, so its six callers are untouched. All four
`PluginInfo` producers stamp `status` / `issues`. `reportUnreadableSkill` is
WARN now, with the TASK_2026_315 C4 per-path/per-errno dedupe intact — the log
memo is deliberately NOT allowed to leak into the payload, which has its own
test: a panel opened twice must render the broken badge both times.

Backend-only, as scoped. `PluginInfo.status` is optional and additive, there is
no Zod schema over that result, and no frontend lib was touched — rendering the
badge in the plugin browser modal is a frontend follow-up.

### 5. Mojibake

The stated cause (console encoding) turned out to be wrong, and the evidence is
in the same log: `boot-scan cold start — bounded` renders correctly two lines
away from `SDK options built â€” launching query`. Byte inspection showed the
corruption is in the SOURCE — `c3 a2 e2 82 ac e2 80 9d`, a UTF-8 em dash decoded
as CP1252 and re-encoded — in **344 places across 65 `.ts` files**, most of them
in libs other tasks are editing right now.

So the repair went to `Logger.writeToConsole` (`vscode-core`), the single console
writer for every host including Electron main, via a new pure
`sanitizeConsoleText`. Two passes: repair the double-encoded sequences, then fold
typographic punctuation to ASCII so the line also survives a legacy console
codepage. The output-channel path is deliberately NOT sanitised — that file is
UTF-8 and should hold what was written — and the fold is restricted to a curated
punctuation set, so accented letters, CJK and emoji in a user's paths pass
through untouched.

This treats the symptom at the right layer. Repairing the 65 source files
remains worth doing and belongs in its own task, since it is a mechanical
whole-repo pass that would collide with every concurrent edit.

### Verification

- `npx nx run-many -t test -p @ptah-extension/vscode-lm-tools
@ptah-extension/agent-sdk @ptah-extension/vscode-core @ptah-extension/shared
--skip-nx-cache` → header `Successfully ran target test for 4 projects`;
  3773 tests passed, 1 skipped, 0 failed.
- `npx nx run-many -t typecheck -p` the same four → 0 errors.
- `npx nx run-many -t lint -p @ptah-extension/vscode-lm-tools
@ptah-extension/vscode-core` → 0 errors (pre-existing warnings only).
