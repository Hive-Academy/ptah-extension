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
 *
 * ## The agent segment (TASK_2026_402)
 *
 * A spawned agent that wants to report back to the session that spawned it
 * must NOT name itself: an id the child supplies is an id the child can forge,
 * and `ptah_agent_report` would then be able to post into any session. So the
 * id rides the URL Ptah itself built at spawn time:
 *
 *   http://localhost:PORT/agent/{id}/workspace/{root}
 *
 * The agent segment LEADS and the workspace segment stays TERMINAL — the same
 * ordering rule `/session/{id}/workspace/{root}` already follows, so the server
 * parses one closed grammar rather than two. `/workspace/{root}/agent/{id}` is
 * rejected outright there, never half-parsed.
 *
 * Omitting `agentId` yields today's URL byte for byte; the server then treats
 * the caller as unattributed and `ptah_agent_report` refuses with that reason
 * rather than guessing.
 */
export function ptahMcpServerUrl(
  port: number,
  workingDirectory: string,
  agentId?: string,
): string {
  const base = `http://localhost:${port}`;
  const scoped =
    agentId === undefined || agentId === ''
      ? base
      : `${base}/agent/${encodeURIComponent(agentId)}`;
  if (workingDirectory === '') return scoped;
  return `${scoped}/workspace/${encodeURIComponent(workingDirectory)}`;
}

/**
 * The URL a Ptah main-chat session calls Ptah's MCP server on:
 *
 *   http://localhost:PORT/session/{routingId}/workspace/{root}
 *
 * The session segment LEADS and the workspace segment stays TERMINAL — the
 * closed grammar `vscode-lm-tools`' `http-server.handler.ts` parses (see
 * `ptahMcpServerUrl` above for the agent-segment twin). The routing id is the
 * chat tab id when one exists, else the session id — the same preference
 * Claude main chat applies in `sdk-query-options-builder.ts`.
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
