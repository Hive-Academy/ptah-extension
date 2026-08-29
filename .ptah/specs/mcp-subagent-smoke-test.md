# MCP and native subagent smoke test

## Verdict

The native Codex subagent mechanism works: this report was produced by the spawned `mcp_smoke_test` subagent. The Ptah MCP process is also healthy and exposes tools over JSON-RPC. The failure is session discovery/attachment, not server availability.

## Evidence

- `localhost:51820` accepts TCP connections on both IPv6 loopback (`::1`) and IPv4 loopback.
- `GET http://localhost:51820/` returns `200` with `{"status":"ok"}`.
- `GET http://localhost:51820/mcp` returns `405 Method Not Allowed`, indicating that path is RPC POST-only.
- JSON-RPC `initialize` succeeds by `POST` to both `/` and `/mcp`. The server identifies itself as `ptah` version `1.0.0` and negotiates MCP protocol `2024-11-05`.
- JSON-RPC `tools/list` succeeds by `POST` to both paths and returns a large tool catalogue, including `ptah_code_search_symbols`, `ptah_ast_analyze`, `ptah_memory_search`, task, agent, browser, harness, and workspace tools.
- Neither the parent session nor this native subagent received callable `ptah_*` tools in its session tool manifest. Consequently, the required Ptah-first symbol tools were unavailable here; localhost/config inspection was used as the explicit fallback.

## Diagnosis

`D:/projects/ptah-extension/.mcp.json` correctly declares an HTTP server at `http://localhost:51820`, and the endpoint is operational. A configured MCP server and tools exposed to an already-running Codex conversation are separate states: MCP configuration is normally discovered when the host/session initializes, and the callable tool manifest is fixed for that session. Editing or syncing `.mcp.json`, or starting the local endpoint after the session began, does not retroactively inject tools into the current conversation.

There may also be a target-config distinction: `.mcp.json` is present and understood by some harnesses, while the active Codex host may require its Codex-specific MCP configuration/cache to be reconciled. Ptah's own `ptah_harness_install_mcp_server` description explicitly says an installed server becomes available to a **new agent session**, not the current one.

## Actionable recovery

1. Keep Ptah listening on port `51820` before opening Codex.
2. Run the Ptah harness reconcile/install flow with `codex` included as a target so the Codex-specific MCP configuration/cache is populated; verify the resulting Codex configuration contains the `ptah` HTTP endpoint.
3. Fully start a new Codex conversation/session after reconciliation. If hosted inside VS Code, reload the VS Code window first so the extension and MCP registry are reconstructed.
4. In the new session, verify that the tool manifest contains names such as `ptah_code_search_symbols` and `ptah_ast_analyze`. Do not use endpoint health alone as proof of attachment.
5. If tools remain absent, inspect Codex startup/MCP logs for configuration parsing or transport registration errors. The server itself does not need repair based on this test.
