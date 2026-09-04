import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';

/**
 * Global type extension for MonacoVim loaded via UMD script.
 */
declare global {
  interface Window {
    MonacoVim?: {
      initVimMode: (
        editor: unknown,
        statusBarElement: HTMLElement,
      ) => { dispose: () => void };
    };

    /**
     * Monaco's AMD loader installs a global `define` carrying an `.amd`
     * marker. Declared here so `suppressAmdDefine()` can read and swap it
     * without a cast.
     */
    define?: ((...args: unknown[]) => unknown) & { amd?: unknown };
  }
}

/**
 * VimModeService - Manages Vim mode lifecycle for Monaco editor instances.
 *
 * Complexity Level: 1 (Simple - signal state, dynamic script load, dispose pattern)
 * Patterns: Injectable service, signal-based state
 *
 * Responsibilities:
 * - Track Vim mode enabled/disabled state via signal
 * - Attach/detach monaco-vim to Monaco editor instances
 * - Persist preference to ~/.ptah/settings.json via RPC
 * - Gracefully handle monaco-vim load failures
 *
 * Communication: Uses editor:getSetting / editor:updateSetting RPC methods.
 *
 * NOTE: monaco-vim is loaded as a runtime UMD script from assets/monaco-vim/
 * rather than bundled via npm. This avoids esbuild bundling issues where
 * monaco-vim's import path 'monaco-editor/esm/vs/editor/editor.api' doesn't
 * resolve correctly (the file exists at .js but import lacks extension).
 */
@Injectable({ providedIn: 'root' })
export class VimModeService {
  private readonly vscodeService = inject(VSCodeService);

  private readonly _enabled = signal(false);

  /** Whether vim mode is currently enabled. */
  readonly enabled = this._enabled.asReadonly();

  /** The current monaco-vim disposable instance. */
  private vimMode: { dispose: () => void } | null = null;

  /** Whether the monaco-vim script is currently loading. */
  private isLoadingScript = false;

  /** Whether the monaco-vim module has been confirmed as unavailable. */
  private loadFailed = false;

  /**
   * Load the saved vim mode preference from backend settings.
   * Called once on editor panel initialization.
   */
  async loadPreference(): Promise<void> {
    const result = await rpcCall<{ value: boolean }>(
      this.vscodeService,
      'editor:getSetting',
      { key: 'editor.vimMode' },
    );
    if (result.success && result.data) {
      this._enabled.set(result.data.value ?? false);
    }
  }

  /**
   * Toggle vim mode on/off and persist the preference.
   * When toggling off, detaches vim from the current editor.
   */
  async toggle(): Promise<void> {
    const newValue = !this._enabled();
    this._enabled.set(newValue);

    if (!newValue) {
      this.detach();
    }

    await rpcCall(this.vscodeService, 'editor:updateSetting', {
      key: 'editor.vimMode',
      value: newValue,
    });
  }

  /**
   * Attach vim mode to a Monaco editor instance.
   *
   * Detaches any existing vim mode first, then loads monaco-vim UMD script
   * if not already loaded, and initializes it on the provided editor.
   *
   * @param editor - The Monaco editor instance (IStandaloneCodeEditor)
   * @param statusBarElement - The DOM element for vim status display
   */
  attachToEditor(editor: unknown, statusBarElement: HTMLElement): void {
    this.detach();

    if (!this._enabled() || !editor || !statusBarElement) {
      return;
    }
    if (this.loadFailed) {
      return;
    }
    if (window.MonacoVim?.initVimMode) {
      this.vimMode = window.MonacoVim.initVimMode(editor, statusBarElement);
      return;
    }
    this.loadMonacoVimScript().then((success) => {
      if (!success || !this._enabled()) {
        return;
      }

      if (window.MonacoVim?.initVimMode) {
        this.vimMode = window.MonacoVim.initVimMode(editor, statusBarElement);
      }
    });
  }

