/**
 * Panel Resize Service
 *
 * Standalone service managing right sidebar panel width state.
 * Decoupled from AgentMonitorStore so it can be plugged in or removed independently.
 *
 * Width state:
 *   - `null`   → no custom width, responsive CSS classes govern the panel
 *   - `number` → user-dragged width in px, applied as inline style (overrides CSS)
 *
 * Constraints:
 *   - MIN_WIDTH: 300px (usable agent card display)
 *   - MAX_WIDTH_RATIO: 60% of the *container* (prevents chat area collapse)
 *
 * Scope: provided by `ChatViewComponent` so each canvas tile owns its own
 * panel width. The root-level fallback serves standalone monitor panels.
 */

import { Injectable, signal } from '@angular/core';

const MIN_WIDTH = 300;
const MAX_WIDTH_RATIO = 0.6;

@Injectable({ providedIn: 'root' })
export class PanelResizeService {
  private readonly _customWidth = signal<number | null>(null);
  private readonly _dragging = signal(false);

  /** Current custom width (null = use responsive CSS defaults) */
  readonly customWidth = this._customWidth.asReadonly();

  /** Whether a drag is in progress (disables CSS transitions) */
  readonly dragging = this._dragging.asReadonly();

  /**
   * Clamp and set a custom panel width.
   *
   * `containerWidth` is the width of the surface the panel lives in — the chat
   * view host, not the viewport. Inside a canvas tile these differ by a lot, and
   * clamping against the viewport pins the panel at max width on every drag.
   */
  setCustomWidth(width: number, containerWidth = window.innerWidth): void {
    const maxWidth = containerWidth * MAX_WIDTH_RATIO;
    const minWidth = Math.min(MIN_WIDTH, maxWidth);
    const clamped = Math.min(Math.max(width, minWidth), maxWidth);
    this._customWidth.set(clamped);
  }

  /** Reset to responsive CSS defaults */
  resetWidth(): void {
    this._customWidth.set(null);
  }

  setDragging(value: boolean): void {
    this._dragging.set(value);
  }
}
