# Research Report — TASK_2026_174 (P1: Establish reach)

**Phase**: P1 only — reachability evidence. No fix design, no code.
**Method**: static trace from every candidate entry point to the sink
(`pty.spawn`). Read-only.

**Headline**: The sink is reachable **only from JavaScript already executing in
the Electron renderer**. Every remote and every model-influenced path is
**REFUTED** with citations. Severity is **MODERATE** — normal cadence, not a
release blocker.

**Second headline, and the more decision-relevant one for P2**: `params.shell`
and `params.cwd` have **zero first-party callers**. The only production caller
of `terminal:create` sends `{ name }` and nothing else. Both fields are
vestigial. The input-narrowing delta (acceptance criterion 5) costs nothing.

**Third finding, not in the carrier's list**: a genuinely generic RPC
passthrough exists — `rpc.call` on the CLI stdio surface takes a method name
from untrusted stdin data. It cannot reach `terminal:create` today only because
the CLI host does not register the method. Containment is host-profile
registration, and nothing else. See row 7 and §8.

---

## 1. The reachability table

`Verdict` = CONFIRMED (traced, reaches `terminal:create`) or REFUTED (looked,
cannot). "Reaches" means the RPC method dispatches; the `shell` column records
separately whether that caller can _supply_ the dangerous field.

