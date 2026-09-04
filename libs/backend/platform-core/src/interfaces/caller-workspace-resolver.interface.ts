/**
 * ICallerWorkspaceResolver — the workspace root of the MCP tool call that is
 * currently in flight.
 *
 * Exists so `cli-agent-runtime`'s `AgentProcessManager` can scope spawns and
 * status reads to the CALLING workspace without importing `vscode-lm-tools`,
 * where the request-scoped MCP context lives. The dependency direction runs
 * `vscode-lm-tools` → `cli-agent-runtime`; inverting it is a module-boundary
 * error, so the contract lives here and the implementation
 * (`McpCallerWorkspaceResolver`) stays in `vscode-lm-tools` (TASK_2026_364).
 *
 * Registration is OPTIONAL and per host: only hosts that run the in-process
 * HTTP MCP server (VS Code, Electron) register an implementation. Where none
 * is registered — the CLI host, unit tests — consumers MUST fall back to the
 * platform workspace provider exactly as they behaved before this port.
 */
export interface ICallerWorkspaceResolver {
  /**
   * The workspace root of the in-flight MCP tool call, or `undefined` when the
   * call is anonymous or no MCP request is in flight (webview RPC, the
   * stdio/CLI path, internal calls).
   *
   * Resolution, most specific first: the workspace root the caller DECLARED in
   * its request URL (`/workspace/{root}` — an external CLI's only identity),
   * then the workspace of the caller's own Ptah session (`/session/{id}`).
   *
   * @throws Error when the caller declared a workspace that is not open on
   * this host. A stale or mistargeted URL must be refused by name — degrading
   * to another workspace's root is the silent misattribution this port exists
   * to close.
   * @throws Error when an MCP call named NO workspace and NO caller session
   * and more than one folder is open. The two refusals are symmetric: the
   * first is a caller that asked for the wrong workspace, the second a caller
   * that asked for none while several were possible. With zero or one folder
   * open there is no ambiguity and this returns `undefined` as before.
   */
  resolveCallerWorkspaceRoot(): string | undefined;
}
