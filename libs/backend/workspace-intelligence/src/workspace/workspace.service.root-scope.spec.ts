/**
 * TASK_2026_200 task 3.3 — explicit-root threading through `WorkspaceService`.
 *
 * This is the hop where the raw process-global `IWorkspaceProvider` actually
 * leaked (context.md §2, chain step 3): `getProjectInfo()` and
 * `analyzeWorkspaceStructure()` took no argument and read
 * `this.currentAnalysis`, which was built from
 * `workspaceProvider.getWorkspaceRoot()`. Every test below fails against that
 * shape — the explicit argument must win over the field UNCONDITIONALLY.
 */

import 'reflect-metadata';
import { FileType } from '@ptah-extension/platform-core';
import { WorkspaceService } from './workspace.service';
import { ProjectType } from '../types/workspace.types';

const ROOT_A = 'D:\\projects\\alpha';
const ROOT_B = 'D:\\projects\\beta';

interface Harness {
  service: WorkspaceService;
  projectDetector: { detectProjectType: jest.Mock };
  fileSystem: {
    readDirectory: jest.Mock;
    exists: jest.Mock;
    readFile: jest.Mock;
  };
  provider: { getWorkspaceRoot: jest.Mock; getWorkspaceFolders: jest.Mock };
  fireFolderChange: () => void;
}

/** Let every queued microtask from the constructor's warm-up settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

function createHarness(options?: {
  activeRoot?: string;
  folders?: string[];
}): Harness {
  const projectDetector = {
    detectProjectType: jest.fn(async () => ProjectType.Node),
  };
  const frameworkDetector = {
    detectFramework: jest.fn(async () => undefined),
  };
  const dependencyAnalyzer = {
    analyzeDependencies: jest.fn(async () => ({
      dependencies: [],
      devDependencies: [],
    })),
  };
  const monorepoDetector = {
    detectMonorepo: jest.fn(async () => ({ isMonorepo: false })),
  };
  const fileSystem = {
    // One file per directory, no subdirectories — keeps the recursive walks
    // finite without needing a full virtual filesystem.
    readDirectory: jest.fn(async () => [
      { name: 'index.ts', type: FileType.File },
    ]),
    exists: jest.fn(async () => false),
    readFile: jest.fn(async () => '{}'),
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
  const sentryService = { captureException: jest.fn() };

  const service = new WorkspaceService(
    projectDetector as never,
    frameworkDetector as never,
    dependencyAnalyzer as never,
    monorepoDetector as never,
    fileSystem as never,
    provider as never,
    sentryService as never,
  );

  return {
    service,
    projectDetector,
    fileSystem,
    provider,
    fireFolderChange: () => changeListener?.(),
  };
}

describe('WorkspaceService — explicit root threading', () => {
  it('getProjectInfo(root) answers for the explicit root while the provider reports another', async () => {
    const harness = createHarness({ activeRoot: ROOT_A, folders: [ROOT_A] });
    await flush();

    const info = await harness.service.getProjectInfo(ROOT_B);

    expect(info?.path).toBe(ROOT_B);
  });

  it('getProjectInfo(root) never consults the cached process-global analysis', async () => {
    const harness = createHarness({ activeRoot: ROOT_A, folders: [ROOT_A] });
    await flush();

    // The constructor already analyzed A, so a `currentAnalysis`-first
    // implementation would short-circuit and return A here.
    const info = await harness.service.getProjectInfo(ROOT_B);

    expect(info?.path).not.toBe(ROOT_A);
    expect(harness.projectDetector.detectProjectType).toHaveBeenCalledWith(
      ROOT_B,
    );
  });

  it('analyzeWorkspaceStructure(root) walks the explicit root', async () => {
    const harness = createHarness({ activeRoot: ROOT_A, folders: [ROOT_A] });
    await flush();
    harness.fileSystem.readDirectory.mockClear();

    await harness.service.analyzeWorkspaceStructure(ROOT_B);

    const walkedRoots = harness.fileSystem.readDirectory.mock.calls.map(
      (call) => call[0],
    );
    expect(walkedRoots).toContain(ROOT_B);
    expect(walkedRoots).not.toContain(ROOT_A);
  });

  it('omitting the root reproduces the pre-fix behaviour (process-global folder)', async () => {
    const harness = createHarness({ activeRoot: ROOT_A, folders: [ROOT_A] });
    await flush();

    const info = await harness.service.getProjectInfo();

    expect(info?.path).toBe(ROOT_A);
  });

  it('returns null rather than substituting a fallback when nothing resolves (criterion 5)', async () => {
    const harness = createHarness();
    await flush();

    await expect(harness.service.getProjectInfo()).resolves.toBeNull();
    await expect(
      harness.service.analyzeWorkspaceStructure(),
    ).resolves.toBeNull();
  });

  it('collapses drive-letter case and trailing separators to one analysis (criterion 13)', async () => {
    const harness = createHarness();
    await flush();
    harness.projectDetector.detectProjectType.mockClear();

    await harness.service.getProjectInfo('D:\\projects\\beta');
    await harness.service.getProjectInfo('D:\\projects\\beta\\');
    await harness.service.getProjectInfo('d:\\projects\\beta');

    expect(harness.projectDetector.detectProjectType).toHaveBeenCalledTimes(1);
  });

  it('de-dupes concurrent analyses of the same root instead of walking the tree three times', async () => {
    const harness = createHarness();
    await flush();
    harness.projectDetector.detectProjectType.mockClear();

    await Promise.all([
      harness.service.getProjectInfo(ROOT_B),
      harness.service.analyzeWorkspaceStructure(ROOT_B),
      harness.service.getProjectInfo(ROOT_B),
    ]);

    expect(harness.projectDetector.detectProjectType).toHaveBeenCalledTimes(1);
  });

  it('evicts only the roots that were open and are now gone on a folder change', async () => {
    const harness = createHarness({
      activeRoot: ROOT_A,
      folders: [ROOT_A, ROOT_B],
    });
    await flush();

    await harness.service.getProjectInfo(ROOT_B);
    harness.projectDetector.detectProjectType.mockClear();

    harness.provider.getWorkspaceFolders.mockReturnValue([ROOT_A]);
    harness.fireFolderChange();
    await flush();

    harness.projectDetector.detectProjectType.mockClear();
    await harness.service.getProjectInfo(ROOT_B);
    expect(harness.projectDetector.detectProjectType).toHaveBeenCalledWith(
      ROOT_B,
    );
  });
});
