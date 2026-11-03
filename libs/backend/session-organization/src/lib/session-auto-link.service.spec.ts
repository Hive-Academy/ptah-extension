/**
 * SessionAutoLinkService — every rule of the precedence table, every trigger
 * order, the user overrides and restart, against the REAL stores and service
 * on SQLite (migrations 1..50 and 0063). Registries, the metadata store, the
 * file system and the task index are small fakes.
 */
import * as path from 'node:path';
import {
  normalizeWorkspaceRoot,
  type IDisposable,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import type {
  SessionIdResolvedPayload,
  UserPromptExpansionPayload,
  UserPromptSubmitPayload,
} from '@ptah-extension/agent-sdk';
import type { TaskIndexChangeEvent } from '@ptah-extension/task-specs';
import {
  asConnectionService,
  openTestConnection,
  type TestConnection,
} from '../testing/sqlite-test-db';
import {
  SessionAutoLinkService,
  type AutoLinkFileSystem,
  type AutoLinkMetadataReader,
} from './session-auto-link.service';
import { SessionAutoLinkStore } from './session-auto-link.store';
import {
  SessionOrganizationService,
  type SessionOrganizationChange,
} from './session-organization.service';
import { SessionOrganizationStore } from './session-organization.store';

const ROOT = normalizeWorkspaceRoot(path.resolve('/projects/ws'));
const A = 'TASK_2026_101';
const B = 'TASK_2026_102';
const C = 'TASK_2026_103';
const S = 'session-s';
const P = 'session-p';
const P2 = 'session-p2';

class FakeRegistry<T> {
  private readonly callbacks = new Set<(payload: T) => void>();
  get size(): number {
    return this.callbacks.size;
  }
  register(callback: (payload: T) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
  fire(payload: T): void {
    for (const callback of [...this.callbacks]) callback(payload);
  }
}

interface FakeMetadata {
  workspaceId: string;
  workingDirectory?: string;
}

interface World {
  connection: TestConnection;
  metadata: Map<string, FakeMetadata>;
  files: Map<string, string>;
  lines: string[];
  changes: SessionOrganizationChange[];
  prompts: FakeRegistry<UserPromptSubmitPayload>;
  expansions: FakeRegistry<UserPromptExpansionPayload>;
  resolved: FakeRegistry<SessionIdResolvedPayload>;
  index: FakeRegistry<TaskIndexChangeEvent>;
  /** Awaited by every `exists` call (resolved path); lets a test hold a run. */
  existsHook?: (file: string) => Promise<void> | undefined;
  /** Every `exists` call throws while set. */
  failExists?: boolean;
}

interface Host {
  store: SessionOrganizationStore;
  auto: SessionAutoLinkStore;
  service: SessionOrganizationService;
  autoLink: SessionAutoLinkService;
}

function world(options: { open?: boolean } = {}): World {
  return {
    connection: openTestConnection(options),
    metadata: new Map(),
    files: new Map(),
    lines: [],
    changes: [],
    prompts: new FakeRegistry(),
    expansions: new FakeRegistry(),
    resolved: new FakeRegistry(),
    index: new FakeRegistry(),
  };
}

/** Build (or rebuild, for "restart") the host objects over the world. */
function host(w: World): Host {
  const output = {
    appendLine: (line: string) => w.lines.push(line),
  } as Pick<IOutputChannel, 'appendLine'> as IOutputChannel;
  const metadata = {
    get: async (id: string) => w.metadata.get(id) ?? null,
  } as unknown as AutoLinkMetadataReader;
  const fs: AutoLinkFileSystem = {
    exists: async (file: string) => {
      await w.existsHook?.(path.resolve(file));
      if (w.failExists) throw new Error('EIO');
      return w.files.has(path.resolve(file));
    },
    readFile: async (file: string) => {
      const content = w.files.get(path.resolve(file));
      if (content === undefined) throw new Error(`ENOENT ${file}`);
      return content;
    },
  };
  const auto = new SessionAutoLinkStore(asConnectionService(w.connection));
  const store = new SessionOrganizationStore(
    asConnectionService(w.connection),
    output,
    auto,
  );
  const service = new SessionOrganizationService(store, metadata, output);
  service.onDidChange((change) => w.changes.push(change));
  const autoLink = new SessionAutoLinkService(
    service,
    store,
    auto,
    metadata,
    fs,
    w.prompts,
    w.expansions,
    w.resolved,
    output,
    {
      onDidChangeIndex: (listener): IDisposable => ({
        dispose: w.index.register(listener),
      }),
    },
  );
  autoLink.start();
  return { store, auto, service, autoLink };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function addTask(w: World, taskId: string, dir = ROOT): void {
  w.files.set(path.resolve(dir, '.ptah', 'specs', taskId, 'task.md'), '---');
}

function addSession(w: World, id: string, workingDirectory?: string): void {
  w.metadata.set(id, {
    workspaceId: ROOT,
    ...(workingDirectory !== undefined ? { workingDirectory } : {}),
  });
}

function prompt(w: World, sessionId: string, text: string, agentId?: string): void {
  w.prompts.fire({
    prompt: text,
    sessionId,
    workspaceRoot: ROOT,
    timestamp: 1,
    ...(agentId !== undefined ? { agentId } : {}),
  });
}

function resolve(w: World, sessionId: string): void {
  w.resolved.fire({ tabId: 'tab', realSessionId: sessionId, timestamp: 1 });
}

/** `[taskId, role, source]` of a session, sorted by task. */
function links(h: Host, sessionId: string): Array<[string, string, string]> {
  return (h.store.getOrganization(ROOT, sessionId)?.tasks ?? [])
    .map((t): [string, string, string] => [t.taskId, t.role, t.source])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

async function inWorktree(
  h: Host,
  sessionId: string,
  worktreePath: string,
  branch?: string,
): Promise<void> {
  h.service.recordWorktree({ sessionId, worktreePath, ...(branch ? { branch } : {}) });
  await flush();
}

describe('SessionAutoLinkService', () => {
  describe('R3 /orchestrate', () => {
    it('links when everything is ready', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addSession(w, S);

      prompt(w, S, `/orchestrate ${A}\nplease`);
      await flush();

      expect(links(h, S)).toEqual([[A, 'primary', 'orchestrate']]);
      expect(w.changes).toContainEqual(
        expect.objectContaining({ sessionIds: [S], reason: 'capture' }),
      );
    });

    it('accepts a four-digit sequence', async () => {
      const w = world();
      const h = host(w);
      addTask(w, 'TASK_2026_1234');
      addSession(w, S);
      prompt(w, S, '/orchestrate TASK_2026_1234');
      await flush();
      expect(links(h, S)).toEqual([['TASK_2026_1234', 'primary', 'orchestrate']]);
    });

    it.each([
      ['prompt, resolve, open', ['prompt', 'resolve', 'open']],
      ['prompt, open, resolve', ['prompt', 'open', 'resolve']],
      ['resolve, prompt, open', ['resolve', 'prompt', 'open']],
    ])('links in the order %s', async (_name, steps) => {
      const w = world({ open: false });
      const h = host(w);
      addTask(w, A);
      for (const step of steps) {
        if (step === 'prompt') prompt(w, S, `/orchestrate ${A}`);
        if (step === 'resolve') {
          addSession(w, S);
          resolve(w, S);
        }
        if (step === 'open') w.connection.open();
        await flush();
      }
      expect(links(h, S)).toEqual([[A, 'primary', 'orchestrate']]);
    });

    it('links through the slash-command expansion too', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addSession(w, S);
      w.expansions.fire({
        skillSlug: 'orchestrate',
        expansionType: 'slash_command',
        commandArgs: A,
        sessionId: S,
        workspaceRoot: ROOT,
        timestamp: 1,
      });
      await flush();
      expect(links(h, S)).toEqual([[A, 'primary', 'orchestrate']]);
    });

    it('ignores a subagent prompt and a subagent expansion', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addSession(w, S);
      prompt(w, S, `/orchestrate ${A}`, 'agent-1');
      w.expansions.fire({
        skillSlug: 'orchestrate',
        expansionType: 'slash_command',
        commandArgs: A,
        sessionId: S,
        workspaceRoot: ROOT,
        timestamp: 1,
        agentId: 'agent-1',
      });
      await flush();
      expect(links(h, S)).toEqual([]);
    });

    it('makes no link when the task has no task.md', async () => {
      const w = world();
      const h = host(w);
      addSession(w, S);
      prompt(w, S, `/orchestrate ${A}`);
      await flush();
      expect(links(h, S)).toEqual([]);
      expect(w.lines.some((l) => l.includes(A) && l.includes('task.md'))).toBe(true);
      expect(w.lines.some((l) => l.includes('/orchestrate'))).toBe(false);
    });

    it('bounds the queue at 64 and evicts the oldest with one line', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      for (let i = 0; i <= 64; i++) prompt(w, `q${i}`, `/orchestrate ${A}`);
      await flush();
      expect(w.lines.filter((l) => l.includes('queue full'))).toHaveLength(1);
      addSession(w, 'q0');
      addSession(w, 'q64');
      resolve(w, 'q0');
      resolve(w, 'q64');
      await flush();
      expect(links(h, 'q0')).toEqual([]);
      expect(links(h, 'q64')).toEqual([[A, 'primary', 'orchestrate']]);
    });

    it('the first /orchestrate keeps the primary', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addTask(w, B);
      addSession(w, S);
      prompt(w, S, `/orchestrate ${A}`);
      await flush();
      prompt(w, S, `/orchestrate ${B}`);
      await flush();
      expect(links(h, S)).toEqual([
        [A, 'primary', 'orchestrate'],
        [B, 'related', 'orchestrate'],
      ]);
    });
  });

  describe('R4 / R5 worktree', () => {
    it('records the git worktree on resolve and links the task its branch names', async () => {
      const w = world();
      const h = host(w);
      const wt = path.resolve('/projects/ws/.claude-worktrees/feature');
      const gitdir = path.resolve('/projects/ws/.git/worktrees/feature');
      w.files.set(path.join(wt, '.git'), `gitdir: ${gitdir}`);
      w.files.set(path.join(gitdir, 'HEAD'), `ref: refs/heads/feat/${A}-auth`);
      addTask(w, A);
      addSession(w, S, wt);

      resolve(w, S);
      await flush();

      const org = h.store.getOrganization(ROOT, S);
      expect(org?.worktreePath).toBe(wt);
      expect(org?.branch).toBe(`feat/${A}-auth`);
      expect(links(h, S)).toEqual([[A, 'primary', 'worktree']]);
    });

    it('never overwrites a recorded worktree', async () => {
      const w = world();
      const h = host(w);
      const wt = path.resolve('/projects/ws/.claude-worktrees/feature');
      w.files.set(path.join(wt, '.git'), 'gitdir: /x');
      addSession(w, S, wt);
      await inWorktree(h, S, '/spawner/chosen');
      resolve(w, S);
      await flush();
      expect(h.store.getOrganization(ROOT, S)?.worktreePath).toBe('/spawner/chosen');
    });

    it('R4 needs exactly one existing task', async () => {
      const w = world();
      const h = host(w);
      addSession(w, S);
      await inWorktree(h, S, `/wt/${A}-${B}`);
      expect(links(h, S)).toEqual([]);
      addTask(w, A);
      addTask(w, B);
      await inWorktree(h, S, `/wt/${A}-${B}-x`);
      expect(links(h, S)).toEqual([]);
    });

    it('a worktree rename removes the old R4 link and adds the new one', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addTask(w, B);
      addSession(w, S);
      await inWorktree(h, S, `/wt/${A}`);
      expect(links(h, S)).toEqual([[A, 'primary', 'worktree']]);
      await inWorktree(h, S, `/wt/${B}`);
      expect(links(h, S)).toEqual([[B, 'primary', 'worktree']]);
    });

    it('R5 links the one explicit primary of the worktree peers', async () => {
      const w = world();
      const h = host(w);
      addSession(w, S);
      addSession(w, P);
      await inWorktree(h, P, '/wt/shared');
      await h.service.linkSessionTask({ sessionId: P, taskId: B, role: 'primary', source: 'user' });
      await inWorktree(h, S, '/wt/shared');
      await flush();
      expect(links(h, S)).toEqual([[B, 'primary', 'worktree']]);
    });

    it('late peer ambiguity removes the R5 link', async () => {
      const w = world();
      const h = host(w);
      for (const id of [S, P, P2]) addSession(w, id);
      await inWorktree(h, P, '/wt/shared');
      await inWorktree(h, P2, '/wt/shared');
      await h.service.linkSessionTask({ sessionId: P, taskId: B, role: 'primary', source: 'user' });
      await inWorktree(h, S, '/wt/shared');
      await flush();
      expect(links(h, S)).toEqual([[B, 'primary', 'worktree']]);

      await h.service.linkSessionTask({ sessionId: P2, taskId: C, role: 'primary', source: 'agent' });
      await flush();
      expect(links(h, S)).toEqual([]);
    });

    it('peers never keep each other linked through their own R5 links', async () => {
      const w = world();
      const h = host(w);
      for (const id of [S, P]) addSession(w, id);
      await inWorktree(h, P, '/wt/shared');
      await h.service.linkSessionTask({ sessionId: P, taskId: B, role: 'primary', source: 'user' });
      await inWorktree(h, S, '/wt/shared');
      await flush();
      await h.service.unlinkSessionTask({ sessionId: P, taskId: B });
      await flush();
      expect(links(h, S)).toEqual([]);
      expect(links(h, P)).toEqual([]);
    });

    it('R5 then R4 and R4 then R5 end with the same rows', async () => {
      async function run(r4First: boolean): Promise<unknown> {
        const w = world();
        const h = host(w);
        for (const id of [S, P]) addSession(w, id);
        if (r4First) addTask(w, A);
        await inWorktree(h, P, `/wt/${A}-x`);
        await h.service.linkSessionTask({ sessionId: P, taskId: B, role: 'primary', source: 'user' });
        await inWorktree(h, S, `/wt/${A}-x`);
        if (!r4First) {
          addTask(w, A);
          w.index.fire({ workspaceRoot: ROOT, folderNames: [A], reason: 'watcher' });
        }
        await flush();
        return links(h, S);
      }
      expect(await run(false)).toEqual(await run(true));
      expect(await run(true)).toEqual([[A, 'primary', 'worktree']]);
    });

    it('R3 then R4 and R4 then R3 end with the same rows', async () => {
      async function run(r3First: boolean): Promise<unknown> {
        const w = world();
        const h = host(w);
        addTask(w, A);
        addTask(w, B);
        addSession(w, S);
        if (r3First) {
          prompt(w, S, `/orchestrate ${B}`);
          await flush();
        }
        await inWorktree(h, S, `/wt/${A}`);
        if (!r3First) {
          prompt(w, S, `/orchestrate ${B}`);
          await flush();
        }
        return links(h, S);
      }
      expect(await run(true)).toEqual([
        [A, 'related', 'worktree'],
        [B, 'primary', 'orchestrate'],
      ]);
      expect(await run(false)).toEqual(await run(true));
    });
  });

  describe('R6 / R7 lineage', () => {
    it('a child inherits the parent primary as related and follows its changes', async () => {
      const w = world();
      const h = host(w);
      addSession(w, P);
      addSession(w, S);
      await h.service.linkSessionTask({ sessionId: P, taskId: A, role: 'primary', source: 'user' });
      h.service.recordLineage({ sessionId: S, parentSessionId: P });
      await flush();
      expect(links(h, S)).toEqual([[A, 'related', 'inherited']]);

      await h.service.linkSessionTask({ sessionId: P, taskId: B, role: 'primary', source: 'user' });
      await flush();
      expect(links(h, S)).toEqual([[B, 'related', 'inherited']]);
    });

    it('a fork copies the source links with their roles and follows them', async () => {
      const w = world();
      const h = host(w);
      addSession(w, P);
      addSession(w, S);
      await h.service.linkSessionTask({ sessionId: P, taskId: A, role: 'primary', source: 'user' });
      await h.service.linkSessionTask({ sessionId: P, taskId: B, role: 'related', source: 'user' });
      h.service.recordLineage({ sessionId: S, forkOfSessionId: P });
      await flush();
      expect(links(h, S)).toEqual([
        [A, 'primary', 'inherited'],
        [B, 'related', 'inherited'],
      ]);

      await h.service.unlinkSessionTask({ sessionId: P, taskId: A });
      await flush();
      expect(links(h, S)).toEqual([[B, 'related', 'inherited']]);
    });

    it('an agent-started child keeps its explicit task primary', async () => {
      const w = world();
      const h = host(w);
      addSession(w, P);
      addSession(w, S);
      await h.service.linkSessionTask({ sessionId: P, taskId: A, role: 'primary', source: 'user' });
      h.service.recordAgentStartedSession({
        sessionId: S,
        workspaceRoot: ROOT,
        parentSessionId: P,
        worktreePath: '/wt/child',
        branch: 'child',
        taskId: B,
      });
      await flush();
      expect(links(h, S)).toEqual([
        [A, 'related', 'inherited'],
        [B, 'primary', 'agent'],
      ]);
    });
  });

  describe('user overrides', () => {
    it('an unlinked automatic link never comes back, whatever replays', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addSession(w, S);
      await inWorktree(h, S, `/wt/${A}`);
      await h.service.unlinkSessionTask({ sessionId: S, taskId: A });
      await flush();

      prompt(w, S, `/orchestrate ${A}`);
      resolve(w, S);
      w.index.fire({ workspaceRoot: ROOT, folderNames: [A], reason: 'write' });
      await inWorktree(h, S, `/wt/${A}`);
      await flush();
      expect(links(h, S)).toEqual([]);
    });

    it('a relink then unlink suppresses again', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addSession(w, S);
      await inWorktree(h, S, `/wt/${A}`);
      await h.service.unlinkSessionTask({ sessionId: S, taskId: A });
      await h.service.linkSessionTask({ sessionId: S, taskId: A, role: 'primary', source: 'user' });
      await flush();
      expect(links(h, S)).toEqual([[A, 'primary', 'user']]);
      await h.service.unlinkSessionTask({ sessionId: S, taskId: A });
      resolve(w, S);
      await flush();
      expect(links(h, S)).toEqual([]);
    });

    it('a demoted automatic primary is adopted and never re-promoted', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addSession(w, S);
      await inWorktree(h, S, `/wt/${A}`);
      await h.service.linkSessionTask({ sessionId: S, taskId: A, role: 'related', source: 'user' });
      resolve(w, S);
      await flush();
      expect(links(h, S)).toEqual([[A, 'related', 'user']]);
    });

    it('never changes a task status (no task writes at all)', async () => {
      const w = world();
      host(w);
      addTask(w, A);
      addSession(w, S);
      const before = new Map(w.files);
      prompt(w, S, `/orchestrate ${A}`);
      await flush();
      expect(w.files).toEqual(before);
    });
  });

  describe('restart and late evidence', () => {
    it('a rebuilt host over the same database replays every trigger with no change', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addTask(w, B);
      addSession(w, S);
      addSession(w, P);
      prompt(w, S, `/orchestrate ${B}`);
      await inWorktree(h, S, `/wt/${A}`);
      await h.service.linkSessionTask({ sessionId: P, taskId: C, role: 'primary', source: 'user' });
      h.service.recordLineage({ sessionId: S, parentSessionId: P });
      await flush();
      const before = { s: links(h, S), p: links(h, P) };
      h.autoLink.dispose();

      const restarted = host(w);
      const changeCount = w.changes.length;
      resolve(w, S);
      resolve(w, P);
      w.index.fire({ workspaceRoot: ROOT, folderNames: [A, B], reason: 'watcher' });
      await flush();
      expect({ s: links(restarted, S), p: links(restarted, P) }).toEqual(before);
      expect(w.changes.length).toBe(changeCount);
    });

    it('a resumed pre-existing session in a named worktree gets its R4 link', async () => {
      const w = world();
      const first = host(w);
      addSession(w, S);
      await inWorktree(first, S, `/wt/${A}`);
      expect(links(first, S)).toEqual([]);
      first.autoLink.dispose();

      addTask(w, A);
      const second = host(w);
      resolve(w, S);
      await flush();
      expect(links(second, S)).toEqual([[A, 'primary', 'worktree']]);
    });

    it('a task folder created later is linked on its index watcher event', async () => {
      const w = world();
      const h = host(w);
      addSession(w, S);
      await inWorktree(h, S, `/wt/${A}`);
      expect(links(h, S)).toEqual([]);
      addTask(w, A);
      w.index.fire({ workspaceRoot: ROOT, folderNames: [A], reason: 'watcher' });
      await flush();
      expect(links(h, S)).toEqual([[A, 'primary', 'worktree']]);
    });

    it('a reindex event reads nothing', async () => {
      const w = world();
      const h = host(w);
      const find = jest.spyOn(h.auto, 'findSessionsNamingTask');
      w.index.fire({ workspaceRoot: ROOT, folderNames: [], reason: 'reindex' });
      w.index.fire({ workspaceRoot: ROOT, folderNames: [A], reason: 'reindex' });
      await flush();
      expect(find).not.toHaveBeenCalled();
    });

    it('a resolve while the store is closed reconciles when it opens', async () => {
      const w = world({ open: false });
      const h = host(w);
      const wt = path.resolve('/projects/ws/.claude-worktrees/x');
      w.files.set(path.join(wt, '.git'), 'gitdir: ../../.git/worktrees/x');
      w.files.set(path.resolve(wt, '../../.git/worktrees/x', 'HEAD'), `ref: refs/heads/${A}`);
      addTask(w, A);
      addSession(w, S, wt);
      resolve(w, S);
      await flush();
      w.connection.open();
      await flush();
      expect(links(h, S)).toEqual([[A, 'primary', 'worktree']]);
    });

    it('one change event ends after a bounded number of writes', async () => {
      const w = world();
      const h = host(w);
      addSession(w, P);
      for (let i = 0; i < 5; i++) {
        addSession(w, `child-${i}`);
        h.service.recordLineage({ sessionId: `child-${i}`, parentSessionId: P });
      }
      await flush();
      const start = w.changes.length;
      await h.service.linkSessionTask({ sessionId: P, taskId: A, role: 'primary', source: 'user' });
      await flush();
      await flush();
      // The user write, then one auto write per child; nothing loops.
      expect(w.changes.length - start).toBe(6);
    });
  });

  describe('failures and bounds (review fixes)', () => {
    it('re-runs a reconcile whose write threw once, and links the R3 task', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addSession(w, S);
      jest.spyOn(h.store, 'applyAutoLinkPlan').mockImplementationOnce(() => {
        throw new Error('SQLITE_BUSY');
      });
      prompt(w, S, `/orchestrate ${A}`);
      await flush();
      expect(links(h, S)).toEqual([[A, 'primary', 'orchestrate']]);
      expect(w.lines.some((l) => l.includes('SQLITE_BUSY'))).toBe(true);
    });

    it('keeps the R3 candidate when every write throws, and links it on the next resolve', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addSession(w, S);
      const apply = jest
        .spyOn(h.store, 'applyAutoLinkPlan')
        .mockImplementation(() => {
          throw new Error('disk full');
        });
      prompt(w, S, `/orchestrate ${A}`);
      await flush();
      expect(links(h, S)).toEqual([]);
      expect(w.lines.some((l) => l.includes(`autoLink R3 ${A} kept for ${S}: failed`))).toBe(true);

      apply.mockRestore();
      resolve(w, S);
      await flush();
      expect(links(h, S)).toEqual([[A, 'primary', 'orchestrate']]);
    });

    it('a write made by a cascade does not cascade again (one level deep)', async () => {
      const w = world();
      const h = host(w);
      const F1 = 'session-f1';
      const F2 = 'session-f2';
      for (const id of [P, F1, F2]) addSession(w, id);
      await h.service.linkSessionTask({ sessionId: P, taskId: A, role: 'primary', source: 'user' });
      h.service.recordLineage({ sessionId: F1, forkOfSessionId: P });
      await flush();
      h.service.recordLineage({ sessionId: F2, forkOfSessionId: F1 });
      await flush();
      expect(links(h, F2)).toEqual([[A, 'primary', 'inherited']]);

      const reconciled = jest.spyOn(h.store, 'applyAutoLinkPlan');
      await h.service.linkSessionTask({ sessionId: P, taskId: B, role: 'related', source: 'user' });
      await flush();
      await flush();
      // P itself, then its fork F1; F1's own write does not reach F2.
      expect(reconciled.mock.calls.map((call) => call[1]).sort()).toEqual([F1, P].sort());
      expect(links(h, F1)).toEqual([
        [A, 'primary', 'inherited'],
        [B, 'related', 'inherited'],
      ]);
      expect(links(h, F2)).toEqual([[A, 'primary', 'inherited']]);
    });

    it('keeps an R4 link when the existence check throws, and drops it when the folder is gone', async () => {
      const w = world();
      const h = host(w);
      addTask(w, A);
      addSession(w, S);
      await inWorktree(h, S, `/wt/${A}`);
      expect(links(h, S)).toEqual([[A, 'primary', 'worktree']]);

      w.failExists = true;
      w.index.fire({ workspaceRoot: ROOT, folderNames: [A], reason: 'watcher' });
      await flush();
      expect(links(h, S)).toEqual([[A, 'primary', 'worktree']]);

      w.failExists = false;
      w.files.clear();
      w.index.fire({ workspaceRoot: ROOT, folderNames: [A], reason: 'watcher' });
      await flush();
      expect(links(h, S)).toEqual([]);
    });

    it('a run that throws does not strand a request merged while it ran', async () => {
      const w = world();
      const h = host(w);
      addTask(w, B);
      addSession(w, P);
      addSession(w, S);
      h.service.recordLineage({ sessionId: S, parentSessionId: P });
      await inWorktree(h, S, `/wt/${A}-x`);

      const gate = deferred();
      w.existsHook = (file) => (file.includes(A) ? gate.promise : undefined);
      let armed = false;
      const read = h.store.getOrganization.bind(h.store);
      jest.spyOn(h.store, 'getOrganization').mockImplementation((root, id) => {
        if (armed && id === P) {
          armed = false;
          throw new Error('boom');
        }
        return read(root, id);
      });

      // A run of S holds on the A existence check; the prompt merges into it.
      w.index.fire({ workspaceRoot: ROOT, folderNames: [A], reason: 'watcher' });
      await flush();
      prompt(w, S, `/orchestrate ${B}`);
      await flush();
      armed = true;
      gate.resolve();
      await flush();

      expect(w.lines.some((l) => l.includes(`autoLink reconcile failed for ${S}: boom`))).toBe(true);
      expect(links(h, S)).toContainEqual([B, 'primary', 'orchestrate']);
    });

    it('a reconcile in flight at dispose writes nothing', async () => {
      const w = world();
      const h = host(w);
      addSession(w, S);
      await inWorktree(h, S, `/wt/${A}`);
      addTask(w, A);
      const gate = deferred();
      w.existsHook = () => gate.promise;
      w.index.fire({ workspaceRoot: ROOT, folderNames: [A], reason: 'watcher' });
      await flush();

      h.autoLink.dispose();
      const changes = w.changes.length;
      gate.resolve();
      await flush();
      expect(links(h, S)).toEqual([]);
      expect(w.changes.length).toBe(changes);
    });

    it('logs a resolve whose session has no metadata', async () => {
      const w = world();
      host(w);
      resolve(w, 'session-unknown');
      await flush();
      expect(
        w.lines.some((l) => l.includes('autoLink resolve skipped for session-unknown')),
      ).toBe(true);
    });
  });

  it('start is idempotent and dispose releases every subscription', () => {
    const w = world();
    const h = host(w);
    h.autoLink.start();
    expect([w.prompts.size, w.expansions.size, w.resolved.size, w.index.size]).toEqual([1, 1, 1, 1]);
    h.autoLink.dispose();
    h.autoLink.dispose();
    expect([w.prompts.size, w.expansions.size, w.resolved.size, w.index.size]).toEqual([0, 0, 0, 0]);
  });
});
