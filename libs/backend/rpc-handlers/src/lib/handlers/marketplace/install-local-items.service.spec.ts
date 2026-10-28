/**
 * InstallLocalItemsService (TASK_2026_701 B12, A21): family-bound apply of
 * replace decisions through each item's own route, with the approval digest
 * re-checked before any mutation.
 *
 * The file route's re-digest under the workspace lock is proved in
 * harness-sync's `blocked-repair.service.spec.ts`; here it is proved that the
 * server-held digest reaches it and that its outcomes are reported. The clone
 * route's re-digest is proved in `clone-rebase.service.spec.ts`. The
 * agent-source route runs the real guarded writer on an in-memory file system.
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
import {
  createMockFileSystemProvider,
  type MockFileSystemProvider,
} from '@ptah-extension/platform-core/testing';
import { HARNESS_SYNC_TOKENS, hashContent } from '@ptah-extension/harness-sync';
import {
  AGENT_GENERATION_TOKENS,
  AgentFileWriterService,
} from '@ptah-extension/agent-generation';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { HarnessRepairPathResult } from '@ptah-extension/shared';
import {
  CloneRebaseService,
  type CloneRebaseOutcome,
} from '../skill-synthesis/clone-rebase.service';
import {
  LocalItemApprovals,
  type LocalItemApprovalInput,
} from './local-item-approvals';
import { InstallLocalItemsService } from './install-local-items.service';

const ROOT = resolve('/workspace/acme-app');
const ACME_PATH = resolve('/home/user/.ptah/plugins/external/acme/toolkit/toolkit');
const ACME_REF = 'external:acme/toolkit/toolkit';
const AGENT_TARGET = join(ROOT, '.claude', 'agents', 'reviewer.md');
const PLUGIN_AGENT = join(ACME_PATH, 'agents', 'reviewer.md');
const PLUGIN_TEXT = '---\nname: reviewer\n---\nPlugin reviewer.\n';
const LOCAL_A = '---\nname: reviewer\n---\nMy reviewer, edit A.\n';
const LOCAL_B = '---\nname: reviewer\n---\nMy reviewer, edit B.\n';

function setFile(fs: MockFileSystemProvider, path: string, text: string): void {
  fs.__state.files.set(path, new TextEncoder().encode(text));
}

function readText(fs: MockFileSystemProvider, path: string): string | null {
  const bytes = fs.__state.files.get(path);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

function build() {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const repair = {
    repair: jest.fn(async (_root: string, paths: Array<{ target: string; relPath: string }>) => ({
      paths: paths.map(
        (p): HarnessRepairPathResult => ({
          target: 'claude',
          relPath: p.relPath,
          outcome: 'repaired',
        }),
      ),
      repaired: paths.length,
      health: null,
    })),
  };
  const rebaseCompleted = async (
    ..._args: Parameters<CloneRebaseService['rebase']>
  ): Promise<CloneRebaseOutcome> => ({
    status: 'completed',
    result: { kind: 'skill', slug: 'api-design', sourceHash: 'sha256:new', snapshotPath: null },
  });
  const cloneRebase = { rebase: jest.fn(rebaseCompleted) };
  const pluginLoader = {
    getPluginSourceDescriptors: jest.fn(() => ({
      [ACME_PATH]: { sourceRef: ACME_REF, label: 'Acme Toolkit' },
    })),
  };
  const fs = createMockFileSystemProvider();
  setFile(fs, PLUGIN_AGENT, PLUGIN_TEXT);

  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, logger);
  child.registerInstance(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, fs);
  child.registerInstance(HARNESS_SYNC_TOKENS.BLOCKED_REPAIR, repair);
  child.registerInstance(SDK_TOKENS.SDK_PLUGIN_LOADER, pluginLoader);
  child.register(AGENT_GENERATION_TOKENS.AGENT_FILE_WRITER_SERVICE, {
    useClass: AgentFileWriterService,
  });
  child.register<Pick<CloneRebaseService, 'rebase'>>(CloneRebaseService, {
    useValue: cloneRebase,
  });
  child.registerSingleton(LocalItemApprovals);

  return {
    service: child.resolve(InstallLocalItemsService),
    approvals: child.resolve(LocalItemApprovals),
    repair,
    cloneRebase,
    pluginLoader,
    fs,
  };
}

function fileItem(overrides: Partial<LocalItemApprovalInput> = {}): LocalItemApprovalInput {
  return {
    harnessRoot: ROOT,
    family: 'external',
    kind: 'owned-edited',
    target: 'claude',
    relPath: '.claude/skills/api-design',
    sourceRef: ACME_REF,
    digest: 'fingerprint-a',
    ...overrides,
  };
}

function cloneItem(overrides: Partial<LocalItemApprovalInput> = {}): LocalItemApprovalInput {
  return {
    harnessRoot: ROOT,
    family: 'external',
    kind: 'library-clone',
    relPath: 'skills/api-design',
    cloneKind: 'skill',
    slug: 'api-design',
    sourceRef: ACME_REF,
    digest: 'sha256:clone-a',
    ...overrides,
  };
}

function agentItem(overrides: Partial<LocalItemApprovalInput> = {}): LocalItemApprovalInput {
  return {
    harnessRoot: ROOT,
    family: 'plugin-agent',
    kind: 'agent-source',
    relPath: '.claude/agents/reviewer.md',
    cloneKind: 'agent',
    slug: 'reviewer',
    sourceRef: ACME_REF,
    digest: hashContent(LOCAL_A),
    ...overrides,
  };
}

describe('InstallLocalItemsService — approval binding', () => {
  it('reports unknown ids and does nothing for them', async () => {
    const { service, repair, cloneRebase } = build();
    const report = await service.apply({
      family: 'external',
      harnessRoot: ROOT,
      approvalIds: ['not-issued'],
    });
    expect(report).toEqual({ replaced: [], kept: [], unknown: ['not-issued'] });
    expect(repair.repair).not.toHaveBeenCalled();
    expect(cloneRebase.rebase).not.toHaveBeenCalled();
  });

  it('is family-bound: another family cannot replace through its route', async () => {
    const { service, approvals, repair } = build();
    const id = approvals.register(fileItem({ family: 'skills-sh' }));

    const crossFamily = await service.apply({ family: 'external', harnessRoot: ROOT, approvalIds: [id] });
    expect(crossFamily.unknown).toEqual([id]);
    expect(repair.repair).not.toHaveBeenCalled();

    const ownFamily = await service.apply({ family: 'skills-sh', harnessRoot: ROOT, approvalIds: [id] });
    expect(ownFamily.replaced.map((item) => item.approvalId)).toEqual([id]);
  });

  it('is root-bound and single-use', async () => {
    const { service, approvals } = build();
    const id = approvals.register(fileItem());
    const otherRoot = await service.apply({
      family: 'external',
      harnessRoot: resolve('/workspace/other'),
      approvalIds: [id],
    });
    expect(otherRoot.unknown).toEqual([id]);

    await service.apply({ family: 'external', harnessRoot: ROOT, approvalIds: [id, id] });
    const again = await service.apply({ family: 'external', harnessRoot: ROOT, approvalIds: [id] });
    expect(again.unknown).toEqual([id]);
  });
});

describe('InstallLocalItemsService — destination files', () => {
  it('repairs with the server-held digest and reports replaced', async () => {
    const { service, approvals, repair } = build();
    const id = approvals.register(fileItem());

    const report = await service.apply({ family: 'external', harnessRoot: ROOT, approvalIds: [id] });

    expect(repair.repair).toHaveBeenCalledWith(ROOT, [
      { target: 'claude', relPath: '.claude/skills/api-design', expectedDigest: 'fingerprint-a' },
    ]);
    expect(report.replaced).toEqual([
      { approvalId: id, family: 'external', target: 'claude', relPath: '.claude/skills/api-design', reason: 'owned-edited' },
    ]);
    expect(report.kept).toEqual([]);
  });

  it('keeps a file the repair found changed since approval (A then B, deleted, recreated, unreadable)', async () => {
    const { service, approvals, repair } = build();
    repair.repair.mockResolvedValueOnce({
      paths: [{ target: 'claude', relPath: '.claude/skills/api-design', outcome: 'changed-since-approval' }],
      repaired: 0,
      health: null,
    });
    const id = approvals.register(fileItem());

    const report = await service.apply({ family: 'external', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.replaced).toEqual([]);
    expect(report.kept).toEqual([
      expect.objectContaining({ approvalId: id, reason: 'changed-since-approval' }),
    ]);
  });

  it('keeps a file with the route error when the repair did not land', async () => {
    const { service, approvals, repair } = build();
    repair.repair.mockResolvedValueOnce({
      paths: [{ target: 'claude', relPath: '.claude/skills/api-design', outcome: 'restored', reason: 'write failed' }],
      repaired: 0,
      health: null,
    });
    const id = approvals.register(fileItem({ kind: 'unowned' }));

    const report = await service.apply({ family: 'external', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.kept).toEqual([
      expect.objectContaining({ approvalId: id, reason: 'unowned', error: 'write failed' }),
    ]);
  });

  it('keeps every file with the error when the repair throws', async () => {
    const { service, approvals, repair } = build();
    repair.repair.mockRejectedValueOnce(new Error('lock timeout'));
    const id = approvals.register(fileItem());

    const report = await service.apply({ family: 'external', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.kept).toEqual([expect.objectContaining({ approvalId: id, error: 'lock timeout' })]);
  });

  it('never replaces an unreadable item or one that had no digest when offered', async () => {
    const { service, approvals, repair } = build();
    const unreadable = approvals.register(fileItem({ kind: 'unreadable', digest: null }));
    const noDigest = approvals.register(fileItem({ relPath: '.claude/skills/other', digest: null }));

    const report = await service.apply({
      family: 'external',
      harnessRoot: ROOT,
      approvalIds: [unreadable, noDigest],
    });

    expect(repair.repair).not.toHaveBeenCalled();
    expect(report.kept.map((item) => [item.approvalId, item.reason])).toEqual([
      [unreadable, 'unreadable'],
      [noDigest, 'unreadable'],
    ]);
  });
});

describe('InstallLocalItemsService — Library clones', () => {
  it('rebases with the approval digest under the harness-root scope', async () => {
    const { service, approvals, cloneRebase } = build();
    const id = approvals.register(cloneItem());

    const report = await service.apply({ family: 'external', harnessRoot: ROOT, approvalIds: [id] });

    expect(cloneRebase.rebase).toHaveBeenCalledWith('skill', 'api-design', {
      scopeRoot: ROOT,
      expectedDigest: 'sha256:clone-a',
    });
    expect(report.replaced).toEqual([
      { approvalId: id, family: 'external', relPath: 'skills/api-design', reason: 'owned-edited' },
    ]);
  });

  it('keeps a clone that changed since approval or was deleted', async () => {
    const { service, approvals, cloneRebase } = build();
    cloneRebase.rebase
      .mockResolvedValueOnce({ status: 'changed-since-approval' })
      .mockResolvedValueOnce({ status: 'not-found' });
    const changed = approvals.register(cloneItem());
    const deleted = approvals.register(cloneItem({ slug: 'db-review', relPath: 'skills/db-review' }));

    const report = await service.apply({
      family: 'external',
      harnessRoot: ROOT,
      approvalIds: [changed, deleted],
    });

    expect(report.kept.map((item) => item.reason)).toEqual([
      'changed-since-approval',
      'changed-since-approval',
    ]);
  });

  it('keeps a clone with the mirror error when the rebase failed', async () => {
    const { service, approvals, cloneRebase } = build();
    cloneRebase.rebase.mockResolvedValueOnce({
      status: 'completed',
      result: {
        kind: 'skill',
        slug: 'api-design',
        sourceHash: 'sha256:old',
        snapshotPath: null,
        failed: true,
        reason: 'source-missing',
      },
    });
    const id = approvals.register(cloneItem());

    const report = await service.apply({ family: 'external', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.kept).toEqual([expect.objectContaining({ approvalId: id, error: 'source-missing' })]);
  });
});

describe('InstallLocalItemsService — agent-source (real guarded writer)', () => {
  it('replaces the shadowing workspace agent with the plugin agent', async () => {
    const { service, approvals, fs } = build();
    setFile(fs, AGENT_TARGET, LOCAL_A);
    const id = approvals.register(agentItem());

    const report = await service.apply({ family: 'plugin-agent', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.replaced).toEqual([
      { approvalId: id, family: 'plugin-agent', relPath: '.claude/agents/reviewer.md', reason: 'shadowed' },
    ]);
    expect(readText(fs, AGENT_TARGET)).toBe(PLUGIN_TEXT);
  });

  it('edited A at plan, edited B before confirm: kept byte-identical', async () => {
    const { service, approvals, fs } = build();
    setFile(fs, AGENT_TARGET, LOCAL_A);
    const id = approvals.register(agentItem());
    setFile(fs, AGENT_TARGET, LOCAL_B);

    const report = await service.apply({ family: 'plugin-agent', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.kept).toEqual([expect.objectContaining({ approvalId: id, reason: 'changed-since-approval' })]);
    expect(readText(fs, AGENT_TARGET)).toBe(LOCAL_B);
  });

  it('deleted after the plan: kept, nothing written', async () => {
    const { service, approvals, fs } = build();
    const id = approvals.register(agentItem());

    const report = await service.apply({ family: 'plugin-agent', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.kept).toEqual([expect.objectContaining({ reason: 'changed-since-approval' })]);
    expect(readText(fs, AGENT_TARGET)).toBeNull();
  });

  it('deleted then recreated with other content: kept byte-identical', async () => {
    const { service, approvals, fs } = build();
    setFile(fs, AGENT_TARGET, LOCAL_A);
    const id = approvals.register(agentItem());
    fs.__state.files.delete(AGENT_TARGET);
    setFile(fs, AGENT_TARGET, LOCAL_B);

    const report = await service.apply({ family: 'plugin-agent', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.kept).toEqual([expect.objectContaining({ reason: 'changed-since-approval' })]);
    expect(readText(fs, AGENT_TARGET)).toBe(LOCAL_B);
  });

  it('unreadable after the plan: kept, nothing written', async () => {
    const { service, approvals, fs } = build();
    setFile(fs, AGENT_TARGET, LOCAL_A);
    const id = approvals.register(agentItem());
    fs.readFile.mockImplementation(async (path: string) => {
      if (path === AGENT_TARGET) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      }
      const bytes = fs.__state.files.get(path);
      if (!bytes) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return new TextDecoder().decode(bytes);
    });

    const report = await service.apply({ family: 'plugin-agent', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.kept).toEqual([expect.objectContaining({ reason: 'changed-since-approval' })]);
    expect(readText(fs, AGENT_TARGET)).toBe(LOCAL_A);
  });

  it('edited while the install is in flight: the writer re-check keeps it', async () => {
    const { service, approvals, fs } = build();
    setFile(fs, AGENT_TARGET, LOCAL_A);
    const id = approvals.register(agentItem());
    // The user saves B after the existence check and before the writer reads.
    fs.exists.mockImplementationOnce(async () => {
      setFile(fs, AGENT_TARGET, LOCAL_B);
      return true;
    });

    const report = await service.apply({ family: 'plugin-agent', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.kept).toEqual([expect.objectContaining({ reason: 'changed-since-approval' })]);
    expect(readText(fs, AGENT_TARGET)).toBe(LOCAL_B);
  });

  it('keeps the agent when its plugin is no longer installed', async () => {
    const { service, approvals, fs, pluginLoader } = build();
    setFile(fs, AGENT_TARGET, LOCAL_A);
    pluginLoader.getPluginSourceDescriptors.mockReturnValue({});
    const id = approvals.register(agentItem());

    const report = await service.apply({ family: 'plugin-agent', harnessRoot: ROOT, approvalIds: [id] });

    expect(report.kept).toEqual([
      expect.objectContaining({ reason: 'shadowed', error: 'The plugin providing this agent is not installed.' }),
    ]);
    expect(readText(fs, AGENT_TARGET)).toBe(LOCAL_A);
  });
});

describe('InstallLocalItemsService — mixed decisions', () => {
  it('applies every route and reports in request order; one failure does not block others', async () => {
    const { service, approvals, repair, fs } = build();
    setFile(fs, AGENT_TARGET, LOCAL_A);
    repair.repair.mockRejectedValueOnce(new Error('lock timeout'));
    const file = approvals.register(fileItem({ family: 'plugin-agent' }));
    const agent = approvals.register(agentItem());
    const clone = approvals.register(cloneItem({ family: 'plugin-agent' }));

    const report = await service.apply({
      family: 'plugin-agent',
      harnessRoot: ROOT,
      approvalIds: [file, agent, clone],
    });

    expect(report.replaced.map((item) => item.approvalId)).toEqual([agent, clone]);
    expect(report.kept.map((item) => item.approvalId)).toEqual([file]);
  });
});
