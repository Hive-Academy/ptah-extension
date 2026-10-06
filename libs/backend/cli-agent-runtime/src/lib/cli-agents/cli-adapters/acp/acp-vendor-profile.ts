/**
 * AcpVendorProfile — the per-vendor data and small functions the ACP runner
 * (`createAcpSessionHandle`) needs. Everything vendor-specific lives here, so
 * the runner stays vendor-neutral and a further ACP agent is a new profile only.
 *
 * A profile holds no state and performs no I/O.
 *
 * Not supported by the runner yet, so a vendor that needs them needs a runner
 * change, not just a profile: `authenticate` (agents that advertise
 * `authMethods` must already be signed in), and `session/set_model` /
 * `session/set_mode` (model and effort travel through
 * `session/set_config_option` only).
 */
import type { McpServer } from '@agentclientprotocol/sdk';
import type { CliType } from '@ptah-extension/shared';
import type { CliCommandOptions } from '../cli-adapter.interface';

/**
 * How the runner re-attaches to an earlier session when
 * `options.resumeSessionId` is set:
 * - `resume`: `session/resume` when the agent advertises
 *   `sessionCapabilities.resume` (no history replay);
 * - `load`: `session/load` when the agent advertises `loadSession` (history is
 *   replayed; every update flagged `_meta.isReplay` is dropped);
 * - `resume-then-load`: `resume` first, `load` when resume is unsupported or fails;
 * - `none`: never re-attach; always start a new session.
 *
 * Any failure falls back to `session/new` with an `info` segment.
 */
export type AcpResumeStrategy = 'resume' | 'load' | 'resume-then-load' | 'none';

/**
 * One `session/set_config_option` call the profile wants before the first prompt.
 *
 * `binding: true` marks a setting the turn cannot run without (e.g. the
 * model): it is sent even when its value is not advertised, and a rejection
 * fails the turn. Any other entry is a hint: an unadvertised value is skipped
 * and a rejection only emits an info.
 */
export type AcpSessionConfigEntry =
  | {
      readonly configId: string;
      readonly value: string;
      readonly binding?: boolean;
    }
  | {
      readonly configId: string;
      readonly value: boolean;
      readonly binding?: boolean;
    };

/** The ACP request that failed, as seen by {@link AcpVendorProfile.describeError}. */
export type AcpRequestMethod =
  | 'initialize'
  | 'session/new'
  | 'session/resume'
  | 'session/load'
  | 'session/set_config_option'
  | 'session/prompt';

/** A JSON-RPC error answer to one of the runner's requests, with its context. */
export interface AcpRequestFailure {
  readonly method: AcpRequestMethod;
  /** JSON-RPC error code, e.g. `-32602` (invalid params). */
  readonly code: number;
  readonly message: string;
  /** JSON-RPC error data: a string, an object (usually with `message`), or absent. */
  readonly data?: unknown;
  /** Set for `session/set_config_option`: the option and value that were refused. */
  readonly configId?: string;
  readonly configValue?: string | boolean;
  /** Set for `session/set_config_option`: the values the session advertised for that option. */
  readonly advertisedValues?: readonly string[];
  /** The lane's options, so a message can name the setting a value came from. */
  readonly options: CliCommandOptions;
}

/** How to start the agent: the argv after the binary, plus optional extra environment. */
export interface AcpSpawnSpec {
  /** E.g. `['agent', 'stdio']`. */
  readonly args: readonly string[];
  /**
   * Variables merged over the inherited environment (the same merge `spawnCli`
   * applies for every lane). Omit to inherit the host environment unchanged.
   */
  readonly env?: Readonly<Record<string, string>>;
}

export interface AcpVendorProfile {
  /** The lane type this profile serves. */
  readonly vendor: CliType;
  /** Human name used in every message, e.g. "Grok". */
  readonly displayName: string;
  readonly resumeStrategy: AcpResumeStrategy;
  /**
   * The argv after the binary and any lane-specific environment. The model and
   * effort never go here: they are applied through {@link sessionConfig},
   * because a vendor may ignore the flags silently.
   */
  buildSpawn(options: CliCommandOptions): AcpSpawnSpec;
  /** The MCP servers attached on `session/new`, `session/resume` and `session/load`. */
  buildMcpServers(options: CliCommandOptions): readonly McpServer[];
  /** Optional `_meta` for `session/new`. */
  sessionMeta?(options: CliCommandOptions): Record<string, unknown> | undefined;
  /**
   * Config to apply after session setup and before the first prompt. Entries
   * whose `configId` the session did not advertise are skipped with an `info`.
   */
  sessionConfig?(options: CliCommandOptions): readonly AcpSessionConfigEntry[];
  /**
   * Vendor extension notifications to ignore silently (for example a vendor
   * namespace such as `_vendor/*`). Omit to report every unknown method once.
   */
  isExtensionNotification?(method: string): boolean;
  /** Exit code of a completed `execute` tool call, read from its `rawOutput`. */
  extractExitCode?(rawOutput: unknown): number | undefined;
  /**
   * A user-facing message for a JSON-RPC error answer, e.g. a sign-in or
   * model hint. Return `undefined` to use the runner's generic message.
   */
  describeError?(failure: AcpRequestFailure): string | undefined;
}

/**
 * The human-readable detail of a JSON-RPC error `data` field: the string
 * itself, or the `message` of an object. An agent may use both shapes for the
 * same error.
 */
export function readAcpErrorDetail(data: unknown): string | undefined {
  if (typeof data === 'string') {
    return data.trim() || undefined;
  }
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const message = (data as Record<string, unknown>)['message'];
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }
  return undefined;
}
