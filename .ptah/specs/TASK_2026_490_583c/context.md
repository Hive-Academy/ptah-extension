# Context

## User intent (2026-09-20)

An earlier conversation about CopilotKit (https://www.copilotkit.ai/angular) ended
without a decision. The user then found https://github.com/CopilotKit/openbot and saw
that it shares ideas with Ptah. The user now wants evidence to decide between:

1. **CopilotKit Angular** - only if it is a free, open-source package.
2. **AG-UI directly** - https://github.com/ag-ui-protocol/ag-ui - plus **A2UI** - https://a2ui.org/
3. **MCP Apps** - https://modelcontextprotocol.io/extensions/apps/overview

The user sees the value in the **setup wizard** and the **marketplace integration
workflow**, where Ptah already tries to build a similar guided, interactive experience.

## Product vision (user, 2026-09-20, later the same day)

The first synthesis judged the candidates against "fit into the existing coding tool". The user corrected this:

- Ptah must stand out with intuitive features, and serve **everyone who wants to build an agentic workflow**, not only
  developers.
- For coding, the chat must show **graphs, stats and other visual output** where it helps.
- Ptah must **host MCP Apps and let users author them**, with a new setup workflow, examples, and integrations similar
  to what Claude Desktop offers. Ptah already builds on the same agent SDK.
- Focus on **Electron**. The Nx workspace will migrate to the latest packages. Package peer ranges are a managed
  problem (`overrides`), not a decision criterion.

## Constraints from the repository

- Product UI is Angular 21, signals, OnPush, zoneless libs. No React in product code.
- AI and user markdown goes through `libs/frontend/markdown` only. No second sanitizer.
- The UI runs in three hosts: a VS Code webview (strict CSP), Electron, and none (CLI/TUI).
- Backend libs depend on `platform-core` ports only.
- VS Code Marketplace scanner rejects trademarked AI product names in non-JS files.
- Local-first: `~/.ptah/ptah.db`. A required hosted service is a strong negative.

## Deliverables

| File                             | Owner                                   |
| -------------------------------- | --------------------------------------- |
| `research-copilotkit-angular.md` | lane 1                                  |
| `research-ag-ui-a2ui.md`         | lane 2                                  |
| `research-mcp-apps.md`           | lane 3                                  |
| `ptah-integration-seams.md`      | in-process Explore agent                |
| `research-report.md`             | orchestrator synthesis + recommendation |
