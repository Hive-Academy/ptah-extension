# Spike code - TASK_2026_496_fc4a

Throwaway spike code. It is not product code. It is not an Nx project. Nothing
in `libs/` or `apps/` imports it. It has its own `package.json` and its own
`node_modules/` (gitignored). The root `package.json` was not changed.

## Install

    cd .ptah/specs/TASK_2026_496_fc4a/spike
    npm install

The pins agree with the root `package.json`: `@anthropic-ai/claude-agent-sdk`
0.3.278, `@modelcontextprotocol/sdk` ^1.29.0 (1.30.0 resolved), `zod` 4.6.5.

## Files

| File                   | Role                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `fake-mcp-server.mjs`  | Fake stateful upstream stdio MCP server. One process = one session. Logs every `initialize`, `close`, `tools/call` and `resources/read` as JSONL. |
| `broker.mjs`           | The single-owner broker. One `Client` + one `StdioClientTransport`, plus the `createSdkMcpServer()` re-exposure and the fail-closed collision check. |
| `run-host.mjs`         | Assertions A1, A2, A3, A5, A6a. No model turn.                                        |
| `run-model.mjs`        | Assertion A4. A real `query()` turn. Needs Claude credentials.                         |
| `run-collision.mjs`    | Assertion A6. Real `.mcp.json` with the same server name. Two real `query()` turns.   |
| `run-skills-check.mjs` | Cost of `strictMcpConfig: true` for skills, commands and plugins. Breaks at `init`.   |
| `run-dynamic.mjs`      | Probes D1 (`_meta` through the SDK server) and D2 (tool list changes). No model turn. |

## Run

    node run-host.mjs        # exits 0 when all 14 assertions pass
    node run-model.mjs
    node run-collision.mjs
    node run-skills-check.mjs
    node run-dynamic.mjs

Each script writes its upstream log to `out*/upstream.jsonl`.
