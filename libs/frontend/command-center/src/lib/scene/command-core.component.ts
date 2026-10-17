import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output } from '@angular/core';
import type { CommandVoiceState, CommandWorkNode } from '../model/command-center.store';

const TICKS = Array.from({ length: 96 }, (_, index) => index);

@Component({
  selector: 'ptah-command-core',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './command-core.component.css',
  template: `
    <div class="core">
      <div data-core-dial class="dial" [attr.data-voice]="voiceState()"
        [class.is-paused]="reducedMotion() || visibilityPaused()"
        [style.--voice-scale]="voiceScale()">
        <svg class="ticks" viewBox="0 0 300 300" aria-hidden="true">
          @for (tick of ticks; track tick) {
            <line x1="150" y1="1" x2="150" [attr.y2]="tick % 8 === 0 ? 12 : 7"
              [attr.transform]="'rotate(' + tick * 3.75 + ' 150 150)'"
              [class.major]="tick % 8 === 0" />
          }
        </svg>
        <span class="voice-ring" aria-hidden="true"></span>
        @if (root(); as rootNode) {
          <button type="button" class="root-button"
            [attr.data-core-root-id]="rootNode.id"
            [attr.aria-label]="rootNode.label + ' root session, ' + rootNode.state + ', ' + activeCount() + ' active delegated work, voice ' + voiceState()"
            [attr.aria-pressed]="pinnedId() === rootNode.id"
            [attr.aria-describedby]="activeId() === rootNode.id && pinnedId() !== rootNode.id ? 'command-plate' : null"
            [attr.aria-expanded]="pinnedId() === rootNode.id ? 'true' : null"
            [attr.aria-controls]="pinnedId() === rootNode.id ? 'command-plate' : null"
            (pointerenter)="hoverRoot.emit(rootNode.id)"
            (pointerleave)="hoverRoot.emit(null)"
            (focus)="hoverRoot.emit(rootNode.id)"
            (blur)="hoverRoot.emit(null)"
            (click)="activateRoot.emit(rootNode.id)"
            (keydown.escape)="onEscape($event, rootNode.id)">
            <span class="brand">PTAH</span>
            <span class="count">{{ activeCount() }}</span>
            <span class="unit">active delegated work</span>
            <span class="session">{{ rootNode.label }} · {{ rootNode.state }}</span>
            <span class="voice-caption">Voice · {{ voiceState() }}</span>
          </button>
        } @else {
          <div class="root-empty" aria-label="No root session">
            <span class="brand">PTAH</span><span class="count">0</span>
            <span class="unit">active delegated work</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class CommandCoreComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  public measurementElements(): { dial: HTMLElement | null; root: HTMLElement | null } {
    return {
      dial: this.host.nativeElement.querySelector<HTMLElement>('[data-core-dial]'),
      root: this.host.nativeElement.querySelector<HTMLElement>('[data-core-root-id]'),
    };
  }
  public readonly root = input<CommandWorkNode | null>(null);
  public readonly activeCount = input(0);
  public readonly voiceState = input<CommandVoiceState>('idle');
  public readonly inputLevel = input(0);
  public readonly outputLevel = input(0);
  public readonly reducedMotion = input(false);
  public readonly visibilityPaused = input(false);
  public readonly activeId = input<string | null>(null);
  public readonly pinnedId = input<string | null>(null);

  public readonly activateRoot = output<string>();
  public readonly hoverRoot = output<string | null>();
  public readonly escapeRoot = output<string>();
  public readonly ticks = TICKS;

  public readonly voiceScale = computed(() => {
    if (this.reducedMotion() || this.visibilityPaused()) return 1;
    const state = this.voiceState();
    if (state !== 'listening' && state !== 'speaking') return 1;
    const level = state === 'listening' ? this.inputLevel() : this.outputLevel();
    return 1 + 0.025 * Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  });

  public onEscape(event: Event, id: string): void {
    event.stopPropagation();
    this.escapeRoot.emit(id);
  }
}
