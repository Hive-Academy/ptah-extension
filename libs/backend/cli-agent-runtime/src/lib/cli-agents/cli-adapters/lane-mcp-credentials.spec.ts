import type { IMcpCallerCredentials } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  issueLaneMcpToken,
  laneMcpAuthUrl,
  LANE_MCP_TTL_MS,
} from './lane-mcp-credentials';

describe('issueLaneMcpToken', () => {
  const token = 'a'.repeat(43);
  const logger = { warn: jest.fn() } as Pick<Logger, 'warn'> as Logger;

  it('binds a four-hour privileged token to the agent and workspace', () => {
    const issue = jest.fn().mockReturnValue(token);
    const credentials = {
      issue,
      revokeSubject: jest.fn(),
    } satisfies IMcpCallerCredentials;
    expect(issueLaneMcpToken(credentials, logger, 'lane-1', '/work')).toBe(
      token,
    );
    expect(issue).toHaveBeenCalledWith(
      {
        kind: 'agent',
        agentId: 'lane-1',
        workspaceRoot: '/work',
        capability: 'privileged',
      },
      'lane-1',
      LANE_MCP_TTL_MS,
    );
  });

  it('binds a four-hour lane-report token to the agent and workspace', () => {
    const issue = jest.fn().mockReturnValue(token);
    const credentials = {
      issue,
      revokeSubject: jest.fn(),
    } satisfies IMcpCallerCredentials;
    expect(
      issueLaneMcpToken(credentials, logger, 'agy-1', '/work', 'lane-report'),
    ).toBe(token);
    expect(issue).toHaveBeenCalledWith(
      {
        kind: 'agent',
        agentId: 'agy-1',
        workspaceRoot: '/work',
        capability: 'lane-report',
      },
      'agy-1',
      LANE_MCP_TTL_MS,
    );
  });

  it('omits the server when issuance fails', () => {
    const credentials = {
      issue: jest.fn(() => {
        throw new Error('secret-bearing failure');
      }),
      revokeSubject: jest.fn(),
    } satisfies IMcpCallerCredentials;
    expect(
      issueLaneMcpToken(credentials, logger, 'lane-1', '/work'),
    ).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      '[Lane MCP] Credential issuance failed; omitting ptah MCP server',
    );
  });
});

describe('laneMcpAuthUrl', () => {
  it('puts the credential after the origin and before the agent route', () => {
    expect(
      laneMcpAuthUrl(
        'http://localhost:51820/agent/agent-7/workspace/%2Fproj',
        'lane-token',
      ),
    ).toBe(
      'http://localhost:51820/auth/lane-token/agent/agent-7/workspace/%2Fproj',
    );
  });
});
