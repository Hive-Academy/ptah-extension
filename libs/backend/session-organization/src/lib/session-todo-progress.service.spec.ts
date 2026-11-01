/**
 * SessionTodoProgressService — main-thread TodoWrite snapshots, persisted on
 * the host, written (and pushed) only when they change. Real stores and
 * service on SQLite; the PostToolUse registry and metadata are fakes.
 */
import * as path from 'node:path';
import {
  normalizeWorkspaceRoot,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import type { PostToolUsePayload } from '@ptah-extension/agent-sdk';
import {
  asConnectionService,
  openTestConnection,
} from '../testing/sqlite-test-db';
import { SessionAutoLinkStore } from './session-auto-link.store';
import {
  SessionOrganizationService,
  type SessionOrganizationChange,
  type SessionOrganizationMetadataReader,
} from './session-organization.service';
import { SessionOrganizationStore } from './session-organization.store';
import {
  SessionTodoProgressService,
  toTodoProgress,
} from './session-todo-progress.service';

const ROOT = normalizeWorkspaceRoot(path.resolve('/projects/ws'));
const S = 'session-s';

function setup() {
  const connection = openTestConnection();
  const lines: string[] = [];
  const output = {
    appendLine: (line: string) => lines.push(line),
  } as Pick<IOutputChannel, 'appendLine'> as IOutputChannel;
  const metadata = {
    get: async (id: string) => (id === S ? { workspaceId: ROOT } : null),
  } as unknown as SessionOrganizationMetadataReader;
  const auto = new SessionAutoLinkStore(asConnectionService(connection));
  const store = new SessionOrganizationStore(
    asConnectionService(connection),
    output,
    auto,
  );
  const service = new SessionOrganizationService(store, metadata, output);
  const changes: SessionOrganizationChange[] = [];
  service.onDidChange((change) => changes.push(change));
  let callback: ((payload: PostToolUsePayload) => void) | null = null;
  const registry = {
    register: jest.fn((cb: (payload: PostToolUsePayload) => void) => {
      callback = cb;
      return () => {
        callback = null;
      };
    }),
  };
  const todos = new SessionTodoProgressService(service, store, registry, output);
  todos.start();
  const fire = (overrides: Partial<PostToolUsePayload>): void =>
    callback?.({
      toolName: 'TodoWrite',
      toolInput: {
        todos: [
          { content: 'Plan', status: 'completed', activeForm: 'Planning' },
          { content: 'Build', status: 'in_progress', activeForm: 'Building it' },
          { content: 'Ship', status: 'pending' },
        ],
      },
      toolOutput: {},
      exitCode: null,
      success: true,
      sessionId: S,
      workspaceRoot: ROOT,
      timestamp: 42,
      ...overrides,
    });
  return { store, todos, registry, fire, changes, lines, isSubscribed: () => callback !== null };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('toTodoProgress', () => {
  it('counts done and total and labels the first in-progress item', () => {
    expect(
      toTodoProgress(
        {
          todos: [
            { content: 'a', status: 'completed' },
            { content: '  b  ', status: 'in_progress', activeForm: '   ' },
            { content: 'c', status: 'in_progress', activeForm: 'C-ing' },
          ],
        },
        5,
      ),
    ).toEqual({ done: 1, total: 3, inProgress: 'b', updatedAt: 5 });
  });

  it('caps the label at 200 characters and is null with nothing in progress', () => {
    const long = 'x'.repeat(300);
    expect(
      toTodoProgress({ todos: [{ content: long, status: 'in_progress' }] }, 1)
        .inProgress,
    ).toHaveLength(200);
    expect(toTodoProgress({ todos: [] }, 1)).toEqual({
      done: 0,
      total: 0,
      inProgress: null,
      updatedAt: 1,
    });
  });
});

describe('SessionTodoProgressService', () => {
  it('persists a main-thread TodoWrite snapshot and emits one change', async () => {
    const h = setup();
    h.fire({});
    await flush();
    expect(h.store.getOrganization(ROOT, S)?.todos).toEqual({
      done: 1,
      total: 3,
      inProgress: 'Building it',
      updatedAt: 42,
    });
    expect(h.changes).toEqual([
      { workspaceRoot: ROOT, sessionIds: [S], reason: 'capture' },
    ]);
  });

  it('writes and emits nothing for an unchanged snapshot', async () => {
    const h = setup();
    h.fire({});
    await flush();
    h.fire({ timestamp: 99 });
    await flush();
    expect(h.changes).toHaveLength(1);
    expect(h.store.getOrganization(ROOT, S)?.todos?.updatedAt).toBe(42);
  });

  it('ignores subagents, failures, other tools and unparseable input', async () => {
    const h = setup();
    h.fire({ agentId: 'agent-1' });
    h.fire({ success: false });
    h.fire({ toolName: 'Bash' });
    h.fire({ toolInput: { todos: [{ content: 1, status: 'done' }] } });
    await flush();
    expect(h.changes).toEqual([]);
    expect(h.store.getOrganization(ROOT, S)).toBeNull();
    expect(h.lines.filter((l) => l.includes('did not parse'))).toHaveLength(1);
  });

  it('the workspace read carries the snapshot (session:list path)', async () => {
    const h = setup();
    h.fire({});
    await flush();
    expect(h.store.listWorkspace(ROOT).get(S)?.todos?.done).toBe(1);
  });

  it('start is idempotent and dispose unsubscribes', () => {
    const h = setup();
    h.todos.start();
    expect(h.registry.register).toHaveBeenCalledTimes(1);
    h.todos.dispose();
    h.todos.dispose();
    expect(h.isSubscribed()).toBe(false);
  });
});
