# @ptah-extension/vscode-lm-tools

Shared infrastructure kept under its historical name; it is not a VS Code host. It provides the
Ptah code-execution MCP server (`CodeExecutionMCP`, HTTP and stdio transports under
`src/lib/code-execution/`), the `PtahAPIBuilder` that builds the `ptah.*` namespaces, and the
diagnostics cache invalidator. DI registration is `registerVsCodeLmToolsServices`. Consumed by the
Electron app, `rpc-handlers`, `cli-engine` and `gateway-chat-bridge`.

```bash
npm run verify -- -p vscode-lm-tools
```
