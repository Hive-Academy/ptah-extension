/**
 * `DegradationReporter` — specs (TASK_2026_383, component 2).
 *
 * The whole value of this class is that it cannot fail its caller. Every case
 * below is therefore a hostile-host case: no webview manager, a manager whose
 * resolution throws, a broadcast that rejects, a logger that is not there. In
 * each one the count must still be taken and nothing must escape.
 *
 * The container is a hand-rolled `isRegistered` + `resolve` stub rather than a
 * real tsyringe graph, matching `thoth-runtime`'s activity-emitter specs — the
 * subject is behaviour under a host, not registration.
 */

import type { DependencyContainer } from 'tsyringe';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { isDegradationEventPayload } from '@ptah-extension/shared';
import { TOKENS } from '../di/tokens';
import {
  DegradationReporter,
  MAX_TRACKED_DEGRADATION_CODES,
  type DegradationReport,
} from './degradation-reporter';

interface StubHost {
  container: DependencyContainer;
  broadcastMessage: jest.Mock<Promise<void>, [string, unknown]>;
  loggerError: jest.Mock<void, [unknown, unknown?]>;
}

function makeHost(
  options: {
    withWebviewManager?: boolean;
    withLogger?: boolean;
    broadcast?: () => Promise<void>;
    resolveThrows?: boolean;
  } = {},
): StubHost {
  const {
    withWebviewManager = true,
    withLogger = true,
    broadcast = (): Promise<void> => Promise.resolve(),
    resolveThrows = false,
  } = options;

  const broadcastMessage = jest.fn<Promise<void>, [string, unknown]>(() =>
    broadcast(),
  );
  const loggerError = jest.fn<void, [unknown, unknown?]>();

  const registered = new Set<symbol>();
  if (withWebviewManager) registered.add(TOKENS.WEBVIEW_MANAGER);
  if (withLogger) registered.add(TOKENS.LOGGER);

  const container = {
    isRegistered: (token: symbol): boolean => registered.has(token),
    resolve: (token: symbol): unknown => {
      if (resolveThrows) throw new Error('container is half-built');
      if (token === TOKENS.WEBVIEW_MANAGER) return { broadcastMessage };
      if (token === TOKENS.LOGGER) return { error: loggerError };
      throw new Error(`unexpected token ${String(token)}`);
    },
  } as unknown as DependencyContainer;

  return { container, broadcastMessage, loggerError };
}

const REPORT: DegradationReport = {
  source: 'database',
  code: 'sqlite.backup.no-worker-factory',
  severity: 'critical',
  summary: 'No backup was taken: the database worker factory is unregistered',
};

describe('DegradationReporter.report', () => {
  it('counts and broadcasts a well-formed payload', () => {
    const host = makeHost();
    const reporter = new DegradationReporter(host.container);

    reporter.report({ ...REPORT, detail: 'factory token unbound' });

    expect(host.broadcastMessage).toHaveBeenCalledTimes(1);
    const [type, payload] = host.broadcastMessage.mock.calls[0];
    expect(type).toBe(MESSAGE_TYPES.DEGRADATION_EVENT);
    expect(isDegradationEventPayload(payload)).toBe(true);
    expect(payload).toMatchObject({
      source: 'database',
      code: 'sqlite.backup.no-worker-factory',
      severity: 'critical',
      detail: 'factory token unbound',
    });
    expect(reporter.snapshot().total).toBe(1);
  });

  it('omits detail entirely when the call site gave none', () => {
    const host = makeHost();

    new DegradationReporter(host.container).report(REPORT);

    const [, payload] = host.broadcastMessage.mock.calls[0];
    expect(payload).not.toHaveProperty('detail');
  });

  it('counts with no webview manager registered, and does not throw', () => {
    const host = makeHost({ withWebviewManager: false });
    const reporter = new DegradationReporter(host.container);

    expect(() => reporter.report(REPORT)).not.toThrow();

    expect(host.broadcastMessage).not.toHaveBeenCalled();
    expect(reporter.snapshot().total).toBe(1);
    expect(reporter.snapshot().broadcastFailures).toBe(0);
  });

  it('counts when the broadcast rejects, and does not reject', async () => {
    const host = makeHost({
      broadcast: () => Promise.reject(new Error('webview is gone')),
    });
    const reporter = new DegradationReporter(host.container);

    expect(() => reporter.report(REPORT)).not.toThrow();
    await Promise.resolve();

    expect(reporter.snapshot().total).toBe(1);
    expect(reporter.snapshot().broadcastFailures).toBe(1);
  });

  it('counts when resolving the webview manager throws', () => {
    const host = makeHost({ resolveThrows: true });
    const reporter = new DegradationReporter(host.container);

    expect(() => reporter.report(REPORT)).not.toThrow();

    expect(reporter.snapshot().total).toBe(1);
    expect(reporter.snapshot().broadcastFailures).toBe(1);
  });

  it('does not log on the reporting path', () => {
    const host = makeHost();

    new DegradationReporter(host.container).report(REPORT);

    // The call site keeps its own logger.warn; the reporter deliberately adds
    // no second line per degradation.
    expect(host.loggerError).not.toHaveBeenCalled();
  });

  it('resolves the webview manager per report, not once at construction', () => {
    const host = makeHost({ withWebviewManager: false });
    const reporter = new DegradationReporter(host.container);
    reporter.report(REPORT);

    const late = makeHost();
    const lateReporter = new DegradationReporter(late.container);
    lateReporter.report(REPORT);

    expect(host.broadcastMessage).not.toHaveBeenCalled();
    expect(late.broadcastMessage).toHaveBeenCalledTimes(1);
  });
});

