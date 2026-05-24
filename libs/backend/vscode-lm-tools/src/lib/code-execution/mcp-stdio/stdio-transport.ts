/**
 * Stdio framing adapter for the MCP protocol core.
 *
 * Bridges the transport-agnostic {@link IMcpServer} contract from
 * `mcp-core/types/mcp-transport.types.ts` to a NDJSON JSON-RPC 2.0 stdio
 * loop supplied by the host CLI. The adapter does NOT own the JSON-RPC
 * server lifecycle — it borrows a notify-capable handle so the CLI command
 * (`apps/ptah-cli/src/cli/commands/mcp-serve.ts`) can keep registering its
 * own Ptah-flavored methods on the same wire.
 *
 * Hexagonal: the host JSON-RPC server is reached through the narrow
 * {@link McpStdioNotifier} port declared below so this lib stays free of
 * `apps/ptah-cli` imports.
 *
 * Responsibilities:
 *   - `start()` / `stop()` lifecycle markers (idempotent).
 *   - `notify(method, params)` — emits a JSON-RPC notification through the
 *     bound notifier (used for `notifications/initialized`,
 *     `notifications/progress`, `notifications/message`).
 *
 * Inbound MCP requests (`initialize`, `tools/list`, `tools/call`,
 * `notifications/cancelled`) are routed by the consumer via its own
 * `register(...)` API on the same notifier — see `StdioMcpServerService`.
 */

import type {
  IMcpServer,
  McpNotificationEmitter,
} from '../mcp-core/types/mcp-transport.types';

/**
 * Narrow outbound-notification port. The CLI's `JsonRpcServer.notify(...)`
 * satisfies this contract; tests can substitute a `jest.fn()`.
 */
export interface McpStdioNotifier {
  notify<TParams = unknown>(method: string, params?: TParams): Promise<void>;
}

export interface StdioTransportDeps {
  /**
   * JSON-RPC notifier already bound to stdin/stdout by the host CLI. The
   * transport adapter borrows it for outbound notifications; it does NOT
   * start or stop the underlying server.
   */
  notifier: McpStdioNotifier;
}

export class StdioTransport implements IMcpServer {
  private readonly notifier: McpStdioNotifier;
  private started = false;

  constructor(deps: StdioTransportDeps) {
    this.notifier = deps.notifier;
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  readonly notify: McpNotificationEmitter = async (method, params) => {
    if (!this.started) return;
    await this.notifier.notify(method, params);
  };

  isStarted(): boolean {
    return this.started;
  }
}
