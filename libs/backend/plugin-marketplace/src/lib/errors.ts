/**
 * Error taxonomy for the external plugin marketplace.
 *
 * Codes exist so RPC handlers can turn a failure into a message the UI can act
 * on ("you are rate limited, try again at HH:MM") instead of surfacing a raw
 * network string. Every message here is written to be shown to a user.
 */
export type PluginMarketplaceErrorCode =
  /** `source` was not a well-formed `owner/repo` slug. */
  | 'invalid-source'
  /** The repo has no `.claude-plugin/marketplace.json`, or it 404'd. */
  | 'manifest-not-found'
  /** The manifest fetched but failed Zod validation. */
  | 'manifest-invalid'
  /** The marketplace is not registered (add it first). */
  | 'marketplace-not-registered'
  /** The marketplace does not advertise a plugin by that name. */
  | 'plugin-not-found'
  /** api.github.com refused us for rate-limit reasons. */
  | 'rate-limited'
  /** Network failure, timeout, or an unexpected HTTP status. */
  | 'network'
  /** A path from remote data resolved outside its target directory. */
  | 'path-traversal'
  /** The plugin subtree exceeds the install size limits. */
  | 'too-large'
  /** No valid consent token was presented for a write. */
  | 'consent-required';

/** A failure with a code the RPC layer can map to user-facing copy. */
export class PluginMarketplaceError extends Error {
  constructor(
    readonly code: PluginMarketplaceErrorCode,
    message: string,
    /** Epoch ms when a rate limit lifts, when the code is `rate-limited`. */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = 'PluginMarketplaceError';
  }
}
