/**
 * CLI Skill Sync Module - Barrel Exports
 */

export { CliPluginSyncService } from './cli-plugin-sync.service';
export type {
  ICliSkillInstaller,
  CliSkillInstallOptions,
  CliSkillSyncSources,
  CliCommandFormat,
} from './cli-skill-installer.interface';
export { WorkspaceSkillInstaller } from './workspace-skill-installer.base';
export { CodexSkillInstaller } from './codex-skill-installer';
export { CopilotSkillInstaller } from './copilot-skill-installer';
export { CursorSkillInstaller } from './cursor-skill-installer';
export { AntigravitySkillInstaller } from './antigravity-skill-installer';
export { CliSkillManifestTracker } from './cli-skill-manifest-tracker';
export {
  stripAllowedToolsFromFrontmatter,
  sanitizeYamlDescriptions,
  rewriteSkillName,
  copyDirectoryRecursive,
  mergeAgentsRegion,
  reapPrefixedHomeEntries,
  readManagedManifest,
  writeManagedManifest,
  CLI_MANAGED_MANIFEST,
  PTAH_AGENTS_REGION_BEGIN,
  PTAH_AGENTS_REGION_END,
} from './skill-sync-utils';
export type { CliManagedManifest, AgentBody } from './skill-sync-utils';
