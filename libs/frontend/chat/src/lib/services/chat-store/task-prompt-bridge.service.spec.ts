/**
 * TaskPromptBridgeService — consumes the AppStateManager `chatPromptRequest`
 * signal bridge: creates a tab, navigates to chat, requests canvas-tile
 * adoption in grid layout, prefills the composer, then settles `resolve` and
 * clears the request.
 */
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  type ChatPromptRequest,
  type LayoutMode,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { TaskPromptBridgeService } from './task-prompt-bridge.service';

describe('TaskPromptBridgeService', () => {
  const request = signal<ChatPromptRequest | null>(null);
  let layoutMode: WritableSignal<LayoutMode>;
  let setCurrentView: jest.Mock;
  let clearChatPromptRequest: jest.Mock;
  let requestCanvasTab: jest.Mock;
  let requestComposerPrefill: jest.Mock;
  let createTab: jest.Mock;

  const flush = async (): Promise<void> => {
    TestBed.flushEffects();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    request.set(null);
    layoutMode = signal<LayoutMode>('single');
    setCurrentView = jest.fn();
    clearChatPromptRequest = jest.fn(() => request.set(null));
    requestCanvasTab = jest.fn();
    requestComposerPrefill = jest.fn();
    createTab = jest.fn(() => 'tab-1');

    TestBed.configureTestingModule({
      providers: [
        TaskPromptBridgeService,
        {
          provide: AppStateManager,
          useValue: {
            chatPromptRequest: request.asReadonly(),
            layoutMode: layoutMode.asReadonly(),
            setCurrentView,
            clearChatPromptRequest,
            requestCanvasTab,
            requestComposerPrefill,
          },
        },
        { provide: TabManagerService, useValue: { createTab } },
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
      null,
    );
    expect(resolve).toHaveBeenCalledWith({ success: true });
    expect(clearChatPromptRequest).toHaveBeenCalled();
    // Single layout (default): no canvas mounted → no tile-adoption request.
    expect(requestCanvasTab).not.toHaveBeenCalled();
  });

  it('requests canvas tile adoption for the created tab in grid layout (F-D3)', async () => {
    layoutMode.set('grid');
    request.set({
      prompt: '/orchestrate TASK_2026_300',
      sessionName: 'TASK_2026_300',
    });

    await flush();

    expect(createTab).toHaveBeenCalledWith('TASK_2026_300');
    expect(requestCanvasTab).toHaveBeenCalledWith('tab-1', 'TASK_2026_300');
  });

  it.each([
    { layout: 'single' as const, expectedTabId: null },
    { layout: 'grid' as const, expectedTabId: 'tab-task-target' },
  ])(
    'targets the composer prefill correctly in $layout layout',
    async ({ layout, expectedTabId }) => {
      layoutMode.set(layout);
      createTab.mockReturnValueOnce('tab-task-target');
      request.set({ prompt: '/orchestrate TASK_2026_302' });

      await flush();

      expect(requestComposerPrefill).toHaveBeenCalledWith(
        '/orchestrate TASK_2026_302',
        expectedTabId,
      );
    },
  );

  it('does NOT request canvas tile adoption in single layout', async () => {
    layoutMode.set('single');
    request.set({ prompt: '/orchestrate TASK_2026_301' });

    await flush();

    expect(requestCanvasTab).not.toHaveBeenCalled();
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

  it('ignores a null request (no tab, no prefill)', async () => {
    await flush();
    expect(createTab).not.toHaveBeenCalled();
    expect(requestComposerPrefill).not.toHaveBeenCalled();
  });
});
