import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import { McpServerBackoffService } from './mcp-server-backoff.service';
import { SessionIdResolvedCallbackRegistry } from './session-id-resolved-callback-registry';
import { SessionMcpStatusCallbackRegistry } from './session-mcp-status-callback-registry';

const FAILURE_LINE =
  'firecrawl (CONNECT_TIMEOUT): connection timed out after 30000ms';

interface Harness {
  service: McpServerBackoffService;
  mcpStatus: SessionMcpStatusCallbackRegistry;
  sessionIdResolved: SessionIdResolvedCallbackRegistry;
}

function makeHarness(): Harness {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const mcpStatus = new SessionMcpStatusCallbackRegistry(logger);
  const sessionIdResolved = new SessionIdResolvedCallbackRegistry(logger);
  const service = new McpServerBackoffService(
    logger,
    mcpStatus,
    undefined,
    sessionIdResolved,
  );
  return { service, mcpStatus, sessionIdResolved };
}

describe('McpServerBackoffService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('counts stderr and SDK init reports for the same attempt only once, even more than 10 seconds apart', () => {
    const { service, mcpStatus, sessionIdResolved } = makeHarness();
    const abortController = new AbortController();
    service.trackStderrSession('tab-1', abortController.signal);

    service.checkStderrForFailure(FAILURE_LINE, Date.now(), 'tab-1');
    jest.advanceTimersByTime(15_000);
    mcpStatus.notifyAll({
      kind: 'servers',
      sessionId: 'sdk-session-1',
      servers: [{ name: 'firecrawl', status: 'failed' }],
    });
    sessionIdResolved.notifyAll({
      tabId: 'tab-1',
      realSessionId: 'sdk-session-1',
      timestamp: Date.now(),
    });

    expect(service.getRecord('firecrawl')).toMatchObject({
      failureCount: 1,
      lastAttemptKey: 'tab-1',
    });
  });

  it('counts genuinely distinct keyed attempts inside 10 seconds twice', () => {
    const { service } = makeHarness();
    service.trackStderrSession('tab-1', new AbortController().signal);
    service.trackStderrSession('tab-2', new AbortController().signal);

    service.checkStderrForFailure(FAILURE_LINE, Date.now(), 'tab-1');
    jest.advanceTimersByTime(3_000);
    service.checkStderrForFailure(FAILURE_LINE, Date.now(), 'tab-2');

    expect(service.getRecord('firecrawl')).toMatchObject({
      failureCount: 2,
      lastAttemptKey: 'tab-2',
    });
  });

  it('detects a notice split across chunks exactly once and consumes the matched tail', () => {
    const { service } = makeHarness();
    service.trackStderrSession('tab-1', new AbortController().signal);

    expect(
      service.checkStderrForFailure(
        'earlier line\nfirecrawl (CONNECT_',
        Date.now(),
        'tab-1',
      ),
    ).toBeNull();
    expect(
      service.checkStderrForFailure(
        'TIMEOUT): connection timed out',
        Date.now(),
        'tab-1',
      ),
    ).toBe('firecrawl');
    expect(
      service.checkStderrForFailure(' after 30000ms\n', Date.now(), 'tab-1'),
    ).toBeNull();

    expect(service.getRecord('firecrawl')?.failureCount).toBe(1);
  });

  it('keeps interleaved stderr chunks isolated by session', () => {
    const { service } = makeHarness();
    service.trackStderrSession('tab-a', new AbortController().signal);
    service.trackStderrSession('tab-b', new AbortController().signal);

    service.checkStderrForFailure('alpha (CONNECT_', Date.now(), 'tab-a');
    service.checkStderrForFailure('beta (CONNECT_', Date.now(), 'tab-b');
    expect(
      service.checkStderrForFailure('TIMEOUT): failed', Date.now(), 'tab-a'),
    ).toBe('alpha');
    expect(
      service.checkStderrForFailure('TIMEOUT): failed', Date.now(), 'tab-b'),
    ).toBe('beta');

    expect(service.getRecord('alpha')?.failureCount).toBe(1);
    expect(service.getRecord('beta')?.failureCount).toBe(1);
  });

  it('releases a session buffer when its lifecycle aborts', () => {
    const { service, mcpStatus, sessionIdResolved } = makeHarness();
    const first = new AbortController();
    service.trackStderrSession('tab-1', first.signal);
    service.checkStderrForFailure(
      'firecrawl (CONNECT_',
      Date.now(),
      'tab-1',
    );
    first.abort();
    mcpStatus.notifyAll({
      kind: 'servers',
      sessionId: 'late-sdk-session',
      servers: [{ name: 'late-server', status: 'failed' }],
    });
    sessionIdResolved.notifyAll({
      tabId: 'tab-1',
      realSessionId: 'late-sdk-session',
      timestamp: Date.now(),
    });

    service.trackStderrSession('tab-1', new AbortController().signal);
    expect(
      service.checkStderrForFailure('TIMEOUT): failed', Date.now(), 'tab-1'),
    ).toBeNull();
    expect(service.getRecord('firecrawl')).toBeUndefined();
    expect(service.getRecord('late-server')).toBeUndefined();
  });
});