describe('DegradationReporter.snapshot', () => {
  it('returns per-code counts, highest first then code order', () => {
    const reporter = new DegradationReporter(makeHost().container);
    reporter.report(REPORT);
    reporter.report(REPORT);
    reporter.report({
      source: 'settings',
      code: 'cli.settings.keytar-unavailable',
      severity: 'expected',
      summary: 'Secrets fall back to the file store',
    });
    reporter.report({
      source: 'boot',
      code: 'electron.boot.startOrJoin-failed',
      severity: 'degraded',
      summary: 'Startup boot did not complete',
    });

    const snapshot = reporter.snapshot();

    expect(snapshot.total).toBe(4);
    expect(snapshot.entries.map((entry) => [entry.code, entry.count])).toEqual([
      ['sqlite.backup.no-worker-factory', 2],
      ['cli.settings.keytar-unavailable', 1],
      ['electron.boot.startOrJoin-failed', 1],
    ]);
    expect(snapshot.entries[0].severity).toBe('critical');
    expect(snapshot.droppedReports).toBe(0);
  });

  it('is empty on a boot with no degradations', () => {
    const snapshot = new DegradationReporter(makeHost().container).snapshot();

    expect(snapshot).toEqual({
      total: 0,
      entries: [],
      droppedReports: 0,
      broadcastFailures: 0,
    });
  });
});

describe('DegradationReporter code cap', () => {
  function fill(reporter: DegradationReporter, count: number): void {
    for (let index = 0; index < count; index += 1) {
      reporter.report({ ...REPORT, code: `test.code.${index}` });
    }
  }

  it('stops tracking new codes past the cap and counts the drops', () => {
    const reporter = new DegradationReporter(makeHost().container);

    fill(reporter, MAX_TRACKED_DEGRADATION_CODES + 5);
    const snapshot = reporter.snapshot();

    expect(snapshot.entries).toHaveLength(MAX_TRACKED_DEGRADATION_CODES);
    expect(snapshot.droppedReports).toBe(5);
    expect(snapshot.total).toBe(MAX_TRACKED_DEGRADATION_CODES + 5);
  });

  it('still counts repeats of an already-tracked code past the cap', () => {
    const reporter = new DegradationReporter(makeHost().container);

    fill(reporter, MAX_TRACKED_DEGRADATION_CODES + 3);
    reporter.report({ ...REPORT, code: 'test.code.0' });

    const first = reporter
      .snapshot()
      .entries.find((entry) => entry.code === 'test.code.0');
    expect(first?.count).toBe(2);
  });

  it('logs the cap exactly once, at error', () => {
    const host = makeHost();
    const reporter = new DegradationReporter(host.container);

    fill(reporter, MAX_TRACKED_DEGRADATION_CODES + 4);

    expect(host.loggerError).toHaveBeenCalledTimes(1);
    expect(String(host.loggerError.mock.calls[0][0])).toContain(
      'Tracking cap of',
    );
    expect(host.loggerError.mock.calls[0][1]).toEqual({
      firstDroppedCode: `test.code.${MAX_TRACKED_DEGRADATION_CODES}`,
    });
  });

  it('does not throw when the cap is hit with no logger registered', () => {
    const reporter = new DegradationReporter(
      makeHost({ withLogger: false }).container,
    );

    expect(() =>
      fill(reporter, MAX_TRACKED_DEGRADATION_CODES + 1),
    ).not.toThrow();
    expect(reporter.snapshot().droppedReports).toBe(1);
  });
});
