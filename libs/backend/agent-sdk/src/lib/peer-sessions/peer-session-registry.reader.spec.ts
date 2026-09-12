import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  currentPidDomain,
  peerSessionRegistryDirectory,
  recordStartFingerprint,
  scanPeerSessionRegistry,
  type PeerSessionRecord,
} from './peer-session-registry.reader';

/**
 * A verbatim live record read from `~/.claude/sessions/16288.json` on
 * 2026-09-12, CLI 2.1.268. Used as-is rather than as a hand-written fixture so
 * the schema is tested against the shape the CLI actually writes.
 */
const LIVE_2_1_268 = {
  pid: 16288,
  sessionId: 'b8fc48ad-d055-4ec1-884e-da0a3f400ca2',
  cwd: 'D:\\projects\\ptah-extension',
  startedAt: 1789204846802,
  procStart: '134336784461747472',
  version: '2.1.268',
  peerProtocol: 1,
  peerFeatures: ['notify_idle', 'artifact_yield'],
  kind: 'interactive',
  entrypoint: 'sdk-ts',
  pidDomain: 'win32:abdo',
  messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-307e851ab448c4f4988c41e4e0c2ccf8',
  name: 'ptah-extension-1c',
  nameSource: 'derived',
  nameSince: 1789204846802,
};

/**
 * An equally verbatim 2.1.233 record. It carries no `peerFeatures`, no
 * `pidDomain` and no `messagingSocketPath` — the reason the schema is not
 * strict.
 */
const LIVE_2_1_233 = {
  pid: 2832,
  sessionId: '0d58182e-40e2-4f0b-9028-9dcc87f2069f',
  cwd: 'D:\\projects\\ptah-extension',
  startedAt: 1787072631456,
  procStart: '134315462261164889',
  version: '2.1.233',
  peerProtocol: 1,
  kind: 'interactive',
  entrypoint: 'sdk-ts',
  name: 'ptah-extension-82',
  nameSource: 'derived',
  nameSince: 1787072631457,
};

async function makeRegistry(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-peer-'));
  const directory = peerSessionRegistryDirectory(home);
  await fs.mkdir(directory, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await fs.writeFile(path.join(directory, name), contents, 'utf8');
  }
  return home;
}

describe('peerSessionRegistryDirectory', () => {
  it('points at the CLI\'s own registry, not a Ptah-side store', () => {
    expect(peerSessionRegistryDirectory('/home/me')).toBe(
      path.join('/home/me', '.claude', 'sessions'),
    );
  });
});

describe('scanPeerSessionRegistry', () => {
  it('reads a live 2.1.268 record with every field intact', async () => {
    const home = await makeRegistry({
      '16288.json': JSON.stringify(LIVE_2_1_268),
    });

    const scan = await scanPeerSessionRegistry(home);

    expect(scan.unreadable).toEqual([]);
    expect(scan.records).toHaveLength(1);
    expect(scan.records[0]).toMatchObject({
      pid: 16288,
      sessionId: LIVE_2_1_268.sessionId,
      cwd: LIVE_2_1_268.cwd,
      procStart: LIVE_2_1_268.procStart,
      pidDomain: 'win32:abdo',
      messagingSocketPath: LIVE_2_1_268.messagingSocketPath,
      name: 'ptah-extension-1c',
      nameSource: 'derived',
    });
  });

  it('reads an older record that lacks the peer-channel fields', async () => {
    const home = await makeRegistry({
      '2832.json': JSON.stringify(LIVE_2_1_233),
    });

    const scan = await scanPeerSessionRegistry(home);

    expect(scan.records).toHaveLength(1);
    expect(scan.records[0].messagingSocketPath).toBeUndefined();
    expect(scan.records[0].pidDomain).toBeUndefined();
  });

  it('keeps a record carrying fields this build has never seen', async () => {
    const home = await makeRegistry({
      '1.json': JSON.stringify({
        ...LIVE_2_1_268,
        somethingTheCliAddedLater: { nested: true },
      }),
    });

    // Rejecting it would be indistinguishable from "no sessions are running",
    // which is the silent omission Requirement 10 criterion 3 forbids.
    expect((await scanPeerSessionRegistry(home)).records).toHaveLength(1);
  });

  it('never reads a .key file', async () => {
    const home = await makeRegistry({
      '16288.json': JSON.stringify(LIVE_2_1_268),
      '16288.abc.key': '{"peerToken":"0123456789abcdef0123456789abcdef"}',
    });

    const scan = await scanPeerSessionRegistry(home);

    expect(scan.records).toHaveLength(1);
    expect(scan.unreadable).toEqual([]);
  });

  it('reports a malformed record as unreadable rather than dropping it', async () => {
    const home = await makeRegistry({ 'broken.json': '{ not json' });

    const scan = await scanPeerSessionRegistry(home);

    expect(scan.records).toEqual([]);
    expect(scan.unreadable).toHaveLength(1);
    expect(scan.unreadable[0].reason).toContain('malformed JSON');
  });

  it('reports a record missing a required field as unreadable', async () => {
    const home = await makeRegistry({
      '9.json': JSON.stringify({ pid: 9, cwd: 'C:\\x' }),
    });

    const scan = await scanPeerSessionRegistry(home);

    expect(scan.records).toEqual([]);
    expect(scan.unreadable[0].reason).toContain('sessionId');
  });

  it('treats a missing registry directory as no sessions, not an error', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-peer-empty-'));

    await expect(scanPeerSessionRegistry(home)).resolves.toEqual({
      records: [],
      unreadable: [],
    });
  });
});

describe('recordStartFingerprint', () => {
  it('reads the older `procStart` field name', () => {
    expect(
      recordStartFingerprint({ procStart: 'a' } as PeerSessionRecord),
    ).toBe('a');
  });

  it('reads the current `procStartFt` field name', () => {
    expect(
      recordStartFingerprint({ procStartFt: 'b' } as PeerSessionRecord),
    ).toBe('b');
  });

  it('is undefined when the record carries neither', () => {
    expect(recordStartFingerprint({} as PeerSessionRecord)).toBeUndefined();
  });
});

describe('currentPidDomain', () => {
  it('matches the shape a live record carries, case-insensitively', () => {
    // The live record says `win32:abdo` on a host whose hostname is `Abdo`.
    expect(currentPidDomain('win32', 'Abdo')).toBe('win32:abdo');
  });
});
