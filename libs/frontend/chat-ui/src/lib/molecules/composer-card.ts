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

/**
 * The main chat composer's borderless textarea: a 60 px resting field that
 * grows to 8 lines (with `style="field-sizing: content"`), then scrolls.
 */
export const COMPOSER_TEXTAREA_CLASS =
  'block w-full min-h-[60px] max-h-[calc(8lh+1rem)] overflow-y-auto resize-none bg-transparent border-0 px-3.5 pt-3 pb-1 text-[13px] leading-[1.6] text-base-content placeholder:text-base-content-muted outline-none focus:outline-none focus:ring-0 disabled:opacity-60';

/** The composer card's bottom row, which holds the send button. */
export const COMPOSER_TOOLBAR_CLASS =
  'flex items-center justify-end gap-1 px-2 pr-2.5 pb-2 min-w-0';

/** The main chat's send button: a 28 px neutral inverse circle. */
export const COMPOSER_SEND_BUTTON_CLASS =
  'inline-flex items-center justify-center h-7 w-7 flex-shrink-0 rounded-full bg-base-content text-base-100 transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]';
