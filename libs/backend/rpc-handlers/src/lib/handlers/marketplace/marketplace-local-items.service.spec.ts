/**
 * MarketplaceLocalItemsService — unit specs (TASK_2026_701 B12).
 *
 * The scanner, the file reader and the user-layer mirror are narrow fakes; the
 * approval registry is the real in-memory one, so each test can read back what
 * a returned `approvalId` recorded on the server.
 */
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import {
  hashContent,
  type HarnessDestination,
  type HarnessDestinationScanner,
} from '@ptah-extension/harness-sync';
import type {
  CloneEditState,
  UserLayerMirrorService,
} from '@ptah-extension/agent-generation';
import type {
  HarnessHealth,
  HarnessTargetHealth,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';

import { LocalItemApprovals } from './local-item-approvals';
import { MarketplaceLocalItemsService } from './marketplace-local-items.service';

const ROOT = '/repo';
const SOURCE_REF = 'external:dotnet/skills/dotnet';
const AGENT_TEXT = '---\nname: test-reviewer\n---\nmine';

function destination(
  overrides: Partial<HarnessDestination> &
    Pick<HarnessDestination, 'kind' | 'slug' | 'relPath' | 'state'>,
): HarnessDestination {
  return { target: 'claude', digest: 'fp:1', ...overrides };
}

function targetHealth(
  overrides: Partial<HarnessTargetHealth>,
): HarnessTargetHealth {
  return {
    target: 'claude',
    detected: true,
    missing: [],
    foreign: [],
    keptLocalEdit: [],
    removed: [],
    ...overrides,
  } as HarnessTargetHealth;
}

function health(targets: HarnessTargetHealth[]): HarnessHealth {
  return {
    workspaceRoot: ROOT,
    generatedAt: '2026-01-01T00:00:00.000Z',
    mode: 'full',
    reason: 'test',
    sources: 'ok',
    targets,
    collisions: [],
  } as HarnessHealth;
}

interface Fixture {
  service: MarketplaceLocalItemsService;
  approvals: LocalItemApprovals;
  scan: jest.Mock;
  readFile: jest.Mock;
  readCloneEditState: jest.Mock;
}

function makeFixture(
  options: { destinations?: HarnessDestination[]; withMirror?: boolean } = {},
): Fixture {
  const approvals = new LocalItemApprovals();
  const scan = jest.fn().mockResolvedValue(options.destinations ?? []);
  const readFile = jest.fn().mockResolvedValue(AGENT_TEXT);
  const readCloneEditState = jest.fn().mockResolvedValue(null);
  const scanner: Pick<HarnessDestinationScanner, 'scan'> = { scan };
  const fileSystem: Pick<IFileSystemProvider, 'readFile'> = { readFile };
  const mirror: Pick<UserLayerMirrorService, 'readCloneEditState'> = {
    readCloneEditState,
  };
  const logger: Pick<Logger, 'warn' | 'debug' | 'info' | 'error'> =
    createMockLogger();
  const service = new MarketplaceLocalItemsService(
    logger as Logger,
    approvals,
    scanner as HarnessDestinationScanner,
    fileSystem as IFileSystemProvider,
    options.withMirror === false ? null : (mirror as UserLayerMirrorService),
  );
  return { service, approvals, scan, readFile, readCloneEditState };
}

function editedClone(overrides: Partial<CloneEditState> = {}): CloneEditState {
  return {
    exists: true,
    edited: true,
    pluginId: 'dotnet',
    sourceRef: SOURCE_REF,
    contentDigest: 'sha256:clone',
    ...overrides,
  };
}

describe('MarketplaceLocalItemsService.planLocalItems', () => {
  const slugs = {
    skills: ['run-tests'],
    commands: [],
    agents: ['test-reviewer'],
  };

  it('offers unowned, owned-edited and unreadable destinations, never Ptah-owned ones', async () => {
    const f = makeFixture({
      destinations: [
        destination({
          kind: 'skill',
          slug: 'run-tests',
          relPath: '.claude/skills/run-tests',
          state: 'owned-edited',
          digest: 'fp:edited',
        }),
        destination({
          kind: 'skill',
          slug: 'run-tests',
          target: 'codex',
          relPath: '.agents/skills/run-tests',
          state: 'unowned',
          digest: 'fp:rival',
        }),
        destination({
          kind: 'skill',
          slug: 'run-tests',
          target: 'cursor',
          relPath: '.cursor/skills/run-tests',
          state: 'unreadable',
          digest: null,
        }),
        destination({
          kind: 'skill',
          slug: 'run-tests',
          target: 'copilot',
          relPath: '.github/skills/run-tests',
          state: 'owned-unmodified',
        }),
        destination({
          kind: 'skill',
          slug: 'run-tests',
          target: 'opencode',
          relPath: '.opencode/skills/run-tests',
          state: 'absent',
          digest: null,
        }),
      ],
    });

    const items = await f.service.planLocalItems({
      family: 'external',
      harnessRoot: ROOT,
      sourceRef: SOURCE_REF,
      slugs: { skills: ['run-tests'], commands: [], agents: [] },
      ttlMs: 60_000,
    });

    expect(items.map((item) => [item.relPath, item.kind])).toEqual([
      ['.claude/skills/run-tests', 'owned-edited'],
      ['.agents/skills/run-tests', 'unowned'],
      ['.cursor/skills/run-tests', 'unreadable'],
    ]);
    const edited = f.approvals.peek(items[0].approvalId, 'external', ROOT);
    expect(edited).toMatchObject({
      digest: 'fp:edited',
      target: 'claude',
      sourceRef: SOURCE_REF,
    });
    // An unreadable item is recorded with no digest: it can never be replaced.
    expect(
      f.approvals.peek(items[2].approvalId, 'external', ROOT)?.digest,
    ).toBeNull();
    // Only the id leaves the server.
    expect(Object.keys(items[0]).sort()).toEqual(
      ['approvalId', 'family', 'kind', 'relPath', 'target'].sort(),
    );
  });

  it('turns a workspace agent at the Claude agent path into an agent-source item hashed by text', async () => {
    const f = makeFixture({
      destinations: [
        destination({
          kind: 'agent',
          slug: 'test-reviewer',
          relPath: '.claude/agents/test-reviewer.md',
          state: 'unowned',
        }),
        destination({
          kind: 'agent',
          slug: 'test-reviewer',
          target: 'cursor',
          relPath: '.cursor/agents/test-reviewer.md',
          state: 'owned-edited',
          digest: 'fp:cursor',
        }),
      ],
    });

    const items = await f.service.planLocalItems({
      family: 'external',
      harnessRoot: ROOT,
      sourceRef: SOURCE_REF,
      slugs,
      ttlMs: 60_000,
    });

    expect(items.map((item) => item.kind)).toEqual([
      'agent-source',
      'owned-edited',
    ]);
    expect(
      f.approvals.peek(items[0].approvalId, 'external', ROOT),
    ).toMatchObject({
      kind: 'agent-source',
      cloneKind: 'agent',
      slug: 'test-reviewer',
      digest: hashContent(AGENT_TEXT),
    });
  });

  it('offers an unreadable workspace agent as unreadable', async () => {
    const f = makeFixture({
      destinations: [
        destination({
          kind: 'agent',
          slug: 'test-reviewer',
          relPath: '.claude/agents/test-reviewer.md',
          state: 'owned-edited',
        }),
      ],
    });
    f.readFile.mockRejectedValue(new Error('EACCES'));

    const items = await f.service.planLocalItems({
      family: 'external',
      harnessRoot: ROOT,
      sourceRef: SOURCE_REF,
      slugs,
      ttlMs: 60_000,
    });

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('unreadable');
  });

  it('offers edited Library clones of this source only, never by basename', async () => {
    const f = makeFixture();
    f.readCloneEditState.mockImplementation(
      async (kind: string, slug: string) => {
        if (kind === 'skill' && slug === 'run-tests') return editedClone();
        if (kind === 'agent' && slug === 'test-reviewer') {
          // Same basename, another plugin's clone.
          return editedClone({ sourceRef: 'external:other/repo/dotnet' });
        }
        return null;
      },
    );

    const items = await f.service.planLocalItems({
      family: 'external',
      harnessRoot: ROOT,
      sourceRef: SOURCE_REF,
      slugs,
      ttlMs: 60_000,
    });

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'library-clone',
        relPath: 'skills/run-tests',
      }),
    ]);
    expect('target' in items[0]).toBe(false);
    expect(f.readCloneEditState).toHaveBeenCalledWith(
      'skill',
      'run-tests',
      ROOT,
    );
    expect(
      f.approvals.peek(items[0].approvalId, 'external', ROOT),
    ).toMatchObject({
      cloneKind: 'skill',
      slug: 'run-tests',
      digest: 'sha256:clone',
    });
  });

  it('skips unedited clones and survives an unreadable clone origin', async () => {
    const f = makeFixture();
    f.readCloneEditState
      .mockResolvedValueOnce(editedClone({ edited: false }))
      .mockRejectedValueOnce(new Error('EACCES'));

    const items = await f.service.planLocalItems({
      family: 'external',
      harnessRoot: ROOT,
      sourceRef: SOURCE_REF,
      slugs,
      ttlMs: 60_000,
    });

    expect(items).toEqual([]);
  });

  it('offers no clones on a host without the Library', async () => {
    const f = makeFixture({ withMirror: false });

    const items = await f.service.planLocalItems({
      family: 'external',
      harnessRoot: ROOT,
      sourceRef: SOURCE_REF,
      slugs,
      ttlMs: 60_000,
    });

    expect(items).toEqual([]);
  });

  it('registers each approval for the consent lifetime', async () => {
    jest.useFakeTimers();
    try {
      const f = makeFixture({
        destinations: [
          destination({
            kind: 'skill',
            slug: 'run-tests',
            relPath: '.claude/skills/run-tests',
            state: 'unowned',
          }),
        ],
      });
      const [item] = await f.service.planLocalItems({
        family: 'external',
        harnessRoot: ROOT,
        sourceRef: SOURCE_REF,
        slugs,
        ttlMs: 1_000,
      });

      jest.advanceTimersByTime(1_001);

      expect(f.approvals.peek(item.approvalId, 'external', ROOT)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('offers nothing when the scan throws', async () => {
    const f = makeFixture();
    f.scan.mockRejectedValue(new Error('boom'));

    const items = await f.service.planLocalItems({
      family: 'external',
      harnessRoot: ROOT,
      sourceRef: SOURCE_REF,
      slugs: { skills: ['run-tests'], commands: [], agents: [] },
      ttlMs: 60_000,
    });

    expect(items).toEqual([]);
  });
});

describe('MarketplaceLocalItemsService.keptReport', () => {
  const skillDest = destination({
    kind: 'skill',
    slug: 'frontend-design',
    relPath: '.claude/skills/frontend-design',
    state: 'owned-edited',
  });
  const rivalDest = destination({
    kind: 'skill',
    slug: 'frontend-design',
    target: 'codex',
    relPath: '.agents/skills/frontend-design',
    state: 'unowned',
  });

  it('reports only destinations the pass kept (keptLocalEdit ∪ blocked), per target', async () => {
    const f = makeFixture({ destinations: [skillDest, rivalDest] });

    const kept = await f.service.keptReport({
      harnessRoot: ROOT,
      sourceRef: 'skills-sh:ptah-skillssh-a-b',
      slugs: { skills: ['frontend-design'], commands: [], agents: [] },
      health: health([
        targetHealth({ keptLocalEdit: ['.claude/skills/frontend-design'] }),
        // The rival path is blocked on codex: missing AND foreign.
        targetHealth({
          target: 'codex',
          missing: ['.agents/skills/frontend-design'],
          foreign: ['.agents/skills/frontend-design'],
        }),
      ]),
      fileFamily: 'skills-sh',
    });

    expect(kept).toEqual([
      {
        approvalId: expect.any(String),
        family: 'skills-sh',
        target: 'claude',
        relPath: '.claude/skills/frontend-design',
        reason: 'owned-edited',
      },
      {
        approvalId: expect.any(String),
        family: 'skills-sh',
        target: 'codex',
        relPath: '.agents/skills/frontend-design',
        reason: 'unowned',
      },
    ]);
    expect(
      f.approvals.peek(kept[0].approvalId, 'skills-sh', ROOT),
    ).not.toBeNull();
  });

  it('does not report a path the pass did not keep, or one kept on another target', async () => {
    const f = makeFixture({ destinations: [skillDest] });

    const kept = await f.service.keptReport({
      harnessRoot: ROOT,
      sourceRef: 'skills-sh:x',
      slugs: { skills: ['frontend-design'], commands: [], agents: [] },
      health: health([
        targetHealth({
          target: 'codex',
          keptLocalEdit: ['.claude/skills/frontend-design'],
        }),
      ]),
      fileFamily: 'skills-sh',
    });

    expect(kept).toEqual([]);
  });

  it('reports no file items without a health report', async () => {
    const f = makeFixture({ destinations: [skillDest] });

    const kept = await f.service.keptReport({
      harnessRoot: ROOT,
      sourceRef: 'skills-sh:x',
      slugs: { skills: ['frontend-design'], commands: [], agents: [] },
      health: null,
      fileFamily: 'skills-sh',
    });

    expect(kept).toEqual([]);
  });

  it('reports a shadowing workspace agent under the plugin-agent family', async () => {
    const f = makeFixture({
      destinations: [
        destination({
          kind: 'agent',
          slug: 'release-manager',
          relPath: '.claude/agents/release-manager.md',
          state: 'unowned',
        }),
      ],
    });

    const kept = await f.service.keptReport({
      harnessRoot: ROOT,
      sourceRef: 'ptah:alpha',
      slugs: { skills: [], commands: [], agents: ['release-manager'] },
      health: health([]),
      fileFamily: 'plugin-enable',
      agentFamily: 'plugin-agent',
    });

    expect(kept).toEqual([
      {
        approvalId: expect.any(String),
        family: 'plugin-agent',
        target: 'claude',
        relPath: '.claude/agents/release-manager.md',
        reason: 'shadowed',
      },
    ]);
    expect(
      f.approvals.peek(kept[0].approvalId, 'plugin-agent', ROOT),
    ).toMatchObject({ kind: 'agent-source', sourceRef: 'ptah:alpha' });
    // Bound to its family: the plugin-enable route cannot use it.
    expect(
      f.approvals.peek(kept[0].approvalId, 'plugin-enable', ROOT),
    ).toBeNull();
  });

  it('skips shadowing agents when the source has no agent family', async () => {
    const f = makeFixture({
      destinations: [
        destination({
          kind: 'agent',
          slug: 'release-manager',
          relPath: '.claude/agents/release-manager.md',
          state: 'unowned',
        }),
      ],
    });

    const kept = await f.service.keptReport({
      harnessRoot: ROOT,
      sourceRef: 'skills-sh:x',
      slugs: { skills: [], commands: [], agents: ['release-manager'] },
      health: health([]),
      fileFamily: 'skills-sh',
    });

    expect(kept).toEqual([]);
  });

  it('scans nothing for a source with no slugs', async () => {
    const f = makeFixture();

    await f.service.keptReport({
      harnessRoot: ROOT,
      sourceRef: 'ptah:empty',
      slugs: { skills: [], commands: [], agents: [] },
      health: health([]),
      fileFamily: 'plugin-enable',
    });

    expect(f.scan).not.toHaveBeenCalled();
  });
});
