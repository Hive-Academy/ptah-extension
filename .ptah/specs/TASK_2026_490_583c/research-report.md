# Research report - generative UI for Ptah

Date: 2026-09-20. Synthesis of four inputs in this folder:

- `research-copilotkit-angular.md` (codex lane)
- `research-ag-ui-a2ui.md` (claude cli lane)
- `research-mcp-apps.md` (claude cli lane)
- `ptah-integration-seams.md` (in-process code survey)

The orchestrator checked these claims directly: npm versions, licenses and peer ranges of `@copilotkit/angular`,
`@a2ui/angular`, `@ag-ui/client`, `@modelcontextprotocol/ext-apps`. The webview CSP. The MCP dispatcher methods. The
`ptah-json-schema-form` consumer. All agreed with the lane reports, with one correction (see MCP Apps).

## Decision table

| Candidate                    | Decision                           | Primary cause                                                                           |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| CopilotKit Angular           | **Do not adopt**                   | Needs Angular 22. Unsanitized `innerHTML`. Custom transport is documented as Enterprise |
| AG-UI as internal event type | **Closed** (same as TASK_2026_298) | 10 of 20 Ptah event kinds have no AG-UI counterpart                                     |
| AG-UI consume adapter        | **Defer, small**                   | One `CliAdapter`. Do it when a user needs a remote LangGraph / CrewAI / Mastra lane     |
| AG-UI expose endpoint        | **Defer**                          | A distribution bet. Egress only, leaf lib, as TASK_2026_298 recorded                    |
| A2UI                         | **Pilot**                          | Angular 21 peer match, declarative, custom catalog, no code execution                   |
| MCP Apps host                | **Defer, blocked**                 | `frame-src 'none'` and Ptah does not see third-party MCP frames                         |
| MCP Apps author              | **Defer, small**                   | Low value until a host renders it. Possible now with `ext-apps` 1.7.5                   |

## 1. CopilotKit Angular - do not adopt

The package is free: `@copilotkit/angular` 0.5.2, MIT, first-party. The older `@copilotkitnext/angular` was proprietary.
The license is not the problem. These are:

1. Peer range `@angular/core ^22.0.0`. Ptah is on 21.2.6.
2. The assistant renderer puts `marked` output into `innerHTML` with no sanitizer. This breaks the single-chokepoint
   rule of `libs/frontend/markdown`.
3. Ptah has no HTTP runtime in the webview, so it needs a custom `AbstractAgent`. The documentation puts production
   `selfManagedAgents` in the Enterprise Intelligence tier. The MIT code does not enforce this, but the policy risk is real.
4. 72 packages, Zod 3, `marked`, `highlight.js`, `katex`, a web inspector with telemetry.
5. Threads, memory and analytics need the hosted CopilotKit Intelligence service. Ptah has these locally.

OpenBot does not change this. Its UI is React. It is an architecture reference only.

## 2. AG-UI - not internal, optional at the edge

AG-UI is MIT, specification 1.0, controlled by CopilotKit, with no Angular client. It is transport-neutral:
`AbstractAgent.run(): Observable<BaseEvent>` is the only abstract member.

The event mapping in `ptah-integration-seams.md` section 1 confirms the TASK_2026_298 verdict with evidence.
`parentToolUseId`, `blockIndex`, `workflowRunId`, compaction and background-agent events have no AG-UI field.

