# TASK_2026_595_1c01 — context

Filed 2026-10-03 at the user's request. Goal: coding sessions must not pay context for the
Apps page tools. Blocks TASK_2026_594_31ff (new catalog kinds), because each new kind makes
the tool schema larger.

## Current state

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:409-425`
  lists `ptah_dashboard_propose_spec`, `ptah_surface_update` and `ptah_surface_get_state` as
  always-on, with no namespace toggle (decisions from TASK_2026_493 and TASK_2026_538).
- Every session that attaches the Ptah MCP server sees them: the main coding chat (Claude Agent
  SDK, `agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:587`), CLI agent lanes
  (`cli-agent-runtime/.../ptah-mcp-url.ts:46-58`) and the CLI.
- `surface-tools.ts` is about 3k tokens of source. The flattened schema sent to the model is not measured yet.
- `system-namespace.builders.ts` also names `ptah_surface_update` in the `execute_code` help text.
- The Apps page starts its own chat with `APPS_SYSTEM_PROMPT`
  (`libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:248`).

## Decision (user, 2026-10-03)

The dashboard and surface tools belong to the Apps page only. Other coding agents do not get them.
This reverses the "always-on" decision of TASK_2026_493/538. Consequence: a headless or coding
caller loses the plain-text dashboard fallback. That is accepted.

## Proposed approach (architect confirms)

1. An MCP tool profile: the Ptah MCP URL gets a profile segment (for example `/profile/apps`),
   next to the existing `/agent/{id}` and `/workspace/{cwd}` segments. No segment = `coding` profile.
2. `tools/list` for `coding` omits the three tools. `tools/call` for them returns a clear
   "available on the Apps page only" error.
3. The Apps session (`apps-session.service.ts` → `chat:start`) requests the `apps` profile. In that
   profile the tools load eagerly, because they are the core of the page.
4. The `execute_code` help text names the surface tools only in the `apps` profile.
5. The UI-authoring prompt detail moves out of the always-loaded text into the
   `ptah-surface-authoring` skill (TASK_2026_594), which loads on demand.

## Why not tool-search deferral for these tools

Deferral hides a tool until the model searches for it. `codex-cli.adapter.ts:623-632` records that
deferred Ptah tools made Codex do the whole task without them. On the Apps page the surface tools
are the main tools, so deferral would hurt there. In coding sessions, removal is cheaper than
deferral. A general deferral of rarely used `ptah_*` tools is a separate, later decision.

## Acceptance

- Measured `tools/list` token count for `coding` and `apps`, before and after, in this folder.
- A coding chat, a CLI agent lane and the CLI do not list the three tools.
- The Apps page chat lists them and can still create, patch and read a surface.
- Specs pin both profiles in `protocol-dispatcher` and the URL builders.
- `nx test` passes for `vscode-lm-tools`, `agent-sdk`, `cli-agent-runtime` and `mcp-apps-page`.
