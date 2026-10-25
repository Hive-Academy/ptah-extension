# Research Report - TASK_2026_714

## Question

- Decision this supports: whether Electron main chat and, later, delegated lanes can share one native Codex App Server backend while the Claude Agent SDK adapter stays unchanged.
- Question: Which Codex App Server capabilities exist on the CLI pinned in this worktree (`@openai/codex` / `@openai/codex-sdk` 0.155.1), and which T3 Code patterns are safe to reuse?
- Bounds: No Codex process was launched, no schema was generated from the local binary, and the Ptah application tree was not reviewed beyond the lockfile pin. TUI and VS Code hosts were not designed. Current public docs were used only to show drift from the pin. Options not examined: Codex SDK method surface (package not present under `node_modules`), ACP, and any non-`pingdotgg/t3code` GUI.

## Answer

Use a shared native `codex app-server` JSON-RPC client over stdio and generate the client types from the pinned 0.155.1 binary. That tag already has the thread, turn, approval, sandbox, MCP, skill, image, usage, and compaction primitives this integration needs, and it leaves the Claude adapter as a separate implementation. How many processes share one `CODEX_HOME` is an architecture decision: a home separates accounts, and it does not isolate workspaces or lanes that share that account but need different MCP config or policy. `config/mcpServer/reload` is process-wide, so one process can cross those callers. Do not code against the current public App Server page: it describes a newer CLI than 0.155.1. Treat T3 Code (`pingdotgg/t3code`, MIT) as a pattern reference only.

## Evidence

