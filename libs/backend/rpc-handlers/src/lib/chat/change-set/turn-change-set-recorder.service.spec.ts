/**
 * Unit spec for {@link TurnChangeSetRecorder}, with a fake git service, the
 * real event bus and prompt-submit registry, the real store over in-memory
 * storage, and real files in a temp directory (so mtime/size come from
 * `fs.stat`).
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import {
  SdkAdapterEvents,
  UserPromptSubmitCallbackRegistry,
  type SdkAdapterTurnEndedEvent,
  type SdkAdapterTurnFailedEvent,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  MESSAGE_TYPES,
  type GitFileStatus,
  type GitInfoResult,
  type GitTurnChangeSetPayload,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import type { WebviewBroadcaster } from '../../handlers/session-lifecycle-notifier';
import {
  MAX_FILES_PER_CHANGE_SET,
  TurnChangeSetRecorder,
} from './turn-change-set-recorder.service';
import { TurnChangeSetStore } from './turn-change-set.store';

type LineCounts = Pick<GitFileStatus, 'additions' | 'deletions' | 'binary'>;

class MemoryStorage implements IStateStorage {
  readonly data = new Map<string, unknown>();
  failUpdates = false;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (this.failUpdates) throw new Error('storage down');
    this.data.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.data.keys()];
  }
}

const SESSION = 'sess-1';

/** Let fs.stat and the promise chains settle. */
async function settle(rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Wait until `condition` holds. Real `fs.stat` I/O makes the number of event
 * loop turns a recording takes depend on machine load, so a fixed count of
 * turns is not enough under a parallel test run.
 */
async function waitUntil(
  condition: () => boolean,
  timeoutMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function repo(files: GitFileStatus[]): GitInfoResult {
  return {
    isGitRepo: true,
    branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
    files,
  };
}

describe('TurnChangeSetRecorder', () => {
  let root: string;
  let logger: MockLogger;
  let events: SdkAdapterEvents;
  let registry: UserPromptSubmitCallbackRegistry;
  let gitInfoResult: GitInfoResult;
  let numstat: (paths: readonly string[]) => Map<string, LineCounts>;
  let gitInfo: {
    getGitInfo: jest.Mock;
    readChangeSetNumstat: jest.Mock;
    resolveRepositoryRoot: jest.Mock;
  };
  let metadata: { get: jest.Mock };
  let storage: MemoryStorage;
  let store: TurnChangeSetStore;
  let pushes: GitTurnChangeSetPayload[];
  let recorder: TurnChangeSetRecorder;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'turn-change-set-'));
    logger = createMockLogger();
    const asLogger = logger as unknown as Logger;
    events = new SdkAdapterEvents(asLogger);
    registry = new UserPromptSubmitCallbackRegistry(asLogger);
    gitInfoResult = repo([]);
    numstat = (paths) =>
      new Map(
        paths.map((p) => [p, { additions: 3, deletions: 1, binary: false }]),
      );
    gitInfo = {
      getGitInfo: jest.fn(async () => gitInfoResult),
      readChangeSetNumstat: jest.fn(
        async (_root: string, paths: readonly string[]) => numstat(paths),
      ),
      resolveRepositoryRoot: jest.fn(async (dir: string) => dir),
    };
    metadata = { get: jest.fn(async () => null) };
    storage = new MemoryStorage();
    store = new TurnChangeSetStore(storage, asLogger);
    pushes = [];
    const broadcaster: WebviewBroadcaster = {
      broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
        expect(type).toBe(MESSAGE_TYPES.GIT_TURN_CHANGE_SET);
        pushes.push(payload as GitTurnChangeSetPayload);
      }),
    };
    recorder = new TurnChangeSetRecorder(
      asLogger,
      events,
      registry,
      metadata as unknown as SessionMetadataStore,
      gitInfo as unknown as GitInfoService,
      broadcaster,
      store,
    );
  });

  afterEach(async () => {
    recorder.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });

  function submitPrompt(workspaceRoot = root, timestamp = 1_000): void {
    registry.notifyAll({
      prompt: 'do it',
      sessionId: SESSION,
      workspaceRoot,
      timestamp,
    });
  }

  function endTurn(overrides: Partial<SdkAdapterTurnEndedEvent> = {}): void {
    events.emitTurnEnded({
      sessionId: SESSION,
      cwd: root,
      lastAssistantMessage: null,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: null,
      timestamp: 2_000,
      ...overrides,
    });
  }

  function failTurn(): void {
    const event: SdkAdapterTurnFailedEvent = {
      sessionId: SESSION,
      cwd: root,
      lastAssistantMessage: null,
      error: 'unknown' as SdkAdapterTurnFailedEvent['error'],
      errorDetails: null,
      terminalReason: null,
      timestamp: 2_000,
    };
    events.emitTurnFailed(event);
  }

  async function storedSets(): Promise<unknown[]> {
    return store.list(SESSION);
  }

  it('records and pushes nothing when the turn changed nothing', async () => {
    await fs.writeFile(path.join(root, 'dirty.ts'), 'x\n');
    gitInfoResult = repo([
      {
        path: 'dirty.ts',
        status: 'M',
        staged: false,
        additions: 1,
        deletions: 0,
      },
    ]);
    submitPrompt();
    await settle();
    endTurn();
    await waitUntil(() => gitInfo.getGitInfo.mock.calls.length === 2);
    await settle();

    expect(pushes).toEqual([]);
    expect(await storedSets()).toEqual([]);
    expect(gitInfo.getGitInfo).toHaveBeenCalledTimes(2);
    expect(gitInfo.readChangeSetNumstat).not.toHaveBeenCalled();
  });

  it('catches an Edit of an already-dirty file with the same numstat by mtime', async () => {
    const file = path.join(root, 'dirty.ts');
    await fs.writeFile(file, 'a\n');
    const row: GitFileStatus = {
      path: 'dirty.ts',
      status: 'M',
      staged: false,
      additions: 1,
      deletions: 1,
    };
    gitInfoResult = repo([row]);
    submitPrompt();
    await waitUntil(() => gitInfo.getGitInfo.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await settle();

    // Same content length, same numstat; only the mtime moves.
    await fs.writeFile(file, 'b\n');
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(file, later, later);
    endTurn();
    await waitUntil(() => pushes.length === 1);

    expect(pushes).toHaveLength(1);
    const { changeSet } = pushes[0];
    expect(changeSet).toMatchObject({
      sessionId: SESSION,
      workspaceRoot: root,
      turnStartedAt: 1_000,
      turnEndedAt: 2_000,
      files: [{ path: 'dirty.ts', status: 'M', additions: 3, deletions: 1 }],
      truncatedCount: 0,
      totals: { files: 1, additions: 3, deletions: 1 },
      countsUnavailable: false,
    });
    expect(changeSet.baselineMissing).toBeUndefined();
    expect(await storedSets()).toEqual([changeSet]);
  });

  it('catches a delete done through Bash', async () => {
    submitPrompt();
    await settle();
    gitInfoResult = repo([{ path: 'gone.ts', status: 'D', staged: false }]);
    numstat = (paths) =>
      new Map(
        paths.map((p) => [p, { additions: 0, deletions: 7, binary: false }]),
      );
    endTurn();
    await waitUntil(() => pushes.length === 1);

    expect(pushes).toHaveLength(1);
    expect(pushes[0].changeSet.files).toEqual([
      { path: 'gone.ts', status: 'D', additions: 0, deletions: 7 },
    ]);
  });

  it('reports a rename with its origPath and asks numstat for both sides', async () => {
    submitPrompt();
    await settle();
    gitInfoResult = repo([
      { path: 'new.ts', origPath: 'old.ts', status: 'R', staged: true },
    ]);
    endTurn();
    await waitUntil(() => pushes.length === 1);

    expect(pushes[0].changeSet.files[0]).toMatchObject({
      path: 'new.ts',
      origPath: 'old.ts',
      status: 'R',
    });
    expect(gitInfo.readChangeSetNumstat).toHaveBeenCalledWith(root, [
      'new.ts',
      'old.ts',
    ]);
  });

  it(`truncates at ${MAX_FILES_PER_CHANGE_SET} files and counts the rest`, async () => {
    submitPrompt();
    await settle();
    gitInfoResult = repo(
      Array.from({ length: 600 }, (_, i) => ({
        path: `f${String(i).padStart(3, '0')}.ts`,
        status: '??' as const,
        staged: false,
      })),
    );
    endTurn();
    await waitUntil(() => pushes.length === 1);

    const { changeSet } = pushes[0];
    expect(changeSet.files).toHaveLength(MAX_FILES_PER_CHANGE_SET);
    expect(changeSet.files[0]).toMatchObject({ path: 'f000.ts', status: 'A' });
    expect(changeSet.truncatedCount).toBe(100);
    expect(changeSet.totals).toEqual({
      files: 600,
      additions: 3 * MAX_FILES_PER_CHANGE_SET,
      deletions: MAX_FILES_PER_CHANGE_SET,
    });
    expect(gitInfo.readChangeSetNumstat.mock.calls[0][1]).toHaveLength(
      MAX_FILES_PER_CHANGE_SET,
    );
  });

  it('records null counts and countsUnavailable when numstat fails', async () => {
    submitPrompt();
    await settle();
    gitInfoResult = repo([
      { path: 'a.ts', status: 'M', staged: false },
      { path: 'logo.png', status: 'M', staged: false },
    ]);
    numstat = () =>
      new Map<string, LineCounts>([
        ['a.ts', { additions: null, deletions: null }],
        ['logo.png', { additions: null, deletions: null, binary: true }],
      ]);
    endTurn();
    await waitUntil(() => pushes.length === 1);

    const { changeSet } = pushes[0];
    expect(changeSet.countsUnavailable).toBe(true);
    expect(changeSet.files).toEqual([
      { path: 'a.ts', status: 'M', additions: null, deletions: null },
      {
        path: 'logo.png',
        status: 'M',
        additions: null,
        deletions: null,
        binary: true,
      },
    ]);
    expect(changeSet.totals).toEqual({ files: 2, additions: 0, deletions: 0 });
  });

  it('does not mark a binary-only set as counts unavailable', async () => {
    submitPrompt();
    await settle();
    gitInfoResult = repo([{ path: 'logo.png', status: 'A', staged: true }]);
    numstat = () =>
      new Map<string, LineCounts>([
        ['logo.png', { additions: null, deletions: null, binary: true }],
      ]);
    endTurn();
    await waitUntil(() => pushes.length === 1);
    expect(pushes[0].changeSet.countsUnavailable).toBe(false);
    // The flag reaches the card, which shows "binary", never zeros.
    expect(pushes[0].changeSet.files).toEqual([
      {
        path: 'logo.png',
        status: 'A',
        additions: null,
        deletions: null,
        binary: true,
      },
    ]);
  });

  it('records nothing when the after-status is unavailable', async () => {
    submitPrompt();
    await settle();
    gitInfoResult = { ...repo([]), statusUnavailable: 'timeout' };
    endTurn();
    await waitUntil(() => logger.warn.mock.calls.length > 0);

    expect(pushes).toEqual([]);
    expect(await storedSets()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('git status unavailable at turn end'),
    );
  });

  it('records nothing in a non-git directory', async () => {
    gitInfoResult = { ...repo([]), isGitRepo: false };
    submitPrompt();
    await settle();
    endTurn();
    await waitUntil(() => gitInfo.getGitInfo.mock.calls.length === 2);
    await settle();
    expect(pushes).toEqual([]);
  });

  it('compares against an empty baseline when none was captured', async () => {
    gitInfoResult = repo([{ path: 'old-dirt.ts', status: 'M', staged: false }]);
    endTurn();
    await waitUntil(() => pushes.length === 1);

    expect(pushes).toHaveLength(1);
    expect(pushes[0].changeSet).toMatchObject({
      baselineMissing: true,
      turnStartedAt: 2_000,
      files: [{ path: 'old-dirt.ts', status: 'M' }],
    });
  });

  it('reports a file the turn added and then removed as deleted', async () => {
    gitInfoResult = repo([{ path: 'tmp.ts', status: '??', staged: false }]);
    submitPrompt();
    await settle();
    gitInfoResult = repo([]);
    endTurn();
    await waitUntil(() => pushes.length === 1);
    expect(pushes[0].changeSet.files).toEqual([
      { path: 'tmp.ts', status: 'D', additions: 3, deletions: 1 },
    ]);
  });

  it('reports an untracked file still on disk as added and a modified file as modified, with their counts', async () => {
    // Regression: one turn that leaves a new untracked file and an edited
    // tracked file must not report either as deleted or with zero counts.
    await fs.mkdir(path.join(root, 'skills'));
    const skill = path.join(root, 'skills', 'SKILL.md');
    const agent = path.join(root, 'agent.md');
    await fs.writeFile(agent, 'a\n');
    gitInfoResult = repo([]);
    submitPrompt();
    await waitUntil(() => gitInfo.getGitInfo.mock.calls.length === 1);
    await settle();

    await fs.writeFile(skill, 'one\ntwo\n');
    await fs.writeFile(agent, 'b\n');
    gitInfoResult = repo([
      {
        path: 'agent.md',
        status: 'M',
        staged: false,
        additions: 1,
        deletions: 1,
      },
      {
        path: 'skills/SKILL.md',
        status: '??',
        staged: false,
        additions: 2,
        deletions: 0,
      },
    ]);
    numstat = (paths) =>
      new Map(
        paths.map((p) => [
          p,
          p === 'skills/SKILL.md'
            ? { additions: 2, deletions: 0, binary: false }
            : { additions: 1, deletions: 1, binary: false },
        ]),
      );
    endTurn();
    await waitUntil(() => pushes.length === 1);

    expect(pushes[0].changeSet).toMatchObject({
      files: [
        { path: 'agent.md', status: 'M', additions: 1, deletions: 1 },
        { path: 'skills/SKILL.md', status: 'A', additions: 2, deletions: 0 },
      ],
      totals: { files: 2, additions: 3, deletions: 1 },
      countsUnavailable: false,
    });
  });

  it('counts the lines of an untracked file the turn deleted, which numstat cannot see', async () => {
    // Regression: an untracked file (and a staged new one with an unstaged
    // edit) removed from disk during the turn were recorded `D +0 -0`,
    // because numstat against HEAD has no record of a file HEAD never had.
    gitInfoResult = repo([
      {
        path: 'notes.md',
        status: '??',
        staged: false,
        additions: 12,
        deletions: 0,
      },
      {
        path: 'staged.md',
        status: 'A',
        staged: true,
        additions: 10,
        deletions: 0,
      },
      {
        path: 'staged.md',
        status: 'M',
        staged: false,
        additions: 2,
        deletions: 3,
      },
    ]);
    submitPrompt();
    await settle();
    gitInfoResult = repo([]);
    endTurn();
    await waitUntil(() => pushes.length === 1);

    expect(pushes[0].changeSet).toMatchObject({
      files: [
        { path: 'notes.md', status: 'D', additions: 0, deletions: 12 },
        { path: 'staged.md', status: 'D', additions: 0, deletions: 9 },
      ],
      totals: { files: 2, additions: 0, deletions: 21 },
      countsUnavailable: false,
    });
    expect(gitInfo.readChangeSetNumstat).not.toHaveBeenCalled();
  });

  it('reports a file the turn added and committed as added, not deleted', async () => {
    await fs.writeFile(path.join(root, 'kept.ts'), 'k\n');
    gitInfoResult = repo([{ path: 'kept.ts', status: '??', staged: false }]);
    submitPrompt();
    await settle();
    // Committed: clean against HEAD, so gone from status, still on disk.
    gitInfoResult = repo([]);
    endTurn();
    await waitUntil(() => pushes.length === 1);
    expect(pushes[0].changeSet.files).toEqual([
      { path: 'kept.ts', status: 'A', additions: 3, deletions: 1 },
    ]);
  });

  it('reports a committed deletion as deleted and a committed edit as modified', async () => {
    await fs.writeFile(path.join(root, 'edited.ts'), 'e\n');
    gitInfoResult = repo([
      { path: 'edited.ts', status: 'M', staged: false },
      { path: 'removed.ts', status: 'D', staged: false },
    ]);
    submitPrompt();
    await settle();
    gitInfoResult = repo([]);
    endTurn();
    await waitUntil(() => pushes.length === 1);
    expect(pushes[0].changeSet.files).toEqual([
      { path: 'edited.ts', status: 'M', additions: 3, deletions: 1 },
      { path: 'removed.ts', status: 'D', additions: 3, deletions: 1 },
    ]);
  });

  it('checks the disk at the repository top level when the session runs in a subdirectory', async () => {
    const sub = path.join(root, 'pkg');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, 'new.ts'), 'n\n');
    gitInfo.resolveRepositoryRoot.mockResolvedValue(root);
    gitInfoResult = repo([{ path: 'pkg/new.ts', status: '??', staged: false }]);
    submitPrompt(sub);
    await settle();
    gitInfoResult = repo([]);
    endTurn({ cwd: sub });
    await waitUntil(() => pushes.length === 1);
    expect(gitInfo.resolveRepositoryRoot).toHaveBeenCalledWith(sub);
    expect(pushes[0].changeSet.files).toEqual([
      { path: 'pkg/new.ts', status: 'A', additions: 3, deletions: 1 },
    ]);
  });

  it('deletes the baseline when a turn fails, so the next turn starts fresh', async () => {
    submitPrompt();
    await settle();
    gitInfoResult = repo([{ path: 'a.ts', status: 'M', staged: false }]);
    failTurn();
    await waitUntil(() => pushes.length === 1);
    expect(pushes).toHaveLength(1);

    // Next turn: baseline already contains a.ts; nothing else changes.
    submitPrompt(root, 3_000);
    await settle();
    endTurn({ timestamp: 4_000 });
    await waitUntil(() => gitInfo.getGitInfo.mock.calls.length === 4);
    await settle();
    expect(pushes).toHaveLength(1);
  });

  it('keeps the first baseline when a prompt is submitted mid-turn', async () => {
    submitPrompt(root, 1_000);
    await settle();
    gitInfoResult = repo([{ path: 'a.ts', status: 'M', staged: false }]);
    submitPrompt(root, 1_500);
    await settle();
    endTurn();
    await waitUntil(() => pushes.length === 1);

    expect(pushes).toHaveLength(1);
    expect(pushes[0].changeSet.turnStartedAt).toBe(1_000);
  });

  it('awaits a baseline still being captured when the turn ends', async () => {
    let releaseBaseline!: () => void;
    gitInfo.getGitInfo.mockImplementationOnce(
      () =>
        new Promise<GitInfoResult>((resolve) => {
          releaseBaseline = () => resolve(repo([]));
        }),
    );
    submitPrompt();
    gitInfoResult = repo([{ path: 'a.ts', status: 'M', staged: false }]);
    endTurn();
    await settle();
    expect(pushes).toEqual([]);

    releaseBaseline();
    await waitUntil(() => pushes.length === 1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].changeSet.baselineMissing).toBeUndefined();
  });

  it("falls back to the session's workingDirectory when the hook gives no cwd", async () => {
    metadata.get.mockResolvedValue({ workingDirectory: root });
    submitPrompt('');
    await settle();
    gitInfoResult = repo([{ path: 'a.ts', status: 'M', staged: false }]);
    endTurn({ cwd: '' });
    await waitUntil(() => pushes.length === 1);

    expect(metadata.get).toHaveBeenCalledWith(SESSION);
    expect(gitInfo.getGitInfo).toHaveBeenCalledWith(root);
    expect(pushes[0].changeSet.workspaceRoot).toBe(root);
  });

  it('records nothing when no working directory is known', async () => {
    submitPrompt('');
    await settle();
    endTurn({ cwd: '' });
    await settle();
    expect(gitInfo.getGitInfo).not.toHaveBeenCalled();
    expect(pushes).toEqual([]);
  });

  it('still pushes when persisting fails', async () => {
    storage.failUpdates = true;
    submitPrompt();
    await settle();
    gitInfoResult = repo([{ path: 'a.ts', status: 'M', staged: false }]);
    endTurn();
    await waitUntil(() => pushes.length === 1);

    expect(pushes).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not persist'),
      expect.any(Error),
    );
  });

  it('stops listening after dispose', async () => {
    recorder.dispose();
    submitPrompt();
    endTurn();
    await settle();
    expect(gitInfo.getGitInfo).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });
});
