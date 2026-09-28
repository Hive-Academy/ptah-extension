/**
 * launchGuardRefusal — evaluate a {@link SpawnLaunchGuard} now, on the calling
 * thread (TASK_2026_559 Lane K, closing review r2 finding 1).
 *
 * The spawner calls this immediately before creating a child on the thread
 * that creates it. The off-thread worker runs a line-for-line JavaScript twin
 * (`off-thread-process-spawner-source.ts`, `launchGuardRefusal`); both are
 * driven over the same cases by `off-thread-process-spawner.spec.ts`.
 *
 * Returns `null` when every fact holds, else a fixed reason code. Any read
 * failure is a refusal: an unverifiable fact never authorizes a launch.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import type { SpawnLaunchGuard } from '../interfaces/process-spawner.interface';

export type LaunchGuardRefusal = 'content' | 'identity' | 'unreadable';

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

export function launchGuardRefusal(
  guard: SpawnLaunchGuard | undefined,
): LaunchGuardRefusal | null {
  if (guard === undefined) return null;
  try {
    for (const expected of guard.fileContents ?? []) {
      const digest = createHash('sha256')
        .update(fs.readFileSync(expected.path))
        .digest('hex');
      if (digest !== expected.sha256) return 'content';
    }
    for (const expected of guard.fileIdentities ?? []) {
      if (!samePath(fs.realpathSync.native(expected.path), expected.realpath)) {
        return 'identity';
      }
      const stats = fs.statSync(expected.path);
      if (expected.size !== undefined && stats.size !== expected.size) {
        return 'identity';
      }
      if (
        expected.mtimeMs !== undefined &&
        stats.mtimeMs !== expected.mtimeMs
      ) {
        return 'identity';
      }
      if (expected.devIno !== undefined && expected.devIno !== null) {
        const big = fs.statSync(expected.path, { bigint: true });
        if (
          big.ino !== BigInt(0) &&
          `${big.dev}:${big.ino}` !== expected.devIno
        ) {
          return 'identity';
        }
      }
    }
    return null;
  } catch (error: unknown) {
    // degradation-audit: reported - an unreadable fact never authorizes a
    // launch; the refusal code reaches the caller as the spawn error.
    void error;
    return 'unreadable';
  }
}
