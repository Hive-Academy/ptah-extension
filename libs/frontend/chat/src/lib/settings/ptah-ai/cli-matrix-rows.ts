import type {
  ProvidersCliModels,
  ProvidersCliTest,
  ProvidersOrchestration,
} from '@ptah-extension/core';
import {
  SYSTEM_CLI_TYPES,
  type PtahCliSummary,
  type SystemCliType,
} from '@ptah-extension/shared';
import {
  cliPermissionNote,
  type CliPermissionNote,
} from './cli-permission-notes';

/** Orchestration fields a system CLI's Model and Effort cells read and write (`agent:setConfig`). */
export type CliModelSettingKey =
  | 'codexModel'
  | 'copilotModel'
  | 'cursorModel'
  | 'antigravityModel'
  | 'opencodeModel'
  | 'piModel'
  | 'grokModel';
export type CliEffortSettingKey =
  'codexReasoningEffort' | 'copilotReasoningEffort' | 'piReasoningEffort';

/**
 * Status column. System rows show only what detection reports (D11: no quota state, no system-CLI test):
 * Ready / Disabled / Not installed, and Needs API key for Cursor. Instance rows map `PtahCliSummary.status`
 * (#43), with Disabled when the instance is switched off.
 */
export type CliMatrixStatusKind =
  | 'ready'
  | 'disabled'
  | 'not-installed'
  | 'needs-key'
  | 'error'
  | 'initializing';
export interface CliMatrixStatus {
  readonly kind: CliMatrixStatusKind;
  readonly label: string;
  /** Dot colour; the label stays `text-base-content` (deviation 6). */
  readonly tone: 'success' | 'neutral' | 'warning' | 'error' | 'info';
}

interface CliMatrixRowBase {
  /** The `preferredAgentOrder` id: the CLI name for system rows, the instance id for Ptah instances. */
  readonly id: string;
  readonly name: string;
  readonly status: CliMatrixStatus;
  /** On/off: not in `disabledClis` (system) or `enabled` (instance). */
  readonly enabled: boolean;
  /** Model/effort cells open a popover only when true; otherwise they render plain text. */
  readonly interactive: boolean;
  readonly permission: CliPermissionNote;
}

export interface SystemCliMatrixRow extends CliMatrixRowBase {
  readonly kind: 'system';
  readonly cli: SystemCliType;
  readonly installed: boolean;
  /** Detected version line as the CLI printed it; null when unknown, and for Cursor, whose bundled SDK reports `sdk`. */
  readonly version: string | null;
  /** `version` for display (`cliVersionLabel`): "v0.155.1", never the CLI name again (Batch 52.1). */
  readonly versionLabel: string | null;
  /**
   * The account the CLI uses. Each system CLI signs in on its own; opencode and Pi take the provider
   * from the `provider/model` id, so theirs is null until a model is saved. Null for uninstalled rows.
   */
  readonly provider: string | null;
  /** Saved delegated model (`''` = CLI default). */
  readonly model: { readonly key: CliModelSettingKey; readonly value: string };
  /** Saved reasoning effort; null for CLIs without an effort setting (Cursor, Antigravity, opencode, Grok). */
  readonly effort: {
    readonly key: CliEffortSettingKey;
    readonly value: string;
  } | null;
  /**
   * Cursor only: the Credentials action. Cursor reports "installed" only once a key resolves
   * (`cursor-cli.adapter.ts:208-223`), so the action stays on the Uninstalled row too.
   */
  readonly credentialAction: boolean;
}

/** One tier badge (#54), in the order Sonnet, Opus, Haiku. */
export interface CliTierBadge {
  readonly tier: 'sonnet' | 'opus' | 'haiku';
  readonly label: 'Sonnet' | 'Opus' | 'Haiku';
  readonly model: string;
}

/** Key status subline (#44). `keyless`: runs without a stored key (local, or Ollama Cloud sign-in). */
export interface CliKeyStatus {
  readonly kind: 'key-set' | 'keyless' | 'missing';
  readonly label: string;
}

export interface InstanceCliMatrixRow extends CliMatrixRowBase {
  readonly kind: 'instance';
  readonly providerId: string;
  readonly provider: string;
  readonly keyStatus: CliKeyStatus;
  /** Null while `cliModels` is not loaded or has no entry for this instance; `[]` = no tier mapped. */
  readonly tiers: readonly CliTierBadge[] | null;
  /** Saved direct model; `''` = the tier mappings decide. Null while `cliModels` has no entry. */
  readonly selectedModel: string | null;
  /** The last connection test of this instance (#52), or null when the last test was another one. */
  readonly lastTest: Pick<
    ProvidersCliTest,
    'success' | 'latencyMs' | 'reason'
  > | null;
}

export type CliMatrixRow = SystemCliMatrixRow | InstanceCliMatrixRow;

export interface CliMatrixRows {
  /** Installed system CLIs and every Ptah instance, in `preferredAgentOrder` rank order. */
  readonly installed: readonly CliMatrixRow[];
  /** System CLIs detection reports as not installed, in detection order (#71). */
  readonly uninstalled: readonly SystemCliMatrixRow[];
}

