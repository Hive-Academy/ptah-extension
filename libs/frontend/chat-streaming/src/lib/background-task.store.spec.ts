import { BackgroundTaskStore } from './background-task.store';
import type { BackgroundTasksSnapshotEvent } from '@ptah-extension/shared';

const snapshot = (
  sessionId: string,
  tasks: BackgroundTasksSnapshotEvent['tasks'],
): BackgroundTasksSnapshotEvent => ({
  id: 'event-1', eventType: 'background_tasks_snapshot', timestamp: 1,
  messageId: `background-tasks-${sessionId}`,
  sessionId, tasks,
});

describe('BackgroundTaskStore', () => {
  it('replaces each session snapshot, including with an empty list', () => {
    const store = new BackgroundTaskStore();
    const first = { taskId: 'bash-1', taskType: 'local_bash', description: 'Compile', status: 'running' as const };
    const second = { taskId: 'mcp-1', taskType: 'mcp', description: 'Fetch', status: 'running' as const };
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
});