| #   | Caller / path                                                                        | Entry point (file:line)                                                                                                                                                                                                                                                                                                 | Human?                           | Model-influenced?                                                                   | Can supply `shell`?                                                                                                                                                                                       | Verdict                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Webview terminal UI — user clicks "+" in the terminal tab bar                        | `libs/frontend/editor/src/lib/terminal/terminal-tab-bar.component.ts:91` → `libs/frontend/editor/src/lib/services/terminal.service.ts:150`                                                                                                                                                                              | **Yes** — explicit click         | **No** — payload is the literal `{ name: displayName }` (`terminal.service.ts:153`) | **No** — `shell`/`cwd` never set                                                                                                                                                                          | **CONFIRMED** (reaches RPC; cannot supply `shell`)                                                                                                   |
| 2   | Arbitrary JS in the Electron renderer context (compromised/injected renderer script) | `apps/ptah-electron/src/preload.ts:24-26` → `apps/ptah-electron/src/ipc/ipc-bridge.ts:189`, `:201-219`                                                                                                                                                                                                                  | No                               | n/a                                                                                 | **Yes** — full control of `method` + `params`                                                                                                                                                             | **CONFIRMED** — the real and only attack path                                                                                                        |
| 3   | AI-generated markdown rendered in the webview → JS execution                         | `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:39-51`; preset bound at `apps/ptah-extension-webview/src/app/app.config.ts:190`                                                                                                                                                                           | n/a                              | Yes, but inert                                                                      | **No**                                                                                                                                                                                                    | **REFUTED** — sanitizer forbids `script`/`iframe`/`object`/`embed` and every `on*` handler, so AI content cannot execute JS or forge a `postMessage` |
| 4   | MCP code-execution surface (`execute_code`, `ptah.*` namespaces)                     | Sandbox parameter list fixed at `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution.engine.ts:47-90`; namespaces enumerated at `.../types.ts:32-79`                                                                                                                                                     | No                               | **Yes**                                                                             | **No** — no namespace is terminal/pty/rpc; zero references to `terminal\|PTY_HOST\|IPtyHost\|RpcHandler` in the whole lib                                                                                 | **REFUTED**                                                                                                                                          |
| 5   | Gateway-driven session — inbound Telegram/Discord/Slack                              | `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:133` (`gateway.on('inbound')`) → terminates at `agentAdapter.startChatSession(...)` `:463` / `resumeSession(...)` `:418`                                                                                                                               | **No — remote, non-interactive** | Yes                                                                                 | **No** — constructor injection list `:104-124` contains neither `TOKENS.RPC_HANDLER` nor `PLATFORM_TOKENS.PTY_HOST`; the bridge never calls `handleMessage`                                               | **REFUTED**                                                                                                                                          |
| 6   | Cron scheduler (fires with no human present)                                         | `libs/backend/cron-scheduler/src/lib/job-runner.ts:201-211` (handler-registry lookup), `:212-218` (agent query)                                                                                                                                                                                                         | **No**                           | Yes                                                                                 | **No** — injected deps `:74-85` include no `RPC_HANDLER`/`PTY_HOST`; handler names resolve against an in-process `Map` (`handler-registry.ts:20-30`) and an unknown name throws (`job-runner.ts:207-209`) | **REFUTED**                                                                                                                                          |
| 7   | **`rpc.call` generic passthrough on CLI stdio** (A2A / OpenClaw / CI drivers)        | `apps/ptah-cli/src/cli/commands/interact.ts:549-578` → `libs/backend/cli-engine/src/lib/transport/cli-message-transport.ts:46` → `handleMessage`                                                                                                                                                                        | **No**                           | **Yes**                                                                             | **Method name is fully caller-supplied**, but `terminal:create` is _not registered_ on this host                                                                                                          | **REFUTED** — see §8; the row to re-check if `pty` ever moves                                                                                        |
| 8   | `cli-engine` / `ptah-cli` host surface generally                                     | `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:26-35` (no `pty`); `expected-absent.ts:27`; `rpc-surface.spec.ts:58-59` asserted exactly at `:67-69`                                                                                                                                                           | No                               | Yes                                                                                 | **No** — `register-rpc-surface.ts:103-115` skips entries whose capability is off, so the class is never resolved or registered                                                                            | **REFUTED**                                                                                                                                          |
| 9   | VS Code webview host                                                                 | Reaches the dispatcher at `libs/backend/vscode-core/src/services/webview-message-handler.service.ts:287`, `:409`, but `pty` is off: `apps/ptah-extension-vscode/src/di/expected-absent.ts:61`; methods listed in `VSCODE_EXPECTED_ABSENT_METHODS` at `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:34,157-158` | Yes                              | Yes                                                                                 | **No** — method not registered                                                                                                                                                                            | **REFUTED**                                                                                                                                          |
| 10  | Anthropic HTTP proxy (`ptah proxy`) — network-shaped surface                         | Bound to `127.0.0.1` (`apps/ptah-cli/src/cli/commands/interact.ts:367`, `apps/ptah-cli/src/cli/router.ts:2537`), bearer-gated (`apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts:316-330`), three fixed routes `:286-301`                                                                                    | No                               | Yes                                                                                 | **No** — its only two RPC calls are hardcoded literals: `'chat:start'` (`anthropic-proxy.service.ts:499`) and `'plugins:list'` (`workspace-mcp-collector.ts:116`); runs on the CLI host anyway            | **REFUTED**                                                                                                                                          |
| 11  | `ptah mcp-serve`                                                                     | Fixed wire methods at `apps/ptah-cli/src/cli/commands/mcp-serve.ts:282,291,323,342,352` (`tools/list`, `tools/call`, `notifications/cancelled`, `session.describe`, `session.methods`)                                                                                                                                  | No                               | Yes                                                                                 | **No** — no `rpc.call`, no RPC passthrough                                                                                                                                                                | **REFUTED**                                                                                                                                          |
| 12  | Electron binary IPC terminal channels (`terminal:data-in`, `terminal:resize`)        | `apps/ptah-electron/src/ipc/ipc-bridge.ts:439-450`                                                                                                                                                                                                                                                                      | No                               | Yes (PTY input is writable if a session exists)                                     | **No** — these call only `ptyManager.write()` / `.resize()`; `create()` is unreachable from them                                                                                                          | **REFUTED** as a spawn path                                                                                                                          |
| 13  | Canvas / tribunal / dashboard / any other Angular surface                            | Exhaustive grep for `createTerminal\|'terminal:create'` across `**/*.ts` yields one production frontend caller (`terminal.service.ts:146,152`) and one UI trigger (`terminal-tab-bar.component.ts:91`). Tribunal: `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts` has no dynamic RPC dispatch   | —                                | —                                                                                   | —                                                                                                                                                                                                         | **REFUTED**                                                                                                                                          |
| 14  | Dynamic RPC dispatch from the frontend (method name from data)                       | Grep for `rpcCall(<x>, <non-literal>)` across `libs/frontend/**/*.ts` returns **no matches** — every call site uses a string literal                                                                                                                                                                                    | —                                | —                                                                                   | —                                                                                                                                                                                                         | **REFUTED**                                                                                                                                          |
| 15  | `webview-e2e-harness` postmessage bridge                                             | `libs/frontend/webview-e2e-harness/src/lib/postmessage-bridge.ts:79` — test-only fixture, stubbed backend, never bundled into a shipped host                                                                                                                                                                            | —                                | —                                                                                   | —                                                                                                                                                                                                         | **REFUTED** as a production path                                                                                                                     |
| 16  | Electron e2e spec issuing the method directly                                        | `apps/ptah-electron-e2e/src/specs/pty-manager.spec.ts:77` (also 131, 163, 218, 249, 253, 297, 353)                                                                                                                                                                                                                      | —                                | —                                                                                   | Supplies `cwd` only, never `shell`                                                                                                                                                                        | **CONFIRMED** but inert — whole suite unconditionally skipped at `:35-38`                                                                            |

