import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ChatEmptyStateViewComponent } from './chat-empty-state-screen.component';

/** Eager shell only: vitals and their data sources belong to the deferred view. */
@Component({
  selector: 'ptah-chat-empty-state',
  standalone: true,
  imports: [ChatEmptyStateViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @defer (on immediate) {
      <ptah-chat-empty-state-view
        [tabId]="tabId()"
        [showReadiness]="showReadiness()"
        (promptSelected)="promptSelected.emit($event)"
        (resumeRequested)="resumeRequested.emit($event)"
      />
    }
  `,
})
export class ChatEmptyStateComponent {
  readonly tabId = input<string | null>(null);
  readonly showReadiness = input(false);
  readonly promptSelected = output<string>();
  readonly resumeRequested = output<string>();
}
