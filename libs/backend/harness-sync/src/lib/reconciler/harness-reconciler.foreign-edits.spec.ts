/**
 * Ownership boundaries: files Ptah never wrote, and files it wrote but the
 * user then hand-edited (required coverage items 3/4, edge cases E9/E10).
 *
 * Source-under-test: `HarnessReconcilerService` + `ClaudeTarget`.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

function writeSkill(
  skillsRoot: string,
  slug: string,
  body = 'skill body',
): void {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\n---\n${body}\n`,
    'utf-8',
  );
}

function buildReconciler(
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

describe('HarnessReconcilerService — foreign files and local edits', () => {
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

  function layoutWithSkills(): HarnessSourceState {
    writeSkill(join(sourcesRoot, 'skills'), 'foo', 'source content v1');
    return {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
  }

  it('[E9] a pre-existing directory Ptah never wrote survives byte-identical and is reported as foreign', async () => {
    const reconciler = buildReconciler(layoutWithSkills());

    const foreignSkillDir = join(ws, '.claude', 'skills', 'mine');
    mkdirSync(foreignSkillDir, { recursive: true });
    const foreignFile = join(foreignSkillDir, 'SKILL.md');
    writeFileSync(foreignFile, 'hand-authored, never touched by ptah', 'utf-8');
    const before = readFileSync(foreignFile, 'utf-8');

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'test',
    });

    const after = readFileSync(foreignFile, 'utf-8');
    expect(after).toBe(before);
    expect(health.targets[0]?.foreign).toContain('.claude/skills/mine');
  });

  it('[E10] a hand-edited managed copy is overwritten back to the source content and reported in overwrittenLocalEdit', async () => {
    const reconciler = buildReconciler(layoutWithSkills());

    // First pass creates the managed copy.
    await reconciler.reconcile(ws, { mode: 'full', reason: 'seed' });
    const managedFile = join(ws, '.claude', 'skills', 'foo', 'SKILL.md');
    expect(readFileSync(managedFile, 'utf-8')).toContain('source content v1');

    // User hand-edits the copy directly.
    writeFileSync(managedFile, 'HAND EDITED, NOT FROM SOURCE', 'utf-8');

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'second pass',
    });

    // Source wins: the edit is discarded, but reported so the user can find it.
    expect(readFileSync(managedFile, 'utf-8')).toContain('source content v1');
    expect(readFileSync(managedFile, 'utf-8')).not.toContain('HAND EDITED');
    expect(health.targets[0]?.overwrittenLocalEdit).toContain(
      '.claude/skills/foo',
    );
  });
});
