/** Conservative reader for the provisional local Antigravity LS endpoint. */
import { execFile } from 'node:child_process';
import { request as httpsRequest, Agent } from 'node:https';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type { PlanLimitWindow } from '@ptah-extension/shared';
import {
  ANTIGRAVITY_CSRF_ARGUMENT,
  ANTIGRAVITY_CSRF_HEADER,
  ANTIGRAVITY_PORT_ARGUMENT,
  ANTIGRAVITY_POSIX_PROCESS_ARGS,
  ANTIGRAVITY_PROCESS_MARKER,
  ANTIGRAVITY_PRODUCT_MARKER,
  ANTIGRAVITY_STATUS_PATH,
  ANTIGRAVITY_WINDOWS_PROCESS_ARGS,
} from './antigravity-ls.provisional';
import type {
  PlanUsageReader,
  PlanUsageReading,
} from './plan-usage-reader.types';

export const ANTIGRAVITY_USAGE_TIMEOUT_MS = 3_000;
const StatusSchema = z.object({
  models: z.record(
    z.string(),
    z.object({
      remainingFraction: z.number().min(0).max(1),
      resetTime: z.string().nullable().optional(),
    }),
  ),
});
type StatusRequest = (
  port: number,
  csrfToken: string,
  signal: AbortSignal,
) => Promise<unknown>;

/** Local command seam: no agent-sdk barrel dependency is needed here. */
type ProbeCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<string>;

export function createAntigravityPlanUsageReader(
  logger: Logger,
  now: () => number = Date.now,
  run: ProbeCommandRunner = defaultRun,
  requestStatus: StatusRequest = defaultRequest,
): PlanUsageReader {
  return async ({ signal }) => {
    try {
      if (signal?.aborted) return unavailable();
      const command = process.platform === 'win32' ? 'powershell.exe' : 'ps';
      const args =
        process.platform === 'win32'
          ? ANTIGRAVITY_WINDOWS_PROCESS_ARGS
          : ANTIGRAVITY_POSIX_PROCESS_ARGS;
      const candidate = findServer(await run(command, args));
      if (!candidate) return unavailable();
      if (signal?.aborted) return unavailable();
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(
        () => controller.abort(),
        ANTIGRAVITY_USAGE_TIMEOUT_MS,
      );
      try {
        const parsed = StatusSchema.safeParse(
          await requestStatus(
            candidate.port,
            candidate.csrfToken,
            controller.signal,
          ),
        );
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          logger.warn('[PlanUsage] provisional usage response rejected', {
            providerId: 'antigravity',
            fieldPath: issue?.path.map(String).join('.') ?? '',
            reason: issue?.code ?? 'invalid',
          });
          return unavailable();
        }
        const observedAt = now();
        const windows = Object.entries(parsed.data.models).map(
          ([model, value]) => toWindow(model, value, observedAt),
        );
        return windows.length
          ? {
              status: 'available',
              fetchedAt: observedAt,
              windowSetEstablished: true,
              windows,
            }
          : unavailable();
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
    } catch {
      return unavailable();
    }
  };
}

function findServer(
  stdout: string,
): { port: number; csrfToken: string } | null {
  const line = stdout
    .split(/\r?\n/)
    .find(
      (entry) =>
        entry.includes(ANTIGRAVITY_PROCESS_MARKER) &&
        entry.toLowerCase().includes(ANTIGRAVITY_PRODUCT_MARKER),
    );
  if (!line) return null;
  const token = new RegExp(`${ANTIGRAVITY_CSRF_ARGUMENT}[=\\s]+([^\\s]+)`).exec(
    line,
  )?.[1];
  const port = Number(
    new RegExp(`${ANTIGRAVITY_PORT_ARGUMENT}[=\\s]+(\\d+)`).exec(line)?.[1],
  );
  return token && Number.isInteger(port) && port > 0 && port < 65536
    ? { port, csrfToken: token }
    : null;
}

function toWindow(
  model: string,
  value: { remainingFraction: number; resetTime?: string | null },
  observedAt: number,
): PlanLimitWindow {
  const reset = value.resetTime ? Date.parse(value.resetTime) : NaN;
  return {
    key: `weekly_model:${model}`,
    kind: 'weekly_model',
    label: `Weekly · ${model}`,
    modelScope: model,
    used: { kind: 'percent', percent: (1 - value.remainingFraction) * 100 },
    usedSource: 'provider-unofficial',
    usedObservedAt: observedAt,
    ...(Number.isFinite(reset) && {
      resetsAt: reset,
      resetSource: 'provider-unofficial',
    }),
    observedAt,
  };
}
function unavailable(): PlanUsageReading {
  return {
    status: 'service-unavailable',
    windowSetEstablished: false,
    windows: [],
  };
}
const execFileAsync = promisify(execFile);
function defaultRun(command: string, args: readonly string[]): Promise<string> {
  return execFileAsync(command, [...args], {
    timeout: ANTIGRAVITY_USAGE_TIMEOUT_MS,
    windowsHide: true,
  }).then(({ stdout }) => stdout);
}
function defaultRequest(
  port: number,
  csrfToken: string,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: ANTIGRAVITY_STATUS_PATH,
        method: 'POST',
        headers: { [ANTIGRAVITY_CSRF_HEADER]: csrfToken },
        agent: new Agent({ rejectUnauthorized: false }),
        signal,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}
