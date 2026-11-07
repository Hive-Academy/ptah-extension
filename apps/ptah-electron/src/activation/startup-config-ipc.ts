import { app, ipcMain } from 'electron';
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
  gpuCompositing: 'hardware' | 'software' | 'disabled';
  initialView: string | null;
  workspaceRoot: string;
  workspaceName: string;
  /** TODO(streaming-p6): remove zone fallback flag after one stable release */
  zoneChangeDetectionFallback: boolean;
}

const EMPTY_STARTUP_CONFIG: StartupConfig = {
  gpuCompositing: 'hardware',
  initialView: null,
  workspaceRoot: '',
  workspaceName: '',
  zoneChangeDetectionFallback: false,
};

function readZoneChangeDetectionFallback(): boolean {
  return process.env['PTAH_ZONE_CHANGE_DETECTION_FALLBACK'] === '1';
}

function emptyStartupConfig(): StartupConfig {
  return {
    ...EMPTY_STARTUP_CONFIG,
    gpuCompositing: gpuCompositingMode(),
    zoneChangeDetectionFallback: readZoneChangeDetectionFallback(),
  };
}

/**
 * Map Chromium's `gpu_compositing` feature status onto the renderer's mode.
 *
 * Chromium reports `enabled*` (`enabled`, `enabled_on`, `enabled_force`, ...),
 * `*_software` when compositing falls back to the CPU, and `disabled_*` /
 * `unavailable_*` when it is off. The renderer turns glass blur off for both
 * `software` and `disabled`, so only a status that positively says the GPU is
 * not compositing may leave `hardware`. A missing or unrecognised status maps
 * to `hardware`: turning glass off on a working GPU is a visible regression,
 * while a wrong `hardware` on a GPU-less machine only costs blur performance.
 */
export function gpuCompositingModeFor(
  status: string | undefined,
): StartupConfig['gpuCompositing'] {
  if (!status || status.startsWith('enabled')) return 'hardware';
  if (status.endsWith('software')) return 'software';
  if (status.startsWith('disabled') || status.startsWith('unavailable')) {
    return 'disabled';
  }
  return 'hardware';
}

function gpuCompositingMode(): StartupConfig['gpuCompositing'] {
  return gpuCompositingModeFor(app.getGPUFeatureStatus().gpu_compositing);
}

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
  if (!container) return emptyStartupConfig();
  try {
    const workspaceProvider = container.resolve<IWorkspaceProvider>(
      PLATFORM_TOKENS.WORKSPACE_PROVIDER,
    );
    const resolvedRoot = workspaceProvider.getWorkspaceRoot();
    if (!resolvedRoot) return emptyStartupConfig();
    return {
      gpuCompositing: gpuCompositingMode(),
      initialView: null,
      workspaceRoot: resolvedRoot,
      workspaceName: path.basename(resolvedRoot),
      // TODO(streaming-p6): remove zone fallback flag after one stable release
      zoneChangeDetectionFallback: readZoneChangeDetectionFallback(),
    };
  } catch (error: unknown) {
    console.error(
      '[Ptah Electron] get-startup-config read failed; answering empty:',
      error instanceof Error ? error.message : String(error),
    );
    return emptyStartupConfig();
  }
}