One new fact: a consume adapter is cheap. It is a `CliAdapter`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:152`), modelled on
`ptah-cli-registry.ts:1389-1440`, with no frontend change. It makes a remote AG-UI agent a spawnable lane. Build it
when a user asks for it, not before.

## 3. A2UI - the pilot candidate

Why it fits:

- `@a2ui/angular` 0.10.7, Apache-2.0, peer `@angular/core ^21.2.5`, signals, standalone components.
- The payload is data. The agent can only name components from a catalog that the client compiled. No sandbox is
  necessary because nothing executes.
- The lane report says that the host can supply its own catalog. Ptah can then render with its daisyUI components.
- A2UI is transport-agnostic. The four envelopes (`createSurface`, `updateComponents`, `updateDataModel`,
  `deleteSurface`) can go through a Ptah push message. AG-UI is not necessary.
- Ptah already has this pattern once, by hand: `ptah_harness_propose_config` -> `harness:config-proposed` -> signal ->
  preview component. A2UI is the general form of it.

Risks:

1. Public preview. Specification 1.0 is a release candidate. The renderer is 0.10.x.
2. Peer dependency `@a2ui/markdown-it`. This is a second markdown path. A Ptah catalog must not use it, or must route
   text through `libs/frontend/markdown`.
3. Not verified: OnPush and zoneless behavior inside the renderer. Not verified: operation under the webview CSP
   (`script-src` nonce only, `style-src` nonce only).
4. Field values from an agent are untrusted data. Labels can spoof.

Two fallback positions if the renderer fails the spike: use only the A2UI wire format with a Ptah renderer, or extend
`JsonSchemaFormComponent` without A2UI.

### Where it goes first

| Surface                                                          | Decision               | Reason                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP server install, env-var and credential form                  | **First**              | No form exists today. The clearest gap (`mcp-directory-browser.component.ts`)                                                              |
| Agent-driven cards in chat (richer than `QuestionCardComponent`) | Second                 | Needs the component registry below                                                                                                         |
| Setup wizard steps                                               | Later                  | Steps are a literal array. A large rewrite for small gain                                                                                  |
| Plugin install consent dialog                                    | **Never agent-driven** | `external-consent-dialog.component.ts:22-58` is a security contract. An agent must not author the screen that approves the agent's install |
| Permission card                                                  | **Never agent-driven** | Same reason                                                                                                                                |

## 4. MCP Apps - defer both roles

Host role is blocked two times:

1. CSP: `frame-src 'none'` at `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:276`. VS Code uses the
   internal `IWebviewService` for its own implementation. An extension cannot call it. Ptah must build the sandbox proxy
   iframe itself, and the origin behavior of `srcdoc` and `blob:` inside a webview is not verified.
2. Ptah does not see third-party MCP frames. The vendor SDK owns the connection. Only `{ name, status }` reaches Ptah
   (`session-mcp-status-callback-registry.ts:8`). A host must read tool `_meta` and call `resources/read`.

Author role is small: add `resources/list` and `resources/read` to `protocol-dispatcher.ts:177-183` and widen the
capabilities at `:222-234`. But Ptah cannot render the result itself. The value is only that the same card renders in
Claude, ChatGPT, VS Code Copilot Chat, Cursor and Goose. That is a distribution goal, not a product gap.

Correction to the lane report: `@modelcontextprotocol/ext-apps` 2.0.0 needs `@modelcontextprotocol/core` and `client`
`^2.0.0`. Ptah is on `@modelcontextprotocol/sdk ^1.29.0`. Version 1.7.5 has the peer `sdk ^1.29.0`. Use 1.7.5 until
Ptah moves to MCP SDK 2.

## 5. Recommended sequence

Step 1 does not depend on any of the candidates and has value alone.

1. **Tool-name to component registry.** Replace the `@switch` chains at `execution-node.component.ts:443-452` and
   `tool-output-display.component.ts:56-63` with a `Map<toolName, ComponentType>`. Each candidate needs this.
2. **A2UI spike** in one throwaway branch. Answer four questions: OnPush and zoneless. Webview CSP. Catalog with Ptah
   components and no `@a2ui/markdown-it`. Added bundle size in the webview build.
3. **If the spike passes:** a new `libs/frontend` lib for the Ptah catalog and surface host, one push message type in
   `libs/shared`, one MCP tool on the Ptah server that emits a surface (same shape as `ptah_harness_propose_config`),
   and an action channel back to the agent. First surface: the MCP install env-var form.
4. **If the spike fails:** extend `JsonSchemaFormComponent` (nested objects, arrays, actions) and use it for the same form.
5. Open the AG-UI consume adapter and MCP Apps only when a user need appears.

## 6. Unknowns

- `@a2ui/angular` under OnPush, zoneless and the webview CSP. Step 2 answers this.
- CopilotKit position on a custom `AbstractAgent` in production. Not relevant under this recommendation.
- Whether an MCP server in the Ptah marketplace registries ships a `ui://` app today. Not examined.
- The `srcdoc` and `blob:` iframe origin behavior inside a VS Code webview. Necessary only for the MCP Apps host role.

