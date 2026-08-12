/**
 * Reassembles an Alt chord that arrived as two keypresses instead of one.
 *
 * ## The problem
 *
 * `Alt+<key>` is two bytes on the wire: `ESC` then the key. Ink joins them into
 * a single `{ meta: true, input: '<key>' }` keypress only while both bytes are
 * still in flight — `ink/components/App` arms a 20ms timer on a dangling `ESC`
 * and, when it fires, emits that `ESC` on its own and whatever follows as a
 * plain character.
 *
 * Twenty milliseconds is not a lot. Two bytes written together usually arrive
 * together, but they do NOT have to: ConPTY relays keystrokes in its own
 * chunks, and a busy event loop is enough on its own, because Node runs the
 * timers phase before the poll phase — so once the flush timer is armed and the
 * loop stalls (a repaint during a streaming turn will do it), the timer wins the
 * race against the byte that was already sitting in the pipe.
 *
 * What the user sees when that happens is the whole defect: `Alt+L` puts a
 * literal `l` in the composer and never opens the sessions panel, `Alt+M` types
 * an `m` and never opens the model selector. Every `key.meta` test in the app
 * is bypassed, including the rollback in `composer-state.ts` that exists to
 * keep a chord's letter out of the message you are typing. `keymap.ts` declares
 * both of those bindings `scope: 'global'`, and a global binding that a 20ms
 * scheduling accident can turn into typing is not global.
 *
 * ## The rule
 *
 * A single character that lands within {@link ESCAPE_PREFIX_WINDOW_MS} of a
 * bare `Escape` is the second half of an Alt chord. This is what terminals
 * themselves do to tell `Alt+key` from `Esc` `key` — readline calls the same
 * setting `keyseq-timeout`, vim calls it `ttimeoutlen` — and the window is
 * chosen the same way they choose theirs: long enough to cover the delivery
 * gap, far shorter than a human can press Escape and then hit a letter.
 *
 * Ink-free and side-effect-free apart from the one module-scoped timestamp, so
 * it is unit-testable in a workspace with no React renderer.
 */

/**
 * How long after a bare Escape a lone character still counts as its chord.
 *
 * Three times Ink's flush timer, so a chord split by that timer is always
 * inside it. Well under a keystroke: the fastest realistic gap between pressing
 * Escape and typing the next letter is over 100ms, which is what stops
 * `Esc` then `l` — two deliberate presses — from toggling the sessions panel.
 */
export const ESCAPE_PREFIX_WINDOW_MS = 60;

/** When the last bare Escape arrived, or `null` if none is pending. */
let escapeArrivedAt: number | null = null;

/** Minimal shape of Ink's key object — this module must not import Ink. */
export interface MetaChordKey {
  readonly meta?: boolean;
  readonly escape?: boolean;
}

/**
 * Record a bare Escape as a possible chord prefix.
 *
 * Call this for every Escape, including the ones a surface goes on to act on:
 * closing a panel and prefixing a chord are decided by different rules, and an
 * Escape that was swallowed by a claim is exactly as likely to be half of an
 * `Alt+M` as one that was not.
 */
export function noteEscape(at: number = Date.now()): void {
  escapeArrivedAt = at;
}

/** Forget any pending prefix. Exists for tests and for teardown. */
export function resetEscapePrefix(): void {
  escapeArrivedAt = null;
}

/**
 * Whether this keypress is the tail of a split Alt chord.
 *
 * Deliberately narrow: one character only. A paste arrives as one long `input`
 * and must never be re-read as a chord, and every named key (Enter, arrows,
 * Escape itself) reports an empty `input`.
 */
export function isEscapePrefixed(
  input: string,
  at: number = Date.now(),
): boolean {
  if (escapeArrivedAt === null) return false;
  if (input.length !== 1) return false;
  return at - escapeArrivedAt <= ESCAPE_PREFIX_WINDOW_MS;
}

/**
 * Whether a keypress carries Alt, however the terminal chose to deliver it.
 *
 * The single question every `scope: 'global'` binding should be asking, instead
 * of `key.meta` — which is only true on the delivery that happened to be fast
 * enough.
 */
export function isMetaChord(
  key: MetaChordKey,
  input: string,
  at: number = Date.now(),
): boolean {
  if (key.meta === true) return true;
  return isEscapePrefixed(input, at);
}