### Adjacent findings — real, but not this task

Flagged so they are not lost, and explicitly **not** conflated with
`terminal:create`:

1. **Gateway turns run auto-approved.** Inbound Telegram/Discord/Slack messages
   start agent sessions with `permissionLevel: 'yolo'` —
   `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:423`, `:440`,
   `:471`. That is a remote, non-interactive path to the _agent SDK's own_ tool
   surface (Bash and friends), not to node-pty. It does not affect this task's
   severity, but on its face it is a larger exposure than the defect being fixed
   here and deserves its own ticket.
2. **The code-exec sandbox is not a hard sandbox and does not claim to be.**
   `code-execution.engine.ts:24` states "we trust our own code"; it uses
   `AsyncFunction`, not VM2, and does not freeze the realm.
   `({}).constructor.constructor` reaches the real Node `process`. It stops short
   of the sink because `require` is not global (esbuild binds it locally —
   `apps/ptah-electron/esbuild.config.cjs:65`) and nothing assigns the DI
   container onto `globalThis`. Row 4 stays REFUTED, but it is REFUTED by the
   absence of an onward gadget rather than by containment.
3. **Other process-spawn sinks reachable from AI tool calls**: `ptah.agent.spawn`
   → `namespace-builders/agent-namespace.builder.ts:205`; `ptah.git.worktree*` →
   `namespace-builders/git-namespace.builder.ts:65` (spawns `git`);
   `ptah.browser.*` → `services/chrome-launcher-browser-capabilities.ts:22`
   (launches Chrome). All are fixed/allowlisted binaries — the `cli` param is
   constrained to `['codex','copilot','cursor']` at
   `mcp-core/tool-description.builder.ts:513` — and none is node-pty.

---

## 2. Host gating — confirmed; no other profile enables `pty`

`pty` is declared at
`libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts:58`, and the
`terminal` manifest entry requires it at
`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:357-362`
(`requires: ['pty']`).

| Host      | File:line                                                   | State                                                       |
| --------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| Electron  | `apps/ptah-electron/src/rpc-host-profile.ts:40`             | `pty: true` — **the only enablement in the repo**           |
| VS Code   | `apps/ptah-extension-vscode/src/di/expected-absent.ts:61`   | asserted absent                                             |
| CLI + TUI | `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts:27` | asserted absent (both hosts, `rpc-surface.spec.ts:106-114`) |

Carrier's scope claim is **confirmed**: Electron-desktop only, not a VS Code
Marketplace concern.

Enforcement is structural, not by convention: `capabilities()` defaults every
unlisted capability to `false` (`host-profile.ts:83`), and
`register-rpc-surface.ts:103-115` `continue`s past any entry whose capability is
off — so the handler class is never even resolved.

