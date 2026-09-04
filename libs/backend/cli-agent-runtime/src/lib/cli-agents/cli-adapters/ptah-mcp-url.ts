/**
 * The URL a spawned CLI calls Ptah's MCP server on (TASK_2026_364).
 *
 * A bare `http://localhost:PORT` cannot say which workspace the caller belongs
 * to, so with two workspaces open the server answered for whichever folder was
 * most recently activated. Every spawn already knows the working directory it
 * spawns into, so it declares it in the URL:
 *
 *   http://localhost:PORT/workspace/{encodeURIComponent(workingDirectory)}
 *
 * The segment is the same mechanism as the `/session/{id}` segment Ptah's own
 * SDK sessions send, and is parsed beside it in `vscode-lm-tools`'
 * `http-server.handler.ts`. The file-writer twin — for the persistent entries
 * in `.mcp.json` and the rival CLIs' config files — is `ptahMcpUrl` in
 * `vscode-lm-tools/.../mcp-http/ptah-mcp-slots.ts`. The two must produce the
 * same grammar; each names the other so a change to one finds both.
 *
 * `encodeURIComponent`, never hand-rolled escaping: a Windows root carries a
 * colon and backslashes, and the encoding turns every `/` in the directory
 * into `%2F` — load-bearing for `harness-sync`'s `inferTransportType`, which
 * classifies a URL containing a literal `/sse` as `sse` on read-back. A scoped
 * URL can therefore never make a written `http` entry read back differently.
 *
 * An empty working directory yields the bare URL: there is no folder to
 * declare, and a bare URL is the pre-existing "anonymous caller" shape the
 * server still accepts.
 */
export function ptahMcpServerUrl(
  port: number,
  workingDirectory: string,
): string {
  const base = `http://localhost:${port}`;
  if (workingDirectory === '') return base;
  return `${base}/workspace/${encodeURIComponent(workingDirectory)}`;
}
