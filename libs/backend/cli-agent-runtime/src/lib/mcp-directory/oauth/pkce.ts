/**
 * PKCE (RFC 7636, S256) helper for the MCP OAuth authorization-code flow.
 *
 * Stateless by design: the interactive flow keeps the returned `codeVerifier`
 * in a closure for the lifetime of a single connect() call, so there is no
 * long-lived state map to expire (unlike the server-side PKCE service).
 */

import { createHash, randomBytes } from 'crypto';

export interface PkceChallenge {
  /** High-entropy verifier sent on the token-exchange request. */
  codeVerifier: string;
  /** SHA-256(verifier) base64url — sent on the authorization request. */
  codeChallenge: string;
  /** CSRF token echoed on the redirect and validated on the callback. */
  state: string;
}

/** Generate a fresh S256 PKCE challenge + CSRF state. */
export function generatePkceChallenge(): PkceChallenge {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const state = randomBytes(16).toString('hex');
  return { codeVerifier, codeChallenge, state };
}
