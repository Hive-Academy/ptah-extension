/**
 * Response Parser for Prompt Designer Agent
 *
 * TASK_2025_137 Batch 2: Parses and validates LLM responses,
 * with fallback handling for malformed output.
 */

import type {
  PromptDesignerOutput,
  PromptDesignerResponse,
} from './prompt-designer.types';

/**
 * Parse structured LLM response into PromptDesignerOutput
 *
 * @param response - Validated response from getStructuredCompletion
 * @param countTokens - Function to count tokens in text
 * @returns Formatted output with token counts
 */
export async function parseStructuredResponse(
  response: PromptDesignerResponse,
  countTokens: (text: string) => Promise<number>
): Promise<PromptDesignerOutput> {
  // Count tokens for each section
  const [
    projectContextTokens,
    frameworkGuidelinesTokens,
    codingStandardsTokens,
    architectureNotesTokens,
  ] = await Promise.all([
    countTokens(response.projectContext),
    countTokens(response.frameworkGuidelines),
    countTokens(response.codingStandards),
    countTokens(response.architectureNotes),
  ]);

  const totalTokens =
    projectContextTokens +
    frameworkGuidelinesTokens +
    codingStandardsTokens +
    architectureNotesTokens;

  return {
    projectContext: response.projectContext.trim(),
    frameworkGuidelines: response.frameworkGuidelines.trim(),
    codingStandards: response.codingStandards.trim(),
    architectureNotes: response.architectureNotes.trim(),
    generatedAt: Date.now(),
    totalTokens,
    tokenBreakdown: {
      projectContext: projectContextTokens,
      frameworkGuidelines: frameworkGuidelinesTokens,
      codingStandards: codingStandardsTokens,
      architectureNotes: architectureNotesTokens,
    },
  };
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
  countTokens: (text: string) => Promise<number>
): Promise<PromptDesignerOutput | null> {
  const sections = extractSections(text);

  if (!sections.projectContext && !sections.frameworkGuidelines) {
    // Not enough structure to parse
    return null;
  }

  // Count tokens for each section
  const [
    projectContextTokens,
    frameworkGuidelinesTokens,
    codingStandardsTokens,
    architectureNotesTokens,
  ] = await Promise.all([
    countTokens(sections.projectContext || ''),
    countTokens(sections.frameworkGuidelines || ''),
    countTokens(sections.codingStandards || ''),
    countTokens(sections.architectureNotes || ''),
  ]);

  const totalTokens =
    projectContextTokens +
    frameworkGuidelinesTokens +
    codingStandardsTokens +
    architectureNotesTokens;

  return {
    projectContext: sections.projectContext || '',
    frameworkGuidelines: sections.frameworkGuidelines || '',
    codingStandards: sections.codingStandards || '',
    architectureNotes: sections.architectureNotes || '',
    generatedAt: Date.now(),
    totalTokens,
    tokenBreakdown: {
      projectContext: projectContextTokens,
      frameworkGuidelines: frameworkGuidelinesTokens,
      codingStandards: codingStandardsTokens,
      architectureNotes: architectureNotesTokens,
    },
  };
}

/**
 * Extract sections from markdown text
 *
 * Looks for common heading patterns like:
 * - "## Project Context"
 * - "### 1. Project Context"
 * - "**Project Context**"
 */
function extractSections(text: string): Partial<PromptDesignerResponse> {
  const sections: Partial<PromptDesignerResponse> = {};

  // Patterns for section headers
  const patterns = {
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
  };

  for (const [key, regexList] of Object.entries(patterns)) {
    for (const regex of regexList) {
      const match = text.match(regex);
      if (match && match[1]) {
        sections[key as keyof PromptDesignerResponse] = match[1].trim();
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
  currentTokens: number
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

  // Check for generic/templated content
  const genericPhrases = [
    'follow best practices',
    'write clean code',
    'use good naming',
    'keep it simple',
  ];

  const allContent = [
    output.projectContext,
    output.frameworkGuidelines,
    output.codingStandards,
    output.architectureNotes,
  ]
    .join(' ')
    .toLowerCase();

  for (const phrase of genericPhrases) {
    if (allContent.includes(phrase)) {
      issues.push(`Contains generic phrase: "${phrase}"`);
    }
  }

  // Check total tokens within budget
  if (output.totalTokens > 2000) {
    issues.push(`Total tokens (${output.totalTokens}) exceeds budget of 2000`);
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
 */
export function formatAsPromptSection(output: PromptDesignerOutput): string {
  const parts: string[] = [];

  parts.push('# Project-Specific Guidance');
  parts.push('');
  parts.push(
    '*This guidance was automatically generated based on workspace analysis.*'
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

  return parts.join('\n');
}
