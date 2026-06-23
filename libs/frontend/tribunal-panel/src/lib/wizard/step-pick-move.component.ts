import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Users, GitBranch, Trophy } from 'lucide-angular';
import type { TribunalMove } from '../types/tribunal-ui.types';

interface MoveCard {
  readonly move: TribunalMove;
  readonly title: string;
  readonly description: string;
  readonly enabled: boolean;
}

@Component({
  selector: 'ptah-step-pick-move',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-col gap-4" data-testid="tribunal-step-pick-move">
      <header class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-base-content">Pick a move</h3>
        <p class="text-sm text-base-content/55">
          Choose how the panel of vendors should work together.
        </p>
      </header>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        @for (card of cards; track card.move) {
          <button
            type="button"
            class="flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors"
            [class.border-primary]="selected() === card.move && card.enabled"
            [class.bg-primary/5]="selected() === card.move && card.enabled"
            [class.border-base-300]="selected() !== card.move || !card.enabled"
            [class.cursor-pointer]="card.enabled"
            [class.cursor-not-allowed]="!card.enabled"
            [class.opacity-50]="!card.enabled"
            [disabled]="!card.enabled"
            [attr.aria-pressed]="selected() === card.move"
            [attr.aria-label]="card.title"
            (click)="pick(card)"
          >
            <span
              class="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <lucide-angular [img]="iconFor(card.move)" class="h-5 w-5" />
            </span>
            <span class="flex items-center gap-2">
              <span class="text-sm font-semibold text-base-content">{{
                card.title
              }}</span>
              @if (!card.enabled) {
                <span
                  class="rounded-full bg-base-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-base-content/50"
                  >Coming soon</span
                >
              }
            </span>
            <span class="text-xs text-base-content/55">{{
              card.description
            }}</span>
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StepPickMoveComponent {
  readonly selected = input<TribunalMove>('council');
  readonly moveSelected = output<TribunalMove>();

  protected readonly cards: readonly MoveCard[] = [
    {
      move: 'council',
      title: 'Council',
      description:
        'Each vendor weighs in; the conductor synthesizes a single cited verdict.',
      enabled: true,
    },
    {
      move: 'forge',
      title: 'Forge',
      description:
        'Each vendor implements in its own worktree; diffs are cross-reviewed.',
      enabled: true,
    },
    {
      move: 'race',
      title: 'Race',
      description: 'Vendors compete; results are scored against a rubric.',
      enabled: true,
    },
  ];

  protected readonly UsersIcon = Users;
  protected readonly ForgeIcon = GitBranch;
  protected readonly RaceIcon = Trophy;

  protected iconFor(move: TribunalMove) {
    switch (move) {
      case 'forge':
        return this.ForgeIcon;
      case 'race':
        return this.RaceIcon;
      default:
        return this.UsersIcon;
    }
  }

  protected pick(card: MoveCard): void {
    if (!card.enabled) return;
    this.moveSelected.emit(card.move);
  }
}
