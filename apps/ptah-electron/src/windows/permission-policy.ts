import type { WebContents } from 'electron';
import { z } from 'zod';

// Both dev and packaged builds use loadFile(renderer/index.html). file: has
// an empty host; URL.origin is "null" and must NOT be used as an identity.
const trustedOrigin = { protocol: 'file:', host: '' };
// Existing consumers: chat/voice-input.service.ts uses { audio: true };
// workspace-indexing, vec-embedder-recovery and marketplace/oauth-surface use
// navigator.clipboard.writeText. Text reads use preload.ts's ptahClipboard IPC;
// pasted images come from ClipboardEvent.clipboardData, not clipboard.read().
// Neither requires a browser clipboard-read grant. Null subjects have no exception.
const permissionSchema = z.enum(['media', 'clipboard-sanitized-write']);
const detailsSchema = z.object({
  isMainFrame: z.literal(true),
  requestingUrl: z.string(),
  securityOrigin: z.string().optional(),
  embeddingOrigin: z.string().optional(),
  mediaTypes: z.array(z.literal('audio')).nonempty().optional(),
  mediaType: z.literal('audio').optional(),
});

function parseTrustedUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === trustedOrigin.protocol &&
      url.host === trustedOrigin.host
      ? url
      : undefined;
  } catch {
    // Malformed permission subjects fail closed.
    return undefined;
  }
}

/** Install both halves of Electron's permission boundary before any load. */
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
    const parsed = detailsSchema.safeParse(details);
    if (!permissionSchema.safeParse(permission).success || !parsed.success) {
      return false;
    }
    const subject = parsed.data;
    const requesting = parseTrustedUrl(subject.requestingUrl);
    const embedding = parseTrustedUrl(contents.getURL());
    // file: alone grants every local file the same origin. Bind the grant to
    // our renderer document too, never a recovery page or an arbitrary file.
    if (
      requesting?.pathname !== renderer.pathname ||
      embedding?.pathname !== renderer.pathname
    )
      return false;
    if (kind === 'check' && !parseTrustedUrl(requestingOrigin ?? '')) {
      return false;
    }
    if (
      (subject.securityOrigin !== undefined &&
        !parseTrustedUrl(subject.securityOrigin)) ||
      (subject.embeddingOrigin !== undefined &&
        !parseTrustedUrl(subject.embeddingOrigin))
    )
      return false;
    // VoiceInputService captures audio only. Never turn its media grant into
    // camera access, or approve a media request whose type is unspecified.
    return (
      permission !== 'media' ||
      (subject.securityOrigin !== undefined &&
        (kind === 'request'
          ? subject.mediaTypes !== undefined
          : subject.mediaType === 'audio'))
    );
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
