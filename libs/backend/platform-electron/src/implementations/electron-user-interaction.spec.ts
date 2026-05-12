/**
 * `electron-user-interaction.spec.ts` — runs `runUserInteractionContract`
 * against `ElectronUserInteraction`, with a scripted `dialog` / `ipcMain` /
 * `shell` triple fed through the constructor to keep the tests hermetic.
 *
 * Electron-specific assertions beyond the contract:
 *   - `showErrorMessage` routes to `dialog.showMessageBox({ type: 'error' })`
 *     and returns the scripted action label.
 *   - `showQuickPick` / `showInputBox` delegate through `ipcMain.once` and
 *     resolve to the renderer-supplied payload.
 *   - `withProgress({ cancellable: true })` responds to a cancel IPC channel.
 *   - `openExternal` defaults to `false` when no shell is wired.
 */

import 'reflect-metadata';
import {
  runUserInteractionContract,
  type UserInteractionSetup,
} from '@ptah-extension/platform-core/testing';
import {
  ElectronUserInteraction,
  type ElectronDialogApi,
  type ElectronBrowserWindowApi,
  type ElectronShellApi,
} from './electron-user-interaction';

interface IpcMainLike {
  once(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
}

interface ScriptedIpcMain extends IpcMainLike {
  /** Channel → listener; firing channels invokes the listener with args. */
  fire(channel: string, ...args: unknown[]): void;
  /** Count of channels currently registered but not yet fired. */
  readonly pending: number;
}

function createScriptedIpcMain(): ScriptedIpcMain {
  const listeners = new Map<
    string,
    (event: unknown, ...args: unknown[]) => void
  >();
  return {
    once(channel, listener) {
      listeners.set(channel, listener);
    },
    fire(channel, ...args) {
      const l = listeners.get(channel);
      if (l) {
        listeners.delete(channel);
        l({}, ...args);
      }
    },
    get pending() {
      return listeners.size;
    },
  };
}

interface RecordedSend {
  channel: string;
  args: unknown[];
}

interface StubWindow extends ElectronBrowserWindowApi {
  readonly sends: RecordedSend[];
}

function createStubWindow(): StubWindow {
  const sends: RecordedSend[] = [];
  return {
    webContents: {
      send(channel: string, ...args: unknown[]) {
        sends.push({ channel, args });
      },
    },
    sends,
  };
}

interface ScriptedDialog extends ElectronDialogApi {
  /** Queue the index that the next `showMessageBox` call should resolve to. */
  enqueueResponse(index: number): void;
  readonly lastOptions:
    | { type: string; message: string; buttons: string[] }
    | undefined;
}

function createScriptedDialog(): ScriptedDialog {
  const queue: number[] = [];
  let lastOptions: ScriptedDialog['lastOptions'];
  return {
    async showMessageBox(_win, options) {
      lastOptions = {
        type: options.type,
        message: options.message,
        buttons: [...options.buttons],
      };
      const response = queue.shift() ?? 0;
      return { response };
    },
    async showOpenDialog(_win, _options) {
      // Default stub — tests that need to script a dialog response can override
      // via dependency injection. B8c does not exercise this path.
      return { canceled: true, filePaths: [] };
    },
    enqueueResponse(index: number) {
      queue.push(index);
    },
    get lastOptions() {
      return lastOptions;
    },
  };
}

// Contract harness — scripts are wired into the setup so the same suite
// exercises scripted inputs and unscripted "cancelled" branches.
runUserInteractionContract('ElectronUserInteraction', () => {
  const dialog = createScriptedDialog();
  const ipcMain = createScriptedIpcMain();
  const window = createStubWindow();
  const shell: ElectronShellApi = {
    openExternal: jest.fn().mockResolvedValue(undefined),
    writeToClipboard: jest.fn().mockReturnValue(undefined),
  };
  const provider = new ElectronUserInteraction(
    dialog,
    () => window,
    ipcMain,
    shell,
  );

  const setup: UserInteractionSetup = {
    provider,
    script(config) {
      if (config.nextAction !== undefined) {
        // Dialog responses are index-based; the contract passes 'Retry' as the
        // first action so index 0 selects it.
        dialog.enqueueResponse(0);
      }
      if (config.nextInput !== undefined) {
        // Fire the input-box response immediately on next tick so the
        // provider's `once()` has already registered.
        setImmediate(() => {
          const sendRecord = window.sends.find(
            (s) => s.channel === 'show-input-box',
          );
          const payload = sendRecord?.args[0] as
            | { responseChannel: string }
            | undefined;
          if (payload?.responseChannel) {
            ipcMain.fire(payload.responseChannel, config.nextInput);
          }
        });
      }
      if (config.nextQuickPick !== undefined) {
        setImmediate(() => {
          const sendRecord = window.sends.find(
            (s) => s.channel === 'show-quick-pick',
          );
          const payload = sendRecord?.args[0] as
            | { responseChannel: string }
            | undefined;
          if (payload?.responseChannel) {
            // Quick-pick resolves by index — the contract supplies a 2-item
            // list, so index 0 picks the scripted label.
            ipcMain.fire(payload.responseChannel, 0);
          }
        });
      }
    },
  };
  return setup;
});

describe('ElectronUserInteraction — Electron-specific behaviour', () => {
  let dialog: ScriptedDialog;
  let ipcMain: ScriptedIpcMain;
  let window: StubWindow;
  let shell: ElectronShellApi;
  let provider: ElectronUserInteraction;

  beforeEach(() => {
    dialog = createScriptedDialog();
    ipcMain = createScriptedIpcMain();
    window = createStubWindow();
    shell = {
      openExternal: jest.fn().mockResolvedValue(undefined),
      writeToClipboard: jest.fn().mockReturnValue(undefined),
    };
    provider = new ElectronUserInteraction(
      dialog,
      () => window,
      ipcMain,
      shell,
    );
  });

  it("showErrorMessage uses dialog type 'error' and returns the scripted action", async () => {
    dialog.enqueueResponse(1);
    const result = await provider.showErrorMessage('boom', 'Retry', 'Cancel');
    expect(dialog.lastOptions?.type).toBe('error');
    expect(dialog.lastOptions?.buttons).toEqual(['Retry', 'Cancel']);
    expect(result).toBe('Cancel');
  });

  it("showWarningMessage uses dialog type 'warning'", async () => {
    await provider.showWarningMessage('careful');
    expect(dialog.lastOptions?.type).toBe('warning');
  });

  it("showInformationMessage uses dialog type 'info' with default 'OK' button", async () => {
    await provider.showInformationMessage('fyi');
    expect(dialog.lastOptions?.type).toBe('info');
    expect(dialog.lastOptions?.buttons).toEqual(['OK']);
  });

  it('showQuickPick delegates through ipcMain and resolves to the chosen item', async () => {
    const items = [{ label: 'alpha' }, { label: 'beta' }];
    const promise = provider.showQuickPick(items);

    // Wait one microtask for the IPC send + `once()` registration to land.
    await new Promise<void>((r) => setImmediate(r));
    const sent = window.sends.find((s) => s.channel === 'show-quick-pick');
    expect(sent).toBeDefined();
    const payload = sent?.args[0] as { responseChannel: string };
    ipcMain.fire(payload.responseChannel, 1);

    await expect(promise).resolves.toEqual({ label: 'beta' });
  });

  it('showQuickPick resolves to undefined when the renderer cancels', async () => {
    const promise = provider.showQuickPick([{ label: 'x' }]);
    await new Promise<void>((r) => setImmediate(r));
    const sent = window.sends.find((s) => s.channel === 'show-quick-pick');
    const payload = sent?.args[0] as { responseChannel: string };
    ipcMain.fire(payload.responseChannel, null);
    await expect(promise).resolves.toBeUndefined();
  });

  it('showInputBox forwards the scripted value from the renderer', async () => {
    const promise = provider.showInputBox({ prompt: 'name?' });
    await new Promise<void>((r) => setImmediate(r));
    const sent = window.sends.find((s) => s.channel === 'show-input-box');
    const payload = sent?.args[0] as { responseChannel: string };
    ipcMain.fire(payload.responseChannel, 'typed');
    await expect(promise).resolves.toBe('typed');
  });

  it('withProgress({ cancellable: true }) cancels the token when the IPC fires', async () => {
    const outcome = provider.withProgress(
      { title: 'work', cancellable: true },
      async (_progress, token) => {
        // Listen for cancellation before we manufacture the cancel IPC so we
        // do not race the resolve.
        const cancelled = new Promise<void>((resolve) => {
          token.onCancellationRequested(() => resolve());
        });
        // Next tick: fire the cancellation channel.
        setImmediate(() => {
          const startSend = window.sends.find(
            (s) => s.channel === 'progress-start',
          );
          const payload = startSend?.args[0] as { id: string };
          ipcMain.fire(`cancel-progress-${payload.id}`);
        });
        await cancelled;
        return token.isCancellationRequested;
      },
    );
    await expect(outcome).resolves.toBe(true);
  });

  it('withProgress emits start and end IPC events around the task', async () => {
    await provider.withProgress({ title: 'work' }, async () => 42);
    const channels = window.sends.map((s) => s.channel);
    expect(channels).toContain('progress-start');
    expect(channels).toContain('progress-end');
  });

  it('openExternal returns false when no shell is wired', async () => {
    const bare = new ElectronUserInteraction(dialog, () => window, ipcMain);
    expect(await bare.openExternal('https://example.com')).toBe(false);
  });

  it('openExternal returns false when shell.openExternal rejects', async () => {
    const rejectingShell: ElectronShellApi = {
      openExternal: jest.fn().mockRejectedValue(new Error('nope')),
      writeToClipboard: jest.fn().mockReturnValue(undefined),
    };
    const p = new ElectronUserInteraction(
      dialog,
      () => window,
      ipcMain,
      rejectingShell,
    );
    expect(await p.openExternal('https://example.com')).toBe(false);
  });

  it('writeToClipboard forwards to the shell API', async () => {
    await provider.writeToClipboard('copied');
    expect(shell.writeToClipboard).toHaveBeenCalledWith('copied');
  });

  it('showQuickPick resolves undefined when getWindow returns null', async () => {
    const noWin = new ElectronUserInteraction(
      dialog,
      () => null,
      ipcMain,
      shell,
    );
    await expect(
      noWin.showQuickPick([{ label: 'x' }]),
    ).resolves.toBeUndefined();
  });

  it('openOAuthUrl delegates to shell.openExternal and returns opened=true', async () => {
    const result = await provider.openOAuthUrl({
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
    });
    expect(shell.openExternal).toHaveBeenCalledWith(
      'https://github.com/login/device',
    );
    expect(result).toEqual({ opened: true, code: undefined });
  });

  it('openOAuthUrl with userCode writes to clipboard and shows info dialog', async () => {
    const result = await provider.openOAuthUrl({
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
      userCode: 'WXYZ-9999',
    });
    expect(shell.writeToClipboard).toHaveBeenCalledWith('WXYZ-9999');
    expect(dialog.lastOptions?.type).toBe('info');
    expect(result).toEqual({ opened: true, code: undefined });
  });

  it('openOAuthUrl returns opened=false when no shell is wired', async () => {
    const noShell = new ElectronUserInteraction(dialog, () => window, ipcMain);
    const result = await noShell.openOAuthUrl({
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
    });
    expect(result).toEqual({ opened: false, code: undefined });
  });

  it('showOpenDialog returns filePaths when the user picks files', async () => {
    const picked = ['/picked/a.txt', '/picked/b.txt'];
    const pickingDialog: ElectronDialogApi = {
      async showMessageBox() {
        return { response: 0 };
      },
      async showOpenDialog() {
        return { canceled: false, filePaths: picked };
      },
    };
    const p = new ElectronUserInteraction(
      pickingDialog,
      () => window,
      ipcMain,
      shell,
    );
    const result = await p.showOpenDialog({ properties: ['openFile'] });
    expect(result).toEqual(picked);
  });

  it('showOpenDialog returns [] when the user cancels', async () => {
    const result = await provider.showOpenDialog({ properties: ['openFile'] });
    expect(result).toEqual([]);
  });

  it('withProgress.report forwards progress-update over IPC', async () => {
    await provider.withProgress({ title: 'work' }, async (progress) => {
      progress.report({ message: 'half', increment: 50 });
      return 'done';
    });
    const update = window.sends.find((s) => s.channel === 'progress-update');
    expect(update).toBeDefined();
    const payload = update?.args[0] as { message?: string; increment?: number };
    expect(payload.message).toBe('half');
    expect(payload.increment).toBe(50);
  });

  it('openOAuthUrl returns opened=false when shell.openExternal rejects', async () => {
    const failingShell: ElectronShellApi = {
      openExternal: jest.fn().mockRejectedValue(new Error('nope')),
      writeToClipboard: jest.fn().mockReturnValue(undefined),
    };
    const p = new ElectronUserInteraction(
      dialog,
      () => window,
      ipcMain,
      failingShell,
    );
    const result = await p.openOAuthUrl({
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
    });
    expect(result.opened).toBe(false);
  });
});
