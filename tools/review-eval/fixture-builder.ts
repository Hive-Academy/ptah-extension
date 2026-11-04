import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { fixtureManifestSchema, type FixtureManifest } from './fixture-manifest.schema';

export interface FixtureInputPort {
  readJson(path: string): Promise<unknown>;
  writeJson(path: string, value: unknown): Promise<void>;
}

export function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

/** The caller obtains API exports before launching any replay lane. */
export async function buildFixture(port: FixtureInputPort, inputPath: string, outputPath: string, laneRoots: readonly string[] = []): Promise<FixtureManifest> {
  assertReferenceOutsideLane(inputPath, laneRoots);
  assertReferenceOutsideLane(outputPath, laneRoots);
  const manifest = fixtureManifestSchema.parse(await port.readJson(inputPath));
  await port.writeJson(outputPath, manifest);
  return manifest;
}

export function assertReferenceOutsideLane(referencePath: string, laneRoots: readonly string[]): void {
  const reference = resolve(referencePath);
  for (const root of laneRoots) {
    const rel = relative(resolve(root), reference);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Fixture reference is lane-readable');
  }
}
