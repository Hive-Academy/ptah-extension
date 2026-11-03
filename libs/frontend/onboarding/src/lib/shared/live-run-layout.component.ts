import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Places a live transcript before the run controls in DOM and keyboard order. */
@Component({
  selector: 'ptah-live-run-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <div class="run-container" [class.has-composer]="composer()">
      <div class="run-grid" [class.no-log]="!hasLog()">
        @if (hasLog()) {
          <div class="run-log min-w-0"><ng-content select="[runLog]" /></div>
        }
        <div class="run-results min-w-0"><ng-content /></div>
      </div>
    </div>
  `,
  styles: [`
    .run-container { container-type: inline-size; min-width: 0; }
    .run-grid { display: grid; gap: 16px; align-items: start; min-width: 0; }
    .run-log { height: clamp(320px, 56dvh, 520px); min-width: 0; }
    .run-results { display: grid; gap: 16px; min-width: 0; }
    @media (min-width: 721px) and (max-width: 767.98px) {
      .has-composer .run-log { height: clamp(420px, 70dvh, 640px); }
    }
    @media (min-width: 768px) {
      @container (min-width: 716px) {
        .run-grid:not(.no-log) { grid-template-columns: minmax(0, 1fr) clamp(300px, 36%, 380px); }
        .run-log { position: sticky; top: 16px; height: max(400px, calc(100dvh - var(--ws-chrome, 200px))); }
      }
    }
  `],
})
export class LiveRunLayoutComponent {
  readonly hasLog = input(true);
  readonly composer = input(false);
}
