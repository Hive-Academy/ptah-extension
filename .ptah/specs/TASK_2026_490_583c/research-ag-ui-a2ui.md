# Research: AG-UI and A2UI for Ptah (without CopilotKit)

## Verdict

**(i) Agent-adapter layer: NEITHER, for now.** Ptah's `chat-streaming` /
`chat-execution-tree` libs already do what AG-UI's client side does — SDK-event
ingestion, incremental tree build, dedup — over Ptah's own RPC/IPC transport.
Adopting AG-UI internally would mean rebuilding a mature, perf-tuned pipeline
for a protocol whose value is cross-framework interop Ptah does not need today.
**(ii) Setup wizard / marketplace forms: A2UI, scoped pilot.** Its declarative,
catalog-constrained format and official `@a2ui/angular` renderer (peer range
`^21.2.5`, Angular Signals) match Ptah's stack directly, but the spec is
"early stage public preview" (A2UI README) — pilot behind a feature flag, not a
hard dependency.

## AG-UI: packages and license

AG-UI (`ag-ui-protocol/ag-ui` on GitHub) is **MIT licensed**
(confirmed via `gh api repos/ag-ui-protocol/ag-ui` → `license: MIT`; 15,959
stars, created 2025-05-07, pushed 2026-09-19). It has no separate foundation —
the repo's own README states "AG-UI was born from CopilotKit's initial
partnership with LangChain and CrewAI," contribution is gated through
CopilotKit-controlled `CODEOWNERS` and a CopilotKit-run roadmap board
(`CONTRIBUTING.md`, `github.com/orgs/ag-ui-protocol/projects/1`), and its
license badge is sourced from `copilotkit/copilotkit`. Governance is
**CopilotKit-led, open-contribution**, not an independent foundation.

Releases are **rolling, dated tags** (not semver bumps) — the five most recent
GitHub releases are `release/2026-09-17`, `release/2026-09-14`,
`release/2026-09-11`, `release/2026-09-10`, `release/2026-09-09`
(`gh api repos/ag-ui-protocol/ag-ui/releases`), i.e. releases every 1–3 days.
The protocol spec itself is versioned separately and is at **1.0**
(`spec/1.0/` in the repo).

Core npm packages (all published 2026-09-17, all MIT, `npm view` per package):

| Package                      | Version | License | Unpacked size |
| ---------------------------- | ------- | ------- | ------------- |
| `@ag-ui/core`                | 1.0.0   | MIT     | 1.15 MB       |
| `@ag-ui/client`              | 1.0.0   | MIT     | 1.13 MB       |
| `@ag-ui/encoder`             | 1.0.0   | MIT     | 44.5 KB       |
| `@ag-ui/proto`               | 1.0.0   | MIT     | 1.16 MB       |
| `@ag-ui/claude-agent-sdk`    | 0.0.4   | MIT     | 271 KB        |
| `@ag-ui/a2ui-middleware`     | 0.0.10  | MIT     | 380 KB        |
| `@ag-ui/a2ui-toolkit`        | 0.0.4   | MIT     | —             |
| `@ag-ui/mcp-apps-middleware` | 0.1.1   | MIT     | 96.7 KB       |
| `@ag-ui/langgraph`           | 0.0.43  | MIT     | 449 KB        |

`@ag-ui/core`'s peer dependency is `zod: ^3.25.18 || ^4.0.0` — compatible with
Ptah's pinned Zod 4.3.6. There is **no `@ag-ui/angular` package** — searched
`docs/sdk/` in the repo (`dart, dotnet, go, java, kotlin, python, ruby, rust`,
plus `js` for TypeScript) and `gh search code angular
repo:ag-ui-protocol/ag-ui`: no Angular-specific SDK exists inside the AG-UI
repo itself.

## AG-UI: event taxonomy

