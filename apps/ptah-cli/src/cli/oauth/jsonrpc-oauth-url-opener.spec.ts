/**
 * Unit tests for `JsonRpcOAuthUrlOpener`.
 *
 * Asserts:
 *   - happy path: response within timeout → returned verbatim
 *   - timeout: server.request never resolves → returns { opened: false }
 *   - error: server.request rejects → returns { opened: false }
 */

import { JsonRpcOAuthUrlOpener } from './jsonrpc-oauth-url-opener.js';
import type { JsonRpcServer } from '../jsonrpc/server.js';

interface MockJsonRpcServer {
  request: jest.Mock;
}

function makeMockServer(): MockJsonRpcServer {
  return { request: jest.fn() };
}

describe('JsonRpcOAuthUrlOpener', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const params = {
    provider: 'copilot',
    verificationUri: 'https://github.com/login/device',
    userCode: 'ABCD-1234',
  };

  it('happy path — resolves with the client response', async () => {
    const server = makeMockServer();
    server.request.mockReturnValue(
      new Promise((resolve) => {
        setTimeout(() => resolve({ opened: true, code: 'echoed-code' }), 100);
      }),
    );

    const opener = new JsonRpcOAuthUrlOpener(
      server as unknown as JsonRpcServer,
    );

    const promise = opener.openOAuthUrl(params);
    jest.advanceTimersByTime(100);
    const result = await promise;

    expect(server.request).toHaveBeenCalledWith('oauth.url.open', params);
    expect(result).toEqual({ opened: true, code: 'echoed-code' });
  });

  it('timeout — returns { opened: false } after 5 seconds when client never responds', async () => {
    const server = makeMockServer();
    // Never resolves
    server.request.mockReturnValue(new Promise(() => undefined));

    const opener = new JsonRpcOAuthUrlOpener(
      server as unknown as JsonRpcServer,
    );

    const promise = opener.openOAuthUrl(params);
    // Advance past the 5-second timeout.
    jest.advanceTimersByTime(5_000);
    const result = await promise;

    expect(result).toEqual({ opened: false });
  });

  it('error — returns { opened: false } when server.request rejects', async () => {
    const server = makeMockServer();
    server.request.mockRejectedValue(new Error('transport closed'));

    const opener = new JsonRpcOAuthUrlOpener(
      server as unknown as JsonRpcServer,
    );

    const result = await opener.openOAuthUrl(params);
    expect(result).toEqual({ opened: false });
  });

  it('coerces a non-boolean opened field to a boolean', async () => {
    const server = makeMockServer();
    server.request.mockResolvedValue({ opened: 1, code: undefined });
    const opener = new JsonRpcOAuthUrlOpener(
      server as unknown as JsonRpcServer,
    );
    const result = await opener.openOAuthUrl(params);
    expect(result.opened).toBe(true);
  });
});
