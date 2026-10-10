/**
 * The parent's side of the host completion record (Batch 15). The launcher
 * stops reading the host's stdout after the ready line, so the runner polls
 * `<runDir>/host-completion.json`, which the host writes atomically before it
 * waits for stdin EOF.
 *
 * The file and schema names are literal copies typed against the host's own
 * constants: a value import would pull the host module, and the product
 * barrels it loads, into the runner parent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import type { LaunchedHost } from '../../transport/host-launcher';
import type * as Host from '../host/memory-skills-host';
import { MemorySkillsRunError } from './runner-plan';

export const HOST_COMPLETION_FILE: typeof Host.HOST_COMPLETION_FILE =
  'host-completion.json';
export const HOST_COMPLETION_SCHEMA_ID: typeof Host.HOST_COMPLETION_SCHEMA_ID =
  '620.host-completion.v1';
export const HOST_NET_RECORDER_LOG: typeof Host.HOST_NET_RECORDER_LOG =
  'net-recorder.log';

/** The launched host as the runner uses it. */
export type RunnerHost = Pick<
  LaunchedHost,
  'pid' | 'port' | 'guardMode' | 'exitedEarly' | 'stop'
>;

/** Typed by the host's own record, so the parse result must stay assignable to it. */
export type HostCompletionView = Pick<
  Host.HostCompletion,
  'runId' | 'status' | 'suites' | 'net'
>;

const hostCompletionSchema = z.object({
  schemaId: z.literal(HOST_COMPLETION_SCHEMA_ID),
  runId: z.string().min(1),
  status: z.enum(['complete', 'net-violation']),
  suites: z.array(
    z.discriminatedUnion('status', [
      z.strictObject({
        id: z.string(),
        status: z.literal('completed'),
        durationMs: z.number(),
      }),
      z.strictObject({
        id: z.string(),
        status: z.literal('error'),
        durationMs: z.number(),
        error: z.string(),
      }),
      z.strictObject({
        id: z.string(),
        status: z.literal('skipped'),
        reason: z.literal('shutdown-requested'),
      }),
    ]),
  ),
  net: z
    .strictObject({
      logFile: z.string(),
      attempts: z.array(
        z.strictObject({
          kind: z.enum(['dns-lookup', 'fetch', 'tcp-connect']),
          tag: z.string(),
          detail: z.string(),
        }),
      ),
    })
    .nullable(),
});

function readCompletion(path: string, runId: string): HostCompletionView {
  const parsed = hostCompletionSchema.safeParse(
    JSON.parse(readFileSync(path, 'utf8')),
  );
  if (!parsed.success) {
    throw new MemorySkillsRunError(
      `invalid host completion ${path}:\n${z.prettifyError(parsed.error)}`,
    );
  }
  if (parsed.data.runId !== runId) {
    throw new MemorySkillsRunError(
      `host completion ${path} is for run ${parsed.data.runId}, expected ${runId}`,
    );
  }
  return parsed.data;
}

export interface WaitForCompletionOptions {
  readonly runDir: string;
  readonly runId: string;
  readonly host: RunnerHost;
  readonly timeoutMs: number;
  readonly pollMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}

/**
 * Poll for the completion record. `null` when the host ended without one or
 * the timeout passed; the run then reports the host suites as missing.
 */
export async function waitForHostCompletion(
  options: WaitForCompletionOptions,
): Promise<HostCompletionView | null> {
  const path = join(options.runDir, HOST_COMPLETION_FILE);
  const deadline = performance.now() + options.timeoutMs;
  for (;;) {
    if (existsSync(path)) return readCompletion(path, options.runId);
    if (options.host.exitedEarly() !== undefined) {
      // One last look: the record is written before the host waits for EOF.
      return existsSync(path) ? readCompletion(path, options.runId) : null;
    }
    if (performance.now() >= deadline) return null;
    await options.sleep(options.pollMs);
  }
}
