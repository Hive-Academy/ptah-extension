import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { AppsSessionService } from '../services/apps-session.service';
import { AppsFocusMemoryDirective } from './apps-focus-memory.directive';
import { AppsSurfacePanelComponent } from './apps-surface-panel.component';
import { AppsTranscriptComponent } from './apps-transcript.component';

/**
 * `AppsPageComponent` — the routed Apps page (implementation-plan.md:648-693).
 *
 * Host, composer and layout only. Every piece of conversation and surface
 * state lives in the root `AppsSessionService` (per workspace slice), so
 * leaving the tab and coming back shows the same transcript, surfaces, view
 * states and overlays (Req 2.4). The host carries `AppsFocusMemoryDirective`
 * (`tabindex="-1"`), which restores the last focused control of the slice
 * after a re-create (Req 7.6).
 *
 * The only local value is the composer's draft text: an uncommitted form
 * control value, not conversation state. It is cleared when a turn is sent
 * and put back when that send fails (a failed `start()`, a failed continue,
 * or a send before the session resolved — B12 N4), unless the user has
 * already typed something new.
 *
 * Layout: a CSS grid of three columns — the conversation column
 * (`--apps-conversation-width`, 360px as in the prototype), the
 * `apps-split-handle-slot` column reserved for the Batch 20 splitter handle
 * (empty and zero-width here), and the surface panel. The page is an
 * `apps-page` inline-size container: at 480px or less (a narrow window or the
 * embedded sidebar) the columns stack vertically and the slot is hidden
 * (prototype proposal a).
 */
@Component({
  selector: 'ptah-apps-page',
  standalone: true,
  imports: [
    AppsTranscriptComponent,
    AppsSurfacePanelComponent,
    LucideAngularModule,
  ],
  hostDirectives: [AppsFocusMemoryDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'apps-page',
  },
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 0;
        outline: none;
        container-type: inline-size;
        container-name: apps-page;
      }
      .apps-layout {
        display: grid;
        grid-template-columns:
          var(--apps-conversation-width, 360px)
          auto
          minmax(0, 1fr);
        flex: 1 1 auto;
        min-height: 0;
      }
      .apps-conversation {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }
      @container apps-page (max-width: 480px) {
        .apps-layout {
          grid-template-columns: minmax(0, 1fr);
          grid-auto-rows: auto;
          overflow-y: auto;
        }
        .apps-conversation {
          border-right: none;
          border-bottom: 1px solid var(--fallback-b3, oklch(var(--b3)));
          max-height: 260px;
        }
        .apps-split-handle-slot {
          display: none;
        }
        .apps-surface {
          min-height: 480px;
        }
      }
    `,
  ],
  template: `
    <div class="apps-layout bg-base-100 text-base-content">
      <section
        class="apps-conversation border-r border-base-300"
        aria-labelledby="apps-page-title"
      >
        <header
          class="flex items-center justify-between gap-2 px-3 py-2 border-b border-base-300 shrink-0"
        >
          <div class="min-w-0">
            <h1 id="apps-page-title" class="text-sm font-semibold">Apps</h1>
            <p class="text-[11px] text-base-content-muted">
              Conversation for this page only. The coding chat is unaffected.
            </p>
          </div>
          @if (hasConversation()) {
            <button
              type="button"
              class="btn btn-ghost btn-xs shrink-0"
              data-apps-focus-key="apps:new-conversation"
              data-testid="apps-new-conversation"
              (click)="newConversation()"
            >
              New conversation
            </button>
          }
        </header>

        <ptah-apps-transcript />

        <div
          class="border-t border-base-300 p-2 flex flex-col gap-1.5 shrink-0"
        >
          @if (session.error(); as error) {
            <div
              role="alert"
              class="flex items-start gap-2 px-2 py-1.5 rounded border-l-2 border-error bg-base-300/30 text-xs text-base-content"
              data-testid="apps-error"
            >
              <span class="flex-1">{{ error }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square shrink-0"
                aria-label="Dismiss error"
                (click)="session.clearError()"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="w-3.5 h-3.5"
                  aria-hidden="true"
                />
              </button>
            </div>
          }
          @if (session.notice(); as notice) {
            <div
              role="status"
              class="flex items-start gap-2 px-2 py-1.5 rounded border-l-2 border-warning bg-base-300/30 text-xs text-base-content"
              data-testid="apps-conversation-notice"
            >
              <span class="flex-1">{{ notice }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square shrink-0"
                aria-label="Dismiss notice"
                (click)="session.clearNotice()"
              >
                <lucide-angular
                  [img]="XIcon"
                  class="w-3.5 h-3.5"
                  aria-hidden="true"
                />
              </button>
            </div>
          }
          <textarea
            class="textarea textarea-bordered w-full text-sm resize-none"
            rows="2"
            placeholder="Ask for a dashboard, a form, or a change…"
            aria-label="Message the Apps conversation"
            data-apps-focus-key="apps:composer"
            data-testid="apps-composer"
            [value]="draft()"
            (input)="onDraftInput($event)"
            (keydown.enter)="onEnter($event)"
          ></textarea>
          <div class="flex items-center justify-between">
            @if (hasConversation()) {
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                data-apps-focus-key="apps:stop"
                [disabled]="!session.isProcessing()"
                [attr.title]="
                  session.isProcessing() ? null : 'No turn is running right now'
                "
                (click)="stop()"
              >
                Stop
              </button>
            } @else {
              <span></span>
            }
            <button
              type="button"
              class="btn btn-primary btn-xs"
              data-apps-focus-key="apps:send"
              data-testid="apps-send"
              [disabled]="!canSend()"
              (click)="send()"
            >
              Send
            </button>
          </div>
        </div>
      </section>

      <!-- Batch 20 splitter slot: the resize handle goes here, nothing else. -->
      <div
        class="apps-split-handle-slot"
        data-testid="apps-split-handle-slot"
      ></div>

      <ptah-apps-surface-panel class="apps-surface" />
    </div>
  `,
})
export class AppsPageComponent {
  protected readonly session = inject(AppsSessionService);

  protected readonly XIcon = X;

  /** The composer's uncommitted text; see the class doc. */
  protected readonly draft = signal('');

  protected readonly hasConversation = this.session.isActive;

  protected readonly canSend = computed(
    () => this.draft().trim().length > 0 && !this.session.isProcessing(),
  );

  protected onDraftInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) this.draft.set(target.value);
  }

  /** Enter sends; Shift+Enter keeps its newline. */
  protected onEnter(event: Event): void {
    if (event instanceof KeyboardEvent && event.shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  /**
   * Send the draft as a turn (the first one starts the conversation). The
   * session never throws; a failure shows in `session.error()`, and then the
   * draft comes back so the user does not lose what they wrote.
   */
  public async send(): Promise<void> {
    const typed = this.draft();
    const prompt = typed.trim();
    if (prompt.length === 0 || this.session.isProcessing()) return;
    this.draft.set('');
    await this.session.send(prompt);
    if (this.session.error() !== null && this.draft().length === 0)
      this.draft.set(typed);
  }

  protected async stop(): Promise<void> {
    await this.session.abort();
  }

  /**
   * The session stops a running agent first and discards only the
   * conversation shown when the button was pressed; a failed stop keeps it
   * and shows a notice (`AppsSessionService.resetConversation`).
   */
  protected async newConversation(): Promise<void> {
    await this.session.resetConversation();
  }
}
