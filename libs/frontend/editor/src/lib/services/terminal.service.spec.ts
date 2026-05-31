const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { TerminalService } from './terminal.service';
import type { PtahTerminalApi } from '../types/terminal.types';

interface ApiHandle {
  api: PtahTerminalApi;
  dataCb: ((id: string, data: string) => void) | null;
  exitCb: ((id: string, exitCode: number) => void) | null;
  dataUnsub: jest.Mock;
  exitUnsub: jest.Mock;
  writeMock: jest.Mock;
  resizeMock: jest.Mock;
}

function installPtahTerminalApi(): ApiHandle {
  const handle: ApiHandle = {
    dataCb: null,
    exitCb: null,
    dataUnsub: jest.fn(),
    exitUnsub: jest.fn(),
    writeMock: jest.fn(),
    resizeMock: jest.fn(),
    api: undefined as unknown as PtahTerminalApi,
  };
  handle.api = {
    write: handle.writeMock,
    resize: handle.resizeMock,
    onData: (cb) => {
      handle.dataCb = cb;
      return handle.dataUnsub;
    },
    onExit: (cb) => {
      handle.exitCb = cb;
      return handle.exitUnsub;
    },
  };
  (window as unknown as { ptahTerminal: PtahTerminalApi }).ptahTerminal =
    handle.api;
  return handle;
}

function makeVscodeStub() {
  const cfg = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/ws',
    workspaceName: 'ws',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
  });
  return {
    config: cfg.asReadonly(),
    isConnected: signal(true).asReadonly(),
    getState: jest.fn(),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

describe('TerminalService — terminalClosed teardown (Batch C)', () => {
  let svc: TerminalService;
  let apiHandle: ApiHandle;

  beforeEach(() => {
    apiHandle = installPtahTerminalApi();
    TestBed.configureTestingModule({
      providers: [
        TerminalService,
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });
    svc = TestBed.inject(TerminalService);
    mockRpcCall.mockReset();
  });

  afterEach(() => {
    delete (window as unknown as { ptahTerminal?: PtahTerminalApi })
      .ptahTerminal;
    TestBed.resetTestingModule();
  });

  function pickInternals(): {
    writers: Map<string, (data: string) => void>;
    buffers: Map<string, string[]>;
  } {
    const s = svc as unknown as {
      _xtermWriters: Map<string, (data: string) => void>;
      _pendingDataBuffers: Map<string, string[]>;
    };
    return { writers: s._xtermWriters, buffers: s._pendingDataBuffers };
  }

  it('onExit (abnormal close) clears xterm writer and pending buffer for that terminal', () => {
    svc.registerXtermWriter('term-A', jest.fn());

    const { writers, buffers } = pickInternals();
    apiHandle.dataCb?.('term-Z', 'data-before-mount');

    expect(writers.has('term-A')).toBe(true);
    expect(buffers.has('term-Z')).toBe(true);

    apiHandle.exitCb?.('term-A', 0);
    apiHandle.exitCb?.('term-Z', 1);

    expect(writers.has('term-A')).toBe(false);
    expect(buffers.has('term-Z')).toBe(false);
  });

  it('closeTab invokes terminalClosed (writer + buffer cleared)', async () => {
    mockRpcCall.mockResolvedValueOnce({
      success: true,
      data: { id: 'term-B', pid: 5 },
    });
    await svc.createTerminal('B');

    svc.registerXtermWriter('term-B', jest.fn());
    const { writers, buffers } = pickInternals();
    buffers.set('term-B', ['injected']);

    mockRpcCall.mockResolvedValueOnce({
      success: true,
      data: { success: true },
    });

    expect(writers.has('term-B')).toBe(true);
    expect(buffers.has('term-B')).toBe(true);

    await svc.closeTab('term-B');

    expect(writers.has('term-B')).toBe(false);
    expect(buffers.has('term-B')).toBe(false);
  });

  it('removeWorkspaceState kills + tears down all terminals in that workspace', async () => {
    svc.switchWorkspace('/ws/A');
    mockRpcCall.mockResolvedValueOnce({
      success: true,
      data: { id: 'term-X', pid: 1 },
    });
    await svc.createTerminal('one');

    const { writers, buffers } = pickInternals();
    writers.set('term-X', jest.fn());
    buffers.set('term-X', ['leftover']);

    mockRpcCall.mockResolvedValueOnce({
      success: true,
      data: { success: true },
    });

    svc.removeWorkspaceState('/ws/A');

    expect(writers.has('term-X')).toBe(false);
    expect(buffers.has('term-X')).toBe(false);
  });

  it('exit handler updates hasExited and exitCode on the tab', async () => {
    mockRpcCall.mockResolvedValueOnce({
      success: true,
      data: { id: 'term-EX', pid: 100 },
    });
    await svc.createTerminal('exit-test');

    apiHandle.exitCb?.('term-EX', 42);

    const tab = svc.tabs().find((t) => t.id === 'term-EX');
    expect(tab?.hasExited).toBe(true);
    expect(tab?.exitCode).toBe(42);
  });
});
