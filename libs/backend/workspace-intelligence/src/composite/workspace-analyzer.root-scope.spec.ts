/**
 * TASK_2026_200 task 3.2 — root-keyed `WorkspaceInfo` cache.
 *
 * Pre-fix, `WorkspaceAnalyzerService` held ONE unkeyed `workspaceInfo` field
 * populated at construction, so `getCurrentWorkspaceInfo()` took no root at all
 * and two concurrent MCP sessions bound to different workspaces both received
 * the same snapshot (context.md §2.1). Every test below fails against that
 * shape.
 *
 * Lives in its own file rather than in `workspace-analyzer.service.spec.ts` so
 * the AST-integration suite there keeps its own single `beforeEach` harness.
 */

import 'reflect-metadata';
import { WorkspaceAnalyzerService } from './workspace-analyzer.service';

const ROOT_A = 'D:\\projects\\alpha';
const ROOT_B = 'D:\\projects\\beta';

interface Harness {
  service: WorkspaceAnalyzerService;
  workspaceService: {
    getProjectInfo: jest.Mock;
    analyzeWorkspaceStructure: jest.Mock;
  };
  projectDetector: { detectProjectType: jest.Mock };
  frameworkDetector: { detectFrameworks: jest.Mock };
  provider: {
    getWorkspaceRoot: jest.Mock;
    getWorkspaceFolders: jest.Mock;
  };
  fireFolderChange: () => void;
}

function projectInfoFor(root: string) {
  return {
    name: root.split('\\').pop(),
    type: `type-${root}`,
    path: root,
    dependencies: [],
    devDependencies: [],
    fileStatistics: {},
    totalFiles: 1,
    gitRepository: false,
  };
}

