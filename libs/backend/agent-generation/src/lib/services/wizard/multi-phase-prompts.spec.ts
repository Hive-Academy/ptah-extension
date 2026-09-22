import { describe, it, expect } from '@jest/globals';
import {
  buildPhase1Prompts,
  buildPhase2Prompts,
  buildPhase3Prompts,
  buildPhase4Prompts,
} from './multi-phase-prompts';

describe('multi-phase-prompts', () => {
  const slugDir = '.ptah/analysis/test-project';

  describe('buildPhase3Prompts', () => {
    it('instructs incremental writes with heading skeleton first and section appending', () => {
      const prompts = buildPhase3Prompts(slugDir);

      expect(prompts.systemPrompt).toContain(`${slugDir}/03-quality-audit.md`);
      expect(prompts.userPrompt).toContain(`${slugDir}/03-quality-audit.md`);

      // Incremental writing instructions
      expect(prompts.systemPrompt).toContain('Write incrementally');
      expect(prompts.systemPrompt).toContain('heading skeleton FIRST');
      expect(prompts.systemPrompt).toContain(
        'append each finding section to the file as soon as it is established',
      );
      expect(prompts.systemPrompt).toContain(
        'one write per area surveyed',
      );
      expect(prompts.systemPrompt).toContain(
        'instead of one final write at the end',
      );

      // User prompt also carries incremental write instruction
      expect(prompts.userPrompt).toContain('Write incrementally');
      expect(prompts.userPrompt).toContain('heading skeleton FIRST');
      expect(prompts.userPrompt).toContain('one write per area surveyed');
    });

    it('references previous phase output files', () => {
      const prompts = buildPhase3Prompts(slugDir);

      expect(prompts.systemPrompt).toContain(`${slugDir}/01-project-profile.md`);
      expect(prompts.systemPrompt).toContain(`${slugDir}/02-architecture-assessment.md`);
    });
  });

  describe('buildPhase1Prompts', () => {
    it('targets 01-project-profile.md', () => {
      const prompts = buildPhase1Prompts(slugDir);
      expect(prompts.systemPrompt).toContain(`${slugDir}/01-project-profile.md`);
      expect(prompts.userPrompt).toContain(`${slugDir}/01-project-profile.md`);
    });
  });

  describe('buildPhase2Prompts', () => {
    it('targets 02-architecture-assessment.md and reads phase 1', () => {
      const prompts = buildPhase2Prompts(slugDir);
      expect(prompts.systemPrompt).toContain(`${slugDir}/02-architecture-assessment.md`);
      expect(prompts.systemPrompt).toContain(`${slugDir}/01-project-profile.md`);
    });
  });

  describe('buildPhase4Prompts', () => {
    it('targets 04-elevation-plan.md and reads phases 1-3', () => {
      const prompts = buildPhase4Prompts(slugDir);
      expect(prompts.systemPrompt).toContain(`${slugDir}/04-elevation-plan.md`);
      expect(prompts.systemPrompt).toContain(`${slugDir}/01-project-profile.md`);
      expect(prompts.systemPrompt).toContain(`${slugDir}/02-architecture-assessment.md`);
      expect(prompts.systemPrompt).toContain(`${slugDir}/03-quality-audit.md`);
    });
  });
});
