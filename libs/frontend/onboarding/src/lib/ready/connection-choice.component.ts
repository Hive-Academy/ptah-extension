import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Code, Terminal, LucideAngularModule } from 'lucide-angular';
import type { ProviderKind } from './provider-readiness.derive';
import { ConnectionChoiceStore } from './connection-choice.store';

@Component({
  selector: 'ptah-connection-choice', standalone: true,
  imports: [RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <fieldset class="block" [attr.aria-busy]="store.saved().kind === 'loading' || store.phase() === 'saving'">
      <legend id="connection-choice-label" class="font-semibold">Main connection</legend>
      <p id="connection-choice-help" class="mt-1 text-sm text-base-content-muted">
        @if (store.saved().kind === 'other') {
          Your main connection is {{ store.name() }}. Claude Code and Codex below are for information. Choose one to switch.
        } @else {
          Ptah uses this for chat and agents. The other one is optional. You can change this later in Providers.
        }
      </p>
      @if (store.saved().kind === 'loading') {
        <div class="mt-3 grid grid-cols-2 gap-3 max-[480px]:grid-cols-1" role="status">
          <span class="sr-only">Loading your saved connection</span>
          <div class="h-20 animate-pulse rounded-[14px] bg-base-200"></div>
          <div class="h-20 animate-pulse rounded-[14px] bg-base-200"></div>
        </div>
      } @else {
        <div role="radiogroup" aria-labelledby="connection-choice-label" aria-describedby="connection-choice-help"
          class="mt-3 grid grid-cols-2 gap-3 max-[480px]:grid-cols-1" data-testid="connection-choice-cards">
          @for (card of cards; track card.id) {
            <label class="flex cursor-pointer items-center gap-3 rounded-[14px] border bg-base-200 px-4 py-3 focus-within:ring-2 focus-within:ring-base-content focus-within:ring-offset-2"
              [class.border-primary]="selected() === card.id" [class.border-base-300]="selected() !== card.id"
              [attr.aria-disabled]="store.phase() === 'saving'">
              <input type="radio" class="radio radio-primary" name="main-connection" [value]="card.id"
                [checked]="selected() === card.id" [disabled]="store.phase() === 'saving'"
                (change)="store.choose(card.id)" />
              <lucide-angular [img]="card.icon" class="size-5" aria-hidden="true" />
              <span><strong class="block font-semibold">{{ card.name }}</strong>
                <span class="text-[13px] text-base-content-muted">{{ card.description }}</span></span>
            </label>
          }
        </div>
      }
    </fieldset>
    @if (store.changed()) {
      <div role="group" aria-label="Confirm main connection change" class="mt-3 rounded-xl border border-primary bg-base-100 p-3 text-sm">
        <p class="font-semibold">Use {{ store.nameForPending() }} as your main connection?</p>
        <p>This ends running chat sessions {{ store.target() === 'workspace' ? 'in this workspace' : 'in every workspace' }}.</p>
        <p class="text-base-content-muted">Saved to: {{ store.target() === 'workspace' ? 'This workspace' : 'Every workspace' }}.</p>
        @if (!store.canConfirm()) { <p role="status">Where to save is not loaded yet. You cannot change the connection until it loads.</p> }
        @if (store.phase() === 'saving') { <p role="status">Saving your main connection...</p> }
        <div class="mt-3 flex gap-2">
          <button type="button" class="btn btn-primary btn-sm" [attr.aria-disabled]="!store.canConfirm() || store.phase() === 'saving'"
            (click)="save()">{{ store.phase() === 'saving' ? 'Saving...' : 'Use ' + store.nameForPending() }}</button>
          <button type="button" class="btn btn-ghost btn-sm" (click)="cancel()">Cancel</button>
        </div>
      </div>
    }
    @if (store.notice(); as notice) {
      <div #noticeElement class="mt-3 rounded-xl border border-base-300 px-3.5 py-2.5 text-sm"
        [attr.role]="notice === 9 || notice === 10 || notice === 11 || notice === 12 ? 'alert' : null"
        [attr.aria-live]="notice === 9 || notice === 10 || notice === 11 || notice === 12 ? null : 'polite'"
        tabindex="-1" data-testid="connection-choice-notice">
        @switch (notice) {
          @case (6) { Saved. {{ store.name() }} is your main connection. }
          @case (7) { Saved. {{ store.name() }} is your main connection. Some settings could not be refreshed. Press Re-check to read them again. }
          @case (8) { Another save is in progress. Try again in a moment. }
          @case (9) { Not saved. Your main connection is still {{ store.name() }}. You can try again. }
          @case (10) { Ptah could not confirm the change, so it may not be in effect yet. Showing the connection that is saved now. <a routerLink="/settings/providers" class="link">Open Providers</a> }
          @case (11) { Saved, status not confirmed. Your change was saved, but Ptah could not confirm the saved connection. Nothing is selected until it can. <button type="button" class="btn btn-outline btn-sm" (click)="retry()">Try again</button> <a routerLink="/settings/providers" class="link">Open Providers</a> }
          @case (12) { Ptah could not read your saved connection. <button type="button" class="btn btn-outline btn-sm" (click)="retry()">Try again</button> }
        }
      </div>
    } @else if (store.saved().kind === 'unreadable') {
      <div role="alert" class="mt-3 rounded-xl border border-base-300 p-3">Ptah could not read your saved connection.
        <button type="button" class="btn btn-outline btn-sm" (click)="retry()">Try again</button></div>
    } @else if (store.saved().kind === 'other') {
      <p class="mt-3 text-sm" aria-live="polite">You can manage {{ store.name() }} in Providers.
        <a routerLink="/settings/providers" class="link">Open Providers</a></p>
    }
  `,
})
export class ConnectionChoiceComponent {
  readonly store = inject(ConnectionChoiceStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly cards = [
    { id: 'claude-cli' as ProviderKind, name: 'Claude Code', description: "Anthropic's coding agent", icon: Terminal },
    { id: 'openai-codex' as ProviderKind, name: 'Codex', description: "OpenAI's coding agent", icon: Code },
  ];
  protected readonly selected = computed(() => this.store.pending() ??
    (this.store.saved().kind === 'claude-cli' || this.store.saved().kind === 'openai-codex' ? this.store.saved().kind : null));
  protected async save(): Promise<void> {
    if (!this.store.canConfirm()) return;
    await this.store.confirm();
    this.focusRadioAfterRender();
  }
  protected cancel(): void {
    this.store.cancel();
    this.focusRadioAfterRender();
  }
  protected async retry(): Promise<void> {
    await this.store.retry();
    this.focusRadioAfterRender();
  }
  private focusRadioAfterRender(): void {
    afterNextRender(() => {
      const host = this.host.nativeElement;
      (host.querySelector<HTMLInputElement>('input[type="radio"]:checked') ??
        host.querySelector<HTMLInputElement>('input[type="radio"]'))?.focus();
    }, { injector: this.injector });
  }
}
