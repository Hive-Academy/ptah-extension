import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  CircleX,
  Clock,
  Hourglass,
  KeyRound,
  LucideAngularModule,
  TextCursorInput,
  Unplug,
  type LucideIconData,
} from 'lucide-angular';

import type { ProviderStatus } from '../data/provider-row';

/** Colour family of a pill. Every tone is paired with an icon and a word. */
export type StatusPillTone =
  'success' | 'warning' | 'error' | 'info' | 'neutral';

/** What a status looks like: its word, its tone and its icon. */
export interface StatusPresentation {
  readonly label: string;
  readonly tone: StatusPillTone;
  readonly icon: LucideIconData;
}

/** Shown for `unknown` when the source sent no text at all. */
const UNKNOWN_LABEL = 'Unknown';

/**
 * One row per known status. `unknown` is not here: it shows the raw text the
 * source reported, in the neutral tone.
 */
const STATUS_PRESENTATION: Readonly<
  Record<Exclude<ProviderStatus, 'unknown'>, StatusPresentation>
> = {
  connected: { label: 'Connected', tone: 'success', icon: CircleCheck },
  failed: { label: 'Failed', tone: 'error', icon: CircleX },
  'needs-auth': { label: 'Needs sign-in', tone: 'warning', icon: KeyRound },
  'needs-input': {
    label: 'Needs input',
    tone: 'warning',
    icon: TextCursorInput,
  },
  pending: { label: 'Pending', tone: 'info', icon: Hourglass },
  disabled: { label: 'Disabled', tone: 'neutral', icon: CircleSlash },
  expired: { label: 'Expired', tone: 'warning', icon: Clock },
  disconnected: { label: 'Disconnected', tone: 'neutral', icon: Unplug },
  configured: { label: 'Configured', tone: 'neutral', icon: CircleDashed },
};

/** Per-tone classes, kept as whole strings so Tailwind can see them. */
const TONE_CLASSES: Readonly<Record<StatusPillTone, string>> = {
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  error: 'border-error/40 bg-error/10 text-error',
  info: 'border-info/40 bg-info/10 text-info',
  neutral: 'border-base-300 bg-base-200/60 text-base-content-muted',
};

/**
 * The word, tone and icon for a status. `unknown` shows `statusText` (the
 * source's raw value) in the neutral tone, or "Unknown" when that is blank.
 * Pure, so filters and tables can reuse the same words.
 */
export function statusPresentation(
  status: ProviderStatus,
  statusText?: string | null,
): StatusPresentation {
  if (status !== 'unknown') return STATUS_PRESENTATION[status];
  const raw = statusText?.trim() ?? '';
  return {
    label: raw.length > 0 ? raw : UNKNOWN_LABEL,
    tone: 'neutral',
    icon: CircleHelp,
  };
}

/**
 * A server's status as a small pill: an icon plus a word, never colour alone.
 *
 * Presentational: the status comes in through inputs and nothing is injected.
 * A long raw `unknown` text is truncated and kept whole in `title`.
 *
 * @example
 * ```html
 * <ptah-status-pill [status]="row.status" [statusText]="row.statusText" />
 * ```
 */
@Component({
  selector: 'ptah-status-pill',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex max-w-full' },
  template: `
    <span
      class="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4"
      [class]="toneClass()"
      [attr.data-tone]="presentation().tone"
      [attr.data-status]="status()"
      [attr.title]="presentation().label"
      data-testid="status-pill"
    >
      <lucide-angular
        [img]="presentation().icon"
        class="h-3 w-3 shrink-0"
        aria-hidden="true"
      />
      <span class="truncate" data-testid="status-pill-label">{{
        presentation().label
      }}</span>
    </span>
  `,
})
export class StatusPillComponent {
  /** The displayed status (`ProviderRow.status`). */
  public readonly status = input.required<ProviderStatus>();

  /** The raw status text; read only when `status` is `unknown`. */
  public readonly statusText = input<string | null | undefined>(undefined);

  protected readonly presentation = computed(() =>
    statusPresentation(this.status(), this.statusText()),
  );

  protected readonly toneClass = computed(
    () => TONE_CLASSES[this.presentation().tone],
  );
}