Defence in depth beyond the profile: `PLATFORM_TOKENS.PTY_HOST` is registered in
exactly one place — `apps/ptah-electron/src/di/phase-4-handlers.ts:182` (aliased
to `ELECTRON_TOKENS.PTY_MANAGER_SERVICE`, same instance, `:176-184`) — and
`node-pty` is imported in exactly one file,
`apps/ptah-electron/src/services/pty-manager.service.ts:16`. Even a forced
resolve of `TerminalRpcHandlers` on a headless host would fail DI at
`libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts:42`.

---

## 3. The transport boundary — verified, not assumed

I checked each layer rather than trusting the carrier. **Nothing between the
renderer and `TerminalRpcHandlers` inspects `params`.**

1. **Preload** — `apps/ptah-electron/src/preload.ts:24-26`:
   `postMessage: (message: unknown) => ipcRenderer.send('rpc', message)`.
   Verbatim forward, `unknown` type, zero validation.
2. **Electron IPC bridge** — `apps/ptah-electron/src/ipc/ipc-bridge.ts:189-219`.
   Checks only that the message is an object (`:191`), then extracts `method`
   (`:201`) and `params` (`:202`) via unchecked casts and forwards both
   (`:215-219`). No schema, no allowlist, no param inspection.
3. **`ALLOWED_METHOD_PREFIXES`** —
   `libs/backend/vscode-core/src/messaging/rpc-handler.ts:40-85`.
   This gates **method names at registration time only**. It is consulted by
   `isValidMethodName` (`:258-259`), called from exactly one place:
   `registerMethod` (`:131`). It guards against a _developer_ registering an
   off-namespace handler. `'terminal:'` is on the list at `:68`.
   **It never runs on inbound messages and never touches `params`.**
4. **`handleMessage`** — `rpc-handler.ts:165-214`: bare `this.handlers.get(method)`
   (`:172`) with no caller-identity or capability check, then
   `await handler(params)` at **`:183`** — `params` passed through uninspected.

So the renderer-to-sink path has **no validation layer of any kind**. Carrier
confirmed.

---

## 4. The sink

`apps/ptah-electron/src/services/pty-manager.service.ts`:

- `:82` — `const shell = params.shell || this.getDefaultShell();`
- `:90` — `pty.spawn(shell, [], { name: 'xterm-256color', cwd: params.cwd, cols: 80, rows: 24, env: process.env as Record<string, string> })`
- `:244-249` — `getDefaultShell()`: `win32` → `process.env['COMSPEC'] || 'cmd.exe'`; otherwise `process.env['SHELL'] || '/bin/bash'`.

Preceding checks are **quota only** — 20 total sessions (`:69-73`), 5 per
workspace (`:74-79`). No path check, no existence check, no allowlist.

**Impact bound — the carrier's `[]` observation is correct and it matters.**
The args array is a literal `[]` at `:90`. An attacker therefore controls:

- the **executable path only**, not argv;
- the **working directory** (`params.cwd`, verbatim);
- and inherits the **full parent environment** (`process.env`).

The primitive is "launch any binary that already exists on the system, with no
arguments, in a directory of your choosing". That is materially weaker than
arbitrary command-line execution — you cannot pass `-c "curl … | sh"`. It is
still serious: a bare name resolves through `PATH`, Windows `CreateProcess`
accepts UNC paths, and cwd control plus a no-arg spawn is the classic
DLL-sideloading setup on Windows. **P2 should state this bound honestly rather
than claiming arbitrary command execution.**

`params.cwd` reaches the spawn through
`libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts:62`
(`params?.cwd || wsRoot || homedir()`) with no containment.

---

## 5. Current accepted values — the before/after narrowing delta (AC 5)

**Accepted today**: _any string whatsoever_, plus `undefined`. The type is
`shell?: string` (`libs/shared/src/lib/types/rpc/rpc-terminal.types.ts:10`), and
the port repeats it
(`libs/backend/platform-core/src/interfaces/pty-host.interface.ts:14`). There is
no `terminal-rpc.schema.ts` — confirmed by globbing
`libs/backend/rpc-handlers/src/lib/handlers/*-rpc.schema.ts`: 28 schema files
exist, none for `terminal` (nor `layout`).

**Exercised today**: nothing. This is the most decision-relevant fact in the
report:

- No production caller sets `shell`. The sole caller sends `{ name }`
  (`terminal.service.ts:150-154`).
