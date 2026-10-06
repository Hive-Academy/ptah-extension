# ACP landscape — 2026-10-06

## Scope and decision

**Decision supported:** whether Ptah should build one shared ACP stdio client to drive several coding-agent CLIs. This is a source-backed ecosystem survey as at 2026-10-06, rather than an architecture decision. “First supported” means the first release/version found in a primary source; where no such release note was found it is explicitly unverified. ACP's upstream repository says the current stable wire protocol is **v1**; v2 documentation and the TypeScript SDK label v2 experimental/draft. [ACP repository](https://github.com/agentclientprotocol/agent-client-protocol) · [v2 initialization](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/initialization.mdx) · [SDK package](https://www.npmjs.com/package/@agentclientprotocol/sdk)

## ACP agents (coding CLIs and adapters)

| Agent | Start command | Native or adapter | Maturity | Version first supported |
| --- | --- | --- | --- | --- |
| Grok CLI | `grok agent stdio` | Native | Stable CLI; ACP maturity not separately labelled | Grok **1.0.46** observed locally 2026-10-06; first release unverified. Local evidence: [grok-probe.md](grok-probe.md) |
| Gemini CLI | `gemini --acp` (some current reference material also names `--experimental-acp`) | Native | Experimental where documented as `--experimental-acp`; current configuration reference calls it `--acp` | Unverified. [configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md) · [CLI reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md) |
| Claude Code | Launch the community/Zed adapter, normally `npx -y @zed-industries/claude-code-acp` | Separate adapter around Claude Code | Experimental/community adapter; not a documented Claude Code native server | Unverified. [adapter repository](https://github.com/zed-industries/claude-code-acp) |
| OpenAI Codex | `npx -y @agentclientprotocol/codex-acp` or installed `codex-acp` | Separate adapter; it starts Codex App Server | Adapter maintained under ACP organisation; no stable/experimental declaration found | Unverified. [codex-acp README](https://github.com/agentclientprotocol/codex-acp) |
| opencode | `opencode acp` | Native | Unverified | Unverified. [opencode repository](https://github.com/anomalyco/opencode) |
| GitHub Copilot CLI | `copilot --acp --stdio` (or `copilot --acp --port <port>`) | Native | **Public preview**, subject to change | Unverified. [GitHub ACP reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server) |
| Cursor CLI | `agent acp` | Native | Not labelled experimental in current docs | Unverified. [Cursor ACP documentation](https://prod.cursor.com/docs/cli/acp) |
| Qwen Code | `qwen --acp` | Native | Existing stdio ACP leg; daemon HTTP ACP design described as not yet normative at the cited design date | Unverified. [Qwen daemon/ACP design](https://github.com/QwenLM/qwen-code/blob/main/docs/design/daemon-acp-http/README.md) |
| goose | `goose acp`; remote option: `GOOSE_SERVER__SECRET_KEY=… goose serve` and `/acp` | Native | Not labelled experimental | Unverified. [goose ACP guide](https://goose-docs.ai/docs/gdk/acp/) |
| Augment / Auggie | No official ACP server command found | **Unverified; do not treat third-party claims as support** | Unverified | Unverified |
| Kiro CLI | `kiro-cli acp` (optional `--agent <name>`) | Native | Current docs do not label ACP experimental | Unverified. [Kiro CLI ACP](https://kiro.dev/docs/cli/acp/) |
| Cline CLI | `cline --acp` (optional `--auto-approve true`) | Native | Not labelled experimental | Unverified. [Cline ACP guide](https://github.com/cline/cline/blob/main/docs/usage/acp.mdx) |
| Google Antigravity | No official product CLI ACP command found. The visible implementations are independent `antigravity-acp` servers, not evidence that a first-party CLI speaks ACP. | Separate/community adapter | Community | Unverified. [chicagobuss adapter](https://github.com/chicagobuss/antigravity-acp) |
| Aider | No ACP agent source found | Unverified | Unverified | Unverified |
| Pi | No ACP agent source found | Unverified | Unverified | Unverified |

### Qualification notes

* Grok is especially relevant to Ptah: the supplied local probe measured ACP over JSON-RPC stdio, per-session HTTP MCP injection, request permissions, FIFO second-prompt queueing, and `session/cancel`; it also found that `--leader` captures leader environment/CWD, so Ptah would need `--no-leader`. [local measurement](grok-probe.md)
* Gemini's own source describes an NDJSON transport and an `AgentSideConnection`, but current source documentation has changed flag wording from `--experimental-acp` to `--acp`; feature-detect with `initialize`, not a remembered command/version. [Gemini ACP source README](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/README.md) · [configuration](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md)
* Codex ACP is not Codex CLI's native public ACP surface: the adapter bundles/launches a compatible `@openai/codex` dependency unless `CODEX_PATH` is set. [codex-acp README](https://github.com/agentclientprotocol/codex-acp)
* Cursor documents extension methods (`cursor/ask_question`, `cursor/create_plan`, todo/task/image notifications); a generic client must answer the blocking requests or send a JSON-RPC unsupported-method error. [Cursor ACP documentation](https://prod.cursor.com/docs/cli/acp)

## ACP clients / hosts

The directly evidenced client/host set is below; this is deliberately not claimed exhaustive. ACP is a client–agent protocol, and the upstream project maintains an integrations directory rather than a fixed compatibility guarantee. [ACP repository integrations](https://github.com/agentclientprotocol/agent-client-protocol)

| Client / host | Evidence |
| --- | --- |
| Zed | Zed is an ACP client used in goose and Cursor configuration/examples. [goose guide](https://goose-docs.ai/docs/gdk/acp/) · [Cursor docs](https://prod.cursor.com/docs/cli/acp) |
| JetBrains AI Assistant | Cline documents Add Custom Agent in JetBrains’ ACP configuration; Kiro says JetBrains can connect to its agent. [Cline](https://github.com/cline/cline/blob/main/docs/usage/acp.mdx) · [Kiro](https://kiro.dev/docs/acp/) |
| Neovim: CodeCompanion, avante.nvim, agentic.nvim | Cline documents its built-in CodeCompanion adapter and names avante/agentic; Cursor documents avante. [Cline](https://github.com/cline/cline/blob/main/docs/usage/acp.mdx) · [Cursor](https://prod.cursor.com/docs/cli/acp) |
| Emacs: agent-shell | Cline documents agent-shell as an ACP driver. [Cline](https://github.com/cline/cline/blob/main/docs/usage/acp.mdx) |
| goose Desktop | goose documents its Desktop product as an ACP client over WebSocket. [goose guide](https://goose-docs.ai/docs/gdk/acp/) |
| VS Code extensions / custom hosts | No general first-party VS Code ACP host was verified in this pass. Custom clients are supported in principle; this is not evidence that a named VS Code extension is production-ready. [Cursor’s minimal custom client](https://prod.cursor.com/docs/cli/acp) |

## Protocol surface

### Versioning, transport, and negotiation

* **Stable wire version: 1.** `initialize` carries the client's latest integer `protocolVersion`; if supported, the agent returns it, otherwise its latest supported version. The client should close if it cannot support the returned version. The number increments only for breaking changes; new optional capabilities are non-breaking and an omitted capability means unsupported. [upstream versioning](https://github.com/agentclientprotocol/agent-client-protocol) · [v2 initialization rules](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/initialization.mdx)
* Stdio is JSON-RPC 2.0 framed as newline-delimited JSON in the documented Cursor, Gemini and Kiro paths. HTTP/WebSocket exists in agent-specific offerings (goose) and is under/alongside evolving ACP transport work (Qwen’s design explicitly says its cited HTTP RFD was not normative). [Cursor](https://prod.cursor.com/docs/cli/acp) · [Gemini](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/README.md) · [goose](https://goose-docs.ai/docs/gdk/acp/) · [Qwen](https://github.com/QwenLM/qwen-code/blob/main/docs/design/daemon-acp-http/README.md)
* v2’s draft names `capabilities` and `info`; existing v1 agents may expose the equivalent as `clientCapabilities`/`clientInfo` and `agentCapabilities`/`agentInfo`. Ptah must model the negotiated schema version rather than assuming v2 field names. [v2 initialization](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/initialization.mdx) · [Cursor v1 example](https://prod.cursor.com/docs/cli/acp)

### Core portable methods and data

* Connection/session lifecycle: `initialize`, optional `authenticate` (v1 agent-specific auth method ID), `session/new`, `session/load`, `session/prompt`, `session/cancel`, and streaming `session/update`. Cursor documents that exact v1 flow; Kiro describes the portable surface as initialization, sessions, prompts, cancellation, updates, and permission requests. [Cursor](https://prod.cursor.com/docs/cli/acp) · [Kiro](https://kiro.dev/docs/acp/)
* `session/request_permission` is an **agent-to-client request**, so the client must return a decision; `fs/*` and `terminal/*` are likewise client-provided facilities when negotiated. Qwen's transport mapping lists `fs/read_text_file`, `fs/write_text_file`, `terminal/create|output|wait_for_exit|kill|release`, and permission requests. [Qwen ACP transport mapping](https://github.com/QwenLM/qwen-code/blob/main/docs/design/daemon-acp-http/README.md)
* Modes and model/config controls are optional capability-led surfaces, not a universal contract. Cline offers plan/act and model/provider selection; Cursor exposes agent/plan/ask; Qwen itself uses `unstable_setSessionModel`; Codex adapter advertises configuration values. [Cline](https://github.com/cline/cline/blob/main/docs/usage/acp.mdx) · [Cursor](https://prod.cursor.com/docs/cli/acp) · [Qwen](https://github.com/QwenLM/qwen-code/blob/main/docs/design/daemon-acp-http/README.md) · [codex-acp](https://github.com/agentclientprotocol/codex-acp)
* `mcpServers` belongs in `session/new` in demonstrated implementations. Grok accepted per-session HTTP configuration in the supplied probe; Codex supports command/stdio and HTTP; v2 draft initialization advertises `session.mcp.stdio`/`http`; Qwen mentions the stdio bridge. Treat SSE support as agent-specific/unverified: none of those sources establishes portable v1 SSE `mcpServers`. [grok probe](grok-probe.md) · [codex-acp](https://github.com/agentclientprotocol/codex-acp) · [v2 initialization](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/initialization.mdx) · [Qwen](https://github.com/QwenLM/qwen-code/blob/main/docs/design/daemon-acp-http/README.md)
* `_meta` is the extension container in observed implementations. Grok emits `_x.ai/*`; Kiro advertises `agentCapabilities._meta.kiro.extensionMethods`; Cursor uses `cursor/*`; Qwen guards `_qwen/`. A shared client should retain opaque metadata where safe, ignore unknown notifications, and respond with JSON-RPC errors to unsupported incoming requests. [grok probe](grok-probe.md) · [Kiro](https://kiro.dev/docs/acp/) · [Cursor](https://prod.cursor.com/docs/cli/acp) · [Qwen](https://github.com/QwenLM/qwen-code/blob/main/docs/design/daemon-acp-http/README.md)

### TypeScript SDK

`@agentclientprotocol/sdk` is the official TypeScript implementation, npm version **1.5.1** at the observed package page, Apache-2.0; its stable entry point is ACP v1 and `@agentclientprotocol/sdk/experimental/v2` is explicitly draft. It provides connection abstractions: Gemini describes constructing `AgentSideConnection`, while Qwen constructs `ClientSideConnection`, so it is suitable for Ptah’s client side. [npm package](https://www.npmjs.com/package/@agentclientprotocol/sdk) · [Gemini source](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/README.md) · [Qwen source](https://github.com/QwenLM/qwen-code/blob/main/docs/design/daemon-acp-http/README.md)

## Divergence and breaking-change risks

| Area | What differs / evidence | Consequence for a shared client |
| --- | --- | --- |
| Prompt concurrency | Grok measured FIFO queueing of a second `session/prompt` while a turn runs; no evidence here makes that a portable ACP promise. [grok probe](grok-probe.md) | Serialize by default; opt into queue semantics only after per-agent verification. |
| Cancel | Grok measured prompt completion as `stopReason: "cancelled"` and session reuse; Cursor documents optional `session/cancel` but not identical terminal semantics. [grok probe](grok-probe.md) · [Cursor](https://prod.cursor.com/docs/cli/acp) | Treat cancel as asynchronous and wait for the outstanding prompt response; do not kill a session merely because cancel was sent. |
| Authentication | Cursor uses `cursor_login`; Codex advertises ChatGPT/API/gateway methods; Cline may authenticate interactively or via environment; Copilot permits login or configured BYOK. [Cursor](https://prod.cursor.com/docs/cli/acp) · [codex-acp](https://github.com/agentclientprotocol/codex-acp) · [Cline](https://github.com/cline/cline/blob/main/docs/usage/acp.mdx) · [Copilot](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server) | Implement an auth-method dispatcher and surface browser/device/user-input requirements; never hard-code one login flow. |
| MCP transports/configuration | Grok accepts session HTTP servers in the local probe; Codex accepts stdio+HTTP; Cursor only documents `.cursor/mcp.json` and explicitly excludes dashboard team MCP servers in ACP. [grok probe](grok-probe.md) · [codex-acp](https://github.com/agentclientprotocol/codex-acp) · [Cursor](https://prod.cursor.com/docs/cli/acp) | Use `session/new.mcpServers` only if advertised/accepted, with per-agent config fallback. |
| Optional and extension methods | Codex has opt-in AIR extensions; Kiro extension methods are advertised in `_meta`; Cursor sends blocking and notification extensions; Qwen uses unstable methods. [codex-acp](https://github.com/agentclientprotocol/codex-acp) · [Kiro](https://kiro.dev/docs/acp/) · [Cursor](https://prod.cursor.com/docs/cli/acp) · [Qwen](https://github.com/QwenLM/qwen-code/blob/main/docs/design/daemon-acp-http/README.md) | Base implementation must support unknown method/metadata policy and extension handlers that can be registered per vendor. |
| Protocol history | Stable v1 remains current; draft v2 changes initialization naming and adds version-2 semantics. Upstream says a major integer is incremented for breaking changes. [upstream](https://github.com/agentclientprotocol/agent-client-protocol) · [v2 initialization](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v2/initialization.mdx) | Pin v1 SDK/API initially; isolate wire codec and schema adapters so v2 can be added only after a negotiated test matrix. |

## Implications for a shared client

* A single **v1 stdio JSON-RPC core** is justified by the native servers documented for Grok, Gemini, opencode, Copilot, Cursor, Qwen, goose, Kiro and Cline; it should not imply uniform functionality.
* Begin every connection with `initialize`, persist the returned protocol/capabilities/auth methods, and make every non-core action capability- and agent-profile-gated.
* Make the agent-to-client request router first-class: permissions, filesystem and terminal delegation can deadlock an otherwise working prompt if unanswered.
* Keep `session/prompt` as an outstanding operation whose completion is its response/stop reason, not child-process exit; support cancellation concurrently.
* Model queue/steer/interrupt as distinct per-agent capabilities. Grok has measured queue + interrupt but no measured steer; do not represent all as one “send message” operation.
* Build vendor extension registration around method prefixes and `_meta`; explicitly ignore safe unknown notifications and explicitly reject unsupported requests.
* Implement MCP server injection as a negotiated adapter capability with stdio/HTTP configuration objects; keep agent config-file fallback out of the generic core.
* Put authentication behind an interactive host callback plus environment/config providers, because agent method IDs and browser/device flows differ.
* Use the official TypeScript SDK v1 connection class where it fits Ptah’s Node runtime, but wrap it in Ptah interfaces so protocol-v2 migration and vendor patches do not spread through CLI adapters.
* Treat adapters (Claude Code, Codex, Antigravity) as independently versioned dependencies with compatibility smoke tests; native-agent detection alone is not enough.

## Unverified

* First ACP-supporting release/version for every surveyed agent except local Grok 1.0.46 was not located in a primary changelog during this bounded pass.
* An official Augment/Auggie ACP server, official first-party Antigravity ACP CLI command, and ACP support for Aider/Pi were not verified; absence here is not proof of absence.
* Exact opencode start syntax is listed from its public repository ecosystem but was not corroborated by a command-reference page in this pass; validate with the installed binary before shipping detection.
* Portable v1 support for SSE MCP entries, `session/set_mode`, `session/set_model`, and a universal config-option method was not verified. Implementations show alternatives, including unstable/vendor methods.
* This report did not inspect Ptah source or package lock for an already-installed ACP SDK/client abstraction, because the stated task is ecosystem research and the provided context scopes the decision as a follow-up to Grok probing.