| Event                                                               | Purpose                                                                             | Key fields                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `RunStarted`                                                        | Begins an agent run                                                                 | `threadId`, `runId`, optional `parentRunId`, `input`                      |
| `RunFinished`                                                       | Run completed                                                                       | optional `outcome` (success/interrupt), `result`                          |
| `RunError`                                                          | Run failed                                                                          | `message`, optional `code`                                                |
| `StepStarted` / `StepFinished`                                      | Named phase boundary within a run                                                   | `stepName`                                                                |
| `TextMessageStart` / `Content` / `End`                              | Streams one text message                                                            | `messageId`, `role`; `delta` on Content                                   |
| `TextMessageChunk`                                                  | Convenience wrapper, auto-expands to Start→Content→End                              | —                                                                         |
| `ToolCallStart` / `Args` / `End`                                    | Streams a tool invocation                                                           | `toolCallId`, `toolCallName`, optional `parentMessageId`; `delta` on Args |
| `ToolCallResult`                                                    | Tool execution output                                                               | `messageId`, `toolCallId`, `content`, optional `role`                     |
| `ToolCallChunk`                                                     | Convenience wrapper (Start→Args→End)                                                | —                                                                         |
| `StateSnapshot`                                                     | Full state replace                                                                  | `snapshot`                                                                |
| `StateDelta`                                                        | Incremental state update                                                            | `delta` — array of RFC 6902 JSON Patch ops (`op`, `path`, `value`/`from`) |
| `MessagesSnapshot`                                                  | Full conversation history                                                           | `messages[]`                                                              |
| `ActivitySnapshot`                                                  | Complete out-of-band activity state (used by A2UI and MCP Apps bridges — see below) | `messageId`, `activityType`, `content`, optional `replace`                |
| `ActivityDelta`                                                     | Incremental activity update                                                         | `patch` (RFC 6902)                                                        |
| `ReasoningStart`/`ReasoningMessageStart/Content/End`/`ReasoningEnd` | Streams a reasoning/thinking block                                                  | `messageId`, `delta` on Content                                           |
| `ReasoningEncryptedValue`                                           | Carries encrypted chain-of-thought                                                  | `encryptedValue`, subtype `message`/`tool-call`                           |
| `SubagentStarted`/`Finished`/`Error`                                | Child-agent lifecycle                                                               | `subagentRunId`, `name`, parent refs, `outcome`/`code`                    |
| `Raw`                                                               | Pass-through for foreign system events                                              | `event`, optional `source`                                                |
| `Custom`                                                            | Application-defined extension                                                       | `name`, `value`                                                           |
| `MetaEvent` (draft)                                                 | Side-band annotation                                                                | `metaType`, `payload`                                                     |

Source: `docs.ag-ui.com/concepts/events` (fetched 2026-09-20; exact spec
version not printed on the page — treat the table as the 1.0-era shape, cross
checked against `spec/1.0/` existing in the repo).

## AG-UI: transport and extension point

AG-UI is transport-agnostic **by construction of `AbstractAgent`**, not by an
explicit doc statement. Verified directly in source:

- `sdks/typescript/packages/client/src/agent/agent.ts:103` —
  `export abstract class AbstractAgent { ... }`
- `sdks/typescript/packages/client/src/agent/agent.ts:270` — the **only**
  abstract member is `abstract run(input: RunAgentInput): Observable<BaseEvent>`.
  Everything else (subscriber list, middleware chain, interrupt tracking,
  protocol-version negotiation) is transport-neutral bookkeeping in the base
  class.
- `sdks/typescript/packages/client/src/agent/http.ts:41` —
  `export class HttpAgent extends AbstractAgent`, which simply provides its own
  `run()` (line 91) that does `fetch`/SSE. `HttpAgent` is one implementation,
  not a base requirement.

**Consequence for Ptah**: a `PtahRpcAgent extends AbstractAgent` that
implements `run()` by wrapping Ptah's existing postMessage-RPC / Electron-IPC
event stream into an `Observable<BaseEvent>` is architecturally straightforward
— no HTTP, no network stack needed. This is the extension point Ptah would use
for consumption; nothing in `AbstractAgent` assumes a wire format beyond the
event union.

## AG-UI: consume vs expose

**(a) CONSUME** — Ptah as an AG-UI client talking to remote agents (LangGraph,
CrewAI, Mastra, etc.): implement `AbstractAgent.run()` to open a connection
to the target framework's AG-UI endpoint (most are `HttpAgent`-compatible
already) and translate the incoming `BaseEvent` stream into Ptah's own
execution-tree accumulator input. Officially supported server-side frameworks
(from `ag-ui-protocol/ag-ui/README.md`, "Frameworks" section):

