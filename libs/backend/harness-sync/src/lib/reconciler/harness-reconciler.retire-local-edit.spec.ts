/**
 * Retiring a manifest-owned rival-CLI copy never loses a hand edit
 * (TASK_2026_609).
 *
 * The manifest proves Ptah WROTE a path, not that the bytes there are still
 * Ptah's. Before this guard, an agent leaving the desired state (source deleted,
 * agent disabled, explicit uninstall) deleted `.codex/agents/<slug>.toml` even
 * when the user had tuned it by hand. Now an unchanged copy is removed as
 * before, a hand-edited one is saved to
 * `{ws}/.ptah/harness/.history/<slug>/<ts>/<relPath>` first, and anything that
 * cannot be read or saved is left on disk and stays owned for the next pass.
 *
 * Source-under-test: `WorkspaceHarnessTarget.apply` via the real
 * `HarnessReconcilerService`, with the real Codex and Copilot targets.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  HarnessHealth,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { createStaticSourceResolver } from '../sources/plugin-config-source-resolver';
import type {
  HarnessSourceState,
  IHarnessCliDetector,
} from '../sources/harness-source.port';
import {
  createCodexTarget,
  createCopilotTarget,
} from '../targets/rival-targets';
import { HarnessReconcilerService } from './harness-reconciler.service';

function fakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function detectorFor(installed: HarnessTargetId[]): IHarnessCliDetector {
  const set = new Set(installed);
  return { isInstalled: (target) => Promise.resolve(set.has(target)) };
}

const TIMESTAMP_DIR = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/;

describe('HarnessReconcilerService — retiring a hand-edited copy (TASK_2026_609)', () => {
  let ws: string;
  let sourcesRoot: string;
  let home: string;

  const CODEX_ONE = '.codex/agents/agent-one.toml';
  const CODEX_TWO = '.codex/agents/agent-two.toml';
  const COPILOT_ONE = '.github/agents/agent-one.agent.md';
  const COPILOT_TWO = '.github/agents/agent-two.agent.md';
  const HISTORY = '.ptah/harness/.history';

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-retire-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-retire-src-'));
    home = mkdtempSync(join(tmpdir(), 'harness-retire-home-'));
    mkdirSync(join(sourcesRoot, 'skills'), { recursive: true });
    writeAgentSources('agent-one', 'agent-two');
    new HarnessStateStore().save(ws, {
      version: 1,
      agentSyncEnabled: true,
      skillSyncMode: 'all',
    });
  });

  afterEach(() => {
    for (const dir of [ws, sourcesRoot, home]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------- fixtures

  function writeAgentSources(...slugs: string[]): void {
    const agentsRoot = join(sourcesRoot, 'agents');
    mkdirSync(agentsRoot, { recursive: true });
    for (const slug of slugs) {
      writeFileSync(
        join(agentsRoot, `${slug}.md`),
        `---\nname: ${slug}\ndescription: the ${slug} agent\n---\n${slug} instructions\n`,
        'utf-8',
      );
    }
  }

  function deleteAgentSource(slug: string): void {
    rmSync(join(sourcesRoot, 'agents', `${slug}.md`), { force: true });
  }

  function writeSkillSource(slug: string): void {
    const dir = join(sourcesRoot, 'skills', slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${slug}\ndescription: the ${slug} skill\n---\n${slug} body\n`,
      'utf-8',
    );
  }

  function newReconciler(
    disabledAgentIds: string[] = [],
  ): HarnessReconcilerService {
    const store = new ManagedManifestStore();
    const deps = {
      manifestStore: store,
      detector: detectorFor(['codex', 'copilot']),
      homeDir: home,
    };
    const state: HarnessSourceState = {
      layout: {
        skillsRoot: join(sourcesRoot, 'skills'),
        commandsRoot: join(sourcesRoot, 'commands'),
        agentsRoot: join(sourcesRoot, 'agents'),
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
      disabledAgentIds,
    };
    return new HarnessReconcilerService(
      fakeLogger(),
      new HarnessManifestBuilder(),
      store,
      createStaticSourceResolver(state),
      [createCodexTarget(deps), createCopilotTarget(deps)],
    );
  }

  function reconcile(
    disabledAgentIds: string[] = [],
    reason = 'test pass',
  ): Promise<HarnessHealth> {
    return newReconciler(disabledAgentIds).reconcile(ws, {
      mode: 'full',
      reason,
    });
  }

  // ----------------------------------------------------------------- probes

  function abs(relPath: string): string {
    return join(ws, ...relPath.split('/'));
  }

  function exists(relPath: string): boolean {
    return existsSync(abs(relPath));
  }

  function read(relPath: string): string {
    return readFileSync(abs(relPath), 'utf-8');
  }

  function row(
    health: HarnessHealth,
    id: HarnessTargetId,
  ): HarnessTargetHealth {
    const found = health.targets.find((target) => target.target === id);
    if (found === undefined) throw new Error(`no health row for ${id}`);
    return found;
  }

  function ownedPaths(id: HarnessTargetId): string[] {
    return Object.keys(new ManagedManifestStore().load(ws, id).entries);
  }

  /** `<ts>` directories under `.ptah/harness/.history/<slug>`, sorted. */
  function snapshotStamps(slug: string): string[] {
    const dir = abs(`${HISTORY}/${slug}`);
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  /** Every snapshotted file for `slug`, keyed `<ts>/<relPath>`. */
  function snapshotFiles(slug: string): Map<string, string> {
    const files = new Map<string, string>();
    const walk = (dir: string, prefix: string): void => {
      for (const name of readdirSync(dir)) {
        const absolute = join(dir, name);
        const relative = prefix === '' ? name : `${prefix}/${name}`;
        if (statSync(absolute).isDirectory()) walk(absolute, relative);
        else files.set(relative, readFileSync(absolute, 'utf-8'));
      }
    };
    const root = abs(`${HISTORY}/${slug}`);
    if (existsSync(root)) walk(root, '');
    return files;
  }

  // ------------------------------------------------------------------ cases

  it('1. an unchanged owned agent copy whose source is deleted is removed plainly, with no snapshot', async () => {
    await reconcile();
    expect(exists(CODEX_TWO)).toBe(true);

    deleteAgentSource('agent-two');
    const health = await reconcile();

    expect(exists(CODEX_TWO)).toBe(false);
    const codex = row(health, 'codex');
    expect(codex.removed).toContain(CODEX_TWO);
    expect(codex.removedLocalEdit).toEqual([]);
    expect(codex.writeFailed).toEqual([]);
    expect(exists(HISTORY)).toBe(false);
    expect(ownedPaths('codex')).not.toContain(CODEX_TWO);
  });

  it('2. a hand-edited owned agent copy whose source is deleted is snapshotted, then removed and reported as a local edit', async () => {
    await reconcile();
    writeFileSync(abs(CODEX_TWO), 'HAND EDITED', 'utf-8');

    deleteAgentSource('agent-two');
    const health = await reconcile();

    expect(exists(CODEX_TWO)).toBe(false);
    const stamps = snapshotStamps('agent-two');
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatch(TIMESTAMP_DIR);
    expect(read(`${HISTORY}/agent-two/${stamps[0]}/${CODEX_TWO}`)).toBe(
      'HAND EDITED',
    );

    const codex = row(health, 'codex');
    expect(codex.removed).toContain(CODEX_TWO);
    expect(codex.removedLocalEdit).toEqual([CODEX_TWO]);
    expect(ownedPaths('codex')).not.toContain(CODEX_TWO);
    // The untouched Copilot copy of the same agent went the plain way.
    const copilot = row(health, 'copilot');
    expect(copilot.removed).toContain(COPILOT_TWO);
    expect(copilot.removedLocalEdit).toEqual([]);
  });

  it('3. disabling an agent retires its hand-edited copy the same way, and the sibling stays', async () => {
    await reconcile();
    writeFileSync(abs(CODEX_TWO), 'HAND EDITED', 'utf-8');

    const health = await reconcile(['agent-two'], 'agent-two disabled');

    expect(exists(CODEX_TWO)).toBe(false);
    const stamps = snapshotStamps('agent-two');
    expect(stamps).toHaveLength(1);
    expect(read(`${HISTORY}/agent-two/${stamps[0]}/${CODEX_TWO}`)).toBe(
      'HAND EDITED',
    );
    const codex = row(health, 'codex');
    expect(codex.removed).toContain(CODEX_TWO);
    expect(codex.removedLocalEdit).toEqual([CODEX_TWO]);

    expect(exists(CODEX_ONE)).toBe(true);
    expect(exists(COPILOT_ONE)).toBe(true);
    expect(snapshotStamps('agent-one')).toEqual([]);
  });

  it('4. a copy that cannot be read as the recorded kind is not removed, stays owned, and is retired once readable again', async () => {
    await reconcile();
    const original = read(CODEX_TWO);
    // lstat succeeds, reading it as a file does not.
    rmSync(abs(CODEX_TWO), { force: true });
    mkdirSync(abs(CODEX_TWO));
    writeFileSync(join(abs(CODEX_TWO), 'inner.txt'), 'something', 'utf-8');

    deleteAgentSource('agent-two');
    const blocked = await reconcile();

    expect(exists(CODEX_TWO)).toBe(true);
    expect(exists(`${CODEX_TWO}/inner.txt`)).toBe(true);
    const codex = row(blocked, 'codex');
    expect(codex.removed).not.toContain(CODEX_TWO);
    expect(codex.removedLocalEdit).toEqual([]);
    const failure = codex.writeFailed.find((f) => f.relPath === CODEX_TWO);
    expect(failure?.reason).toMatch(/cannot read to check for local edits/);
    expect(ownedPaths('codex')).toContain(CODEX_TWO);
    expect(exists(HISTORY)).toBe(false);

    // Restored to the bytes Ptah wrote: the next pass retires it plainly.
    rmSync(abs(CODEX_TWO), { recursive: true, force: true });
    writeFileSync(abs(CODEX_TWO), original, 'utf-8');
    const retried = await reconcile();

    expect(exists(CODEX_TWO)).toBe(false);
    expect(row(retried, 'codex').removed).toContain(CODEX_TWO);
    expect(row(retried, 'codex').writeFailed).toEqual([]);
    expect(ownedPaths('codex')).not.toContain(CODEX_TWO);
    expect(exists(HISTORY)).toBe(false);
  });

  it('5. when the snapshot cannot be written the hand-edited copy is kept and stays owned, while unchanged copies are still removed', async () => {
    await reconcile();
    writeFileSync(abs(CODEX_TWO), 'HAND EDITED', 'utf-8');
    // A regular FILE where the history directory must go.
    writeFileSync(abs(HISTORY), 'not a directory', 'utf-8');

    const health = await reconcile(['agent-two'], 'agent-two disabled');

    expect(read(CODEX_TWO)).toBe('HAND EDITED');
    const codex = row(health, 'codex');
    expect(codex.removed).not.toContain(CODEX_TWO);
    expect(codex.removedLocalEdit).toEqual([]);
    const failure = codex.writeFailed.find((f) => f.relPath === CODEX_TWO);
    expect(failure?.reason).toMatch(/could not save local edit before removal/);
    expect(ownedPaths('codex')).toContain(CODEX_TWO);

    // The unchanged Copilot copy in the same pass needs no snapshot.
    expect(exists(COPILOT_TWO)).toBe(false);
    expect(row(health, 'copilot').removed).toContain(COPILOT_TWO);
    expect(ownedPaths('copilot')).not.toContain(COPILOT_TWO);
  });

  it('6. a rival skill directory: unchanged is removed plainly (A8), hand-edited is snapshotted whole, then removed', async () => {
    writeSkillSource('kept-as-is');
    writeSkillSource('tuned');
    await reconcile();
    const UNCHANGED = '.agents/skills/kept-as-is';
    const EDITED = '.agents/skills/tuned';
    expect(exists(`${UNCHANGED}/SKILL.md`)).toBe(true);
    expect(exists(`${EDITED}/SKILL.md`)).toBe(true);
    const writtenSkill = read(`${EDITED}/SKILL.md`);
    writeFileSync(abs(`${EDITED}/NOTES.md`), 'my notes', 'utf-8');

    rmSync(join(sourcesRoot, 'skills', 'kept-as-is'), { recursive: true });
    rmSync(join(sourcesRoot, 'skills', 'tuned'), { recursive: true });
    const health = await reconcile();

    const codex = row(health, 'codex');
    // A8: the hash the write branch recorded equals `hashDir` of the copy on
    // disk, so an untouched transformed skill is NOT mistaken for a local edit.
    expect(exists(UNCHANGED)).toBe(false);
    expect(codex.removed).toContain(UNCHANGED);
    expect(codex.removedLocalEdit).not.toContain(UNCHANGED);
    expect(snapshotStamps('kept-as-is')).toEqual([]);
    expect(row(health, 'copilot').removedLocalEdit).toEqual([]);

    expect(exists(EDITED)).toBe(false);
    expect(codex.removed).toContain(EDITED);
    expect(codex.removedLocalEdit).toEqual([EDITED]);
    const stamps = snapshotStamps('tuned');
    expect(stamps).toHaveLength(1);
    const saved = `${HISTORY}/tuned/${stamps[0]}/${EDITED}`;
    expect(read(`${saved}/NOTES.md`)).toBe('my notes');
    expect(read(`${saved}/SKILL.md`)).toBe(writtenSkill);
  });

  it('7. the explicit uninstall pass (E22) snapshots a hand-edited copy and reports it on that target row', async () => {
    await reconcile();
    writeFileSync(abs(CODEX_ONE), 'HAND EDITED ONE', 'utf-8');

    const health = await newReconciler().remove(ws);

    expect(exists(CODEX_ONE)).toBe(false);
    expect(exists(CODEX_TWO)).toBe(false);
    const codex = row(health, 'codex');
    expect(codex.removed).toEqual(
      expect.arrayContaining([CODEX_ONE, CODEX_TWO]),
    );
    expect(codex.removedLocalEdit).toEqual([CODEX_ONE]);
    expect(row(health, 'copilot').removedLocalEdit).toEqual([]);
    const stamps = snapshotStamps('agent-one');
    expect(stamps).toHaveLength(1);
    expect(read(`${HISTORY}/agent-one/${stamps[0]}/${CODEX_ONE}`)).toBe(
      'HAND EDITED ONE',
    );
    expect(ownedPaths('codex')).toEqual([]);
  });

  it('8. the same slug hand-edited in two targets in one pass keeps both edits, neither overwriting the other', async () => {
    await reconcile();
    writeFileSync(abs(CODEX_TWO), 'CODEX EDIT', 'utf-8');
    writeFileSync(abs(COPILOT_TWO), 'COPILOT EDIT', 'utf-8');

    deleteAgentSource('agent-two');
    const health = await reconcile();

    expect(exists(CODEX_TWO)).toBe(false);
    expect(exists(COPILOT_TWO)).toBe(false);
    expect(row(health, 'codex').removedLocalEdit).toEqual([CODEX_TWO]);
    expect(row(health, 'copilot').removedLocalEdit).toEqual([COPILOT_TWO]);

    const files = snapshotFiles('agent-two');
    const contents = [...files.values()].sort();
    expect(contents).toEqual(['CODEX EDIT', 'COPILOT EDIT']);
    const byPath = [...files.keys()];
    expect(byPath.some((key) => key.endsWith(`/${CODEX_TWO}`))).toBe(true);
    expect(byPath.some((key) => key.endsWith(`/${COPILOT_TWO}`))).toBe(true);
    for (const stamp of snapshotStamps('agent-two')) {
      expect(stamp).toMatch(TIMESTAMP_DIR);
    }
  });

  it('9. the snapshot store is never read back: the next pass reports no foreign entry and no further removal', async () => {
    await reconcile();
    writeFileSync(abs(CODEX_TWO), 'HAND EDITED', 'utf-8');
    deleteAgentSource('agent-two');
    await reconcile();
    expect(snapshotStamps('agent-two')).toHaveLength(1);

    const next = await reconcile();

    for (const target of next.targets) {
      expect(target.foreign).toEqual([]);
      expect(target.removed).toEqual([]);
      expect(target.removedLocalEdit).toEqual([]);
      expect(target.writeFailed).toEqual([]);
    }
    expect(snapshotStamps('agent-two')).toHaveLength(1);
  });
});
