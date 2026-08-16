import 'reflect-metadata';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let fakeHome: string;

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return {
    ...actual,
    homedir: () => fakeHome,
  };
});

import { UserLayerMirrorService } from './user-layer-mirror.service';
import { ORIGIN_SIDECAR_FILENAME } from './origin-sidecar.types';
import type { OriginSidecar } from './origin-sidecar.types';

/**
 * TASK_2026_261 — the activation-sequence contract.
 *
 * The engine (`reconcile()`) is covered by `user-layer-reconcile.spec.ts`. What
 * this file pins is the *sequence* both hosts run in their activation window
 * (`apps/ptah-electron/src/activation/plugin-activation.ts` and
 * `apps/ptah-extension-vscode/src/activation/plugin-activation.ts`):
 *
 *     mirrorAll()                      // create-if-absent, every activation
 *     -> ensureContent()               // may rewrite ~/.ptah/plugins/**
 *     -> mirrorAll()                   // pick up newly-added slugs
 *     -> reconcile()                   // gated on !result.fromCache
 *
 * The reported defect was that the last step had no production caller, leaving
 * every already-mirrored clone frozen at its first mirror. These tests assert
 * both halves of that claim: that `mirrorAll` alone genuinely does NOT refresh
 * a clone (so the reconcile call is load-bearing, not decorative), and that
 * running the full sequence delivers the update for all three clone kinds.
 *
 * If someone deletes the `reconcile()` call from either host's activation glue,
 * the "mirror alone" tests below still pass and the "full sequence" tests are
 * the ones that describe what was lost.
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

describe('user-layer activation sequence (TASK_2026_261)', () => {
  let workRoot: string;
  let pluginRoot: string;
  let pluginPath: string;
  let synthRoot: string;
  let agentSourceDir: string;
  let service: UserLayerMirrorService;
  let logger: MockLogger;

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'ptah-act-seq-'));
    fakeHome = join(workRoot, 'home');
    pluginRoot = join(workRoot, 'plugins');
    pluginPath = join(pluginRoot, 'ptah-core');
    synthRoot = join(fakeHome, '.ptah', 'skills');
    agentSourceDir = join(workRoot, 'workspace', '.claude', 'agents');
    await mkdir(fakeHome, { recursive: true });
    logger = makeLogger();
    service = new UserLayerMirrorService(logger as never);
  });

  afterEach(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  /** Seed one skill dir, one command file and one workspace agent file. */
  async function seedUpstream(version: string): Promise<void> {
    const skillDir = join(pluginPath, 'skills', 'deep-research');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `# skill ${version}`, 'utf8');

    const commandsDir = join(pluginPath, 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(
      join(commandsDir, 'review.md'),
      `# command ${version}`,
      'utf8',
    );

    await mkdir(agentSourceDir, { recursive: true });
    await writeFile(
      join(agentSourceDir, 'backend-developer.md'),
      `# agent ${version}`,
      'utf8',
    );
  }

  function sources() {
    return {
      pluginPaths: [pluginPath],
      synthesizedSkillsRoot: synthRoot,
      agentSourceDir,
    };
  }

  /** What a host activation does before the content download resolves. */
  async function activationMirrorPass() {
    return service.mirrorAll(sources());
  }

  /** What a host activation adds when ensureContent() reports !fromCache. */
  async function activationReconcilePass() {
    return service.reconcile(sources());
  }

  async function readClones(): Promise<{
    skill: string;
    command: string;
    agent: string;
  }> {
    const roots = service.getUserLayerRoots();
    return {
      skill: await readFile(
        join(roots.skills, 'deep-research', 'SKILL.md'),
        'utf8',
      ),
      command: await readFile(join(roots.commands, 'review.md'), 'utf8'),
      agent: await readFile(join(roots.agents, 'backend-developer.md'), 'utf8'),
    };
  }

  async function readSkillSidecar(): Promise<OriginSidecar> {
    const roots = service.getUserLayerRoots();
    const raw = await readFile(
      join(roots.skills, 'deep-research', ORIGIN_SIDECAR_FILENAME),
      'utf8',
    );
    return JSON.parse(raw) as OriginSidecar;
  }

  it('mirrorAll alone leaves skills, commands AND agents frozen after an upstream update', async () => {
    await seedUpstream('v1');
    await activationMirrorPass();
    expect(await readClones()).toEqual({
      skill: '# skill v1',
      command: '# command v1',
      agent: '# agent v1',
    });

    // ContentDownloadService rewrites ~/.ptah/plugins/** on a manifest change.
    await seedUpstream('v2');

    // A restart that only re-runs the create-if-absent mirror.
    const second = await activationMirrorPass();

    expect(await readClones()).toEqual({
      skill: '# skill v1',
      command: '# command v1',
      agent: '# agent v1',
    });
    // Nothing was re-copied — every clone was counted as already present.
    expect(second.skillsMirrored).toBe(0);
    expect(second.commandsMirrored).toBe(0);
    expect(second.agentsMirrored).toBe(0);
  });

  it('the full activation sequence fast-forwards all three clone kinds', async () => {
    await seedUpstream('v1');
    await activationMirrorPass();

    await seedUpstream('v2');

    await activationMirrorPass();
    const result = await activationReconcilePass();

    expect(result.fastForwarded).toBe(3);
    expect(result.diverged).toBe(0);
    expect(result.errors).toBe(0);

    expect(await readClones()).toEqual({
      skill: '# skill v2',
      command: '# command v2',
      agent: '# agent v2',
    });
  });

  it('the sequence is idempotent — a second reconcile with no upstream change is all no-ops', async () => {
    await seedUpstream('v1');
    await activationMirrorPass();
    await seedUpstream('v2');
    await activationMirrorPass();
    await activationReconcilePass();

    const again = await activationReconcilePass();
    expect(again.noop).toBe(3);
    expect(again.fastForwarded).toBe(0);
    expect(again.diverged).toBe(0);
    expect(again.errors).toBe(0);
  });

  it('a user-edited clone is flagged for manual rebase, never overwritten by activation', async () => {
    await seedUpstream('v1');
    await activationMirrorPass();

    const roots = service.getUserLayerRoots();
    await writeFile(
      join(roots.skills, 'deep-research', 'SKILL.md'),
      '# skill edited by the user',
      'utf8',
    );

    await seedUpstream('v2');
    await activationMirrorPass();
    const result = await activationReconcilePass();

    // The command and agent had no edits, so they still fast-forward.
    expect(result.fastForwarded).toBe(2);
    expect(result.diverged).toBe(1);
    expect(result.divergedSlugs).toEqual([
      {
        kind: 'skill',
        slug: 'deep-research',
        pendingSourceHash: expect.stringMatching(/^sha256:/),
      },
    ]);

    const clones = await readClones();
    expect(clones.skill).toBe('# skill edited by the user');
    expect(clones.command).toBe('# command v2');
    expect(clones.agent).toBe('# agent v2');

    // The sidecar carries what rebaseClone() needs to offer the update.
    const sidecar = await readSkillSidecar();
    expect(sidecar.diverged).toBe(true);
    expect(sidecar.pendingSourceHash).toMatch(/^sha256:/);
  });

  it('reconcile surfaces per-slug failures as counted errors, never as a thrown activation failure', async () => {
    await seedUpstream('v1');
    await activationMirrorPass();
    await seedUpstream('v2');

    // Force the copy step to fail the way a locked file would on Windows.
    (
      service as unknown as {
        copyTree: (s: string, t: string) => Promise<void>;
      }
    ).copyTree = async () => {
      throw new Error('EPERM: operation not permitted');
    };

    const result = await activationReconcilePass();

    // The skill copy blew up, but reconcile resolved and the other two kinds
    // still reconciled. Activation must never be taken down by a mirror fault.
    expect(result.errors).toBe(1);
    expect(result.fastForwarded).toBe(2);
    expect(logger.warn).toHaveBeenCalled();
  });
});
