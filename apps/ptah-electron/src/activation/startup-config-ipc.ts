import { ipcMain } from 'electron';
import * as path from 'path';
import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';

/**
 * The ONE main-process responder for `get-startup-config`.
 *
 * `preload.ts:18` issues `ipcRenderer.sendSync('get-startup-config')` at module
 * scope, and Electron never replies to a sync channel that has no listener — it
 * prints "called ipcRenderer.sendSync() ... without listeners" and leaves the
 * renderer blocked. A renderer blocked inside its preload never fires
 * `did-finish-load`, so the `loadFile` that opened it never settles.
 *
 * That is why this registration lives in `main.ts` BEFORE the first window is
 * created, and not in `registerPostWindow` where it used to sit. Once the
 * preparing shell became the first window (it loads before `bootstrapElectron`,
 * which is what eventually reached `registerPostWindow`), the old placement
 * closed a deadlock ring: shell preload waits for a responder → the awaited
 * `loadFile` never resolves → boot never reaches the registration. Every
 * Electron e2e launch hung for its full 30 s budget and the suite ran out its
 * 45-minute cap (TASK_2026_411).
 */
export function registerStartupConfigIpc(
  getContainer: () => DependencyContainer | null,
): void {
  // Idempotent: the e2e UI driver re-registers this channel against its own
  // fixture, and a second live listener would answer the same sendSync twice.
  ipcMain.removeAllListeners('get-startup-config');
  ipcMain.on('get-startup-config', (event: Electron.IpcMainEvent) => {
    // `returnValue` must be assigned on EVERY path, including failure —
    // leaving it unset is exactly the no-reply case that wedges the renderer.
    event.returnValue = readStartupConfig(getContainer());
  });
}

/**
 * What `preload.ts` reads out of the main process before Angular bootstraps.
 */
export interface StartupConfig {
  initialView: string | null;
  workspaceRoot: string;
  workspaceName: string;
}

const EMPTY_STARTUP_CONFIG: StartupConfig = {
  initialView: null,
  workspaceRoot: '',
  workspaceName: '',
};

/**
 * Answer the config question for whatever container exists RIGHT NOW.
 *
 * `null` is a first-class answer, not an error: the preparing shell loads
 * before `bootstrapElectron` has built a container, and the shell renders no
 * workspace, so an empty config is the correct response at that moment. The
 * renderer asks again — `preload.ts` runs on every navigation — when the same
 * window is navigated to the Angular bundle after the boot completes.
 */
export function readStartupConfig(
  container: DependencyContainer | null,
): StartupConfig {
  if (!container) return { ...EMPTY_STARTUP_CONFIG };
  try {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const resolvedRoot = workspaceProvider.getWorkspaceRoot();
    if (!resolvedRoot) return { ...EMPTY_STARTUP_CONFIG };
    return {
      initialView: null,
      workspaceRoot: resolvedRoot,
      workspaceName: path.basename(resolvedRoot),
    };
  } catch (error: unknown) {
    console.error(
      '[Ptah Electron] get-startup-config read failed; answering empty:',
      error instanceof Error ? error.message : String(error),
    );
    return { ...EMPTY_STARTUP_CONFIG };
  }
}
