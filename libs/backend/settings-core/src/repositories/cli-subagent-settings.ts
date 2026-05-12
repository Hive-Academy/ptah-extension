import type { ISettingsStore } from '../ports/settings-store.interface';
import {
  PTAH_CLI_AGENTS_DEF,
  type PtahCliAgentEntry,
} from '../schema/cli-subagent-schema';
import type { SettingHandle } from './setting-handle';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for CLI sub-agent configurations.
 *
 * Usage:
 *   const cli = container.resolve<CliSubagentSettings>(SETTINGS_TOKENS.CLI_SUBAGENT_SETTINGS);
 *   const agents = cli.agents.get();   // PtahCliAgentEntry[]
 *   await cli.agents.set([...agents, newAgent]);
 */
export class CliSubagentSettings extends BaseSettingsRepository {
  /** The full list of configured CLI agent entries. */
  readonly agents: SettingHandle<PtahCliAgentEntry[]>;

  constructor(store: ISettingsStore) {
    super(store);
    this.agents = this.handleFor(PTAH_CLI_AGENTS_DEF);
  }
}
