import { z } from 'zod';
import type { StateStorageRecoveryReason } from '@ptah-extension/platform-core';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/;

const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const sha256Schema = z.string().regex(SHA256_PATTERN);

const relativeStoragePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      if (value.startsWith('/') || value.startsWith('\\')) return false;
      if (WINDOWS_DRIVE_PATTERN.test(value) || value.includes('\\'))
        return false;
      return value
        .split('/')
        .every((segment) => segment !== '..' && segment !== '');
    },
    { message: 'path must be a normalized relative path without traversal' },
  );

export const electronStateBlobSchema = z
  .object({
    relativePath: relativeStoragePathSchema,
    generation: positiveSafeIntegerSchema,
    byteLength: nonNegativeSafeIntegerSchema,
    sha256: sha256Schema,
  })
  .strict();

export const electronStateManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    generation: positiveSafeIntegerSchema,
    previousGeneration: positiveSafeIntegerSchema.nullable(),
    commitId: z.uuid(),
    commitKind: z.enum(['migration', 'mutation']),
    committedAtEpochMs: nonNegativeSafeIntegerSchema,
    sourceV1Sha256: sha256Schema,
    mutationEpoch: nonNegativeSafeIntegerSchema,
    values: z.record(z.string().min(1).max(4096), electronStateBlobSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.previousGeneration !== null &&
      manifest.previousGeneration >= manifest.generation
    ) {
      context.addIssue({
        code: 'custom',
        path: ['previousGeneration'],
        message: 'previousGeneration must be lower than generation',
      });
    }
    if (manifest.commitKind === 'migration' && manifest.mutationEpoch !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['mutationEpoch'],
        message: 'migration commits must have mutationEpoch 0',
      });
    }
    if (manifest.commitKind === 'mutation' && manifest.mutationEpoch === 0) {
      context.addIssue({
        code: 'custom',
        path: ['mutationEpoch'],
        message: 'mutation commits must have a positive mutationEpoch',
      });
    }

    const referencedPaths = new Set<string>();
    for (const [key, blob] of Object.entries(manifest.values)) {
      if (blob.generation > manifest.generation) {
        context.addIssue({
          code: 'custom',
          path: ['values', key, 'generation'],
          message: 'blob generation cannot exceed manifest generation',
        });
      }
      if (referencedPaths.has(blob.relativePath)) {
        context.addIssue({
          code: 'custom',
          path: ['values', key, 'relativePath'],
          message: 'each state key must reference a distinct blob path',
        });
      }
      referencedPaths.add(blob.relativePath);
    }
  });

export const electronStateCurrentPointerSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: positiveSafeIntegerSchema,
    commitId: z.uuid(),
    mutationEpoch: nonNegativeSafeIntegerSchema,
    manifestRelativePath: relativeStoragePathSchema,
    manifestSha256: sha256Schema,
  })
  .strict();

export type ElectronStateBlob = z.infer<typeof electronStateBlobSchema>;
export type ElectronStateManifest = z.infer<typeof electronStateManifestSchema>;
export type ElectronStateCurrentPointer = z.infer<
  typeof electronStateCurrentPointerSchema
>;

/**
 * The pointer duplicates the commit identity and mutation epoch deliberately.
 * If the referenced manifest is damaged, recovery can still distinguish a
 * migration-only store from one whose retained v1 snapshot is stale.
 */
export function manifestMatchesCurrentPointer(
  manifest: ElectronStateManifest,
  pointer: ElectronStateCurrentPointer,
): boolean {
  return (
    manifest.generation === pointer.generation &&
    manifest.commitId === pointer.commitId &&
    manifest.mutationEpoch === pointer.mutationEpoch &&
    pointer.manifestRelativePath ===
      `manifests/manifest.${manifest.generation}.json`
  );
}

export type ElectronStateRecoveryDecision =
  | { readonly action: 'use-current' }
  | { readonly action: 'retry-v1' }
  | {
      readonly action: 'recovery-required';
      readonly reason: StateStorageRecoveryReason;
    };

export interface ElectronStateRecoveryEvidence {
  /** True when CURRENT, a committed manifest, or another v2 commit artifact exists. */
  readonly v2CommitArtifactsPresent: boolean;
  readonly retainedV1Available: boolean;
  readonly currentPointer: ElectronStateCurrentPointer | null;
  readonly currentCommitValid: boolean;
  readonly failureReason: StateStorageRecoveryReason;
}

/**
 * Decide only from verified commit evidence. Ambiguous v2 artifacts fail
 * closed: absence/corruption must never make stale v1 look current after a v2
 * mutation.
 */
export function decideElectronStateRecovery(
  evidence: ElectronStateRecoveryEvidence,
): ElectronStateRecoveryDecision {
  if (evidence.currentCommitValid && evidence.currentPointer !== null) {
    return { action: 'use-current' };
  }
  if (
    evidence.retainedV1Available &&
    (!evidence.v2CommitArtifactsPresent ||
      evidence.currentPointer?.mutationEpoch === 0)
  ) {
    return { action: 'retry-v1' };
  }
  return {
    action: 'recovery-required',
    reason: evidence.failureReason,
  };
}