---

# Revision 2 - under the product vision (2026-09-20)

See `context.md`, "Product vision". The criteria changed: Electron first, latest packages, peer ranges managed with
`overrides`, audience wider than developers, MCP Apps host and author roles are product goals. Sections 1 to 6 above
stay as the record of the first synthesis. Where they disagree with this revision, this revision applies.

## Revised decision table

| Candidate                  | Revision 1       | Revision 2                    | Role in the product                                              |
| -------------------------- | ---------------- | ----------------------------- | ---------------------------------------------------------------- |
| MCP Apps host              | Defer, blocked   | **Priority 1**                | Rich interactive output in chat. Parity with Claude Desktop      |
| MCP Apps author            | Defer, low value | **Priority 2**                | "Build your own app" workflow. First-party chart and stats apps  |
| A2UI (declarative)         | Pilot            | **Priority 3**                | Native guided forms for workflow builders who are not developers |
| Tool to component registry | Step 1           | **Step 0, no change**         | Each item above mounts through it                                |
| AG-UI                      | Not internal     | No change                     | Optional consume adapter later                                   |
| CopilotKit Angular         | Do not adopt     | Do not adopt as the chat core | Its `mcp-apps` subpath is a reference implementation only        |

## New facts that the orchestrator checked

1. `@anthropic-ai/claude-agent-sdk` 0.3.150, `sdk.d.ts:1036-1076`: `mcpServerStatus()` returns, for each tool, `name`,
   `description` and `annotations` only. It does not return `_meta`. Ptah cannot learn `_meta.ui.resourceUri` of a
   third-party tool through the SDK.
2. `sdk.d.ts:3207-3214`: `SdkMcpToolDefinition` has `_meta?: Record<string, unknown>`. A tool that Ptah defines on an
   in-process SDK server can carry `_meta.ui`.
3. `ReadMcpResource` and `ListMcpResources` (`sdk-tools.d.ts`) are tools that the model calls. They are not a host API.
4. `@a2ui/angular` 0.10.7 peers on `^21.2.5` and npm has no later version. Angular latest is 22.1.7. An `overrides`
   entry is necessary after the migration. A lib that was built for an older Angular usually links under a newer one.
   A production build must prove it.
5. `@copilotkit/a2ui-renderer` has peer dependencies on `react` and `react-dom`. `@copilotkit/angular` depends on it.

## Architecture that the facts force: an MCP Apps broker

Because of fact 1, the host role needs a Ptah-owned MCP client, separate from the SDK connection:

- Ptah already assembles the `mcpServers` configuration (`sdk-query-options-builder.ts:916`), so it knows each server.
- The broker connects to each server, advertises `io.modelcontextprotocol/ui`, caches `tools/list` with `_meta`, and
  calls `resources/read` for `ui://` resources.
- When a `tool_result` for `mcp__<server>__<tool>` arrives and the cached tool has `_meta.ui.resourceUri`, the chat
  mounts the app view through the component registry, below the normal tool card.
- Tool calls that the app starts go through the broker, not through the agent. The host enforces `visibility: ["app"]`.
- Known cost: a stdio server runs two times (one process for the SDK, one for the broker). State is not shared. HTTP
  servers do not have this cost. This design is not tested.
- The broker is a backend lib behind a `platform-core` port. The Electron adapter supplies the view. The VS Code and
  CLI adapters supply the mandatory text fallback. This keeps the hexagonal rule.

