/**
 * `PeerSessionDirectory.list` — the assembled row set, including the
 * cross-workspace decision Requirement 10 criterion 5 asks to be explicit.
 *
 * The registry reader is mocked so the test owns the record set; the
 * reader's own parsing is covered in `peer-session-registry.reader.spec.ts`.
 */

jest.mock('./peer-session-registry.reader', () => ({
  ...jest.requireActual('./peer-session-registry.reader'),
  scanPeerSessionRegistry: jest.fn(),
}));

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { PeerSessionDirectory } from './peer-session-directory.service';
import {
  currentPidDomain,
  scanPeerSessionRegistry,
  type PeerSessionRecord,
} from './peer-session-registry.reader';
import { ProcessStartTimeProbe } from './process-start-time.probe';

const scanMock = scanPeerSessionRegistry as jest.MockedFunction<
  typeof scanPeerSessionRegistry
>;

const HERE = process.cwd();
const ELSEWHERE = '/somewhere/else/project';

function logger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/**
 * A record whose fingerprint decodes to `startMs`, built from a real epoch
 * time so the probe comparison is exercised rather than stubbed away.
 */
function record(
  overrides: Partial<PeerSessionRecord> & { pid: number; startMs: number },
): PeerSessionRecord {
  const { startMs, ...rest } = overrides;
  return {
    sessionId: `session-${overrides.pid}`,
    cwd: HERE,
    startedAt: startMs,
    procStart: String((BigInt(startMs) + 11_644_473_600_000n) * 10_000n),
    version: '2.1.268',
    pidDomain: currentPidDomain(),
    messagingSocketPath: `\\\\.\\pipe\\LOCAL\\cc-msg-${overrides.pid}`,
    name: `peer-${overrides.pid}`,
    nameSource: 'user',
    ...rest,
  } as PeerSessionRecord;
}

/** A probe that reports exactly the start times it is handed. */
function probeReporting(
  startTimes: ReadonlyMap<number, number | null>,
): ProcessStartTimeProbe {
  const probe = new ProcessStartTimeProbe({ platform: 'win32' });
  jest.spyOn(probe, 'probe').mockResolvedValue(startTimes);
  return probe;
}

describe('PeerSessionDirectory.list', () => {
  const aliveAt = Date.now() - 60_000;

  beforeEach(() => {
    scanMock.mockReset();
  });

  it('INCLUDES sessions from other workspaces, flagged, and says so', async () => {
    scanMock.mockResolvedValue({
      records: [
        record({ pid: 11, startMs: aliveAt }),
        record({ pid: 22, startMs: aliveAt, cwd: ELSEWHERE }),
      ],
      unreadable: [],
    });
    const directory = new PeerSessionDirectory(
      logger(),
      probeReporting(
        new Map([
          [11, aliveAt],
          [22, aliveAt],
        ]),
      ),
    );

    const result = await directory.list({ currentWorkspace: HERE });

    expect(result.crossWorkspacePolicy).toBe('include-all-workspaces');
    expect(result.sessions.map((row) => row.sessionId)).toEqual([
      'session-11',
      'session-22',
    ]);
    expect(result.sessions[0].inCurrentWorkspace).toBe(true);
    expect(result.sessions[1].inCurrentWorkspace).toBe(false);
    expect(result.currentWorkspace).toBe(HERE);
  });

  it('shows an unreachable session rather than omitting it', async () => {
    scanMock.mockResolvedValue({
      records: [
        record({ pid: 11, startMs: aliveAt }),
        record({ pid: 99, startMs: aliveAt }),
      ],
      unreadable: [],
    });
    const directory = new PeerSessionDirectory(
      logger(),
      probeReporting(
        new Map([
          [11, aliveAt],
          [99, null],
        ]),
      ),
    );

    const result = await directory.list({});

    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[1]).toMatchObject({
      reachability: 'unreachable',
      unreachableReason: 'process-not-running',
    });
  });

  it('drops the caller\'s own row so a session is never offered itself', async () => {
    scanMock.mockResolvedValue({
      records: [
        record({ pid: 11, startMs: aliveAt }),
        record({ pid: 22, startMs: aliveAt }),
      ],
      unreadable: [],
    });
    const directory = new PeerSessionDirectory(
      logger(),
      probeReporting(
        new Map([
          [11, aliveAt],
          [22, aliveAt],
        ]),
      ),
    );

    const result = await directory.list({ excludeSessionId: 'session-11' });

    expect(result.sessions.map((row) => row.sessionId)).toEqual(['session-22']);
  });

  it('adds a row for an unreadable registry file and warns', async () => {
    const log = logger();
    scanMock.mockResolvedValue({
      records: [],
      unreadable: [{ file: '/x/.claude/sessions/7.json', reason: 'bad json' }],
    });

    const result = await new PeerSessionDirectory(
      log,
      probeReporting(new Map()),
    ).list({});

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].unreachableReason).toBe('record-unreadable');
    expect(log.warn).toHaveBeenCalled();
  });

  it('reports when this platform cannot verify liveness at all', async () => {
    scanMock.mockResolvedValue({
      records: [record({ pid: 11, startMs: aliveAt })],
      unreadable: [],
    });
    const probe = new ProcessStartTimeProbe({ platform: 'aix' });

    const result = await new PeerSessionDirectory(logger(), probe).list({});

    expect(result.livenessVerifiable).toBe(false);
    // And every row degrades to unreachable rather than being offered.
    expect(result.sessions[0]).toMatchObject({
      reachability: 'unreachable',
      unreachableReason: 'liveness-unverified',
    });
  });

  it('raises a registry read failure instead of returning an empty list', async () => {
    // An empty list reads as "nothing is running", which is a different claim.
    scanMock.mockRejectedValue(new Error('EACCES'));

    await expect(
      new PeerSessionDirectory(logger(), probeReporting(new Map())).list({}),
    ).rejects.toThrow('EACCES');
  });
});