/** Let every queued microtask from a fire-and-forget refresh settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

function createHarness(options?: {
  activeRoot?: string;
  folders?: string[];
}): Harness {
  const workspaceService = {
    getProjectInfo: jest.fn(async (root?: string) =>
      root ? projectInfoFor(root) : null,
    ),
    analyzeWorkspaceStructure: jest.fn(async () => null),
  };
  const projectDetector = {
    detectProjectType: jest.fn(async (root: string) => `pt-${root}`),
  };
  const frameworkDetector = {
    detectFrameworks: jest.fn(
      async (map: Map<string, unknown>) =>
        new Map([...map.keys()].map((key) => [key, `fw-${key}`])),
    ),
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  let changeListener: (() => void) | undefined;
  const provider = {
    getWorkspaceRoot: jest.fn().mockReturnValue(options?.activeRoot),
    getWorkspaceFolders: jest.fn().mockReturnValue(options?.folders ?? []),
    getConfiguration: jest.fn(),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn((listener: () => void) => {
      changeListener = listener;
      return { dispose: jest.fn() };
    }),
  };

  const service = new WorkspaceAnalyzerService(
    {} as never,
    projectDetector as never,
    frameworkDetector as never,
    {} as never,
    workspaceService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    logger as never,
    provider as never,
  );

  return {
    service,
    workspaceService,
    projectDetector,
    frameworkDetector,
    provider,
    fireFolderChange: () => changeListener?.(),
  };
}

describe('WorkspaceAnalyzerService — root-keyed workspace info', () => {
  it('serves two distinct roots distinctly with no folder-change event between the calls (criteria 3, 7)', async () => {
    const harness = createHarness({ activeRoot: ROOT_A, folders: [ROOT_A] });

    const a = await harness.service.getCurrentWorkspaceInfo(ROOT_A);
    const b = await harness.service.getCurrentWorkspaceInfo(ROOT_B);

    expect(a?.path).toBe(ROOT_A);
    expect(b?.path).toBe(ROOT_B);
    expect(a?.projectType).not.toBe(b?.projectType);
  });

  it('lets an explicit root win over the process-global provider root (criterion 1)', async () => {
    const harness = createHarness({ activeRoot: ROOT_A, folders: [ROOT_A] });

    const info = await harness.service.getCurrentWorkspaceInfo(ROOT_B);

    expect(info?.path).toBe(ROOT_B);
    expect(harness.workspaceService.getProjectInfo).toHaveBeenCalledWith(
      ROOT_B,
    );
  });

  it('falls back to the process-global root when none is supplied', async () => {
    const harness = createHarness({ activeRoot: ROOT_A, folders: [ROOT_A] });

    const info = await harness.service.getCurrentWorkspaceInfo();

    expect(info?.path).toBe(ROOT_A);
  });

  it('collapses drive-letter case and trailing separators to one cache entry (criterion 13)', async () => {
    const harness = createHarness();

    await harness.service.getCurrentWorkspaceInfo('D:\\projects\\alpha');
    await harness.service.getCurrentWorkspaceInfo('D:\\projects\\alpha\\');
    await harness.service.getCurrentWorkspaceInfo('d:\\projects\\alpha');

    expect(harness.workspaceService.getProjectInfo).toHaveBeenCalledTimes(1);
  });

  it('de-dupes concurrent analyses of the same root', async () => {
    const harness = createHarness();

    const [first, second, third] = await Promise.all([
      harness.service.getCurrentWorkspaceInfo(ROOT_A),
      harness.service.getCurrentWorkspaceInfo(ROOT_A),
      harness.service.getCurrentWorkspaceInfo(ROOT_A),
    ]);

    expect(harness.workspaceService.getProjectInfo).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('evicts a folder that was open and is now gone, and refreshes the active root', async () => {
    const harness = createHarness({
      activeRoot: ROOT_A,
      folders: [ROOT_A, ROOT_B],
    });
    await flush();

    await harness.service.getCurrentWorkspaceInfo(ROOT_A);
    await harness.service.getCurrentWorkspaceInfo(ROOT_B);
    harness.workspaceService.getProjectInfo.mockClear();

    // The event carries no payload, so the service must diff the folder list.
    harness.provider.getWorkspaceFolders.mockReturnValue([ROOT_A]);
    harness.fireFolderChange();
    await flush();

    // Active root refreshed exactly as the pre-fix `updateWorkspaceInfo()` did.
    expect(
      harness.workspaceService.getProjectInfo.mock.calls.filter(
        (call) => call[0] === ROOT_A,
      ),
    ).toHaveLength(1);

    // B was evicted, so asking for it re-analyzes.
    harness.workspaceService.getProjectInfo.mockClear();
    await harness.service.getCurrentWorkspaceInfo(ROOT_B);
    expect(harness.workspaceService.getProjectInfo).toHaveBeenCalledWith(
      ROOT_B,
    );
  });

  it('does not evict a still-open sibling root when a folder change fires', async () => {
    const harness = createHarness({
      activeRoot: ROOT_A,
      folders: [ROOT_A, ROOT_B],
    });
    await flush();

    await harness.service.getCurrentWorkspaceInfo(ROOT_B);

    harness.provider.getWorkspaceFolders.mockReturnValue([ROOT_A, ROOT_B]);
    harness.fireFolderChange();
    await flush();

    harness.workspaceService.getProjectInfo.mockClear();
    await harness.service.getCurrentWorkspaceInfo(ROOT_B);
    expect(harness.workspaceService.getProjectInfo).not.toHaveBeenCalled();
  });

  it('bounds the cache so a long-lived process switching roots cannot grow it without limit', async () => {
    const harness = createHarness();

    // 9 distinct roots against a cap of 8 — the oldest must have been evicted.
    for (let i = 0; i < 9; i++) {
      await harness.service.getCurrentWorkspaceInfo(`D:\\projects\\root-${i}`);
    }
    expect(harness.workspaceService.getProjectInfo).toHaveBeenCalledTimes(9);

    harness.workspaceService.getProjectInfo.mockClear();
    await harness.service.getCurrentWorkspaceInfo('D:\\projects\\root-8');
    expect(harness.workspaceService.getProjectInfo).not.toHaveBeenCalled();

    await harness.service.getCurrentWorkspaceInfo('D:\\projects\\root-0');
    expect(harness.workspaceService.getProjectInfo).toHaveBeenCalledWith(
      'D:\\projects\\root-0',
    );
  });

  it('returns undefined — never a $HOME fallback — when nothing resolves (criterion 5)', async () => {
    const harness = createHarness();

    await expect(
      harness.service.getCurrentWorkspaceInfo(),
    ).resolves.toBeUndefined();
    expect(harness.workspaceService.getProjectInfo).not.toHaveBeenCalled();
  });

  it('propagates the contractual "No workspace folder open" error (criterion 5)', async () => {
    const harness = createHarness();
    harness.workspaceService.getProjectInfo.mockResolvedValue(null);

    await expect(harness.service.getProjectInfo(ROOT_A)).rejects.toThrow(
      'No workspace folder open',
    );
  });

  it('does not let an analysis invalidated mid-flight repopulate the cache', async () => {
    // The write that publishes a WorkspaceInfo sits AFTER several awaits. If the
    // key is invalidated while the analysis is parked, the late-resuming
    // computation must not resurrect the stale entry. Same off-by-one-await
    // shape that Batch 1 was rejected twice for.
    const harness = createHarness({
      activeRoot: ROOT_A,
      folders: [ROOT_A, ROOT_B],
    });
    await flush();

    let releaseB: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    harness.workspaceService.getProjectInfo.mockImplementation(
      async (root?: string) => {
        if (root === ROOT_B) {
          await gate;
        }
        return root ? projectInfoFor(root) : null;
      },
    );

    const parked = harness.service.getCurrentWorkspaceInfo(ROOT_B);
    await flush();

    // Workspace B closes while its analysis is still parked.
    harness.provider.getWorkspaceFolders.mockReturnValue([ROOT_A]);
    harness.fireFolderChange();
    await flush();

    releaseB?.();
    await parked;
    await flush();

    // B must NOT be cached: asking again has to re-analyze.
    harness.workspaceService.getProjectInfo.mockClear();
    await harness.service.getCurrentWorkspaceInfo(ROOT_B);
    expect(harness.workspaceService.getProjectInfo).toHaveBeenCalledWith(
      ROOT_B,
    );
  });

  it('threads the explicit root into analyzeWorkspaceStructure', async () => {
    const harness = createHarness({ activeRoot: ROOT_A, folders: [ROOT_A] });

    await harness.service.analyzeWorkspaceStructure(ROOT_B);

    expect(
      harness.workspaceService.analyzeWorkspaceStructure,
    ).toHaveBeenCalledWith(ROOT_B);
  });
});
