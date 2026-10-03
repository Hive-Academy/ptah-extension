import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  classifyAgentModelValue,
  isAgentModelEmittable,
  matchesAgentModelSyntax,
  type AgentModelLayers,
} from '@ptah-extension/shared';
import { HarnessManifestBuilder } from '../manifest/harness-manifest.builder';
import { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import { ManagedManifestStore } from '../manifest-store/managed-manifest';
import {
  createPluginConfigSourceResolver,
  defaultHarnessSourceLayout,
  scopeAgentsRoot,
} from '../sources/plugin-config-source-resolver';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import { createCodexTarget } from './rival-targets';

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: jest.fn(),
}));

describe('rival targets — agent model reconciliation', () => {
  let tempRoot: string;
  let tempHome: string;
  let ws: string;
  let oldCodexHome: string | undefined;
  let layers: AgentModelLayers;
  const slug = 'backend-developer';
  const copyRel = `.codex/agents/${slug}.toml`;
  const legacyCopy =
    '# source: ptah\nname = "backend-developer"\ndescription = "an agent"\ndeveloper_instructions = """\ninstructions\n"""\n';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'harness-agent-model-'));
    tempHome = join(tempRoot, 'home');
    ws = join(tempRoot, 'workspace');
    mkdirSync(tempHome, { recursive: true });
    mkdirSync(ws, { recursive: true });
    jest.mocked(homedir).mockReturnValue(tempHome);
    oldCodexHome = process.env['CODEX_HOME'];
    delete process.env['CODEX_HOME'];
    new HarnessStateStore().save(ws, { version: 1, agentSyncEnabled: true });
    const { agentsRoot } = scopeAgentsRoot(defaultHarnessSourceLayout(), ws);
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(
      join(agentsRoot, `${slug}.md`),
      `---\nname: ${slug}\ndescription: "an agent"\nmodel: opus\n---\ninstructions\n`,
      'utf-8',
    );
    layers = {};
  });

  afterEach(() => {
    if (oldCodexHome === undefined) delete process.env['CODEX_HOME'];
    else process.env['CODEX_HOME'] = oldCodexHome;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function reconciler(withModels = true): HarnessReconcilerService {
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const store = new ManagedManifestStore((message, detail) =>
      logger.warn(message, detail),
    );
    const sourceResolver = createPluginConfigSourceResolver(
      () => ({
        resolveCurrentPluginPaths: () => [],
        getDisabledSkillIds: () => [],
        getWorkspacePluginConfig: () => ({}),
      }),
      undefined,
      undefined,
      withModels
        ? () => ({
            layersForPath: (root: string) => {
              expect(root).toBe(ws);
              return layers;
            },
          })
        : undefined,
    );
    return new HarnessReconcilerService(
      logger as unknown as Logger,
      new HarnessManifestBuilder((message, detail) =>
        logger.warn(message, detail),
      ),
      store,
      sourceResolver,
      [
        createCodexTarget({
          manifestStore: store,
          detector: { isInstalled: async (target) => target === 'codex' },
          homeDir: tempHome,
        }),
      ],
    );
  }

  it('rewrites a changed Codex model without reporting a local edit, using the normalized root', async () => {
    layers = { workspace: { [slug]: { codex: 'model-one' } } };
    const service = reconciler();
    const nested = join(ws, 'src', 'nested');
    mkdirSync(nested, { recursive: true });
    await service.reconcile(nested, { mode: 'full', reason: 'initial model' });
    expect(readFileSync(join(ws, copyRel), 'utf-8')).toContain(
      'model = "model-one"',
    );

    layers = { workspace: { [slug]: { codex: 'model-two' } } };
    const result = await service.reconcile(nested, {
      mode: 'full',
      reason: 'changed model',
    });
    const copy = readFileSync(join(ws, copyRel), 'utf-8');
    expect(copy).toContain('model = "model-two"');
    expect(copy).not.toContain('model-one');
    expect(
      result.targets.find((target) => target.target === 'codex')
        ?.overwrittenLocalEdit,
    ).toEqual([]);
  });

  it('emits a provider-listed Codex value even when it fails the syntax heuristic', async () => {
    const model = 'provider model preview';
    expect(matchesAgentModelSyntax('codex', model)).toBe(false);
    expect(classifyAgentModelValue('codex', model, [{ id: model }])).toBe(
      'listed',
    );
    expect(isAgentModelEmittable('codex', model)).toBe(true);
    layers = { workspace: { [slug]: { codex: model } } };
    await reconciler().reconcile(ws, { mode: 'full', reason: 'listed model' });
    expect(readFileSync(join(ws, copyRel), 'utf-8')).toContain(
      `model = "${model}"`,
    );
  });

  it('preserves the exact pre-model Codex bytes without a getter or with empty layers', async () => {
    await reconciler(false).reconcile(ws, {
      mode: 'full',
      reason: 'no getter',
    });
    expect(readFileSync(join(ws, copyRel), 'utf-8')).toBe(legacyCopy);
    const result = await reconciler().reconcile(ws, {
      mode: 'full',
      reason: 'empty layers',
    });
    expect(readFileSync(join(ws, copyRel), 'utf-8')).toBe(legacyCopy);
    expect(
      result.targets.find((target) => target.target === 'codex')
        ?.overwrittenLocalEdit,
    ).toEqual([]);
  });
});
