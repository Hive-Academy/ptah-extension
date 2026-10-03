import 'reflect-metadata';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
  chmod,
} from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let fakeHome: string;

/**
 * `homedir()` is redirected into the per-test temp root so nothing here can
 * resolve a path against the developer's real `~/.ptah/user`. See
 * `user-layer-harness-mirror.spec.ts` for why that is not optional.
 */
jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: () => fakeHome,
}));

import { UserLayerMirrorService } from './user-layer-mirror.service';
import { UserLayerFsOps } from './user-layer-fs-ops';
import {
  SEED_QUARANTINE_MARKER,
  UserLayerSeedQuarantine,
  classifySeededClone,
  readAgentSourceListing,
} from './user-layer-seed-quarantine';
import type { AgentSlugLock } from './user-layer-seed-quarantine';

/**
 * TASK_2026_609 — one-time quarantine of the foreign clones the TASK_2026_365
 * seed copied into every newly scoped workspace.
 *
 * Measured on the reporting machine: `video-director` and `visual-reviewer`
 * (ptah-extension only) sat in ALL four scoped agent dirs, and `figma-designer`
 * in property-hub's. The orphan reaper had not removed them, because it trusts
 * the origin sidecar and these clones either have none or carry local-work
 * state copied from the flat base. The quarantine trusts bytes instead.
 */

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

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function sidecarJson(
  slug: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    kind: 'agent',
    slug,
    pluginId: null,
    version: null,
    sourceHash: 'sha256:flat',
    clonedAt: 1,
    diverged: false,
    lastEnhancedAt: null,
    historyDir: '.history',
    currentContentHash: 'sha256:flat',
    ...extra,
  });
}

describe('classifySeededClone', () => {
  const owned = new Set(['team-leader']);
  const bytes = Buffer.from('BODY');

  it('leaves a slug the workspace owns alone', () => {
    expect(
      classifySeededClone({
        slug: 'team-leader',
        ownedSlugs: owned,
        cloneBytes: bytes,
        flatBytes: bytes,
      }),
    ).toBe('owned');
  });

  it('quarantines a foreign clone byte-identical to its flat file', () => {
    expect(
      classifySeededClone({
        slug: 'video-director',
        ownedSlugs: owned,
        cloneBytes: Buffer.from('SAME'),
        flatBytes: Buffer.from('SAME'),
      }),
    ).toBe('quarantine');
  });

  it('keeps a foreign clone that changed since the seed', () => {
    expect(
      classifySeededClone({
        slug: 'video-director',
        ownedSlugs: owned,
        cloneBytes: Buffer.from('EDITED HERE'),
        flatBytes: Buffer.from('SEED'),
      }),
    ).toBe('kept-local-work');
  });

  it('keeps a foreign clone whose flat file is gone — origin unprovable', () => {
    expect(
      classifySeededClone({
        slug: 'video-director',
        ownedSlugs: owned,
        cloneBytes: bytes,
        flatBytes: null,
      }),
    ).toBe('kept-unprovable');
  });

  it('compares bytes, not normalised text (CRLF vs LF is local work)', () => {
    expect(
      classifySeededClone({
        slug: 'x',
        ownedSlugs: owned,
        cloneBytes: Buffer.from('a\r\nb'),
        flatBytes: Buffer.from('a\nb'),
      }),
    ).toBe('kept-local-work');
  });
});

