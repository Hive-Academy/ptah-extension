/**
 * Overwriting an owned rival-CLI copy never loses a byte the user put there
 * (TASK_2026_609, Part B review findings 1 and 3).
 *
 * - Finding 3: a model-only change used to skip local-edit detection because
 *   the source hash differed, so an edited Codex copy was overwritten with no
 *   snapshot and no report.
 * - Finding 1: the copy is detached into history and decided on there, and the
 *   replacement is published with an exclusive create, so a save landing after
 *   the detach — or between plan and apply — is kept.
 *
 * Interleavings are injected deterministically: a path-filtered `rename` spy
 * on the module object the detach calls, and a wrapped `apply`.
 *
 * Source-under-test: the real `HarnessReconcilerService` over the real Codex
 * target in a temp workspace, with `os.homedir()` mocked and `CODEX_HOME`
 * cleared so no real home directory is read.
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
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AgentModelLayers,
  HarnessHealth,
  HarnessTargetHealth,
} from '@ptah-extension/shared';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import {
  createPluginConfigSourceResolver,
  defaultHarnessSourceLayout,
  scopeAgentsRoot,
} from '../sources/plugin-config-source-resolver';
import type { IHarnessTarget } from './harness-target.port';
import { createCodexTarget } from './rival-targets';

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: jest.fn(),
}));

describe('WorkspaceHarnessTarget — detach before overwrite (TASK_2026_609)', () => {
  const slug = 'backend-developer';
  const COPY = `.codex/agents/${slug}.toml`;
  const HISTORY = '.ptah/harness/.history';

  let tempRoot: string;
  let ws: string;
  let home: string;
  let savedCodexHome: string | undefined;
  let layers: AgentModelLayers;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'harness-overwrite-detach-'));
    home = join(tempRoot, 'home');
    ws = join(tempRoot, 'workspace');
    mkdirSync(home, { recursive: true });
    mkdirSync(ws, { recursive: true });
    jest.mocked(homedir).mockReturnValue(home);
    savedCodexHome = process.env['CODEX_HOME'];
    delete process.env['CODEX_HOME'];
    new HarnessStateStore().save(ws, { version: 1, agentSyncEnabled: true });
    const { agentsRoot } = scopeAgentsRoot(defaultHarnessSourceLayout(), ws);
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(
      join(agentsRoot, `${slug}.md`),
      `---\nname: ${slug}\ndescription: "an agent"\n---\ninstructions\n`,
      'utf-8',
    );
    layers = { workspace: { [slug]: { codex: 'model-one' } } };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedCodexHome === undefined) delete process.env['CODEX_HOME'];
    else process.env['CODEX_HOME'] = savedCodexHome;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------- fixtures

  /** `beforeApply` runs after the plan, right before the target applies it. */
  function reconciler(beforeApply?: () => void): HarnessReconcilerService {
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const store = new ManagedManifestStore();
    const target: IHarnessTarget = createCodexTarget({
      manifestStore: store,
      detector: { isInstalled: async (id) => id === 'codex' },
      homeDir: home,
    });
    if (beforeApply !== undefined) {
      const realApply = target.apply.bind(target);
      target.apply = async (plan, root) => {
        beforeApply();
        return realApply(plan, root);
      };
    }
    return new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder(),
      store,
      createPluginConfigSourceResolver(
        () => ({
          resolveCurrentPluginPaths: () => [],
          getDisabledSkillIds: () => [],
          getWorkspacePluginConfig: () => ({}),
        }),
        undefined,
        undefined,
        () => ({ layersForPath: () => layers }),
      ),
      [target],
    );
  }

  async function reconcile(beforeApply?: () => void): Promise<HarnessHealth> {
    return reconciler(beforeApply).reconcile(ws, {
      mode: 'full',
      reason: 'test pass',
    });
  }

  function codexRow(health: HarnessHealth): HarnessTargetHealth {
    const row = health.targets.find((target) => target.target === 'codex');
    if (row === undefined) throw new Error('no codex health row');
    return row;
  }

  function abs(relPath: string): string {
    return join(ws, ...relPath.split('/'));
  }

  function read(relPath: string): string {
    return readFileSync(abs(relPath), 'utf-8');
  }

  function ownedHash(): string | undefined {
    return new ManagedManifestStore().load(ws, 'codex').entries[COPY]?.hash;
  }

  /** Contents of every snapshot of the agent, oldest first. */
  function snapshots(): string[] {
    const dir = abs(`${HISTORY}/${slug}`);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .sort()
      .map((stamp) => read(`${HISTORY}/${slug}/${stamp}/${COPY}`));
  }

  function changeModel(): void {
    layers = { workspace: { [slug]: { codex: 'model-two' } } };
  }

  /**
   * Spy on the `rename` the detach calls. For the live copy it performs the
   * real rename, then `afterRename()` runs before anything is published.
   */
  function onDetach(afterRename: () => void): jest.SpyInstance {
    const fsPromises =
      jest.requireActual<typeof import('fs/promises')>('fs/promises');
    const realRename = fsPromises.rename;
    return jest
      .spyOn(fsPromises, 'rename')
      .mockImplementation(async (from, to) => {
        await realRename(from, to);
        if (from === abs(COPY)) afterRename();
      });
  }

  // ------------------------------------------------------------------ cases

  it('an edited Codex copy under a model-only change is snapshotted, overwritten and reported (finding 3)', async () => {
    await reconcile();
    writeFileSync(abs(COPY), 'HAND EDITED', 'utf-8');
    changeModel();

    const codex = codexRow(await reconcile());

    expect(codex.writeFailed).toEqual([]);
    expect(codex.localEdit).toEqual([COPY]);
    expect(codex.overwrittenLocalEdit).toEqual([COPY]);
    expect(read(COPY)).toContain('model = "model-two"');
    expect(snapshots()).toEqual(['HAND EDITED']);
  });

  it('an untouched Codex copy under a model change is rewritten with no snapshot and no report, as before', async () => {
    await reconcile();
    changeModel();

    const codex = codexRow(await reconcile());

    expect(codex.writeFailed).toEqual([]);
    expect(codex.localEdit).toEqual([]);
    expect(codex.overwrittenLocalEdit).toEqual([]);
    expect(read(COPY)).toContain('model = "model-two"');
    expect(read(COPY)).not.toContain('model-one');
    expect(existsSync(abs(HISTORY))).toBe(false);
  });

  it('a save landing after the detach and before the publish survives; the earlier edit stays in history (finding 1)', async () => {
    await reconcile();
    writeFileSync(abs(COPY), 'HAND EDITED', 'utf-8');
    const hashBefore = ownedHash();
    changeModel();
    onDetach(() => writeFileSync(abs(COPY), 'NEWER SAVE', 'utf-8'));

    const codex = codexRow(await reconcile());

    expect(read(COPY)).toBe('NEWER SAVE');
    expect(snapshots()).toEqual(['HAND EDITED']);
    const failure = codex.writeFailed.find((f) => f.relPath === COPY);
    expect(failure?.reason).toMatch(
      /^a new copy appeared at .* while it was being replaced; kept it; the earlier local edit is saved at /,
    );
    expect(codex.overwrittenLocalEdit).toEqual([]);
    // Still owned with the old hash, so the next pass retries.
    expect(ownedHash()).toBe(hashBefore);

    jest.restoreAllMocks();
    const retried = codexRow(await reconcile());
    expect(retried.writeFailed).toEqual([]);
    expect(retried.overwrittenLocalEdit).toEqual([COPY]);
    expect(read(COPY)).toContain('model = "model-two"');
    expect(snapshots()).toEqual(['HAND EDITED', 'NEWER SAVE']);
  });

  it('a save landing between plan and apply on an untouched copy is snapshotted and reported, not lost (finding 1)', async () => {
    await reconcile();
    changeModel();

    const codex = codexRow(
      await reconcile(() =>
        writeFileSync(abs(COPY), 'SAVED AFTER PLAN', 'utf-8'),
      ),
    );

    // The plan saw an untouched copy ...
    expect(codex.localEdit).toEqual([]);
    // ... the apply decided on what was really there.
    expect(codex.writeFailed).toEqual([]);
    expect(codex.overwrittenLocalEdit).toEqual([COPY]);
    expect(snapshots()).toEqual(['SAVED AFTER PLAN']);
    expect(read(COPY)).toContain('model = "model-two"');
  });

  it('a detach that cannot rename writes nothing and keeps the edit and its ownership for the next pass', async () => {
    await reconcile();
    writeFileSync(abs(COPY), 'HAND EDITED', 'utf-8');
    const hashBefore = ownedHash();
    changeModel();
    const fsPromises =
      jest.requireActual<typeof import('fs/promises')>('fs/promises');
    const realRename = fsPromises.rename;
    jest.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
      if (from === abs(COPY)) {
        throw Object.assign(new Error('EXDEV: cross-device link'), {
          code: 'EXDEV',
        });
      }
      return realRename(from, to);
    });

    const codex = codexRow(await reconcile());

    expect(read(COPY)).toBe('HAND EDITED');
    expect(
      codex.writeFailed.find((f) => f.relPath === COPY)?.reason,
    ).toMatch(/could not detach for overwrite: EXDEV/);
    expect(codex.overwrittenLocalEdit).toEqual([]);
    expect(ownedHash()).toBe(hashBefore);
    expect(existsSync(abs(HISTORY))).toBe(false);
  });
});
