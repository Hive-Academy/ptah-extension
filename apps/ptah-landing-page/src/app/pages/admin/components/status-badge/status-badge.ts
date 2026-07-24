import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  LucideAngularModule,
  type LucideIconData,
  XCircle,
} from 'lucide-angular';

import type { BadgeVariant } from '../../admin-models.config';

/**
 * StatusBadge — presentational semantic status chip for the admin dashboard.
 *
 * The single, consistent way to render a status/enum value with color +
 * icon (design spec §7.3, §7.6). Two input modes, both dumb:
 *   1. Direct:  `[variant]="'success'"` — caller already knows the color.
 *   2. Lookup:  `[badgeMap]="field.badgeMap" [value]="row.status"` — the
 *      value is matched against a `FieldSpec.badgeMap`; an unmatched value
 *      degrades to a neutral badge instead of an invented color.
 *
 * Replaces the hardcoded `source`/`notifiedAt` badge branches previously
 * inline in `data-table.html` (data-table rewiring lands in a later batch).
 */
@Component({
  selector: 'ptah-admin-status-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  templateUrl: './status-badge.html',
})
export class StatusBadge {
  /** Direct semantic override — wins over `badgeMap` lookup when set. */
  public readonly variant = input<BadgeVariant | null>(null);

  /** Enum-value → variant map, typically `FieldSpec.badgeMap`. */
  public readonly badgeMap = input<Record<string, BadgeVariant> | undefined>(
    undefined,
  );

  /** Raw field value — used for the `badgeMap` lookup and as default label. */
  public readonly value = input<unknown>(undefined);

  /** Optional display-text override (defaults to the string form of value). */
  public readonly label = input<string | null>(null);

  /** daisyUI badge size modifier. */
  public readonly size = input<'xs' | 'sm' | 'md' | 'lg'>('sm');

  /** Whether to render the leading semantic icon. */
  public readonly showIcon = input<boolean>(true);

  /** Resolved semantic — direct variant, else map lookup, else neutral. */
  protected readonly resolvedVariant = computed<BadgeVariant>(() => {
    const direct = this.variant();
    if (direct) return direct;

    const map = this.badgeMap();
    const raw = this.value();
    if (map && raw != null) {
      return map[String(raw)] ?? 'neutral';
    }
    return 'neutral';
  });

  /** Text shown inside the badge. */
  protected readonly displayText = computed<string>(() => {
    const override = this.label();
    if (override != null) return override;

    const raw = this.value();
    if (raw == null || raw === '') return '—';
    return String(raw);
  });

  /** Full daisyUI class string — literal modifiers so Tailwind keeps them. */
  protected readonly badgeClass = computed<string>(() => {
    const variant = BADGE_MODIFIER[this.resolvedVariant()];
    const size = SIZE_MODIFIER[this.size()];
    return `badge ${variant} ${size} gap-1 whitespace-nowrap`;
  });

  /** Leading icon for the resolved semantic (design spec §7.6). */
  protected readonly icon = computed<LucideIconData>(
    () => VARIANT_ICON[this.resolvedVariant()],
  );
}

/**
 * Literal daisyUI modifier per variant — kept as full string literals (not
 * `badge-${variant}` interpolation) so Tailwind's content scanner preserves
 * every class instead of tree-shaking a dynamically-built name.
 */
const BADGE_MODIFIER: Record<BadgeVariant, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  info: 'badge-info',
  neutral: 'badge-neutral',
  ghost: 'badge-ghost',
};

const SIZE_MODIFIER: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'badge-xs',
  sm: 'badge-sm',
  md: 'badge-md',
  lg: 'badge-lg',
};

const VARIANT_ICON: Record<BadgeVariant, LucideIconData> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
  neutral: Clock,
  ghost: Clock,
};
