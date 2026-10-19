/**
 * TaskPromptBridgeService — consumes the AppStateManager `chatPromptRequest`
 * signal bridge: creates a tab, navigates to chat, requests canvas-tile
 * adoption, prefills the composer, then settles `resolve` and clears the
 * request.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, type ChatPromptRequest } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { TaskPromptBridgeService } from './task-prompt-bridge.service';
import { BoardTaskLinkCaptureService } from './board-task-link-capture.service';

describe('TaskPromptBridgeService', () => {
  const request = signal<ChatPromptRequest | null>(null);
  let setCurrentView: jest.Mock;
  let clearChatPromptRequest: jest.Mock;
  let requestCanvasTab: jest.Mock;
  let requestComposerPrefill: jest.Mock;
  let createTab: jest.Mock;
  let activeWorkspacePath: string | null;
  let expectLink: jest.Mock;

  const flush = async (): Promise<void> => {
    TestBed.flushEffects();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    request.set(null);
    setCurrentView = jest.fn();
    clearChatPromptRequest = jest.fn(() => request.set(null));
    requestCanvasTab = jest.fn();
    requestComposerPrefill = jest.fn();
    createTab = jest.fn(() => 'tab-1');
    activeWorkspacePath = null;
    expectLink = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        TaskPromptBridgeService,
        {
          provide: AppStateManager,
          useValue: {
            chatPromptRequest: request.asReadonly(),
            setCurrentView,
            clearChatPromptRequest,
            requestCanvasTab,
            requestComposerPrefill,
          },
        },
        {
          provide: TabManagerService,
          useValue: {
            createTab,
            get activeWorkspacePath() {
              return activeWorkspacePath;
            },
          },
        },
        {
          provide: BoardTaskLinkCaptureService,
          useValue: { expect: expectLink },
        },
      ],
    });
    TestBed.inject(TaskPromptBridgeService);
  });

  it('creates a tab, navigates to chat, prefills the prompt, resolves success and clears', async () => {
    const resolve = jest.fn();
    request.set({
      prompt: '/orchestrate TASK_2026_200',
      sessionName: 'TASK_2026_200',
      resolve,
    });

    await flush();

    expect(createTab).toHaveBeenCalledWith('TASK_2026_200');
    expect(setCurrentView).toHaveBeenCalledWith('chat');
    expect(requestComposerPrefill).toHaveBeenCalledWith(
      '/orchestrate TASK_2026_200',
      'tab-1',
    );
    expect(resolve).toHaveBeenCalledWith({ success: true });
    expect(clearChatPromptRequest).toHaveBeenCalled();
  });

  it('requests canvas tile adoption for the created tab (F-D3)', async () => {
    request.set({
      prompt: '/orchestrate TASK_2026_300',
      sessionName: 'TASK_2026_300',
    });

    await flush();

    expect(createTab).toHaveBeenCalledWith('TASK_2026_300');
    expect(requestCanvasTab).toHaveBeenCalledWith(
      'tab-1',
      null,
      'TASK_2026_300',
    );
  });

  it('carries the active workspace path on the canvas tile request (stale-drop support)', async () => {
    activeWorkspacePath = '/ws/a';
    request.set({
      prompt: '/orchestrate TASK_2026_304',
      sessionName: 'TASK_2026_304',
    });

    await flush();

    expect(requestCanvasTab).toHaveBeenCalledWith(
      'tab-1',
      '/ws/a',
      'TASK_2026_304',
    );
  });

  it('scopes the composer prefill to the created tab', async () => {
    createTab.mockReturnValueOnce('tab-task-target');
    request.set({ prompt: '/orchestrate TASK_2026_302' });

    await flush();

    expect(requestComposerPrefill).toHaveBeenCalledWith(
      '/orchestrate TASK_2026_302',
      'tab-task-target',
    );
  });

  it('derives a session name from the prompt when none is supplied', async () => {
    request.set({ prompt: 'do the thing' });

    await flush();

    expect(createTab).toHaveBeenCalledWith('do the thing');
  });

  it('resolves failure when tab creation throws', async () => {
    createTab.mockImplementationOnce(() => {
      throw new Error('tab creation failed');
    });
    const resolve = jest.fn();
    request.set({ prompt: '/orchestrate TASK_2026_201', resolve });

    await flush();

    expect(resolve).toHaveBeenCalledWith({
      success: false,
      error: 'tab creation failed',
    });
    expect(clearChatPromptRequest).toHaveBeenCalled();
  });

  it('registers the created tab with the board-task link capture when the request carries a taskId (TASK_2026_580)', async () => {
    createTab.mockReturnValueOnce('tab-board-start');
    request.set({
      prompt: '/orchestrate TASK_2026_580_9f77',
      taskId: 'TASK_2026_580_9f77',
    });

    await flush();

    expect(expectLink).toHaveBeenCalledTimes(1);
    expect(expectLink).toHaveBeenCalledWith(
      'tab-board-start',
      'TASK_2026_580_9f77',
    );
  });

  it('does not register a link capture when the request has no taskId', async () => {
    request.set({ prompt: 'do the thing' });

    await flush();

    expect(expectLink).not.toHaveBeenCalled();
  });

  it('ignores a null request (no tab, no prefill)', async () => {
    await flush();
    expect(createTab).not.toHaveBeenCalled();
    expect(requestComposerPrefill).not.toHaveBeenCalled();
  });
});
