import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  McpServerBackoffService,
  type McpServerBackoffOptions,
} from './mcp-server-backoff.service';
import { SessionIdResolvedCallbackRegistry } from './session-id-resolved-callback-registry';
import { SessionMcpStatusCallbackRegistry } from './session-mcp-status-callback-registry';

const FAILURE_LINE =
  'firecrawl (CONNECT_TIMEOUT): connection timed out after 30000ms';

interface Harness {
  service: McpServerBackoffService;
  mcpStatus: SessionMcpStatusCallbackRegistry;
  sessionIdResolved: SessionIdResolvedCallbackRegistry;
}

function makeHarness(options?: McpServerBackoffOptions): Harness {
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
    options,
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
    service.trackStderrSession(
      'tab-1',
      'launch-1',
      abortController.signal,
    );

    service.checkStderrForFailure(FAILURE_LINE, Date.now(), 'launch-1');
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
      lastAttemptKey: 'launch-1',
    });
  });

  it('counts genuinely distinct keyed attempts inside 10 seconds twice', () => {
    const { service } = makeHarness();
    service.trackStderrSession(
      'tab-1',
      'launch-1',
      new AbortController().signal,
    );
    service.trackStderrSession(
      'tab-2',
      'launch-2',
      new AbortController().signal,
    );

    service.checkStderrForFailure(FAILURE_LINE, Date.now(), 'launch-1');
    jest.advanceTimersByTime(3_000);
    service.checkStderrForFailure(FAILURE_LINE, Date.now(), 'launch-2');

    expect(service.getRecord('firecrawl')).toMatchObject({
      failureCount: 2,
      lastAttemptKey: 'launch-2',
    });
  });

  it('does not retain a complete match after an earlier newline when no trailing newline exists', () => {
    const { service } = makeHarness();
    service.trackStderrSession(
      'tab-1',
      'launch-1',
      new AbortController().signal,
    );

    expect(
      service.checkStderrForFailure(
        'starting\nfirecrawl (CONNECT_TIMEOUT)',
        Date.now(),
        'launch-1',
      ),
    ).toBe('firecrawl');
    expect(
      service.checkStderrForFailure(
        ': connection timed out after 30000ms\n',
        Date.now(),
        'launch-1',
      ),
    ).toBeNull();

    expect(service.getRecord('firecrawl')?.failureCount).toBe(1);
  });

  it('keeps interleaved stderr chunks isolated by session', () => {
    const { service } = makeHarness();
    service.trackStderrSession(
      'tab-a',
      'launch-a',
      new AbortController().signal,
    );
    service.trackStderrSession(
      'tab-b',
      'launch-b',
      new AbortController().signal,
    );

    service.checkStderrForFailure('alpha (CONNECT_', Date.now(), 'launch-a');
    service.checkStderrForFailure('beta (CONNECT_', Date.now(), 'launch-b');
    expect(
      service.checkStderrForFailure('TIMEOUT): failed', Date.now(), 'launch-a'),
    ).toBe('alpha');
    expect(
      service.checkStderrForFailure('TIMEOUT): failed', Date.now(), 'launch-b'),
    ).toBe('beta');

    expect(service.getRecord('alpha')?.failureCount).toBe(1);
    expect(service.getRecord('beta')?.failureCount).toBe(1);
  });

  it('releases a session buffer when its lifecycle aborts', () => {
    const { service, mcpStatus, sessionIdResolved } = makeHarness();
    const first = new AbortController();
    service.trackStderrSession('tab-1', 'launch-1', first.signal);
    service.checkStderrForFailure(
      'firecrawl (CONNECT_',
      Date.now(),
      'launch-1',
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

    service.trackStderrSession(
      'tab-1',
      'launch-2',
      new AbortController().signal,
    );
    expect(
      service.checkStderrForFailure('TIMEOUT): failed', Date.now(), 'launch-2'),
    ).toBeNull();
    expect(service.getRecord('firecrawl')).toBeUndefined();
    expect(service.getRecord('late-server')?.failureCount).toBe(1);
  });

  it('escalates across two launches in the same tab', () => {
    const { service } = makeHarness();
    const first = new AbortController();
    service.trackStderrSession('tab-1', 'launch-1', first.signal);
    service.checkStderrForFailure(FAILURE_LINE, Date.now(), 'launch-1');
    first.abort();

    jest.advanceTimersByTime(10 * 60_000);
    const secondFailureAt = Date.now();
    service.trackStderrSession(
      'tab-1',
      'launch-2',
      new AbortController().signal,
    );
    service.checkStderrForFailure(
      FAILURE_LINE,
      secondFailureAt,
      'launch-2',
    );

    expect(service.getRecord('firecrawl')).toMatchObject({
      failureCount: 2,
      lastAttemptKey: 'launch-2',
      backoffUntil: secondFailureAt + 120_000,
    });
  });

  it('records an unresolved init failure keylessly after a bounded deadline', () => {
    const { service, mcpStatus } = makeHarness();
    mcpStatus.notifyAll({
      kind: 'servers',
      sessionId: '',
      servers: [{ name: 'unresolved-server', status: 'failed' }],
    });

    jest.advanceTimersByTime(999);
    expect(service.getRecord('unresolved-server')).toBeUndefined();
    jest.advanceTimersByTime(1);

    expect(service.getRecord('unresolved-server')).toMatchObject({
      failureCount: 1,
    });
    expect(
      service.getRecord('unresolved-server')?.lastAttemptKey,
    ).toBeUndefined();
  });

  it('bounds the number of retained stderr session buffers', () => {
    const { service } = makeHarness({ maxTrackedServers: 2 });
    service.trackStderrSession(
      'tab-1',
      'launch-1',
      new AbortController().signal,
    );
    service.checkStderrForFailure(
      'firecrawl (CONNECT_',
      Date.now(),
      'launch-1',
    );
    service.trackStderrSession(
      'tab-2',
      'launch-2',
      new AbortController().signal,
    );
    service.trackStderrSession(
      'tab-3',
      'launch-3',
      new AbortController().signal,
    );

    expect(
      service.checkStderrForFailure('TIMEOUT): failed', Date.now(), 'launch-1'),
    ).toBeNull();
    expect(service.getRecord('firecrawl')).toBeUndefined();
  });

  it('keeps the one-to-thirty-minute curve and resets after success', () => {
    const { service, mcpStatus } = makeHarness();
    const durations = [60, 120, 240, 480, 960, 1_800, 1_800].map(
      (seconds) => seconds * 1_000,
    );

    durations.forEach((expectedDuration, index) => {
      const failedAt = Date.now();
      const backoffUntil = service.recordFailure(
        'firecrawl',
        failedAt,
        `launch-${index + 1}`,
      );
      expect(backoffUntil - failedAt).toBe(expectedDuration);
    });

    expect(service.getRecord('firecrawl')?.failureCount).toBe(7);
    mcpStatus.notifyAll({
      kind: 'servers',
      sessionId: 'connected-session',
      servers: [{ name: 'firecrawl', status: 'connected' }],
    });
    expect(service.getRecord('firecrawl')).toBeUndefined();

    const failedAt = Date.now();
    expect(service.recordFailure('firecrawl', failedAt, 'launch-reset')).toBe(
      failedAt + 60_000,
    );
    expect(service.getRecord('firecrawl')?.failureCount).toBe(1);
  });
});
