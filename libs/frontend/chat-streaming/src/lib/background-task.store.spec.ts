import { BackgroundTaskStore } from './background-task.store';
import type { BackgroundTasksSnapshotEvent } from '@ptah-extension/shared';

const snapshot = (
  sessionId: string,
  tasks: BackgroundTasksSnapshotEvent['tasks'],
): BackgroundTasksSnapshotEvent => ({
  id: 'event-1',
  eventType: 'background_tasks_snapshot',
  timestamp: 1,
  messageId: `background-tasks-${sessionId}`,
  sessionId,
  tasks,
});

describe('BackgroundTaskStore', () => {
  it('replaces each session snapshot, including with an empty list', () => {
    const store = new BackgroundTaskStore();
    const first = {
      taskId: 'bash-1',
      taskType: 'local_bash',
      description: 'Compile',
      status: 'running' as const,
    };
    const second = {
      taskId: 'mcp-1',
      taskType: 'mcp',
      description: 'Fetch',
      status: 'running' as const,
    };
    store.replace(snapshot('one', [first]));
    store.replace(snapshot('two', [second]));
    store.replace(snapshot('one', [second]));
    expect(store.tasksForSession('one')).toEqual([second]);
    expect(store.tasksForSession('two')).toEqual([second]);
    store.replace(snapshot('one', []));
    expect(store.tasksForSession('one')).toEqual([]);
    expect(store.tasksForSession('two')).toEqual([second]);
    store.clearSession('two');
    expect(store.tasksForSession('two')).toEqual([]);
  });

  it('keeps firstSeenAt across replacement and drops timestamps with removed tasks', () => {
    const now = jest.spyOn(Date, 'now');
    const store = new BackgroundTaskStore();
    const first = {
      taskId: 'bash-1',
      taskType: 'local_bash',
      description: 'Compile',
      status: 'running' as const,
    };
    const second = {
      taskId: 'bash-2',
      taskType: 'local_bash',
      description: 'Test',
      status: 'running' as const,
    };
    try {
      now.mockReturnValue(1_000);
      store.replace(snapshot('one', [first]));
      now.mockReturnValue(4_000);
      store.replace(snapshot('one', [first, second]));
      expect(store.firstSeenAt('one', 'bash-1')).toBe(1_000);
      expect(store.firstSeenAt('one', 'bash-2')).toBe(4_000);
      store.replace(snapshot('one', [second]));
      expect(store.firstSeenAt('one', 'bash-1')).toBeNull();
      now.mockReturnValue(8_000);
      store.replace(snapshot('one', [first]));
      expect(store.firstSeenAt('one', 'bash-1')).toBe(8_000);
      store.clearSession('one');
      expect(store.firstSeenAt('one', 'bash-1')).toBeNull();
    } finally {
      now.mockRestore();
    }
  });
});