- No production caller sets `cwd` either — the handler's `wsRoot` fallback is
  what actually runs.
- No UI anywhere exposes shell selection: grep for `shell` across
  `libs/frontend/**/*.ts` returns only syntax-highlighting maps
  (`code-editor.component.ts:604-607`, `diff-view.component.ts:818-821`) and
  unrelated "app shell" naming.
- `git log -S"shell?: string"` over `rpc-terminal.types.ts` and
  `pty-manager.service.ts` returns a single squashed release commit
  (`2b537f44c`, extension v0.2.32) — the field shipped with the original
  terminal feature and has never had a caller.

**Plausible legitimate values, if a shell picker is ever built** — a
forward-looking constraint on allowlist design, not a present-day compat risk:

- Windows: `cmd.exe`, `powershell.exe`, `pwsh.exe`, Git-Bash
  (`C:\Program Files\Git\bin\bash.exe`), `wsl.exe`
- Unix: `/bin/bash`, `/bin/sh`, `/bin/zsh`, `/usr/bin/fish`, `dash`, `ksh`
- Legitimate non-standard locations: Homebrew (`/opt/homebrew/bin/fish`), `nu`
  at `/usr/local/bin/nu`, Nix (`/nix/store/<hash>/bin/…`), `elvish`, `xonsh`

The Nix/Homebrew cases are why a _path-literal_ allowlist ages badly; a basename
allowlist plus resolve-and-verify is more durable. But note the scope of that
concern: **today, refusing every non-default `shell` outright would break zero
users.** The architect has a genuinely free hand.

---

## 6. Existing test baseline