| Claim | Source | Date | Verified how |
| --- | --- | --- | --- |
| This worktree locks `@openai/codex-sdk` 0.155.1, which depends on `@openai/codex` 0.155.1, Apache-2.0. | `package-lock.json:11862-11868` | undated lockfile, read 2026-10-22 | read the lockfile |
| CLI tag `rust-v0.155.1` is commit `be2951e`. Its only listed fix is the TUI reasoning-summary default. Full changelog is `rust-v0.155.0...rust-v0.155.1`. | https://github.com/openai/codex/releases/tag/rust-v0.155.1 | 2026-09-18 | read the release page |
| `initialize` takes `clientInfo` plus capabilities (`experimentalApi`, `requestAttestation`, `optOutNotificationMethods`, MCP form/extensions). The response is `userAgent`, `codexHome`, `platformFamily`, `platformOs`. There is no protocol-version field. | https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/v1.rs | tag 2026-09-18 | read the tag source |
| Requests before `initialize` are rejected; a second `initialize` on the same connection is rejected. JSON-RPC 2.0 omits the `jsonrpc` header. Default transport is stdio JSONL. WebSocket is documented as experimental and unsupported for production. | https://learn.chatgpt.com/docs/app-server.md | fetched 2026-10-22; page undated and newer than 0.155.1 | read current docs; handshake rule not re-read in the 0.155.1 README |
| Stable methods at 0.155.1 include `thread/start`, `thread/resume`, `thread/fork`, `thread/compact/start`, `turn/start`, `turn/steer`, `turn/interrupt`, `model/list`, `skills/list`, `skills/config/write`, `config/mcpServer/reload`, `mcpServerStatus/list`, `account/usage/read`, `config/read`, `config/value/write`, `config/batchWrite`, `windowsSandbox/setupStart`, `windowsSandbox/readiness`. `turn/settings/update` is not in that set. | https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/common.rs | tag 2026-09-18 | read method table; re-read settings annotations 2026-10-22 |
| Both settings updates are experimental. `common.rs` has `#[experimental("thread/settings/update")]` immediately above `ThreadSettingsUpdate => "thread/settings/update"` (lines 693-694) and `#[experimental("turn/settings/update")]` immediately above `TurnSettingsUpdate => "turn/settings/update"` (lines 1044-1045). The notification `thread/settings/updated` is also marked `#[experimental("thread/settings/updated")]` (line 1932). | https://raw.githubusercontent.com/openai/codex/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/common.rs | tag 2026-09-18 | re-read those annotations 2026-10-22 |
| `thread/start` accepts model, cwd, coarse `sandbox` (`read-only` / `workspace-write` / `danger-full-access`), `approvalPolicy`, `baseInstructions`, `developerInstructions`, `personality`, and `ephemeral`. `dynamicTools`, `permissions`, `collaborationMode`/`multiAgentMode`, and `historyMode` are experimental fields. `multiAgentMode` is marked deprecated and ignored; comments say to use effort `ultra`. | https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/v2/thread.rs | tag 2026-09-18 | read struct |
| `turn/start` accepts text, `image` URL, `localImage` path, and `skill` inputs, plus per-turn `model`, `effort`, `sandboxPolicy`, `approvalPolicy`, and `outputSchema`. `turn/steer` requires `expectedTurnId` and does not take those overrides. | https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/v2/turn.rs | tag 2026-09-18 | read struct |
| Approval values are `untrusted`, `on-request`, `never`, and experimental `granular`. Sandbox policies are `read-only` (optional `networkAccess`, default false), `workspace-write` (writable roots, `networkAccess` default false), `danger-full-access`, and `external-sandbox`. | https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/v2/shared.rs and https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/protocol/src/protocol.rs | tag 2026-09-18 | read enums |
| `config/batchWrite` `reloadUserConfig` hot-reloads runtime settings into loaded threads and explicitly does not reload model, reasoning effort, Plan-mode effort, service tier, or personality. | https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/v2/config.rs | tag 2026-09-18 | read field comment |
| Dynamic tools are an experimental `thread/start.dynamicTools` spec. The server calls the client with `item/tool/call`. Remote image URLs inside that response are rejected. | `thread.rs` dynamic-tools field; https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server/src/dynamic_tools.rs | tag 2026-09-18 | read both |
| Usage is `account/usage/read` (optional `threadId`) and notification `thread/tokenUsage/updated`. Compaction is stable `thread/compact/start`. | `common.rs` at the 0.155.1 tag | tag 2026-09-18 | read method table |
| Transports implemented in 0.155.1 are stdio, Unix control socket, WebSocket, and off. Stdio is single-client: closing it stops the server. Windows handles Ctrl-C as a forceable shutdown; a detached process with no console stays up. | https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server/src/main.rs and `src/lib.rs` | tag 2026-09-18 | read transport match |
| `thread/rollback` still exists on 0.155.1. The 0.156.0 changelog lists its removal. | `common.rs` on `rust-v0.155.1`; https://github.com/openai/codex/releases?q=stable | 0.155.1 tag 2026-09-18; 0.156 changelog undated on the releases index | read both |
| Authoritative T3 repository is `pingdotgg/t3code`. License is MIT, copyright 2026 T3 Tools Inc. | https://github.com/pingdotgg/t3code/blob/main/README.md and https://raw.githubusercontent.com/pingdotgg/t3code/main/LICENSE | README undated; license undated; fetched 2026-10-22 | read both |
| T3 spawns `codex app-server` with stdio, sets `CODEX_HOME` to an expanded home path, sets `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, sends `initialize` with `experimentalApi: true`, then `initialized`. Latest commit touching that file is `09548f6`. | https://github.com/pingdotgg/t3code/blob/09548f614528ecebe5b16e2280d6d608754eb91f/apps/server/src/provider/CodexProvider.ts lines 449-516 | file commit 2026-10-20 | read source; commit from GitHub API |
| A T3 issue says runtime modes are fixed tuples and that `never` plus `workspace-write` is not selectable. Maintainers treated it as an open feature request. This mapping was not confirmed in source. | https://github.com/pingdotgg/t3code/issues/21138 | 2026-10-18 | read the issue |

## Capability matrix (pinned CLI 0.155.1)

| Area | Status on 0.155.1 | What the architect can rely on |
| --- | --- | --- |
| Initialize / negotiation | Proven. No numeric protocol version. | One `initialize` plus `initialized` per connection. Identity is `clientInfo`. Gate experimental fields with `capabilities.experimentalApi`. Confirm the running binary with `codex app-server generate-ts` from that same binary. |
| Threads, turns, resume, interrupt, steer | Proven for the stable methods above. | `thread/resume` continues an id. `turn/interrupt` cancels the in-flight turn. `turn/steer` appends input only when `expectedTurnId` matches. |
| Model and effort | Proven on `thread/start` and `turn/start`. Changing them on an active turn via `turn/settings/update` is experimental and requires `experimentalApi`. `model/list` is the catalog. | Do not hard-code model ids from the current docs (`gpt-6.1-sol` appears there). Do not treat a mid-turn model or effort change as a stable RPC. |
| Approvals and sandbox | Proven as independent fields. `never` does not imply full disk. `granular` and named `permissions` profiles are experimental. | Unattended execution is an explicit pair, for example `never` with `workspace-write` or `read-only`. Read-only and workspace-write deny network unless `networkAccess` is set on the full `SandboxPolicy`. Coarse `sandbox` on `thread/start` cannot express that network bit. |
| Plan / read-only expectation | Version-dependent. Collaboration mode is experimental. | A read-only sandbox is real. Whether Plan mode also forces read-only was not read. |
| Live config | Split. Both settings RPCs are experimental. | Disk writes via `config/value/write` and `config/batchWrite` are stable. `reloadUserConfig` skips model, effort, Plan effort, service tier, and personality. Moving those on a live thread requires `experimentalApi`: `turn/settings/update` for the active turn and `thread/settings/update` for subsequent turns. Neither is a stable method. |
| MCP | Proven for reload, status, resource read, and tool call. Startup status is notified. Event streaming is experimental. | Reload is process-wide (`global` mcp-registry lock). One `CODEX_HOME` does not isolate two workspaces or lanes on the same account that need different MCP servers or tools. Sharing a process lets a reload cross them. Whether to use one process or many is an architecture decision about effective config, workspace, and policy isolation. |
| Dynamic tools | Experimental. | Pass specs on `thread/start` only with `experimentalApi`. The client must answer `item/tool/call`. |
| Skills / instructions | Proven. | `baseInstructions` and `developerInstructions` on thread start/resume. Skill invocation is a `skill` input item. `skills/list` and `skills/config/write` are stable. |
| Images | Proven. | `image` URL and `localImage` path on turn input. Remote URLs are rejected inside dynamic-tool image output. |
| Account / `CODEX_HOME` / isolation | Proven for selecting a home and for several account methods. Not proven as workspace or lane isolation. | Set `CODEX_HOME` in the child environment before spawn. `initialize` echoes the absolute home. Login, logout, rate limits, and usage read exist. A distinct home separates accounts. Callers that share an account and still need different MCP config, sandbox, or approval policy need an isolation design; one process per home does not provide it. |
| Events, usage, compaction, subagents | Usage and compaction are proven. Subagent control is not a stable RPC. | Listen for `turn/*`, `item/*`, and `thread/tokenUsage/updated`. Call `thread/compact/start` for compaction. `multiAgentMode` is ignored; no spawn-subagent method was in the reviewed method table. |
| Windows transport and lifecycle | Stdio is proven. Unix-socket and WebSocket code exists and is the wrong default on Windows. | Spawn `codex app-server` with stdin/stdout pipes. Closing stdin ends the process. `windowsSandbox/setupStart` and `readiness` are present. Named-pipe behavior of `unix://` was not read. |

Current docs at https://learn.chatgpt.com/docs/app-server.md add or emphasize surfaces that must not be assumed on 0.155.1 until the pin moves: GPT-6.1 examples, Code Mode host flags, WebSocket auth flags, and the removed `thread/rollback` method. The in-repo schema command is the compatibility check.

## Options

| Option | Fit here | Cost to adopt | Known failure mode |
| --- | --- | --- | --- |
| Shared stdio App Server, schema generated from pinned 0.155.1. Claude adapter unchanged. Process sharing is undecided. | Matches the pinned binary and Electron-first scope. Main chat and lanes can use one client implementation with different approval and sandbox arguments. | New JSON-RPC session owner in the Electron composition root. Generate types from the binary; do not add a runtime dependency on T3. The architect must choose a process key that isolates effective config, workspace, and policy, not only `CODEX_HOME`. | A CLI upgrade silently changes the schema. Experimental opt-in can expose unstable methods. A process-wide MCP reload crosses any workspaces or lanes that share that process, including the same account. |
| Keep `@openai/codex-sdk` 0.155.1 as the chat backend. | The package is already pinned and is documented for automation, not rich clients. Its TypeScript API was not inspected because `node_modules` is absent. | Low if the SDK already covers chat, but it is a second Codex path next to lanes. | Official docs tell product integrations to use App Server and CI to use the SDK. The SDK surface was not verified here. |
| One shared WebSocket or Unix-socket daemon for every account. | 0.155.1 implements both listeners. Current docs still call WebSocket experimental and unsupported. | Auth, socket lifecycle, and Windows transport code that this pass did not prove. | Stdio-close semantics do not apply; a daemon can outlive a client and keep another account's home. Non-loopback WebSocket without auth is called out as unsafe in current docs. |
| Vendor or copy T3 Code. | T3 already wraps App Server for Electron and isolates `CODEX_HOME`. | MIT allows reuse only with the copyright notice. The server is Effect-based and not this repo's tsyringe stack. | Their runtime modes are fixed tuples. Issue 21138 says `never` plus `workspace-write` is unavailable, which would hide a policy this task must keep explicit. |

## Disagreements

- Protocol surface: https://learn.chatgpt.com/docs/app-server.md, fetched 2026-10-22, describes a post-0.155 CLI (GPT-6.1 examples, rollback absent from the overview that was read). Tag `rust-v0.155.1` still has `thread/rollback` and has no protocol-version field. The installed pin decides: generate types from 0.155.1.
- WebSocket: current docs say experimental and unsupported. 0.155.1 `lib.rs` still accepts `ws://`. For Electron, stdio avoids that conflict.
- T3 product scope: mintlify pages from 2026-03-07 describe a Codex-only wrapper. The main README, undated, says T3 also controls Claude, Cursor, Grok, OpenCode, and Antigravity. The README plus `CodexProvider.ts` is the Codex-integration evidence; the older docs site is not.
- Unattended sandbox: T3 issue 21138 treats `never` plus workspace-write as missing from T3. The 0.155.1 protocol keeps approval and sandbox independent, so the limitation is T3's mode table, not App Server.

## Local consequences

- `package-lock.json` `@openai/codex` 0.155.1 is the protocol oracle. Bumping it is a schema migration, not a silent refresh.
- Electron needs its own App Server session owner. The Claude `IAgentAdapter` binding stays. Lanes and main chat pass different `approvalPolicy` and `sandbox` values into the same client. Lane `danger-full-access` / `never` must remain an explicit lane policy.
- `initialize.result.codexHome` checks that the child honored `CODEX_HOME`. That separates accounts. It does not prove that main chat and a lane on the same account can share the process when their MCP config, skills, sandbox, or approval policy differ.
- MCP reload is process-wide, not per thread and not per workspace. Sharing a process is an architecture decision: the process key has to isolate effective config, workspace, and policy. One process per home is not that design.
- Live model and effort changes are experimental on both `turn/settings/update` and `thread/settings/update`. They require `experimentalApi`. Writing `config.toml` with `reloadUserConfig` will not move model, effort, Plan effort, service tier, or personality.
- Windows children should use stdio pipes. Do not point Electron at `unix://` until that transport is read and tested on Windows.

## Decisions

- Contract source is tag `rust-v0.155.1` (`be2951e`), not the live docs page. Options were the tag, `main`, and the docs. The lockfile pin is the evidence. Reversible by regenerating types when the dependency is bumped.
- Transport is stdio. Options were stdio, WebSocket, and a shared daemon. Stdio is the default and the only single-client lifecycle that was read. Reversible per session if a later Windows daemon design is proven.
- Process sharing is not decided here. One process per `CODEX_HOME` isolates accounts and does not isolate same-account workspaces or lanes with different MCP or policy. The architect has to pick a process key for effective config, workspace, and policy isolation. Reversible until that key is implemented.
- T3 is a pattern source under MIT, not code to copy. Options were copy, depend, or reimplement the thin spawn and handshake. The stack mismatch and the fixed runtime-mode table decide it. Reversible if a small, attributed excerpt is later approved.

## Blockers

- `codex app-server generate-ts` was not run, so the JSON schema in this report is from GitHub source at the matching tag, not from the bytes inside the npm tarball.
- `node_modules/@openai/codex-sdk` is not installed here, so the SDK's overlap with App Server is unknown.
- `experimental(nested)` on `approvalPolicy` was read as "stable variants work without opt-in; `granular` does not." The macro body was not read.
- Plan-mode's effect on the sandbox was not read. `CollaborationMode` was only seen as an experimental field.
- T3's runtime-mode mapping was not opened in source. Issue 21138 is an unverified description.
- The Windows implementation behind `AppServerTransport::UnixSocket` was not read past the `cfg(windows)` shutdown branch.
- `ptah_agent_report` is not available in this session's tool list.

## Unknowns

- Whether the npm tarball `codex` 0.155.1 is byte-identical to git tag `rust-v0.155.1`. Smallest check: `codex --version` and `codex app-server generate-json-schema` on the installed binary, without an inference call.
- Whether stable `approvalPolicy` values are rejected unless `experimentalApi` is true. Smallest check: one local initialize without the capability, then `thread/start` with `approvalPolicy: "never"` and `sandbox: "workspace-write"`.
- Whether Plan mode forces read-only. Smallest check: read `CollaborationMode` in `codex-rs/protocol` at `rust-v0.155.1`.
- How `unix://` is implemented on Windows. Smallest check: read `codex-rs/app-server-transport` at the same tag for pipe versus AF_UNIX.
- Which file in `pingdotgg/t3code` at `09548f6` maps runtime modes to Codex policies, and whether interrupt and steer are implemented. Smallest check: search that tree for `turn/interrupt` and `approvalPolicy`.
