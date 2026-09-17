/**
 * The startup-config sync channel, and the ordering rule that keeps it usable.
 *
 * `preload.ts` blocks at module scope on `ipcRenderer.sendSync`. Electron never
 * replies to a sync channel with no listener, so a window opened before the
 * responder exists blocks inside its preload, never fires `did-finish-load`,
 * and leaves the `loadFile` that opened it pending forever. On TASK_2026_411
 * that wedged every Electron e2e launch for its whole 30 s budget and ran the
 * suite past its 45-minute cap, with only the one spec that never launches the
 * app still passing.
 */
const ipcMainListeners = new Map<
  string,
  Array<(...args: unknown[]) => unknown>
>();

jest.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      const arr = ipcMainListeners.get(channel) ?? [];
      arr.push(listener);
      ipcMainListeners.set(channel, arr);
    },
    removeAllListeners: (channel: string) => {
      ipcMainListeners.delete(channel);
    },
  },
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  readStartupConfig,
  registerStartupConfigIpc,
} from './startup-config-ipc';

const CHANNEL = 'get-startup-config';

interface FakeEvent {
  returnValue?: unknown;
}

/** Drive the registered listener the way Electron drives a sendSync. */
function askOverIpc(): FakeEvent {
  const listeners = ipcMainListeners.get(CHANNEL) ?? [];
  expect(listeners).toHaveLength(1);
  const event: FakeEvent = {};
  listeners[0](event);
  return event;
}

function containerReturning(root: string | null): DependencyContainer {
  return {
    resolve: jest.fn(() => ({ getWorkspaceRoot: () => root })),
  } as unknown as DependencyContainer;
}

describe('get-startup-config responder', () => {
  beforeEach(() => {
    ipcMainListeners.clear();
  });

  it('answers before any container exists — the preparing-shell case', () => {
    registerStartupConfigIpc(() => null);

    const event = askOverIpc();

    // An UNSET returnValue is the deadlock: Electron sends no reply and the
    // renderer stays blocked inside its preload.
    expect(event.returnValue).toEqual({
      initialView: null,
      workspaceRoot: '',
      workspaceName: '',
    });
  });

  it('answers with the live workspace once boot has produced a container', () => {
    let container: DependencyContainer | null = null;
    registerStartupConfigIpc(() => container);

    expect((askOverIpc().returnValue as { workspaceRoot: string }).workspaceRoot).toBe('');

    container = containerReturning(join('/tmp', 'demo-workspace'));

    expect(askOverIpc().returnValue).toEqual({
      initialView: null,
      workspaceRoot: join('/tmp', 'demo-workspace'),
      workspaceName: 'demo-workspace',
    });
  });

  it('still answers when resolving the workspace provider throws', () => {
    const exploding = {
      resolve: jest.fn(() => {
        throw new Error('WORKSPACE_PROVIDER not registered');
      }),
    } as unknown as DependencyContainer;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    registerStartupConfigIpc(() => exploding);

    expect(askOverIpc().returnValue).toEqual({
      initialView: null,
      workspaceRoot: '',
      workspaceName: '',
    });
    jest.restoreAllMocks();
  });

  it('registers exactly one listener even when called twice', () => {
    registerStartupConfigIpc(() => null);
    registerStartupConfigIpc(() => null);

    expect(ipcMainListeners.get(CHANNEL)).toHaveLength(1);
  });

  it('reads the workspace provider through the platform token', () => {
    const container = containerReturning('/tmp/demo');

    readStartupConfig(container);

    expect(container.resolve).toHaveBeenCalledWith(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
  });
});

describe('startup ordering: the sync responder precedes the first window', () => {
  const mainSource = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
  const preloadSource = readFileSync(
    join(__dirname, '..', 'preload.ts'),
    'utf8',
  );
  const postWindowSource = readFileSync(
    join(__dirname, 'post-window.ts'),
    'utf8',
  );

  it('preload still blocks at module scope on this exact channel', () => {
    // If this ever stops being true the ordering rule below can be relaxed —
    // until then it is the reason the rule exists.
    expect(preloadSource).toMatch(
      /^const \w+ = ipcRenderer\.sendSync\('get-startup-config'\)/m,
    );
  });

  it('main.ts registers the responder before it creates or loads a window', () => {
    const register = mainSource.indexOf('registerStartupConfigIpc(');
    const createWindow = mainSource.indexOf('createMainWindow(');
    const shellLoad = mainSource.indexOf('loadFile(preparingShellPath');

    expect(register).toBeGreaterThanOrEqual(0);
    expect(createWindow).toBeGreaterThan(register);
    expect(shellLoad).toBeGreaterThan(register);
  });

  it('post-window does not re-register the channel behind the boot', () => {
    expect(postWindowSource).not.toContain("ipcMain.on('get-startup-config'");
  });

  it('the awaited shell load cannot abort the boot with an unhandled rejection', () => {
    const shellLoad = mainSource.indexOf('loadFile(preparingShellPath');
    const guard = mainSource.lastIndexOf('try {', shellLoad);
    const bootstrap = mainSource.indexOf('bootstrapElectron(', shellLoad);

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(shellLoad);
    expect(bootstrap).toBeGreaterThan(shellLoad);
  });
});
