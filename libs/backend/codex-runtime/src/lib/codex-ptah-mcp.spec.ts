/**
 * Pins the Codex Ptah MCP timeout and the main-chat session URL.
 *
 * The session grammar must stay in step with the parser in `vscode-lm-tools`'
 * `http-server.handler.ts`, the agent-segment twin `ptahMcpServerUrl` in
 * `cli-agent-runtime/.../ptah-mcp-url.ts`, and the file-writer twin
 * `ptahMcpUrl` in `vscode-lm-tools/.../ptah-mcp-slots.ts`. It must also never
 * produce a URL containing a literal `/sse`, because `harness-sync`'s
 * `inferTransportType` classifies such a URL as `sse` on read-back.
 */

import {
  CODEX_PTAH_TOOL_TIMEOUT_SEC,
  ptahMcpSessionUrl,
} from './codex-ptah-mcp';

describe('CODEX_PTAH_TOOL_TIMEOUT_SEC', () => {
  it('ships the S1a value', () => {
    expect(CODEX_PTAH_TOOL_TIMEOUT_SEC).toBe(960);
  });
});

describe('ptahMcpSessionUrl', () => {
  it('leads with /session/{id} and keeps an encoded Windows root terminal', () => {
    expect(
      ptahMcpSessionUrl(51820, 'tab-1', 'D:\\projects\\ptah-extension'),
    ).toBe(
      'http://localhost:51820/session/tab-1/workspace/D%3A%5Cprojects%5Cptah-extension',
    );
  });

  it('percent-encodes the routing id', () => {
    expect(ptahMcpSessionUrl(51820, 'a/b?c', '/tmp/ws-a')).toBe(
      'http://localhost:51820/session/a%2Fb%3Fc/workspace/%2Ftmp%2Fws-a',
    );
  });

  it('omits the workspace segment for an empty working directory', () => {
    expect(ptahMcpSessionUrl(51820, 'tab-1', '')).toBe(
      'http://localhost:51820/session/tab-1',
    );
  });

  it.each(['', '   '])('refuses a missing routing id (%j)', (routingId) => {
    expect(() => ptahMcpSessionUrl(51820, routingId, '/tmp/ws-a')).toThrow(
      /routing id/,
    );
  });
});