/**
 * The reads the matrix merges. A section that has not loaded is `null` and contributes no rows; the
 * component shows that section's loading or error state.
 */
export interface CliMatrixSources {
  readonly orchestration: Pick<
    ProvidersOrchestration,
    | 'detectedClis'
    | 'disabledClis'
    | 'preferredAgentOrder'
    | 'copilotAutoApprove'
    | CliModelSettingKey
    | CliEffortSettingKey
  > | null;
  readonly cliAgents: readonly PtahCliSummary[] | null;
  readonly cliModels: ProvidersCliModels | null;
  readonly cliTest: ProvidersCliTest | null;
}

interface SystemCliSpec {
  readonly name: string;
  readonly provider: string | null;
  readonly modelKey: CliModelSettingKey;
  readonly effortKey: CliEffortSettingKey | null;
}

const SYSTEM_CLIS: Readonly<Record<SystemCliType, SystemCliSpec>> = {
  codex: {
    name: 'Codex',
    provider: 'OpenAI Codex',
    modelKey: 'codexModel',
    effortKey: 'codexReasoningEffort',
  },
  copilot: {
    name: 'Copilot',
    provider: 'GitHub Copilot',
    modelKey: 'copilotModel',
    effortKey: 'copilotReasoningEffort',
  },
  cursor: {
    name: 'Cursor',
    provider: 'Cursor',
    modelKey: 'cursorModel',
    effortKey: null,
  },
  antigravity: {
    name: 'Antigravity',
    provider: 'Google Antigravity',
    modelKey: 'antigravityModel',
    effortKey: null,
  },
  opencode: {
    name: 'OpenCode',
    provider: null,
    modelKey: 'opencodeModel',
    effortKey: null,
  },
  pi: {
    name: 'Pi',
    provider: null,
    modelKey: 'piModel',
    effortKey: 'piReasoningEffort',
  },
  grok: {
    name: 'Grok',
    provider: 'xAI',
    modelKey: 'grokModel',
    effortKey: null,
  },
};

const INSTANCE_STATUS: Readonly<
  Record<PtahCliSummary['status'], CliMatrixStatus>
> = {
  available: { kind: 'ready', label: 'Ready', tone: 'success' },
  error: { kind: 'error', label: 'Error', tone: 'error' },
  initializing: { kind: 'initializing', label: 'Initializing', tone: 'info' },
  unconfigured: { kind: 'needs-key', label: 'Needs API key', tone: 'warning' },
};
const READY: CliMatrixStatus = {
  kind: 'ready',
  label: 'Ready',
  tone: 'success',
};
const DISABLED: CliMatrixStatus = {
  kind: 'disabled',
  label: 'Disabled',
  tone: 'neutral',
};
const NOT_INSTALLED: CliMatrixStatus = {
  kind: 'not-installed',
  label: 'Not installed',
  tone: 'neutral',
};
const CURSOR_NEEDS_KEY: CliMatrixStatus = {
  kind: 'needs-key',
  label: 'Needs API key',
  tone: 'warning',
};

/** Ollama Cloud runs on `ollama signin` when no key is stored (`PtahCliSummary.hasApiKey`). */
const SIGN_IN_PROVIDER_ID = 'ollama-cloud';
const TIERS: readonly Pick<CliTierBadge, 'tier' | 'label'>[] = [
  { tier: 'sonnet', label: 'Sonnet' },
  { tier: 'opus', label: 'Opus' },
  { tier: 'haiku', label: 'Haiku' },
];

/** A semver-like token: 0.155.1, v2.0.12, 1.0.83 (a trailing sentence dot is not part of it), 1.2.3-beta.1. */
const VERSION_TOKEN =
  /(?:^|[^\w.])v?(\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)(?!\w)/;

/**
 * Batch 52.1: the detected version is the CLI's raw `--version` line (`probeCliVersion`), e.g. "codex-cli 0.155.1",
 * "opencode v2.0.12" or "GitHub Copilot CLI 1.0.83.". Shows the version token as "v0.155.1"; a line with no such token
 * is shown trimmed and without a "v" (the cell truncates it, with the raw line in its title).
 */
export function cliVersionLabel(raw: string): string {
  const token = VERSION_TOKEN.exec(raw)?.[1];
  return token ? `v${token}` : raw.trim();
}

/**
 * Batch 52.2: a model value saved from the earlier `agy models` parse is "id<TAB>display name"
 * ("claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)"). The cell shows the id alone, with the name in its title.
 */
export function cliModelDisplay(value: string): {
  readonly label: string;
  readonly title: string;
} {
  const tab = value.indexOf('\t');
  if (tab < 0) return { label: value, title: value };
  const id = value.slice(0, tab).trim(),
    name = value.slice(tab + 1).trim();
  return { label: id, title: name ? `${id} (${name})` : id };
}

function isSystemCli(cli: string): cli is SystemCliType {
  return (SYSTEM_CLI_TYPES as readonly string[]).includes(cli);
}

