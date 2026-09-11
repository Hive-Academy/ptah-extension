/**
 * `GitTaskFolderVisibility` — the cross-checkout union reader (TASK_2026_403).
 *
 * Two things make this suite worth reading before changing the service.
 *
 * **No test spawns a real git process.** The exec is a constructor-injected
 * function reference, so every branch below is driven by a fake that returns
 * the exit codes and stdout git would. A suite that shelled out would pass on
 * the author's machine, be slow everywhere, and be untestable for the branch
 * that matters most — "there is no git here".
 *
 * **The contract under test is mostly about what must NOT happen.** The port
 * promises never to throw: an unreachable source contributes nothing. "Returned
 * nothing" and "threw" are indistinguishable to a test that only checks the
 * happy path, so each of the five failure branches is driven separately and
 * each asserts a RESOLVED value.
 */
import 'reflect-metadata';
import * as path from 'path';
import { container as rootContainer } from 'tsyringe';
import {
  FileType,
  PLATFORM_TOKENS,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';
import { createMockFileSystemProvider } from '@ptah-extension/platform-core/testing';
import { DEFAULT_GIT_TIMEOUT_MS, TOKENS } from '@ptah-extension/vscode-core';
import type { DegradationReporter, Logger } from '@ptah-extension/vscode-core';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { TASK_FOLDER_VISIBILITY_TOKEN } from './task-folder-visibility.port';
import { registerTaskSpecsServices } from './di/register';
import {
  FETCH_TIMEOUT_MS,
  GitTaskFolderVisibility,
  SDK_PROCESS_SPAWNER_TOKEN,
  VISIBILITY_EXEC_GIT_TOKEN,
  VISIBILITY_CACHE_TTL_MS,
  specDirsFromWorktreeList,
  specFolderNamesFromLsTree,
  type ExecGitFn,
} from './git-task-folder-visibility.service';

const ROOT = normalizeWorkspaceRoot('D:/repos/ptah');
const SIBLING = 'D:/repos/ptah-worktrees/feature';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** `git worktree list --porcelain` as git actually prints it on Windows. */
const WORKTREE_LIST = [
  `worktree ${ROOT.split(path.sep).join('/')}`,
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  `worktree ${SIBLING}`,
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature',
  '',
].join('\n');

/** `git ls-tree --name-only -z` output — NUL-separated, trailing NUL included. */
const LS_TREE = [
  '.ptah/specs/TASK_2026_401_11aa',
  '.ptah/specs/TASK_2026_402_22bb',
  '.ptah/specs/registry.md',
  '',
].join('\0');

type Outcome = { stdout?: string; stderr?: string; exitCode?: number } | Error;

interface ExecCall {
  args: string[];
  cwd: string;
  timeoutMs: number | undefined;
  spawner: IProcessSpawner | undefined;
}

/**
 * A fake `execGit` keyed on the subcommand, plus the call log.
 *
 * Keying on `args[0]` rather than call order is deliberate: the fetch branch
 * must be able to fail WITHOUT changing what `ls-tree` sees, and an
 * order-keyed fake would silently shift the mapping when a step is skipped.
 */
function fakeExec(outcomes: Partial<Record<string, Outcome>>) {
  const calls: ExecCall[] = [];
  const exec: ExecGitFn = async (args, cwd, options) => {
    calls.push({
      args,
      cwd,
      timeoutMs: options?.timeoutMs,
      spawner: options?.spawner,
    });
    const outcome = outcomes[args[0]] ?? { exitCode: 0 };
    if (outcome instanceof Error) throw outcome;
    return {
      stdout: outcome.stdout ?? '',
      stderr: outcome.stderr ?? '',
      exitCode: outcome.exitCode ?? 0,
    };
  };
  return { exec, calls, subcommands: () => calls.map((c) => c.args[0]) };
}

function makeService(
  outcomes: Partial<Record<string, Outcome>>,
  options: {
    siblingEntries?: Array<{ name: string; type: FileType }>;
    readDirectoryThrows?: boolean;
    spawner?: IProcessSpawner | null;
  } = {},
) {
  const fs = createMockFileSystemProvider();
  const siblingSpecs = path.join(SIBLING, '.ptah', 'specs');
  const entries = options.siblingEntries ?? [
    { name: 'TASK_2026_310_c0de', type: FileType.Directory },
    { name: 'registry.md', type: FileType.File },
  ];

  fs.exists.mockImplementation(async (target: string) =>
    target === siblingSpecs ? true : false,
  );
  fs.readDirectory.mockImplementation(async (target: string) => {
    if (options.readDirectoryThrows) throw new Error('ENOENT: worktree gone');
    return target === siblingSpecs ? entries : [];
  });

  const { exec, calls, subcommands } = fakeExec(outcomes);
  const degradation = { report: jest.fn() };
  const service = new GitTaskFolderVisibility(
    fs,
    makeLogger(),
    options.spawner ?? null,
    degradation as unknown as DegradationReporter,
    exec,
  );
  return { service, fs, calls, subcommands, degradation, siblingSpecs };
}

// ---------------------------------------------------------------------------
// The two pure parsers
// ---------------------------------------------------------------------------

describe('specFolderNamesFromLsTree', () => {
  it('splits on NUL and keeps only the TASK_ basenames', () => {
    expect(specFolderNamesFromLsTree(LS_TREE)).toEqual([
      'TASK_2026_401_11aa',
      'TASK_2026_402_22bb',
    ]);
  });

  it('is empty for empty output rather than yielding one empty name', () => {
    expect(specFolderNamesFromLsTree('')).toEqual([]);
    expect(specFolderNamesFromLsTree('\0\0')).toEqual([]);
  });

  it('does not split on newlines — a name may legally contain one', () => {
    // `-z` exists precisely so a path is unambiguous. A newline-splitting
    // parser would turn one folder into two bogus names.
    expect(specFolderNamesFromLsTree('.ptah/specs/TASK_2026_1\nodd\0')).toEqual([
      'TASK_2026_1\nodd',
    ]);
  });
});

describe('specDirsFromWorktreeList', () => {
  it('maps every worktree path to its .ptah/specs directory', () => {
    expect(specDirsFromWorktreeList(WORKTREE_LIST)).toEqual([
      path.join(ROOT, '.ptah', 'specs'),
      path.join(SIBLING, '.ptah', 'specs'),
    ]);
  });

  it('handles bare and detached blocks without inventing or dropping entries', () => {
    const output = [
      'worktree D:/repos/ptah.git',
      'bare',
      '',
      'worktree D:/repos/ptah-worktrees/detached',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      '',
    ].join('\n');

    expect(specDirsFromWorktreeList(output)).toEqual([
      path.join('D:/repos/ptah.git', '.ptah', 'specs'),
      path.join('D:/repos/ptah-worktrees/detached', '.ptah', 'specs'),
    ]);
  });

  it('deduplicates, and is empty for empty output', () => {
    const twice = `${WORKTREE_LIST}\nworktree ${SIBLING}\n`;
    expect(specDirsFromWorktreeList(twice)).toHaveLength(2);
    expect(specDirsFromWorktreeList('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

describe('GitTaskFolderVisibility — all three steps succeed', () => {
  it('unions the sibling worktree and origin/main, and never returns its own specs dir twice', async () => {
    const { service, subcommands } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      fetch: {},
      'ls-tree': { stdout: LS_TREE },
    });

    const names = await service.listBeyondWorkspace(ROOT);

    expect([...names].sort()).toEqual([
      'TASK_2026_310_c0de',
      'TASK_2026_401_11aa',
      'TASK_2026_402_22bb',
    ]);
    // Exactly three spawns: list, fetch, ls-tree. No more.
    expect(subcommands()).toEqual(['worktree', 'fetch', 'ls-tree']);
  });

  it('reads each worktree at most once and skips this checkout\u2019s own specs dir', async () => {
    const { service, fs, siblingSpecs } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      'ls-tree': { stdout: LS_TREE },
    });

    await service.listBeyondWorkspace(ROOT);

    const scanned = fs.readDirectory.mock.calls.map(([target]) => target);
    expect(scanned).toEqual([siblingSpecs]);
    expect(scanned).not.toContain(path.join(ROOT, '.ptah', 'specs'));
  });

  it('gives the network step its own shorter budget', async () => {
    const { service, calls } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      'ls-tree': { stdout: LS_TREE },
    });

    await service.listBeyondWorkspace(ROOT);

    const byName = new Map(calls.map((c) => [c.args[0], c]));
    expect(byName.get('worktree')?.timeoutMs).toBe(DEFAULT_GIT_TIMEOUT_MS);
    expect(byName.get('ls-tree')?.timeoutMs).toBe(DEFAULT_GIT_TIMEOUT_MS);
    // The fetch is the only step that touches the network and the only one
    // that can hang on a credential prompt.
    expect(byName.get('fetch')?.timeoutMs).toBe(FETCH_TIMEOUT_MS);
    expect(FETCH_TIMEOUT_MS).toBeLessThan(DEFAULT_GIT_TIMEOUT_MS);
  });

  it('forwards the off-thread spawner to every git call when one is bound', async () => {
    const spawner = { spawnProcess: jest.fn() } as unknown as IProcessSpawner;
    const { service, calls } = makeService(
      { worktree: { stdout: WORKTREE_LIST }, 'ls-tree': { stdout: LS_TREE } },
      { spawner },
    );

    await service.listBeyondWorkspace(ROOT);

    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.spawner).toBe(spawner);
  });

  it('passes no spawner when none is bound, leaving execGit\u2019s inline path', async () => {
    const { service, calls } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      'ls-tree': { stdout: LS_TREE },
    });

    await service.listBeyondWorkspace(ROOT);

    for (const call of calls) expect(call.spawner).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The five failure branches — NONE of them throws
// ---------------------------------------------------------------------------

describe('GitTaskFolderVisibility — every failure degrades, none throws', () => {
  it('no git at all: resolves empty AND skips the remote steps', async () => {
    const { service, subcommands, degradation } = makeService({
      worktree: new Error('spawn git ENOENT'),
    });

    await expect(service.listBeyondWorkspace(ROOT)).resolves.toEqual([]);
    // A directory that is not a repository cannot have `origin/main` either,
    // so the fetch and the ls-tree are pointless spawns, not fallbacks.
    expect(subcommands()).toEqual(['worktree']);
    expect(degradation.report).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'workspace',
        code: 'task-visibility.worktree-list-failed',
        severity: 'degraded',
      }),
    );
  });

  it('worktree list exits non-zero: same outcome as a throw', async () => {
    const { service, subcommands, degradation } = makeService({
      worktree: { exitCode: 128, stderr: 'not a git repository' },
    });

    await expect(service.listBeyondWorkspace(ROOT)).resolves.toEqual([]);
    expect(subcommands()).toEqual(['worktree']);
    expect(degradation.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'task-visibility.worktree-list-failed' }),
    );
  });

  it('fetch fails: CONTINUES to ls-tree and still returns the remote folders', async () => {
    const { service, subcommands, degradation } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      fetch: new Error('could not read Username: terminal prompts disabled'),
      'ls-tree': { stdout: LS_TREE },
    });

    const names = await service.listBeyondWorkspace(ROOT);

    // A stale remote view is strictly better than none — this is the whole
    // reason the fetch is unchecked rather than a gate.
    expect(names).toContain('TASK_2026_401_11aa');
    expect(subcommands()).toEqual(['worktree', 'fetch', 'ls-tree']);
    expect(degradation.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'task-visibility.fetch-failed' }),
    );
  });

  it('ls-tree fails: the worktree half survives on its own', async () => {
    const { service, degradation } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      'ls-tree': { exitCode: 128, stderr: 'Not a valid object name origin/main' },
    });

    await expect(service.listBeyondWorkspace(ROOT)).resolves.toEqual([
      'TASK_2026_310_c0de',
    ]);
    expect(degradation.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'task-visibility.ls-tree-failed' }),
    );
  });

  it('a worktree read that throws costs only that worktree', async () => {
    const { service, degradation } = makeService(
      {
        worktree: { stdout: WORKTREE_LIST },
        'ls-tree': { stdout: LS_TREE },
      },
      { readDirectoryThrows: true },
    );

    // The remote half is untouched by a filesystem failure in the local half.
    await expect(service.listBeyondWorkspace(ROOT)).resolves.toEqual([
      'TASK_2026_401_11aa',
      'TASK_2026_402_22bb',
    ]);
    expect(degradation.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'task-visibility.worktree-scan-failed' }),
    );
  });

  it('reports every code as a string literal, never an interpolated one', async () => {
    const { service, degradation } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      fetch: new Error('offline'),
      'ls-tree': new Error('no ref'),
    });

    await service.listBeyondWorkspace(ROOT);

    // An interpolated code mints a fresh bucket per failure and makes the
    // per-boot tally meaningless. The closed set is the assertion.
    const codes = degradation.report.mock.calls.map(
      (call) => (call[0] as { code: string }).code,
    );
    for (const code of codes) {
      expect([
        'task-visibility.worktree-list-failed',
        'task-visibility.fetch-failed',
        'task-visibility.ls-tree-failed',
        'task-visibility.worktree-scan-failed',
      ]).toContain(code);
    }
  });

  it('works with no degradation reporter bound at all', async () => {
    const fs = createMockFileSystemProvider();
    fs.exists.mockResolvedValue(false);
    const { exec } = fakeExec({ worktree: new Error('spawn git ENOENT') });
    const service = new GitTaskFolderVisibility(
      fs,
      makeLogger(),
      null,
      null,
      exec,
    );

    await expect(service.listBeyondWorkspace(ROOT)).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe('GitTaskFolderVisibility — the 60 s cache', () => {
  afterEach(() => jest.useRealTimers());

  it('spawns nothing on a second call inside the TTL', async () => {
    const { service, calls } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      'ls-tree': { stdout: LS_TREE },
    });

    const first = await service.listBeyondWorkspace(ROOT);
    const second = await service.listBeyondWorkspace(ROOT);

    expect(second).toEqual(first);
    expect(calls).toHaveLength(3);
  });

  it('re-reads once the TTL has passed', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-09T00:00:00.000Z'));
    const { service, calls } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      'ls-tree': { stdout: LS_TREE },
    });

    await service.listBeyondWorkspace(ROOT);
    jest.setSystemTime(Date.now() + VISIBILITY_CACHE_TTL_MS + 1);
    await service.listBeyondWorkspace(ROOT);

    expect(calls).toHaveLength(6);
  });

  it('keys the cache per workspace root', async () => {
    const { service, calls } = makeService({
      worktree: { stdout: WORKTREE_LIST },
      'ls-tree': { stdout: LS_TREE },
    });

    await service.listBeyondWorkspace(ROOT);
    await service.listBeyondWorkspace('D:/repos/other');

    expect(calls).toHaveLength(6);
    expect(calls[3].cwd).toBe(normalizeWorkspaceRoot('D:/repos/other'));
  });
});

