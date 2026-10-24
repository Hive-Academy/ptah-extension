/**
 * The main chat composer's card: rounded, bordered, raised surface. Shared so
 * the lane composers (sub-agent steer / follow-up, CLI continue) look like the
 * main chat input without copying its class list. Border colours stay with
 * each caller (the main input tints them for plan and autopilot modes).
 */
export const COMPOSER_CARD_CLASS =
  'relative flex flex-col w-full mx-auto rounded-xl border bg-surface-1 shadow-[inset_0_1px_0_var(--surface-highlight),var(--elev-shadow)] transition-colors';

/** The composer card's resting border, as the main chat input uses it. */
export const COMPOSER_CARD_BORDER_CLASS =
  'border-surface-border focus-within:border-[var(--surface-border-strong)]';
