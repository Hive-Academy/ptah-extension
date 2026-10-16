/**
 * Fixed row-detail text per failure class (P4 visual review Moderate 1).
 *
 * A rejection from `fetch`, the secret store or a structured-provider port
 * is untrusted text: it can carry a URL, a host name or provider output
 * ("fetch failed" reached the row this way). The decision-model row shows
 * one of these fixed strings instead; the original error goes to the log
 * only. Same rule as `system-one.client.ts` `classifyTransportFailure`.
 */
export const DECISION_MODEL_DETAIL = {
  /** A probe request was rejected before the endpoint answered. */
  unreachable: 'The model endpoint could not be reached.',
  /** The shared probe budget expired. */
  timedOut: 'The request timed out.',
  /** `ISecretStorage` rejected the Jev key lookup. */
  credentialStore: 'The credential store could not be read.',
  /** `StructuredDecisionCompleter.isReady` rejected. */
  providerCheck: 'The provider readiness check failed.',
} as const;
