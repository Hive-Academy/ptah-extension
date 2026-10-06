/**
 * Grok CLI Adapter (`grok`) — Agent Client Protocol (TASK_2026_617)
 *
 * Runs xAI's Grok CLI as `grok agent --no-leader stdio`: one long-lived ACP
 * agent process per lane, driven by the vendor-neutral ACP runner
 * (`createAcpSessionHandle`). Everything Grok-specific — argv, the Ptah MCP
 * entry, model and effort through `session/set_config_option`, the extension
 * namespace and the error wording — lives in `grokAcpProfile`.
 *
 * Messaging: an ACP agent queues a prompt sent mid-turn instead of injecting
 * it, and `session/cancel` ends the turn rather than pausing it, so there is no
 * steer and no interrupt. A further message is a new `session/prompt` on the
 * same session (continuation).
 *
 * Credentials are Grok's own (`grok login` → `~/.grok/auth.json`, or an
 * inherited `XAI_API_KEY`); Ptah stores none and passes no per-lane env.
 */
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AgentMessagingCapabilities,
  CliAdapter,
  CliCommandOptions,
  CliModelInfo,
  SdkHandle,
} from './cli-adapter.interface';
import { bestMessagingCapability } from './cli-adapter.interface';
import {
  probeCliVersion,
  resolveCliPath,
  spawnCli,
  stripAnsiCodes,
} from './cli-adapter.utils';
import { createAcpSessionHandle } from './acp';
import { grokAcpProfile } from './grok/grok-acp-profile';

/** `grok models` must answer within this, or the model list is empty. */
const GROK_MODELS_TIMEOUT_MS = 8000;

/** A model id as `grok models` prints it (e.g. `grok-4.7`). */
const MODEL_ID = /^[A-Za-z0-9][\w.:/-]*$/;

/**
 * Parse `grok models` text output (grok 1.0.46 has no `--json`):
 *
 * ```
 * You are logged in with grok.com.
 *
 * Default model: grok-4.7
 *
 * Available models:
 *   * grok-4.7 (default)
 * ```
 *
 * Each indented row under `Available models:` is `<marker> <id>[ (default)]`;
 * the marker of a non-default row was not observed, so any leading `*`/`-`
 * marker is optional. With no model rows, the `Default model:` value alone is
 * returned. Anything unrecognised yields an empty list; this never throws.
 */
export function parseGrokModels(raw: string): CliModelInfo[] {
  const lines = stripAnsiCodes(raw).split(/\r?\n/);
  const ids: string[] = [];
  let defaultId: string | undefined;
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const defaultMatch = /^Default model:\s*(\S+)\s*$/i.exec(trimmed);
    if (defaultMatch && MODEL_ID.test(defaultMatch[1])) {
      defaultId = defaultMatch[1];
      continue;
    }
    if (/^Available models:\s*$/i.test(trimmed)) {
      inList = true;
      continue;
    }
    if (!inList || trimmed === '') continue;
    if (!/^\s/.test(line)) {
      // A non-indented line ends the list.
      inList = false;
      continue;
    }
    const row = /^(?:[*\->•]\s*)?(\S+)(?:\s+\(default\))?\s*$/.exec(trimmed);
    if (row && MODEL_ID.test(row[1]) && !ids.includes(row[1])) {
      ids.push(row[1]);
    }
  }

  if (ids.length === 0 && defaultId) ids.push(defaultId);
  return ids.map((id) => ({ id, name: id }));
}

export class GrokCliAdapter implements CliAdapter {
  readonly name = 'grok' as const;
  readonly displayName = 'Grok';
  readonly roleChannel = 'task-prompt' as const;
  /** The Ptah MCP server is attached per session through `session/new.mcpServers`. */
  readonly supportsMcp = true;

  /**
   * @param spawner - Off-thread process spawner from `CliDetectionService`
   *   (TASK_2026_367); without it each spawn runs `cross-spawn` inline.
   * @param logger - Receives the ACP runner's raw failure detail.
   */
  constructor(
    private readonly spawner?: IProcessSpawner,
    private readonly logger?: Logger,
  ) {}

  async detect(): Promise<CliDetectionResult> {
    const messagingMode = bestMessagingCapability(this.capabilities());
    try {
      const binaryPath = await resolveCliPath('grok');
      if (!binaryPath) {
        return { cli: 'grok', installed: false, messagingMode };
      }
      const version = await probeCliVersion(
        binaryPath,
        undefined,
        undefined,
        this.spawner,
      );
      return {
        cli: 'grok',
        installed: true,
        path: binaryPath,
        version,
        messagingMode,
      };
    } catch {
      return { cli: 'grok', installed: false, messagingMode };
    }
  }

  /** A mid-turn message is queued and delivered as the next prompt on the session. */
  capabilities(): AgentMessagingCapabilities {
    return { steer: false, interrupt: false, continuation: true };
  }

  parseOutput(raw: string): string {
    return stripAnsiCodes(raw);
  }

  /** The models `grok models` lists; empty when the probe fails or prints something unrecognised. */
  async listModels(): Promise<CliModelInfo[]> {
    const binaryPath = (await resolveCliPath('grok')) ?? 'grok';
    const raw = await this.probeModels(binaryPath);
    return raw ? parseGrokModels(raw) : [];
  }

  /** Run `grok models` and capture stdout. Never throws: undefined on timeout, error or no output. */
  private probeModels(binary: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      let spawned: ReturnType<typeof spawnCli> | undefined;
      try {
        spawned = spawnCli(binary, ['models'], { spawner: this.spawner });
      } catch (error: unknown) {
        // spawnCli refuses an over-long command line synchronously.
        this.logger?.warn('[GrokCliAdapter] grok models could not start', {
          command: binary,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (!spawned) {
        resolve(undefined);
        return;
      }
      const child = spawned;
      let stdout = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve(undefined);
      }, GROK_MODELS_TIMEOUT_MS);

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (data: string) => {
        stdout += data;
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve(stdout.trim() || undefined);
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
  }

  /**
   * `~/.grok/auth.json`, written by `grok login`. Prefers $HOME / $USERPROFILE
   * over os.homedir() so tests that reassign HOME are honoured (as Pi and Codex do).
   */
  private static getAuthPath(): string {
    const home = process.env['HOME'] || process.env['USERPROFILE'] || homedir();
    return join(home, '.grok', 'auth.json');
  }

  /**
   * Whether Grok has usable credentials: `~/.grok/auth.json` exists and parses,
   * or `XAI_API_KEY` is set. Nothing is refreshed; Grok manages its own login.
   */
  async ensureTokensFresh(): Promise<boolean> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(GrokCliAdapter.getAuthPath(), 'utf8'),
      );
      if (typeof parsed === 'object' && parsed !== null) return true;
    } catch {
      // Missing or malformed auth.json: fall through to the env-var check.
    }
    return !!process.env['XAI_API_KEY'];
  }

  /**
   * Spawn `grok agent --no-leader stdio` and return its ACP session handle at
   * once; the handshake and the first prompt run inside `done`. The transport
   * resolves a Windows `.cmd` wrapper itself.
   */
  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    return createAcpSessionHandle({
      profile: grokAcpProfile,
      options,
      command: options.binaryPath ?? 'grok',
      spawner: this.spawner,
      logger: this.logger,
    });
  }
}
