import { z } from 'zod';
import { CODEX_EXECUTABLE_PIN_DATA } from './codex-executable-pin-data';
import type { CodexExecutableManifestRow } from './codex-runtime-ports';

let reviewedPin: CodexExecutableManifestRow | undefined;

/** Return the reviewed portable pin only for its exact platform/architecture. */
export function findCodexExecutablePin(
  platform: string,
  arch: string,
): CodexExecutableManifestRow | undefined {
  // Validate only when a host requests the pin, then reuse the frozen result.
  reviewedPin ??= Object.freeze(
    z
      .object({
        platform: z.string(),
        arch: z.string(),
        pinnedVersion: z.string(),
        version: z.string(),
        binarySha256: z.string(),
        schemaSha256: z.string(),
      })
      .parse(CODEX_EXECUTABLE_PIN_DATA),
  );
  return reviewedPin.platform === platform && reviewedPin.arch === arch
    ? reviewedPin
    : undefined;
}
