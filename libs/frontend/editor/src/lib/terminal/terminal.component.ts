import {
  Component,
  input,
  inject,
  ElementRef,
  viewChild,
  AfterViewInit,
  OnDestroy,
  ChangeDetectionStrategy,
  NgZone,
} from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { TerminalService } from '../services/terminal.service';

/**
 * TerminalComponent - Wraps a single xterm.js Terminal instance.
 *
 * Complexity Level: 2 (Medium - xterm lifecycle, WebGL fallback, ResizeObserver, binary IPC binding)
 * Patterns: Standalone component, OnPush, viewChild for container ref, input for terminal ID
 *
 * Responsibilities:
 * - Initialize xterm.js Terminal with dark theme matching Anubis design
 * - Load FitAddon for auto-sizing, WebglAddon for GPU-accelerated rendering (with canvas fallback)
 * - Forward user input (terminal.onData) to TerminalService.writeToTerminal (binary IPC)
 * - Register as xterm writer so incoming data from main process is written to this terminal
 * - Auto-resize via ResizeObserver + FitAddon.fit() + backend resize notification
 * - Clean up all resources on destroy (addons, terminal, observer, writer registration)
 *
 * Note: xterm.css must be imported globally in apps/ptah-extension-webview/src/styles.css
 */
@Component({
  selector: 'ptah-terminal',
  standalone: true,
  template: `<div #terminalContainer class="h-full w-full"></div>`,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminalComponent implements AfterViewInit, OnDestroy {
  /** The terminal session ID this component renders. Required input. */
  readonly terminalId = input.required<string>();

  private readonly terminalService = inject(TerminalService);
  private readonly ngZone = inject(NgZone);
  private readonly terminalContainer =
    viewChild.required<ElementRef<HTMLDivElement>>('terminalContainer');

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private webglAddon: WebglAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;

  ngAfterViewInit(): void {
    // Initialize xterm outside Angular zone to avoid triggering change detection
    // for every terminal render frame and cursor blink
    this.ngZone.runOutsideAngular(() => {
      this.initTerminal();
    });
  }

  ngOnDestroy(): void {
    this.terminalService.unregisterXtermWriter(this.terminalId());
    this.resizeObserver?.disconnect();
    this.webglAddon?.dispose();
    this.fitAddon?.dispose();
    this.terminal?.dispose();
  }

  /**
   * Initialize the xterm.js Terminal instance with addons and event bindings.
   *
   * Flow:
   * 1. Create Terminal with dark theme matching Anubis/Catppuccin colors
   * 2. Load FitAddon for responsive sizing
   * 3. Try loading WebglAddon for GPU rendering (fallback to canvas on failure)
   * 4. Open terminal in the container element
   * 5. Fit to container size
   * 6. Bind user input -> TerminalService.writeToTerminal (binary IPC to main process)
   * 7. Register as xterm writer so main process data flows into this terminal
   * 8. Set up ResizeObserver for auto-resize on container size changes
   */
  private initTerminal(): void {
    const container = this.terminalContainer().nativeElement;

    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b7066',
        selectionForeground: '#cdd6f4',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      scrollback: 5000,
      allowProposedApi: true,
    });

    // Load FitAddon for responsive terminal sizing
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Try WebGL renderer for GPU-accelerated rendering, fallback to canvas
    try {
      this.webglAddon = new WebglAddon();
      this.terminal.loadAddon(this.webglAddon);
      // Handle WebGL context loss gracefully (GPU driver reset, etc.)
      this.webglAddon.onContextLoss(() => {
        this.webglAddon?.dispose();
        this.webglAddon = null;
      });
    } catch {
      // WebGL not available in this environment, canvas renderer is the fallback
      this.webglAddon = null;
    }

    // Open terminal in the DOM container
    this.terminal.open(container);

    // Initial fit to container dimensions
    this.fitAddon.fit();

    // Forward user input to the main process via binary IPC
    this.terminal.onData((data: string) => {
      this.terminalService.writeToTerminal(this.terminalId(), data);
    });

    // Register this terminal's write callback so incoming data from main process
    // is written to this xterm instance
    this.terminalService.registerXtermWriter(
      this.terminalId(),
      (data: string) => {
        this.terminal?.write(data);
      },
    );

    // Auto-resize terminal when container dimensions change
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitAddon && this.terminal) {
        this.fitAddon.fit();
        this.terminalService.resizeTerminal(
          this.terminalId(),
          this.terminal.cols,
          this.terminal.rows,
        );
      }
    });
    this.resizeObserver.observe(container);
  }
}
