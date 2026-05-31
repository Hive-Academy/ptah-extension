jest.mock('@xterm/xterm', () => {
  const handlers: { event: KeyboardEvent | null } = { event: null };
  return {
    Terminal: jest.fn().mockImplementation(() => ({
      loadAddon: jest.fn(),
      open: jest.fn(),
      onData: jest.fn(),
      attachCustomKeyEventHandler: jest.fn((cb: (e: KeyboardEvent) => boolean) => {
        handlers.event = null;
        void cb;
      }),
      write: jest.fn(),
      dispose: jest.fn(),
      hasSelection: jest.fn(() => false),
      getSelection: jest.fn(() => ''),
      cols: 80,
      rows: 24,
    })),
  };
});
jest.mock('@xterm/addon-fit', () => ({
  FitAddon: jest.fn().mockImplementation(() => ({
    fit: jest.fn(),
    dispose: jest.fn(),
  })),
}));
jest.mock('@xterm/addon-webgl', () => ({
  WebglAddon: jest.fn().mockImplementation(() => ({
    dispose: jest.fn(),
    onContextLoss: jest.fn(),
  })),
}));

import { ComponentRef } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { TerminalComponent } from './terminal.component';
import { TerminalService } from '../services/terminal.service';

interface TerminalServiceMock {
  unregisterXtermWriter: jest.Mock;
  registerXtermWriter: jest.Mock;
  writeToTerminal: jest.Mock;
  resizeTerminal: jest.Mock;
}

function makeTerminalServiceMock(): TerminalServiceMock {
  return {
    unregisterXtermWriter: jest.fn(),
    registerXtermWriter: jest.fn(),
    writeToTerminal: jest.fn(),
    resizeTerminal: jest.fn(),
  };
}

describe('TerminalComponent — contextmenu listener cleanup (Batch C)', () => {
  let fixture: ComponentFixture<TerminalComponent>;
  let componentRef: ComponentRef<TerminalComponent>;
  let svcMock: TerminalServiceMock;
  let resizeObserverInstances: Array<{
    observe: jest.Mock;
    disconnect: jest.Mock;
  }>;
  let originalResizeObserver: typeof ResizeObserver;

  beforeEach(() => {
    svcMock = makeTerminalServiceMock();
    resizeObserverInstances = [];
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = jest.fn().mockImplementation(() => {
      const instance = { observe: jest.fn(), disconnect: jest.fn() };
      resizeObserverInstances.push(instance);
      return instance;
    }) as unknown as typeof ResizeObserver;

    TestBed.configureTestingModule({
      imports: [TerminalComponent],
      providers: [{ provide: TerminalService, useValue: svcMock }],
    });

    fixture = TestBed.createComponent(TerminalComponent);
    componentRef = fixture.componentRef;
    componentRef.setInput('terminalId', 'term-1');
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('adds a contextmenu listener on the terminal container during init', () => {
    fixture.detectChanges();

    const addSpy = jest.spyOn(HTMLDivElement.prototype, 'addEventListener');
    expect(svcMock.registerXtermWriter).toHaveBeenCalledWith(
      'term-1',
      expect.any(Function),
    );
    addSpy.mockRestore();
  });

  it('removes the contextmenu listener and unregisters writer on destroy', () => {
    fixture.detectChanges();

    const c = fixture.componentInstance as unknown as {
      contextMenuTarget: HTMLDivElement | null;
      contextMenuHandler: ((e: MouseEvent) => void) | null;
    };

    const target = c.contextMenuTarget;
    const handler = c.contextMenuHandler;
    expect(target).not.toBeNull();
    expect(handler).not.toBeNull();

    const removeSpy = jest.spyOn(target as HTMLDivElement, 'removeEventListener');

    fixture.destroy();

    expect(svcMock.unregisterXtermWriter).toHaveBeenCalledWith('term-1');
    expect(removeSpy).toHaveBeenCalledWith('contextmenu', handler);

    const cAfter = fixture.componentInstance as unknown as {
      contextMenuTarget: HTMLDivElement | null;
      contextMenuHandler: ((e: MouseEvent) => void) | null;
    };
    expect(cAfter.contextMenuTarget).toBeNull();
    expect(cAfter.contextMenuHandler).toBeNull();

    removeSpy.mockRestore();
  });
});
