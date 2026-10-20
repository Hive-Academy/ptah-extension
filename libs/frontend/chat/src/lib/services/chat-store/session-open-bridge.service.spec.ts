/**
 * SessionOpenBridgeService — consumes the AppStateManager `sessionOpenRequest`
 * signal bridge: navigates to chat, then opens the session as a canvas tile,
 * handling each request once.
 */
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AppStateManager, type SessionOpenRequest } from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import { SessionOpenBridgeService } from './session-open-bridge.service';

describe('SessionOpenBridgeService', () => {
  let request: WritableSignal<SessionOpenRequest | null>;
  let setCurrentView: jest.Mock;
  let requestCanvasSession: jest.Mock;
  let clearSessionOpenRequest: jest.Mock;

  const flush = async (): Promise<void> => {
    TestBed.flushEffects();
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    request = signal<SessionOpenRequest | null>(null);
    setCurrentView = jest.fn();
    requestCanvasSession = jest.fn(() => Promise.resolve(true));
    // Mirrors the real identity-guarded clear.
    clearSessionOpenRequest = jest.fn((handled: SessionOpenRequest) => {
      if (request() === handled) request.set(null);
    });

    TestBed.configureTestingModule({
      providers: [
        SessionOpenBridgeService,
        {
          provide: AppStateManager,
          useValue: {
            sessionOpenRequest: request.asReadonly(),
            setCurrentView,
            requestCanvasSession,
            clearSessionOpenRequest,
          },
        },
      ],
    });
    TestBed.inject(SessionOpenBridgeService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('navigates to chat and asks the canvas to open the session', async () => {
    const sessionId = SessionId.create();
    const req: SessionOpenRequest = { sessionId, name: 'Fix login' };
    request.set(req);

    await flush();

    expect(setCurrentView).toHaveBeenCalledWith('chat');
    expect(requestCanvasSession).toHaveBeenCalledTimes(1);
    expect(requestCanvasSession).toHaveBeenCalledWith(sessionId, 'Fix login');
    expect(clearSessionOpenRequest).toHaveBeenCalledWith(req);
    expect(request()).toBeNull();
  });

  it('handles a request once: effect re-runs do not reopen it', async () => {
    const sessionId = SessionId.create();
    request.set({ sessionId });
    await flush();

    // The cleared signal holds no request to replay.
    await flush();
    await flush();

    expect(requestCanvasSession).toHaveBeenCalledTimes(1);
    expect(setCurrentView).toHaveBeenCalledTimes(1);
  });

  it('opens the same session again when a new request is published', async () => {
    const sessionId = SessionId.create();
    request.set({ sessionId });
    await flush();
    request.set({ sessionId });
    await flush();

    expect(requestCanvasSession).toHaveBeenCalledTimes(2);
  });

  it('a dropped canvas request (e.g. tile cap) still clears the request', async () => {
    requestCanvasSession.mockReturnValueOnce(Promise.resolve(false));
    const sessionId = SessionId.create();
    request.set({ sessionId });

    await flush();

    expect(requestCanvasSession).toHaveBeenCalledWith(sessionId, undefined);
    expect(request()).toBeNull();
  });
});
