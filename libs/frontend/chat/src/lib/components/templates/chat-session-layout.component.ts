import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Bounded session column. Projected children remain in ChatView's view. */
@Component({
  selector: 'ptah-chat-session-layout',
  host: { class: 'flex flex-1 flex-col min-h-0 min-w-0 relative' },
  template: `
    <ng-content />
    <ng-content select="[sessionTranscript]" />
    <ng-content select="[sessionControls]" />
    <ng-content select="[sessionSheet]" />
    <ng-content select="[sessionComposer]" />
  `,
  styles: `
    :host(.hidden) {
      display: none;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatSessionLayoutComponent {}
