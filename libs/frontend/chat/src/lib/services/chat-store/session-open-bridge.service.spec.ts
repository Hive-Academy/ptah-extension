/**
 * SessionOpenBridgeService — consumes the AppStateManager `sessionOpenRequest`
 * signal bridge: navigates to chat, then opens the session as a canvas tile
 * (grid) or through `switchSession` (single), handling each request once.
 */
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  type LayoutMode,
  type SessionOpenRequest,
} from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import { SessionLoaderService } from './session-loader.service';
import { SessionOpenBridgeService } from './session-open-bridge.service';

describe('SessionOpenBridgeService', () => {
  let request: WritableSignal<SessionOpenRequest | null>;
  let layoutMode: WritableSignal<LayoutMode>;
  let setCurrentView: jest.Mock;
  let requestCanvasSession: jest.Mock;
  let clearSessionOpenRequest: jest.Mock;
  let switchSession: jest.Mock;

  const flush = async (): Promise<void> => {
    TestBed.flushEffects();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    request = signal<SessionOpenRequest | null>(null);
    layoutMode = signal<LayoutMode>('single');
    setCurrentView = jest.fn();
    requestCanvasSession = jest.fn(() => Promise.resolve(true));
    // Mirrors the real identity-guarded clear.
    clearSessionOpenRequest = jest.fn((handled: SessionOpenRequest) => {
      if (request() === handled) request.set(null);
    });
    switchSession = jest.fn(() => Promise.resolve({ staleSnapshot: false }));

    TestBed.configureTestingModule({
      providers: [
        SessionOpenBridgeService,
        {
          provide: AppStateManager,
          useValue: {
            sessionOpenRequest: request.asReadonly(),
            layoutMode: layoutMode.asReadonly(),
            setCurrentView,
            requestCanvasSession,
            clearSessionOpenRequest,
          },
        },
        { provide: SessionLoaderService, useValue: { switchSession } },
      ],
    });
    TestBed.inject(SessionOpenBridgeService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('single layout: navigates to chat and switches to the session', async () => {
    const sessionId = SessionId.create();
    const req: SessionOpenRequest = { sessionId, name: 'Fix login' };
    request.set(req);

    await flush();

    expect(setCurrentView).toHaveBeenCalledWith('chat');
    expect(switchSession).toHaveBeenCalledTimes(1);
    expect(switchSession).toHaveBeenCalledWith(sessionId);
    expect(requestCanvasSession).not.toHaveBeenCalled();
    expect(clearSessionOpenRequest).toHaveBeenCalledWith(req);
    expect(request()).toBeNull();
  });

  it('grid layout: navigates to chat and asks the canvas to open the session', async () => {
    layoutMode.set('grid');
    const sessionId = SessionId.create();
    request.set({ sessionId, name: 'Fix login' });

    await flush();

    expect(setCurrentView).toHaveBeenCalledWith('chat');
    expect(requestCanvasSession).toHaveBeenCalledTimes(1);
    expect(requestCanvasSession).toHaveBeenCalledWith(sessionId, 'Fix login');
    expect(switchSession).not.toHaveBeenCalled();
    expect(request()).toBeNull();
  });

  it('handles a request once: effect re-runs do not reopen it', async () => {
    const sessionId = SessionId.create();
    request.set({ sessionId });
    await flush();

    // A later layout change re-runs nothing (layoutMode is read untracked),
    // and the cleared signal holds no request to replay.
    layoutMode.set('grid');
    await flush();
    await flush();

    expect(switchSession).toHaveBeenCalledTimes(1);
    expect(requestCanvasSession).not.toHaveBeenCalled();
    expect(setCurrentView).toHaveBeenCalledTimes(1);
  });

  it('opens the same session again when a new request is published', async () => {
    const sessionId = SessionId.create();
    request.set({ sessionId });
    await flush();
    request.set({ sessionId });
    await flush();

    expect(switchSession).toHaveBeenCalledTimes(2);
  });

  it('a failed switch (e.g. a deleted session) is logged, not unhandled', async () => {
    const error = new Error('chat:resume failed');
    switchSession.mockReturnValueOnce(Promise.reject(error));
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const sessionId = SessionId.create();
    request.set({ sessionId });

    await flush();

    expect(consoleError).toHaveBeenCalledWith(
      '[SessionOpenBridgeService] Failed to open session:',
      sessionId,
      error,
    );
    expect(request()).toBeNull();
  });
});
