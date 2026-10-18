import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'ptah-generation-errors',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (errors().length) {
      <section class="alert alert-error block" aria-label="Generation errors">
        <ul class="list-disc pl-5">
          @for (error of errors().slice(0, 3); track $index) {
            <li>{{ error }}</li>
          }
        </ul>
        @if (errors().length > 3) {
          <details>
            <summary>Show {{ errors().length - 3 }} more errors</summary>
            <ul class="list-disc pl-5">
              @for (error of errors().slice(3); track $index) {
                <li>{{ error }}</li>
              }
            </ul>
          </details>
        }
      </section>
    }
  `,
})
export class GenerationErrorsComponent {
  readonly errors = input<readonly string[]>([]);
}
