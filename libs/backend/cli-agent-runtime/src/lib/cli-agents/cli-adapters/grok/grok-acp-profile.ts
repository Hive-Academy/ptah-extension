/**
 * GrokAcpProfile — the vendor data the ACP runner needs to drive
 * `grok agent --no-leader stdio` (TASK_2026_617).
 *
 * Measured against grok 1.0.46 (`acp-batch0-probe.md`, `grok-probe.md`):
 * - argv is `agent --no-leader stdio`. Options precede the `stdio` subcommand,
 *   and `--no-leader` is mandatory: without it the child attaches to a shared
 *   leader process (`~/.grok/leader.sock`) that outlives the lane.
 * - `-m` is silently ignored by `grok agent stdio`, and `--reasoning-effort`
 *   belongs to the same subcommand and was never probed. The model and the
 *   effort therefore travel through `session/set_config_option`
 *   (`configId` `model` and `reasoning_effort`), which the runner applies only
 *   when the session advertises that option.
 * - Permissions: the lane spawns WITHOUT `--always-approve` and the runner's
 *   policy answers each `session/request_permission` with the `allow_once`
 *   option. Documented fallback, deliberately not wired: inserting
 *   `--always-approve` before `--no-leader` makes Grok approve every tool
 *   itself, at the cost of the per-request policy (and of `autoApprove: false`).
 * - No per-lane environment: Grok reads `~/.grok/auth.json` or an inherited
 *   `XAI_API_KEY`, so the host environment is passed through unchanged.
 * - `_x.ai/*` (and `x.ai/*`) notifications are vendor extensions, e.g. the
 *   `retry_state` notices before a rate-limit error; they are ignored.
 */
import type { McpServer } from '@agentclientprotocol/sdk';
import type {
  CliCommandOptions,
  LaneModelSource,
} from '../cli-adapter.interface';
import { ptahMcpServerUrl } from '../ptah-mcp-url';
import { mapEffortToGrok } from '../../lane-spawn-policy';
import { readAcpErrorDetail } from '../acp';
import type {
  AcpRequestFailure,
  AcpSessionConfigEntry,
  AcpSpawnSpec,
  AcpVendorProfile,
} from '../acp';

/** JSON-RPC codes Grok answers with, as captured in the `grok-p3-*` fixtures. */
const GROK_RATE_LIMITED = -32003;
const GROK_AUTH_REQUIRED = -32000;
const JSONRPC_INVALID_PARAMS = -32602;

const GROK_ARGS: readonly string[] = ['agent', '--no-leader', 'stdio'];

const EXTENSION_NOTIFICATION = /^_?x\.ai\//;

/** Where a rejected model came from, worded for the user. */
function describeModelSource(source: LaneModelSource | undefined): string {
  switch (source) {
    case 'request':
      return 'the spawn request';
    case 'setting':
      return 'the `agentOrchestration.grokModel` setting';
    case 'ptah-default':
      return "Ptah's lane default";
    case 'cli-default':
      return "Grok's own default";
    default:
      return 'the `agentOrchestration.grokModel` setting or the spawn request';
  }
}

function describeGrokError(failure: AcpRequestFailure): string | undefined {
  const detail = readAcpErrorDetail(failure.data);

  if (
    failure.code === GROK_RATE_LIMITED &&
    failure.method === 'session/prompt'
  ) {
    return `Grok is rate limited: ${detail ?? failure.message}`;
  }

  if (
    failure.code === GROK_AUTH_REQUIRED &&
    (failure.method === 'session/new' || failure.method === 'session/resume')
  ) {
    return 'Grok is not signed in: run `grok login` or set XAI_API_KEY';
  }

  if (
    failure.code === JSONRPC_INVALID_PARAMS &&
    failure.method === 'session/set_config_option' &&
    failure.configId === 'model'
  ) {
    const model = String(failure.configValue ?? failure.options.model ?? '');
    const rejected = `Grok rejected model '${model}' (from ${describeModelSource(failure.options.modelSource)})`;
    const available = failure.advertisedValues ?? [];
    return available.length > 0
      ? `${rejected}; available models: ${available.join(', ')}`
      : `${rejected}; run \`grok models\` to see the available models`;
  }

  return undefined;
}

export const grokAcpProfile: AcpVendorProfile = {
  vendor: 'grok',
  displayName: 'Grok',
  resumeStrategy: 'resume',

  buildSpawn(): AcpSpawnSpec {
    return { args: GROK_ARGS };
  },

  buildMcpServers(options: CliCommandOptions): readonly McpServer[] {
    if (!options.mcpPort) return [];
    return [
      {
        type: 'http',
        name: 'ptah',
        url: ptahMcpServerUrl(
          options.mcpPort,
          options.workingDirectory,
          options.agentId,
        ),
        headers: [],
      },
    ];
  },

  sessionConfig(options: CliCommandOptions): readonly AcpSessionConfigEntry[] {
    const entries: AcpSessionConfigEntry[] = [];
    if (options.model) {
      entries.push({ configId: 'model', value: options.model });
    }
    const effort = options.reasoningEffort
      ? mapEffortToGrok(options.reasoningEffort)
      : undefined;
    if (effort) {
      entries.push({ configId: 'reasoning_effort', value: effort });
    }
    return entries;
  },

  isExtensionNotification(method: string): boolean {
    return EXTENSION_NOTIFICATION.test(method);
  },

  /**
   * Informational only: the probe found Grok does not preserve the real exit
   * code of a shell tool call in `rawOutput`.
   */
  extractExitCode(rawOutput: unknown): number | undefined {
    if (typeof rawOutput !== 'object' || rawOutput === null) return undefined;
    const code = (rawOutput as Record<string, unknown>)['exit_code'];
    return typeof code === 'number' && Number.isFinite(code) ? code : undefined;
  },

  describeError: describeGrokError,
};