// ---------------------------------------------------------------------------
// The mirrored symbol and the DI binding (R-8)
// ---------------------------------------------------------------------------

describe('GitTaskFolderVisibility — DI wiring', () => {
  /**
   * The one assertion that catches a typo in the mirrored token.
   *
   * `SDK_TOKENS.SDK_PROCESS_SPAWNER` is `Symbol.for('SdkProcessSpawner')` in
   * `agent-sdk`, which this lib must not import. A mismatched description does
   * NOT fail loudly — the optional injection resolves `null` and every git call
   * silently runs `CreateProcessW` on the Electron main thread again.
   */
  it('mirrors SdkProcessSpawner character for character', () => {
    expect(SDK_PROCESS_SPAWNER_TOKEN.description).toBe('SdkProcessSpawner');
    expect(SDK_PROCESS_SPAWNER_TOKEN).toBe(Symbol.for('SdkProcessSpawner'));
  });

  it('resolves from a container carrying only the logger and the file system', () => {
    const container = rootContainer.createChildContainer();
    container.register(TOKENS.LOGGER, { useValue: makeLogger() });
    container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
      useValue: createMockFileSystemProvider(),
    });

    registerTaskSpecsServices(container, makeLogger());

    // No spawner, no degradation reporter — both optional, and their absence
    // is the VS Code and CLI configuration, not an error. The git execution
    // seam itself is always registered by this composition root.
    expect(container.isRegistered(VISIBILITY_EXEC_GIT_TOKEN)).toBe(true);
    expect(container.resolve(VISIBILITY_EXEC_GIT_TOKEN)).toBeInstanceOf(
      Function,
    );
    const resolved = container.resolve(TASK_FOLDER_VISIBILITY_TOKEN);
    expect(resolved).toBeInstanceOf(GitTaskFolderVisibility);
    // Singleton: the writer and any future consumer share one cache.
    expect(container.resolve(TASK_FOLDER_VISIBILITY_TOKEN)).toBe(resolved);
  });

  it('takes the bound spawner when the host registers the mirrored token', () => {
    const container = rootContainer.createChildContainer();
    const spawner = { spawnProcess: jest.fn() };
    container.register(TOKENS.LOGGER, { useValue: makeLogger() });
    container.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
      useValue: createMockFileSystemProvider(),
    });
    container.register(SDK_PROCESS_SPAWNER_TOKEN, { useValue: spawner });

    registerTaskSpecsServices(container, makeLogger());

    const resolved = container.resolve<GitTaskFolderVisibility>(
      TASK_FOLDER_VISIBILITY_TOKEN,
    );
    expect(
      (resolved as unknown as { spawner: unknown }).spawner,
    ).toBe(spawner);
  });
});
