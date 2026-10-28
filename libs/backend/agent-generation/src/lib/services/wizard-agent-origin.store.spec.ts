import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let fakeHome: string;

/**
 * The mirror half of the hash-equality test writes to `~/.ptah/user/**`, so
 * `homedir()` is redirected into the per-test temp root (harness-sync's
 * CLAUDE.md: never let a spec touch the real home directory).
 */
jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: () => fakeHome,
}));

import {
  WizardAgentOriginStore,
  AGENT_ORIGINS_VERSION,
} from './wizard-agent-origin.store';
import { UserLayerMirrorService } from './user-layer/user-layer-mirror.service';

interface MockLogger {
  info: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
  error: jest.Mock;
}

function makeLogger(): MockLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
}

async function removeTempRoot(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort — cleanup must never decide the outcome of a test.
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

describe('WizardAgentOriginStore', () => {
  let workRoot: string;
  let harnessRoot: string;
  let logger: MockLogger;
  let store: WizardAgentOriginStore;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-agent-origins-'));
    fakeHome = join(workRoot, 'home');
    harnessRoot = join(workRoot, 'workspace');
    await mkdir(fakeHome, { recursive: true });
    await mkdir(harnessRoot, { recursive: true });
    logger = makeLogger();
    store = new WizardAgentOriginStore(logger as never);
  });

  afterEach(async () => {
    await removeTempRoot(workRoot);
  });

  it('stores the file under {harnessRoot}/.ptah/setup-wizard/agent-origins.json', () => {
    expect(store.originsPath(harnessRoot)).toBe(
      join(harnessRoot, '.ptah', 'setup-wizard', 'agent-origins.json'),
    );
  });

  it('reads a missing file as empty without warning', async () => {
    await expect(store.read(harnessRoot)).resolves.toEqual({});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('round-trips concurrent records without losing an entry', async () => {
    const before = Date.now();
    const results = await Promise.all([
      store.recordWritten(harnessRoot, 'frontend-developer', HASH_B),
      store.recordWritten(harnessRoot, 'backend-developer', HASH_A),
    ]);

    expect(results).toEqual([true, true]);
    const origins = await store.read(harnessRoot);
    expect(origins['backend-developer'].hash).toBe(HASH_A);
    expect(origins['frontend-developer'].hash).toBe(HASH_B);
    expect(origins['backend-developer'].writtenAt).toBeGreaterThanOrEqual(
      before,
    );

    const raw = JSON.parse(
      await readFile(store.originsPath(harnessRoot), 'utf8'),
    ) as { version: number; agents: Record<string, unknown> };
    expect(raw.version).toBe(AGENT_ORIGINS_VERSION);
    expect(Object.keys(raw.agents)).toEqual([
      'backend-developer',
      'frontend-developer',
    ]);
  });

  it('overwrites the record of a slug that is written again', async () => {
    await store.recordWritten(harnessRoot, 'backend-developer', HASH_A);
    await store.recordWritten(harnessRoot, 'backend-developer', HASH_B);

    const origins = await store.read(harnessRoot);
    expect(Object.keys(origins)).toEqual(['backend-developer']);
    expect(origins['backend-developer'].hash).toBe(HASH_B);
  });

  it('treats a legacy unmarked agent as absent', async () => {
    await store.recordWritten(harnessRoot, 'backend-developer', HASH_A);

    const origins = await store.read(harnessRoot);
    expect(origins['legacy-agent']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(origins, 'legacy-agent')).toBe(
      false,
    );
  });

  it('reads corrupt JSON as empty with a warning, and the next write replaces it', async () => {
    const path = store.originsPath(harnessRoot);
    await mkdir(join(harnessRoot, '.ptah', 'setup-wizard'), {
      recursive: true,
    });
    await writeFile(path, '{ not json', 'utf8');

    await expect(store.read(harnessRoot)).resolves.toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('invalid'),
      expect.objectContaining({ path }),
    );

    await expect(
      store.recordWritten(harnessRoot, 'backend-developer', HASH_A),
    ).resolves.toBe(true);
    expect(Object.keys(await store.read(harnessRoot))).toEqual([
      'backend-developer',
    ]);
  });

  it('reads a file that fails the schema as empty with a warning', async () => {
    const path = store.originsPath(harnessRoot);
    await mkdir(join(harnessRoot, '.ptah', 'setup-wizard'), {
      recursive: true,
    });
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        agents: { 'backend-developer': { hash: HASH_A, writtenAt: 1 } },
      }),
      'utf8',
    );

    await expect(store.read(harnessRoot)).resolves.toEqual({});
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('forget removes one slug and keeps the others', async () => {
    await store.recordWritten(harnessRoot, 'backend-developer', HASH_A);
    await store.recordWritten(harnessRoot, 'frontend-developer', HASH_B);

    await expect(store.forget(harnessRoot, 'backend-developer')).resolves.toBe(
      true,
    );

    const origins = await store.read(harnessRoot);
    expect(Object.keys(origins)).toEqual(['frontend-developer']);
  });

  it('forget of an unrecorded slug touches nothing on disk', async () => {
    await expect(store.forget(harnessRoot, 'backend-developer')).resolves.toBe(
      true,
    );
    expect(await pathExists(store.originsPath(harnessRoot))).toBe(false);
  });

  it('refuses an invalid hash or empty slug without writing', async () => {
    await expect(
      store.recordWritten(harnessRoot, 'backend-developer', 'not-a-hash'),
    ).resolves.toBe(false);
    await expect(store.recordWritten(harnessRoot, '', HASH_A)).resolves.toBe(
      false,
    );

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(await pathExists(store.originsPath(harnessRoot))).toBe(false);
  });

  it('a failed write is logged and non-fatal', async () => {
    // A regular file where the `.ptah` directory belongs makes mkdir fail.
    await writeFile(join(harnessRoot, '.ptah'), 'blocker', 'utf8');

    await expect(
      store.recordWritten(harnessRoot, 'backend-developer', HASH_A),
    ).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist'),
      expect.objectContaining({ action: 'record', slug: 'backend-developer' }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("hashes written bytes exactly like the mirror's pendingSourceHash", async () => {
    const agentSourceDir = join(harnessRoot, '.claude', 'agents');
    const agentFile = join(agentSourceDir, 'backend-developer.md');
    const mirror = new UserLayerMirrorService(makeLogger() as never);
    const sources = {
      pluginPaths: [],
      synthesizedSkillsRoot: join(fakeHome, '.ptah', 'skills'),
      agentSourceDir,
    };

    await mkdir(agentSourceDir, { recursive: true });
    await writeFile(agentFile, '# agent v1\n', 'utf8');
    await mirror.mirrorAll(sources);

    // A user edit of the clone makes the next upstream change diverge, which
    // is what records `pendingSourceHash` for the new upstream bytes.
    await writeFile(
      join(mirror.getUserLayerRoots().agents, 'backend-developer.md'),
      '# edited clone\n',
      'utf8',
    );
    const wizardBytes = '---\nname: backend-developer\n---\r\n# agent v2\r\n';
    await writeFile(agentFile, wizardBytes, 'utf8');
    const result = await mirror.reconcile(sources);

    const diverged = result.divergedSlugs.find(
      (entry) => entry.kind === 'agent' && entry.slug === 'backend-developer',
    );
    expect(diverged?.pendingSourceHash).toMatch(/^sha256:/);

    const hash = await store.hashWrittenFile(agentFile);
    await store.recordWritten(harnessRoot, 'backend-developer', hash);

    const origins = await store.read(harnessRoot);
    expect(origins['backend-developer'].hash).toBe(diverged?.pendingSourceHash);
  });
});
