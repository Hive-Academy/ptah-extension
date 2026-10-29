/**
 * The workspace-scoped MCP URL every spawn hands its CLI (TASK_2026_364).
 *
 * The grammar must stay in step with two other pieces of code: the parser in
 * `vscode-lm-tools`' `http-server.handler.ts`, and the file-writer twin
 * `ptahMcpUrl` in `vscode-lm-tools/.../ptah-mcp-slots.ts`. It must also never
 * produce a URL containing a literal `/sse`, because `harness-sync`'s
 * `inferTransportType` classifies such a URL as `sse` on read-back and a
 * written `http` entry would then be rewritten on every reconcile pass.
 */

import { ptahMcpServerUrl } from './ptah-mcp-url';

describe('ptahMcpServerUrl', () => {
  it('appends /workspace/{encoded} to the base URL', () => {
    expect(ptahMcpServerUrl(51820, '/tmp/ws-a')).toBe(
      'http://localhost:51820/workspace/%2Ftmp%2Fws-a',
    );
  });

  it('percent-encodes a Windows root, colon and backslashes included', () => {
    expect(ptahMcpServerUrl(51820, 'D:\\projects\\ptah-extension')).toBe(
      'http://localhost:51820/workspace/D%3A%5Cprojects%5Cptah-extension',
    );
  });

  it('keeps the bare URL for an empty working directory', () => {
    // The pre-existing "anonymous caller" shape; the server still accepts it.
    expect(ptahMcpServerUrl(51820, '')).toBe('http://localhost:51820');
  });

  it('leads with /agent/{id} and keeps /workspace/{root} terminal', () => {
    // The ordering rule is load-bearing: the server's grammar only accepts the
    // agent (or session) segment FIRST, with the workspace segment last.
    expect(ptahMcpServerUrl(51820, '/tmp/ws-a', 'agent-123')).toBe(
      'http://localhost:51820/agent/agent-123/workspace/%2Ftmp%2Fws-a',
    );
  });

  it('percent-encodes the agent id', () => {
    expect(ptahMcpServerUrl(51820, '/tmp/ws-a', 'a/b?c')).toBe(
      'http://localhost:51820/agent/a%2Fb%3Fc/workspace/%2Ftmp%2Fws-a',
    );
  });

  it('emits the agent segment alone when there is no working directory', () => {
    expect(ptahMcpServerUrl(51820, '', 'agent-123')).toBe(
      'http://localhost:51820/agent/agent-123',
    );
  });

  it('yields the pre-existing URL byte for byte when no agent id is given', () => {
    // The failure behaviour Component 6 fixes: an absent id must not change
    // the URL at all, so an unattributed caller looks exactly as it did.
    expect(ptahMcpServerUrl(51820, '/tmp/ws-a', undefined)).toBe(
      ptahMcpServerUrl(51820, '/tmp/ws-a'),
    );
    expect(ptahMcpServerUrl(51820, '/tmp/ws-a', '')).toBe(
      ptahMcpServerUrl(51820, '/tmp/ws-a'),
    );
  });

  it('cannot leak a literal /sse out of a path segment', () => {
    // `/foo/sse/bar` would read back as transport `sse` if the slashes
    // survived. Encoding turns them into %2F, so the transport inference
    // (`sse` only when the URL contains `/sse`) still answers `http`.
    const url = ptahMcpServerUrl(51820, '/projects/sse/tools');

    expect(url).toBe(
      'http://localhost:51820/workspace/%2Fprojects%2Fsse%2Ftools',
    );
    expect(url).not.toContain('/sse');
  });
});
