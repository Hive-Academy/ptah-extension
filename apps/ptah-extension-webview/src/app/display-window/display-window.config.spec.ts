/**
 * The detached Display window's boot (TASK_2026_853_3401, batch 10).
 *
 * 1. `main.ts` branches on `?ptahWindow=display` and lazy-imports the child
 *    config, so the child app is its own chunk and the main app path is kept.
 * 2. The child config holds only the RPC client, the message router and the
 *    snapshot handler, never the main window's `DisplayWindowSync` or layout
 *    service (the child's IPC allowlist has no `status`, `publishState` or
 *    `set-state`).
 * 3. A raw `displayWindow:state` window message reaches the snapshot handler
 *    through the real `MessageRouterService`.
 * 4. `mountDisplayWindowHost` swaps the shared `<ptah-root>` for the
 *    component's host element.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal, type Provider, type EnvironmentProviders } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ElectronLayoutService,
  MESSAGE_HANDLERS,
  MessageRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { DisplayWindowStateHandler, DisplayWindowSync } from '@ptah-extension/chat';
import { DISPLAY_WINDOW_PUSH_TYPES } from '@ptah-extension/shared';

import { displayWindowConfig, mountDisplayWindowHost } from './display-window.config';

function makeVscodeStub() {
  return {
    config: signal({ isVSCode: false, isElectron: true }).asReadonly(),
    isConnected: signal(false).asReadonly(),
    isElectron: true,
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

/** Flattens the config's provider list (nested arrays from `provide*()` helpers). */
function flatProviders(): unknown[] {
  const out: unknown[] = [];
  const walk = (items: readonly (Provider | EnvironmentProviders)[]): void => {
    for (const item of items) {
      if (Array.isArray(item)) walk(item);
      else out.push(item);
    }
  };
  walk(displayWindowConfig.providers);
  return out;
}

function providesToken(token: unknown): boolean {
  return flatProviders().some(
    (p) =>
      p === token ||
      (typeof p === 'object' && p !== null && 'provide' in p && (p as { provide: unknown }).provide === token) ||
      (typeof p === 'object' && p !== null && 'useExisting' in p && (p as { useExisting: unknown }).useExisting === token),
  );
}

describe('main.ts boots the Display window from a lazy chunk', () => {
  const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf-8');

  it('branches on ?ptahWindow=display', () => {
    expect(main).toMatch(
      /new URLSearchParams\(window\.location\.search\)\.get\('ptahWindow'\) === 'display'/,
    );
  });

  it('imports the child config dynamically only', () => {
    expect(main).toContain("import('./app/display-window/display-window.config')");
    expect(main).not.toMatch(/^import[^;]*display-window\.config/m);
  });

  it('keeps the main app bootstrap on the other branch', () => {
    expect(main).toContain('bootstrapApplication(App, appConfig)');
    expect(main).toContain('bootstrapApplication(DisplayWindowComponent, displayWindowConfig)');
  });
});

describe('displayWindowConfig', () => {
  it('registers the RPC client and the snapshot handler as message handlers', () => {
    const handlers = flatProviders().filter(
      (p): p is { provide: unknown; useExisting: unknown; multi: boolean } =>
        typeof p === 'object' && p !== null && 'provide' in p && (p as { provide: unknown }).provide === MESSAGE_HANDLERS,
    );
    expect(handlers.map((h) => h.useExisting)).toEqual([ClaudeRpcService, DisplayWindowStateHandler]);
    expect(handlers.every((h) => h.multi)).toBe(true);
  });

  it('provides the message router', () => {
    expect(providesToken(MessageRouterService)).toBe(true);
  });

  it('does not provide the main window services', () => {
    expect(providesToken(DisplayWindowSync)).toBe(false);
    expect(providesToken(ElectronLayoutService)).toBe(false);
  });
});

describe('the child config delivers a raw displayWindow:state push', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...displayWindowConfig.providers,
        // After the config, so the stub wins over the real VSCodeService.
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });
    TestBed.inject(MessageRouterService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('holds the root snapshot handler instance the component injects', () => {
    expect(TestBed.inject(MESSAGE_HANDLERS)).toContain(TestBed.inject(DisplayWindowStateHandler));
  });

  it('routes the push to DisplayWindowStateHandler', async () => {
    const handler = TestBed.inject(DisplayWindowStateHandler);
    const spy = jest.spyOn(handler, 'handleMessage').mockImplementation(() => undefined);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: DISPLAY_WINDOW_PUSH_TYPES.state, payload: { state: null } },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: DISPLAY_WINDOW_PUSH_TYPES.state }),
    );
  });
});

describe('mountDisplayWindowHost', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('replaces <ptah-root> with <ptah-display-window>', () => {
    document.body.innerHTML = '<ptah-root></ptah-root>';
    mountDisplayWindowHost(document);
    expect(document.querySelector('ptah-root')).toBeNull();
    expect(document.body.children).toHaveLength(1);
    expect(document.body.firstElementChild?.tagName.toLowerCase()).toBe('ptah-display-window');
  });

  it('appends the host when <ptah-root> is missing', () => {
    mountDisplayWindowHost(document);
    expect(document.querySelectorAll('ptah-display-window')).toHaveLength(1);
  });

  it('does not add a second host', () => {
    document.body.innerHTML = '<ptah-root></ptah-root>';
    mountDisplayWindowHost(document);
    mountDisplayWindowHost(document);
    expect(document.querySelectorAll('ptah-display-window')).toHaveLength(1);
  });
});
