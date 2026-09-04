/**
 * SessionMcpStatusCallbackRegistry — fan-out for what the CLI says about a
 * session's MCP servers (TASK_2026_375 B4.2).
 *
 * ## Two producers, one channel
 *
 * `StreamTransformer` emits a `servers` payload from the SDK system `init`
 * message, which carries `mcp_servers: [{ name, status }]`. `SdkQueryOptionsBuilder`
 * emits a `notice` payload from the CLI's stderr, which writes one sentence at
 * session start when a third-party auth source takes precedence over the user's
 * claude.ai login. The two arrive from different places and cannot be merged at
 * source, so they share the payload union and the consumer folds them together.
 *
 * ## Why a registry and not a `StreamTransformConfig` callback
 *
 * The two producers sit on opposite sides of the session-start path.
 * `StreamTransformer` receives a config object built by `SdkAgentAdapter`;
 * `SdkQueryOptionsBuilder` receives a `QueryOptionsInput` built by
 * `SessionQueryExecutor`. Threading one callback through both would mean
 * widening `IAgentAdapter` — a port shared with `cli-agent-runtime`,
 * `platform-vscode` and `platform-electron` — for a signal no host wires
 * differently. `SessionIdResolvedCallbackRegistry` is the precedent for exactly
 * this shape, and both producers are already `@injectable`, so the registry is
 * one constructor parameter on each and no port change at all.
 *
 * ## Ordering
 *
 * This is NOT turn state. `agent-sdk/CLAUDE.md` forbids a `MESSAGE_TYPES` push
 * for turn state because of the three-channel race; MCP status is exempt for a
 * structural reason rather than an exception — it is emitted once per session at
 * init, it never changes mid-turn, and nothing in the chunk stream depends on
 * its arrival order.
 *
 * `notifyAll` dispatches synchronously with a per-subscriber try/catch, from
 * {@link CallbackRegistryBase}. Both producers sit on the SDK's own paths, so a
 * subscriber must not block: treat the handler as synchronous.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  SessionMcpNotice,
  SessionMcpServerEntry,
} from '@ptah-extension/shared';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

/** The SDK `init` message reported this session's MCP servers. */
export interface SessionMcpServersPayload {
  readonly kind: 'servers';
  /**
   * The id the session is streaming under. Before the SDK reports the real
   * UUID this is the tabId, so a consumer must re-key on
   * `SessionIdResolvedCallbackRegistry`.
   */
  readonly sessionId: string;
  readonly servers: readonly SessionMcpServerEntry[];
}

/** The CLI wrote an informational line to stderr at session start. */
export interface SessionCliNoticePayload {
  readonly kind: 'notice';
  /** See {@link SessionMcpServersPayload.sessionId}. */
  readonly sessionId: string;
  readonly notice: SessionMcpNotice;
}

export type SessionMcpStatusEvent =
  | SessionMcpServersPayload
  | SessionCliNoticePayload;

export type SessionMcpStatusRegistryCallback =
  CallbackRegistryCallback<SessionMcpStatusEvent>;

@injectable()
export class SessionMcpStatusCallbackRegistry extends CallbackRegistryBase<SessionMcpStatusEvent> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'SessionMcpStatusCallbackRegistry');
  }
}

/**
 * The one stderr line Ptah surfaces, and the code it maps to.
 *
 * Matched case-insensitively on a substring rather than the full sentence: the
 * CLI owns the wording and has already reworded the tail of it once. The
 * message stored is the CLI's own chunk, trimmed — never a sentence Ptah made
 * up, so a reworded notice still reads correctly in the popover.
 */
export const CLAUDE_AI_CONNECTORS_DISABLED_MARKER =
  'claude.ai connectors are disabled';

/**
 * Classify one stderr chunk. Returns `null` for every chunk that is not a
 * notice Ptah surfaces — which is almost all of them.
 */
export function classifyCliNotice(chunk: string): SessionMcpNotice | null {
  if (
    !chunk
      .toLowerCase()
      .includes(CLAUDE_AI_CONNECTORS_DISABLED_MARKER.toLowerCase())
  ) {
    return null;
  }
  return {
    code: 'claude-ai-connectors-disabled',
    message: chunk.trim(),
  };
}
