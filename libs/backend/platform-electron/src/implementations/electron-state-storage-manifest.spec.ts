import {
  decideElectronStateRecovery,
  electronStateCurrentPointerSchema,
  electronStateManifestSchema,
  manifestMatchesCurrentPointer,
  type ElectronStateCurrentPointer,
  type ElectronStateManifest,
} from './electron-state-storage-manifest';

const SHA = 'a'.repeat(64);
const COMMIT_ID = '018f55cb-3f18-7d5e-a1a4-000000000001';

function manifest(
  overrides: Partial<ElectronStateManifest> = {},
): ElectronStateManifest {
  return {
    schemaVersion: 2,
    generation: 2,
    previousGeneration: 1,
    commitId: COMMIT_ID,
    commitKind: 'mutation',
    committedAtEpochMs: 1_700_000_000_000,
    sourceV1Sha256: SHA,
    mutationEpoch: 1,
    values: {
      alpha: {
        relativePath: 'values/alpha.2.json',
        generation: 2,
        byteLength: 12,
        sha256: SHA,
      },
    },
    ...overrides,
  };
}

function pointer(
  overrides: Partial<ElectronStateCurrentPointer> = {},
): ElectronStateCurrentPointer {
  return {
    schemaVersion: 1,
    generation: 2,
    commitId: COMMIT_ID,
    mutationEpoch: 1,
    manifestRelativePath: 'manifests/manifest.2.json',
    manifestSha256: SHA,
    ...overrides,
  };
}

describe('electron state manifest contract', () => {
  it('accepts a complete mutation manifest and matching current pointer', () => {
    const parsedManifest = electronStateManifestSchema.parse(manifest());
    const parsedPointer = electronStateCurrentPointerSchema.parse(pointer());

    expect(manifestMatchesCurrentPointer(parsedManifest, parsedPointer)).toBe(
      true,
    );
  });

  it.each([
    ['newer previous generation', { previousGeneration: 2 }],
    ['zero mutation epoch', { mutationEpoch: 0 }],
    [
      'future blob generation',
      {
        values: {
          alpha: {
            relativePath: 'values/alpha.3.json',
            generation: 3,
            byteLength: 1,
            sha256: SHA,
          },
        },
      },
    ],
    [
      'path traversal',
      {
        values: {
          alpha: {
            relativePath: '../alpha.json',
            generation: 2,
            byteLength: 1,
            sha256: SHA,
          },
        },
      },
    ],
    [
      'duplicate blob path',
      {
        values: {
          alpha: {
            relativePath: 'values/shared.2.json',
            generation: 2,
            byteLength: 1,
            sha256: SHA,
          },
          beta: {
            relativePath: 'values/shared.2.json',
            generation: 2,
            byteLength: 1,
            sha256: SHA,
          },
        },
      },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(
      electronStateManifestSchema.safeParse(manifest(overrides)).success,
    ).toBe(false);
  });

  it('requires migration commits to have mutation epoch zero', () => {
    expect(
      electronStateManifestSchema.safeParse(
        manifest({ commitKind: 'migration', mutationEpoch: 0 }),
      ).success,
    ).toBe(true);
    expect(
      electronStateManifestSchema.safeParse(
        manifest({ commitKind: 'migration', mutationEpoch: 1 }),
      ).success,
    ).toBe(false);
  });

  it('rejects a pointer whose manifest path can escape the v2 directory', () => {
    expect(
      electronStateCurrentPointerSchema.safeParse(
        pointer({ manifestRelativePath: '../manifest.json' }),
      ).success,
    ).toBe(false);
  });
});

describe('electron state recovery policy', () => {
  it('uses a verified current commit', () => {
    expect(
      decideElectronStateRecovery({
        v2CommitArtifactsPresent: true,
        retainedV1Available: true,
        currentPointer: pointer(),
        currentCommitValid: true,
        failureReason: 'manifest-invalid',
      }),
    ).toEqual({ action: 'use-current' });
  });

  it('retries v1 when no v2 commit artifact exists', () => {
    expect(
      decideElectronStateRecovery({
        v2CommitArtifactsPresent: false,
        retainedV1Available: true,
        currentPointer: null,
        currentCommitValid: false,
        failureReason: 'migration-failed',
      }),
    ).toEqual({ action: 'retry-v1' });
  });

  it('retries v1 for a verified migration-only pointer', () => {
    expect(
      decideElectronStateRecovery({
        v2CommitArtifactsPresent: true,
        retainedV1Available: true,
        currentPointer: pointer({ mutationEpoch: 0 }),
        currentCommitValid: false,
        failureReason: 'blob-hash-mismatch',
      }),
    ).toEqual({ action: 'retry-v1' });
  });

  it.each([
    ['post-migration mutation', pointer({ mutationEpoch: 4 })],
    ['ambiguous invalid pointer', null],
  ])('fails closed for %s', (_label, currentPointer) => {
    expect(
      decideElectronStateRecovery({
        v2CommitArtifactsPresent: true,
        retainedV1Available: true,
        currentPointer,
        currentCommitValid: false,
        failureReason: 'manifest-invalid',
      }),
    ).toEqual({
      action: 'recovery-required',
      reason: 'manifest-invalid',
    });
  });

  it('fails closed when no retained v1 exists', () => {
    expect(
      decideElectronStateRecovery({
        v2CommitArtifactsPresent: false,
        retainedV1Available: false,
        currentPointer: null,
        currentCommitValid: false,
        failureReason: 'migration-failed',
      }),
    ).toEqual({
      action: 'recovery-required',
      reason: 'migration-failed',
    });
  });
});
