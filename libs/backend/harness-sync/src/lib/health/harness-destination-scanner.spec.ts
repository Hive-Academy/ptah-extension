/**
 * The destination scanner (TASK_2026_701, B9 part 2).
 *
 * Source-under-test: `lib/health/harness-destination-scanner.ts`, driven
 * against REAL targets (Claude plus the Cursor rival CLI, with Codex present
 * but not installed) over a real temp workspace that one real reconcile has
 * populated. Every path lives under `mkdtemp` roots; nothing reaches the real
 * home directory.
 *
 * The only double is a switch on `fs/promises` that makes a chosen path
 * unreadable, because no portable permission trick does that on Windows.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let unreadable: ((path: string) => boolean) | null = null;

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  const refuse = (path: unknown): boolean =>
    typeof path === 'string' && unreadable?.(path) === true;
  const eacces = (path: string) =>
    Object.assign(new Error(`EACCES: permission denied, open '${path}'`), {
      code: 'EACCES',
    });
  return {
    ...actual,
    readFile: async (path: string, ...rest: unknown[]) => {
      if (refuse(path)) throw eacces(path);
      return actual.readFile(path, ...rest);
    },
    readdir: async (path: string, ...rest: unknown[]) => {
      if (refuse(path)) throw eacces(path);
      return actual.readdir(path, ...rest);
    },
  };
});

import type { HarnessTargetId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { hashDir, hashFile } from '../hash/content-hash';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import { ClaudeTarget } from '../targets/claude-target';
import type { IHarnessTarget } from '../targets/harness-target.port';
import {
  createCodexTarget,
  createCursorTarget,
} from '../targets/rival-targets';
import {
  HarnessDestinationScanner,
  probeDestination,
  type HarnessDestination,
} from './harness-destination-scanner';

interface FakeLogger {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

function makeFakeLogger(): FakeLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function detectorFor(installed: HarnessTargetId[]): IHarnessCliDetector {
  const set = new Set(installed);
  return { isInstalled: (target) => Promise.resolve(set.has(target)) };
}

describe('HarnessDestinationScanner', () => {
  let ws: string;
  let sourcesRoot: string;
  let home: string;
  let logger: FakeLogger;
  let store: ManagedManifestStore;
  let targets: IHarnessTarget[];

  const abs = (relPath: string): string => join(ws, ...relPath.split('/'));

  function writeSources(): HarnessSourceState {
    const skillsRoot = join(sourcesRoot, 'skills');
    const commandsRoot = join(sourcesRoot, 'commands');
    const agentsRoot = join(sourcesRoot, 'agents');
    mkdirSync(join(skillsRoot, 'alpha'), { recursive: true });
    mkdirSync(commandsRoot, { recursive: true });
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(
      join(skillsRoot, 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: the alpha skill\n---\nalpha body\n',
      'utf-8',
    );
    writeFileSync(
      join(commandsRoot, 'run-it.md'),
      'the managed command body\n',
      'utf-8',
    );
    return {
      layout: { skillsRoot, commandsRoot, agentsRoot },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      mcpIntents: [],
    };
  }

  function scanner(over: readonly IHarnessTarget[] = targets) {
    return new HarnessDestinationScanner(
      logger as unknown as Logger,
      over,
      store,
    );
  }

  const on = (
    scan: readonly HarnessDestination[],
    target: HarnessTargetId,
    slug: string,
  ): HarnessDestination | undefined =>
    scan.find((entry) => entry.target === target && entry.slug === slug);

  beforeEach(async () => {
    ws = mkdtempSync(join(tmpdir(), 'harness-scan-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-scan-src-'));
    home = mkdtempSync(join(tmpdir(), 'harness-scan-home-'));
    unreadable = null;
    logger = makeFakeLogger();
    const stateStore = new HarnessStateStore();
    stateStore.save(ws, { ...stateStore.load(ws), skillSyncMode: 'all' });

    store = new ManagedManifestStore((message, detail) =>
      logger.warn(message, detail as Record<string, unknown>),
    );
    const detector = detectorFor(['cursor']);
    targets = [
      new ClaudeTarget(store),
      createCursorTarget({ manifestStore: store, detector, homeDir: home }),
      // Supported for skills, but not installed: contributes nothing.
      createCodexTarget({ manifestStore: store, detector, homeDir: home }),
    ];
    const reconciler = new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(writeSources()),
      targets,
    );
    await reconciler.reconcile(ws, { mode: 'full', reason: 'activation' });
  });

  afterEach(() => {
    unreadable = null;
    for (const dir of [ws, sourcesRoot, home]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an owned, unmodified skill on every detected target with its directory digest', async () => {
    const scan = await scanner().scan(ws, [{ kind: 'skill', slug: 'alpha' }]);

    expect(
      scan.map((entry) => [entry.target, entry.relPath, entry.state]),
    ).toEqual([
      ['claude', '.claude/skills/alpha', 'owned-unmodified'],
      ['cursor', '.cursor/skills/alpha', 'owned-unmodified'],
    ]);
    expect(on(scan, 'claude', 'alpha')?.digest).toBe(
      await hashDir(abs('.claude/skills/alpha')),
    );
    expect(on(scan, 'cursor', 'alpha')?.digest).toBe(
      await hashDir(abs('.cursor/skills/alpha')),
    );
  });

  it('skips a rival CLI that is not installed', async () => {
    const scan = await scanner().scan(ws, [{ kind: 'skill', slug: 'alpha' }]);
    expect(scan.some((entry) => entry.target === 'codex')).toBe(false);
  });

  it('reports a hand-edited rival copy as owned-edited, with the CURRENT digest rather than the manifest hash', async () => {
    const rel = '.cursor/skills/alpha';
    const manifestHash = store.load(ws, 'cursor').entries[rel]?.hash;
    writeFileSync(join(abs(rel), 'SKILL.md'), 'edited by hand\n', 'utf-8');

    const scan = await scanner().scan(ws, [{ kind: 'skill', slug: 'alpha' }]);
    const cursor = on(scan, 'cursor', 'alpha');

    expect(cursor?.state).toBe('owned-edited');
    expect(cursor?.digest).toBe(await hashDir(abs(rel)));
    expect(cursor?.digest).not.toBe(manifestHash);
    expect(on(scan, 'claude', 'alpha')?.state).toBe('owned-unmodified');
  });

  it('reports a user directory no manifest claims as unowned, and a vacant path as absent', async () => {
    mkdirSync(abs('.claude/skills/mine'), { recursive: true });
    writeFileSync(abs('.claude/skills/mine/SKILL.md'), 'my notes\n', 'utf-8');

    const scan = await scanner().scan(ws, [{ kind: 'skill', slug: 'mine' }]);

    expect(on(scan, 'claude', 'mine')).toEqual({
      kind: 'skill',
      slug: 'mine',
      target: 'claude',
      relPath: '.claude/skills/mine',
      state: 'unowned',
      digest: await hashDir(abs('.claude/skills/mine')),
    });
    expect(on(scan, 'cursor', 'mine')).toEqual({
      kind: 'skill',
      slug: 'mine',
      target: 'cursor',
      relPath: '.cursor/skills/mine',
      state: 'absent',
      digest: null,
    });
  });

  it('digests a command as a file, at each target layout', async () => {
    const scan = await scanner().scan(ws, [
      { kind: 'command', slug: 'run-it' },
    ]);

    expect(scan.map((entry) => entry.relPath)).toEqual([
      '.claude/commands/run-it.md',
      '.cursor/commands/run-it.md',
    ]);
    for (const entry of scan) {
      expect(entry.state).toBe('owned-unmodified');
      expect(entry.digest).toBe(await hashFile(abs(entry.relPath)));
    }
  });

  it('takes agent paths from the shared rule and skips Claude, which writes no agent copy', async () => {
    const scan = await scanner().scan(ws, [
      { kind: 'agent', slug: 'reviewer' },
    ]);

    expect(scan).toEqual([
      {
        kind: 'agent',
        slug: 'reviewer',
        target: 'cursor',
        relPath: '.cursor/agents/reviewer.md',
        state: 'absent',
        digest: null,
      },
    ]);
  });

  it('reports an unreadable file and an unlistable directory as unreadable, with no digest', async () => {
    const command = abs('.claude/commands/run-it.md');
    const skillDir = abs('.cursor/skills/alpha');
    unreadable = (path) => path === command || path === skillDir;

    const scan = await scanner().scan(ws, [
      { kind: 'command', slug: 'run-it' },
      { kind: 'skill', slug: 'alpha' },
    ]);

    expect(on(scan, 'claude', 'run-it')).toMatchObject({
      state: 'unreadable',
      digest: null,
    });
    expect(on(scan, 'cursor', 'alpha')).toMatchObject({
      state: 'unreadable',
      digest: null,
    });
    // The neighbours are unaffected.
    expect(on(scan, 'cursor', 'run-it')?.state).toBe('owned-unmodified');
    expect(on(scan, 'claude', 'alpha')?.state).toBe('owned-unmodified');
  });

  it('never throws: a target whose detection fails is logged and skipped', async () => {
    const broken: IHarnessTarget = {
      ...targets[1],
      id: 'opencode',
      detect: () => Promise.reject(new Error('probe exploded')),
    };

    const scan = await scanner([targets[0], broken]).scan(ws, [
      { kind: 'skill', slug: 'alpha' },
    ]);

    expect(scan.map((entry) => entry.target)).toEqual(['claude']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not detect a target'),
      expect.objectContaining({ target: 'opencode', error: 'probe exploded' }),
    );
  });

  it('ignores a slug that is not one path segment, so a scan cannot walk outside a target directory', async () => {
    const scan = await scanner().scan(ws, [
      { kind: 'skill', slug: '../../outside' },
      { kind: 'command', slug: '' },
      { kind: 'skill', slug: 'alpha' },
    ]);

    expect(new Set(scan.map((entry) => entry.slug))).toEqual(
      new Set(['alpha']),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not a single path segment'),
      { slugs: ['../../outside', ''] },
    );
  });

  it('writes nothing: the workspace manifests are unchanged by a scan', async () => {
    const before = JSON.stringify([
      store.load(ws, 'claude'),
      store.load(ws, 'cursor'),
    ]);
    await scanner().scan(ws, [
      { kind: 'skill', slug: 'alpha' },
      { kind: 'command', slug: 'run-it' },
    ]);
    expect(
      JSON.stringify([store.load(ws, 'claude'), store.load(ws, 'cursor')]),
    ).toBe(before);
  });

  describe('probeDestination', () => {
    it('distinguishes absent from present-but-unreadable', async () => {
      expect(await probeDestination(abs('.claude/skills/nope'))).toEqual({
        presence: 'absent',
        digest: null,
      });
      const file = abs('.claude/commands/run-it.md');
      unreadable = (path) => path === file;
      expect(await probeDestination(file)).toEqual({
        presence: 'present',
        digest: null,
      });
    });
  });
});