## Security work that the host role makes mandatory

- The Electron shell has no runtime CSP now. Add one before third-party HTML renders.
- Sandboxed iframe without `allow-same-origin` for the app document. CSP from the resource `_meta.ui.csp`, restrictive
  default when absent.
- A consent policy for app-started tool calls. The specification leaves it to the host.
- The plugin consent dialog and the permission card stay hand-built. An app or an agent must not author them.

## Product shape

1. **Apps in chat.** An installed server that ships a `ui://` app shows it in Ptah. The marketplace marks such servers.
2. **Visual output for coding.** First-party apps on the Ptah MCP server: chart, table, dependency graph, test and
   coverage summary, token and cost stats. One `ui://` chart app plus one tool gives charts to each agent and provider.
   This also proves the author path with Ptah's own code.
3. **App studio.** A new setup workflow: the user describes an app, the agent writes the tool and the `ui://` resource
   into a local MCP server, Ptah loads it, the user sees it live. Ship a gallery from the official `ext-apps` examples.
4. **Guided workflow builder.** Declarative forms (A2UI wire format, Ptah catalog) for the steps where a person who is
   not a developer configures an agent, a schedule, a gateway or a connector.

## Revised sequence

0. Tool to component registry.
1. Workspace migration (Angular 22, MCP SDK 2) as its own task.
2. Spike: MCP Apps broker + sandboxed view in Electron, with one `ext-apps` example server. Exit criteria: app
   renders, app-started tool call works, double-process cost measured, CSP in place.
3. First-party chart app on the Ptah MCP server (needs `resources/list` and `resources/read` in
   `protocol-dispatcher.ts`).
4. Marketplace: app badge, examples gallery.
5. App studio workflow.
6. Declarative forms for the guided builder.

## Open risks

- Two audiences in one product. The guided builder must not make the coding surface heavier.
- Third-party HTML is a new trust boundary for Ptah. Revision 1 had none.
- `overrides` hides a peer conflict. It does not remove an API break. Each overridden package needs a build and a
  render test in CI.

---

# Revision 3 - separate page, shared actions, declarative dashboards (2026-09-20)

Inputs: the user decision to put the feature on its own page, and `landscape.md`. Where Revision 2 disagrees,
this revision applies.

## Decisions

1. **Separate page.** The new surface is its own page with its own logic, Electron only at first (precedent: the Thoth
   tabs). Third-party HTML never enters the DOM of the coding chat. The page registers its own interactive surface in
   `StreamingSurfaceRegistry`, as the harness builder does. The tool-to-component registry in the chat is no longer a
   precondition.
2. **Shared actions** (principle from agent-native). A capability of the new page is defined one time and registered
   both as an RPC method for the UI and as an MCP tool for the agent. Same validation, same permission, same code.
3. **Shared application state.** The agent on the page receives the active app, the selected record and the active view.
4. **Declarative dashboards** (pattern from json-render). Ptah ships one generic first-party dashboard app. The agent
   emits a JSON spec from a fixed catalog (chart, table, stat, list, form). The agent does not write HTML for this path.
5. **Pinned apps.** A user pins an app. `cron-scheduler` refreshes it. `messaging-gateway` can deliver the result.
6. **Charts in the coding chat** come last, through one narrow mount point, after the page proves the host.
7. **Package compatibility** is handled with `overrides`. Each overridden package needs a build and a render test in CI.

## Planned features (marketing view, not built)

For all users: apps in the conversation. App studio (describe an app, the agent builds it, live preview). Pinned apps
with scheduled refresh. Delivery to Telegram, Discord, Slack. Gallery of apps that can be copied. One-step integrations
from the marketplace. Guided setup forms.

For developers: visual answers (dependency graph, coverage, bundle size, cost). Review surfaces. Apps that use the MCP
Apps standard and so can render in other hosts. One definition for each action. No change to the coding surface.