| File                                                                         | Relevance                    | Notes                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.spec.ts`   | **The tests P2 must change** | 7 tests, explicitly labelled CHARACTERIZATION for TASK_2026_171 (header `:10-12`)                                                                       |
| `apps/ptah-electron-e2e/src/specs/pty-manager.spec.ts`                       | Inert                        | 8 `terminal:create` calls with `cwd: process.cwd()`; entire suite unconditionally skipped at `:35-38` (node-pty binaries not packaged in the dev build) |
| `libs/frontend/editor/src/lib/services/terminal.service.spec.ts:134,160,182` | Unaffected                   | Frontend-only, never sets `shell`                                                                                                                       |

**No test anywhere spawns an arbitrary binary.** The carrier's warning about a
test encoding the defect is _nearly_ right — nothing needs deleting, but three
assertions encode the unvalidated pass-through and must be **updated, not
preserved**:

- `:99` + `:103-107` — passes `shell: 'bash'`, asserts it reaches
  `ptyManager.create` verbatim.
- `:118` + `:122-126` — passes `shell: 'bash'` **and** `cwd: '/explicit'`,
  asserts both reach `ptyManager.create` verbatim. `/explicit` is outside any
  workspace root and outside home, so **P2's cwd containment rule will and
  should break this assertion.**
- `:139-141` — asserts the `homedir()` fallback; this one stays valid.

`ptyManager` is a jest mock (`:63-68`), so no real `pty.spawn` occurs in unit
tests. Per AC 2, P3 needs an assertion at the spawn call site — that requires a
new test seam, since the current spec stops at the `IPtyHost` port boundary.

Because the e2e suite is skipped, there is **no live regression risk** from
tightening `cwd`, and no cross-project passed-test count depends on those 8 call
sites (AC 6).

---

## 7. Prior art — the boundary-validation convention P2 must follow

**Naming/location**: `libs/backend/rpc-handlers/src/lib/handlers/<domain>-rpc.schema.ts`,
sibling to the handler. 28 exist today.

**Shape** — two established variants; P2 needs the first:

1. **Reject** (`git-rpc.schema.ts:31-34`) — `safeParse`, return `null` on
   failure so the handler answers with a structured error:

   ```ts
   export function parseGitDiffFileParams(raw: unknown): GitDiffFileParams | null {
     const result = GitDiffFileParamsSchema.safeParse(raw);
     return result.success ? result.data : null;
   }
   ```

2. **Fallback** (`config-rpc.schema.ts:30-36, 49-55, 69-73`) — returns a
   documented default. Used for values read from _disk_, not from the renderer.

The carrier requires rejection over silent substitution, so **follow the
`git-rpc.schema.ts` null-returning convention**, not the config one.

**Partial-adoption precedent**: `git-rpc.schema.ts:5-11` explicitly documents
covering one method and deliberately leaving sixteen sibling methods on their
hand-rolled guards. Direct precedent for schema-ing `terminal:*` without
retrofitting `layout:*` in the same change.

**Path containment**:
`libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts:13-35` —
`isAuthorizedWorkspace(workspacePath, workspaceProvider)`. Normalization is
resolve → forward-slashes → lowercase → strip trailing slash (`:20-25`), with a
separator-boundary check `target.startsWith(folder + '/')` at `:32` that stops
`/foo/bar` matching `/foo/barbaz`. **Reuse this rather than writing a new
predicate.** Caveat: it covers workspace folders only. AC 3 also requires the
home directory, which this function does not handle — that needs an extension or
a sibling predicate. Also evaluate `isUnsafeWorkspacePath`, already exported from
platform-core (`libs/backend/platform-core/src/index.ts:67`), before inventing
anything new.

**Style**: `z.enum([...] as const)` for closed sets, `z.object({...})` for param
shapes, and a header docblock stating scope and rationale — every existing schema
file has one.

---

## 8. The containment mechanism, stated plainly

Worth recording because it is the single load-bearing fact behind six REFUTED
rows.

There are **three** production dispatchers into `RpcHandler.handleMessage`:

| Dispatcher              | file:line                                                                              | Method name from                                                                    | Serves `terminal:create`? |
| ----------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------- |
| Electron IPC bridge     | `apps/ptah-electron/src/ipc/ipc-bridge.ts:215`                                         | renderer message data                                                               | **Yes**                   |
| VS Code webview handler | `libs/backend/vscode-core/src/services/webview-message-handler.service.ts:287`, `:409` | webview message data                                                                | No (`pty` off)            |
| CLI stdio transport     | `libs/backend/cli-engine/src/lib/transport/cli-message-transport.ts:46`                | `rpc.call` params from stdin (`apps/ptah-cli/src/cli/commands/interact.ts:549-578`) | No (`pty` off)            |

All three take the method name from **data**, not from a literal. None checks
caller identity or capability. Therefore:

> The entire containment for `terminal:create` is _which handlers got registered
> on this host_ — i.e. `manifest × host profile`. There is no second line of
> defence.

That is exactly why `pty: true` living in one file matters so much, and why P2's
schema is worth adding even though today's reach is narrow.

**The single fact that would flip several verdicts**: if any host profile other
than `apps/ptah-electron/src/rpc-host-profile.ts:40` set `pty: true`, or if
`PLATFORM_TOKENS.PTY_HOST` were registered outside
`apps/ptah-electron/src/di/phase-4-handlers.ts:182`, then `rpc.call`
(`interact.ts:549`) would immediately become a **caller-supplied-`shell`
command-execution primitive on a headless host** — row 7 would flip to CONFIRMED
and severity would become critical. Today both are Electron-exclusive, and the
exclusion is enforced by a spec asserting the _exact_ excluded set
(`rpc-surface.spec.ts:67-69`) rather than a hand-maintained list, so a future
host that enables `pty` without noticing will break that test. That guard is
worth preserving verbatim.

---

## 9. Severity call

### Verdict: MODERATE. Fix on normal cadence. Not a release blocker.

The carrier set an explicit decision rule: _"If a non-interactive path can reach
it, severity rises and the fix must land before the next desktop release."_
**That antecedent is false.** Every non-interactive path is REFUTED with
citations:

- **Remote (gateway)** — REFUTED (row 5). This was the severity-critical one,
  and it does not exist. The bridge terminates in `agentAdapter.startChatSession`
  (`gateway-chat-bridge.ts:463`) and injects neither `RPC_HANDLER` nor
  `PTY_HOST` (`:104-124`).
- **Scheduled (cron)** — REFUTED (row 6).
- **Model-influenced (MCP code-exec)** — REFUTED (row 4). Zero references to
  `terminal`, `PTY_HOST`, `IPtyHost`, or `RpcHandler` anywhere in
  `libs/backend/vscode-lm-tools/src`; the sandbox parameter list
  (`code-execution.engine.ts:47-90`) exposes no container handle.
- **Model-influenced (AI markdown → JS)** — REFUTED (row 3).
- **Generic remote RPC passthrough (`rpc.call`)** — REFUTED (row 7) solely
  because the CLI host does not register the method.

What remains is row 2: **an attacker who already has JavaScript execution in the
Electron renderer**. That is a real escalation primitive worth closing, but it is
a _second-stage_ capability, not an entry point. An attacker at that position in
an Electron app already has substantial reach.

Considerations pulling in each direction, both of which belong in the PR:

- **Down**: no remote or automated trigger; args are hardcoded `[]` so argv is
  not attacker-controlled; the dangerous fields have no callers at all, so
  nothing is exercising them in the wild.
- **Keeping it worth doing**: the webview's `contextIsolation` sandbox exists
  precisely to contain renderer compromise, and this field is a clean hole
  through it. The carrier's framing — "the trust boundary between content the
  model produced and argv the host executes is one unvalidated RPC field wide" —
  is right about _design intent_, even though the sanitizer currently blocks the
  model half. Defence in depth is cheap here and the compat cost is zero.

**Two honest caveats that qualify the downgrade:**

1. **Row 3 rests on a denylist.** The webview sanitizer uses
   `FORBID_TAGS`/`FORBID_ATTR` (`provide-markdown-rendering.ts:40-51`), not an
   allowlist — the lib's own CLAUDE.md calls it "intentionally inverted". Row 3
   is REFUTED against the config _as it stands today_. A DOMPurify bypass or a
   relaxation of that config flips row 3 to CONFIRMED and this severity call
   with it. That coupling is itself a reason to fix `terminal:create` rather
   than leave the sanitizer as the only thing between AI output and `pty.spawn`.
2. **Containment is one flag deep** (§8). Six REFUTED rows share a single point
   of failure: `pty: true` appearing in a second host profile.

**Recommendation**: proceed to P2 on normal cadence. Do not hold the desktop
release. Given the zero-caller finding, the architect may choose the tightest
possible narrowing — including rejecting any non-default `shell` outright, which
is simultaneously the strictest option and, today, a no-op for every real user.

---

## 10. Handoff to software-architect (P2)

Settled by evidence; no need to re-derive:

1. Electron is the only host serving this; do not touch other profiles
   (`rpc-host-profile.ts:40` is the only `pty: true`). Preserve the exact-set
   assertion at `rpc-surface.spec.ts:67-69` — it is the tripwire for §8.
2. Nothing validates `params` anywhere upstream (§3) — the schema must live in
   the handler.
3. `shell` and `cwd` have zero callers; narrowing breaks nothing today.
4. Follow `git-rpc.schema.ts`'s null-returning `safeParse` convention (reject,
   don't substitute) and its documented partial-adoption precedent.
5. Reuse `isAuthorizedWorkspace` (`workspace-authorization.ts:13`) and extend it
   — or add a sibling — for the homedir arm AC 3 requires.
6. Three assertions in `terminal-rpc.handlers.spec.ts` (`:99/:103-107`,
   `:118/:122-126`) encode the defect and must be updated; the `homedir()`
   fallback test at `:139-141` stays.
7. AC 2 wants the assertion at the `pty.spawn` call site — the current unit spec
   stops at the `IPtyHost` port, so a new seam is needed. The e2e suite is
   skipped and cannot serve as that seam.
8. State the `[]`-args bound in the PR: attacker controls executable path, cwd,
   and inherits env — **not** argv.

**Out of scope here, recommend separate tickets**: gateway `permissionLevel:
'yolo'` on remote inbound (`gateway-chat-bridge.ts:423,440,471`); the
`AsyncFunction` sandbox reaching real `process` (`code-execution.engine.ts:24`).

No clarifications needed — the carrier pinned scope, and the evidence resolved
every open question.
