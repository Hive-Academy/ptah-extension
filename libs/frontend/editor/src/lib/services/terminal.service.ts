import {
  Injectable,
  inject,
  signal,
  computed,
  DestroyRef,
  NgZone,
} from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import type { TerminalTab } from '../types/terminal.types';

/**
 * Per-workspace terminal state snapshot.
 * Cached in the workspace map so switching back restores terminal tabs instantly.
 */
interface TerminalWorkspaceState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}

/**
 * TerminalService - Manages terminal tabs and binary IPC communication.
 *
 * Complexity Level: 2 (Medium - signal-based state, RPC + binary IPC, workspace partitioning)
 * Patterns: Injectable service, workspace-partitioned Map (matching EditorService/GitStatusService),
 *           correlationId RPC for lifecycle, binary IPC for data streaming
 *
 * Responsibilities:
 * - Terminal tab lifecycle (create, kill, switch, close) via terminal:create / terminal:kill RPC
 * - Binary IPC listener setup for terminal data forwarding (window.ptahTerminal)
 * - xterm writer registration for routing incoming data to the correct xterm instance
 * - Workspace-partitioned state for multi-workspace terminal isolation
 *
 * Communication:
 * - Lifecycle: MESSAGE_TYPES.RPC_CALL / RPC_RESPONSE with correlationId matching
 * - Data I/O: Direct binary IPC via window.ptahTerminal (bypasses JSON serialization)
 */
@Injectable({ providedIn: 'root' })
export class TerminalService {
  private readonly vscodeService = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

  // ============================================================================
  // WORKSPACE STATE
  // ============================================================================

  /**
   * Map of workspace path to terminal state. Contains cached terminal state
   * for all workspaces (active and background) so switching back is instant.
   */
  private readonly _workspaceTerminalState = new Map<
    string,
    TerminalWorkspaceState
  >();

  /** Currently active workspace path. Null when no workspace is active. */
  private _activeWorkspacePath: string | null = null;

  // ============================================================================
  // SIGNAL STATE
  // ============================================================================

  private readonly _tabs = signal<TerminalTab[]>([]);
  private readonly _activeTabId = signal<string | null>(null);

  /** All terminal tabs for the active workspace. */
  readonly tabs = this._tabs.asReadonly();

  /** ID of the currently active terminal tab. */
  readonly activeTabId = this._activeTabId.asReadonly();

  /** The currently active terminal tab object, or null. */
  readonly activeTab = computed(() => {
    const id = this._activeTabId();
    return id ? (this._tabs().find((t) => t.id === id) ?? null) : null;
  });

  /** Whether any terminal tabs exist for the active workspace. */
  readonly hasTerminals = computed(() => this._tabs().length > 0);

  // ============================================================================
  // BINARY IPC LISTENERS
  // ============================================================================

  /** Cleanup function for the onData binary IPC listener. */
  private _dataUnsubscribe: (() => void) | null = null;

  /** Cleanup function for the onExit binary IPC listener. */
  private _exitUnsubscribe: (() => void) | null = null;

  /**
   * Map of terminal ID to xterm instance write callback.
   * Used to route incoming binary data from the main process to the correct
   * xterm Terminal instance. Registered by TerminalComponent, unregistered on destroy.
   */
  private readonly _xtermWriters = new Map<string, (data: string) => void>();

  /**
   * Buffer for terminal data that arrives before the Angular TerminalComponent
   * mounts and registers its xterm writer. Data is stored in insertion order
   * (array preserves order) and flushed when registerXtermWriter() is called.
   *
   * Cleaned up in: unregisterXtermWriter(), removeWorkspaceState(), cleanup()
   */
  private readonly _pendingDataBuffers = new Map<string, string[]>();

  /** Counter for generating sequential terminal tab names. */
  private _terminalCounter = 0;

