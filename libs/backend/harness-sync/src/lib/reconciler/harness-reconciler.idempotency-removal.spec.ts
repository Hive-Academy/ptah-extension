/**
 * Idempotency, the E1 "no deactivate path" invariant, and removal-on-source-
 * deletion (required coverage items 1/12/13).
 *
 * There is no deactivate/uninstall path in this lib any more — everything it
 * writes is meant to persist across host restarts. So E1 ("deactivate leaves
 * files") is tested as its positive form: nothing here ever removes an
 * artifact except a source disappearing, and a completely independent second
 * reconciler instance over the same workspace is a no-op.
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
import { HarnessStateStore } from '../gitignore/harness-state-store';
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

function writeAgent(agentsRoot: string, name: string): void {
  mkdirSync(agentsRoot, { recursive: true });
  writeFileSync(join(agentsRoot, `${name}.md`), `agent ${name}`, 'utf-8');
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

describe('HarnessReconcilerService — idempotency and no-deactivate (E1)', () => {
  let ws: string;
  let sourcesRoot: string;
  let manifestPath: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-sync-recon-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-sync-src-'));
    manifestPath = join(ws, '.ptah', 'harness', 'claude.manifest.json');
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  });

  function sourceStateWith(
    skillSlugs: string[],
    commandNames: string[],
  ): HarnessSourceState {
    const skillsRoot = join(sourcesRoot, 'skills');
    const commandsRoot = join(sourcesRoot, 'commands');
    for (const slug of skillSlugs) writeSkill(skillsRoot, slug);
    for (const name of commandNames) writeCommand(commandsRoot, name);
    return {
      layout: {
        skillsRoot,
        commandsRoot,
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    };
  }

  it('[12] a second full reconcile over an unchanged workspace writes nothing and leaves the manifest byte-identical', async () => {
    const sourceState = sourceStateWith(['foo', 'bar'], ['baz']);
    const reconciler = newReconciler(sourceState);

    await reconciler.reconcile(ws, { mode: 'full', reason: 'seed' });
    const manifestBytesAfterFirst = readFileSync(manifestPath, 'utf-8');

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'repeat',
    });

    expect(health.targets[0]?.found).toBe(health.targets[0]?.expected);
    expect(health.targets[0]?.writeFailed).toEqual([]);
    expect(health.targets[0]?.removed).toEqual([]);
    expect(health.targets[0]?.overwrittenLocalEdit).toEqual([]);
    // Byte content, not mtime — mtime granularity makes an mtime comparison
    // flaky on some filesystems even when nothing was written.
    expect(readFileSync(manifestPath, 'utf-8')).toBe(manifestBytesAfterFirst);
  });

  it('reports Claude agents as source-managed and never writes, manifests, or reaps them', async () => {
    const sourceState = sourceStateWith(['foo'], ['baz']);
    const sourceAgent = join(sourcesRoot, 'agents', 'source-agent.md');
    writeAgent(join(sourcesRoot, 'agents'), 'source-agent');
    const workspaceAgent = join(ws, '.claude', 'agents', 'workspace-agent.md');
    mkdirSync(join(ws, '.claude', 'agents'), { recursive: true });
    writeFileSync(workspaceAgent, 'workspace-authored agent', 'utf-8');
    new HarnessStateStore().save(ws, { version: 1, agentSyncEnabled: true });

    const health = await newReconciler(sourceState).reconcile(ws, {
      mode: 'full',
      reason: 'source-managed agents',
    });

    const claude = health.targets.find((target) => target.target === 'claude');
    const manifest = new ManagedManifestStore().load(ws, 'claude');
    expect(claude?.facets.agents).toBe('source-managed');
    expect(existsSync(sourceAgent)).toBe(true);
    expect(readFileSync(workspaceAgent, 'utf-8')).toBe(
      'workspace-authored agent',
    );
    expect(claude?.removed).not.toContain('.claude/agents/workspace-agent.md');
    expect(Object.keys(manifest.entries)).not.toContain(
      '.claude/agents/source-agent.md',
    );
    expect(Object.keys(manifest.entries)).not.toContain(
      '.claude/agents/workspace-agent.md',
    );
  });

  it('[E1] a full reconcile is followed by a no-op from a COMPLETELY INDEPENDENT second reconciler instance, leaving every file present and identical', async () => {
    const sourceState = sourceStateWith(['foo'], ['baz']);
    const reconciler1 = newReconciler(sourceState);
    await reconciler1.reconcile(ws, { mode: 'full', reason: 'seed' });

    const skillFile = join(ws, '.claude', 'skills', 'foo', 'SKILL.md');
    const commandFile = join(ws, '.claude', 'commands', 'baz.md');
    const skillContentBefore = readFileSync(skillFile, 'utf-8');
    const commandContentBefore = readFileSync(commandFile, 'utf-8');
    const manifestBytesBefore = readFileSync(manifestPath, 'utf-8');

    // A brand new reconciler with its own builder, manifest store and target
    // — nothing shared in memory with reconciler1 — reads the same disk state.
    const reconciler2 = newReconciler(sourceState);
    const health = await reconciler2.reconcile(ws, {
      mode: 'full',
      reason: 'independent',
    });

    expect(health.targets[0]?.writeFailed).toEqual([]);
    expect(health.targets[0]?.removed).toEqual([]);
    expect(existsSync(skillFile)).toBe(true);
    expect(existsSync(commandFile)).toBe(true);
    expect(readFileSync(skillFile, 'utf-8')).toBe(skillContentBefore);
    expect(readFileSync(commandFile, 'utf-8')).toBe(commandContentBefore);
    expect(readFileSync(manifestPath, 'utf-8')).toBe(manifestBytesBefore);
  });
});

describe('HarnessReconcilerService — removal on source deletion', () => {
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

  it('[13] a target copy is removed and reported once its source directory is deleted', async () => {
    const skillsRoot = join(sourcesRoot, 'skills');
    writeSkill(skillsRoot, 'foo');
    writeSkill(skillsRoot, 'bar');
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
    await reconciler.reconcile(ws, { mode: 'full', reason: 'seed' });

    const fooTargetDir = join(ws, '.claude', 'skills', 'foo');
    expect(existsSync(fooTargetDir)).toBe(true);

    rmSync(join(skillsRoot, 'foo'), { recursive: true, force: true });

    const health = await reconciler.reconcile(ws, {
      mode: 'full',
      reason: 'source removed',
    });

    expect(existsSync(fooTargetDir)).toBe(false);
    expect(health.targets[0]?.removed).toContain('.claude/skills/foo');

    const manifest = new ManagedManifestStore().load(ws, 'claude');
    expect(manifest.entries['.claude/skills/foo']).toBeUndefined();
    expect(manifest.entries['.claude/skills/bar']).toBeDefined();
  });
});
