import type { WebContents } from 'electron';
import { z } from 'zod';

// Both dev and packaged builds use loadFile(renderer/index.html). file: has
// an empty host; URL.origin is "null" and must NOT be used as an identity.
const trustedOrigin = { protocol: 'file:', host: '' };

/**
 * The allowlist. Each entry is here because a measured Chromium dispatch put
 * it here, not because a caller looked like it might need it.
 *
 * - `media` — `VoiceInputService` calls `getUserMedia({ audio: true })`
 *   (`libs/frontend/chat/src/lib/services/voice-input.service.ts`). Chromium
 *   raises one `media` request with `mediaTypes: ['audio']`, plus `media`
 *   checks. The audio-only restriction is enforced below, not here.
 * - `clipboard-sanitized-write` — `navigator.clipboard.writeText()` from the
 *   `file:` shell origin. MEASURED, because an earlier review asserted
 *   Chromium sends `clipboard-read` for this call: an Electron 44 probe that
 *   granted everything and logged each dispatch saw `clipboard-sanitized-write`
 *   and never `clipboard-read`, and `writeText` resolves under this policy
 *   while a deny-all control rejects it with `NotAllowedError`. The evidence
 *   is in `.ptah/specs/TASK_2026_491_e0da/implementation-notes.md`. The
 *   allowlist is therefore NOT widened to the clipboard-read family, which
 *   would grant reading the user's clipboard for no caller that exists.
 *
 * Text reads use preload.ts's `ptahClipboard` IPC; pasted images arrive
 * through `ClipboardEvent.clipboardData`, not `clipboard.read()`. Neither
 * needs a browser clipboard-read grant. Null subjects have no exception.
 */
const permissionSchema = z.enum(['media', 'clipboard-sanitized-write']);

/**
 * Electron types and delivers the two detail objects DIFFERENTLY. Treating
 * them as one shape is what made a field Electron never sends look required.
 *
 * `PermissionRequest` / `MediaAccessPermissionRequest`
 * (`node_modules/electron/electron.d.ts:10885,9479`): `requestingUrl` is
 * mandatory; `mediaTypes` and `securityOrigin` are optional and were both
 * observed present on a real `media` request.
 */
const requestSchema = z.object({
  isMainFrame: z.literal(true),
  requestingUrl: z.string(),
  securityOrigin: z.string().optional(),
  mediaTypes: z.array(z.literal('audio')).nonempty().optional(),
});

/**
 * `PermissionCheckHandlerHandlerDetails` (`electron.d.ts:23372`):
 * `requestingUrl` itself is optional — Electron omits it when the check is not
 * made on behalf of a document, and such a check cannot be bound to the shell
 * document, so it stays mandatory here and fails closed.
 *
 * `securityOrigin` is absent on the check Chromium raises for
 * `navigator.permissions.query({ name: 'microphone' })`, and `mediaType` is
 * absent on the internal `media` checks raised around capture. Both were
 * measured. Neither absence may deny.
 */
const checkSchema = z.object({
  isMainFrame: z.literal(true),
  requestingUrl: z.string(),
  securityOrigin: z.string().optional(),
  embeddingOrigin: z.string().optional(),
  mediaType: z.literal('audio').optional(),
});

/**
 * Windows `file:` URLs carry a drive letter whose case the filesystem ignores
 * but `URL.pathname` preserves, so `/c:/app` and `/C:/app` name one document.
 * Upper-case ONLY that leading letter. Everything after it stays byte-exact,
 * so `/C:/app/renderer/Index.html` still fails against `index.html`.
 */
function normalizePathname(pathname: string): string {
  return pathname.replace(
    /^\/([a-z]):/,
    (_match, drive) => `/${drive.toUpperCase()}:`,
  );
}

function parseTrustedUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === trustedOrigin.protocol &&
      url.host === trustedOrigin.host
      ? url
      : undefined;
  } catch {
    // degradation-audit: optional-capability - parsing an arbitrary permission
    // subject as a URL is allowed to fail. `undefined` is the DENY answer, not
    // a swallowed error: every caller treats it as "not the trusted origin",
    // so a malformed subject fails closed. Reporting it would be noise, and
    // rethrowing would turn a denial into a crash in Electron's permission
    // callback, where an exception is the one outcome that must never happen.
    return undefined;
  }
}

function isRendererDocument(value: string | undefined, renderer: URL): boolean {
  const parsed = value === undefined ? undefined : parseTrustedUrl(value);
  return (
    parsed !== undefined &&
    normalizePathname(parsed.pathname) === normalizePathname(renderer.pathname)
  );
}

/**
 * Install both halves of Electron's permission boundary before any load.
 *
 * Scope note: the handlers are set on `shellContents.session`, which is
 * `session.defaultSession`. `ElectronBrowserCapabilities` creates its CDP
 * automation `BrowserWindow` without a `partition`, so that window shares this
 * session and every permission it asks for is denied here by the
 * `contents !== shellContents` test. Giving the automation window its own
 * partition and its own policy is TASK_2026_519_4f1a, deliberately not this
 * task: denying is the safe direction, and moving it needs the automation
 * surface's own decision.
 */
export function installPermissionPolicy(
  shellContents: WebContents,
  rendererUrl: string,
): void {
  const renderer = parseTrustedUrl(rendererUrl);

  function allows(
    contents: WebContents | null,
    permission: string,
    details: unknown,
    kind: 'request' | 'check',
    requestingOrigin?: string,
  ): boolean {
    if (!contents || contents !== shellContents || !renderer) return false;
    if (!permissionSchema.safeParse(permission).success) return false;
    const parsed = (kind === 'request' ? requestSchema : checkSchema).safeParse(
      details,
    );
    if (!parsed.success) return false;
    const subject = parsed.data;
    // Zod strips unknown keys, so a request never carries a check-only field
    // and vice versa. Read each one through the shape that owns it.
    const embeddingOrigin =
      'embeddingOrigin' in subject ? subject.embeddingOrigin : undefined;
    const mediaTypes = 'mediaTypes' in subject ? subject.mediaTypes : undefined;
    // file: alone grants every local file the same origin. Bind the grant to
    // our renderer document too, never a recovery page or an arbitrary file.
    if (
      !isRendererDocument(subject.requestingUrl, renderer) ||
      !isRendererDocument(contents.getURL(), renderer)
    )
      return false;
    if (kind === 'check' && !parseTrustedUrl(requestingOrigin ?? '')) {
      return false;
    }
    // Validate an origin field only when Electron actually sent it. A field
    // Electron never sends must not decide the answer.
    if (
      (subject.securityOrigin !== undefined &&
        !parseTrustedUrl(subject.securityOrigin)) ||
      (embeddingOrigin !== undefined && !parseTrustedUrl(embeddingOrigin))
    )
      return false;
    if (permission !== 'media') return true;
    // VoiceInputService captures audio only. A REQUEST is the grant that opens
    // a device, so it must name its media types, and the schema above admits
    // only 'audio' — a request without mediaTypes cannot be proved audio-only
    // and is denied. A CHECK only reports state and opens nothing; Chromium
    // raises it with mediaType 'audio' for a microphone query and with no
    // mediaType at all for its internal checks around capture. Denying the
    // untyped check reported the microphone as 'denied' while capture worked,
    // so absence is allowed here. Camera stays denied either way: the schema
    // rejects mediaType 'video' and mediaTypes containing 'video'.
    return kind === 'request' ? mediaTypes !== undefined : true;
  }

  shellContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(allows(contents, permission, details, 'request'));
    },
  );
  shellContents.session.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) =>
      allows(contents, permission, details, 'check', requestingOrigin),
  );
}
