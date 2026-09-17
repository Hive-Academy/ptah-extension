/**
 * The network-class classifier — TASK_2026_437 C14 (f).
 *
 * Two surfaces, both pinned: a thrown error's `cause` chain, and the SDK
 * stream of one query. The incident shape (`Ptah Electron-2026-09-14.log`)
 * is replayed as a stream: connection-error retries, then the subprocess's
 * closing `server_error` message and an `is_error` result with status 500.
 */
import {
  classifyThrownNetworkFailure,
  networkSignalForHttpStatus,
  QueryNetworkObserver,
  type NetworkObservableMessage,
} from './network-failure';

function withCode(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

function withStatus(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function verdictOf(messages: readonly NetworkObservableMessage[]) {
  const observer = new QueryNetworkObserver();
  for (const msg of messages) observer.observe(msg);
  return observer.verdict();
}

const retry = (
  error_status: number | null,
  error = 'unknown',
): NetworkObservableMessage => ({
  type: 'system',
  subtype: 'api_retry',
  error_status,
  error,
});

describe('networkSignalForHttpStatus', () => {
  it.each([
    [500, 'http-5xx'],
    [502, 'http-5xx'],
    [503, 'http-5xx'],
    [599, 'http-5xx'],
    [429, 'http-429'],
    [408, 'timeout'],
  ])('classifies %s as %s', (status, signal) => {
    expect(networkSignalForHttpStatus(status)).toBe(signal);
  });

  it.each([400, 401, 403, 404, 413, 422, 200, 600])(
    'does not classify %s',
    (status) => {
      expect(networkSignalForHttpStatus(status)).toBeNull();
    },
  );

  it('ignores a non-number', () => {
    expect(networkSignalForHttpStatus('500')).toBeNull();
    expect(networkSignalForHttpStatus(null)).toBeNull();
  });
});

describe('classifyThrownNetworkFailure', () => {
  it.each([
    ['ECONNREFUSED', 'connection'],
    ['ECONNRESET', 'connection'],
    ['EHOSTUNREACH', 'connection'],
    ['ENOTFOUND', 'dns'],
    ['EAI_AGAIN', 'dns'],
    ['ETIMEDOUT', 'timeout'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
  ])('classifies a thrown %s as %s', (code, signal) => {
    expect(classifyThrownNetworkFailure(withCode(code))).toBe(signal);
  });

  it('finds the socket code down the cause chain, as the curator adapter wraps it', () => {
    const wrapped = new Error(
      'The memory curator could not complete its query.',
      {
        cause: new Error('fetch failed', {
          cause: withCode('ENOTFOUND', 'getaddrinfo ENOTFOUND chatgpt.com'),
        }),
      },
    );
    expect(classifyThrownNetworkFailure(wrapped)).toBe('dns');
  });

  it('classifies a 5xx or 429 status carried on the error', () => {
    expect(classifyThrownNetworkFailure(withStatus(503))).toBe('http-5xx');
    expect(
      classifyThrownNetworkFailure(
        Object.assign(new Error('slow down'), { statusCode: 429 }),
      ),
    ).toBe('http-429');
  });

  it('does NOT classify auth, validation, parse or abort failures', () => {
    expect(classifyThrownNetworkFailure(withStatus(401))).toBeNull();
    expect(classifyThrownNetworkFailure(withStatus(400))).toBeNull();
    expect(
      classifyThrownNetworkFailure(new Error('404 model not found')),
    ).toBeNull();
    expect(
      classifyThrownNetworkFailure(new SyntaxError('Unexpected token')),
    ).toBeNull();
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyThrownNetworkFailure(abort)).toBeNull();
  });

  it('ignores non-errors and stops on a cyclic cause chain', () => {
    expect(classifyThrownNetworkFailure('ECONNREFUSED')).toBeNull();
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(classifyThrownNetworkFailure(a)).toBeNull();
  });
});

describe('QueryNetworkObserver', () => {
  it('reads the 2026-09-14 incident shape as a network failure', () => {
    expect(
      verdictOf([
        retry(500, 'server_error'),
        retry(500, 'server_error'),
        {
          type: 'assistant',
          error: 'server_error',
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: true,
          api_error_status: 500,
        },
      ]),
    ).toEqual({ kind: 'network-failure', signal: 'http-5xx' });
  });

  it('reads connection-error retries followed by an "unknown" error message as a connection failure', () => {
    expect(
      verdictOf([
        retry(null),
        retry(null),
        { type: 'assistant', error: 'unknown' },
        { type: 'result', subtype: 'success', is_error: true },
      ]),
    ).toEqual({ kind: 'network-failure', signal: 'connection' });
  });

  it('reads a rate-limit ending as http-429', () => {
    expect(
      verdictOf([
        { type: 'assistant', error: 'rate_limit' },
        { type: 'result', is_error: true, api_error_status: 429 },
      ]),
    ).toEqual({ kind: 'network-failure', signal: 'http-429' });
  });

  it('reads a stream that died mid-retry, before any result, as a network failure', () => {
    expect(verdictOf([retry(null)])).toEqual({
      kind: 'network-failure',
      signal: 'connection',
    });
  });

  it('reads a retry that finally succeeded as answered', () => {
    expect(
      verdictOf([
        retry(503, 'server_error'),
        { type: 'assistant' },
        { type: 'result', subtype: 'success', is_error: false },
      ]),
    ).toEqual({ kind: 'answered' });
  });

  it('reads a plain successful run as answered', () => {
    expect(verdictOf([{ type: 'assistant' }, { type: 'result' }])).toEqual({
      kind: 'answered',
    });
  });

  it('lets a non-network result status overrule earlier network retries', () => {
    expect(
      verdictOf([
        retry(529, 'server_error'),
        { type: 'assistant', error: 'authentication_failed' },
        { type: 'result', is_error: true, api_error_status: 401 },
      ]),
    ).toEqual({ kind: 'undetermined' });
  });

  it('does not classify an auth or validation error message', () => {
    expect(
      verdictOf([
        { type: 'assistant', error: 'authentication_failed' },
        { type: 'result', is_error: true },
      ]),
    ).toEqual({ kind: 'undetermined' });
    expect(
      verdictOf([
        retry(null),
        { type: 'assistant', error: 'invalid_request' },
        { type: 'result', is_error: true },
      ]),
    ).toEqual({ kind: 'undetermined' });
  });

  it('does not treat an "unknown" error with no network retries behind it as network-class', () => {
    expect(
      verdictOf([
        { type: 'assistant', error: 'unknown' },
        { type: 'result', is_error: true },
      ]),
    ).toEqual({ kind: 'undetermined' });
  });

  it('reads an empty stream as undetermined', () => {
    expect(verdictOf([])).toEqual({ kind: 'undetermined' });
  });
});
