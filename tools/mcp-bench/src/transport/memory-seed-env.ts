/**
 * The memory-seeding request between the bench runner and the `cli-headless`
 * bench host. The runner sets {@link MEMORY_SEED_ENV} through
 * `HostLaunchOptions.env`; the host reads it with {@link readMemorySeedRoots}
 * and seeds the memory ground truth (TASK_2026_619 Task 6.2) inside its
 * isolated store from `afterContainerReady`, before the MCP server listens.
 *
 * Kept free of engine imports on purpose: the runner bundle imports it, and
 * must not pull in the CLI engine the host script bundles.
 */

import { isAbsolute, resolve } from 'node:path';

/**
 * Child environment variable: JSON `{"rootA":…,"rootB":…,"worktreeOfA":…}`,
 * three absolute paths. Unset means no seeding.
 */
export const MEMORY_SEED_ENV = 'PTAH_BENCH_MEMORY_SEED';

/** The real roots the memory placeholders map to (`MemoryRoots` of the ground truth). */
export interface MemorySeedRoots {
  readonly rootA: string;
  readonly rootB: string;
  readonly worktreeOfA: string;
}

/** {@link MEMORY_SEED_ENV} is set but malformed. */
export class MemorySeedEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemorySeedEnvError';
  }
}

/**
 * {@link MEMORY_SEED_ENV} parsed, or `null` when it is unset. Throws
 * {@link MemorySeedEnvError} when it is not JSON or a root is missing or
 * relative, so a malformed request fails the boot instead of running unseeded.
 */
export function readMemorySeedRoots(
  env: NodeJS.ProcessEnv = process.env,
): MemorySeedRoots | null {
  const raw = env[MEMORY_SEED_ENV];
  if (raw === undefined || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MemorySeedEnvError(`${MEMORY_SEED_ENV} is not JSON`);
  }
  const record =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const roots: string[] = [];
  for (const key of ['rootA', 'rootB', 'worktreeOfA']) {
    const value = record[key];
    if (typeof value !== 'string' || !isAbsolute(value)) {
      throw new MemorySeedEnvError(
        `${MEMORY_SEED_ENV}.${key} must be an absolute path`,
      );
    }
    roots.push(resolve(value));
  }
  return { rootA: roots[0], rootB: roots[1], worktreeOfA: roots[2] };
}
