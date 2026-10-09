/** Local OpenCode accounting; this is not provider plan telemetry. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { PlanLocalUsage } from '@ptah-extension/shared';
import type { PlanUsageReader, PlanUsageReading } from './plan-usage-reader.types';

export const OPENCODE_USAGE_TIMEOUT_MS = 5_000;

const StatsSchema = z.object({
  range: z.union([
    z.string(),
    z.object({
      from: z.number().finite(),
      to: z.number().finite(),
    }),
  ]).optional(),
  tokens: z.object({
    input: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    reasoning: z.number().nonnegative().optional(),
    cache: z.union([
      z.number().nonnegative(),
      z.object({
        read: z.number().nonnegative().optional(),
        write: z.number().nonnegative().optional(),
      }),
    ]).optional(),
  }),
  cost: z.union([
    z.number().nonnegative(),
    z.object({ total: z.number().nonnegative() }),
  ]),
});

export type OpenCodeCommandRunner = (
  command: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<string>;

export function createOpenCodeLocalUsageReader(
  logger: Logger,
  now: () => number = Date.now,
  run: OpenCodeCommandRunner = defaultRun,
): PlanUsageReader {
  return async ({ signal, localUsageDays }) => {
    if (signal?.aborted) return unavailable();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), OPENCODE_USAGE_TIMEOUT_MS);
    try {
      const days = validDays(localUsageDays);
      const stdout = await run(
        'opencode',
        ['stats', '--json', '--cost', ...(days === undefined ? [] : ['--days', String(days)])],
        controller.signal,
      );
      const parsed = StatsSchema.safeParse(parseJsonObject(stdout));
      if (!parsed.success) {
        logger.warn('[PlanUsage] OpenCode local usage unavailable', {
          providerId: 'opencode',
          reason: `schema:${parsed.error.issues[0]?.path.join('.') || parsed.error.issues[0]?.code || 'invalid'}`,
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
    } catch (error) {
      logger.warn('[PlanUsage] OpenCode local usage unavailable', {
        providerId: 'opencode',
        reason: failureReason(error, controller.signal),
      });
      return unavailable();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}

function localUsage(value: z.infer<typeof StatsSchema>, observedAt: number): PlanLocalUsage {
  const tokens = value.tokens;
  const cache = typeof tokens.cache === 'number'
    ? tokens.cache
    : (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
  return {
    kind: 'local-usage',
    label: 'Local usage: tokens & estimated cost',
    tokens: (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0) + cache,
    estimatedCostUsd: typeof value.cost === 'number' ? value.cost : value.cost.total,
    observedAt,
    source: 'local-cli',
    ...(value.range && { range: formatRange(value.range) }),
  };
}

function validDays(days: number | undefined): number | undefined {
  return typeof days === 'number' && Number.isInteger(days) && days >= 0
    ? days
    : undefined;
}

/** CLI startup notices sometimes precede its JSON document on stdout. */
function parseJsonObject(stdout: string): unknown {
  const start = stdout.indexOf('{');
  if (start < 0) throw new SyntaxError('json-object-not-found');
  return JSON.parse(stdout.slice(start));
}

function formatRange(range: NonNullable<z.infer<typeof StatsSchema>['range']>): string {
  if (typeof range === 'string') return range;
  return `${new Date(range.from).toISOString()} – ${new Date(range.to).toISOString()}`;
}

function failureReason(error: unknown, aborted: AbortSignal): string {
  if (aborted.aborted) return 'timeout-or-aborted';
  if (error instanceof SyntaxError) return 'invalid-json';
  if (error instanceof Error && error.name === 'AbortError') return 'timeout-or-aborted';
  return 'command-failed';
}

function unavailable(): PlanUsageReading {
  return { status: 'service-unavailable', windowSetEstablished: false, windows: [] };
}

const execFileAsync = promisify(execFile);
function defaultRun(command: string, args: readonly string[], signal: AbortSignal): Promise<string> {
  if (process.platform === 'win32') {
    // npm exposes OpenCode as a .cmd shim. cmd.exe requires the whole command
    // after /c as one argument; separate argv entries can lose shim arguments.
    return execFileAsync('cmd.exe', ['/d', '/s', '/c', `${command}.cmd ${args.join(' ')}`], {
      signal,
      windowsHide: true,
    }).then(({ stdout }) => stdout);
  }
  return execFileAsync(command, [...args], { signal, windowsHide: true }).then(({ stdout }) => stdout);
}
