import type { GenerationAgentOutcome } from '@ptah-extension/shared';
import {
  collectLibraryDiverged,
  libraryPassFor,
  writtenAgentIds,
  type LibraryCloneState,
} from './generation-library-outcome';

function outcome(
  agentId: string,
  status: GenerationAgentOutcome['status'],
): GenerationAgentOutcome {
  return {
    agentId,
    filePath: `/ws/.claude/agents/${agentId}.md`,
    status,
    rejectedSections: 0,
    tailoredSections: 0,
  };
}

describe('libraryPassFor', () => {
  it.each([
    ['refreshed', 'updated'],
    ['failed', 'failed'],
    ['skipped', 'not-applicable'],
    [null, 'not-applicable'],
  ] as const)(
    'maps a %s refresh after a write to %s',
    (userLayer, expected) => {
      expect(
        libraryPassFor({ atHarnessRoot: true, writtenCount: 1, userLayer }),
      ).toBe(expected);
    },
  );

  it('is not-applicable when the run wrote nothing, even after a refresh', () => {
    expect(
      libraryPassFor({
        atHarnessRoot: true,
        writtenCount: 0,
        userLayer: 'refreshed',
      }),
    ).toBe('not-applicable');
  });

  it('is not-applicable for a run that wrote under the opened folder', () => {
    expect(
      libraryPassFor({
        atHarnessRoot: false,
        writtenCount: 3,
        userLayer: 'refreshed',
      }),
    ).toBe('not-applicable');
  });
});

describe('writtenAgentIds', () => {
  it('lists only agents this invocation wrote, in order', () => {
    expect(
      writtenAgentIds([
        outcome('a', 'written'),
        outcome('b', 'kept'),
        outcome('c', 'unchanged'),
        outcome('d', 'changed-since-preview'),
        outcome('e', 'failed'),
        outcome('f', 'written'),
      ]),
    ).toEqual(['a', 'f']);
  });
});

describe('collectLibraryDiverged', () => {
  const clones: Record<string, LibraryCloneState | null> = {
    edited: { diverged: true, pendingSourceHash: 'sha256:edited' },
    'other-source': { diverged: true, pendingSourceHash: 'sha256:elsewhere' },
    clean: { diverged: false, pendingSourceHash: null },
    'no-pending': { diverged: true, pendingSourceHash: null },
    'no-clone': null,
    unrecorded: { diverged: true, pendingSourceHash: 'sha256:unrecorded' },
  };
  const originHashes: Record<string, string> = {
    edited: 'sha256:edited',
    'other-source': 'sha256:other-source',
    clean: 'sha256:clean',
    'no-pending': 'sha256:no-pending',
    'no-clone': 'sha256:no-clone',
    unreadable: 'sha256:unreadable',
  };

  it('lists a written agent only when its edited clone is diverged from the hash this run wrote', async () => {
    const warn = jest.fn();
    const readClone = jest.fn(async (agentId: string) => {
      if (agentId === 'unreadable') throw new Error('EACCES');
      return clones[agentId] ?? null;
    });

    const diverged = await collectLibraryDiverged({
      writtenAgentIds: [
        'edited',
        'other-source',
        'clean',
        'no-pending',
        'no-clone',
        'unrecorded',
        'unreadable',
      ],
      originHashes,
      readClone,
      warn,
    });

    expect(diverged).toEqual(['edited']);
    // No recorded hash: the clone is not even read.
    expect(readClone).not.toHaveBeenCalledWith('unrecorded');
    // A read failure omits the agent with a warning.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be read'),
      { agentId: 'unreadable', error: 'EACCES' },
    );
  });

  it('never lists an agent the run did not write', async () => {
    const readClone = jest.fn(async () => clones['edited']);

    const diverged = await collectLibraryDiverged({
      writtenAgentIds: writtenAgentIds([outcome('edited', 'kept')]),
      originHashes,
      readClone,
      warn: jest.fn(),
    });

    expect(diverged).toEqual([]);
    expect(readClone).not.toHaveBeenCalled();
  });

  it('ignores an inherited property of the origin record', async () => {
    const diverged = await collectLibraryDiverged({
      writtenAgentIds: ['constructor'],
      originHashes: {},
      readClone: async () => ({
        diverged: true,
        pendingSourceHash: 'sha256:x',
      }),
      warn: jest.fn(),
    });

    expect(diverged).toEqual([]);
  });
});
