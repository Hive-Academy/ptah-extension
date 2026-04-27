/**
 * Shared CSS for resize handle components.
 *
 * Used by both ResizeHandleComponent (agent monitor panel, service-injected)
 * and ElectronResizeHandleComponent (desktop layout, output-based).
 */
export const RESIZE_HANDLE_STYLES = `
  :host {
    display: block;
    flex-shrink: 0;
  }

  .resize-handle {
    width: 6px;
    cursor: col-resize;
    background: transparent;
    position: relative;
    height: 100%;
    z-index: 10;
    transition: background-color 150ms;
  }

  .resize-handle:hover {
    background-color: oklch(var(--p) / 0.3);
  }

  .resize-handle:active {
    background-color: oklch(var(--p) / 0.5);
  }

  /* Grip indicator (thin vertical line) */
  .resize-handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 24px;
    border-radius: 1px;
    background-color: oklch(var(--bc) / 0.15);
    transition: background-color 150ms;
  }

  .resize-handle:hover::after {
    background-color: oklch(var(--bc) / 0.4);
  }
`;
