import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import type { BadgeVariant } from '../badge-variant';

/**
 * TagChip — a small, non-semantic label: a category name, a cohort key, a
 * visibility marker, a topic tag (plan §5.3, R9.7).
 *
 * ⚠️ IT IS NOT `StatusBadge` AND THE DIFFERENCE IS THE ICON. `StatusBadge`
 * renders a leading semantic glyph because it says something is succeeding,
 * warning or failing; a category name is not a status and a checkmark beside
 * "Announcements" would read as one. This component is deliberately the
 * icon-less half of that pair rather than `StatusBadge` with `showIcon` bound to
 * `false` at every call site — the intent then lives in the caller, and one
 * missed binding puts a clock icon on a tag.
 *
 * ⚠️ IT REUSES {@link BadgeVariant} RATHER THAN DECLARING A SECOND VOCABULARY.
 * Six names already exist and both panels resolve enum values through them. A
 * parallel `TagVariant` union would be a second thing to keep in step and the
 * two would disagree the first time either grew a member.
 *
 * Presentational only — no output, no injected service.
 *
 * NFR-U2: the modifiers below are full string literals, not
 * `` `badge-${variant}` `` interpolation, so Tailwind's content scanner
 * preserves each class instead of tree-shaking a dynamically-built name — the
 * same reason `status-badge.ts` writes them out. This file is OUTSIDE the Task
 * 4.7 lint rule's `libs/web/members/**` scope; token discipline here is manual.
 */
@Component({
  selector: 'ptah-tag-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tag-chip.html',
})
export class TagChip {
  /** The text in the chip. */
  public readonly label = input.required<string>();

  /**
   * Defaults to `'ghost'` — a tag is decoration until a caller says otherwise,
   * and `'neutral'` renders as a filled chip that competes with the row title.
   */
  public readonly variant = input<BadgeVariant>('ghost');

  /** daisyUI size modifier. `xs` is the metadata-line size. */
  public readonly size = input<'xs' | 'sm' | 'md'>('xs');

  protected readonly chipClass = computed<string>(
    () =>
      `badge ${BADGE_MODIFIER[this.variant()]} ${SIZE_MODIFIER[this.size()]} whitespace-nowrap`,
  );
}

/** Literal daisyUI modifiers — see the NFR-U2 note in the class docblock. */
const BADGE_MODIFIER: Record<BadgeVariant, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  info: 'badge-info',
  neutral: 'badge-neutral',
  ghost: 'badge-ghost',
};

const SIZE_MODIFIER: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'badge-xs',
  sm: 'badge-sm',
  md: 'badge-md',
};
