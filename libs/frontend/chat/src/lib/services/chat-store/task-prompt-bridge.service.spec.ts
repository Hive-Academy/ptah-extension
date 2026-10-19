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
  let closeTab: jest.Mock;
  let activeWorkspacePath: string | null;
  let expectLink: jest.Mock;

  const flush = async (): Promise<void> => {
    TestBed.flushEffects();
    // consume() awaits the canvas outcome (a race) and possibly closeTab.
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(() => {
    request.set(null);
    setCurrentView = jest.fn();
    clearChatPromptRequest = jest.fn(() => request.set(null));
    requestCanvasTab = jest.fn(() => Promise.resolve(true));
    requestComposerPrefill = jest.fn();
    createTab = jest.fn(() => 'tab-1');
    closeTab = jest.fn(() => Promise.resolve());
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
            closeTab,
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
    expect(closeTab).not.toHaveBeenCalled();
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
      undefined,
      { timeoutMs: 5000 },
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
      undefined,
      { timeoutMs: 5000 },
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

  it('at the tile cap: does not prefill, closes the new tab, skips the link capture and resolves failure', async () => {
    requestCanvasTab.mockReturnValueOnce(Promise.resolve(false));
    createTab.mockReturnValueOnce('tab-refused');
    const resolve = jest.fn();
    request.set({
      prompt: '/orchestrate TASK_2026_705',
      taskId: 'TASK_2026_705',
      resolve,
    });

    await flush();

    expect(requestComposerPrefill).not.toHaveBeenCalled();
    expect(closeTab).toHaveBeenCalledWith('tab-refused');
    expect(expectLink).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith({
      success: false,
      error: 
        'The session did not open on the canvas. If the canvas is full, close a session and try again.',
    });
    expect(clearChatPromptRequest).toHaveBeenCalled();
  });

  it('workspace changed during the wait: keeps the tab, no prefill, no link, resolves a workspace-changed failure', async () => {
    activeWorkspacePath = '/ws/a';
    requestCanvasTab.mockImplementationOnce(() => {
      // The user switches workspace before the canvas drains the request,
      // so the canvas drops it.
      activeWorkspacePath = '/ws/b';
      return Promise.resolve(false);
    });
    const resolve = jest.fn();
    request.set({
      prompt: '/orchestrate TASK_2026_707',
      taskId: 'TASK_2026_707',
      resolve,
    });

    await flush();

    expect(requestCanvasTab).toHaveBeenCalledWith(
      'tab-1',
      '/ws/a',
      '/orchestrate TASK_2026_707',
      undefined,
      { timeoutMs: 5000 },
    );
    expect(closeTab).not.toHaveBeenCalled();
    expect(requestComposerPrefill).not.toHaveBeenCalled();
    expect(expectLink).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith({
      success: false,
      error:
        'The workspace changed before the session opened. It stays in the previous workspace.',
    });
  });

  it('when the canvas does not drain within 5 s: no prefill, closes the tab and resolves failure', async () => {
    jest.useFakeTimers();
    try {
      // AppStateManager removes the undrained request at `timeoutMs` and
      // settles false; the fake mirrors that contract.
      requestCanvasTab.mockImplementationOnce(
        (
          _tabId: string,
          _workspacePath: string | null,
          _name?: string,
          _focus?: boolean,
          options?: { timeoutMs?: number },
        ) =>
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), options?.timeoutMs),
          ),
      );
      createTab.mockReturnValueOnce('tab-undrained');
      const resolve = jest.fn();
      request.set({
        prompt: '/orchestrate TASK_2026_706',
        taskId: 'TASK_2026_706',
        resolve,
      });

      TestBed.flushEffects();
      await jest.advanceTimersByTimeAsync(4999);
      expect(resolve).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);

      expect(requestComposerPrefill).not.toHaveBeenCalled();
      expect(expectLink).not.toHaveBeenCalled();
      expect(closeTab).toHaveBeenCalledWith('tab-undrained');
      expect(resolve).toHaveBeenCalledWith({
        success: false,
        error:
          'The session did not open on the canvas. If the canvas is full, close a session and try again.',
      });
      expect(clearChatPromptRequest).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs a launch that arrives during the canvas wait instead of clearing it unanswered', async () => {
    let settleFirst: (tiled: boolean) => void = () => undefined;
    requestCanvasTab.mockReturnValueOnce(
      new Promise<boolean>((resolve) => (settleFirst = resolve)),
    );
    createTab.mockReturnValueOnce('tab-1').mockReturnValueOnce('tab-2');
    const first = jest.fn();
    const second = jest.fn();
    request.set({ prompt: 'first', sessionName: 'first', resolve: first });
    await flush();

    request.set({ prompt: 'second', sessionName: 'second', resolve: second });
    await flush();
    expect(createTab).toHaveBeenCalledTimes(1);

    settleFirst(true);
    await flush();

    expect(first).toHaveBeenCalledWith({ success: true });
    expect(second).toHaveBeenCalledWith({ success: true });
    expect(requestComposerPrefill).toHaveBeenCalledWith('second', 'tab-2');
    expect(request()).toBeNull();
  });

  it('ignores a null request (no tab, no prefill)', async () => {
    await flush();
    expect(createTab).not.toHaveBeenCalled();
    expect(requestComposerPrefill).not.toHaveBeenCalled();
  });
});
