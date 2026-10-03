import type { CliDetectionResult, PtahCliSummary, SkillLaneDto, SkillLaneIdDto } from '@ptah-extension/shared';
import type { BackgroundConsumerId } from './provider-consumer-rows';

/** One consumer of a connection, for the drawer's "Used by" list and the card's count. */
export interface UsedBy {
  /** Stable key: `main-agent`, a background role id, `ptah-cli:{agent id}`, or `codex-cli`. */
  readonly id: 'main-agent' | BackgroundConsumerId | `ptah-cli:${string}` | 'codex-cli';
  readonly label: string;
  readonly kind: 'main-agent' | 'background-role' | 'ptah-cli' | 'system-cli';
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
  /** The system CLIs' detection and on/off policy (`agent:getConfig`); `null` while it loads or after it failed. */
  readonly systemClis: {
    readonly detectedClis: readonly Pick<CliDetectionResult, 'cli' | 'installed' | 'disabled'>[];
    readonly disabledClis: readonly string[];
  } | null;
}

/** The OpenAI Codex connection: the sign-in the Codex CLI shares (`~/.codex/auth.json`). */
const CODEX_PROVIDER_ID = 'openai-codex';

/** The Codex CLI is installed and not switched off. */
function codexCliEnabled(systemClis: NonNullable<ConnectionUsageSources['systemClis']>): boolean {
  return !systemClis.disabledClis.includes('codex')
    && systemClis.detectedClis.some((entry) => entry.cli === 'codex' && entry.installed && entry.disabled !== true);
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
 * Judging & enhancement, Ptah CLI agents in list order, then the Codex CLI.
 *
 * System CLIs authenticate on their own and are not listed, with one exception: the Codex CLI counts
 * under OpenAI Codex, the sign-in it shares, while it is installed and enabled (task.md "Gate V 28
 * (2026-10-01, user)", which reverses Batch 19 decision (a)). Copilot, Cursor and the others stay out.
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
  if (sources.systemClis && codexCliEnabled(sources.systemClis)) {
    add(CODEX_PROVIDER_ID, { id: 'codex-cli', label: 'Codex CLI', kind: 'system-cli', followsMain: false });
  }
  return {
    byProvider: Object.fromEntries(usage),
    complete: sources.mainProviderId !== undefined && sources.curatorProvider !== null && sources.lanes !== null
      && sources.judgeProvider !== null && sources.cliAgents !== null && sources.systemClis !== null,
  };
}
