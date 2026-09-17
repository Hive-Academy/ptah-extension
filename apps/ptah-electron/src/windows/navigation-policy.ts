/**
 * Top-level navigation policy for the main window.
 *
 * Pure predicates, deliberately free of any `electron` import so they can be
 * unit-tested without a BrowserWindow.
 *
 * The renderer is loaded with `loadFile`, so its document lives on the `file:`
 * origin. The previous guard treated EVERY `file:` URL as internal, which was
 * the hole: a relative link in rendered agent markdown resolves against the
 * renderer document, so `<a href="../../etc/passwd">` — or anything else —
 * produced a `file:` navigation the guard waved through, replacing the whole
 * Angular shell with a file listing. There is no back button in this window.
 *
 * The rule is therefore an allowlist of ONE case: a navigation that reloads
 * the document already loaded. Everything else is cancelled.
 */

/** Schemes safe to hand to the system browser. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    // degradation-audit: optional-capability - classifying an untrusted
    // navigation target is optional; `undefined` makes every caller below
    // fail closed, which refuses the navigation.
    return undefined;
  }
}

/**
 * Whether `targetUrl` is the SAME DOCUMENT as `currentUrl` — the only
 * navigation the main window allows.
 *
 * Both must be `file:` URLs whose origin and pathname agree. Hash and query
 * are ignored, which is a deliberate, documented widening: an in-page anchor
 * (`#section`) must keep working, and Electron itself treats a hash- or
 * query-only change as a same-document navigation. The practical consequence
 * is that an agent-authored `href="index.html?x"` can reload the renderer —
 * that reloads the app the user is already in, mounts the same Angular shell,
 * and reads no file the renderer could not already read. It is not a path to
 * arbitrary content, which is what this guard exists to stop.
 *
 * Fail-closed: an empty, malformed or non-`file:` URL on either side is false.
 */
export function isSameDocumentNavigation(
  currentUrl: string,
  targetUrl: string,
): boolean {
  const current = parse(currentUrl);
  const target = parse(targetUrl);
  if (!current || !target) return false;
  if (current.protocol !== 'file:' || target.protocol !== 'file:') return false;
  return (
    current.origin === target.origin && current.pathname === target.pathname
  );
}

/**
 * Whether a cancelled navigation may be handed to `shell.openExternal`.
 *
 * Restricted to three schemes. `file:` is NOT among them by design: a
 * navigation this policy just refused must not be laundered into the OS
 * handler, which would open the very path the guard cancelled.
 */
export function isSafeExternalUrl(targetUrl: string): boolean {
  const parsed = parse(targetUrl);
  return parsed !== undefined && EXTERNAL_SCHEMES.has(parsed.protocol);
}
