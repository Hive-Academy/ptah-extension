/**
 * V1 Migration — config.json consolidation (placeholder).
 *
 * Design intent: merge any legacy {userData}/config.json into settings.json.
 *
 * This migration is currently a documented no-op because:
 * 1. The platform's userData path is not available in a platform-agnostic context.
 *    The platform adapters (platform-{vscode,electron,cli}) own userData discovery,
 *    and settings-core must not depend on them.
 * 2. No known production installations have a separate config.json file — this
 *    consolidation path is precautionary for any old development builds.
 *
 * TODO(WP-3 or dedicated migration WP): When platform adapters gain a
 * MigrationRunner factory that passes the resolved userData path alongside ptahDir,
 * implement the actual merge:
 *   1. Read {userData}/config.json.
 *   2. For each key, write to settings.json via PtahFileSettingsManager if not
 *      already present (settings.json wins on conflict).
 *   3. Delete config.json.
 */
export async function runV1Migration(_ptahDir: string): Promise<void> {
  // No-op. See module doc for rationale.
}
