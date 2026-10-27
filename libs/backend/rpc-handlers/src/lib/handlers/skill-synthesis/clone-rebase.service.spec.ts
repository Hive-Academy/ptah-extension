/**
 * CloneRebaseService (TASK_2026_701 B12): upstream resolution shared with
 * `skillSynthesis:rebaseClone`, and the approval re-digest (A21,
 * A-rebase-lock) that runs immediately before the rebase write.
 */
import 'reflect-metadata';

jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: { Node: 'node', General: 'general', Unknown: 'unknown' },
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
}));

import { join, resolve } from 'node:path';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  SKILL_SYNTHESIS_TOKENS,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
} from '@ptah-extension/skill-synthesis';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { resolveHarnessWorkspaceRoot } from '@ptah-extension/harness-sync';
import { CloneRebaseService } from './clone-rebase.service';

const PLUGINS = resolve('/home/.ptah/plugins');
const ACME_PATH = join(PLUGINS, 'external', 'acme', 'toolkit', 'toolkit');
const SCOPE = resolveHarnessWorkspaceRoot('/workspace/project');
const DIGEST_A = 'sha256:aaaa';
const DIGEST_B = 'sha256:bbbb';

const row = {
  slug: 'api-design',
  kind: 'skill' as const,
  userPath: '/home/.ptah/user/skills/api-design',
  originPluginId: 'toolkit',
  originVersion: '1.0.0',
  sourceHash: 'sha256:src',
  cloneStatus: 'diverged' as const,
  diverged: true,
  historyDir: null,
  lastEnhancedAt: null,
  candidateId: null,
  pendingSourceHash: 'sha256:pending',
  createdAt: 1,
  updatedAt: 1,
};

function okResult(kind: string, slug: string) {
  return { kind, slug, sourceHash: 'sha256:new', snapshotPath: '/snap', failed: false };
}

function build(options: { withRegistry?: boolean; withLoader?: boolean } = {}) {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const registry = {
    getBySlug: jest.fn().mockReturnValue(row),
    setDiverged: jest.fn(),
    setPending: jest.fn(),
  };
  const mirror = {
    rebaseClone: jest.fn().mockResolvedValue(okResult('skill', 'api-design')),
    readCloneEditState: jest.fn().mockResolvedValue({
      exists: true,
      edited: true,
      pluginId: 'toolkit',
      contentDigest: DIGEST_A,
    }),
  };
  const contentDownload = { getPluginsPath: jest.fn().mockReturnValue(PLUGINS) };
  const pluginLoader = {
    getPluginSourceDescriptors: jest.fn().mockReturnValue({
      [ACME_PATH]: { sourceRef: 'external:acme/toolkit/toolkit', label: 'Acme Toolkit' },
    }),
  };

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    createMockWorkspaceProvider({ folders: ['/workspace/project'] }),
  );
  if (options.withRegistry !== false) {
    child.registerInstance(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, registry);
  }
  child.registerInstance(USER_LAYER_MIRROR_SERVICE_TOKEN, mirror);
  child.registerInstance(PLATFORM_TOKENS.CONTENT_DOWNLOAD, contentDownload);
  if (options.withLoader !== false) {
    child.registerInstance(SDK_TOKENS.SDK_PLUGIN_LOADER, pluginLoader);
  }
  return {
    service: child.resolve(CloneRebaseService),
    registry,
    mirror,
    pluginLoader,
  };
}

describe('CloneRebaseService — upstream resolution', () => {
  it('falls back to <pluginsPath>/<originPluginId> for a clone with no sourceRef', async () => {
    const { service, mirror, registry } = build();
    const outcome = await service.rebase('skill', 'api-design');

    expect(outcome).toEqual({ status: 'completed', result: okResult('skill', 'api-design') });
    expect(mirror.rebaseClone).toHaveBeenCalledWith({
      kind: 'skill',
      slug: 'api-design',
      sourceDir: join(PLUGINS, 'toolkit', 'skills', 'api-design'),
      workspaceRoot: SCOPE,
    });
    expect(registry.setDiverged).toHaveBeenCalledWith('skill', 'api-design', false);
    expect(registry.setPending).toHaveBeenCalledWith('skill', 'api-design', null);
  });

  it('resolves an external plugin clone by sourceRef, never by basename', async () => {
    const { service, mirror } = build();
    mirror.readCloneEditState.mockResolvedValue({
      exists: true,
      edited: true,
      pluginId: 'toolkit',
      sourceRef: 'external:acme/toolkit/toolkit',
      contentDigest: DIGEST_A,
    });

    await service.rebase('skill', 'api-design');

    expect(mirror.rebaseClone).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDir: join(ACME_PATH, 'skills', 'api-design'),
      }),
    );
  });

  it('addresses agent clones under the given scope root', async () => {
    const { service, mirror, registry } = build();
    registry.getBySlug.mockReturnValue({ ...row, kind: 'agent', slug: 'reviewer', originPluginId: null });
    mirror.readCloneEditState.mockResolvedValue(null);
    const scope = resolve('/repos/other');

    await service.rebase('agent', 'reviewer', { scopeRoot: scope });

    expect(mirror.readCloneEditState).toHaveBeenCalledWith('agent', 'reviewer', scope);
    expect(mirror.rebaseClone).toHaveBeenCalledWith({
      kind: 'agent',
      slug: 'reviewer',
      sourceDir: join(scope, '.claude', 'agents', 'reviewer.md'),
      workspaceRoot: scope,
    });
  });

  it('reports unavailable, not-found and source-unavailable without writing', async () => {
    const noRegistry = build({ withRegistry: false });
    await expect(noRegistry.service.rebase('skill', 'api-design')).resolves.toEqual({ status: 'unavailable' });

    const missing = build();
    missing.registry.getBySlug.mockReturnValue(null);
    await expect(missing.service.rebase('skill', 'api-design')).resolves.toEqual({ status: 'not-found' });

    const poisoned = build();
    poisoned.registry.getBySlug.mockReturnValue({ ...row, originPluginId: '../../etc' });
    await expect(poisoned.service.rebase('skill', 'api-design')).resolves.toEqual({ status: 'source-unavailable' });

    for (const { mirror } of [noRegistry, missing, poisoned]) {
      expect(mirror.rebaseClone).not.toHaveBeenCalled();
    }
  });

  it('leaves the registry alone when the mirror reports a failed rebase', async () => {
    const { service, mirror, registry } = build();
    mirror.rebaseClone.mockResolvedValue({ ...okResult('skill', 'api-design'), failed: true, reason: 'source-missing' });

    const outcome = await service.rebase('skill', 'api-design');

    expect(outcome).toMatchObject({ status: 'completed', result: { failed: true } });
    expect(registry.setDiverged).not.toHaveBeenCalled();
  });

  it('falls back to the plugin id when live descriptors cannot be read', async () => {
    const { service, mirror, pluginLoader } = build();
    pluginLoader.getPluginSourceDescriptors.mockImplementation(() => {
      throw new Error('loader exploded');
    });
    mirror.readCloneEditState.mockResolvedValue({
      exists: true,
      edited: true,
      pluginId: 'toolkit',
      sourceRef: 'external:acme/toolkit/toolkit',
      contentDigest: DIGEST_A,
    });

    await service.rebase('skill', 'api-design');

    expect(mirror.rebaseClone).toHaveBeenCalledWith(
      expect.objectContaining({ sourceDir: join(PLUGINS, 'toolkit', 'skills', 'api-design') }),
    );
  });
});

