import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { SubagentTranscriptViewerComponent } from '@ptah-extension/chat-ui';
import { SubagentTranscriptViewerService } from '../../services/subagent-transcript-viewer.service';

/**
 * SubagentTranscriptOverlayComponent — smart host for the on-demand subagent
 * transcript viewer.
 *
 * Mounted ONCE, high in the tree (`AppShellComponent`, alongside the other
 * global modals), it reads {@link SubagentTranscriptViewerService} and renders
 * the presentational {@link SubagentTranscriptViewerComponent} inside a daisyUI
 * modal. Any trigger (inline agent bubble, background-agent tray) calls
 * `service.openFor(...)`; because the service is root-scoped, a single host is
 * enough — no per-host open-state duplication.
 */
@Component({
  selector: 'ptah-subagent-transcript-overlay',
  standalone: true,
  imports: [SubagentTranscriptViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="modal" [class.modal-open]="viewer.open()">
      @if (viewer.open()) {
        <div class="modal-box max-w-2xl w-full p-4">
          <ptah-subagent-transcript-viewer
            [agentName]="viewer.agentName()"
            [messages]="viewer.messages()"
            [loading]="viewer.loading()"
            [error]="viewer.error()"
            (closed)="viewer.close()"
            (refresh)="viewer.refresh()"
          />
        </div>
      }
      <form method="dialog" class="modal-backdrop">
        <button type="button" (click)="viewer.close()">close</button>
      </form>
    </dialog>
  `,
})
export class SubagentTranscriptOverlayComponent {
  protected readonly viewer = inject(SubagentTranscriptViewerService);
}