/** opencode and Pi models are `provider/model`; the part before the first `/` is the provider. */
function providerFromModelId(model: string): string | null {
  const slash = model.indexOf('/');
  return slash > 0 ? model.slice(0, slash) : null;
}

function systemRows(
  orchestration: NonNullable<CliMatrixSources['orchestration']>,
): SystemCliMatrixRow[] {
  const disabled = new Set(orchestration.disabledClis);
  const rows: SystemCliMatrixRow[] = [];
  const seen = new Set<SystemCliType>();
  for (const detected of orchestration.detectedClis) {
    // Ptah instances come from `cliAgents()`, not from detection.
    if (
      detected.ptahCliId ||
      !isSystemCli(detected.cli) ||
      seen.has(detected.cli)
    )
      continue;
    seen.add(detected.cli);
    const cli = detected.cli;
    const spec = SYSTEM_CLIS[cli];
    const enabled = !disabled.has(cli);
    const installed = detected.installed;
    const model = orchestration[spec.modelKey] ?? '';
    const status = !installed
      ? cli === 'cursor'
        ? CURSOR_NEEDS_KEY
        : NOT_INSTALLED
      : enabled
        ? READY
        : DISABLED;
    const version = detected.version?.trim();
    rows.push({
      kind: 'system',
      id: cli,
      cli,
      name: spec.name,
      status,
      enabled,
      installed,
      interactive: installed && enabled,
      version:
        version && !(cli === 'cursor' && version === 'sdk') ? version : null,
      versionLabel:
        version && !(cli === 'cursor' && version === 'sdk')
          ? cliVersionLabel(version)
          : null,
      provider: installed
        ? (spec.provider ?? providerFromModelId(model))
        : null,
      model: { key: spec.modelKey, value: model },
      effort: spec.effortKey
        ? { key: spec.effortKey, value: orchestration[spec.effortKey] ?? '' }
        : null,
      permission: cliPermissionNote(cli, orchestration.copilotAutoApprove),
      credentialAction: cli === 'cursor',
    });
  }
  return rows;
}

function keyStatus(agent: PtahCliSummary): CliKeyStatus {
  if (agent.hasStoredKey) return { kind: 'key-set', label: 'Key set' };
  if (agent.hasApiKey) {
    return {
      kind: 'keyless',
      label:
        agent.providerId === SIGN_IN_PROVIDER_ID
          ? 'Cloud sign-in'
          : 'No key needed',
    };
  }
  return { kind: 'missing', label: 'No API key' };
}

function instanceRow(
  agent: PtahCliSummary,
  models: ProvidersCliModels | null,
  test: ProvidersCliTest | null,
): InstanceCliMatrixRow {
  const saved = models?.[agent.id];
  const mappings = saved?.tierMappings;
  return {
    kind: 'instance',
    id: agent.id,
    name: agent.name,
    status: agent.enabled ? INSTANCE_STATUS[agent.status] : DISABLED,
    enabled: agent.enabled,
    interactive: agent.enabled,
    providerId: agent.providerId,
    provider: agent.providerName,
    keyStatus: keyStatus(agent),
    tiers: saved
      ? TIERS.flatMap(({ tier, label }) => {
          const model = mappings?.[tier]?.trim();
          return model ? [{ tier, label, model }] : [];
        })
      : null,
    selectedModel: saved ? (saved.selectedModel ?? '') : null,
    lastTest:
      test?.id === agent.id
        ? {
            success: test.success,
            latencyMs: test.latencyMs,
            reason: test.reason,
          }
        : null,
    permission: cliPermissionNote('ptah-cli'),
  };
}

/**
 * Same rank rule as the Orchestration order list (`agent-orchestration-config.component.ts:380-389`): the
 * position in `preferredAgentOrder`, unranked ids after every ranked one, ties kept in input order.
 */
function byPreferredOrder<T extends { readonly id: string }>(
  rows: readonly T[],
  preferred: readonly string[],
): T[] {
  if (preferred.length === 0) return [...rows];
  const rank = (id: string): number => {
    const index = preferred.indexOf(id);
    return index === -1 ? preferred.length : index;
  };
  return [...rows].sort((a, b) => rank(a.id) - rank(b.id));
}

/**
 * Builds the CLI matrix rows: installed system CLIs and Ptah instances (detection order, then instance list
 * order, ranked by `preferredAgentOrder`), then the system CLIs detection reports as not installed.
 */
export function cliMatrixRows(sources: CliMatrixSources): CliMatrixRows {
  const system = sources.orchestration ? systemRows(sources.orchestration) : [];
  const instances = (sources.cliAgents ?? []).map((agent) =>
    instanceRow(agent, sources.cliModels, sources.cliTest),
  );
  return {
    installed: byPreferredOrder<CliMatrixRow>(
      [...system.filter((row) => row.installed), ...instances],
      sources.orchestration?.preferredAgentOrder ?? [],
    ),
    uninstalled: system.filter((row) => !row.installed),
  };
}
