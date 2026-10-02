import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { GitConflictKind, GitFileStatus } from '@ptah-extension/shared';

/** A git file status code, as the backend reports it. */
export type FileStatusCode = GitFileStatus['status'];

interface StatusPresentation {
  /** The single glyph the chip draws. */
  readonly letter: string;
  /** The full word, used as accessible name and tooltip. */
  readonly label: string;
  /** The 2 px accent border. Decoration only: the letter carries the meaning. */
  readonly accentClass: string;
}

/**
 * Letters follow VS Code: untracked is `U`, so a conflict is `!` and an
 * ignored entry is `I`. Accent classes are literal so Tailwind's content scan
 * emits them.
 */
const STATUS_PRESENTATION: Readonly<
  Record<FileStatusCode, StatusPresentation>
> = {
  M: { letter: 'M', label: 'Modified', accentClass: 'border-l-warning' },
  A: { letter: 'A', label: 'Added', accentClass: 'border-l-success' },
  D: { letter: 'D', label: 'Deleted', accentClass: 'border-l-error' },
  R: { letter: 'R', label: 'Renamed', accentClass: 'border-l-secondary' },
  C: { letter: 'C', label: 'Copied', accentClass: 'border-l-secondary' },
  U: { letter: '!', label: 'Conflicted', accentClass: 'border-l-error' },
  T: { letter: 'T', label: 'Type changed', accentClass: 'border-l-warning' },
  '??': { letter: 'U', label: 'Untracked', accentClass: 'border-l-info' },
  '!': {
    letter: 'I',
    label: 'Ignored',
    accentClass: 'border-l-base-content-muted',
  },
};

/** How a conflict is described after "Conflicted". `content` adds nothing. */
const CONFLICT_DETAIL: Readonly<Record<GitConflictKind, string | null>> = {
  content: null,
  'delete-modify': 'deleted on one side',
  'add-add': 'added on both sides',
  symlink: 'symlink',
  submodule: 'submodule',
};

/** Shown for a status code a newer backend sends that this build does not know. */
const UNKNOWN_PRESENTATION: StatusPresentation = {
  letter: '?',
  label: 'Unknown status',
  accentClass: 'border-l-base-content-muted',
};

/**
 * Chip chrome. Contrast comes from `text-base-content` on `bg-base-300`, the
 * pair `apps/ptah-extension-webview/src/app/status-badge-contrast.spec.ts`
 * gates at 4.5:1 in every picker theme, so the letter never depends on the hue.
 */
const CHIP_CLASS =
  'inline-flex shrink-0 items-center justify-center h-4 min-w-4 px-1 rounded-sm ' +
  'border-l-2 bg-base-300 text-base-content font-mono text-[10px] ' +
  'font-semibold leading-none select-none';

/**
 * The single-letter git file-status chip (A/M/D/R/C/T, `U` untracked, `!`
 * conflicted, `I` ignored) every git surface renders. A neutral chip with a
 * status-hue accent (TASK_2026_576 Gate 2, Clarification 1 (a)), so it holds
 * WCAG AA in all 34 themes without per-theme overrides.
 */
@Component({
  selector: 'ptah-file-status-badge',
  standalone: true,
  template: `{{ presentation().letter }}`,
  host: {
    role: 'img',
    'data-testid': 'file-status-badge',
    '[class]': 'hostClass()',
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileStatusBadgeComponent {
  readonly status = input.required<FileStatusCode>();
  /** How a `U` entry conflicts. Ignored for every other status. */
  readonly conflictKind = input<GitConflictKind | undefined>(undefined);

  protected readonly presentation = computed<StatusPresentation>(
    () => STATUS_PRESENTATION[this.status()] ?? UNKNOWN_PRESENTATION,
  );

  protected readonly hostClass = computed(
    () => `${CHIP_CLASS} ${this.presentation().accentClass}`,
  );

  protected readonly label = computed(() => {
    const base = this.presentation().label;
    const kind = this.conflictKind();
    if (this.status() !== 'U' || kind === undefined) return base;
    const detail = CONFLICT_DETAIL[kind];
    return detail ? `${base} (${detail})` : base;
  });
}
