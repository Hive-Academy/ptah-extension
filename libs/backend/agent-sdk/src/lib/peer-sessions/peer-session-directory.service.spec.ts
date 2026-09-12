import 'reflect-metadata';
import {
  resolveName,
  resolveUnreachableReason,
  unreadableRow,
} from './peer-session-directory.service';
import type { PeerSessionRecord } from './peer-session-registry.reader';

const HOST = 'win32:abdo';
const NOW = 1789205500000;

/** The live 2.1.268 record, reachable: pid 16288 started at 1789204846174. */
function record(overrides: Partial<PeerSessionRecord> = {}): PeerSessionRecord {
  return {
    pid: 16288,
    sessionId: 'b8fc48ad-d055-4ec1-884e-da0a3f400ca2',
    cwd: 'D:\\projects\\ptah-extension',
    startedAt: 1789204846802,
    procStart: '134336784461747472',
    version: '2.1.268',
    pidDomain: HOST,
    messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-307e',
    name: 'ptah-extension-1c',
    nameSource: 'derived',
    ...overrides,
  } as PeerSessionRecord;
}

function context(
  startTimes: ReadonlyMap<number, number | null>,
  toleranceMs = 1000,
) {
  return { startTimes, toleranceMs, now: NOW, hostPidDomain: HOST };
}

describe('resolveUnreachableReason', () => {
  it('is reachable when the pid is alive AND its start time matches', () => {
    const reason = resolveUnreachableReason(
      record(),
      context(new Map([[16288, 1789204846174]])),
    );
    expect(reason).toBeUndefined();
  });

  it('tolerates a sub-tolerance difference in the start time', () => {
    expect(
      resolveUnreachableReason(
        record(),
        context(new Map([[16288, 1789204846174 + 400]])),
      ),
    ).toBeUndefined();
  });

  it('reports a RECYCLED pid as an identity mismatch, not as reachable', () => {
    // The pid is alive — this is exactly the case a bare `process.kill(pid, 0)`
    // would call reachable, and the reason a bare pid check is not acceptable.
    expect(
      resolveUnreachableReason(
        record(),
        context(new Map([[16288, 1789204846174 + 90_000]])),
      ),
    ).toBe('process-identity-mismatch');
  });

  it('reports a pid the OS does not know as not running', () => {
    expect(
      resolveUnreachableReason(record(), context(new Map([[16288, null]]))),
    ).toBe('process-not-running');
  });

  it('reports an EMPTY probe result as unverified, never as not running', () => {
    // An empty map means the probe established nothing. Reporting that as
    // "not running" would be a claim the host cannot make.
    expect(resolveUnreachableReason(record(), context(new Map()))).toBe(
      'liveness-unverified',
    );
  });

  it('reports a record with no messaging channel before anything else', () => {
    expect(
      resolveUnreachableReason(
        record({ messagingSocketPath: undefined }),
        context(new Map([[16288, 1789204846174]])),
      ),
    ).toBe('no-messaging-channel');
  });

  it('reports a record from another machine as such', () => {
    expect(
      resolveUnreachableReason(
        record({ pidDomain: 'win32:otherbox' }),
        context(new Map([[16288, 1789204846174]])),
      ),
    ).toBe('other-host');
  });

  it('reports a record with no pidDomain as unverified', () => {
    expect(
      resolveUnreachableReason(
        record({ pidDomain: undefined }),
        context(new Map([[16288, 1789204846174]])),
      ),
    ).toBe('liveness-unverified');
  });

  it('reports a record with no start fingerprint as unverified', () => {
    expect(
      resolveUnreachableReason(
        record({ procStart: undefined }),
        context(new Map([[16288, 1789204846174]])),
      ),
    ).toBe('liveness-unverified');
  });

  it('reports an undecodable fingerprint as unverified', () => {
    expect(
      resolveUnreachableReason(
        record({ procStart: 'not-a-number' }),
        context(new Map([[16288, 1789204846174]])),
      ),
    ).toBe('liveness-unverified');
  });

  it('accepts a match inside the wider POSIX tolerance', () => {
    expect(
      resolveUnreachableReason(
        record(),
        context(new Map([[16288, 1789204846174 + 1500]]), 2000),
      ),
    ).toBeUndefined();
  });
});

describe('resolveName', () => {
  it('marks a user-chosen name as such', () => {
    expect(
      resolveName(record({ name: 'architect-402', nameSource: 'user' })),
    ).toEqual({ name: 'architect-402', nameSource: 'user' });
  });

  it('marks the CLI-derived label as derived, and still shows it', () => {
    expect(resolveName(record())).toEqual({
      name: 'ptah-extension-1c',
      nameSource: 'derived',
    });
  });

  it('does not vouch for a nameSource this build does not recognise', () => {
    expect(
      resolveName(record({ name: 'whatever', nameSource: 'something-new' })),
    ).toEqual({ name: 'whatever', nameSource: 'unknown' });
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])('synthesises a placeholder for a %s name', (_label, name) => {
    const resolved = resolveName(record({ name }));
    expect(resolved.nameSource).toBe('unknown');
    expect(resolved.name).toBe('ptah-extension (pid 16288)');
  });
});

describe('unreadableRow', () => {
  it('shows an unparseable record instead of letting it vanish', () => {
    const row = unreadableRow('/home/me/.claude/sessions/1234.json');

    expect(row.reachability).toBe('unreachable');
    expect(row.unreachableReason).toBe('record-unreadable');
    expect(row.pid).toBe(1234);
    expect(row.name).toContain('unreadable');
  });

  it('does not invent a pid for a non-numeric filename', () => {
    expect(unreadableRow('/x/.claude/sessions/weird.json').pid).toBe(0);
  });
});