  /**
   * Load the monaco-vim UMD script dynamically.
   * Returns true if loaded successfully, false otherwise.
   *
   * A load that resolves without producing `window.MonacoVim` is terminal:
   * it marks `loadFailed` exactly as the `catch` does. Leaving that path
   * unmarked is what made every later `attachToEditor` re-inject the script,
   * turning one silent failure into a repeating loader error.
   */
  private async loadMonacoVimScript(): Promise<boolean> {
    if (this.isLoadingScript) {
      while (this.isLoadingScript) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return !!window.MonacoVim?.initVimMode;
    }

    this.isLoadingScript = true;

    try {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = './assets/monaco-vim/monaco-vim.umd.js';
        // Deliberately async: a dynamically inserted script is fetched
        // off the parser either way, and `async = false` would queue it
        // behind any other in-order dynamic script — widening the window
        // in which `define` is hidden. `true` executes it as soon as it
        // is fetched, which is the narrowest window available here.
        script.async = true;

        const restoreAmdDefine = this.suppressAmdDefine();
        script.onload = () => {
          restoreAmdDefine();
          resolve();
        };
        script.onerror = () => {
          // Restore on failure too: a 404 must not leave Monaco's loader
          // without its `define`.
          restoreAmdDefine();
          reject(new Error('Failed to load monaco-vim'));
        };

        try {
          document.head.appendChild(script);
        } catch (error: unknown) {
          restoreAmdDefine();
          reject(
            error instanceof Error
              ? error
              : new Error('Failed to inject monaco-vim script'),
          );
        }
      });

      if (!window.MonacoVim?.initVimMode) {
        this.markLoadFailed();
        return false;
      }
      return true;
    } catch {
      this.markLoadFailed();
      return false;
    } finally {
      this.isLoadingScript = false;
    }
  }

  /**
   * Hide Monaco's AMD `define` for the duration of the monaco-vim script,
   * so its UMD wrapper takes the global branch and assigns `window.MonacoVim`.
   *
   * The wrapper (`node_modules/monaco-vim/dist/monaco-vim.umd.js:3-4`) is
   * `typeof define === 'function' && define.amd ? define([...], factory) : (global.MonacoVim = {}, factory(...))`.
   * With Monaco's loader present the AMD branch wins, so the global branch —
   * the only one that assigns `window.MonacoVim` — never runs, and the queued
   * anonymous module never resolves either: its dependency id
   * `monaco-editor/esm/vs/editor/editor.api` does not exist under the loader's
   * `assets/monaco/vs` base URL.
   *
   * Accepted risk: the swap window spans `appendChild` through
   * `onload`/`onerror` — the script's fetch plus its synchronous execution. If
   * Monaco's loader resolves a module inside that window, that module sees no
   * `define` and takes its own non-AMD path. Accepted because the alternative,
   * loading monaco-vim *through* the loader with `require([...])`, needs a
   * `paths` mapping for `monaco-editor/esm/vs/editor/editor.api`, and no such
   * module is shipped under `assets/monaco` — there is nothing to map it to.
   *
   * @returns A restore function. Call it exactly once, on success AND failure.
   */
  private suppressAmdDefine(): () => void {
    const amdDefine = window.define;
    if (typeof amdDefine !== 'function' || !amdDefine.amd) {
      // No AMD loader in play — the UMD wrapper already takes the global
      // branch, so leave the global alone.
      return () => undefined;
    }

    window.define = undefined;
    return () => {
      window.define = amdDefine;
    };
  }

  /** Mark monaco-vim as permanently unavailable and turn vim mode off. */
  private markLoadFailed(): void {
    this.loadFailed = true;
    this._enabled.set(false);
  }

  /**
   * Detach vim mode from the current editor instance.
   * Safe to call even when no vim mode is attached.
   */
  detach(): void {
    if (this.vimMode) {
      this.vimMode.dispose();
      this.vimMode = null;
    }
  }
}
