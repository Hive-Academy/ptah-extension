/**
 * Lane family key (TASK_2026_646, SC-5).
 *
 * The family is the grouping the outcome pipeline reports and the router
 * scores by: one key per system CLI, and one per Ptah CLI provider. A Ptah
 * CLI agent groups under its provider id, falling back to a synthetic
 * `ptah-cli:<id>` key when the provider is unknown, then to `ptah-cli`
 * itself. The notifier calls this at write time with
 * `{ cli, ptahCliId, providerId }`; a `CliDetectionResult` row satisfies the
 * input as is.
 */

export interface LaneFamilyInput {
  /** CLI type of the lane; `ptah-cli` for a Ptah CLI agent. */
  readonly cli: string;
  /** Ptah CLI agent registry ID, when the lane is a Ptah CLI agent. */
  readonly ptahCliId?: string | null;
  /** Provider ID the Ptah CLI agent resolves to, when known. */
  readonly providerId?: string | null;
}

/** Family of every subagent record: subagents run as Claude subagent sessions. */
export const SUBAGENT_FAMILY = 'claude';

/**
 * providerId for cli === 'ptah-cli' (fallback 'ptah-cli:' + ptahCliId, then
 * 'ptah-cli'); else cli.
 *
 * A blank `providerId` or `ptahCliId` (empty string) counts as unset, so a
 * corrupt row groups under the next key instead of a degenerate empty one.
 */
export function laneFamilyOf(input: LaneFamilyInput): string {
  const { cli, ptahCliId, providerId } = input;

  if (cli !== 'ptah-cli') {
    return cli;
  }
  if (providerId) {
    return providerId;
  }
  return ptahCliId ? `ptah-cli:${ptahCliId}` : 'ptah-cli';
}