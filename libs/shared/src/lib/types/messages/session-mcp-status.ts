/**
 * Session MCP status — what the CLI reported about this session's MCP servers.
 *
 * ## Where the data comes from
 *
 * The SDK's system `init` message carries `mcp_servers: [{ name, status }]`,
 * once per session, before the first assistant token. Ptah read it, logged it
 * at debug level and dropped it (TASK_2026_375 F4) — so a Smithery server the
 * CLI itself reported as `needs-auth` looked "Installed" everywhere in the UI
 * and simply had no tools.
 *
 * The CLI also writes one line to stderr at session start when a third-party
 * auth source is active:
 *
 *   claude.ai connectors are disabled because ANTHROPIC_API_KEY or another
 *   auth source is set and takes precedence over your claude.ai login
 *
 * That is INFORMATION, not a failure: the user's Gmail / Calendar / Drive /
 * Canva connectors live in their claude.ai account, and Ptah cannot configure
 * them. It can only say why they are absent. `notices` carries that sentence.
 *
 * ## Why this is not turn state
 *
 * `agent-sdk/CLAUDE.md` forbids a `MESSAGE_TYPES` push for TURN STATE, because
 * the three-channel race (`session:turnEnded` direct, chunks batched,
 * `session:stats` direct) is exactly the defect the in-stream `turn_state`
 * event replaced. MCP status is not turn state: it arrives ONCE per session at
 * init, it never changes mid-turn, and nothing in the chunk stream depends on
 * its arrival order. So it rides the same direct channel `session:stats` uses.
 */

/**
 * Status of one MCP server as the CLI reported it.
 *
 * The SDK types this field as a bare `string`
 * (`SDKSystemMessage.mcp_servers[].status`), and the value set is the CLI's,
 * not ours — so the union names the values observed in the field and keeps
 * `string` open for one we have not seen. `(string & {})` is what preserves
 * editor completion for the named members; a plain `| string` would collapse
 * the whole union to `string`.
 */
export type SessionMcpServerStatus =
  | 'connected'
  | 'failed'
  | 'needs-auth'
  | 'pending'
  | 'disabled'
  | (string & {});

/** One MCP server entry from the session `init` message. */
export interface SessionMcpServerEntry {
  /** Server key as the session knows it — the `mcpServersOverride` map key. */
  readonly name: string;
  /** Status the CLI reported. See {@link SessionMcpServerStatus}. */
  readonly status: SessionMcpServerStatus;
}

/**
 * Codes for a CLI notice worth surfacing.
 *
 * Deliberately a closed union: a notice is rendered as prose the UI writes
 * itself, so an unknown code has nothing to render.
 *
 * - `claude-ai-connectors-disabled` — the CLI's own stderr line (see above).
 * - `capability-policy-unverified` — Ptah could not read the capability
 *   toggle policy for this workspace, so the session was built fail-closed:
 *   only Ptah's own MCP tools, no skills (TASK_2026_560, AC-4.6). The message
 *   names the unreadable file and the reason.
 */
export type SessionMcpNoticeCode =
  | 'claude-ai-connectors-disabled'
  | 'capability-policy-unverified';

/** One informational notice the CLI emitted at session start. */
export interface SessionMcpNotice {
  readonly code: SessionMcpNoticeCode;
  /** The CLI's own sentence, kept verbatim for the tooltip. */
  readonly message: string;
}

/** Payload of the `session:mcpStatus` message. */
export interface SessionMcpStatusPayload {
  /**
   * The id the webview routes on. Before the SDK reports the real UUID this is
   * the tabId, and the backend re-keys the record when the UUID arrives — so a
   * consumer should match on either.
   */
  readonly sessionId: string;
  readonly servers: readonly SessionMcpServerEntry[];
  readonly notices: readonly SessionMcpNotice[];
}

/**
 * Every {@link SessionMcpNoticeCode}, for the parser. Typed as a `Record` so a
 * code added to the union without a key here is a compile error — otherwise
 * the parser would silently drop the new notice.
 */
const NOTICE_CODE_SET: Record<SessionMcpNoticeCode, true> = {
  'claude-ai-connectors-disabled': true,
  'capability-policy-unverified': true,
};
const NOTICE_CODES: readonly string[] = Object.keys(NOTICE_CODE_SET);

/**
 * Hand-written parser for the `session:mcpStatus` wire payload.
 *
 * Hand-written rather than Zod on purpose: this runs in the webview, and
 * TASK_2026_187 Unit 10 removed the 304 kB Zod runtime from the initial
 * bundle. The backend boundary keeps its Zod schema
 * (`SessionMcpStatusPayloadSchema` in `./schemas`).
 *
 * Returns `null` for anything that is not the expected shape. Unknown server
 * status values pass through — the status set belongs to the CLI, not to us.
 */
export function parseSessionMcpStatusPayload(
  payload: unknown,
): SessionMcpStatusPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw['sessionId'] !== 'string' || raw['sessionId'].length === 0) {
    return null;
  }
  if (!Array.isArray(raw['servers']) || !Array.isArray(raw['notices'])) {
    return null;
  }

  const servers: SessionMcpServerEntry[] = [];
  for (const entry of raw['servers']) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    if (
      typeof item['name'] !== 'string' ||
      typeof item['status'] !== 'string'
    ) {
      return null;
    }
    servers.push({ name: item['name'], status: item['status'] });
  }

  const notices: SessionMcpNotice[] = [];
  for (const entry of raw['notices']) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    if (
      typeof item['code'] !== 'string' ||
      typeof item['message'] !== 'string'
    ) {
      return null;
    }
    // An unknown code has no prose to render, so drop it rather than reject
    // the whole payload — the server list next to it is still worth showing.
    if (!NOTICE_CODES.includes(item['code'])) continue;
    notices.push({
      code: item['code'] as SessionMcpNoticeCode,
      message: item['message'],
    });
  }

  return { sessionId: raw['sessionId'], servers, notices };
}
