---
title: Built-in MCP Server
description: Ptah's local MCP server, Code Execution, and dynamic port management.
---

Ptah runs a **local MCP server** inside the desktop app. It is the bridge that exposes the `ptah_*` tool family to any connected model — and it's how **Code Execution** (the secure sandboxed runtime) is made available to providers that support MCP.

## What it does

- Serves the entire `ptah_*` tool catalog — workspace analysis, diagnostics, browser automation, git worktrees, agent spawning, etc.
- Hosts the **Code Execution** sandbox (Pro tier) for safe code execution with file and network access.
- Advertises itself over HTTP/SSE on a local loopback port so models can discover it.

:::caution[Pro tier]
**Code Execution** is gated behind the Pro subscription. The `ptah_*` catalog itself is available on every tier; only the sandboxed execution runtime requires Pro.
:::

## Dynamic port assignment

The MCP server binds to `127.0.0.1` on a port selected at startup.

| Behavior          | Details                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Default port**  | `51820`                                                                                        |
| **Auto-fallback** | If `51820` is taken, Ptah probes the next free port above it                                   |
| **Scope**         | Loopback only — the port is never exposed on your LAN                                          |
| **Discovery**     | The chosen port is written to `~/.ptah/runtime.json` and shown in the **Settings → MCP** panel |

You can pin a specific port in settings if you want deterministic behavior:

```json title="~/.ptah/settings.json"
{
  "mcp.builtIn.port": 51820,
  "mcp.builtIn.portFallback": true
}
```

## How providers consume it

Providers that speak MCP natively (Claude Agent SDK, and the Ptah harness for other CLIs) receive the server URL automatically at session start. You don't need to wire anything up — just enable the tool in the chat panel's tool picker.

For providers that don't yet speak MCP, Ptah proxies a curated subset of tools through their native tool-calling mechanism.

## Health and diagnostics

The **Settings → MCP** panel shows:

- Current listening port
- Uptime and request count
- Per-tool invocation metrics
- Recent errors

Command palette shortcuts:

| Command                             | Effect                              |
| ----------------------------------- | ----------------------------------- |
| `Ptah: Restart Built-in MCP Server` | Full restart (rebinds port)         |
| `Ptah: Show MCP Server Logs`        | Opens the live log panel            |
| `Ptah: Copy MCP Server URL`         | Useful for external MCP-aware tools |

## Security model

- **Loopback only** — never accessible off-host.
- **Per-tool approval** — every tool call respects the permission model configured in `~/.ptah/settings.json` (`allow`, `ask`, `deny`).
- **Auditable** — all invocations are logged to `~/.ptah/logs/mcp/`.
- **Sandboxed Code Execution** — code runs in an isolated process with scoped file access.

## Next steps

- [Browse the Ptah tool catalog](/mcp-and-skills/ptah-tools/)
- [Connect third-party MCP servers](/mcp-and-skills/third-party-mcp/)
