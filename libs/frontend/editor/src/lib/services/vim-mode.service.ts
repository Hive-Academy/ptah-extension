import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { rpcCall } from './rpc-call.util';

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

  // ============================================================================
  // SIGNAL STATE
  // ============================================================================

  private readonly _enabled = signal(false);

  /** Whether vim mode is currently enabled. */
  readonly enabled = this._enabled.asReadonly();

  // ============================================================================
  // INTERNAL STATE
  // ============================================================================

  /** The current monaco-vim disposable instance. */
  private vimMode: { dispose: () => void } | null = null;

  /** Whether the monaco-vim script is currently loading. */
  private isLoadingScript = false;

  /** Whether the monaco-vim module has been confirmed as unavailable. */
  private loadFailed = false;

  // ============================================================================
  // PREFERENCE MANAGEMENT
  // ============================================================================

  /**
   * Load the saved vim mode preference from backend settings.
   * Called once on editor panel initialization.
   */
  async loadPreference(): Promise<void> {
    try {
      const result = await rpcCall<{ value: boolean }>(
        this.vscodeService,
        'editor:getSetting',
        { key: 'editor.vimMode' },
      );
      if (result.success && result.data) {
        this._enabled.set(result.data.value ?? false);
      }
    } catch {
      // Silently fall back to disabled if settings read fails
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

    try {
      await rpcCall(this.vscodeService, 'editor:updateSetting', {
        key: 'editor.vimMode',
        value: newValue,
      });
    } catch {
      // Preference persistence failure is non-critical
    }
  }

  // ============================================================================
  // EDITOR ATTACHMENT
  // ============================================================================

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

    // If a previous load attempt failed, don't retry
    if (this.loadFailed) {
      return;
    }

    // If MonacoVim is already available on window, use it immediately
    if (window.MonacoVim?.initVimMode) {
      this.vimMode = window.MonacoVim.initVimMode(editor, statusBarElement);
      return;
    }

    // Otherwise, load the script dynamically
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
   */
  private async loadMonacoVimScript(): Promise<boolean> {
    if (this.isLoadingScript) {
      // Wait for existing load to complete
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
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load monaco-vim'));
        document.head.appendChild(script);
      });
      return !!window.MonacoVim?.initVimMode;
    } catch {
      this.loadFailed = true;
      this._enabled.set(false);
      return false;
    } finally {
      this.isLoadingScript = false;
    }
  }

  /**
   * Detach vim mode from the current editor instance.
   * Safe to call even when no vim mode is attached.
   */
  detach(): void {
    if (this.vimMode) {
      try {
        this.vimMode.dispose();
      } catch {
        // Dispose may throw if the editor was already destroyed
      }
      this.vimMode = null;
    }
  }
}
