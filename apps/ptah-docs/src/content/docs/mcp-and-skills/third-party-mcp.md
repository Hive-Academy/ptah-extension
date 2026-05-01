---
title: Third-party MCP Servers
description: Connect external MCP servers to Ptah via configuration.
---

Beyond the [built-in MCP server](/mcp-and-skills/built-in-mcp-server/), Ptah can connect to any MCP-compliant server — filesystems, databases, SaaS APIs, internal tools. Once connected, the server's tools become first-class citizens alongside `ptah_*`.

## Configuration

Third-party MCP servers are declared in your harness settings. The fastest path is the `update-config` skill, but you can edit the file directly:

```json title="~/.ptah/settings.json"
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_URL": "postgres://localhost:5432/mydb"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${env:GITHUB_PAT}"
      }
    },
    "my-http-server": {
      "url": "https://mcp.example.com/v1",
      "headers": {
        "Authorization": "Bearer ${env:MY_SERVICE_TOKEN}"
      }
    }
  }
}
```

### Supported transports

| Transport      | Config shape                   | Use case                                            |
| -------------- | ------------------------------ | --------------------------------------------------- |
| **stdio**      | `{ "command", "args", "env" }` | Most community servers — spawned as child processes |
| **HTTP / SSE** | `{ "url", "headers" }`         | Hosted MCP services                                 |

### Environment variable expansion

Use `${env:NAME}` to reference shell environment variables. This keeps secrets out of the settings file.

## Listing what's connected

From any chat, call:

```text
harness_list_installed_mcp
```

Ptah returns the full connected-servers list with their tool catalogs, transport, and status. Use this to verify a new server was picked up.

The **Settings → MCP** panel exposes the same information in a UI, plus per-server logs and a **Reconnect** button.

## Discovering new servers

Ptah ships a registry-aware search:

```text
ptah_harness_search_mcp_registry with:
{ "query": "postgres" }
```

It queries the public MCP registry and returns candidate servers with installation snippets you can paste into your settings.

## Permissions

Every tool surfaced by a third-party server is subject to the same permission model as `ptah_*` tools:

```json
{
  "permissions": {
    "allow": ["mcp__postgres__query"],
    "ask": ["mcp__github__create_issue"],
    "deny": ["mcp__postgres__exec"]
  }
}
```

Tool IDs follow the pattern `mcp__<server-name>__<tool-name>`.

:::caution
Third-party servers run with your user privileges. Vet what they do before granting broad permissions — especially for anything that writes to a database, calls a paid API, or modifies remote infrastructure.
:::

## Troubleshooting

| Symptom                                          | Likely cause              | Fix                                            |
| ------------------------------------------------ | ------------------------- | ---------------------------------------------- |
| Server missing from `harness_list_installed_mcp` | Config parse error        | Check JSON syntax; logs in `~/.ptah/logs/mcp/` |
| Server connects but tools are empty              | Server binary out of date | Update or pin version in `args`                |
| Repeated permission prompts                      | Tool not in `allow` list  | Use the `fewer-permission-prompts` skill       |
| stdio server crashes immediately                 | Missing env var           | Verify `${env:NAME}` resolves                  |

## Next steps

- [Built-in MCP server](/mcp-and-skills/built-in-mcp-server/)
- [Ptah tool catalog](/mcp-and-skills/ptah-tools/)
