/**
 * Concurrent reconcile from two independent reconciler instances over the
 * SAME workspace (required coverage item 5a, edge case E11).
 *
 * The reconciler serializes per-workspace via a module-level in-process
 * queue keyed by the workspace path (see `serializePerWorkspace` in
 * `workspace-lock.ts`) — that queue lives at module scope, not on the
 * `HarnessReconcilerService` instance, so two separate instances calling
 * `reconcile` on the same path are still ordered. This test proves no
 * manifest entries are lost under that concurrency, which is exactly the
 * silent-corruption defect the lock exists to close.
 *
 * Source-under-test: `HarnessReconcilerService` + `ClaudeTarget` +
 * `serializePerWorkspace`.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
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

function writeCommand(commandsRoot: string, name: string): void {
  mkdirSync(commandsRoot, { recursive: true });
  writeFileSync(join(commandsRoot, `${name}.md`), `command ${name}`, 'utf-8');
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

describe('HarnessReconcilerService — concurrent reconcile of one workspace', () => {
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

  it('[E11] Promise.all of two independent reconciler instances loses no manifest entries', async () => {
    const skillsRoot = join(sourcesRoot, 'skills');
    const commandsRoot = join(sourcesRoot, 'commands');
    const skillSlugs = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
    const commandNames = ['one', 'two', 'three'];
    for (const slug of skillSlugs) writeSkill(skillsRoot, slug);
    for (const name of commandNames) writeCommand(commandsRoot, name);

    const sourceState: HarnessSourceState = {
      layout: {
        skillsRoot,
        commandsRoot,
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };

    const r1 = newReconciler(sourceState);
    const r2 = newReconciler(sourceState);

    await Promise.all([
      r1.reconcile(ws, { mode: 'full', reason: 'r1' }),
      r2.reconcile(ws, { mode: 'full', reason: 'r2' }),
    ]);

    const finalStore = new ManagedManifestStore();
    const manifest = finalStore.load(ws, 'claude');
    const expectedRelPaths = [
      ...skillSlugs.map((slug) => `.claude/skills/${slug}`),
      ...commandNames.map((name) => `.claude/commands/${name}.md`),
    ];

    for (const relPath of expectedRelPaths) {
      expect(manifest.entries[relPath]).toBeDefined();
      expect(existsSync(join(ws, ...relPath.split('/')))).toBe(true);
    }
    expect(Object.keys(manifest.entries)).toHaveLength(expectedRelPaths.length);
  });
});
