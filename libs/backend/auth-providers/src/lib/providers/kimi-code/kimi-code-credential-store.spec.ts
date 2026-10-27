import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, stat, utimes, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger, type MockLogger } from '@ptah-extension/shared/testing';
import { KimiCodeCredentialStore } from './kimi-code-credential-store';
import { KimiCodeHomeResolver } from './kimi-code-home-resolver';

/**
 * Interleaving seams: the real fs, with a hook after a write and before a
 * rename so a test can play the Kimi Code CLI writing at that exact point.
 */
const mockFsHooks: {
  beforeWriteFile?: (path: string) => Promise<void>;
  afterWriteFile?: (path: string) => Promise<void>;
  beforeRename?: (from: string, to: string) => Promise<void>;
  /** May throw to fail the unlink (the file is then left in place). */
  beforeUnlink?: (path: string) => Promise<void>;
  /** May throw to fail the read (the file itself is untouched). */
  beforeReadFile?: (path: string) => Promise<void>;
} = {};

function fsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

jest.mock('node:fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await mockFsHooks.beforeWriteFile?.(String(args[0]));
      await actual.writeFile(...args);
      await mockFsHooks.afterWriteFile?.(String(args[0]));
    },
    rename: async (from: string, to: string) => {
      await mockFsHooks.beforeRename?.(from, to);
      await actual.rename(from, to);
    },
    unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
      await mockFsHooks.beforeUnlink?.(String(path));
      await actual.unlink(path);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      await mockFsHooks.beforeReadFile?.(String(args[0]));
      return actual.readFile(...args);
    },
  };
});

function asLogger(mock: MockLogger): Logger {
  const surface: Partial<Logger> = mock;
  return surface as Logger;
}

function tokenFile(suffix: string, extra: Record<string, unknown> = {}) {
  return {
    access_token: `fake-access-token-${suffix}`,
    refresh_token: `fake-refresh-token-${suffix}`,
    expires_at: 2_000_000_000,
    scope: 'kimi-code',
    token_type: 'Bearer',
    expires_in: 900,
    ...extra,
  };
}

