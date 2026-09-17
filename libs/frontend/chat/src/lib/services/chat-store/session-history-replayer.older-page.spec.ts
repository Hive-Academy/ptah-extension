import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  HistoryMessageBuilder,
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import type {
  ExecutionChatMessage,
  FlatStreamEventUnion,
  SessionId,
} from '@ptah-extension/shared';
import { SessionHistoryReplayer } from './session-history-replayer.service';

const TAB = 'tab-page';
const TAIL_TAB = 'tab-tail';
const SESSION = 'session-page' as SessionId;
const TAIL_SESSION = 'session-tail' as SessionId;

describe('SessionHistoryReplayer older pages', () => {
  const originalMessageChannel = globalThis.MessageChannel;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  let cursor: string | null;
  let sessionId: SessionId;
  let heldMacrotasks: Array<() => void>;
  let holdMacrotasks: boolean;
  let pageEventCount: number;
  let prependHistoryMessages: jest.Mock;
  let clearCache: jest.Mock;
  let replayer: SessionHistoryReplayer;

  beforeEach(() => {
    cursor = 'cursor-1';
    sessionId = SESSION;
    heldMacrotasks = [];
    holdMacrotasks = false;
    pageEventCount = 0;
    prependHistoryMessages = jest.fn();
    clearCache = jest.fn();

    class ControlledMessageChannel {
      readonly port1: { onmessage: (() => void) | null; close: () => void } = {
        onmessage: null,
        close: () => undefined,
      };
      readonly port2 = {
        postMessage: () => {
          const deliver = () => this.port1.onmessage?.();
          if (holdMacrotasks) heldMacrotasks.push(deliver);
          else void Promise.resolve().then(deliver);
        },
        close: () => undefined,
      };
    }
    globalThis.MessageChannel =
      ControlledMessageChannel as unknown as typeof MessageChannel;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };

    TestBed.configureTestingModule({
      providers: [
        SessionHistoryReplayer,
        {
          provide: TabManagerService,
          useValue: {
            findTabByIdAcrossWorkspaces: jest.fn((tabId: string) => ({
              tab: {
                id: tabId,
                claudeSessionId: tabId === TAIL_TAB ? TAIL_SESSION : sessionId,
                olderHistoryCursor: tabId === TAB ? cursor : undefined,
              },
              workspacePath: 'D:/repo',
            })),
            prependHistoryMessages,
          },
        },
        {
          provide: HistoryMessageBuilder,
          useValue: {
            createPageState: jest.fn(() => ({ count: 0 })),
            accumulate: jest.fn(
              (state: { count: number }, page: readonly unknown[]) => {
                pageEventCount += page.length;
                return { count: state.count + page.length };
              },
            ),
            build: jest.fn(() => [{ id: 'older-message' }]),
            clearCache,
          },
        },
        {
          provide: StreamingHandlerService,
          useValue: {
            processStreamEvent: jest.fn(),
            finalizeSessionHistory: jest.fn(),
            clearPendingUpdates: jest.fn(),
          },
        },
        { provide: SessionManager, useValue: { setStatus: jest.fn() } },
      ],
    });
    replayer = TestBed.inject(SessionHistoryReplayer);
  });

  afterEach(() => {
    globalThis.MessageChannel = originalMessageChannel;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    TestBed.resetTestingModule();
  });

  function events(count: number): FlatStreamEventUnion[] {
    return Array.from(
      { length: count },
      (_, index) => ({ id: `event-${index}` }) as FlatStreamEventUnion,
    );
  }

  async function until(condition: () => boolean): Promise<void> {
    for (let turn = 0; turn < 200 && !condition(); turn++) {
      await Promise.resolve();
    }
    expect(condition()).toBe(true);
  }

  it('builds and prepends synchronously without publishing replay state', async () => {
    const replayingSnapshots: ReadonlySet<string>[] = [];
    const pending = replayer.replayOlderPage(
      events(250),
      TAB,
      SESSION,
      'cursor-1',
      null,
      [],
    );
    replayingSnapshots.push(replayer.replayingTabIds());

    await expect(pending).resolves.toBe('prepended');
    replayingSnapshots.push(replayer.replayingTabIds());
    expect(replayingSnapshots).toEqual([new Set(), new Set()]);
    expect(pageEventCount).toBe(250);
    expect(prependHistoryMessages).toHaveBeenCalledWith(
      TAB,
      [{ id: 'older-message' } as ExecutionChatMessage],
      null,
    );
    expect(clearCache).toHaveBeenCalledWith(`history-page-${TAB}`);
  });

  it('refuses while a resume claim owns the tab', async () => {
    const claim = replayer.claim(TAB, SESSION);

    expect(replayer.canReplayOlderPage(TAB, SESSION, 'cursor-1')).toBe(false);
    await expect(
      replayer.replayOlderPage(events(1), TAB, SESSION, 'cursor-1', null, []),
    ).resolves.toBe('superseded');

    expect(prependHistoryMessages).not.toHaveBeenCalled();
    replayer.release(claim);
  });

  it.each([
    ['a session rebind', () => (sessionId = TAIL_SESSION)],
    ['a cursor change', () => (cursor = 'cursor-2')],
  ])('refuses after a yield caused by %s', async (_, supersede) => {
    holdMacrotasks = true;
    const pending = replayer.replayOlderPage(
      events(251),
      TAB,
      SESSION,
      'cursor-1',
      null,
      [],
    );
    await until(() => heldMacrotasks.length === 1);

    supersede();
    heldMacrotasks.shift()?.();

    await expect(pending).resolves.toBe('superseded');
    expect(pageEventCount).toBe(250);
    expect(prependHistoryMessages).not.toHaveBeenCalled();
    expect(clearCache).toHaveBeenCalledWith(`history-page-${TAB}`);
  });

  it('re-checks after admission and runs behind a chunked tail replay', async () => {
    holdMacrotasks = true;
    const tailClaim = replayer.claim(TAIL_TAB, TAIL_SESSION);
    const tail = replayer.replay(
      events(251),
      tailClaim,
      TAIL_SESSION,
      undefined,
    );
    await until(() => heldMacrotasks.length === 1);

    const older = replayer.replayOlderPage(
      events(1),
      TAB,
      SESSION,
      'cursor-1',
      null,
      [],
    );
    cursor = 'cursor-2';
    heldMacrotasks.shift()?.();
    await until(() => heldMacrotasks.length === 1);
    heldMacrotasks.shift()?.();
    await tail;
    await until(() => heldMacrotasks.length === 1);
    heldMacrotasks.shift()?.();

    await expect(older).resolves.toBe('superseded');
    expect(prependHistoryMessages).not.toHaveBeenCalled();
    expect(clearCache).toHaveBeenCalledWith(`history-page-${TAB}`);
    replayer.release(tailClaim);
  });

  it('clears the page cache when accumulation throws before build', async () => {
    const builder = TestBed.inject(HistoryMessageBuilder);
    const accumulateFailure = jest
      .spyOn(builder, 'accumulate')
      .mockImplementation(() => {
        throw new Error('bad event');
      });

    await expect(
      replayer.replayOlderPage(events(1), TAB, SESSION, 'cursor-1', null, []),
    ).rejects.toThrow('bad event');

    expect(clearCache).toHaveBeenCalledWith(`history-page-${TAB}`);
    expect(prependHistoryMessages).not.toHaveBeenCalled();

    accumulateFailure.mockRestore();
    await expect(
      replayer.replayOlderPage(events(1), TAB, SESSION, 'cursor-1', null, []),
    ).resolves.toBe('prepended');
  });
});