  constructor() {
    this.setupBinaryIpcListeners();
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  // ============================================================================
  // XTERM WRITER REGISTRATION
  // ============================================================================

  /**
   * Register an xterm instance's write callback for data forwarding.
   *
   * Flushes any pending data that arrived before the writer was registered,
   * preserving insertion order. The buffer is cleared after flushing.
   *
   * @param terminalId - The terminal session ID
   * @param writer - Callback that writes data to the xterm.js Terminal instance
   */
  registerXtermWriter(
    terminalId: string,
    writer: (data: string) => void,
  ): void {
    // Flush any buffered data that arrived before the writer was registered
    const pendingBuffer = this._pendingDataBuffers.get(terminalId);
    if (pendingBuffer && pendingBuffer.length > 0) {
      for (const chunk of pendingBuffer) {
        writer(chunk);
      }
      this._pendingDataBuffers.delete(terminalId);
    }

    this._xtermWriters.set(terminalId, writer);
  }

  /**
   * Unregister an xterm writer when the terminal component is destroyed.
   * Also cleans up any pending data buffer to prevent memory leaks.
   *
   * @param terminalId - The terminal session ID to unregister
   */
  unregisterXtermWriter(terminalId: string): void {
    this._xtermWriters.delete(terminalId);
    this._pendingDataBuffers.delete(terminalId);
  }

  // ============================================================================
  // TERMINAL LIFECYCLE
  // ============================================================================

  /**
   * Create a new terminal tab via terminal:create RPC.
   * Spawns a PTY session on the main process and adds a tab to the UI.
   *
   * @param name - Optional display name for the terminal tab
   * @returns The terminal session ID, or null if creation failed
   */
  async createTerminal(name?: string): Promise<string | null> {
    this._terminalCounter++;
    const displayName = name || `Terminal ${this._terminalCounter}`;

    const result = await rpcCall<{ id: string; pid: number }>(
      this.vscodeService,
      'terminal:create',
      { name: displayName },
    );

    if (result.success && result.data) {
      const newTab: TerminalTab = {
        id: result.data.id,
        name: displayName,
        pid: result.data.pid,
        isActive: true,
        hasExited: false,
      };

      // Mark all existing tabs as inactive, add the new one as active
      this._tabs.update((tabs) => [
        ...tabs.map((t) => ({ ...t, isActive: false })),
        newTab,
      ]);
      this._activeTabId.set(result.data.id);

      // Sync to workspace state cache
      this.saveCurrentState();

      return result.data.id;
    }

    return null;
  }

  /**
   * Kill a terminal session via terminal:kill RPC.
   * Does not remove the tab from the UI (use closeTab for that).
   *
   * @param id - Terminal session ID to kill
   */
  async killTerminal(id: string): Promise<void> {
    await rpcCall<{ success: boolean }>(this.vscodeService, 'terminal:kill', {
      id,
    });
  }

  /**
   * Switch the active terminal tab.
   * Updates isActive flags on all tabs and sets the activeTabId signal.
   *
   * @param id - Terminal session ID to make active
   */
  switchTab(id: string): void {
    const tabExists = this._tabs().some((t) => t.id === id);
    if (!tabExists) return;

    this._tabs.update((tabs) =>
      tabs.map((t) => ({ ...t, isActive: t.id === id })),
    );
    this._activeTabId.set(id);
    this.saveCurrentState();
  }

  /**
   * Close a terminal tab: kill the PTY session and remove the tab from the list.
   * If the closed tab was active, switch to the last remaining tab.
   *
   * @param id - Terminal session ID to close
   */
  async closeTab(id: string): Promise<void> {
    // Kill the PTY session (ignore errors for already-exited terminals)
    await this.killTerminal(id);

    // Remove the xterm writer and pending data buffer
    this._xtermWriters.delete(id);
    this._pendingDataBuffers.delete(id);

    const currentTabs = this._tabs();
    const tabIndex = currentTabs.findIndex((t) => t.id === id);
    if (tabIndex === -1) return;

    const updatedTabs = currentTabs.filter((t) => t.id !== id);
    this._tabs.set(updatedTabs);

    // If the closed tab was active, switch to an adjacent tab
    if (this._activeTabId() === id) {
      if (updatedTabs.length > 0) {
        const newIndex = Math.min(tabIndex, updatedTabs.length - 1);
        const newActive = updatedTabs[newIndex];
        this._tabs.update((tabs) =>
          tabs.map((t) => ({ ...t, isActive: t.id === newActive.id })),
        );
        this._activeTabId.set(newActive.id);
      } else {
        this._activeTabId.set(null);
      }
    }

    this.saveCurrentState();
  }

  // ============================================================================
  // BINARY IPC DATA FORWARDING
  // ============================================================================

  /**
   * Write user input data to a terminal session via binary IPC.
   *
   * @param id - Terminal session ID
   * @param data - Input data from xterm.onData
   */
  writeToTerminal(id: string, data: string): void {
    window.ptahTerminal?.write(id, data);
  }

  /**
   * Resize a terminal session via binary IPC.
   *
   * @param id - Terminal session ID
   * @param cols - New column count
   * @param rows - New row count
   */
  resizeTerminal(id: string, cols: number, rows: number): void {
    window.ptahTerminal?.resize(id, cols, rows);
  }

  // ============================================================================
  // WORKSPACE OPERATIONS
  // ============================================================================

  /**
   * Switch terminal state to a different workspace.
   * Saves current state, restores target from cache or resets to defaults.
   */
  switchWorkspace(workspacePath: string): void {
    if (this._activeWorkspacePath === workspacePath) return;

    // Save current workspace state
    this.saveCurrentState();
    this._activeWorkspacePath = workspacePath;

    // Restore cached state or reset to defaults
    const cached = this._workspaceTerminalState.get(workspacePath);
    if (cached) {
      this._tabs.set(cached.tabs);
      this._activeTabId.set(cached.activeTabId);
    } else {
      this._tabs.set([]);
      this._activeTabId.set(null);
    }
  }

  /**
   * Remove cached terminal state for a workspace.
   * Called when a workspace folder is removed from the layout.
   *
   * Kills all PTY sessions for the workspace (fire-and-forget) and cleans up
   * xterm writers and pending data buffers BEFORE clearing tab state, since
   * tab IDs are needed for the cleanup.
   */
  removeWorkspaceState(workspacePath: string): void {
    // Collect terminal tabs BEFORE clearing state (otherwise tab IDs are lost)
    let tabsToKill: TerminalTab[] = [];

    if (this._activeWorkspacePath === workspacePath) {
      // Active workspace: get tabs from the current signal
      tabsToKill = this._tabs();
    } else {
      // Background workspace: get tabs from the workspace state cache
      const cached = this._workspaceTerminalState.get(workspacePath);
      if (cached) {
        tabsToKill = cached.tabs;
      }
    }

    // Kill PTY sessions and clean up writers/buffers for each terminal
    for (const tab of tabsToKill) {
      // Fire-and-forget: don't await since we're removing the workspace anyway.
      // .catch() prevents unhandled promise rejections for already-exited terminals.
      this.killTerminal(tab.id).catch(() => {
        /* PTY may have already exited -- safe to ignore */
      });
      this._xtermWriters.delete(tab.id);
      this._pendingDataBuffers.delete(tab.id);
    }

    // Clear the workspace state cache
    this._workspaceTerminalState.delete(workspacePath);

    // If the removed workspace was active, clear signals
    if (this._activeWorkspacePath === workspacePath) {
      this._activeWorkspacePath = null;
      this._tabs.set([]);
      this._activeTabId.set(null);
    }
  }

  // ============================================================================
  // PRIVATE: BINARY IPC SETUP
  // ============================================================================

  /**
   * Set up binary IPC listeners for terminal data and exit events.
   * Data from the main process is routed to the appropriate xterm writer.
   * Exit events update the tab's hasExited/exitCode state.
   */
  private setupBinaryIpcListeners(): void {
    if (!window.ptahTerminal) return;

    this._dataUnsubscribe = window.ptahTerminal.onData((id, data) => {
      const writer = this._xtermWriters.get(id);
      if (writer) {
        // Run outside Angular zone to avoid unnecessary change detection
        // for high-frequency terminal data. The xterm canvas handles its own rendering.
        writer(data);
      } else {
        // Buffer data until the TerminalComponent mounts and registers its writer.
        // This prevents data loss for output that arrives between PTY creation
        // and Angular component initialization.
        const buffer = this._pendingDataBuffers.get(id);
        if (buffer) {
          buffer.push(data);
        } else {
          this._pendingDataBuffers.set(id, [data]);
        }
      }
    });

    this._exitUnsubscribe = window.ptahTerminal.onExit((id, exitCode) => {
      // Run inside Angular zone so the signal update triggers change detection
      this.ngZone.run(() => {
        this._tabs.update((tabs) =>
          tabs.map((t) =>
            t.id === id ? { ...t, hasExited: true, exitCode } : t,
          ),
        );
        this.saveCurrentState();
      });
    });
  }

  /**
   * Cleanup binary IPC listeners and all per-terminal resources.
   * Called on service destroy.
   */
  private cleanup(): void {
    this._dataUnsubscribe?.();
    this._exitUnsubscribe?.();
    this._xtermWriters.clear();
    this._pendingDataBuffers.clear();
  }

  // ============================================================================
  // PRIVATE: WORKSPACE STATE HELPERS
  // ============================================================================

  /**
   * Save current signal values into the workspace state map.
   */
  private saveCurrentState(): void {
    if (!this._activeWorkspacePath) return;

    this._workspaceTerminalState.set(this._activeWorkspacePath, {
      tabs: this._tabs(),
      activeTabId: this._activeTabId(),
    });
  }
}