describe('KimiCodeCredentialStore', () => {
  let root: string;
  let home: KimiCodeHomeResolver;
  let logger: MockLogger;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'kimi-store-'));
    home = new KimiCodeHomeResolver(join(root, '.kimi-code'));
    logger = createMockLogger();
    await mkdir(home.credentialsDir, { recursive: true });
  });

  afterEach(() => {
    mockFsHooks.beforeWriteFile = undefined;
    mockFsHooks.afterWriteFile = undefined;
    mockFsHooks.beforeRename = undefined;
    mockFsHooks.beforeUnlink = undefined;
    mockFsHooks.beforeReadFile = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function store(options: ConstructorParameters<typeof KimiCodeCredentialStore>[2] = {}) {
    return new KimiCodeCredentialStore(home, asLogger(logger), options);
  }

  async function writeToken(name: string, body: unknown): Promise<string> {
    const file = join(home.credentialsDir, name);
    await writeFile(file, JSON.stringify(body));
    return file;
  }

  it('reports no CLI when the home directory is missing', async () => {
    rmSync(home.path, { recursive: true, force: true });
    await expect(store().detect()).resolves.toEqual({ cliDetected: false });
  });

  it('uses the file derived from the config oauth key', async () => {
    await writeFile(
      home.configFile,
      '[providers."managed:kimi-code".oauth]\nkey = "oauth/kimi-code-env-a"\n',
    );
    const derived = await writeToken('kimi-code-env-a.json', tokenFile('a'));
    await writeToken('zzz-newer.json', tokenFile('b'));
    const detection = await store().detect();
    expect(detection.file).toBe(derived);
    expect(detection.tokens?.access_token).toBe('fake-access-token-a');
  });

  it('falls back to the newest kimi-code scoped file when the derived name misses', async () => {
    await writeFile(
      home.configFile,
      '[providers."managed:kimi-code".oauth]\nkey = "oauth/missing"\n',
    );
    const older = await writeToken('older.json', tokenFile('old'));
    const newer = await writeToken('newer.json', tokenFile('new'));
    await writeToken('other-scope.json', tokenFile('x', { scope: 'other' }));
    await writeToken('broken.json', { access_token: 'fake-only' });
    await utimes(older, new Date(1_000_000), new Date(1_000_000));
    await utimes(newer, new Date(2_000_000_000), new Date(2_000_000_000));

    const detection = await store().detect();

    expect(detection.file).toBe(newer);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('2 Kimi Code logins found'),
    );
  });

  it('caches detection for five seconds', async () => {
    let now = 1_000;
    const s = store({ now: () => now });
    await writeToken('a.json', tokenFile('a'));
    const first = await s.detect();
    await writeToken('a.json', tokenFile('b'));
    expect(await s.detect()).toBe(first);
    now += 5_001;
    expect((await s.detect()).tokens?.access_token).toBe('fake-access-token-b');
  });

  it('writes rotated tokens atomically, keeping unknown fields', async () => {
    const file = await writeToken('a.json', tokenFile('a', { custom_field: 7 }));
    const outcome = await store().writeRotated(file, 'fake-refresh-token-a', {
      access_token: 'fake-access-token-2',
      refresh_token: 'fake-refresh-token-2',
      expires_at: 2_000_000_900,
      expires_in: 900,
    });
    expect(outcome).toBe('written');
    const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    expect(written).toEqual({
      ...tokenFile('a', { custom_field: 7 }),
      access_token: 'fake-access-token-2',
      refresh_token: 'fake-refresh-token-2',
      expires_at: 2_000_000_900,
    });
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
    if (process.platform !== 'win32') {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it('loses the compare-and-swap when the CLI rotated the file meanwhile', async () => {
    const file = await writeToken('a.json', tokenFile('cli'));
    const outcome = await store().writeRotated(file, 'fake-refresh-token-a', {
      access_token: 'fake-access-token-2',
      refresh_token: 'fake-refresh-token-2',
      expires_at: 2_000_000_900,
    });
    expect(outcome).toBe('cas-lost');
    const kept = JSON.parse(await readFile(file, 'utf8')) as { access_token: string };
    expect(kept.access_token).toBe('fake-access-token-cli');
  });

  it('discards its write when the CLI writes after the first compare, before the rename', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    // The CLI writes while our temp file is being built (after the first
    // compare passed, before the rename).
    mockFsHooks.afterWriteFile = async (path) => {
      if (!path.endsWith('.tmp')) return;
      mockFsHooks.afterWriteFile = undefined;
      await writeFile(file, JSON.stringify(tokenFile('cli-login')));
    };

    const outcome = await store().writeRotated(file, 'fake-refresh-token-a', {
      access_token: 'fake-access-token-2',
      refresh_token: 'fake-refresh-token-2',
      expires_at: 2_000_000_900,
    });

    expect(outcome).toBe('cas-lost');
    const kept = JSON.parse(await readFile(file, 'utf8')) as { refresh_token: string };
    expect(kept.refresh_token).toBe('fake-refresh-token-cli-login');
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('narrows, does not eliminate, the CLI race: a write after the final compare is replaced', async () => {
    // Documents the known limit: the CLI does not take the Ptah lock, so a
    // CLI write between the last read and the rename cannot be detected.
    const file = await writeToken('a.json', tokenFile('a'));
    mockFsHooks.beforeRename = async (from) => {
      if (!from.endsWith('.tmp')) return;
      mockFsHooks.beforeRename = undefined;
      await writeFile(file, JSON.stringify(tokenFile('cli-late')));
    };

    const outcome = await store().writeRotated(file, 'fake-refresh-token-a', {
      access_token: 'fake-access-token-2',
      refresh_token: 'fake-refresh-token-2',
      expires_at: 2_000_000_900,
    });

    expect(outcome).toBe('written');
    const kept = JSON.parse(await readFile(file, 'utf8')) as { refresh_token: string };
    expect(kept.refresh_token).toBe('fake-refresh-token-2');
  });

  it('writes an owner nonce into the lock file', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    let content: Record<string, unknown> = {};
    await store().withRefreshLock(file, async () => {
      content = JSON.parse(await readFile(lock, 'utf8')) as Record<string, unknown>;
    });
    expect(typeof content['owner']).toBe('string');
    expect(String(content['owner']).length).toBeGreaterThan(0);
  });

  it('after a takeover, the old owner does not release the new owner\'s lock', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    const first = store();
    const second = store();
    let releaseSecond: () => void = () => undefined;
    const secondHolds = new Promise<void>((done) => {
      releaseSecond = done;
    });
    let secondAcquired: () => void = () => undefined;
    const secondIn = new Promise<void>((done) => {
      secondAcquired = done;
    });
    let secondRun: Promise<unknown> = Promise.resolve();

    const firstResult = await first.withRefreshLock(file, async () => {
      // The first owner is slow: its lock looks stale, a second process
      // takes it over and is still refreshing when the first one finishes.
      await utimes(lock, new Date(1_000), new Date(1_000));
      secondRun = second.withRefreshLock(file, async () => {
        secondAcquired();
        await secondHolds;
        return 'second';
      });
      await secondIn;
      return 'first';
    });

    expect(firstResult).toEqual({ acquired: true, value: 'first' });
    // The second owner's lock survived the first owner's release.
    await expect(stat(lock)).resolves.toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('taken over'),
    );
    releaseSecond();
    await expect(secondRun).resolves.toEqual({ acquired: true, value: 'second' });
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('a stale takeover never deletes a live lock created after it judged the old one stale', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));
    // Another contender takes over and creates a fresh lock right before
    // we take the takeover guard.
    mockFsHooks.beforeWriteFile = async (path) => {
      if (path !== `${lock}.takeover`) return;
      mockFsHooks.beforeWriteFile = undefined;
      await writeFile(lock, JSON.stringify({ owner: 'live-owner' }));
    };
    const fn = jest.fn(async () => 'never');

    const result = await store({
      lockWaitMs: 0,
      sleep: async () => undefined,
    }).withRefreshLock(file, fn);

    expect(result).toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
    const kept = JSON.parse(await readFile(lock, 'utf8')) as { owner: string };
    expect(kept.owner).toBe('live-owner');
    expect((await readdir(home.credentialsDir)).sort()).toEqual([
      'a.json',
      'a.json.ptah-refresh.lock',
    ]);
  });

  it('three contenders on a stale lock never yield two concurrent owners', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));
    let owners = 0;
    let maxOwners = 0;
    const holding = (name: string, until: Promise<void>, entered?: () => void) =>
      async () => {
        owners += 1;
        maxOwners = Math.max(maxOwners, owners);
        entered?.();
        await until;
        owners -= 1;
        return name;
      };

    // A judges the dead lock stale, then pauses right before its guard.
    let resumeA: () => void = () => undefined;
    const aResumes = new Promise<void>((done) => {
      resumeA = done;
    });
    let aPaused: () => void = () => undefined;
    const aAtGuard = new Promise<void>((done) => {
      aPaused = done;
    });
    mockFsHooks.beforeWriteFile = async (path) => {
      if (path !== `${lock}.takeover`) return;
      mockFsHooks.beforeWriteFile = undefined;
      aPaused();
      await aResumes;
    };
    const quick = { lockWaitMs: 0, sleep: async () => undefined };
    const runA = store(quick).withRefreshLock(file, holding('A', Promise.resolve()));
    await aAtGuard;

    // B takes the stale lock over and holds it.
    let releaseB: () => void = () => undefined;
    const bHolds = new Promise<void>((done) => {
      releaseB = done;
    });
    let bEntered: () => void = () => undefined;
    const bIn = new Promise<void>((done) => {
      bEntered = done;
    });
    const runB = store().withRefreshLock(file, holding('B', bHolds, bEntered));
    await bIn;

    // A resumes and must leave B's lock alone; C must not get in.
    resumeA();
    await expect(runA).resolves.toEqual({ acquired: false });
    await expect(
      store(quick).withRefreshLock(file, holding('C', Promise.resolve())),
    ).resolves.toEqual({ acquired: false });
    expect(maxOwners).toBe(1);

    releaseB();
    await expect(runB).resolves.toEqual({ acquired: true, value: 'B' });
    expect(maxOwners).toBe(1);
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('removes a takeover guard older than 10 s and takes over the stale lock', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));
    await writeFile(`${lock}.takeover`, JSON.stringify({ owner: 'dead-guard' }));
    await utimes(`${lock}.takeover`, new Date(1_000), new Date(1_000));

    const result = await store({
      lockWaitMs: 0,
      sleep: async () => undefined,
    }).withRefreshLock(file, async () => 'ran');

    expect(result).toEqual({ acquired: true, value: 'ran' });
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('does not take over a stale lock while a live takeover guard is held', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));
    await writeFile(`${lock}.takeover`, JSON.stringify({ owner: 'live-guard' }));
    const fn = jest.fn(async () => 'never');

    const result = await store({
      lockWaitMs: 0,
      sleep: async () => undefined,
    }).withRefreshLock(file, fn);

    expect(result).toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
    const kept = JSON.parse(await readFile(lock, 'utf8')) as { owner: string };
    expect(kept.owner).toBe('dead-owner');
  });

  it('keeps an expired guard while its paused holder is alive, so it cannot free a fresh lock', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    const guard = `${lock}.takeover`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));

    // A validates the stale lock inside its guard, then pauses right before
    // its unlink.
    let resumeA: () => void = () => undefined;
    const aResumes = new Promise<void>((done) => {
      resumeA = done;
    });
    let aPaused: () => void = () => undefined;
    const aAtUnlink = new Promise<void>((done) => {
      aPaused = done;
    });
    mockFsHooks.beforeUnlink = async (path) => {
      if (path !== lock) return;
      mockFsHooks.beforeUnlink = undefined;
      aPaused();
      await aResumes;
    };
    const runA = store().withRefreshLock(file, async () => 'A');
    await aAtUnlink;

    // A's guard ages past 10 s while A is still alive.
    const aGuard = JSON.parse(await readFile(guard, 'utf8')) as {
      owner: string;
      pid: number;
    };
    expect(aGuard.pid).toBe(process.pid);
    await utimes(guard, new Date(1_000), new Date(1_000));
    // A and B share this process: A's nonce is held here, so B respects the
    // guard without asking the probe (which would wrongly report "dead").
    const probe = jest.fn<boolean, [number]>(() => false);
    const fnB = jest.fn(async () => 'never');

    await expect(
      store({
        lockWaitMs: 0,
        sleep: async () => undefined,
        isProcessAlive: probe,
      }).withRefreshLock(file, fnB),
    ).resolves.toEqual({ acquired: false });

    expect(fnB).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    const keptGuard = JSON.parse(await readFile(guard, 'utf8')) as { owner: string };
    expect(keptGuard.owner).toBe(aGuard.owner);
    const keptLock = JSON.parse(await readFile(lock, 'utf8')) as { owner: string };
    expect(keptLock.owner).toBe('dead-owner');

    // A resumes, completes its takeover and is the only owner.
    resumeA();
    await expect(runA).resolves.toEqual({ acquired: true, value: 'A' });
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('takes over an expired guard only once its holder pid is dead', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    const guard = `${lock}.takeover`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));
    await writeFile(guard, JSON.stringify({ owner: 'crashed-guard', pid: 4242 }));
    await utimes(guard, new Date(1_000), new Date(1_000));
    const quick = { lockWaitMs: 0, sleep: async () => undefined };

    const alive = jest.fn<boolean, [number]>(() => true);
    await expect(
      store({ ...quick, isProcessAlive: alive }).withRefreshLock(
        file,
        async () => 'early',
      ),
    ).resolves.toEqual({ acquired: false });
    expect(alive).toHaveBeenCalledWith(4242);
    const kept = JSON.parse(await readFile(guard, 'utf8')) as { owner: string };
    expect(kept.owner).toBe('crashed-guard');

    const dead = jest.fn<boolean, [number]>(() => false);
    await expect(
      store({ ...quick, isProcessAlive: dead }).withRefreshLock(
        file,
        async () => 'ran',
      ),
    ).resolves.toEqual({ acquired: true, value: 'ran' });
    expect(dead).toHaveBeenCalledWith(4242);
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('gives up within the wait budget when a stale lock cannot be deleted', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));
    // Only the stale lock is undeletable; its guard comes and goes normally.
    let lockUnlinks = 0;
    mockFsHooks.beforeUnlink = async (path) => {
      if (path !== lock) return;
      lockUnlinks += 1;
      throw Object.assign(new Error('denied'), { code: 'EPERM' });
    };
    let clock = Date.now();
    const fn = jest.fn(async () => 'never');

    const result = await store({
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      lockWaitMs: 1_000,
    }).withRefreshLock(file, fn);

    expect(result).toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
    // At most one takeover attempt per 100 ms poll across the 1 s budget.
    expect(lockUnlinks).toBeGreaterThan(0);
    expect(lockUnlinks).toBeLessThanOrEqual(11);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Refresh lock wait timed out'),
    );
    const kept = JSON.parse(await readFile(lock, 'utf8')) as { owner: string };
    expect(kept.owner).toBe('dead-owner');
    expect((await readdir(home.credentialsDir)).sort()).toEqual([
      'a.json',
      'a.json.ptah-refresh.lock',
    ]);
  });

  it('recovers in the same process from a guard whose release unlink failed', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const guard = `${file}.ptah-refresh.lock.takeover`;
    // The guard-release unlink is denied once (a transient AV hold).
    let denied = 0;
    mockFsHooks.beforeUnlink = async (path) => {
      if (path !== guard || denied > 0) return;
      denied += 1;
      throw fsError('EPERM');
    };

    await expect(
      store().withRefreshLock(file, async () => 'first'),
    ).resolves.toEqual({ acquired: true, value: 'first' });
    expect(denied).toBe(1);
    const orphan = JSON.parse(await readFile(guard, 'utf8')) as { pid: number };
    expect(orphan.pid).toBe(process.pid);

    // Another store in this process reclaims the fresh orphan at once; the
    // probe (reporting our pid alive) does not keep it.
    const probe = jest.fn<boolean, [number]>(() => true);
    await expect(
      store({ isProcessAlive: probe }).withRefreshLock(file, async () => 'second'),
    ).resolves.toEqual({ acquired: true, value: 'second' });
    expect(probe).not.toHaveBeenCalled();
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('lets only one store in this process reclaim an own-pid orphan guard', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    const guard = `${lock}.takeover`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));
    await writeFile(guard, JSON.stringify({ owner: 'orphan', pid: process.pid }));
    // A pauses right before it unlinks the orphan guard it judged abandoned.
    let resumeA: () => void = () => undefined;
    let pausedA: () => void = () => undefined;
    const aPaused = new Promise<void>((resolve) => (pausedA = resolve));
    let paused = false;
    mockFsHooks.beforeUnlink = async (path) => {
      if (path !== guard || paused) return;
      paused = true;
      pausedA();
      await new Promise<void>((resolve) => (resumeA = resolve));
    };
    const quick = { lockWaitMs: 0, sleep: async () => undefined };

    const runA = store(quick).withRefreshLock(file, async () => 'A');
    await aPaused;
    // B sees the same orphan on disk but must not reclaim it while A does.
    const bFn = jest.fn(async () => 'B');
    await expect(store(quick).withRefreshLock(file, bFn)).resolves.toEqual({
      acquired: false,
    });
    expect(bFn).not.toHaveBeenCalled();
    const still = JSON.parse(await readFile(guard, 'utf8')) as { owner: string };
    expect(still.owner).toBe('orphan');

    resumeA();
    await expect(runA).resolves.toEqual({ acquired: true, value: 'A' });
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('treats an aged guard it cannot read as held', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    const guard = `${lock}.takeover`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));
    await writeFile(guard, JSON.stringify({ owner: 'other-guard', pid: 4242 }));
    await utimes(guard, new Date(1_000), new Date(1_000));
    // One EIO on the guard read. The probe says "dead", so only the failed
    // read can be what keeps the guard.
    let failedReads = 0;
    mockFsHooks.beforeReadFile = async (path) => {
      if (path !== guard || failedReads > 0) return;
      failedReads += 1;
      throw fsError('EIO');
    };
    const dead = jest.fn<boolean, [number]>(() => false);
    const quick = { lockWaitMs: 0, sleep: async () => undefined, isProcessAlive: dead };
    const fnB = jest.fn(async () => 'never');

    await expect(store(quick).withRefreshLock(file, fnB)).resolves.toEqual({
      acquired: false,
    });
    expect(failedReads).toBe(1);
    expect(fnB).not.toHaveBeenCalled();
    expect(dead).not.toHaveBeenCalled();
    const keptGuard = JSON.parse(await readFile(guard, 'utf8')) as { owner: string };
    expect(keptGuard.owner).toBe('other-guard');
    const keptLock = JSON.parse(await readFile(lock, 'utf8')) as { owner: string };
    expect(keptLock.owner).toBe('dead-owner');

    // Once readable, the same old guard of a dead pid is reclaimed.
    await expect(
      store(quick).withRefreshLock(file, async () => 'ran'),
    ).resolves.toEqual({ acquired: true, value: 'ran' });
    expect(dead).toHaveBeenCalledWith(4242);
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('does not take over a stale refresh lock it cannot read', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    await writeFile(lock, JSON.stringify({ owner: 'dead-owner' }));
    await utimes(lock, new Date(1_000), new Date(1_000));
    mockFsHooks.beforeReadFile = async (path) => {
      if (path === lock) throw fsError('EIO');
    };
    const fn = jest.fn(async () => 'never');

    await expect(
      store({ lockWaitMs: 0, sleep: async () => undefined }).withRefreshLock(file, fn),
    ).resolves.toEqual({ acquired: false });

    expect(fn).not.toHaveBeenCalled();
    mockFsHooks.beforeReadFile = undefined;
    const kept = JSON.parse(await readFile(lock, 'utf8')) as { owner: string };
    expect(kept.owner).toBe('dead-owner');
  });

  it('runs under the lock and releases it, also when the callback throws', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const s = store();
    await expect(s.withRefreshLock(file, async () => 42)).resolves.toEqual({
      acquired: true,
      value: 42,
    });
    await expect(
      s.withRefreshLock(file, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await readdir(home.credentialsDir)).sort()).toEqual(['a.json']);
  });

  it('takes over a lock older than 60 s', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    const lock = `${file}.ptah-refresh.lock`;
    await writeFile(lock, '{}');
    await utimes(lock, new Date(1_000), new Date(1_000));
    const result = await store().withRefreshLock(file, async () => 'ran');
    expect(result).toEqual({ acquired: true, value: 'ran' });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('stale refresh lock'),
    );
  });

  it('gives up on a live lock after the wait budget', async () => {
    const file = await writeToken('a.json', tokenFile('a'));
    await writeFile(`${file}.ptah-refresh.lock`, '{}');
    const fn = jest.fn(async () => 'never');
    const result = await store({
      lockWaitMs: 0,
      sleep: async () => undefined,
    }).withRefreshLock(file, fn);
    expect(result).toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it('reads region and device id with safe defaults', async () => {
    const s = store();
    await expect(s.readRegion()).resolves.toBe('global');
    await expect(s.readDeviceId()).resolves.toBeUndefined();
    await writeFile(home.regionFile, 'mainland-cn\n');
    await writeFile(home.deviceIdFile, '0123456789abcdef0123456789abcdef\n');
    await expect(s.readRegion()).resolves.toBe('mainland-cn');
    await expect(s.readDeviceId()).resolves.toBe('0123456789abcdef0123456789abcdef');
    await writeFile(home.deviceIdFile, 'not a uuid');
    await expect(s.readDeviceId()).resolves.toBeUndefined();
  });

  it('never logs token values or file names', async () => {
    await writeToken('kimi-code-env-secretname.json', tokenFile('a'));
    await writeToken('bad.json', '{not json');
    await store().detect();
    const logged = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logged).not.toContain('fake-');
    expect(logged).not.toContain('secretname');
  });
});