describe('user layer — one-time quarantine of foreign seeded agent clones', () => {
  let workRoot: string;
  let ws: string;
  let legacyRoot: string;
  let logger: MockLogger;
  let service: UserLayerMirrorService;
  let scoped: string;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-seed-quarantine-'));
    fakeHome = join(workRoot, 'home');
    ws = join(workRoot, 'property-hub');
    legacyRoot = join(fakeHome, '.ptah', 'user', 'agents');
    await mkdir(legacyRoot, { recursive: true });
    logger = makeLogger();
    service = new UserLayerMirrorService(logger as never);
    scoped = service.getUserLayerRoots(ws).agents;
  });

  afterEach(async () => {
    try {
      await rm(workRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best effort — cleanup must never decide the outcome of a test.
    }
  });

  function sources() {
    return {
      pluginPaths: [],
      agentSourceDir: join(ws, '.claude', 'agents'),
      workspaceRoot: ws,
    };
  }

  async function writeSource(slug: string, body: string): Promise<void> {
    const dir = join(ws, '.claude', 'agents');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${slug}.md`), body, 'utf-8');
  }

  /** What the pre-609 seed left: a flat file and its byte-identical scoped copy. */
  async function leakedClone(
    slug: string,
    body: string,
    sidecar: string | null,
  ): Promise<void> {
    await mkdir(scoped, { recursive: true });
    await writeFile(join(legacyRoot, `${slug}.md`), body, 'utf-8');
    await writeFile(join(scoped, `${slug}.md`), body, 'utf-8');
    if (sidecar !== null) {
      await writeFile(join(legacyRoot, `${slug}.ptah-origin.json`), sidecar);
      await writeFile(join(scoped, `${slug}.ptah-origin.json`), sidecar);
    }
  }

  async function historySnapshots(slug: string): Promise<string[]> {
    const dir = join(scoped, '.history', slug);
    if (!(await exists(dir))) return [];
    return (await readdir(dir)).map((ts) => join(dir, ts));
  }

  it('moves a byte-identical foreign clone and its sidecar into .history/<slug>/<ts>/', async () => {
    await writeSource('team-leader', 'OWN TEAM LEADER');
    await leakedClone(
      'video-director',
      'PTAH VIDEO DIRECTOR',
      sidecarJson('video-director'),
    );

    await service.mirrorAll(sources());

    expect(await exists(join(scoped, 'video-director.md'))).toBe(false);
    expect(await exists(join(scoped, 'video-director.ptah-origin.json'))).toBe(
      false,
    );
    const [snapshot, ...rest] = await historySnapshots('video-director');
    expect(rest).toEqual([]);
    expect(await readFile(join(snapshot, 'video-director.md'), 'utf-8')).toBe(
      'PTAH VIDEO DIRECTOR',
    );
    expect(
      await readFile(
        join(snapshot, 'video-director.ptah-origin.json'),
        'utf-8',
      ),
    ).toBe(sidecarJson('video-director'));
    // The flat base is never touched.
    expect(await readFile(join(legacyRoot, 'video-director.md'), 'utf-8')).toBe(
      'PTAH VIDEO DIRECTOR',
    );
    expect(
      await exists(join(legacyRoot, 'video-director.ptah-origin.json')),
    ).toBe(true);
    // The workspace's own agent is mirrored as usual.
    expect(await readFile(join(scoped, 'team-leader.md'), 'utf-8')).toBe(
      'OWN TEAM LEADER',
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[UserLayerMirror] seed quarantine pass',
      expect.objectContaining({
        quarantined: 1,
        quarantinedSlugs: ['video-director'],
        markerWritten: true,
      }),
    );
  });

  it('quarantines a sidecar-less clone — the case the orphan reaper never touches', async () => {
    await writeSource('team-leader', 'OWN');
    await leakedClone('figma-designer', 'FIGMA', null);

    await service.mirrorAll(sources());

    expect(await exists(join(scoped, 'figma-designer.md'))).toBe(false);
    const [snapshot] = await historySnapshots('figma-designer');
    expect(await readFile(join(snapshot, 'figma-designer.md'), 'utf-8')).toBe(
      'FIGMA',
    );
  });

  it('quarantines a byte-identical clone whose copied sidecar says diverged/orphaned', async () => {
    // The reaper reads that state as "local work" and keeps the clone. Equal
    // bytes prove the work, if any, lives in the flat original, which stays.
    await writeSource('team-leader', 'OWN');
    await leakedClone(
      'visual-reviewer',
      'REVIEWER',
      sidecarJson('visual-reviewer', { diverged: true, orphaned: true }),
    );

    await service.mirrorAll(sources());

    expect(await exists(join(scoped, 'visual-reviewer.md'))).toBe(false);
    expect(await historySnapshots('visual-reviewer')).toHaveLength(1);
  });

  it('keeps a foreign clone with local work and reports it', async () => {
    await writeSource('team-leader', 'OWN');
    await leakedClone(
      'video-director',
      'SEEDED',
      sidecarJson('video-director'),
    );
    await writeFile(
      join(scoped, 'video-director.md'),
      'EDITED IN THIS WORKSPACE',
      'utf-8',
    );

    await service.mirrorAll(sources());

    expect(await readFile(join(scoped, 'video-director.md'), 'utf-8')).toBe(
      'EDITED IN THIS WORKSPACE',
    );
    expect(await exists(join(scoped, 'video-director.ptah-origin.json'))).toBe(
      true,
    );
    expect(await historySnapshots('video-director')).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      '[UserLayerMirror] seed quarantine pass',
      expect.objectContaining({
        keptWithLocalWork: 1,
        keptWithLocalWorkSlugs: ['video-director'],
      }),
    );
  });

  it('keeps a foreign clone whose flat file is gone', async () => {
    await writeSource('team-leader', 'OWN');
    await leakedClone('video-director', 'SEEDED', null);
    await rm(join(legacyRoot, 'video-director.md'));

    await service.mirrorAll(sources());

    expect(await exists(join(scoped, 'video-director.md'))).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      '[UserLayerMirror] seed quarantine pass',
      expect.objectContaining({
        keptUnprovable: 1,
        keptUnprovableSlugs: ['video-director'],
      }),
    );
  });

  it('never quarantines a slug the workspace owns, even when identical to the flat file', async () => {
    await writeSource('video-director', 'SAME');
    await leakedClone('video-director', 'SAME', sidecarJson('video-director'));

    await service.mirrorAll(sources());

    expect(await readFile(join(scoped, 'video-director.md'), 'utf-8')).toBe(
      'SAME',
    );
    expect(await historySnapshots('video-director')).toEqual([]);
  });

  it('does not run when the source directory is ABSENT — unknown is not gone', async () => {
    await leakedClone('video-director', 'SEEDED', null);

    await service.mirrorAll(sources());

    expect(await exists(join(scoped, 'video-director.md'))).toBe(true);
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(false);
  });

  it('runs when the source directory is EMPTY — the workspace owns no agents', async () => {
    await mkdir(join(ws, '.claude', 'agents'), { recursive: true });
    await leakedClone('video-director', 'SEEDED', null);

    await service.mirrorAll(sources());

    expect(await exists(join(scoped, 'video-director.md'))).toBe(false);
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(true);
  });

  it('runs once: after a clean pass the marker turns every later pass into a no-op', async () => {
    await writeSource('team-leader', 'OWN');
    await leakedClone('video-director', 'SEEDED', null);
    await service.mirrorAll(sources());
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(true);

    // A clone that would qualify, arriving after the marker.
    await leakedClone('figma-designer', 'LATE', null);
    logger.info.mockClear();
    await service.mirrorAll(sources());

    expect(await exists(join(scoped, 'figma-designer.md'))).toBe(true);
    expect(logger.info).not.toHaveBeenCalledWith(
      '[UserLayerMirror] seed quarantine pass',
      expect.anything(),
    );
  });

  it('the marker is not a clone: it is dot-prefixed and not markdown', async () => {
    await writeSource('team-leader', 'OWN');
    await service.mirrorAll(sources());

    expect(SEED_QUARANTINE_MARKER.startsWith('.')).toBe(true);
    expect(SEED_QUARANTINE_MARKER.endsWith('.md')).toBe(false);
    const slugs = (await service.listClones(ws)).map((c) => c.slug);
    expect(slugs).toEqual(['team-leader']);
  });

  it('does nothing without a workspace root', async () => {
    await writeFile(join(legacyRoot, 'video-director.md'), 'FLAT', 'utf-8');
    await writeSource('team-leader', 'OWN');

    await service.mirrorAll({
      pluginPaths: [],
      agentSourceDir: join(ws, '.claude', 'agents'),
    });

    // The unscoped root IS the flat base; nothing in it may move.
    expect(await readFile(join(legacyRoot, 'video-director.md'), 'utf-8')).toBe(
      'FLAT',
    );
    expect(await exists(join(legacyRoot, '.history'))).toBe(false);
    expect(await exists(join(legacyRoot, SEED_QUARANTINE_MARKER))).toBe(false);
  });
});

describe('UserLayerSeedQuarantine — failure and locking', () => {
  let workRoot: string;
  let legacyRoot: string;
  let scoped: string;
  let sourceDir: string;
  let logger: MockLogger;
  let fsOps: UserLayerFsOps;
  let quarantine: UserLayerSeedQuarantine;
  const lock: AgentSlugLock = (_slug, fn) => fn();

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-seed-quarantine-unit-'));
    fakeHome = join(workRoot, 'home');
    legacyRoot = join(fakeHome, '.ptah', 'user', 'agents');
    scoped = join(legacyRoot, 'ws-abc123');
    sourceDir = join(workRoot, 'ws', '.claude', 'agents');
    await mkdir(scoped, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    logger = makeLogger();
    fsOps = new UserLayerFsOps(logger as never);
    quarantine = new UserLayerSeedQuarantine(logger as never, fsOps);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    try {
      await rm(workRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best effort.
    }
  });

  async function leak(slug: string, body: string): Promise<void> {
    await writeFile(join(legacyRoot, `${slug}.md`), body, 'utf-8');
    await writeFile(join(scoped, `${slug}.md`), body, 'utf-8');
  }

  async function run(withSlugLock: AgentSlugLock = lock) {
    return quarantine.run({
      workspaceRoot: join(workRoot, 'ws'),
      scopedAgentsRoot: scoped,
      legacyAgentsRoot: legacyRoot,
      source: await readAgentSourceListing(sourceDir, fsOps),
      withSlugLock,
    });
  }

  it('a failed move (Windows EBUSY) keeps that clone, lets the others proceed, and withholds the marker', async () => {
    await leak('figma-designer', 'FIGMA');
    await leak('video-director', 'VIDEO');
    const realSnapshot = fsOps.snapshotFileToHistory.bind(fsOps);
    jest
      .spyOn(fsOps, 'snapshotFileToHistory')
      .mockImplementation(async (rootDir, slug, cloneFile) => {
        if (slug === 'figma-designer') {
          throw Object.assign(new Error('EBUSY: resource busy'), {
            code: 'EBUSY',
          });
        }
        return realSnapshot(rootDir, slug, cloneFile);
      });

    const first = await run();

    expect(first.failed).toEqual(['figma-designer']);
    expect(first.quarantined).toEqual(['video-director']);
    expect(first.markerWritten).toBe(false);
    expect(await exists(join(scoped, 'figma-designer.md'))).toBe(true);
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(false);

    // Next pass retries and, clean this time, writes the marker.
    jest.restoreAllMocks();
    const second = await run();

    expect(second.quarantined).toEqual(['figma-designer']);
    expect(second.failed).toEqual([]);
    expect(second.markerWritten).toBe(true);
    expect(await exists(join(scoped, 'figma-designer.md'))).toBe(false);
  });

  it('does not remove the clone when the snapshot does not hold its bytes', async () => {
    await leak('video-director', 'VIDEO');
    jest
      .spyOn(fsOps, 'snapshotFileToHistory')
      .mockImplementation(async (rootDir, slug) => {
        // A snapshot dir that exists but is empty: the copy "succeeded" and
        // proved nothing.
        return fsOps.makeUniqueHistoryDir(
          join(rootDir, '.history', slug),
          String(Date.now()),
        );
      });

    const result = await run();

    expect(result.failed).toEqual(['video-director']);
    expect(await readFile(join(scoped, 'video-director.md'), 'utf-8')).toBe(
      'VIDEO',
    );
  });

  it('takes the slug lock once per foreign slug and never for an owned one', async () => {
    await writeFile(join(sourceDir, 'team-leader.md'), 'OWN', 'utf-8');
    await writeFile(join(scoped, 'team-leader.md'), 'OWN', 'utf-8');
    await leak('video-director', 'VIDEO');
    const lockSpy = jest.fn(lock) as unknown as AgentSlugLock;

    await run(lockSpy);

    expect(lockSpy).toHaveBeenCalledTimes(1);
    expect(lockSpy).toHaveBeenCalledWith(
      'video-director',
      expect.any(Function),
    );
  });

  it('skips silently when the scoped root does not exist yet, and writes no marker', async () => {
    await rm(scoped, { recursive: true, force: true });

    const result = await run();

    expect(result.ran).toBe(false);
    expect(await exists(scoped)).toBe(false);
  });

  it('refuses to run against the flat base itself', async () => {
    await leak('video-director', 'VIDEO');

    const result = await quarantine.run({
      workspaceRoot: join(workRoot, 'ws'),
      scopedAgentsRoot: legacyRoot,
      legacyAgentsRoot: legacyRoot,
      source: await readAgentSourceListing(sourceDir, fsOps),
      withSlugLock: lock,
    });

    expect(result.ran).toBe(false);
    expect(await exists(join(legacyRoot, 'video-director.md'))).toBe(true);
  });

  it('reports an empty source as ok, a missing one as absent', async () => {
    expect(await readAgentSourceListing(sourceDir, fsOps)).toEqual({
      status: 'ok',
      dir: sourceDir,
      slugs: new Set(),
    });
    const missing = join(workRoot, 'nope');
    expect(await readAgentSourceListing(missing, fsOps)).toEqual({
      status: 'absent',
      dir: missing,
    });
  });

  // POSIX permissions only: Windows ignores the mode bits chmod sets here, and
  // root reads a 000 directory anyway.
  const posixOnly =
    process.platform === 'win32' || process.getuid?.() === 0 ? it.skip : it;
  posixOnly(
    'does not run when the source directory is unreadable',
    async () => {
      await leak('video-director', 'VIDEO');
      await chmod(sourceDir, 0o000);
      try {
        const listing = await readAgentSourceListing(sourceDir, fsOps);
        expect(listing.status).toBe('unreadable');
        const result = await quarantine.run({
          workspaceRoot: join(workRoot, 'ws'),
          scopedAgentsRoot: scoped,
          legacyAgentsRoot: legacyRoot,
          source: listing,
          withSlugLock: lock,
        });
        expect(result.ran).toBe(false);
        expect(await exists(join(scoped, 'video-director.md'))).toBe(true);
      } finally {
        await chmod(sourceDir, 0o755);
      }
    },
  );
});
