import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';

const BuildIdentitySchema = z.object({
  kind: z.literal('local-production'),
  gitSha: z.string().regex(/^[0-9a-f]{40}$/),
});

const PackageMetadataSchema = z.object({
  ptahBuildIdentity: BuildIdentitySchema.optional(),
});

export type BuildIdentity = z.infer<typeof BuildIdentitySchema>;

/**
 * Reads the immutable identity embedded by electron-builder in the packaged
 * app's package.json. Missing or invalid metadata means the normal production
 * build; no environment variable can opt a packaged build into this mode.
 */
export function readBuildIdentity(
  appPath = app.getAppPath(),
): BuildIdentity | null {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(appPath, 'package.json'), 'utf8'),
    );
    return PackageMetadataSchema.parse(raw).ptahBuildIdentity ?? null;
  } catch {
    return null;
  }
}

export function isLocalProductionBuild(): boolean {
  return readBuildIdentity()?.kind === 'local-production';
}
