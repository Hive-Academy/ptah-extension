import { z } from 'zod';
import type { CodexExecutableManifestRow } from './codex-runtime-ports';

// A literal require lets host bundles include the reviewed JSON without a
// runtime filesystem dependency or a resolveJsonModule compiler option.
const reviewedManifest: unknown = require('./protocol/codex-app-server-protocol.manifest.json');
const reviewedPin: CodexExecutableManifestRow = Object.freeze(
  z
    .object({
      platform: z.string(),
      arch: z.string(),
      pinnedVersion: z.string(),
      version: z.string(),
      binarySha256: z.string(),
      schemaSha256: z.string(),
    })
    .parse(reviewedManifest),
);

/** Return the reviewed portable pin only for its exact platform/architecture. */
export function findCodexExecutablePin(
  platform: string,
  arch: string,
): CodexExecutableManifestRow | undefined {
  return reviewedPin.platform === platform && reviewedPin.arch === arch
    ? reviewedPin
    : undefined;
}
