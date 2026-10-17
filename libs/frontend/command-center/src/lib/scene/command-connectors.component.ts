import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { getConnectorPaths, type SceneGeometry } from './connector-geometry';

@Component({
  selector: 'ptah-command-connectors',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './command-connectors.component.css',
  host: {
    style: 'position: absolute; inset: 0; z-index: 0; display: block; pointer-events: none;',
  },
  template: `
    <svg data-scene-connectors aria-hidden="true" focusable="false"
      [attr.viewBox]="viewBox()" preserveAspectRatio="none">
      <defs>
        <linearGradient id="connector-inProgress" gradientUnits="userSpaceOnUse" x1="0" y1="0" [attr.x2]="geometry()?.stage?.width ?? 1" [attr.y2]="geometry()?.stage?.height ?? 1">
          <stop offset="0" class="running-start" />
          <stop offset="1" class="running-end" />
        </linearGradient>
        <linearGradient id="connector-waiting" gradientUnits="userSpaceOnUse" x1="0" y1="0" [attr.x2]="geometry()?.stage?.width ?? 1" [attr.y2]="geometry()?.stage?.height ?? 1">
          <stop offset="0" class="waiting-start" />
          <stop offset="1" class="waiting-end" />
        </linearGradient>
        <linearGradient id="connector-finished" gradientUnits="userSpaceOnUse" x1="0" y1="0" [attr.x2]="geometry()?.stage?.width ?? 1" [attr.y2]="geometry()?.stage?.height ?? 1">
          <stop offset="0" class="finished-start" />
          <stop offset="1" class="finished-end" />
        </linearGradient>
        <linearGradient id="connector-other" gradientUnits="userSpaceOnUse" x1="0" y1="0" [attr.x2]="geometry()?.stage?.width ?? 1" [attr.y2]="geometry()?.stage?.height ?? 1">
          <stop offset="0" class="other-start" />
          <stop offset="1" class="other-end" />
        </linearGradient>
      </defs>
      @for (wire of paths().wires; track $index) {
        <path class="wire" [attr.d]="wire.d" />
        <circle class="source-dot" [attr.cx]="wire.start.x" [attr.cy]="wire.start.y" r="3" />
      }
      @for (ribbon of paths().ribbons; track ribbon.key) {
        <path class="ribbon" [attr.d]="ribbon.d"
          [attr.stroke]="'url(#connector-' + ribbon.key + ')'"
          [attr.stroke-width]="ribbon.key === 'waiting' ? 20 : 16" />
      }
    </svg>
  `,
})
export class CommandConnectorsComponent {
  public readonly geometry = input<SceneGeometry | null>(null);
  public readonly paths = computed(() => getConnectorPaths(this.geometry()));
  public readonly viewBox = computed(() => {
    const stage = this.geometry()?.stage;
    return `0 0 ${Math.max(0, stage?.width ?? 0)} ${Math.max(0, stage?.height ?? 0)}`;
  });
}