Differentiators claimed: local-first, any model provider, agents that run without the user (schedule, gateways,
memory, skills exist now), open standard, sandbox for each app.

Recommended first release: two claims only - apps in the conversation, and visual answers.

## Sequence

1. Workspace migration to the latest packages (Angular 22, MCP SDK 2), as its own task.
2. Spike: the new page in Electron, MCP Apps broker, sandboxed view, one `ext-apps` example server. Exit criteria: the
   app renders, an app-started tool call works, the cost of the second stdio process is measured, the Electron shell
   has a CSP.
3. Shared action definition (RPC + MCP tool from one source).
4. Generic dashboard app that renders JSON specs.
5. Pinned apps with scheduled refresh.
6. App studio and gallery.
7. One narrow mount point in the coding chat for charts.

---

# Revision 4 - after the two adversarial reviews (2026-09-20)

Inputs: `critique-engineering.md` (codex lane) and `critique-product.md` (antigravity lane). The orchestrator checked
six load-bearing engineering claims in the code. All six were correct. Where Revision 3 disagrees, this revision applies.

## Corrections to Revision 3

1. **The dual-connection broker is rejected.** The orchestrator proposed it. It is wrong for stateful stdio servers:
   two memories, lock and port conflicts, double OAuth refresh, double rate-limit load, and a second authorization path
   that does not go through `canUseTool`. Replacement: a single-owner broker. Ptah owns the only upstream connection and
   gives each server to the vendor SDK again as an in-process SDK server (`createSdkMcpServer`, `sdk.d.ts:463`,
   `type: 'sdk'` at `:1014`, `_meta` kept at `:3212`). Later, a loopback proxy serves the other providers.
2. **The server inventory is not complete.** `sdk-query-options-builder.ts:916` passes only the Ptah server plus
   overrides. The SDK also loads servers from settings files (`settingSources`, `:942`), and `setMcpServers()` does not
   affect those (`sdk.d.ts:2305`). Exclusive ownership is not proved. It is Gate 0 of the host work.
3. **A defect exists now in Electron.** `main-window.ts:136-143` grants each permission request when the top-level
   `webContents` id agrees. A subframe shares that id. Correct this before any iframe work. The preload exposes `vscode`
   (generic RPC), `ptahClipboard` and `ptahDiag` (`preload.ts:23,48,60`). App HTML must never get that origin or preload.
4. **The migration is not a precondition.** Angular 22 and MCP SDK 2 prove nothing about the broker or the sandbox. Use
   the current versions (`ext-apps` 1.7.5 agrees with MCP SDK 1.29) and migrate as an independent task.
5. **Pinned refresh must be deterministic by default.** The scheduler runs a model prompt or a `handler:NAME`
   (`job-runner.ts:14,60`). A refresh re-runs a stored tool call without a model. Agent refresh is opt-in, with a budget.
6. **Gateway delivery is text only now** (`adapter.interface.ts:107,116`: `sendMessage`, `editMessage`). The first
   delivery format is a text summary with a deep link.
7. **UI clicks must not go through the model.** Sort, filter and page operate in the app or call a tool directly.

## Product decisions that the reviews put to the user

- Audience: the product review says that "developers and everyone" is two products, and recommends one beachhead:
  the technical operator (technical PM, DevOps, data lead, technical founder). This is a sequence decision, not a
  rejection of the vision.
- The loop that only Ptah has: chat query -> visual card -> pin -> scheduled refresh -> delivery to a channel.
- App studio and public gallery: move to the end. Ship first-party templates first.
- Known limit of local-first: a closed laptop stops the schedule. Record it. Do not design a cloud service now.

## Sequence

A. **Dashboard track (no third-party HTML, no broker, no migration).**

1.  Versioned catalog and Zod schema (stat, line and bar chart, table, list). Atomic specs, byte and row limits, text fallback.
2.  One MCP tool that emits a spec, and the new page that renders it with Ptah components.
3.  Pin: store the spec and the tool call in SQLite. Deterministic refresh through a scheduler handler. Text delivery.
4.  Measure: share of users who pin, and retention of pins after 14 days.

