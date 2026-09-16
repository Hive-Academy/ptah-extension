import type { ExtractedTrajectory } from '../trajectory-extractor';
import type { SkillSynthesisSettings } from '../types';

export type SessionWorkEvidenceThresholds = Pick<
  SkillSynthesisSettings,
  'prefilterMinEdits' | 'prefilterMinToolUses'
>;

/**
 * Whether a session contains observable workspace work: enough edit operations,
 * enough non-MCP tool uses, or a shell test command. MCP tools (`mcp__*`) do
 * not count. `bashTestPassed` records that a test command ran; it does not
 * establish that the test succeeded.
 */
export function hasSessionWorkEvidence(
  trajectory: ExtractedTrajectory,
  thresholds: SessionWorkEvidenceThresholds,
): boolean {
  return (
    trajectory.editCount >= thresholds.prefilterMinEdits ||
    trajectory.nonMcpToolUseCount >= thresholds.prefilterMinToolUses ||
    trajectory.bashTestPassed === true
  );
}
