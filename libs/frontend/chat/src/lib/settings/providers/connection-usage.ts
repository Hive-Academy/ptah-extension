import type { PtahCliSummary, SkillLaneDto, SkillLaneIdDto } from '@ptah-extension/shared';
import type { BackgroundConsumerId } from './provider-consumer-assignments.component';

/** One consumer of a connection, for the drawer's "Used by" list and the card's count. */
export interface UsedBy {
  /** Stable key: `main-agent`, a background role id, or `ptah-cli:{agent id}`. */
  readonly id: 'main-agent' | BackgroundConsumerId | `ptah-cli:${string}`;
  readonly label: string;
  readonly kind: 'main-agent' | 'background-role' | 'ptah-cli';
  /** Assigned by inheritance (no provider of its own): it uses whatever the main agent uses. */
  readonly followsMain: boolean;
}

/**
 * The reads a usage map is built from. A section that has not loaded (`null`; `undefined` for the
 * main provider) contributes nothing and makes the result incomplete. Inside loaded data, an empty
 * provider means the role follows the main agent.
 */
export interface ConnectionUsageSources {
  /**
   * `route.driverProviderId` of a resolved route. `undefined` = the route has not loaded;
   * `null` = loaded, and no main agent is configured (following roles are then used by nothing).
   */
  readonly mainProviderId: string | null | undefined;
  /** `memory.curatorProvider` (`''` or absent in loaded data = follows main). */
  readonly curatorProvider: string | null;
  readonly lanes: Readonly<Record<SkillLaneIdDto, Pick<SkillLaneDto, 'provider'>>> | null;
  /** `skillSynthesis.judgeProvider` for Judging & enhancement (`''` = follows main). */
  readonly judgeProvider: string | null;
  /** Ptah CLI agents; each uses its own provider connection. */
  readonly cliAgents: readonly Pick<PtahCliSummary, 'id' | 'name' | 'providerId'>[] | null;
}

/** Background roles in the order the Orchestration tab lists them. */
const LANES: readonly { readonly id: SkillLaneIdDto; readonly label: string }[] = [
  { id: 'archaeologist', label: 'Archaeologist lane' },
  { id: 'synthesis', label: 'Synthesis lane' },
  { id: 'judge', label: 'Judge lane' },
  { id: 'replay', label: 'Replay lane' },
];

export interface ConnectionUsage {
  /** `{providerId → readonly UsedBy[]}`; a connection absent from it is used by nothing the sources describe. */
  readonly byProvider: Readonly<Record<string, readonly UsedBy[]>>;
  /**
   * Every source was loaded. Only then may an absent connection be shown as "Not used yet";
   * otherwise the caller shows a loading state.
   */
  readonly complete: boolean;
}

/**
 * Builds the usage map in a fixed order per connection: main agent, memory curator, the four lanes,
 * Judging & enhancement, then Ptah CLI agents in list order.
 *
 * System CLIs (Codex, Copilot, Cursor, …) are excluded: they authenticate on their own and do not use
 * a Settings connection (implementation-plan.md :673-677; confirmed for Codex CLI in the Batch 19 review).
 */
export function connectionUsage(sources: ConnectionUsageSources): ConnectionUsage {
  const usage = new Map<string, UsedBy[]>();
  const add = (providerId: string, entry: UsedBy): void => {
    const list = usage.get(providerId);
    if (list) list.push(entry);
    else usage.set(providerId, [entry]);
  };
  /** A role with its own provider uses it; an empty one follows the main agent, if there is one. */
  const addRole = (provider: string | null, id: BackgroundConsumerId, label: string): void => {
    if (provider === null) return;
    const own = provider.trim();
    const target = own || sources.mainProviderId;
    if (target) add(target, { id, label, kind: 'background-role', followsMain: !own });
  };

  if (sources.mainProviderId) {
    add(sources.mainProviderId, { id: 'main-agent', label: 'Main agent', kind: 'main-agent', followsMain: false });
  }
  addRole(sources.curatorProvider, 'memory-curator', 'Memory curator');
  if (sources.lanes) {
    for (const lane of LANES) addRole(sources.lanes[lane.id]?.provider ?? '', lane.id, lane.label);
  }
  addRole(sources.judgeProvider, 'judging-enhancement', 'Judging & enhancement');
  for (const agent of sources.cliAgents ?? []) {
    const provider = agent.providerId.trim();
    if (provider) {
      add(provider, { id: `ptah-cli:${agent.id}`, label: `${agent.name} (Ptah CLI agent)`, kind: 'ptah-cli', followsMain: false });
    }
  }
  return {
    byProvider: Object.fromEntries(usage),
    complete: sources.mainProviderId !== undefined && sources.curatorProvider !== null && sources.lanes !== null
      && sources.judgeProvider !== null && sources.cliAgents !== null,
  };
}
