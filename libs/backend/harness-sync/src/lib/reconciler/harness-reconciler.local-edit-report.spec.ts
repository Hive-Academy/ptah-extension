/**
 * Health names every hand-edited owned copy, and no sync pass writes over one
 * (TASK_2026_609 C1, TASK_2026_701 D8).
 *
 *   - `localEdit` and `keptLocalEdit` list the edited owned paths of every
 *     facet, on verify and on reconcile alike, so a UI can name them before
 *     the user decides anything;
 *   - a reconcile keeps each edit byte for byte, writes no history snapshot,
 *     and leaves the ownership record at the hash Ptah wrote, so every later
 *     pass keeps it again;
 *   - an unmodified owned copy is still replaced, through the detach into
 *     history, and a detach that cannot save writes nothing;
 *   - `agentsInSync` lists the agent copies that are on disk exactly as Ptah
 *     would write them, and never a disabled agent.
 *
 * Source-under-test: the real `HarnessReconcilerService` over the real Codex
 * and Copilot targets in a temp workspace.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  harnessAgentRelPath,
  type HarnessHealth,
  type HarnessTargetHealth,
  type HarnessTargetId,
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

describe('HarnessReconcilerService — local-edit report and keep policy (TASK_2026_609, D8)', () => {
  let ws: string;
  let sourcesRoot: string;
  let home: string;

  const CODEX_ONE = '.codex/agents/agent-one.toml';
  const CODEX_TWO = '.codex/agents/agent-two.toml';
  const COPILOT_ONE = '.github/agents/agent-one.agent.md';
  const COPILOT_TWO = '.github/agents/agent-two.agent.md';
  const CODEX_SKILL = '.agents/skills/tuned';
  const HISTORY = '.ptah/harness/.history';

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'harness-local-edit-ws-'));
    sourcesRoot = mkdtempSync(join(tmpdir(), 'harness-local-edit-src-'));
    home = mkdtempSync(join(tmpdir(), 'harness-local-edit-home-'));
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

  function writeAgentSourceBody(slug: string, body: string): void {
    writeFileSync(
      join(sourcesRoot, 'agents', `${slug}.md`),
      `---
name: ${slug}
description: the ${slug} agent
---
${body}
`,
      'utf-8',
    );
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

  function reconcile(disabledAgentIds: string[] = []): Promise<HarnessHealth> {
    return newReconciler(disabledAgentIds).reconcile(ws, {
      mode: 'full',
      reason: 'test pass',
    });
  }

  function verify(disabledAgentIds: string[] = []): Promise<HarnessHealth> {
    return newReconciler(disabledAgentIds).verify(ws);
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

  function ownedHash(id: HarnessTargetId, relPath: string): string | undefined {
    return new ManagedManifestStore().load(ws, id).entries[relPath]?.hash;
  }

  function snapshotStamps(slug: string): string[] {
    const dir = abs(`${HISTORY}/${slug}`);
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  // ------------------------------------------------------------------ cases

  it('(a) a read-only verify over a hand-edited Codex agent copy lists it as kept and writes nothing', async () => {
    await reconcile();
    writeFileSync(abs(CODEX_ONE), 'HAND EDITED', 'utf-8');
    const hashBefore = ownedHash('codex', CODEX_ONE);

    const health = await verify();

    const codex = row(health, 'codex');
    expect(codex.localEdit).toEqual([CODEX_ONE]);
    expect(codex.keptLocalEdit).toEqual([CODEX_ONE]);
    expect(codex.missing).not.toContain(CODEX_ONE);
    expect(codex.agentsInSync).toEqual([CODEX_TWO]);
    expect(row(health, 'copilot').localEdit).toEqual([]);
    expect(read(CODEX_ONE)).toBe('HAND EDITED');
    expect(ownedHash('codex', CODEX_ONE)).toBe(hashBefore);
    expect(exists(HISTORY)).toBe(false);
  });

  it('(a2) a hand-edited owned skill directory is listed in localEdit too, beside the agent', async () => {
    writeSkillSource('tuned');
    await reconcile();
    expect(exists(`${CODEX_SKILL}/SKILL.md`)).toBe(true);
    writeFileSync(abs(`${CODEX_SKILL}/NOTES.md`), 'my notes', 'utf-8');
    writeFileSync(abs(CODEX_TWO), 'HAND EDITED', 'utf-8');

    const codex = row(await verify(), 'codex');

    expect(codex.localEdit).toEqual(
      expect.arrayContaining([CODEX_SKILL, CODEX_TWO]),
    );
    expect(codex.localEdit).toHaveLength(2);
    // An unchanged agent is not an edit.
    expect(codex.localEdit).not.toContain(CODEX_ONE);
    expect(read(`${CODEX_SKILL}/NOTES.md`)).toBe('my notes');
    expect(exists(HISTORY)).toBe(false);
  });

  it('(b) a reconcile keeps each hand-edited copy byte for byte, in every pass, and reports it', async () => {
    writeSkillSource('tuned');
    await reconcile();
    writeFileSync(abs(CODEX_ONE), 'HAND EDITED', 'utf-8');
    writeFileSync(abs(`${CODEX_SKILL}/SKILL.md`), 'TUNED SKILL', 'utf-8');
    const agentHash = ownedHash('codex', CODEX_ONE);
    const skillHash = ownedHash('codex', CODEX_SKILL);
    // A source change must not turn a kept edit back into a write.
    writeSkillSource('tuned');
    writeFileSync(
      join(sourcesRoot, 'skills', 'tuned', 'EXTRA.md'),
      'upstream addition',
      'utf-8',
    );

    for (let pass = 0; pass < 2; pass++) {
      const codex = row(await reconcile(), 'codex');
      expect(codex.writeFailed).toEqual([]);
      expect(codex.localEdit?.sort()).toEqual([CODEX_SKILL, CODEX_ONE].sort());
      expect(codex.keptLocalEdit.sort()).toEqual(
        [CODEX_SKILL, CODEX_ONE].sort(),
      );
      expect(codex.missing).toEqual([]);
      expect(codex.agentsInSync).toEqual([CODEX_TWO]);

      expect(read(CODEX_ONE)).toBe('HAND EDITED');
      expect(read(`${CODEX_SKILL}/SKILL.md`)).toBe('TUNED SKILL');
      expect(exists(`${CODEX_SKILL}/EXTRA.md`)).toBe(false);
      expect(exists(HISTORY)).toBe(false);
      expect(ownedHash('codex', CODEX_ONE)).toBe(agentHash);
      expect(ownedHash('codex', CODEX_SKILL)).toBe(skillHash);
    }

    // The unedited sibling target followed the source as usual.
    expect(row(await verify(), 'copilot').localEdit).toEqual([]);
  });

  it('(c) when an unmodified copy cannot be detached into history nothing is written and the path is a write failure', async () => {
    await reconcile();
    const before = read(CODEX_ONE);
    const hashBefore = ownedHash('codex', CODEX_ONE);
    writeAgentSourceBody('agent-one', 'agent-one instructions, revised');
    // A regular FILE where the history directory must go.
    mkdirSync(abs('.ptah/harness'), { recursive: true });
    writeFileSync(abs(HISTORY), 'not a directory', 'utf-8');

    const health = await reconcile();

    expect(read(CODEX_ONE)).toBe(before);
    const codex = row(health, 'codex');
    const failure = codex.writeFailed.find((f) => f.relPath === CODEX_ONE);
    expect(failure?.reason).toMatch(
      /^could not save local edit before overwrite: /,
    );
    expect(codex.keptLocalEdit).toEqual([]);
    expect(codex.localEdit).toEqual([]);
    expect(codex.missing).toContain(CODEX_ONE);
    // Still owned with the hash Ptah wrote, so the next pass tries again.
    expect(ownedHash('codex', CODEX_ONE)).toBe(hashBefore);

    // Once the history location is usable the retry replaces it, and an
    // unmodified copy leaves no snapshot behind.
    rmSync(abs(HISTORY), { force: true });
    const retried = row(await reconcile(), 'codex');
    expect(retried.writeFailed).toEqual([]);
    expect(retried.keptLocalEdit).toEqual([]);
    expect(read(CODEX_ONE)).toContain('agent-one instructions, revised');
    expect(snapshotStamps('agent-one')).toEqual([]);
  });

  it('(d) agentsInSync lists written and unchanged agent copies, by the shared path rule, and excludes a disabled agent', async () => {
    const first = await reconcile();
    // Written this pass.
    expect(row(first, 'codex').agentsInSync?.sort()).toEqual(
      [CODEX_ONE, CODEX_TWO].sort(),
    );
    expect(row(first, 'copilot').agentsInSync?.sort()).toEqual(
      [COPILOT_ONE, COPILOT_TWO].sort(),
    );

    // Unchanged on the next pass, and on a read-only verify.
    for (const health of [await reconcile(), await verify()]) {
      expect(row(health, 'codex').agentsInSync?.sort()).toEqual(
        [CODEX_ONE, CODEX_TWO].sort(),
      );
    }

    const disabled = await reconcile(['agent-two']);
    for (const id of ['codex', 'copilot'] as const) {
      expect(row(disabled, id).agentsInSync).toEqual([
        harnessAgentRelPath(id, 'agent-one'),
      ]);
    }
    expect(row(await verify(['agent-two']), 'codex').agentsInSync).toEqual([
      CODEX_ONE,
    ]);
  });
});
