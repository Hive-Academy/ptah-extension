import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  LoaderCircle,
  LucideAngularModule,
  MessageCircleQuestion,
} from 'lucide-angular';
import type { CommandWorkState } from '../model/command-center.store';
import type { OverflowCounts, PlacedNode } from './scene-placement';

@Component({
  selector: 'ptah-command-streams',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './command-streams.component.css',
  template: `
    <section class="streams" aria-label="Work streams">
      <div class="stream-viewport" data-stream-viewport (scroll)="measureRequested.emit()">
        @for (node of placed(); track node.id; let index = $index) {
          <div class="stream-entry" [class.is-satellite]="node.kind === 'lane'">
            <button
              type="button"
              class="stream-row"
              [attr.data-stream-row-id]="node.id"
              [attr.data-state]="node.state"
              [attr.aria-label]="rowLabel(node)"
              [attr.aria-pressed]="selectedId() === node.id"
              [attr.aria-describedby]="activeId() === node.id && pinnedId() !== node.id ? 'command-plate' : null"
              [attr.aria-expanded]="pinnedId() === node.id ? 'true' : null"
              [attr.tabindex]="index === rovingIndex() ? 0 : -1"
              (click)="activate.emit(node.id)"
              (mouseenter)="hover.emit(node.id)"
              (mouseleave)="hover.emit(null)"
              (focus)="onFocus(node.id)"
              (blur)="hover.emit(null)"
              (keydown)="onKeydown($event, index, node.id)"
            >
              <span class="provider-monogram" aria-hidden="true">{{ monogram(node.providerId) }}</span>
              <span class="stream-text">
                <span class="stream-name">{{ node.label }}</span>
                <span class="stream-sub">
                  <span class="provider-name">{{ providerName(node.providerId) }}</span>
                  <span aria-hidden="true"> · </span>
                  <span class="state-word">{{ node.state }}</span>
                </span>
              </span>
              @if (node.kind === 'tribunal') {
                <span class="tribunal-progress" [style.--progress]="phaseProgress(node)" aria-hidden="true">
                  <span class="tribunal-arc"></span>
                  <span>{{ completedPhases(node) }}/{{ node.phases.length }}</span>
                </span>
              }
              <span class="state-icon" aria-hidden="true" [class.is-static]="reducedMotion()">
                <lucide-icon [img]="stateIcon(node.state)" [size]="16" [strokeWidth]="2" />
              </span>
              @if (age(node.updatedAt); as ageText) {
                <span class="stream-age">{{ ageText }}</span>
              }
            </button>
            @if (pinnedId() === node.id && inlineSlotHeight() > 0) {
              <div class="plate-slot" [attr.data-plate-slot-id]="node.id" [style.height.px]="inlineSlotHeight()" aria-hidden="true"></div>
            }
          </div>
        }
      </div>
      <button type="button" class="view-all" (click)="focusWorkList.emit(selectedId() ?? '')">
        @if (overflow().completed) { <span>+{{ overflow().completed }} completed · </span> }
        @if (overflow().other) { <span>+{{ overflow().other }} more · </span> }
        View all work
      </button>
    </section>
  `,
})
export class CommandStreamsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  public readonly placed = input.required<readonly PlacedNode[]>();
  public readonly selectedId = input<string | null>(null);
  public readonly activeId = input<string | null>(null);
  public readonly pinnedId = input<string | null>(null);
  public readonly overflow = input.required<OverflowCounts>();
  public readonly inlineSlotHeight = input(0);
  public readonly reducedMotion = input(false);
  public readonly activate = output<string>();
  public readonly hover = output<string | null>();
  public readonly escape = output<string>();
  public readonly focusWorkList = output<string>();
  public readonly measureRequested = output<void>();
  private readonly rovingId = signal<string | null>(null);
  public readonly rovingIndex = computed(() => {
    const index = this.placed().findIndex((node) => node.id === this.rovingId());
    return index < 0 ? 0 : index;
  });

  public readonly CircleCheck = CircleCheck;
  public readonly CircleX = CircleX;
  public readonly Ban = Ban;
  public readonly MessageCircleQuestion = MessageCircleQuestion;
  public readonly LoaderCircle = LoaderCircle;
  public readonly CircleDashed = CircleDashed;

  public stateIcon(state: CommandWorkState) {
    switch (state) {
      case 'completed': return this.CircleCheck;
      case 'failed': return this.CircleX;
      case 'cancelled': return this.Ban;
      case 'awaiting input': return this.MessageCircleQuestion;
      case 'starting':
      case 'running': return this.LoaderCircle;
      default: return this.CircleDashed;
    }
  }

  public providerName(id: string | null): string {
    if (!id || id.toLowerCase() === 'unknown') return 'Session';
    return id.replace(/[-_ ]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  public monogram(id: string | null): string {
    return this.providerName(id).split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase();
  }

  public completedPhases(node: PlacedNode): number {
    return node.phases.filter((phase) => phase.state === 'completed').length;
  }

  public phaseProgress(node: PlacedNode): string {
    return `${node.phases.length ? this.completedPhases(node) / node.phases.length * 100 : 0}%`;
  }

  public rowLabel(node: PlacedNode): string {
    const phaseText = node.kind === 'tribunal'
      ? `, ${this.completedPhases(node)} of ${node.phases.length} phases complete`
      : '';
    return `${node.label}, ${node.kind}, ${this.providerName(node.providerId)}, ${node.state}${phaseText}`;
  }

  public age(updatedAt?: number): string | null {
    if (updatedAt === undefined || !Number.isFinite(updatedAt)) return null;
    const minutes = Math.max(0, Math.floor((Date.now() - updatedAt) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  }

  public onFocus(id: string): void {
    this.rovingId.set(id);
    this.hover.emit(id);
    this.measureRequested.emit();
  }

  public onKeydown(event: KeyboardEvent, index: number, id: string): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.escape.emit(id);
      return;
    }
    const count = this.placed().length;
    if (!count) return;
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (index + 1) % count; break;
      case 'ArrowUp': next = (index - 1 + count) % count; break;
      case 'Home': next = 0; break;
      case 'End': next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    const buttons = this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[data-stream-row-id]');
    buttons[next]?.focus();
  }
}
