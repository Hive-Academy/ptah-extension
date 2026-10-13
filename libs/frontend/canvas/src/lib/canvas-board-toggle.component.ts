import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { CanvasBoardMode } from './canvas-board-mode';

@Component({
  selector: 'ptah-canvas-board-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="group" aria-label="Board" class="join" data-testid="canvas-board-toggle">
      <button type="button" class="btn btn-xs join-item" [class.btn-active]="mode() === 'rail'"
        [attr.aria-pressed]="mode() === 'rail'" (click)="modeChanged.emit('rail')">Rail</button>
      <button type="button" class="btn btn-xs join-item" [class.btn-active]="mode() === 'grid'"
        [attr.aria-pressed]="mode() === 'grid'" (click)="modeChanged.emit('grid')">Grid</button>
    </div>
  `,
})
export class CanvasBoardToggleComponent {
  readonly mode = input.required<CanvasBoardMode>();
  readonly modeChanged = output<CanvasBoardMode>();
}
