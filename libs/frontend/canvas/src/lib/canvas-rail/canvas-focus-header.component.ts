import { ChangeDetectionStrategy, Component, DoCheck, ElementRef, inject, input, output, signal } from '@angular/core';
import { SendToMessagingComponent } from '@ptah-extension/chat';
import type { CompactRailState } from '@ptah-extension/chat-ui';
import type { TabViewMode } from '@ptah-extension/chat-types';

@Component({
  selector: 'ptah-canvas-focus-header',
  standalone: true,
  imports: [SendToMessagingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .state-running { color: var(--state-ink-run, oklch(var(--in))); }
    .state-needs { color: var(--state-ink-need, oklch(var(--wa))); }
    .state-error { color: var(--state-ink-err, oklch(var(--er))); }
    .state-done { color: var(--state-ink-done, oklch(var(--su))); }
    .state-idle { color: var(--state-ink-idle, oklch(var(--bc))); }
  `],
  template: `
    <header class="relative flex h-12 min-w-0 items-center gap-2 overflow-visible border-b border-base-content/10 bg-base-100 px-3 whitespace-nowrap">
      <strong class="min-w-0 flex-1 truncate text-sm" [title]="title()">{{ title() }}</strong>
      @if (branch()) { <span class="max-w-[170px] truncate rounded bg-base-200 px-1.5 text-xs" [title]="branch()!">{{ branch() }}</span> }
      @if (band() === 'xl' || band() === 'lg') { @if (model()) { <span class="truncate rounded bg-base-200 px-1.5 text-xs">{{ model() }}</span> } }
      <span class="rounded bg-base-200 px-1.5 text-xs" [class.state-running]="state() === 'running'"
        [class.state-needs]="state() === 'needs'" [class.state-error]="state() === 'error'"
        [class.state-done]="state() === 'done'" [class.state-idle]="state() === 'idle'">{{ state() }}</span>
      @if (running()) {
        <button type="button" class="btn btn-ghost btn-xs" data-stop aria-label="Stop session" title="Stop session"
          (click)="stop.emit()">■ @if (!narrow()) { Stop }</button>
      }
      <button type="button" class="btn btn-ghost btn-xs" data-compact
        [attr.aria-label]="viewMode() === 'full' ? 'Switch to compact view' : 'Switch to full view'"
        [attr.title]="viewMode() === 'full' ? 'Switch to compact view' : 'Switch to full view'"
        (click)="toggleViewMode.emit()">▣ @if (!narrow()) { {{ viewMode() === 'full' ? 'Compact' : 'Full' }} }</button>
      <button #overflow type="button" class="btn btn-ghost btn-xs" aria-label="More session actions" title="More session actions"
        aria-haspopup="menu" [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())">⋯</button>
      <button type="button" class="btn btn-ghost btn-xs" aria-label="Close session" title="Close session"
        (click)="closeRequested.emit()">× @if (!narrow()) { Close }</button>
      @if (menuOpen()) {
        <div role="menu" aria-label="Session actions" class="absolute right-10 top-10 z-20 rounded-lg border border-base-content/10 bg-base-200 p-2 shadow-lg"
          (keydown.escape)="closeMenu($event)">
          <div role="menuitem"><ptah-send-to-messaging [tabId]="tabId()" /></div>
        </div>
      }
    </header>
  `,
})
export class CanvasFocusHeaderComponent implements DoCheck {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly tabId = input.required<string>();
  readonly title = input('');
  readonly branch = input<string | null>(null);
  readonly model = input<string | null>(null);
  readonly state = input<CompactRailState>('idle');
  readonly running = input(false);
  readonly viewMode = input<TabViewMode>('full');
  readonly band = input<'xl' | 'lg' | 'md' | 'sm'>('lg');
  readonly stop = output<void>();
  readonly toggleViewMode = output<void>();
  readonly closeRequested = output<void>();
  readonly menuOpen = signal(false);
  readonly narrow = () => this.band() === 'md' || this.band() === 'sm';
  private wasRunning = false;

  ngDoCheck(): void {
    if (this.wasRunning && !this.running()) {
      const stop = this.host.nativeElement.querySelector<HTMLElement>('[data-stop]');
      if (stop && stop === stop.ownerDocument.activeElement)
        this.host.nativeElement.querySelector<HTMLElement>('[data-compact]')?.focus();
    }
    this.wasRunning = this.running();
  }

  closeMenu(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.menuOpen.set(false);
    this.host.nativeElement.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
  }
}