B. **Host track, in parallel, spikes only.** 0. Correct the permission handler and add a CSP to the Electron shell. This has value without the feature.

1.  Threat model and contracts (identity, caller kinds, storage, uninstall).
2.  Connection-ownership spike: one upstream process, stable `mcp__server__tool` names, permission prompts kept.
3.  Containment spike: custom-protocol iframe against `WebContentsView` with an ephemeral partition, with malicious fixtures.
4.  Go or no-go. Then a vertical slice with one first-party read-only app, then third-party conformance.

C. **Later:** shared actions (one Zod schema, caller-aware policy, explicit exposure), charts in the coding chat
(reuse the declarative renderer, not third-party HTML), app studio and gallery.

## Not verified by the orchestrator

Competitor statements in the product review (Goose ownership and status, Retool AI, Superblocks), the quoted
landing-page line, and all numbers in that review (price points, retention thresholds, latency figures). These are the
judgment of the reviewer.

---

# Revision 5 - design direction for the shell (2026-09-20)

Status: a proposal from the orchestrator. The user did not approve it. A specification from the `ui-ux-designer`
agent must come before any code.

## Facts from the current Electron shell

- The top bar has 8 tabs in one row: Chat, Analytics, Thoth, Tribunal, Tasks, Setup hub, Marketplace, Settings
  (`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:122-205`).
- Without a workspace folder, the shell shows only a welcome screen (`:232-233`).
- A workspace is a folder path. The view state, the sessions, the canvas and the tribunal have a partition for each
  path (`libs/frontend/core/src/lib/services/app-state.service.ts:244-262`).

## Problems

1. The 8 tabs mix three types: work (Chat, Tribunal, Tasks), monitor (Analytics), configuration (Thoth, Setup hub,
   Marketplace, Settings). A ninth tab makes the row worse.
2. The folder is a precondition. A technical operator without a repository cannot continue past the welcome screen.

## Proposal: the workspace type sets the mode

Do not copy global mode tabs. Add a type to the workspace.

|               | Code workspace                         | Space (new)                                                   |
| ------------- | -------------------------------------- | ------------------------------------------------------------- |
| Storage       | A repository folder                    | A folder that Ptah manages, for example `~/.ptah/spaces/<id>` |
| First page    | Chat, as now                           | Home: a grid of pinned apps                                   |
| Navigation    | Chat, Apps, Tasks, Tribunal, Analytics | Home, Chat, Apps, Schedules                                   |
| Agent context | Code, git, symbols                     | Connectors, files in the space, memory                        |

- A space is also a folder path, so the services that have a partition for each path operate without changes.
- The workspace sidebar lists the two types, with an icon for the type.
- A pin belongs to a workspace. Home is the grid of pins. The canvas already uses gridstack.
- Configuration (Thoth, Setup hub, Marketplace, Settings) moves out of the tab row to one global area.
- Electron only. The VS Code extension keeps one workspace and no spaces.

## UX rules (from the two reviews)

1. Text first. An app only when the user must filter, compare or monitor.
2. A card in the chat is a temporary preview. "Pin to Home" makes it persistent.
3. Sort, filter and page operate in the app and do not call the model.
4. The app sends its selection to the host, so the agent knows what the user sees.
5. Before the pin, show the source of the refresh, the schedule and the cost. Each tile shows "last update" and a stale banner.
6. Tell the user that the schedule operates only while Ptah is open.
7. Three permission levels: silent read with a log entry, staged change with a "Commit" button, destructive action
   with a confirmation in plain language.

## Steps

1. Add the Apps tab and the Home page inside the current structure.
2. Move the configuration tabs to the global area.
3. Add spaces.

## Risks

- A change to the navigation touches the coding shell. The steps above limit that.
- "Workspace" must stay one concept with a type. Do not add a second word to the interface.
- The Schedules view and the Cron tab in Thoth must use one data source.
