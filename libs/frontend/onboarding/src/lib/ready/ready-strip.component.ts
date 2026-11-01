import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  Check,
  Loader,
  LucideAngularModule,
  PlugZap,
  Route,
  Terminal,
  TriangleAlert,
  type LucideIconData,
} from 'lucide-angular';
import type { ClaudeReadinessState } from './claude-readiness.store';
import type { ReadyStripSettingsWord } from './ready-strip-state';

/** How a strip item's marker reads: status survives without colour. */
export type ReadyStripMarker = 'done' | 'need' | 'checking' | 'idle';

interface ReadyStripItem {
  readonly step: 1 | 2 | 3;
  readonly label: string;
  readonly word: string;
  readonly marker: ReadyStripMarker;
  readonly icon: LucideIconData;
  readonly current: boolean;
}

const CLAUDE_WORDS: Record<ClaudeReadinessState, string> = {
  checking: 'Checking',
  ready: 'Ready',
  missing: 'Needs install',
  'signed-out': 'Needs sign-in',
  error: 'Could not check',
};

const CLAUDE_MARKERS: Record<ClaudeReadinessState, ReadyStripMarker> = {
  checking: 'checking',
  ready: 'done',
  missing: 'need',
  'signed-out': 'need',
  error: 'need',
};

const SETTINGS_WORDS: Record<ReadyStripSettingsWord, string> = {
  next: 'Next',
  done: 'Done',
  skipped: 'Skipped',
};

const MARKER_RING: Record<ReadyStripMarker, string> = {
  done: 'border-state-done text-state-done',
  need: 'border-state-need text-state-need',
  checking: 'border-base-300 text-base-content',
  idle: 'border-base-300 text-base-content-muted',
};

const BADGE: Record<ReadyStripMarker, string> = {
  done: 'bg-state-done text-base-100',
  need: 'bg-state-need text-base-100',
  checking: 'bg-base-300 text-base-content',
  idle: '',
};

/**
 * The Get ready progress strip (spec §12.6): three labelled items with real
 * state words. Not a lock and not links; purely presentational.
 */
@Component({
  selector: 'ptah-ready-strip',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <ol
      aria-label="Setup progress"
      class="flex flex-wrap items-center gap-2"
      data-testid="ready-strip"
    >
      @for (item of items(); track item.step) {
        <li
          class="flex items-center gap-2.5 rounded-full px-2.5 py-1.5"
          [class.border]="item.current"
          [class.border-primary]="item.current"
          [attr.data-glass-surface]="item.current ? 'chrome' : null"
          [attr.aria-current]="item.current ? 'step' : null"
          [attr.data-step]="item.step"
          [attr.data-marker]="item.marker"
        >
          <span
            class="relative grid size-6 flex-none place-items-center rounded-full border-2"
            [class]="
              item.current
                ? 'ring-2 ring-primary ring-offset-1 ring-offset-base-100 ' +
                  ring(item.marker)
                : ring(item.marker)
            "
            data-testid="ready-strip-marker"
            aria-hidden="true"
          >
            <lucide-angular
              [img]="item.icon"
              class="size-3.5"
              aria-hidden="true"
            />
            @if (item.marker !== 'idle') {
              <span
                class="absolute -right-1.5 -top-1.5 grid size-[17px] place-items-center rounded-full"
                [class]="badge(item.marker)"
              >
                <lucide-angular
                  [img]="badgeIcon(item.marker)"
                  [strokeWidth]="3"
                  [class]="
                    item.marker === 'checking'
                      ? 'size-2.5 animate-spin'
                      : 'size-2.5'
                  "
                  aria-hidden="true"
                />
              </span>
            }
          </span>
          <span
            class="flex flex-col leading-tight"
            [class]="item.current ? '' : 'max-[720px]:sr-only'"
            data-testid="ready-strip-text"
          >
            <span class="text-sm font-medium"
              >{{ item.step }} {{ item.label }}</span
            >
            <span class="text-xs text-base-content-muted">{{ item.word }}</span>
          </span>
        </li>
      }
    </ol>
  `,
})
export class ReadyStripComponent {
  readonly current = input.required<1 | 2 | 3>();
  readonly claude = input.required<ClaudeReadinessState>();
  readonly settings = input.required<ReadyStripSettingsWord>();

  protected readonly items = computed<readonly ReadyStripItem[]>(() => {
    const current = this.current();
    const settings = this.settings();
    return [
      {
        step: 1,
        label: 'Claude Code',
        word: CLAUDE_WORDS[this.claude()],
        marker: CLAUDE_MARKERS[this.claude()],
        icon: Terminal,
        current: current === 1,
      },
      {
        step: 2,
        label: 'Providers and tools',
        word: SETTINGS_WORDS[settings],
        marker: settings === 'done' ? 'done' : 'idle',
        icon: PlugZap,
        current: current === 2,
      },
      {
        step: 3,
        label: 'Choose a path',
        word: 'Next',
        marker: 'idle',
        icon: Route,
        current: current === 3,
      },
    ];
  });

  protected ring(marker: ReadyStripMarker): string {
    return MARKER_RING[marker];
  }

  protected badge(marker: ReadyStripMarker): string {
    return BADGE[marker];
  }

  protected badgeIcon(marker: ReadyStripMarker): LucideIconData {
    if (marker === 'done') return Check;
    if (marker === 'need') return TriangleAlert;
    return Loader;
  }
}
