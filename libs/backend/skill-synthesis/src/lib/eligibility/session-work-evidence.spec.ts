import type { ExtractedTrajectory } from '../trajectory-extractor';
import { hasSessionWorkEvidence } from './session-work-evidence';

const THRESHOLDS = {
  prefilterMinEdits: 2,
  prefilterMinToolUses: 3,
};

function trajectory(
  overrides: Partial<ExtractedTrajectory> = {},
): ExtractedTrajectory {
  return {
    hash: 'hash',
    canonicalText: 'work',
    turnCount: 2,
    sessionTurnCount: 2,
    shortDescription: 'work',
    slug: 'work',
    editCount: 0,
    toolUseCount: 0,
    bashTestPassed: false,
    charLength: 4,
    hasSuccessMarker: false,
    ...overrides,
  };
}

describe('hasSessionWorkEvidence', () => {
  it.each([
    ['edit evidence alone', { editCount: 2 }],
    ['tool evidence alone', { toolUseCount: 3 }],
    ['test-command evidence alone', { bashTestPassed: true }],
  ])('accepts %s', (_name, overrides) => {
    expect(hasSessionWorkEvidence(trajectory(overrides), THRESHOLDS)).toBe(
      true,
    );
  });

  it('rejects when every evidence signal is absent', () => {
    expect(hasSessionWorkEvidence(trajectory(), THRESHOLDS)).toBe(false);
  });

  it.each([
    ['edits immediately below the threshold', { editCount: 1 }],
    ['tool uses immediately below the threshold', { toolUseCount: 2 }],
  ])('rejects %s', (_name, overrides) => {
    expect(hasSessionWorkEvidence(trajectory(overrides), THRESHOLDS)).toBe(
      false,
    );
  });

  it.each([
    ['edits exactly at the threshold', { editCount: 2 }],
    ['tool uses exactly at the threshold', { toolUseCount: 3 }],
  ])('accepts %s', (_name, overrides) => {
    expect(hasSessionWorkEvidence(trajectory(overrides), THRESHOLDS)).toBe(
      true,
    );
  });
});
