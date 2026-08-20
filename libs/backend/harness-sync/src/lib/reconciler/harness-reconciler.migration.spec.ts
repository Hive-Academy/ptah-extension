/**
 * One-time repair of state left behind by the deleted `SkillJunctionService`
 * (required coverage items 10/11): NTFS junctions become real copies, and the
 * legacy `.ptah-managed.json` command manifest is adopted then removed.
 *
 * Source-under-test: `HarnessReconcilerService` + `ClaudeTarget`.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import { ClaudeTarget } from '../targets/claude-target';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { HarnessReconcilerService } from './harness-reconciler.service';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessSourceState } from '../sources/harness-source.port';

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

function newReconciler(
  sourceState: HarnessSourceState,
): HarnessReconcilerService {
  const logger = makeFakeLogger();
  const store = new ManagedManifestStore((message, detail) =>
    logger.warn(message, detail),
  );
  const resolver = createStaticSourceResolver(sourceState);
  return new HarnessReconcilerService(
    logger as unknown as Logger,
    new HarnessManifestBuilder(),
    store,
    resolver,
    [new ClaudeTarget(store)],
  );
}

describe('HarnessReconcilerService — legacy-state migration', () => {
  let ws: string;
  let sourcesRoot: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-recon-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-src-'));
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  });

  it('replaces a real directory junction with a real copy, and leaves the source directory intact (proves unlink, not rm -r)', async () => {
    const skillsRoot = join(sourcesRoot, 'skills');
    const sourceSkillDir = join(skillsRoot, 'foo');
    mkdirSync(sourceSkillDir, { recursive: true });
    writeFileSync(join(sourceSkillDir, 'SKILL.md'), 'source content', 'utf-8');
    writeFileSync(join(sourceSkillDir, 'extra.md'), 'extra file', 'utf-8');

    const targetSkillsDir = join(ws, '.claude', 'skills');
    mkdirSync(targetSkillsDir, { recursive: true });
    const junctionPath = join(targetSkillsDir, 'foo');
    // `dir` on POSIX, `junction` on Windows — junctions need no elevation and
    // only work for directories, both true of a skill directory.
    symlinkSync(
      sourceSkillDir,
      junctionPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(lstatSync(junctionPath).isSymbolicLink()).toBe(true);

    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot,
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
    const reconciler = newReconciler(sourceState);

    await reconciler.reconcile(ws, { mode: 'full', reason: 'test' });

    expect(lstatSync(junctionPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(junctionPath, 'SKILL.md'), 'utf-8')).toBe(
      'source content',
    );
    expect(readFileSync(join(junctionPath, 'extra.md'), 'utf-8')).toBe(
      'extra file',
    );

    // The load-bearing check: the SOURCE directory (what the junction used to
    // point at) must still exist with its files. `rm -r` on a junction on
    // Windows follows it and deletes the source; `unlink` does not.
    expect(existsSync(sourceSkillDir)).toBe(true);
    expect(readFileSync(join(sourceSkillDir, 'SKILL.md'), 'utf-8')).toBe(
      'source content',
    );
    expect(readFileSync(join(sourceSkillDir, 'extra.md'), 'utf-8')).toBe(
      'extra file',
    );
  });

  it('adopts a legacy .ptah-managed.json command entry, updates it to match the source, and deletes the legacy file', async () => {
    const commandsRoot = join(sourcesRoot, 'commands');
    mkdirSync(commandsRoot, { recursive: true });
    writeFileSync(
      join(commandsRoot, 'orchestrate.md'),
      'NEW CONTENT FROM SOURCE',
      'utf-8',
    );

    const targetCommandsDir = join(ws, '.claude', 'commands');
    mkdirSync(targetCommandsDir, { recursive: true });
    const legacyCommandFile = join(targetCommandsDir, 'orchestrate.md');
    writeFileSync(
      legacyCommandFile,
      'OLD CONTENT FROM JUNCTION SERVICE',
      'utf-8',
    );
    const legacyManifestPath = join(targetCommandsDir, '.ptah-managed.json');
    writeFileSync(
      legacyManifestPath,
      JSON.stringify({
        'orchestrate.md': { source: 'x', size: 1, mtimeMs: 1 },
      }),
      'utf-8',
    );

    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot,
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
    const reconciler = newReconciler(sourceState);

    await reconciler.reconcile(ws, { mode: 'full', reason: 'test' });

    // Adopted, then updated to the source content — NOT left alone as
    // foreign, and NOT left at the stale pre-adoption content.
    expect(readFileSync(legacyCommandFile, 'utf-8')).toBe(
      'NEW CONTENT FROM SOURCE',
    );
    expect(existsSync(legacyManifestPath)).toBe(false);

    const manifest = new ManagedManifestStore().load(ws, 'claude');
    expect(manifest.entries['.claude/commands/orchestrate.md']).toBeDefined();

    // Also confirm nothing in .claude/commands is misclassified as foreign.
    const remainingEntries = readdirSync(targetCommandsDir);
    expect(remainingEntries).toContain('orchestrate.md');
    expect(remainingEntries).not.toContain('.ptah-managed.json');
  });
});
