/**
 * Response Parser for Prompt Designer Agent
 *
 * with fallback handling for malformed output.
 */

import type {
  PromptDesignerOutput,
  PromptDesignerResponse,
} from './prompt-designer.types';

/**
 * Safe token counting with fallback estimation.
 * If countTokens throws, estimates tokens as ~4 chars per token.
 *
 * @param text - Text to count tokens for
 * @param countTokens - Token counting function
 * @returns Token count (actual or estimated)
 */
async function safeCountTokens(
  text: string,
  countTokens: (t: string) => Promise<number>,
): Promise<number> {
  try {
    return await countTokens(text);
  } catch {
    // Fallback: estimate tokens as ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}

/**
 * Parse structured LLM response into PromptDesignerOutput
 *
 * @param response - Validated response from getStructuredCompletion
 * @param countTokens - Function to count tokens in text
 * @returns Formatted output with token counts
 */
export async function parseStructuredResponse(
  response: PromptDesignerResponse,
  countTokens: (text: string) => Promise<number>,
): Promise<PromptDesignerOutput> {
  // Count tokens for each section using named object (avoids magic number indexing)
  const tokenCounts = {
    projectContext: await safeCountTokens(response.projectContext, countTokens),
    frameworkGuidelines: await safeCountTokens(
      response.frameworkGuidelines,
      countTokens,
    ),
    codingStandards: await safeCountTokens(
      response.codingStandards,
      countTokens,
    ),
    architectureNotes: await safeCountTokens(
      response.architectureNotes,
      countTokens,
    ),
    qualityGuidance: response.qualityGuidance
      ? await safeCountTokens(response.qualityGuidance, countTokens)
      : undefined,
  };

  const {
    projectContext: projectContextTokens,
    frameworkGuidelines: frameworkGuidelinesTokens,
    codingStandards: codingStandardsTokens,
    architectureNotes: architectureNotesTokens,
    qualityGuidance: qualityGuidanceTokens,
  } = tokenCounts;

  // Calculate total including optional qualityGuidance
  const totalTokens =
    projectContextTokens +
    frameworkGuidelinesTokens +
    codingStandardsTokens +
    architectureNotesTokens +
    (qualityGuidanceTokens ?? 0);

  const tokenBreakdown: PromptDesignerOutput['tokenBreakdown'] = {
    projectContext: projectContextTokens,
    frameworkGuidelines: frameworkGuidelinesTokens,
    codingStandards: codingStandardsTokens,
    architectureNotes: architectureNotesTokens,
  };

  // Add qualityGuidance to breakdown if present
  if (qualityGuidanceTokens !== undefined) {
    tokenBreakdown.qualityGuidance = qualityGuidanceTokens;
  }

  return {
    projectContext: response.projectContext.trim(),
    frameworkGuidelines: response.frameworkGuidelines.trim(),
    codingStandards: response.codingStandards.trim(),
    architectureNotes: response.architectureNotes.trim(),
    ...(response.qualityGuidance && {
      qualityGuidance: response.qualityGuidance.trim(),
    }),
    generatedAt: Date.now(),
    totalTokens,
    tokenBreakdown,
  };
}

/**
 * Extended sections type that includes optional qualityGuidance
 */
interface ExtractedSections extends Partial<PromptDesignerResponse> {
  qualityGuidance?: string;
}

/**
 * Parse unstructured text response (fallback for older LLM models)
 *
 * Attempts to extract sections from markdown-formatted text.
 *
 * @param text - Raw text response from LLM
 * @param countTokens - Function to count tokens
 * @returns Parsed output or null if parsing fails
 */
export async function parseTextResponse(
  text: string,
  countTokens: (text: string) => Promise<number>,
): Promise<PromptDesignerOutput | null> {
  const sections = extractSections(text);

  if (!sections.projectContext && !sections.frameworkGuidelines) {
    // Not enough structure to parse
    return null;
  }

  // Count tokens for each section using named object (avoids magic number indexing)
  const tokenCounts = {
    projectContext: await safeCountTokens(
      sections.projectContext || '',
      countTokens,
    ),
    frameworkGuidelines: await safeCountTokens(
      sections.frameworkGuidelines || '',
      countTokens,
    ),
    codingStandards: await safeCountTokens(
      sections.codingStandards || '',
      countTokens,
    ),
    architectureNotes: await safeCountTokens(
      sections.architectureNotes || '',
      countTokens,
    ),
    qualityGuidance: sections.qualityGuidance
      ? await safeCountTokens(sections.qualityGuidance, countTokens)
      : undefined,
  };

  const {
    projectContext: projectContextTokens,
    frameworkGuidelines: frameworkGuidelinesTokens,
    codingStandards: codingStandardsTokens,
    architectureNotes: architectureNotesTokens,
    qualityGuidance: qualityGuidanceTokens,
  } = tokenCounts;

  // Calculate total including optional qualityGuidance
  const totalTokens =
    projectContextTokens +
    frameworkGuidelinesTokens +
    codingStandardsTokens +
    architectureNotesTokens +
    (qualityGuidanceTokens ?? 0);

  const tokenBreakdown: PromptDesignerOutput['tokenBreakdown'] = {
    projectContext: projectContextTokens,
    frameworkGuidelines: frameworkGuidelinesTokens,
    codingStandards: codingStandardsTokens,
    architectureNotes: architectureNotesTokens,
  };

  // Add qualityGuidance to breakdown if present
  if (qualityGuidanceTokens !== undefined) {
    tokenBreakdown.qualityGuidance = qualityGuidanceTokens;
  }

  return {
    projectContext: sections.projectContext || '',
    frameworkGuidelines: sections.frameworkGuidelines || '',
    codingStandards: sections.codingStandards || '',
    architectureNotes: sections.architectureNotes || '',
    ...(sections.qualityGuidance && {
      qualityGuidance: sections.qualityGuidance,
    }),
    generatedAt: Date.now(),
    totalTokens,
    tokenBreakdown,
  };
}

/**
 * Extract sections from markdown text
 *
 * Looks for common heading patterns like:
 * - "## Project Context"
 * - "### 1. Project Context"
 * - "**Project Context**"
 *
 * : Added qualityGuidance section extraction
 */
function extractSections(text: string): ExtractedSections {
  const sections: ExtractedSections = {};

  // Patterns for section headers
  const patterns: Record<string, RegExp[]> = {
    projectContext: [
      /(?:^|\n)#+\s*(?:\d+\.\s*)?Project\s*Context\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
      /(?:^|\n)\*\*Project\s*Context\*\*\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
    ],
    frameworkGuidelines: [
      /(?:^|\n)#+\s*(?:\d+\.\s*)?Framework\s*(?:Guidelines?|Best\s*Practices?)\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
      /(?:^|\n)\*\*Framework\s*(?:Guidelines?|Best\s*Practices?)\*\*\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
    ],
    codingStandards: [
      /(?:^|\n)#+\s*(?:\d+\.\s*)?Coding\s*Standards?\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
      /(?:^|\n)\*\*Coding\s*Standards?\*\*\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
    ],
    architectureNotes: [
      /(?:^|\n)#+\s*(?:\d+\.\s*)?Architecture\s*(?:Notes?|Guidelines?)\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
      /(?:^|\n)\*\*Architecture\s*(?:Notes?|Guidelines?)\*\*\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
    ],
    // Quality Guidance patterns
    qualityGuidance: [
      /(?:^|\n)#+\s*(?:\d+\.\s*)?Quality\s*(?:Guidance|Context|Issues?)\s*(?:\(Optional\))?\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
      /(?:^|\n)\*\*Quality\s*(?:Guidance|Context|Issues?)\*\*\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
      /(?:^|\n)#+\s*(?:\d+\.\s*)?Code\s*Quality\s*(?:Guidance|Notes?)\s*\n([\s\S]*?)(?=\n#+\s*|\n\*\*[A-Z]|$)/i,
    ],
  };

  for (const [key, regexList] of Object.entries(patterns)) {
    for (const regex of regexList) {
      const match = text.match(regex);
      if (match && match[1]) {
        sections[key as keyof ExtractedSections] = match[1].trim();
        break;
      }
    }
  }

  return sections;
}

/**
 * Truncate section content to fit within token budget
 *
 * @param content - Section content
 * @param maxTokens - Maximum allowed tokens
 * @param currentTokens - Current token count
 * @returns Truncated content
 */
export function truncateToTokenBudget(
  content: string,
  maxTokens: number,
  currentTokens: number,
): string {
  if (currentTokens <= maxTokens) {
    return content;
  }

  // Estimate characters per token (roughly 4 chars per token)
  const targetChars = Math.floor((maxTokens / currentTokens) * content.length);

  // Find a good break point (end of sentence or line)
  let truncated = content.slice(0, targetChars);
  const lastPeriod = truncated.lastIndexOf('. ');
  const lastNewline = truncated.lastIndexOf('\n');
  const breakPoint = Math.max(lastPeriod, lastNewline);

  if (breakPoint > targetChars * 0.7) {
    truncated = truncated.slice(0, breakPoint + 1);
  }

  return truncated.trim() + '...';
}

/**
 * Validate output quality
 *
 * Checks that the generated output meets minimum quality standards.
 *
 * @param output - Generated output to validate
 * @returns Validation result with issues
 * : Added qualityGuidance validation
 */
export function validateOutput(output: PromptDesignerOutput): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check minimum content length (at least 50 chars per section)
  if (output.projectContext.length < 50) {
    issues.push('Project context is too brief');
  }

  if (output.frameworkGuidelines.length < 50) {
    issues.push('Framework guidelines are too brief');
  }

  if (output.codingStandards.length < 50) {
    issues.push('Coding standards are too brief');
  }

  // Architecture notes can be optional for simple projects
  // No minimum check

  // Quality guidance validation
  // If present and non-empty (after trimming), it should have meaningful content (at least 30 chars)
  // Empty string or whitespace-only is allowed (treated as absent)
  if (
    output.qualityGuidance !== undefined &&
    output.qualityGuidance.trim().length > 0 &&
    output.qualityGuidance.trim().length < 30
  ) {
    issues.push('Quality guidance is too brief');
  }

  // Check for generic/templated content
  const genericPhrases = [
    'follow best practices',
    'write clean code',
    'use good naming',
    'keep it simple',
  ];

  // Include qualityGuidance in content check
  const allContent = [
    output.projectContext,
    output.frameworkGuidelines,
    output.codingStandards,
    output.architectureNotes,
    output.qualityGuidance || '',
  ]
    .join(' ')
    .toLowerCase();

  for (const phrase of genericPhrases) {
    if (allContent.includes(phrase)) {
      issues.push(`Contains generic phrase: "${phrase}"`);
    }
  }

  // Check total tokens within budget (increased to 2300 with quality guidance)
  const tokenBudget = output.qualityGuidance ? 2300 : 2000;
  if (output.totalTokens > tokenBudget) {
    issues.push(
      `Total tokens (${output.totalTokens}) exceeds budget of ${tokenBudget}`,
    );
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Format output sections into a single prompt string
 *
 * @param output - Parsed output sections
 * @returns Formatted prompt string ready for appending
 * : Added qualityGuidance section formatting
 */
export function formatAsPromptSection(output: PromptDesignerOutput): string {
  const parts: string[] = [];

  parts.push('# Project-Specific Guidance');
  parts.push('');
  parts.push(
    '*This guidance was automatically generated based on workspace analysis.*',
  );
  parts.push('');

  if (output.projectContext) {
    parts.push('## Project Context');
    parts.push('');
    parts.push(output.projectContext);
    parts.push('');
  }

  if (output.frameworkGuidelines) {
    parts.push('## Framework Guidelines');
    parts.push('');
    parts.push(output.frameworkGuidelines);
    parts.push('');
  }

  if (output.codingStandards) {
    parts.push('## Coding Standards');
    parts.push('');
    parts.push(output.codingStandards);
    parts.push('');
  }

  if (output.architectureNotes) {
    parts.push('## Architecture Notes');
    parts.push('');
    parts.push(output.architectureNotes);
    parts.push('');
  }

  // Quality Guidance section
  if (output.qualityGuidance) {
    parts.push('## Quality Guidance');
    parts.push('');
    parts.push(output.qualityGuidance);
    parts.push('');
  }

  return parts.join('\n');
}
