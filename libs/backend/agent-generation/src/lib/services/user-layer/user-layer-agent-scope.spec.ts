import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
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

import { userLayerAgentDirName } from '@ptah-extension/shared';
import { UserLayerMirrorService } from './user-layer-mirror.service';

/**
 * TASK_2026_365 — agent clones are keyed by WORKSPACE.
 *
 * The defect: `~/.ptah/user/agents` was one directory per MACHINE while its
 * source was the per-workspace `{ws}/.claude/agents`. The setup wizard tailors
 * an agent to a project's stack and names it after the ROLE, so two projects
 * write two different `backend-developer.md` — and the flat root gave them one
 * destination. `mirrorAll` is create-if-absent and could not overwrite, but
 * `reconcile`'s fast-forward could and did, on every activation, with the
 * reconciler rewriting `.codex/agents` and `.github/agents` behind it.
 *
 * Measured before the fix: two history snapshots six seconds apart under one
 * slug, one 15784 bytes (an Angular project) and one 17432 (a React one).
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

async function writeAgent(
  workspace: string,
  slug: string,
  body: string,
): Promise<void> {
  const dir = join(workspace, '.claude', 'agents');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.md`), body, 'utf-8');
}

function sourcesFor(workspace: string) {
  return {
    pluginPaths: [],
    agentSourceDir: join(workspace, '.claude', 'agents'),
    workspaceRoot: workspace,
  };
}

describe('user layer — the agent clone is keyed by workspace', () => {
  let workRoot: string;
  let wsA: string;
  let wsB: string;
  let service: UserLayerMirrorService;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-agent-scope-'));
    fakeHome = join(workRoot, 'home');
    wsA = join(workRoot, 'alpha');
    wsB = join(workRoot, 'beta');
    await mkdir(fakeHome, { recursive: true });
    service = new UserLayerMirrorService(makeLogger() as never);
  });

  afterEach(async () => {
    try {
      await rm(workRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best effort — cleanup must never decide the outcome of a test.
    }
  });

  it('puts each workspace’s agents in its own directory', async () => {
    await writeAgent(wsA, 'backend-developer', 'ALPHA BODY');
    await writeAgent(wsB, 'backend-developer', 'BETA BODY');

    await service.mirrorAll(sourcesFor(wsA));
    await service.mirrorAll(sourcesFor(wsB));

    const rootA = service.getUserLayerRoots(wsA).agents;
    const rootB = service.getUserLayerRoots(wsB).agents;
    expect(rootA).not.toBe(rootB);
    expect(await readFile(join(rootA, 'backend-developer.md'), 'utf-8')).toBe(
      'ALPHA BODY',
    );
    expect(await readFile(join(rootB, 'backend-developer.md'), 'utf-8')).toBe(
      'BETA BODY',
    );
  });

  it('does not let a reconcile of one workspace rewrite the other', async () => {
    // This is the churn itself. Before the key, the second reconcile
    // fast-forwarded the shared clone to the other project's body, and the next
    // harness pass copied it into the first project's rival-CLI directories.
    await writeAgent(wsA, 'frontend-developer', 'ALPHA V1');
    await writeAgent(wsB, 'frontend-developer', 'BETA V1');
    await service.mirrorAll(sourcesFor(wsA));
    await service.mirrorAll(sourcesFor(wsB));

    await writeAgent(wsB, 'frontend-developer', 'BETA V2');
    await service.reconcile(sourcesFor(wsB));

    const rootA = service.getUserLayerRoots(wsA).agents;
    const rootB = service.getUserLayerRoots(wsB).agents;
    expect(await readFile(join(rootA, 'frontend-developer.md'), 'utf-8')).toBe(
      'ALPHA V1',
    );
    expect(await readFile(join(rootB, 'frontend-developer.md'), 'utf-8')).toBe(
      'BETA V2',
    );
  });

  it('keeps one workspace’s agent out of another’s listing', async () => {
    await writeAgent(wsA, 'figma-designer', 'ONLY IN ALPHA');
    await service.mirrorAll(sourcesFor(wsA));

    const slugsInB = (await service.listClones(wsB)).map((c) => c.slug);
    expect(slugsInB).not.toContain('figma-designer');
    const slugsInA = (await service.listClones(wsA)).map((c) => c.slug);
    expect(slugsInA).toContain('figma-designer');
  });

  it('places the directory under the base, named by the shared key', async () => {
    // The reconciler derives the same name from the same function. A second
    // spelling on either side is a directory the other never reads.
    await writeAgent(wsA, 'senior-tester', 'BODY');
    await service.mirrorAll(sourcesFor(wsA));

    expect(service.getUserLayerRoots(wsA).agents).toBe(
      join(fakeHome, '.ptah', 'user', 'agents', userLayerAgentDirName(wsA)),
    );
  });

  it('leaves the per-machine skill and command roots flat', async () => {
    expect(service.getUserLayerRoots(wsA).skills).toBe(
      service.getUserLayerRoots(wsB).skills,
    );
    expect(service.getUserLayerRoots(wsA).commands).toBe(
      service.getUserLayerRoots(wsB).commands,
    );
  });
});

describe('user layer — the legacy flat clones are seeded, never reaped', () => {
  let workRoot: string;
  let wsA: string;
  let legacyRoot: string;
  let service: UserLayerMirrorService;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-agent-seed-'));
    fakeHome = join(workRoot, 'home');
    wsA = join(workRoot, 'alpha');
    legacyRoot = join(fakeHome, '.ptah', 'user', 'agents');
    await mkdir(legacyRoot, { recursive: true });
    service = new UserLayerMirrorService(makeLogger() as never);
  });

  afterEach(async () => {
    try {
      await rm(workRoot, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Best effort.
    }
  });

  it('seeds a workspace that has no `.claude/agents` of its own', async () => {
    // Agents are manifest-owned downstream, so an empty desired state DELETES
    // every propagated copy. A workspace with nothing to mirror from must keep
    // exactly what it has today, now private to it.
    await writeFile(join(legacyRoot, 'team-leader.md'), 'LEGACY BODY', 'utf-8');
    await mkdir(join(wsA, '.claude', 'agents'), { recursive: true });

    await service.mirrorAll(sourcesFor(wsA));

    const scoped = service.getUserLayerRoots(wsA).agents;
    expect(await readFile(join(scoped, 'team-leader.md'), 'utf-8')).toBe(
      'LEGACY BODY',
    );
  });

  it('lets the workspace’s own source win over the seed', async () => {
    await writeFile(join(legacyRoot, 'team-leader.md'), 'LEGACY BODY', 'utf-8');
    await writeAgent(wsA, 'team-leader', 'THIS PROJECT');

    await service.mirrorAll(sourcesFor(wsA));
    await service.reconcile(sourcesFor(wsA));

    const scoped = service.getUserLayerRoots(wsA).agents;
    expect(await readFile(join(scoped, 'team-leader.md'), 'utf-8')).toBe(
      'THIS PROJECT',
    );
  });

  it('never deletes the flat originals', async () => {
    // Cleanup of a user's files is not automatic here, on the quarantine
    // precedent.
    await writeFile(join(legacyRoot, 'team-leader.md'), 'LEGACY BODY', 'utf-8');
    await writeAgent(wsA, 'team-leader', 'THIS PROJECT');

    await service.mirrorAll(sourcesFor(wsA));

    expect(await exists(join(legacyRoot, 'team-leader.md'))).toBe(true);
  });

  it('seeds ONCE — a later flat file is not pulled in', async () => {
    await writeFile(join(legacyRoot, 'team-leader.md'), 'LEGACY BODY', 'utf-8');
    await writeAgent(wsA, 'team-leader', 'THIS PROJECT');
    await service.mirrorAll(sourcesFor(wsA));

    await writeFile(
      join(legacyRoot, 'stranger.md'),
      'ANOTHER PROJECT',
      'utf-8',
    );
    await service.mirrorAll(sourcesFor(wsA));

    const scoped = service.getUserLayerRoots(wsA).agents;
    expect(await exists(join(scoped, 'stranger.md'))).toBe(false);
  });

  it('does not copy `.history` into the seed', async () => {
    // That history is the interleaved record of every workspace on the machine.
    // Copying it into one project asserts an edit trail that project never had.
    await writeFile(join(legacyRoot, 'team-leader.md'), 'LEGACY BODY', 'utf-8');
    await mkdir(join(legacyRoot, '.history', 'team-leader', '1'), {
      recursive: true,
    });
    await writeFile(
      join(legacyRoot, '.history', 'team-leader', '1', 'team-leader.md'),
      'SOMEONE ELSE',
      'utf-8',
    );
    await mkdir(join(wsA, '.claude', 'agents'), { recursive: true });

    await service.mirrorAll(sourcesFor(wsA));

    const scoped = service.getUserLayerRoots(wsA).agents;
    expect(await exists(join(scoped, '.history'))).toBe(false);
  });
});