| Framework                 | Status                       |
| ------------------------- | ---------------------------- |
| LangChain / LangGraph     | ✅ Supported (Partnership)   |
| CrewAI                    | ✅ Supported (Partnership)   |
| Microsoft Agent Framework | ✅ Supported (1st Party)     |
| Google ADK                | ✅ Supported (1st Party)     |
| AWS Strands Agents        | ✅ Supported (1st Party)     |
| Mastra                    | ✅ Supported (1st Party)     |
| Pydantic AI               | ✅ Supported (1st Party)     |
| Agno                      | ✅ Supported (1st Party)     |
| LlamaIndex                | ✅ Supported (1st Party)     |
| AG2                       | ✅ Supported (1st Party)     |
| AWS Bedrock Agents        | 🛠️ In Progress               |
| Claude Agent SDK          | ✅ Supported (Community)     |
| Claude Managed Agents SDK | ✅ Supported (Community)     |
| Langroid                  | ✅ Supported (Community)     |
| OpenAI Agent SDK          | 🛠️ In Progress               |
| Cloudflare Agents         | 🛠️ In Progress               |
| Oracle Agent Spec         | ✅ Supported (Specification) |

None of these are frameworks Ptah currently wraps (Ptah wraps
`@anthropic-ai/claude-agent-sdk`, Codex SDK, Copilot SDK directly) — CONSUME
value is real only if/when a user wants Ptah to drive a _remote_ LangGraph/
CrewAI/Mastra agent, which is not in Ptah's current scope per `context.md`.

**(b) EXPOSE** — Ptah's own agent sessions served as an AG-UI endpoint: **yes,
a server-side TS helper exists for exactly Ptah's underlying SDK.**
`@ag-ui/claude-agent-sdk` ships `ClaudeAgentAdapter`
(`integrations/claude-agent-sdk/typescript/README.md`): construct it with
`agentId`/`model`/`systemPrompt`, call `adapter.run(input)`, get back an
`Observable<BaseEvent>` to pipe to any transport. It documents interrupt
support, dynamic frontend tools via MCP, streaming tool-argument deltas, and
bidirectional state sync (`ag_ui_update_state` tool) — the same shape as
Ptah's own permission/interrupt and state-sync concerns in
`PermissionHandlerService` / `TurnStateApplier` (chat-streaming). This is a
real, low-effort door if Ptah ever needs to let an external AG-UI-speaking
frontend (not just its own webview) drive a Ptah agent session — but Ptah is
local-first with no such external-frontend requirement today.

## AG-UI: framework integration status

See the CONSUME table above for agent-framework status. For **UI clients**
specifically (from the same README, "Client" section):

| Client                        | Status         | Note                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CopilotKit (React)            | ✅ 1st Party   | Reference client, React-only                                                                                                                                                                                                                                                                             |
| React Native                  | ✅ 1st Party   | CopilotKit-maintained                                                                                                                                                                                                                                                                                    |
| Chat platforms (Slack, Teams) | ✅ 1st Party   | Via `channels-sdk`                                                                                                                                                                                                                                                                                       |
| Terminal + Agent              | ✅ Community   | `docs.ag-ui.com/quickstart/clients`                                                                                                                                                                                                                                                                      |
| **Angular**                   | **Not listed** | No official or community Angular AG-UI client found in the repo or npm (`@ag-ui/angular` returns npm 404); the closest thing is CopilotKit's own `@copilotkit/angular` (0.5.2, MIT, but peers on `@angular/core: ^22.0.0` — see lane-1 report for the version-mismatch detail against Ptah's Angular 21) |

**Frontend tools / HITL / shared state / generative UI, at the protocol
level:**

- **Frontend tools**: the agent emits `ToolCallStart/Args/End` for a
  tool the _frontend_ is expected to execute; the client runs it and returns
  a `ToolCallResult`. No special event type — same tool-call events used for
  backend tools, distinguished by which side has the implementation.
