/**
 * Codex facts for attaching Ptah's own MCP server: the per-call tool timeout
 * and the main-chat session URL.
 *
 * The session URL's grammar is closed and shared with two twins. The
 * agent-segment twin is `ptahMcpServerUrl` in
 * `cli-agent-runtime/.../cli-adapters/ptah-mcp-url.ts`. The file-writer twin
 * — persistent entries in `.mcp.json` and the rival CLIs' config files — is
 * `ptahMcpUrl` in `vscode-lm-tools/.../mcp-http/ptah-mcp-slots.ts`. All three
 * keep the workspace segment terminal and encode it with `encodeURIComponent`
 * (never hand-rolled escaping), and each names the others so a change to the
 * grammar finds all three. The parser is `vscode-lm-tools`'
 * `http-server.handler.ts`.
 */

/**
 * Per-call timeout for Ptah's MCP tools, in seconds. Long enough for a
 * blocking wait on another lane (R9.2).
 */
export const CODEX_PTAH_TOOL_TIMEOUT_SEC = 960;

/**
 * The URL a Ptah main-chat session calls Ptah's MCP server on:
 *
 *   http://localhost:PORT/session/{routingId}/workspace/{root}
 *
 * The session segment LEADS and the workspace segment stays TERMINAL — the
 * closed grammar `vscode-lm-tools`' `http-server.handler.ts` parses (see
 * `ptahMcpServerUrl` in `cli-agent-runtime/.../cli-adapters/ptah-mcp-url.ts`
 * for the agent-segment twin, and `ptahMcpUrl` in
 * `vscode-lm-tools/.../mcp-http/ptah-mcp-slots.ts` for the file-writer twin).
 * The routing id is the chat tab id when one exists, else the session id —
 * the same preference Claude main chat applies in
 * `sdk-query-options-builder.ts`.
 *
 * A main-chat caller without a routing id is refused rather than sent the
 * bare URL: the server could not route approvals or reports back to the
 * session, so the caller must fail visibly instead of attaching anonymously.
 * An empty working directory omits the workspace segment.
 */
export function ptahMcpSessionUrl(
  port: number,
  routingId: string,
  workingDirectory: string,
): string {
  if (routingId.trim() === '') {
    throw new Error(
      'Ptah MCP session URL requires a routing id (tab id or session id); none was provided.',
    );
  }
  const scoped = `http://localhost:${port}/session/${encodeURIComponent(routingId)}`;
  if (workingDirectory === '') return scoped;
  return `${scoped}/workspace/${encodeURIComponent(workingDirectory)}`;
}
