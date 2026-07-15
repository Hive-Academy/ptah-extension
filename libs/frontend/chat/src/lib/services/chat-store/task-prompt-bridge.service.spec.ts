/**
 * TaskPromptBridgeService — consumes the AppStateManager `chatPromptRequest`
 * signal bridge: creates a tab, navigates to chat, requests canvas-tile
 * adoption in grid layout, sends the prompt, then settles `resolve` and clears
 * the request.
 */
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  type ChatPromptRequest,
  type LayoutMode,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { MessageSenderService } from '../message-sender.service';
import { TaskPromptBridgeService } from './task-prompt-bridge.service';

describe('TaskPromptBridgeService', () => {
  const request = signal<ChatPromptRequest | null>(null);
  let layoutMode: WritableSignal<LayoutMode>;
  let setCurrentView: jest.Mock;
  let clearChatPromptRequest: jest.Mock;
  let requestCanvasTab: jest.Mock;
  let createTab: jest.Mock;
  let send: jest.Mock;

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
    createTab = jest.fn(() => 'tab-1');
    // send() now returns a structured SendOutcome; the bridge adopts it.
    send = jest.fn().mockResolvedValue({ success: true });

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
          },
        },
        { provide: TabManagerService, useValue: { createTab } },
        { provide: MessageSenderService, useValue: { send } },
      ],
    });
    TestBed.inject(TaskPromptBridgeService);
  });

  it('creates a tab, navigates to chat, sends the prompt, resolves success and clears', async () => {
    const resolve = jest.fn();
    request.set({
      prompt: '/ptah-core:orchestrate TASK_2026_200',
      sessionName: 'TASK_2026_200',
      resolve,
    });

    await flush();

    expect(createTab).toHaveBeenCalledWith('TASK_2026_200');
    expect(setCurrentView).toHaveBeenCalledWith('chat');
    expect(send).toHaveBeenCalledWith('/ptah-core:orchestrate TASK_2026_200', {
      tabId: 'tab-1',
    });
    expect(resolve).toHaveBeenCalledWith({ success: true });
    expect(clearChatPromptRequest).toHaveBeenCalled();
    // Single layout (default): no canvas mounted → no tile-adoption request.
    expect(requestCanvasTab).not.toHaveBeenCalled();
  });

  it('requests canvas tile adoption for the created tab in grid layout (F-D3)', async () => {
    layoutMode.set('grid');
    request.set({
      prompt: '/ptah-core:orchestrate TASK_2026_300',
      sessionName: 'TASK_2026_300',
    });

    await flush();

    expect(createTab).toHaveBeenCalledWith('TASK_2026_300');
    expect(requestCanvasTab).toHaveBeenCalledWith('tab-1', 'TASK_2026_300');
  });

  it('does NOT request canvas tile adoption in single layout', async () => {
    layoutMode.set('single');
    request.set({ prompt: '/ptah-core:orchestrate TASK_2026_301' });

    await flush();

    expect(requestCanvasTab).not.toHaveBeenCalled();
  });

  it('derives a session name from the prompt when none is supplied', async () => {
    request.set({ prompt: 'do the thing' });

    await flush();

    expect(createTab).toHaveBeenCalledWith('do the thing');
  });

  it('resolves failure on a structural chat:start failure (no phantom transition — F-D2)', async () => {
    // A structural failure = transport OK, backend rejects (AUTH_REQUIRED,
    // model-unavailable, license gate). send() resolves normally with
    // { success: false } rather than throwing. The bridge must NOT default to
    // success, otherwise TaskStartService flips the task to a phantom
    // `in_progress` on a session that never started.
    send.mockResolvedValueOnce({ success: false, error: 'AUTH_REQUIRED' });
    const resolve = jest.fn();
    request.set({ prompt: '/ptah-core:orchestrate TASK_2026_202', resolve });

    await flush();

    expect(resolve).toHaveBeenCalledWith({
      success: false,
      error: 'AUTH_REQUIRED',
    });
    expect(clearChatPromptRequest).toHaveBeenCalled();
  });

  it('resolves failure when the send path throws (worktree left in place upstream)', async () => {
    send.mockRejectedValueOnce(new Error('backend down'));
    const resolve = jest.fn();
    request.set({ prompt: '/ptah-core:orchestrate TASK_2026_201', resolve });

    await flush();

    expect(resolve).toHaveBeenCalledWith({
      success: false,
      error: 'backend down',
    });
    expect(clearChatPromptRequest).toHaveBeenCalled();
  });

  it('ignores a null request (no tab, no send)', async () => {
    await flush();
    expect(createTab).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
