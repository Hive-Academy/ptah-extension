/**
 * Semantic status vocabulary shared across panel surfaces.
 *
 * Lives here rather than in a consuming lib's model config because it is a
 * pure presentation contract: `StatusBadge` maps each member to a literal
 * daisyUI modifier, and both the admin and member panels resolve enum values
 * through the same six names.
 */
export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral'
  | 'ghost';
