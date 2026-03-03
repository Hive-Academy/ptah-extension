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
 *   - MAX_WIDTH_RATIO: 60% of viewport (prevents chat area collapse)
 */

import { Injectable, signal, computed } from '@angular/core';

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

  /** Clamp and set a custom panel width */
  setCustomWidth(width: number): void {
    const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;
    const clamped = Math.min(Math.max(width, MIN_WIDTH), maxWidth);
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
