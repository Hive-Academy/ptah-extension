import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
} from '@angular/core';
import { SubagentTranscriptViewerComponent } from '@ptah-extension/chat-ui';
import { TabManagerService } from '@ptah-extension/chat-state';
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
  // Agent-output surface (subagent transcript markdown). The overlay is opened
  // from a root store, but that store knows the PARENT SESSION of the
  // transcript, so the owning tab is resolvable and published here — a relative
  // link written by a subagent in a background workspace resolves against that
  // workspace rather than against the active one (AC 22 / L-7). A session with
  // no tab drops the attribute and keeps the router's previous fallback.
  host: {
    'data-ptah-file-links': '',
    '[attr.data-ptah-tab-id]': 'linkTabId()',
  },
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
  private readonly tabManager = inject(TabManagerService);

  /**
   * Owning tab of the open transcript, published as `data-ptah-tab-id` for
   * `FileLinkRouterService.resolveContext`. Null while nothing is open, or when
   * the parent session has no tab in any workspace.
   */
  protected readonly linkTabId = computed<string | null>(() => {
    const sessionId = this.viewer.sessionId();
    if (!sessionId) return null;
    return (
      this.tabManager.findTabBySessionIdAcrossWorkspaces(sessionId)?.tab.id ??
      null
    );
  });
}