- **Human-in-the-loop / interrupts**: `RunFinished.outcome.type === "interrupt"`
  populates `AbstractAgent.pendingInterrupts` (`agent.ts` field, confirmed in
  source); the run is resumable rather than terminal.
- **Shared state**: `StateSnapshot` (full replace) and `StateDelta` (RFC 6902
  JSON Patch array) — `docs.ag-ui.com/concepts/state`.
- **Generative UI**: AG-UI itself has no native component-catalog concept; it
  carries _other_ generative-UI protocols as payload — see the relation
  section below.

## A2UI: status and license

A2UI (`a2ui-project/a2ui` on GitHub, homepage `a2ui.org`) is
**Apache-2.0 licensed** (`gh api repos/a2ui-project/a2ui` → `license:
Apache-2.0`). Ownership: Google, via CLA — `CONTRIBUTING.md` requires signing
`cla.developers.google.com`, follows "Google's Open Source Community
Guidelines," and references an internal Google triage process
(`go/a2ui-triage`). The project's own README states it was "created by Google
with contributions from CopilotKit and the open source community."

**Spec stability**, quoted directly from the repo README (`⚠️ Status: Early
stage public preview`):

> "A2UI's current production release is v0.9.1, a patch release in the stable
> v0.9 protocol family. The v1.0 specification is a release candidate, while
> v0.8 is legacy. The specification and implementations are functional but
> are still evolving."

`specification/v1_0/README.md` confirms: "This specification is currently a
candidate for becoming stable" and "There is a high bar for accepting
breaking changes to a candidate specification" — i.e. 1.0 is not yet frozen.
`specification/v0_9_1/README.md` marks that version "closed" (no further
changes accepted there).

**Release cadence**: very active — commit log shows 5+ merged PRs in the 3
days before 2026-09-20 (`gh api repos/a2ui-project/a2ui/commits`), spanning
Dart, MCP-catalog, and doc changes. Repo-level semver tags exist only for
per-language sub-packages (`v0.9`, `v0.8`, `python/a2ui-core/v0.1.1`,
`python/a2ui-agent-sdk/v0.6.0`) — there is no single repo-wide release tag.

## A2UI: format

A2UI's own README states the design goal directly: "safe like data, but
expressive like code" — a **declarative JSON format**, not executable UI code.

- **Component catalog**: a JSON-Schema document (`catalogId` + `$id`, matched
  string-for-string between client and server) listing every component type
  and prop shape the server is allowed to emit — e.g. `Card`, `Row`, `Column`,
  `TextField`, `Button`. Servers may define their own catalog; nothing forces
  the default "Basic Catalog."
- **UI composition — adjacency list**: components are a **flat list**, not a
  nested tree; each has an `id` and references children by id. Exactly one
  component must have `id: "root"`. This lets the server stream components in
  any order — the client buffers non-root updates until `root` appears, then
  renders progressively (`specification/v0_9_1/docs/a2ui_protocol.md`,
  "UI composition: the adjacency list model").
- **Data model**: components bind to a path-addressed data model
  (`{"path": "/contact/email"}`); server pushes updates via `updateDataModel`;
  two-way-bound inputs write back to the same path and the client sends the
  changed subtree back to the server as a metadata-carried "client data model"
  on the next action.
- **Streaming transport contract**: A2UI is explicitly "transport-agnostic" at
  the protocol level (same doc, "Transport decoupling") but requires **ordered,
  framed delivery** — JSONL newlines, WebSocket frames, or SSE events all
  qualify. It names **AG-UI explicitly as one of its transport bindings**:
  "AG-UI is also an excellent transport option for A2UI ... provides low
  latency and shared state message passing between front ends and agentic
  backends" (same doc, "AG UI (Agent to User Interface) binding"). Other named
  transports: A2A, MCP (as tool output/resource subscription), raw SSE+JSON-RPC,
  WebSockets, REST.
