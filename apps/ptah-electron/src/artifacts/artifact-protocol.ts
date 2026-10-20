import { protocol, session } from 'electron';
import { z } from 'zod';

import { ARTIFACT_PROTOCOL_SCHEME } from '@ptah-extension/shared/mcp-apps-contracts';
export const ARTIFACT_IFRAME_SANDBOX = 'allow-scripts';
export const ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
export const ARTIFACT_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': ARTIFACT_CSP,
} as const;

export interface ArtifactResolver {
  resolve(id: string): Promise<{ bytes: Uint8Array } | null>;
}

const artifactId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/);

export function registerArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ARTIFACT_PROTOCOL_SCHEME,
      privileges: { standard: true, secure: true },
    },
  ]);
}

export function createArtifactHandler(
  resolver: ArtifactResolver,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      // degradation-audit: optional-capability - malformed URL is a 404.
      return new Response(null, { status: 404 });
    }
    const id = artifactId.safeParse(url.hostname);
    if (
      request.method !== 'GET' ||
      url.protocol !== `${ARTIFACT_PROTOCOL_SCHEME}:` ||
      !id.success ||
      url.pathname !== '/index.html' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    ) {
      return new Response(null, { status: 404 });
    }

    try {
      const artifact = await resolver.resolve(id.data);
      return artifact
        ? new Response(Uint8Array.from(artifact.bytes), {
            status: 200,
            headers: ARTIFACT_HEADERS,
          })
        : new Response(null, { status: 404 });
    } catch {
      // degradation-audit: optional-capability - a missing artifact fails closed.
      return new Response(null, { status: 404 });
    }
  };
}

export function registerArtifactHandler(resolver: ArtifactResolver): void {
  session.defaultSession.protocol.handle(
    ARTIFACT_PROTOCOL_SCHEME,
    createArtifactHandler(resolver),
  );
}
