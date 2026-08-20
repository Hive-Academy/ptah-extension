/**
 * Cross-workspace isolation (required coverage items 6/7, edge cases
 * E12/E13). Reconciling one workspace must never touch another, and two
 * workspaces with different disabled-id configuration must never see each
 * other's manifest entries.
 *
 * Source-under-test: `HarnessReconcilerService` + `ClaudeTarget`.
 */

import {
  existsSync,
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

function writeSkill(skillsRoot: string, slug: string): void {
  const dir = join(skillsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${slug}\n---\nbody\n`,
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

describe('HarnessReconcilerService — cross-workspace isolation', () => {
  let wsA: string;
  let wsB: string;
  let sourcesRoot: string;

  beforeEach(() => {
    wsA = mkdtempSync(join(tmpdir(), 'harness-sync-wsA-'));
    wsB = mkdtempSync(join(tmpdir(), 'harness-sync-wsB-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-src-'));
  });

  afterEach(() => {
    rmSync(wsA, { recursive: true, force: true });
    rmSync(wsB, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  });

  it('[E12] reconciling workspace B leaves workspace A artifacts and manifest untouched', async () => {
    const skillsRoot = join(sourcesRoot, 'skills');
    writeSkill(skillsRoot, 'foo');
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
    // One reconciler instance is intentionally reused for both workspaces:
    // the desired state (from the resolver) does not depend on which
    // workspace is being reconciled, only the target paths do.
    const reconciler = newReconciler(sourceState);

    await reconciler.reconcile(wsA, { mode: 'full', reason: 'seed A' });
    const manifestPathA = join(wsA, '.ptah', 'harness', 'claude.manifest.json');
    const manifestBefore = readFileSync(manifestPathA, 'utf-8');
    const artifactA = join(wsA, '.claude', 'skills', 'foo', 'SKILL.md');
    expect(existsSync(artifactA)).toBe(true);

    await reconciler.reconcile(wsB, { mode: 'full', reason: 'reconcile B' });

    expect(existsSync(artifactA)).toBe(true);
    expect(readFileSync(manifestPathA, 'utf-8')).toBe(manifestBefore);
  });

  it('[E13] two workspaces with different disabledSkillIds each carry only their own manifest entries', async () => {
    const skillsRoot = join(sourcesRoot, 'skills');
    writeSkill(skillsRoot, 'skill-x');
    writeSkill(skillsRoot, 'skill-y');
    const layout = {
      skillsRoot,
      commandsRoot: join(sourcesRoot, 'commands'),
      agentsRoot: join(sourcesRoot, 'agents'),
    };

    const reconcilerA = newReconciler({
      layout,
      overlayPluginPaths: [],
      disabledSkillIds: ['skill-y'],
      disabledPluginIds: [],
    });
    const reconcilerB = newReconciler({
      layout,
      overlayPluginPaths: [],
      disabledSkillIds: ['skill-x'],
      disabledPluginIds: [],
    });

    await reconcilerA.reconcile(wsA, { mode: 'full', reason: 'seed A' });
    await reconcilerB.reconcile(wsB, { mode: 'full', reason: 'seed B' });

    const manifestA = new ManagedManifestStore().load(wsA, 'claude');
    const manifestB = new ManagedManifestStore().load(wsB, 'claude');

    expect(Object.keys(manifestA.entries)).toEqual(['.claude/skills/skill-x']);
    expect(Object.keys(manifestB.entries)).toEqual(['.claude/skills/skill-y']);
  });
});
