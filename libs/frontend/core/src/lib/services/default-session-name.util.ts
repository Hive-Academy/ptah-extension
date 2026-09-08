/**
 * Build the slugified fallback name for a session the user creates without
 * typing one.
 *
 * Format: `session-MM-DD-HH-mm` (e.g. `session-12-11-14-45`), every field
 * zero-padded to two digits and read from the LOCAL clock — the name is a
 * human-facing label in the sidebar and on a canvas tile, not a timestamp any
 * code parses back.
 *
 * Lives here because both session-creation surfaces need the identical string:
 * `AppShellComponent` (`@ptah-extension/chat`) for a new tab, and
 * `OrchestraCanvasComponent` (`@ptah-extension/canvas`) for a new tile. Neither
 * lib may import the other — canvas depends on chat, not the reverse — so the
 * shared piece belongs in the one lib both already depend on.
 *
 * @param now - Clock reading to name; defaults to the current time. Injectable
 *   so a test can pin the output without freezing global time.
 * @returns The default session name.
 */
export function defaultSessionName(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `session-${month}-${day}-${hours}-${minutes}`;
}
