import 'reflect-metadata';
import {
  estimateTokens,
  truncateToTokenBudget,
  validateOutput,
} from './response-parser';
import { PromptDesignerAgent } from './prompt-designer-agent';
import type { PromptDesignerOutput } from './prompt-designer.types';

describe('estimateTokens', () => {
  it('should estimate ~4 characters per token, rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('truncateToTokenBudget', () => {
  const SHORTENED_MARKER = '_(section shortened to fit the prompt budget)_';
  const MARKER_SUFFIX = `\n\n${SHORTENED_MARKER}`;
  const MARKER_ONLY = SHORTENED_MARKER;

  describe('under budget', () => {
    it('should return content untouched when within budget', () => {
      const content = 'Short section content.';
      const result = truncateToTokenBudget(content, 100, 5);

      expect(result).toBe(content);
    });

    it('should not append the shortened marker when within budget', () => {
      const content = 'Short section content.';
      const result = truncateToTokenBudget(content, 100, 5);

      expect(result).not.toContain(SHORTENED_MARKER);
    });

    it('should return CRLF content byte-identically when within budget', () => {
      const content = ' \r\n## Rules\r\n\r\n1. alpha  \r\n';
      const result = truncateToTokenBudget(content, 10, 10);

      expect(result).toBe(content);
    });
  });

  describe('whole leading list items (review case a)', () => {
    it('should keep items 1-2 complete and never emit a bare numbered marker', () => {
      const content =
        '1. abcdefghij\n2. abcdefghij\n3. abcdefghij\n4. abcdefghij\n5. abcdefghij\n6. abcdefghij';
      const result = truncateToTokenBudget(content, 30, 60);

      expect(result).toBe(`1. abcdefghij\n2. abcdefghij${MARKER_SUFFIX}`);
    });
  });

  describe('heading body kept before a list (review case b)', () => {
    it('should keep the heading with its paragraph and drop the whole list', () => {
      const content =
        '## Rules\n\nParagraph with enough context.\n\n1. alpha rule\n2. beta rule\n3. gamma rule';
      const result = truncateToTokenBudget(content, 42, 60);

      expect(result).toBe(
        `## Rules\n\nParagraph with enough context.${MARKER_SUFFIX}`,
      );
    });
  });

  describe('nested lists', () => {
    const nestedContent =
      '1. parent\n  - child alpha\n  - child beta\n2. next parent\n  - child gamma';

    it('should return only the marker when no whole parent fits (review case c)', () => {
      const result = truncateToTokenBudget(nestedContent, 35, 60);

      expect(result).toBe(MARKER_ONLY);
    });

    it('should keep a parent with all its nested children when they fit', () => {
      const result = truncateToTokenBudget(nestedContent, 45, 60);

      expect(result).toBe(
        `1. parent\n  - child alpha\n  - child beta${MARKER_SUFFIX}`,
      );
    });
  });

  describe('wrapped list items', () => {
    const wrappedContent =
      '1. Keep this rule\n   including its essential continuation\n2. Another rule';

    it('should return only the marker when no whole wrapped item fits (review case d)', () => {
      const result = truncateToTokenBudget(wrappedContent, 20, 60);

      expect(result).toBe(MARKER_ONLY);
    });

    it('should keep the item together with its continuation line when they fit', () => {
      const result = truncateToTokenBudget(wrappedContent, 40, 42);

      expect(result).toBe(
        `1. Keep this rule\n   including its essential continuation${MARKER_SUFFIX}`,
      );
    });
  });

  describe('short intro before a list (review case f2)', () => {
    it('should keep the leading blocks that fit and never cut into the list', () => {
      const content =
        'Intro\n\n1. abcdefghij\n2. abcdefghij\n3. abcdefghij\n4. abcdefghij';
      const result = truncateToTokenBudget(content, 40, 60);

      expect(result).toBe(`Intro\n\n1. abcdefghij${MARKER_SUFFIX}`);
    });

    it('should drop a whole numbered list that does not fit, keeping the intro', () => {
      const intro = 'A'.repeat(200);
      const item = (n: number) => `${n}. ${'B'.repeat(46)}`;
      const content = [intro, '', item(1), item(2), item(3)].join('\n');
      const currentTokens = Math.ceil(content.length / 4);

      const result = truncateToTokenBudget(content, 65, currentTokens);

      expect(result).toBe(`${intro}${MARKER_SUFFIX}`);
      expect(result).not.toMatch(/^\d+\.\s?$/m);
    });
  });

  describe('alternative list markers', () => {
    it('should recognize + markers and keep only whole items', () => {
      const content =
        '+ first rule item\n+ second rule item\n+ third rule item\n+ fourth rule item';
      const result = truncateToTokenBudget(content, 30, 40);

      expect(result).toBe(
        `+ first rule item\n+ second rule item${MARKER_SUFFIX}`,
      );
    });

    it('should recognize "1)" markers and keep only whole items', () => {
      const content = '1) alpha rule\n2) beta rule\n3) gamma rule';
      const result = truncateToTokenBudget(content, 48, 50);

      expect(result).toBe(`1) alpha rule\n2) beta rule${MARKER_SUFFIX}`);
    });

    it('should cut between loose list items, not inside them', () => {
      const content = '1. first item\n\n2. second item\n\n3. third item';
      const result = truncateToTokenBudget(content, 47, 50);

      expect(result).toBe(`1. first item\n\n2. second item${MARKER_SUFFIX}`);
    });
  });

  describe('paragraph and heading boundaries (no list)', () => {
    it('should cut at a paragraph boundary and append the shortened marker', () => {
      const firstParagraph = 'A'.repeat(100);
      const content = `${firstParagraph}\n\n${'B'.repeat(300)}`;
      const result = truncateToTokenBudget(content, 50, 101);

      expect(result).toBe(`${firstParagraph}${MARKER_SUFFIX}`);
    });

    it('should cut before a heading line instead of leaving it dangling', () => {
      const intro = 'A'.repeat(100);
      const content = `${intro}\n## Next Section\n${'B'.repeat(300)}`;
      const result = truncateToTokenBudget(content, 38, 105);

      expect(result).toBe(`${intro}${MARKER_SUFFIX}`);
      expect(result).not.toContain('## Next Section');
    });

    it('should keep a complete list and drop a trailing paragraph that does not fit', () => {
      const item = (n: number) => `${n}. ${'C'.repeat(97)}`;
      const content = `${item(1)}\n${item(2)}\n${item(3)}\n\n${'D'.repeat(300)}`;
      const result = truncateToTokenBudget(content, 100, 151);

      expect(result).toBe(`${item(1)}\n${item(2)}\n${item(3)}${MARKER_SUFFIX}`);
      expect(result).not.toContain('D'.repeat(10));
    });
  });

  describe('sentence fallback (no list anywhere)', () => {
    it('should cut at a sentence boundary and append the marker (review case f)', () => {
      const content = `First sentence. Second sentence. ${'Z'.repeat(40)}`;
      const result = truncateToTokenBudget(content, 30, 60);

      expect(result).toBe(`First sentence. Second sentence.${MARKER_SUFFIX}`);
    });

    it('should shrink the raw cut until the marker-inclusive result fits', () => {
      const content = `Sentence one. ${'B'.repeat(300)}`;
      const currentTokens = Math.ceil(content.length / 4);
      const maxTokens = Math.floor(currentTokens / 4);

      const result = truncateToTokenBudget(content, maxTokens, currentTokens);

      expect(result).toBe(`Sentence one. ${'B'.repeat(13)}${MARKER_SUFFIX}`);
      expect(estimateTokens(result)).toBeLessThanOrEqual(maxTokens);
    });
  });

  describe('marker reservation', () => {
    it('should reserve the marker cost so the result fits the budget (review defect 4)', () => {
      const content = 'A'.repeat(1604);
      const result = truncateToTokenBudget(content, 400, 401);

      expect(result).toBe(`${'A'.repeat(1552)}${MARKER_SUFFIX}`);
      expect(estimateTokens(result)).toBe(400);
    });

    it('should return the marker alone when the budget cannot hold the marker', () => {
      const result = truncateToTokenBudget(
        'Guidance text that is too long for this tiny budget.',
        10,
        100,
      );

      expect(result).toBe(MARKER_ONLY);
    });

    it('should return the marker alone when the content budget leaves nothing', () => {
      const result = truncateToTokenBudget('word', 15, 100);

      expect(result).toBe(MARKER_ONLY);
    });
  });

  describe('integration with PromptDesignerAgent', () => {
    it('should bound quality guidance, recount truthful totals and pass validation', () => {
      const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as never;
      const agent = new PromptDesignerAgent(logger);

      const output: PromptDesignerOutput = {
        projectContext: 'C'.repeat(1600),
        frameworkGuidelines: 'F'.repeat(1600),
        codingStandards: 'S'.repeat(1600),
        architectureNotes: 'A'.repeat(2400),
        qualityGuidance: 'Q'.repeat(2400),
        generatedAt: Date.now(),
        totalTokens: 2400,
        tokenBreakdown: {
          projectContext: 400,
          frameworkGuidelines: 400,
          codingStandards: 400,
          architectureNotes: 600,
          qualityGuidance: 600,
        },
      };

      const result = agent.enforceTokenBudgets(output);

      // Sections at their budgets are untouched; architectureNotes gets 1.5x.
      expect(result.projectContext).toBe('C'.repeat(1600));
      expect(result.architectureNotes).toBe('A'.repeat(2400));
      // qualityGuidance (600 tokens) is truncated to its 400-token budget by
      // the real parser, and the recount reflects the final text.
      expect(result.qualityGuidance).toBe(
        `${'Q'.repeat(1552)}${MARKER_SUFFIX}`,
      );
      expect(result.tokenBreakdown).toEqual({
        projectContext: 400,
        frameworkGuidelines: 400,
        codingStandards: 400,
        architectureNotes: 600,
        qualityGuidance: 400,
      });
      expect(result.totalTokens).toBe(2200);
      expect(validateOutput(result)).toEqual({ valid: true, issues: [] });
    });
  });
});