- **Four envelope message types**: `createSurface`, `updateComponents`,
  `updateDataModel`, `deleteSurface`. Condensed example (spec doc, "Example
  Stream", trimmed):

```jsonl
{"version":"v0.9.1","createSurface":{"surfaceId":"contact_form_1","catalogId":"https://a2ui.org/.../basic/catalog.json"}}
{"version":"v0.9.1","updateComponents":{"surfaceId":"contact_form_1","components":[{"id":"root","component":"Card","child":"form_container"}, ...]}}
{"version":"v0.9.1","updateDataModel":{"surfaceId":"contact_form_1","path":"/contact","value":{"firstName":"John","email":"john.doe@example.com"}}}
{"version":"v0.9.1","deleteSurface":{"surfaceId":"contact_form_1"}}
```

- **User actions flow back**: a `Button`'s `action.event` carries a `name` and
  a `context` object (which may itself contain data-bound values); the client
  sends this back to the server as the action payload — the return channel is
  optional per the transport contract but required for interactive surfaces.

## A2UI: Angular renderer

Official package: **`@a2ui/angular`**, published by the `a2ui-team` (npm
maintainers `a2ui-team`, `ava-cassiopeia`, `jsimionato`), repository
`github.com/a2ui-project/a2ui` (the `renderers/angular/` folder), homepage
`a2ui.org`.

| Field                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version                 | 0.10.7 (published 2026-09-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| License                 | Apache-2.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Angular peer range      | `@angular/core` / `@angular/common` / `@angular/platform-browser`: `^21.2.5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Other peers             | `@a2ui/markdown-it: ^0.1.2`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Unpacked size           | 2.18 MB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Signals/zoneless/OnPush | Uses Angular Signals for rendering ("Reactive Rendering: Uses Angular Signals for efficient, fine-grained UI updates" — `renderers/angular/README.md`); package ships as standalone components (`SurfaceComponent`, `ComponentHostComponent` are `standalone: true` in the usage examples). No explicit zoneless/OnPush claim in the README, but signal-driven + standalone strongly implies OnPush-compatible, zoneless-friendly usage. **UNVERIFIED**: whether the components declare `ChangeDetectionStrategy.OnPush` internally — would need to read the renderer's own source, out of this research's scope. |
| Maturity                | Pre-1.0 (`0.10.7`), versioned protocol import path (`@a2ui/angular/v0_9`) — the package explicitly supports multiple protocol versions side by side, which is a hedge against the v0.9→v1.0 transition described above.                                                                                                                                                                                                                                                                                                                                                                                           |

`@a2ui/angular`'s peer range (`^21.2.5`) is an **exact match** for Ptah's
Angular 21. By contrast, `@copilotkit/angular` (0.5.2) peers on
`@angular/core: ^22.0.0` — a version Ptah does not run (see the lane-1
CopilotKit report for the full comparison).

**Custom component catalog**: yes. The renderer is explicitly catalog-driven
— `A2UI_RENDERER_CONFIG` takes a `catalogs: [new BasicCatalog()]` array, and
the "Component Catalog Pattern" doc (`skills/ag-ui-a2ui-integration/
references/a2ui-runtime-and-renderer.md`, in the AG-UI repo, describing the
same registry pattern used on both React and Angular renderers) shows
registering a custom `Catalog` keyed by `catalogId` with the host's own
component implementations. Ptah could register its own daisyUI/Tailwind
components (buttons, cards, form fields) as an A2UI catalog instead of using
`BasicCatalog`; the server (Ptah's backend) just needs to emit `component`
names matching that catalog's schema.

## A2UI: security model

**Declarative-data-only, no code execution.** Direct quote,
`renderers/angular/README.md` "Security" section — inherited from A2UI's
core design principle in the main README: "A2UI is a declarative data format,
not executable code. Your client application maintains a 'catalog' of
trusted, pre-approved UI components ... and the agent can only request to
render components from that catalog."

**Trust boundary**: the client (Ptah's webview/Electron renderer) is the sole
authority over what can render — the server can only reference component
_names_ already compiled into the client's catalog; it cannot inject markup,
scripts, or arbitrary DOM. This is categorically different from rendering
agent-produced HTML, which requires a sanitizer (Ptah's `libs/frontend/
markdown` DOMPurify chokepoint) precisely because HTML _is_ code-adjacent
(event handler attributes, `<script>`, `javascript:` URLs). A2UI's component
tree has no equivalent injection surface by construction — the closest analog
Ptah already trusts is Angular's own template binding, not raw HTML.

Ptah still owns two residual risks, per the Angular renderer's own security
note (`renderers/angular/README.md`, "Security"): (1) treat all
agent/server-supplied field values (labels, text content) as **untrusted
data** even though they cannot carry code — a malicious or malfunctioning
remote agent could still attempt phishing-style spoofing through legitimate-
looking labels; (2) if a host ever adds an "embedded content" component
(iframe, webview-in-webview) to its _own_ catalog, that specific component
reintroduces an HTML-like trust boundary and needs the same scrutiny as the
markdown chokepoint. Neither risk exists in A2UI's base catalog.

## How AG-UI, A2UI and MCP Apps relate

They are **three separate specs that compose, not compete**, per AG-UI's own
positioning: "MCP gives agents tools / A2A allows agents to communicate with
other agents / AG-UI brings agents into user-facing applications"
(`ag-ui-protocol/ag-ui/README.md`, "Where does AGUI fit in the agentic
protocol stack?"). A2UI's spec explicitly lists AG-UI as a **transport
option** for A2UI payloads (`specification/v0_9_1/docs/a2ui_protocol.md`,
"AG UI (Agent to User Interface) binding") and separately lists MCP as
another transport, "delivered as tool outputs or resource subscriptions."

Concretely, in the AG-UI TypeScript stack, **both A2UI and MCP Apps ride
inside the same AG-UI event type — `ACTIVITY_SNAPSHOT` — distinguished only
by the `activityType` field**:

- `@ag-ui/a2ui-middleware` emits `{ type: "ACTIVITY_SNAPSHOT", activityType:
"a2ui-surface", ... }` and turns client actions into synthetic
  `log_a2ui_event` tool messages back to the agent
  (`skills/ag-ui-a2ui-integration/references/a2ui-runtime-and-renderer.md`).
- `@ag-ui/mcp-apps-middleware` emits `{ type: "ACTIVITY_SNAPSHOT",
activityType: "mcp-apps", content: { result, resourceUri, serverHash,
toolInput }, replace: true }`, then the frontend fetches the actual UI
  resource via a proxied MCP request using `resourceUri`
  (`middlewares/mcp-apps-middleware/README.md`).

So: **AG-UI is the pipe; A2UI and MCP Apps are two different payload formats
that can travel through that pipe.** They are not layered (A2UI does not sit
"on top of" AG-UI, nor vice versa) — a Ptah backend that wants to speak either
A2UI or MCP Apps does **not** need to adopt AG-UI's event stream to do so; it
only needs AG-UI if it wants that specific activity-event framing and
middleware ecosystem. Given Ptah's RPC/IPC transport is not HTTP and not
AG-UI shaped today, Ptah could carry A2UI's four envelope types directly over
its own RPC methods without going through AG-UI at all — a fifth transport
binding the A2UI spec itself allows for ("A2UI is designed to be
transport-agnostic ... does not mandate a specific transport layer").

## Risks

1. **A2UI is pre-1.0 and says so itself** ("Early stage public preview";
   spec 1.0 is a "candidate," not stable). A production dependency today means
   tracking a still-moving wire format and an Angular renderer at `0.10.x`.
2. **No official Angular client from AG-UI at all** — the only two Angular
   consumers found (`@copilotkit/angular`, `@threadplane/chat`) are third-party
   and, in CopilotKit's case, version-incompatible with Ptah's Angular 21.
   Any AG-UI adoption for UI purposes routes through community code, not a
   protocol-maintained one.
3. **Rebuilding Ptah's streaming pipeline around AG-UI's event vocabulary
   would be a large, low-payoff migration.** `chat-streaming`'s accumulator,
   incremental tree builder, retention caps, and turn-state model
   (`libs/frontend/chat-streaming/CLAUDE.md`) already solve the same problem
   AG-UI's event types solve, tuned to Ptah's own transport and UI. AG-UI adds
   value primarily for _cross-framework_ interop Ptah does not need yet.

## Unknowns

- Whether `@a2ui/angular`'s internal components declare
  `ChangeDetectionStrategy.OnPush` and run correctly in a zoneless host —
  **UNVERIFIED**, would require reading renderer source beyond this task's
  scope.
- Whether A2UI's Angular renderer or web_core package works inside a VS Code
  webview's strict CSP (e.g. any inline-style or `eval`-adjacent code paths) —
  **UNVERIFIED**, not tested.
- AG-UI's exact protocol/spec version number is not printed on
  `docs.ag-ui.com/concepts/events`; inferred as 1.0-era from the repo's
  `spec/1.0/` folder and the 1.0.0 npm package versions, but the docs site
  itself does not label a page version — **UNVERIFIED** against a
  docs-published version number.
- Whether AG-UI's `@ag-ui/claude-agent-sdk` adapter (Python vs. TypeScript
  variants; the dojo demo path references `claude-agent-sdk-python`) has
  parity with the TypeScript `ClaudeAgentAdapter` described here, or whether
  the TypeScript one is newer/older — **UNVERIFIED**, only the TypeScript
  README was read.

## Sources

- `gh api repos/ag-ui-protocol/ag-ui` — license, stars, org, dates
- `gh api repos/ag-ui-protocol/ag-ui/releases` — release cadence
- `gh api repos/ag-ui-protocol/ag-ui/contents/README.md` — governance,
  framework/client integration tables, protocol-stack positioning
- `gh api repos/ag-ui-protocol/ag-ui/contents/CONTRIBUTING.md` — contribution
  process
- `ag-ui-protocol/ag-ui:sdks/typescript/packages/client/src/agent/agent.ts:103,270` —
  `AbstractAgent` definition and its one abstract member
- `ag-ui-protocol/ag-ui:sdks/typescript/packages/client/src/agent/http.ts:41,91` —
  `HttpAgent extends AbstractAgent`
- `ag-ui-protocol/ag-ui:integrations/claude-agent-sdk/typescript/README.md` —
  `ClaudeAgentAdapter`
- `ag-ui-protocol/ag-ui:skills/ag-ui-a2ui-integration/references/a2ui-runtime-and-renderer.md` —
  A2UI↔AG-UI bridge (`@ag-ui/a2ui-middleware`, `ACTIVITY_SNAPSHOT`)
- `ag-ui-protocol/ag-ui:middlewares/mcp-apps-middleware/README.md` — MCP
  Apps↔AG-UI bridge
- `ag-ui-protocol/ag-ui:sdks/typescript/packages/a2ui-toolkit/README.md`
- https://docs.ag-ui.com/concepts/events (fetched 2026-09-20) — event
  taxonomy
- https://docs.ag-ui.com/concepts/agents (fetched 2026-09-20) — agent/run
  model description
- https://docs.ag-ui.com/concepts/state (fetched 2026-09-20) — state sync
- `npm view @ag-ui/{core,client,encoder,proto,claude-agent-sdk,
a2ui-middleware,a2ui-toolkit,mcp-apps-middleware,langgraph}` (queried
  2026-09-20) — versions, licenses, sizes, peers
- `gh api repos/a2ui-project/a2ui` — license, owner, homepage
- `gh api repos/a2ui-project/a2ui/contents/{specification,renderers}` —
  spec-version and renderer directory listing
- `a2ui-project/a2ui:README.md` (raw, fetched 2026-09-20) — status quote,
  design philosophy
- `a2ui-project/a2ui:specification/v1_0/README.md`,
  `specification/v0_9_1/README.md` — spec stability statements
- `a2ui-project/a2ui:specification/v0_9_1/docs/a2ui_protocol.md` — transport
  decoupling, envelope types, example JSONL stream, component/adjacency
  model, data binding
- `a2ui-project/a2ui:renderers/angular/README.md` — Angular renderer
  features, install, security note
- `a2ui-project/a2ui:CONTRIBUTING.md` — Google CLA, `go/a2ui-triage`
- `gh api repos/a2ui-project/a2ui/commits` — commit cadence
- `npm view @a2ui/{angular,web_core,lit,react}` (queried 2026-09-20)
- `npm view @copilotkit/angular`, `npm view @threadplane/chat` (queried
  2026-09-20) — comparison data points for the Angular-client landscape
