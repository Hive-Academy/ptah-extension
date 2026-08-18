/**
 * Preflight fast path (required coverage item 16): a no-drift preflight must
 * not write anything, and any drift (deleted copy or changed source) must be
 * detected and repaired.
 *
 * Source-under-test: `HarnessReconcilerService.hasDrift` /
 * `HarnessReconcilerService.reconcileTarget` (preflight branch) +
 * `ClaudeTarget`.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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

describe('HarnessReconcilerService — preflight fast path', () => {
  let ws: string;
  let sourcesRoot: string;
  let skillsRoot: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-recon-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-src-'));
    skillsRoot = join(sourcesRoot, 'skills');
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  });

  function sourceState(): HarnessSourceState {
    return {
      layout: {
        skillsRoot,
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
  }

  it('[16] a preflight pass with no drift performs no writes', async () => {
    writeSkill(skillsRoot, 'foo');
    const reconciler = newReconciler(sourceState());
    await reconciler.reconcile(ws, { mode: 'full', reason: 'seed' });

    const skillFile = join(ws, '.claude', 'skills', 'foo', 'SKILL.md');
    const mtimeBefore = statSync(skillFile).mtimeMs;

    const health = await reconciler.reconcile(ws, {
      mode: 'preflight',
      reason: 'no-op preflight',
    });

    expect(health.targets[0]?.found).toBe(health.targets[0]?.expected);
    // Untouched entirely, not merely "correct content" — the drift check must
    // short-circuit before any copy is attempted.
    expect(statSync(skillFile).mtimeMs).toBe(mtimeBefore);
  });

  it('[16] a preflight pass detects a deleted target copy (manifest untouched) and restores it', async () => {
    writeSkill(skillsRoot, 'foo');
    const reconciler = newReconciler(sourceState());
    await reconciler.reconcile(ws, { mode: 'full', reason: 'seed' });

    const skillDir = join(ws, '.claude', 'skills', 'foo');
    rmSync(skillDir, { recursive: true, force: true });
    expect(existsSync(skillDir)).toBe(false);

    const health = await reconciler.reconcile(ws, {
      mode: 'preflight',
      reason: 'drift: deleted copy',
    });

    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
    expect(health.targets[0]?.found).toBe(health.targets[0]?.expected);
  });

  it('[16] a preflight pass detects a changed source file and applies the update', async () => {
    writeSkill(skillsRoot, 'foo', 'version 1');
    const reconciler = newReconciler(sourceState());
    await reconciler.reconcile(ws, { mode: 'full', reason: 'seed' });

    writeFileSync(
      join(skillsRoot, 'foo', 'SKILL.md'),
      '---\nname: foo\n---\nversion 2\n',
      'utf-8',
    );

    await reconciler.reconcile(ws, {
      mode: 'preflight',
      reason: 'drift: source changed',
    });

    const copiedFile = join(ws, '.claude', 'skills', 'foo', 'SKILL.md');
    expect(readFileSync(copiedFile, 'utf-8')).toContain('version 2');
  });
});
