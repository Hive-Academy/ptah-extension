/**
 * MCP Server Backoff Service — Tracks failed stdio/HTTP MCP servers and computes
 * exponential back-off to prevent runaway subprocess spawning on consecutive sessions.
 *
 * Background:
 * When an MCP server declared in `.mcp.json` fails to connect (e.g. `firecrawl` timing
 * out after 30,000ms), Claude CLI gives up on the connection but leaves orphaned processes
 * running. Subsequent sessions attempt to spawn the failing server again, accumulating
 * leaked process trees.
 *
 * This service records failures from:
 * 1. SDK system `init` messages where `mcp_servers` reports `status: 'failed'`.
 * 2. CLI stderr lines matching connection timeout/failure patterns.
 * 3. Explicit programmatic failure notifications.
 *
 * While a server is in its back-off period, it is suppressed via `disabledMcpjsonServers`
 * and `deniedMcpServers` in the flag-tier settings, preventing Claude CLI from re-spawning it.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '../di/tokens';
import type { SessionMcpStatusCallbackRegistry } from './session-mcp-status-callback-registry';

export interface McpServerBackoffRecord {
  readonly serverName: string;
  readonly failureCount: number;
  readonly lastFailedAt: number;
  readonly backoffUntil: number;
}

export interface McpServerBackoffOptions {
  /** Initial backoff duration in milliseconds. Defaults to 60,000 (1 minute). */
  readonly initialBackoffMs?: number;
  /** Maximum backoff duration in milliseconds. Defaults to 1,800,000 (30 minutes). */
  readonly maxBackoffMs?: number;
  /** Multiplier for exponential backoff. Defaults to 2. */
  readonly backoffFactor?: number;
  /** Maximum number of tracked servers to prevent unbounded map growth. Defaults to 100. */
  readonly maxTrackedServers?: number;
}

export const DEFAULT_INITIAL_BACKOFF_MS = 60_000;
export const DEFAULT_MAX_BACKOFF_MS = 1_800_000;
export const DEFAULT_BACKOFF_FACTOR = 2;
export const DEFAULT_MAX_TRACKED_SERVERS = 100;

/**
 * Regex to detect connection failure / timeout notices in CLI stderr.
 * Example: `firecrawl (CONNECT_TIMEOUT): connection timed out after 30000ms`
 */
export const STDERR_MCP_FAILURE_PATTERN =
  /\b([a-zA-Z0-9_-]+)\s*\((?:CONNECT_TIMEOUT|CONNECTION_FAILED|ECONNREFUSED|ENOTFOUND)\)/i;

@injectable()
export class McpServerBackoffService {
  private readonly records = new Map<string, McpServerBackoffRecord>();
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly backoffFactor: number;
  private readonly maxTrackedServers: number;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_MCP_STATUS_CALLBACK_REGISTRY, {
      isOptional: true,
    })
    private readonly mcpStatus?: SessionMcpStatusCallbackRegistry,
    options?: McpServerBackoffOptions,
  ) {
    this.initialBackoffMs =
      options?.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options?.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.backoffFactor = options?.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
    this.maxTrackedServers =
      options?.maxTrackedServers ?? DEFAULT_MAX_TRACKED_SERVERS;

    if (this.mcpStatus) {
      this.mcpStatus.register((event) => {
        if (event.kind === 'servers') {
          for (const server of event.servers) {
            if (server.status === 'failed') {
              this.recordFailure(server.name);
            } else if (server.status === 'connected') {
              this.recordSuccess(server.name);
            }
          }
        }
      });
    }
  }

  /**
   * Record a server connection/init failure and compute exponential back-off.
   * Returns epoch timestamp (millis) until which the server should be suppressed.
   */
  recordFailure(serverName: string, now: number = Date.now()): number {
    const trimmed = serverName.trim();
    if (!trimmed) return now;

    const existing = this.records.get(trimmed);
    const failureCount = (existing?.failureCount ?? 0) + 1;
    const duration = Math.min(
      this.maxBackoffMs,
      Math.round(
        this.initialBackoffMs *
          Math.pow(this.backoffFactor, failureCount - 1),
      ),
    );
    const backoffUntil = now + duration;

    this.pruneIfOversized();

    const record: McpServerBackoffRecord = {
      serverName: trimmed,
      failureCount,
      lastFailedAt: now,
      backoffUntil,
    };
    this.records.set(trimmed, record);

    this.logger.warn(
      `[McpServerBackoffService] Recorded failure #${failureCount} for MCP server '${trimmed}'. ` +
        `Backing off for ${Math.round(duration / 1000)}s until ${new Date(backoffUntil).toISOString()}`,
    );

    return backoffUntil;
  }

  /**
   * Record a successful connection, clearing any existing backoff for this server.
   */
  recordSuccess(serverName: string): void {
    const trimmed = serverName.trim();
    if (!trimmed) return;
    if (this.records.has(trimmed)) {
      this.records.delete(trimmed);
      this.logger.debug(
        `[McpServerBackoffService] Cleared backoff for MCP server '${trimmed}' after successful connection`,
      );
    }
  }

  /**
   * Inspect stderr chunk from CLI for connection failure patterns (e.g. CONNECT_TIMEOUT).
   * If detected, records failure and returns the server name.
   */
  checkStderrForFailure(data: string, now: number = Date.now()): string | null {
    if (!data) return null;
    const match = data.match(STDERR_MCP_FAILURE_PATTERN);
    if (!match) return null;
    const serverName = match[1];
    this.recordFailure(serverName, now);
    return serverName;
  }

  /**
   * Whether a server is currently in back-off period.
   */
  isBackingOff(serverName: string, now: number = Date.now()): boolean {
    const trimmed = serverName.trim();
    const record = this.records.get(trimmed);
    if (!record) return false;
    return now < record.backoffUntil;
  }

  /**
   * Get all server names currently backing off.
   */
  getBackingOffServers(now: number = Date.now()): string[] {
    const active: string[] = [];
    for (const [name, record] of this.records.entries()) {
      if (now < record.backoffUntil) {
        active.push(name);
      }
    }
    return active;
  }

  /**
   * Get specific server record for inspection.
   */
  getRecord(serverName: string): McpServerBackoffRecord | undefined {
    return this.records.get(serverName.trim());
  }

  /**
   * Clear all records or a specific server record.
   */
  clear(serverName?: string): void {
    if (serverName) {
      this.records.delete(serverName.trim());
    } else {
      this.records.clear();
    }
  }

  /**
   * Number of tracked servers.
   */
  get size(): number {
    return this.records.size;
  }

  private pruneIfOversized(): void {
    if (this.records.size < this.maxTrackedServers) return;
    const now = Date.now();
    for (const [name, record] of this.records.entries()) {
      if (now >= record.backoffUntil) {
        this.records.delete(name);
      }
    }
    if (this.records.size >= this.maxTrackedServers) {
      const oldestKey = this.records.keys().next().value;
      if (oldestKey !== undefined) {
        this.records.delete(oldestKey);
      }
    }
  }
}
