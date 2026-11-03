import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';

import {
  LAUNCHER_IDS,
  PROMPT_CATALOGUE,
  type LauncherId,
  type PromptCategory,
} from '../setup-plugins/prompt-catalogue';

/** One empty-chat launcher: a category and the prompt it prefills. */
export interface PromptLauncher {
  readonly id: LauncherId;
  readonly label: string;
  readonly icon: LucideIconData;
  /** The prompt text emitted on activation (D19: the first catalogue prompt of the category). */
  readonly text: string;
}

/**
 * Builds the launchers from the catalogue (D19): one per `LAUNCHER_IDS`
 * category, in that order, with the category's label and icon and its first
 * prompt as text. A category that is missing or has no prompts is skipped.
 * Pure; the parameters exist for tests.
 */
export function buildLaunchers(
  catalogue: readonly PromptCategory[] = PROMPT_CATALOGUE,
  ids: readonly LauncherId[] = LAUNCHER_IDS,
): PromptLauncher[] {
  const launchers: PromptLauncher[] = [];
  for (const id of ids) {
    const category = catalogue.find((c) => c.id === id);
    const first = category?.prompts[0];
    if (!category || !first) continue;
    launchers.push({
      id,
      label: category.label,
      icon: category.icon,
      text: first.text,
    });
  }
  return launchers;
}

/**
 * PromptLaunchersComponent — the empty-chat launcher row: round gold icon
 * buttons with a word under each (Build, Fix, Review, Explore on screen 03).
 *
 * Activating a launcher emits its prompt `text`; the parent prefills the
 * composer with it. Each button is named by its visible word and describes
 * the prompt in its tooltip. The row is a labelled group.
 */
@Component({
  selector: 'ptah-prompt-launchers',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group', 'aria-label': 'Start with a prompt' },
  template: `
    @for (launcher of launchers(); track launcher.id) {
      <button
        type="button"
        class="ptah-launcher"
        [attr.data-launcher]="launcher.id"
        [title]="launcher.text"
        (click)="launch.emit(launcher.text)"
      >
        <span class="ptah-launcher__icon" aria-hidden="true">
          <lucide-angular [img]="launcher.icon" [size]="20" />
        </span>
        <span class="ptah-launcher__label">{{ launcher.label }}</span>
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 44px;
      }
      @media (max-width: 1000px) {
        :host {
          gap: 28px;
        }
      }
      .ptah-launcher {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--ptah-launcher-gap, 10px);
        padding: 0;
        border: 0;
        background: none;
        color: oklch(var(--bc) / 0.78);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border-radius: 12px;
      }
      .ptah-launcher:hover {
        color: oklch(var(--bc));
      }
      .ptah-launcher:focus-visible {
        outline: 2px solid oklch(var(--p));
        outline-offset: 3px;
      }
      .ptah-launcher__icon {
        display: grid;
        place-items: center;
        width: 52px;
        height: 52px;
        border-radius: 50%;
        color: oklch(var(--p));
        background: oklch(var(--bc) / 0.06);
        box-shadow: inset 0 0 0 1px oklch(var(--bc) / 0.1);
      }
      .ptah-launcher:hover .ptah-launcher__icon {
        background: oklch(var(--bc) / 0.1);
      }
      @media (prefers-reduced-motion: no-preference) {
        .ptah-launcher__icon {
          transition:
            transform 150ms ease-out,
            opacity 150ms ease-out;
        }
        .ptah-launcher:hover .ptah-launcher__icon {
          transform: translateY(-2px);
        }
      }
    `,
  ],
})
export class PromptLaunchersComponent {
  readonly launchers = input.required<readonly PromptLauncher[]>();

  /** Emits the prompt text of the activated launcher. */
  readonly launch = output<string>();
}