describe('CloneRebaseService — approval digest (A21)', () => {
  it('rebases while the clone still has the approved digest', async () => {
    const { service, mirror } = build();
    const outcome = await service.rebase('skill', 'api-design', { expectedDigest: DIGEST_A });
    expect(outcome.status).toBe('completed');
    expect(mirror.rebaseClone).toHaveBeenCalledTimes(1);
  });

  it('edited A at plan, edited B before confirm: kept as changed-since-approval', async () => {
    const { service, mirror } = build();
    mirror.readCloneEditState.mockResolvedValue({
      exists: true,
      edited: true,
      pluginId: 'toolkit',
      contentDigest: DIGEST_B,
    });
    await expect(
      service.rebase('skill', 'api-design', { expectedDigest: DIGEST_A }),
    ).resolves.toEqual({ status: 'changed-since-approval' });
    expect(mirror.rebaseClone).not.toHaveBeenCalled();
  });

  it('deleted after the plan: kept as changed-since-approval', async () => {
    const { service, mirror } = build();
    mirror.readCloneEditState.mockResolvedValue({
      exists: false,
      edited: false,
      pluginId: 'toolkit',
      contentDigest: null,
    });
    await expect(
      service.rebase('skill', 'api-design', { expectedDigest: DIGEST_A }),
    ).resolves.toEqual({ status: 'changed-since-approval' });
    expect(mirror.rebaseClone).not.toHaveBeenCalled();
  });

  it('deleted then recreated with other content: kept as changed-since-approval', async () => {
    const { service, mirror } = build();
    mirror.readCloneEditState.mockResolvedValue({
      exists: true,
      edited: true,
      pluginId: 'toolkit',
      contentDigest: 'sha256:recreated',
    });
    await expect(
      service.rebase('skill', 'api-design', { expectedDigest: DIGEST_A }),
    ).resolves.toEqual({ status: 'changed-since-approval' });
  });

  it('unreadable after the plan (body or sidecar): kept as changed-since-approval', async () => {
    const unreadableBody = build();
    unreadableBody.mirror.readCloneEditState.mockResolvedValue({
      exists: true,
      edited: true,
      pluginId: 'toolkit',
      contentDigest: null,
    });
    await expect(
      unreadableBody.service.rebase('skill', 'api-design', { expectedDigest: DIGEST_A }),
    ).resolves.toEqual({ status: 'changed-since-approval' });

    const unreadableSidecar = build();
    unreadableSidecar.mirror.readCloneEditState.mockRejectedValue(new Error('EACCES'));
    await expect(
      unreadableSidecar.service.rebase('skill', 'api-design', { expectedDigest: DIGEST_A }),
    ).resolves.toEqual({ status: 'changed-since-approval' });

    expect(unreadableBody.mirror.rebaseClone).not.toHaveBeenCalled();
    expect(unreadableSidecar.mirror.rebaseClone).not.toHaveBeenCalled();
  });

  it('edited while the install is in flight: the re-digest at apply time sees it', async () => {
    const { service, mirror } = build();
    // The plan read A; by the time the install confirms, the user saved B.
    mirror.readCloneEditState
      .mockResolvedValueOnce({ exists: true, edited: true, pluginId: 'toolkit', contentDigest: DIGEST_B });
    await expect(
      service.rebase('skill', 'api-design', { expectedDigest: DIGEST_A }),
    ).resolves.toEqual({ status: 'changed-since-approval' });
    expect(mirror.rebaseClone).not.toHaveBeenCalled();
  });
});
