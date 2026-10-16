import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AppStateManager,
  FILE_LINK_OPENER,
  VSCodeService,
  rpcCall,
} from '@ptah-extension/core';
import { TasksChangedFeed } from '@ptah-extension/tasks-ui/presentation';
import type { TaskSpecDetail } from '@ptah-extension/shared';
import { ChatStore } from '../../../services/chat.store';
import { SessionTaskReader } from './session-task-reader';

jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual('@ptah-extension/core');
  return { ...actual, rpcCall: jest.fn() };
});

function taskFor(folderName: string): TaskSpecDetail {
  return { folderName, artifacts: ['task.md'] } as TaskSpecDetail;
}

describe('SessionTaskReader workspace identity', () => {
  it('drops an old root response and opens only the new root task folder', async () => {
    const workspace = signal('C:/first');
    const link = {
      taskId: 'TASK_1',
      role: 'primary',
      source: 'user',
      createdAt: 1,
      missing: false,
    };
    const sessions = signal([
      { id: 'session-1', organization: { tasks: [link] } },
    ]);
    const open = jest.fn().mockResolvedValue(undefined);
    const reads: Array<(result: Awaited<ReturnType<typeof rpcCall>>) => void> = [];
    const rpc = jest.mocked(rpcCall);
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          reads.push(resolve);
        }),
    );
    TestBed.configureTestingModule({
      providers: [
        SessionTaskReader,
        { provide: ChatStore, useValue: { organizationAvailable: () => true, sessions } },
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: () => ({
              tab: { claudeSessionId: 'session-1' },
              workspacePath: workspace(),
            }),
          },
        },
        { provide: AppStateManager, useValue: { workspaceInfo: () => null } },
        { provide: VSCodeService, useValue: {} },
        { provide: TasksChangedFeed, useValue: { changes: () => null } },
        { provide: FILE_LINK_OPENER, useValue: { open } },
      ],
    });
    const reader = TestBed.inject(SessionTaskReader);
    reader.bind(signal('tab-1'));
    TestBed.tick();
    expect(reads).toHaveLength(1);

    reads[0]({
      success: true,
      data: { task: taskFor('old-folder') },
    });
    await Promise.resolve();
    expect(reader.state()?.data?.task?.folderName).toBe('old-folder');
    reader.retry();
    expect(reads).toHaveLength(2);

    workspace.set('C:/second');
    expect(reader.state()?.status).toBe('loading');
    await reader.openDocument('task.md');
    expect(open).not.toHaveBeenCalled();
    TestBed.tick();
    reads[1]({
      success: true,
      data: { task: taskFor('old-folder') },
    });
    await Promise.resolve();
    TestBed.tick();
    expect(reader.state()?.data?.task).toBeNull();
    expect(reads).toHaveLength(3);

    reads[2]({
      success: true,
      data: { task: taskFor('new-folder') },
    });
    await Promise.resolve();
    expect(reader.state()?.data?.task?.folderName).toBe('new-folder');
    await reader.openDocument('task.md');
    expect(open).toHaveBeenCalledWith({
      path: 'C:/second/.ptah/specs/new-folder/task.md',
      origin: undefined,
    });
  });
});
