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

/**
 * `link` and `copyFile` pass through to the real implementation unless a test
 * queues a one-off failure — the only way to prove what a failed restore
 * leaves behind on a real filesystem.
 */
jest.mock('fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    link: jest.fn(actual.link),
    copyFile: jest.fn(actual.copyFile),
  };
});

import { link, copyFile, rename } from 'fs/promises';
import { UserLayerMirrorService } from './user-layer-mirror.service';
import { UserLayerFsOps } from './user-layer-fs-ops';
import { SEED_QUARANTINE_JOURNAL } from './user-layer-seed-quarantine-journal';
import {
  SEED_QUARANTINE_MARKER,
  UserLayerSeedQuarantine,
  classifySeededClone,
  isSafeAgentSlug,
  orderQuarantineSnapshotCandidates,
  readAgentSourceListing,
  validateSeedQuarantineMarker,
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
  /**
   * The detach seam: `null` is the real rename. A test sets it to interleave
   * an editor save with the rename, or to make the rename fail.
   */
  let renameHook: ((from: string, to: string) => Promise<void>) | null;
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
    renameHook = null;
    quarantine = new UserLayerSeedQuarantine(
      logger as never,
      fsOps,
      (from, to) => (renameHook ?? rename)(from, to),
    );
  });

  const ebusy = () =>
    Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });

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

  /** `<ts>` dir names under `.history/<slug>/`, `[]` when there are none. */
  async function historyEntries(slug: string): Promise<string[]> {
    const dir = join(scoped, '.history', slug);
    return (await exists(dir)) ? readdir(dir) : [];
  }

  async function readMarker(): Promise<{
    quarantined: string[];
    keptWithLocalWork: string[];
    keptUnprovable: string[];
  }> {
    return JSON.parse(
      await readFile(join(scoped, SEED_QUARANTINE_MARKER), 'utf-8'),
    );
  }

  async function readJournal(): Promise<{ quarantined: string[] } | null> {
    const path = join(scoped, SEED_QUARANTINE_JOURNAL);
    return (await exists(path))
      ? JSON.parse(await readFile(path, 'utf-8'))
      : null;
  }

  function location() {
    return { scopedAgentsRoot: scoped, agentSourceDir: sourceDir };
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
    renameHook = async (from, to) => {
      if (from === join(scoped, 'figma-designer.md')) throw ebusy();
      await rename(from, to);
    };

    const first = await run();

    expect(first.failed).toEqual(['figma-designer']);
    expect(first.quarantined).toEqual(['video-director']);
    expect(first.markerWritten).toBe(false);
    expect(await exists(join(scoped, 'figma-designer.md'))).toBe(true);
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(false);

    // The failed rename left the clone where it was and no empty <ts> dir.
    expect(await historyEntries('figma-designer')).toEqual([]);

    // Next pass retries and, clean this time, writes the marker.
    renameHook = null;
    const second = await run();

    expect(second.quarantined).toEqual(['figma-designer']);
    expect(second.failed).toEqual([]);
    expect(second.markerWritten).toBe(true);
    expect(await exists(join(scoped, 'figma-designer.md'))).toBe(false);

    // F3: the marker is cumulative, so the first pass's move is still in the
    // record that the Agents tab lists and Restore reads.
    expect((await readMarker()).quarantined.sort()).toEqual([
      'figma-designer',
      'video-director',
    ]);
    const listing = await quarantine.listQuarantined(location());
    expect(listing.quarantined.map((i) => i.slug).sort()).toEqual([
      'figma-designer',
      'video-director',
    ]);
    for (const slug of ['figma-designer', 'video-director']) {
      const restored = await quarantine.restore({
        ...location(),
        slug,
        withSlugLock: lock,
      });
      expect(restored.outcome).toBe('restored');
    }
    expect(await readFile(join(sourceDir, 'video-director.md'), 'utf-8')).toBe(
      'VIDEO',
    );
  });

  it('F2: a save between classification and detach is put back as user work, not quarantined', async () => {
    await leak('video-director', 'VIDEO');
    await writeFile(join(scoped, 'video-director.ptah-origin.json'), 'SIDE');
    const clone = join(scoped, 'video-director.md');
    renameHook = async (from, to) => {
      if (from === clone) await writeFile(clone, 'USER SAVE', 'utf-8');
      await rename(from, to);
    };

    const result = await run();

    expect(result.failed).toEqual(['video-director']);
    expect(result.quarantined).toEqual([]);
    expect(await readFile(clone, 'utf-8')).toBe('USER SAVE');
    expect(
      await readFile(join(scoped, 'video-director.ptah-origin.json'), 'utf-8'),
    ).toBe('SIDE');
    expect(await historyEntries('video-director')).toEqual([]);
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(false);
    expect(await readJournal()).toBeNull();
  });

  it('F2: a changed clone whose path is taken again stays in history with a warning', async () => {
    await leak('video-director', 'VIDEO');
    const clone = join(scoped, 'video-director.md');
    renameHook = async (from, to) => {
      if (from !== clone) return rename(from, to);
      await writeFile(clone, 'FIRST SAVE', 'utf-8');
      await rename(from, to);
      await writeFile(clone, 'SECOND SAVE', 'utf-8');
    };

    const result = await run();

    expect(result.failed).toEqual(['video-director']);
    expect(await readFile(clone, 'utf-8')).toBe('SECOND SAVE');
    const [ts] = await historyEntries('video-director');
    const kept = join(scoped, '.history', 'video-director', ts, 'video-director.md');
    expect(await readFile(kept, 'utf-8')).toBe('FIRST SAVE');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('changed during seed quarantine'),
      expect.objectContaining({ historyFile: kept }),
    );
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(false);
  });

  it('F2: a save after the detach is a new file that survives; the detached seed is recorded', async () => {
    await leak('video-director', 'VIDEO');
    const clone = join(scoped, 'video-director.md');
    renameHook = async (from, to) => {
      await rename(from, to);
      if (from === clone) await writeFile(clone, 'NEW FILE', 'utf-8');
    };

    const result = await run();

    expect(result.quarantined).toEqual(['video-director']);
    expect(await readFile(clone, 'utf-8')).toBe('NEW FILE');
    const [ts] = await historyEntries('video-director');
    expect(
      await readFile(
        join(scoped, '.history', 'video-director', ts, 'video-director.md'),
        'utf-8',
      ),
    ).toBe('VIDEO');
    expect((await readMarker()).quarantined).toEqual(['video-director']);
  });

  it('a failed clone rename (EBUSY) leaves clone and sidecar in place and no <ts> dir', async () => {
    await leak('video-director', 'VIDEO');
    const sidecar = join(scoped, 'video-director.ptah-origin.json');
    await writeFile(sidecar, 'SIDE');
    renameHook = async (from, to) => {
      if (from === join(scoped, 'video-director.md')) throw ebusy();
      await rename(from, to);
    };

    const result = await run();

    expect(result.failed).toEqual(['video-director']);
    expect(await readFile(join(scoped, 'video-director.md'), 'utf-8')).toBe(
      'VIDEO',
    );
    expect(await readFile(sidecar, 'utf-8')).toBe('SIDE');
    expect(await historyEntries('video-director')).toEqual([]);
    expect(result.markerWritten).toBe(false);
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(false);
  });

  it('a failed journal write puts the clone back; the next pass moves and records it', async () => {
    await leak('video-director', 'VIDEO');
    const realWrite = fsOps.writeTextAtomic.bind(fsOps);
    jest
      .spyOn(fsOps, 'writeTextAtomic')
      .mockImplementation(async (target, content) => {
        if (target.endsWith(SEED_QUARANTINE_JOURNAL)) throw ebusy();
        return realWrite(target, content);
      });

    const first = await run();

    expect(first.failed).toEqual(['video-director']);
    expect(first.markerWritten).toBe(false);
    expect(await readFile(join(scoped, 'video-director.md'), 'utf-8')).toBe(
      'VIDEO',
    );
    expect(await historyEntries('video-director')).toEqual([]);
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(false);

    jest.restoreAllMocks();
    const second = await run();

    expect(second.quarantined).toEqual(['video-director']);
    expect(await exists(join(scoped, 'video-director.md'))).toBe(false);
    expect((await readJournal())?.quarantined).toEqual(['video-director']);
    expect((await readMarker()).quarantined).toEqual(['video-director']);
  });

  it('an interrupted pass: the next clean pass writes the journal slugs into the marker', async () => {
    await writeFile(
      join(scoped, SEED_QUARANTINE_JOURNAL),
      JSON.stringify({
        version: 1,
        quarantined: ['figma-designer'],
        keptWithLocalWork: ['old-local'],
        keptUnprovable: [],
      }),
    );
    await leak('video-director', 'VIDEO');

    const result = await run();

    expect(result.quarantined).toEqual(['video-director']);
    expect(await readMarker()).toMatchObject({
      version: 1,
      quarantined: ['figma-designer', 'video-director'],
      keptWithLocalWork: ['old-local'],
      keptUnprovable: [],
    });
  });

  it('two concurrent passes on one scoped root: one moves, the other no-ops, the marker has every move', async () => {
    await leak('video-director', 'VIDEO');
    await leak('figma-designer', 'FIGMA');

    const [a, b] = await Promise.all([run(), run()]);

    const moved = [...a.quarantined, ...b.quarantined].sort();
    expect(moved).toEqual(['figma-designer', 'video-director']);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    expect((await readMarker()).quarantined.sort()).toEqual([
      'figma-designer',
      'video-director',
    ]);
  });

  it('a malformed journal stops the pass: nothing moves, no marker, a warning', async () => {
    await writeFile(join(scoped, SEED_QUARANTINE_JOURNAL), '{not json');
    await leak('video-director', 'VIDEO');

    const result = await run();

    expect(result.ran).toBe(false);
    expect(await readFile(join(scoped, 'video-director.md'), 'utf-8')).toBe(
      'VIDEO',
    );
    expect(await historyEntries('video-director')).toEqual([]);
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      '[UserLayerMirror] seed quarantine journal unreadable; nothing moved',
      expect.objectContaining({ scopedAgentsRoot: scoped }),
    );
  });

  it('a slug moved now leaves the kept lists of the journal', async () => {
    await writeFile(
      join(scoped, SEED_QUARANTINE_JOURNAL),
      JSON.stringify({
        version: 1,
        quarantined: [],
        keptWithLocalWork: ['video-director'],
        keptUnprovable: [],
      }),
    );
    await leak('video-director', 'VIDEO');

    await run();

    expect(await readMarker()).toMatchObject({
      quarantined: ['video-director'],
      keptWithLocalWork: [],
    });
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

describe('validateSeedQuarantineMarker', () => {
  const good = {
    version: 1,
    completedAt: '2026-10-01T10:00:00.000Z',
    quarantined: ['video-director'],
    keptWithLocalWork: ['figma-designer'],
    keptUnprovable: [],
  };

  it('accepts the shape the pass writes', () => {
    const result = validateSeedQuarantineMarker(good);
    expect(result).toEqual({
      status: 'valid',
      marker: {
        ...good,
        completedAtMs: Date.parse(good.completedAt),
      },
      droppedSlugs: [],
    });
  });

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['an array', []],
    ['a wrong version', { ...good, version: 2 }],
    ['a missing completedAt', { ...good, completedAt: undefined }],
    ['an unparseable completedAt', { ...good, completedAt: 'yesterday' }],
    ['a list that is a string', { ...good, quarantined: 'video-director' }],
    ['a list holding a non-string', { ...good, keptUnprovable: [1] }],
    ['a missing list', { ...good, keptWithLocalWork: undefined }],
  ])('rejects %s', (_label, raw) => {
    expect(validateSeedQuarantineMarker(raw).status).toBe('invalid');
  });

  it('drops each unsafe slug on its own and keeps the rest', () => {
    const result = validateSeedQuarantineMarker({
      ...good,
      quarantined: ['video-director', '..', '.', '../etc', 'a/b', 'a\\b', ''],
      keptUnprovable: ['ok-slug', 'x'.repeat(129)],
    });
    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    expect(result.marker.quarantined).toEqual(['video-director']);
    expect(result.marker.keptUnprovable).toEqual(['ok-slug']);
    expect(result.droppedSlugs).toHaveLength(7);
  });

  it('isSafeAgentSlug mirrors the RPC slug rule', () => {
    expect(isSafeAgentSlug('backend-developer')).toBe(true);
    expect(isSafeAgentSlug('a.b_c-1')).toBe(true);
    expect(isSafeAgentSlug('..')).toBe(false);
    expect(isSafeAgentSlug('a..b')).toBe(false);
    expect(isSafeAgentSlug('.hidden')).toBe(false);
    expect(isSafeAgentSlug('-x')).toBe(false);
  });
});

