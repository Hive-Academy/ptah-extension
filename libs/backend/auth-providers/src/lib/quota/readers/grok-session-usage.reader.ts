/** Local usage for one Grok session that Ptah already started. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { PlanLocalUsage } from '@ptah-extension/shared';
import type { PlanUsageReader, PlanUsageReading } from './plan-usage-reader.types';

export const GROK_USAGE_TIMEOUT_MS = 5_000;

const UsageSchema = z.object({
  tokens: z.union([z.number().nonnegative(), z.object({ total: z.number().nonnegative() })]),
  cost: z.union([z.number().nonnegative(), z.object({ total: z.number().nonnegative() })]),
});

export type GrokCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<string>;

export function createGrokSessionUsageReader(
  logger: Logger,
  now: () => number = Date.now,
  run: GrokCommandRunner = defaultRun,
): PlanUsageReader {
  return async ({ target, signal }) => {
    // No id means no command: this reader never lists, searches, or reads sessions.
    if (
      !target.cliSessionId ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(target.cliSessionId) ||
      signal?.aborted
    )
      return unavailable();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), GROK_USAGE_TIMEOUT_MS);
    try {
      const parsed = UsageSchema.safeParse(
        JSON.parse(await run('grok', ['usage', target.cliSessionId], controller.signal)),
      );
      if (!parsed.success) {
        logger.warn('[PlanUsage] local usage response rejected', {
          providerId: 'grok',
          reason: parsed.error.issues[0]?.code ?? 'invalid',
        });
        return unavailable();
      }
      const usage = localUsage(parsed.data, now());
      return {
        status: 'available',
        fetchedAt: usage.observedAt,
        windowSetEstablished: false,
        windows: [],
        localUsage: usage,
      };
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}

function localUsage(value: z.infer<typeof UsageSchema>, observedAt: number): PlanLocalUsage {
  return {
    kind: 'local-usage',
    label: 'Session usage: tokens & cost',
    tokens: typeof value.tokens === 'number' ? value.tokens : value.tokens.total,
    estimatedCostUsd: typeof value.cost === 'number' ? value.cost : value.cost.total,
    observedAt,
    source: 'local-cli',
  };
}

function unavailable(): PlanUsageReading {
  return { status: 'service-unavailable', windowSetEstablished: false, windows: [] };
}

const execFileAsync = promisify(execFile);
function defaultRun(command: string, args: readonly string[], signal: AbortSignal): Promise<string> {
  if (process.platform === 'win32') {
    // The session id was allow-listed above before it reaches cmd.exe.
    return execFileAsync('cmd.exe', ['/d', '/s', '/c', command, ...args], {
      signal,
      windowsHide: true,
    }).then(({ stdout }) => stdout);
  }
  return execFileAsync(command, [...args], { signal, windowsHide: true }).then(({ stdout }) => stdout);
}
