# Landscape - similar ideas (2026-09-20)

Orchestrator research. "Checked" = read from the repository or npm by the orchestrator. "Article" = one secondary
source, not confirmed.

## agent-native (BuilderIO/agent-native)

Source: https://github.com/BuilderIO/agent-native

Checked: `@agent-native/core` 0.182.1, MIT in `package.json` (GitHub reports no repository-level license). 5,097 stars,
created 2026-03-12, pushed 2026-09-20. React, Nitro, Drizzle, PostgreSQL or PGlite. Desktop shell is Electron 43. Uses
`@anthropic-ai/sdk` (not the agent SDK), MCP SDK 2 packages and `@modelcontextprotocol/ext-apps`. Templates:
analytics, assets, brain, calendar, chat, clips, content, crm, design, dispatch, factory, forms, mail, plan, slides,
tasks, videos.

Principles (README):

1. Shared actions. "Define each capability once as an action: the agent uses it as a tool, and the UI calls it from code."
2. Shared data. Agent work shows in the UI and the reverse.
3. Shared application state. The agent receives the current page, the selected record, the active view.
4. "The agent does not click through the UI. It works through the same action layer as the UI."

Actions are exposed through HTTP, MCP, A2A and the CLI.

Fit: the code is React, so Ptah cannot adopt it. The principles transfer. Ptah today has two implementations of many
capabilities: an RPC handler for the UI and an MCP tool for the agent (example: harness RPC handlers and
`ptah_harness_*` tools). The new page can start with one action definition that registers both.

## Other products and frameworks

| Item                          | What it is                                                                                                                                                                                           | Source                                | Relevance                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Claude Cowork, Live Artifacts | Persistent HTML dashboards in a sidebar, refreshed from MCP connectors. Article lists limits: local to one machine, small model only for in-artifact actions, no skills from artifacts, no sharing   | https://www.taskade.com/blog/genesis-vs-live-artifacts (vendor article by a competitor, not confirmed) | Closest to "pinned apps". The listed limits are openings, if true           |
| Taskade Genesis               | Deployed multi-user React apps, gallery with one-click clone, 100+ integrations                                                                                                                      | https://www.taskade.com/blog/genesis-vs-live-artifacts (vendor article by a competitor, not confirmed) | Gallery and clone is the distribution model                                 |
| Builder.io                    | Host for MCP Apps. States limits: app does not control its container, model sees only what the app emits, UI-started tool calls feel slow, do not force UI where text is better                      | https://www.builder.io/blog/mcp-apps | Design constraints for the Ptah host                                        |
| json-render (Vercel Labs)     | Catalog + registry, model emits JSON spec, host renders. Apache-2.0, `@json-render/core` 0.21.0. `@json-render/mcp` renders specs inside MCP Apps hosts. No Angular renderer in the npm package list | Checked: https://github.com/vercel-labs/json-render and npm `@json-render/core` 0.21.0, `@json-render/mcp` | Pattern: one generic renderer app + JSON specs. The agent never writes HTML |
| hashbrown                     | `@hashbrownai/angular` 0.5.0, MIT, peers Angular 20 and 21. Angular-native generative UI                                                                                                             | Checked: npm `@hashbrownai/angular` 0.5.0. Internals not examined | Alternative to A2UI for declarative UI in Angular                           |
| Goose                         | Open-source desktop agent, MCP Apps host                                                                                                                                                             | https://modelcontextprotocol.io/extensions/client-matrix (listed as an MCP Apps host. Not examined further) | Closest open-source host competitor. Not examined                           |
| n8n, Gumloop, Copilot Studio  | Node-graph or form workflow builders for non-developers                                                                                                                                              | https://www.gumloop.com/blog/agentic-ai-tools (search result only, not examined) | The incumbent shape for "everyone builds workflows"                         |

The recommendation in `research-report.md` depends only on the rows marked Checked. The other rows are context.

## Taxonomy (Brian Love, blove.dev, 2026-02-20)

Source: https://blove.dev/posts/2026-02-20-the-landscape-of-generative-ui-in-2026/

Chat components (most control) -> component systems (schema-driven) -> embedded generative UI (most freedom).
"Choose per surface, not per company." Recommended progression: start constrained, expand with structure, embed
selectively. Note: the Ptah plan starts with the embedded kind. The separate page limits that risk.

## Inference, not a verified market gap

No item found combines all of: local-first desktop, any model provider, MCP Apps host, app authoring by the agent,
pinned apps refreshed by a scheduler, and delivery through messaging gateways. Ptah already has the scheduler
(`cron-scheduler`), the gateways (`messaging-gateway`) and multi-provider support.