describe('orderQuarantineSnapshotCandidates', () => {
  it('keeps <ms>[-<n>] names not later than completedAt, newest first', () => {
    expect(
      orderQuarantineSnapshotCandidates(
        ['100', '200', '200-1', '200-2', '300', 'junk', '150-x', '50'],
        250,
      ),
    ).toEqual([
      { name: '200-2', ms: 200 },
      { name: '200-1', ms: 200 },
      { name: '200', ms: 200 },
      { name: '100', ms: 100 },
      { name: '50', ms: 50 },
    ]);
  });
});

describe('quarantined agents — list and restore (TASK_2026_609 C2)', () => {
  let workRoot: string;
  let ws: string;
  let otherWs: string;
  let legacyRoot: string;
  let logger: MockLogger;
  let service: UserLayerMirrorService;
  let scoped: string;
  let otherScoped: string;
  let sourceDir: string;
  let dest: string;
  let gateStateFile: string;
  const GATE_STATE = '{"agentSyncEnabled":false}';

  const linkMock = link as unknown as jest.Mock;
  const copyFileMock = copyFile as unknown as jest.Mock;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-quarantine-restore-'));
    fakeHome = join(workRoot, 'home');
    ws = join(workRoot, 'property-hub');
    otherWs = join(workRoot, 'ptah-extension');
    legacyRoot = join(fakeHome, '.ptah', 'user', 'agents');
    await mkdir(legacyRoot, { recursive: true });
    logger = makeLogger();
    service = new UserLayerMirrorService(logger as never);
    scoped = service.getUserLayerRoots(ws).agents;
    otherScoped = service.getUserLayerRoots(otherWs).agents;
    sourceDir = join(ws, '.claude', 'agents');
    dest = join(sourceDir, 'video-director.md');
    // Stand-in for the harness agent-sync gate file: Restore must never
    // write consent, so these bytes must survive every test unchanged.
    gateStateFile = join(ws, '.ptah', 'harness', 'state.json');
    await mkdir(join(ws, '.ptah', 'harness'), { recursive: true });
    await writeFile(gateStateFile, GATE_STATE, 'utf-8');
  });

  afterEach(async () => {
    linkMock.mockClear();
    copyFileMock.mockClear();
    try {
      await rm(workRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best effort.
    }
  });

  function sources() {
    return { pluginPaths: [], agentSourceDir: sourceDir, workspaceRoot: ws };
  }

  /** Run the real pass: `video-director` quarantined, `figma-designer` kept. */
  async function quarantineForeignAgents(): Promise<void> {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'team-leader.md'), 'OWN', 'utf-8');
    await mkdir(scoped, { recursive: true });
    await writeFile(join(legacyRoot, 'video-director.md'), 'VIDEO', 'utf-8');
    await writeFile(join(scoped, 'video-director.md'), 'VIDEO', 'utf-8');
    await writeFile(join(legacyRoot, 'figma-designer.md'), 'SEED', 'utf-8');
    await writeFile(join(scoped, 'figma-designer.md'), 'EDITED', 'utf-8');
    await service.mirrorAll(sources());
    expect(await exists(join(scoped, SEED_QUARANTINE_MARKER))).toBe(true);
    expect(await exists(join(scoped, 'video-director.md'))).toBe(false);
  }

  async function writeMarker(content: unknown): Promise<void> {
    await mkdir(scoped, { recursive: true });
    await writeFile(
      join(scoped, SEED_QUARANTINE_MARKER),
      typeof content === 'string' ? content : JSON.stringify(content),
      'utf-8',
    );
  }

  async function markerCompletedAtMs(): Promise<number> {
    const raw = JSON.parse(
      await readFile(join(scoped, SEED_QUARANTINE_MARKER), 'utf-8'),
    ) as { completedAt: string };
    return Date.parse(raw.completedAt);
  }

  /** Every file under `dir` with its bytes, for byte-unchanged assertions. */
  async function tree(dir: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    async function walk(current: string): Promise<void> {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          out[full.slice(dir.length)] = await readFile(full, 'utf-8');
        }
      }
    }
    if (await exists(dir)) await walk(dir);
    return out;
  }

  async function sourceDirLeftovers(): Promise<string[]> {
    if (!(await exists(sourceDir))) return [];
    return (await readdir(sourceDir)).filter((n) => n.includes('ptah-restore'));
  }

  it('lists nothing, readably, when there is no marker', async () => {
    expect(await service.listQuarantinedAgents(ws)).toEqual({
      recordUnreadable: false,
      quarantined: [],
      notOwned: [],
    });
  });

  it.each([
    ['unparseable JSON', '{not json'],
    [
      'a list that is a string',
      {
        version: 1,
        completedAt: '2026-10-01T10:00:00.000Z',
        quarantined: 'video-director',
        keptWithLocalWork: [],
        keptUnprovable: [],
      },
    ],
    [
      'a bad completedAt',
      {
        version: 1,
        completedAt: 'not a date',
        quarantined: ['video-director'],
        keptWithLocalWork: [],
        keptUnprovable: [],
      },
    ],
  ])(
    'treats a marker with %s as absent, flags it, and writes nothing',
    async (_label, content) => {
      await writeMarker(content);
      const scopedBefore = await tree(scoped);

      const listing = await service.listQuarantinedAgents(ws);
      const restore = await service.restoreQuarantinedAgent(
        ws,
        'video-director',
      );

      expect(listing).toEqual({
        recordUnreadable: true,
        quarantined: [],
        notOwned: [],
      });
      expect(restore.outcome).toBe('not-quarantined');
      expect(await exists(dest)).toBe(false);
      expect(await tree(scoped)).toEqual(scopedBefore);
      expect(logger.warn).toHaveBeenCalled();
    },
  );

  it('lists a quarantined agent with its snapshot date, and kept clones as notOwned', async () => {
    await quarantineForeignAgents();
    const [snapshotTs] = await readdir(
      join(scoped, '.history', 'video-director'),
    );

    const listing = await service.listQuarantinedAgents(ws);

    expect(listing).toEqual({
      recordUnreadable: false,
      quarantined: [
        {
          slug: 'video-director',
          state: 'quarantined',
          quarantinedAt: new Date(Number(snapshotTs)).toISOString(),
          hasSnapshot: true,
          sourcePath: dest,
        },
      ],
      notOwned: ['figma-designer'],
    });
  });

  it('drops an unsafe marker slug with a warning and never reaches the filesystem with it', async () => {
    await writeMarker({
      version: 1,
      completedAt: new Date().toISOString(),
      quarantined: ['../../evil', 'video-director'],
      keptWithLocalWork: [],
      keptUnprovable: [],
    });

    const listing = await service.listQuarantinedAgents(ws);
    const restore = await service.restoreQuarantinedAgent(ws, '../../evil');

    expect(listing.quarantined.map((i) => i.slug)).toEqual(['video-director']);
    expect(logger.warn).toHaveBeenCalledWith(
      '[UserLayerMirror] seed quarantine marker: unsafe slugs dropped',
      expect.objectContaining({ droppedSlugs: [JSON.stringify('../../evil')] }),
    );
    expect(restore).toEqual({
      outcome: 'not-quarantined',
      path: sourceDir,
      reason: 'invalid agent slug',
    });
    expect(await exists(join(ws, 'evil.md'))).toBe(false);
    expect(await exists(join(workRoot, 'evil.md'))).toBe(false);
  });

  it('with no history: hasSnapshot false, date null, and Restore writes nothing', async () => {
    await writeMarker({
      version: 1,
      completedAt: new Date().toISOString(),
      quarantined: ['video-director'],
      keptWithLocalWork: [],
      keptUnprovable: [],
    });

    const [item] = (await service.listQuarantinedAgents(ws)).quarantined;
    const restore = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(item).toMatchObject({ hasSnapshot: false, quarantinedAt: null });
    expect(restore.outcome).toBe('no-snapshot');
    expect(await exists(sourceDir)).toBe(false);
  });

  it('never treats a history dir later than completedAt as the quarantine snapshot', async () => {
    await quarantineForeignAgents();
    const later = join(
      scoped,
      '.history',
      'video-director',
      String((await markerCompletedAtMs()) + 60_000),
    );
    await mkdir(later, { recursive: true });
    await writeFile(join(later, 'video-director.md'), 'LATER EDIT', 'utf-8');

    const restore = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(restore.outcome).toBe('restored');
    expect(await readFile(dest, 'utf-8')).toBe('VIDEO');
  });

  it('a slug whose only history is later than completedAt has no snapshot', async () => {
    const completedAt = new Date(Date.now() - 60_000);
    await writeMarker({
      version: 1,
      completedAt: completedAt.toISOString(),
      quarantined: ['video-director'],
      keptWithLocalWork: [],
      keptUnprovable: [],
    });
    const later = join(
      scoped,
      '.history',
      'video-director',
      String(Date.now()),
    );
    await mkdir(later, { recursive: true });
    await writeFile(join(later, 'video-director.md'), 'LATER', 'utf-8');

    const [item] = (await service.listQuarantinedAgents(ws)).quarantined;
    expect(item.hasSnapshot).toBe(false);
    expect(
      (await service.restoreQuarantinedAgent(ws, 'video-director')).outcome,
    ).toBe('no-snapshot');
    expect(await exists(dest)).toBe(false);
  });

  it('restores the snapshot as the workspace source, touching nothing else', async () => {
    await quarantineForeignAgents();
    await mkdir(otherScoped, { recursive: true });
    await writeFile(join(otherScoped, 'video-director.md'), 'OTHER', 'utf-8');
    const historyBefore = await tree(join(scoped, '.history'));
    const flatBefore = await tree(legacyRoot);
    const otherBefore = await tree(otherScoped);
    const wsBefore = await tree(ws);

    const result = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(result).toEqual({ outcome: 'restored', path: dest });
    expect(await readFile(dest, 'utf-8')).toBe('VIDEO');
    // History kept, flat base and another workspace's scoped root unchanged.
    expect(await tree(join(scoped, '.history'))).toEqual(historyBefore);
    expect(await tree(legacyRoot)).toEqual(flatBefore);
    expect(await tree(otherScoped)).toEqual(otherBefore);
    // The only change in the workspace is the restored source file; the gate
    // state (consent) is byte-unchanged and no temp file is left.
    const wsAfter = await tree(ws);
    expect(wsAfter).toEqual({
      ...wsBefore,
      [dest.slice(ws.length)]: 'VIDEO',
    });
    expect(await readFile(gateStateFile, 'utf-8')).toBe(GATE_STATE);
    expect(await sourceDirLeftovers()).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      '[UserLayerMirror] quarantined agent restore',
      expect.objectContaining({ slug: 'video-director', outcome: 'restored' }),
    );
  });

  it('stays listed as source-restored until propagation re-creates the clone, then leaves the list', async () => {
    await quarantineForeignAgents();
    await service.restoreQuarantinedAgent(ws, 'video-director');

    // Gate off / reconcile failed: nothing has mirrored the source yet.
    const pending = await service.listQuarantinedAgents(ws);
    expect(pending.quarantined).toEqual([
      expect.objectContaining({
        slug: 'video-director',
        state: 'source-restored',
      }),
    ]);

    // A successful mirror pass (the propagation step) re-creates the clone.
    await service.mirrorAll(sources());
    expect(await readFile(join(scoped, 'video-director.md'), 'utf-8')).toBe(
      'VIDEO',
    );
    expect((await service.listQuarantinedAgents(ws)).quarantined).toEqual([]);
  });

  it('a retry with identical bytes is already-restored and writes nothing', async () => {
    await quarantineForeignAgents();
    await service.restoreQuarantinedAgent(ws, 'video-director');
    linkMock.mockClear();

    const retry = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(retry).toEqual({ outcome: 'already-restored', path: dest });
    expect(linkMock).not.toHaveBeenCalled();
    expect(await readFile(dest, 'utf-8')).toBe('VIDEO');
  });

  it('two concurrent restores serialise on the slug lock: one restores, one is already-restored', async () => {
    await quarantineForeignAgents();

    const outcomes = (
      await Promise.all([
        service.restoreQuarantinedAgent(ws, 'video-director'),
        service.restoreQuarantinedAgent(ws, 'video-director'),
      ])
    ).map((r) => r.outcome);

    expect(outcomes.sort()).toEqual(['already-restored', 'restored']);
  });

  it('refuses when the source holds different bytes, leaving both files unchanged', async () => {
    await quarantineForeignAgents();
    await writeFile(dest, 'MY OWN VIDEO DIRECTOR', 'utf-8');
    const historyBefore = await tree(join(scoped, '.history'));

    const result = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(result.outcome).toBe('conflict');
    expect(result.path).toBe(dest);
    expect(await readFile(dest, 'utf-8')).toBe('MY OWN VIDEO DIRECTOR');
    expect(await tree(join(scoped, '.history'))).toEqual(historyBefore);
  });

  it('refuses when a scoped clone already exists, leaving both files unchanged', async () => {
    await quarantineForeignAgents();
    const clone = join(scoped, 'video-director.md');
    await writeFile(clone, 'A CLONE', 'utf-8');

    const result = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(result).toMatchObject({ outcome: 'conflict', path: clone });
    expect(await readFile(clone, 'utf-8')).toBe('A CLONE');
    expect(await exists(dest)).toBe(false);
  });

  it('a failed link leaves no dest and no temp, and the next Restore succeeds', async () => {
    await quarantineForeignAgents();
    linkMock.mockRejectedValueOnce(
      Object.assign(new Error('EIO: i/o error, link'), { code: 'EIO' }),
    );

    const failed = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(failed.outcome).toBe('copy-failed');
    expect(failed.reason).toContain('EIO');
    expect(await exists(dest)).toBe(false);
    expect(await sourceDirLeftovers()).toEqual([]);

    const retry = await service.restoreQuarantinedAgent(ws, 'video-director');
    expect(retry.outcome).toBe('restored');
    expect(await readFile(dest, 'utf-8')).toBe('VIDEO');
  });

  it('falls back to an exclusive copy when the filesystem refuses hard links', async () => {
    await quarantineForeignAgents();
    linkMock.mockRejectedValueOnce(
      Object.assign(new Error('EPERM: operation not permitted, link'), {
        code: 'EPERM',
      }),
    );

    const result = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(result.outcome).toBe('restored');
    expect(copyFileMock).toHaveBeenCalledTimes(1);
    expect(await readFile(dest, 'utf-8')).toBe('VIDEO');
    expect(await sourceDirLeftovers()).toEqual([]);
  });

  it('a fallback copy that fails verification is removed, and the retry succeeds', async () => {
    await quarantineForeignAgents();
    linkMock.mockRejectedValueOnce(
      Object.assign(new Error('EXDEV'), { code: 'EXDEV' }),
    );
    copyFileMock.mockImplementationOnce(async (_src: string, to: string) => {
      await writeFile(to, 'TRUNCAT', { flag: 'wx' });
    });

    const failed = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(failed.outcome).toBe('copy-failed');
    expect(await exists(dest)).toBe(false);
    expect(await sourceDirLeftovers()).toEqual([]);

    const retry = await service.restoreQuarantinedAgent(ws, 'video-director');
    expect(retry.outcome).toBe('restored');
    expect(await readFile(dest, 'utf-8')).toBe('VIDEO');
  });

  it('a file that appears at dest during the restore is never replaced', async () => {
    await quarantineForeignAgents();
    linkMock.mockImplementationOnce(async (_tmp: string, to: string) => {
      await writeFile(to, 'USER WROTE THIS', 'utf-8');
      throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    });

    const result = await service.restoreQuarantinedAgent(ws, 'video-director');

    expect(result.outcome).toBe('conflict');
    expect(await readFile(dest, 'utf-8')).toBe('USER WROTE THIS');
    expect(await sourceDirLeftovers()).toEqual([]);
  });

  it('refuses a slug that is not in the quarantine record', async () => {
    await quarantineForeignAgents();

    const kept = await service.restoreQuarantinedAgent(ws, 'figma-designer');
    const unknown = await service.restoreQuarantinedAgent(ws, 'nobody');

    expect(kept.outcome).toBe('not-quarantined');
    expect(unknown.outcome).toBe('not-quarantined');
    expect(await exists(join(sourceDir, 'figma-designer.md'))).toBe(false);
    expect(await exists(join(sourceDir, 'nobody.md'))).toBe(false);
  });

  it('refuses a relative workspace root rather than resolving it against cwd', async () => {
    await expect(
      service.restoreQuarantinedAgent('relative/ws', 'video-director'),
    ).rejects.toThrow('absolute workspace root');
    await expect(service.listQuarantinedAgents('')).rejects.toThrow(
      'absolute workspace root',
    );
  });
});
