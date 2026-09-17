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
    nonMcpToolUseCount: 0,
    bashTestPassed: false,
    charLength: 4,
    hasSuccessMarker: false,
    ...overrides,
  };
}

describe('hasSessionWorkEvidence', () => {
  it.each([
    ['edit evidence alone', { editCount: 2 }],
    ['tool evidence alone', { toolUseCount: 3, nonMcpToolUseCount: 3 }],
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
    [
      'non-MCP tool uses immediately below the threshold',
      { toolUseCount: 2, nonMcpToolUseCount: 2 },
    ],
  ])('rejects %s', (_name, overrides) => {
    expect(hasSessionWorkEvidence(trajectory(overrides), THRESHOLDS)).toBe(
      false,
    );
  });

  it.each([
    ['edits exactly at the threshold', { editCount: 2 }],
    [
      'non-MCP tool uses exactly at the threshold',
      { toolUseCount: 3, nonMcpToolUseCount: 3 },
    ],
  ])('accepts %s', (_name, overrides) => {
    expect(hasSessionWorkEvidence(trajectory(overrides), THRESHOLDS)).toBe(
      true,
    );
  });

  it('rejects an MCP-only session', () => {
    expect(
      hasSessionWorkEvidence(
        trajectory({ toolUseCount: 12, nonMcpToolUseCount: 0 }),
        THRESHOLDS,
      ),
    ).toBe(false);
  });

  it('accepts two non-MCP tools at a threshold of two', () => {
    expect(
      hasSessionWorkEvidence(
        trajectory({ toolUseCount: 2, nonMcpToolUseCount: 2 }),
        { ...THRESHOLDS, prefilterMinToolUses: 2 },
      ),
    ).toBe(true);
  });

  it('rejects one non-MCP tool mixed with ten MCP tools', () => {
    expect(
      hasSessionWorkEvidence(
        trajectory({ toolUseCount: 11, nonMcpToolUseCount: 1 }),
        { ...THRESHOLDS, prefilterMinToolUses: 2 },
      ),
    ).toBe(false);
  });
});
