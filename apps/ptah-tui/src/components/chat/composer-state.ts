/**
 * Keyboard ownership rules for the chat composer.
 *
 * Extracted as pure functions because this workspace has no React renderer —
 * the Ink components are verified through their decision logic instead.
 *
 * The distinction that matters is between a MODAL and an inline OVERLAY:
 *
 * - A modal (permission prompt, command palette, model selector) takes over
 *   the screen. The composer blurs completely.
 * - An inline overlay (`/` commands, `@` file picker) is an autocomplete
 *   attached to what you are typing. The composer MUST keep focus so the
 *   query can be typed; the overlay only borrows Enter to commit the
 *   highlighted row.
 *
 * Collapsing those two into one boolean is what broke file search: typing `@`
 * opened the picker and simultaneously blurred the input, so no character
 * after the `@` ever reached the buffer and the only query ever issued was the
 * empty one.
 */
export interface ComposerInputState {
  readonly modalActive: boolean;
  readonly overlayActive: boolean;
  readonly isStreaming: boolean;
}

/** Whether the text input should hold focus and receive characters. */
export function isComposerFocused(state: ComposerInputState): boolean {
  return !state.isStreaming && !state.modalActive;
}

/** Whether pressing Enter in the composer should send the message. */
export function shouldComposerSubmit(state: ComposerInputState): boolean {
  // The overlay owns Enter while it is open — it commits the highlighted
  // command/file rather than sending a half-typed "@src/ma" line as chat.
  if (state.overlayActive) return false;
  return isComposerFocused(state);
}

/**
 * Whether a Ctrl/Meta chord must have its inserted character rolled back.
 *
 * `ink-text-input` early-returns only for up/down/tab/shift+tab/ctrl+c; every
 * other Ctrl chord falls through and splices its bare letter into the buffer.
 * So Ctrl+S opened Settings AND typed "s", Ctrl+K opened the palette AND typed
 * "k" — both handlers firing on one key, which is what made the shortcuts feel
 * broken.
 */
export function shouldRollBackChord(
  state: ComposerInputState,
  key: { readonly ctrl?: boolean; readonly meta?: boolean },
  input: string,
): boolean {
  if (!isComposerFocused(state)) return false;
  if (key.ctrl !== true && key.meta !== true) return false;
  return input.length > 0;
}
