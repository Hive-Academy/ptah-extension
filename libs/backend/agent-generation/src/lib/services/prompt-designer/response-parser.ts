/**
 * Response Parser for Prompt Designer Agent
 *
 * with fallback handling for malformed output.
 */

import {
  VALIDATOR_TOTAL_TOKENS_WITH_QUALITY,
  type PromptDesignerOutput,
  type PromptDesignerResponse,
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
    return null;
  }
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
 * Marker appended to a section that had to be shortened to fit the budget.
 */
const SECTION_SHORTENED_MARKER =
  '\n\n_(section shortened to fit the prompt budget)_';

/**
 * Estimate the token count of a text the way this module does (~4 characters
 * per token, rounded up). SafeCountTokens uses the same ratio as a fallback.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A list item starts with one of these markers followed by a space. */
const LIST_MARKER_PATTERN = /^(?:[-*+]|\d+[.)])\s/;

function isListItemStart(line: string): boolean {
  return LIST_MARKER_PATTERN.test(line.trimStart());
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s/.test(line);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlankLine(line: string): boolean {
  return line.trim() === '';
}

/**
 * Structural analysis of a section: the char offsets where a cut keeps every
 * Markdown block whole, and whether the content contains any list.
 *
 * A block is a heading with its body, a paragraph, or one complete top-level
 * list item. A list item owns every following line indented deeper than its
 * marker (wrapped text and nested items) and every blank line that a deeper
 * indented line follows (loose-list separation). A cut between the returned
 * offsets therefore never splits an item and never separates a nested item
 * from its parent.
 */
interface StructuralAnalysis {
  boundaries: number[];
  hasList: boolean;
}

function analyzeStructure(content: string): StructuralAnalysis {
  // Parse CR-stripped copies so CRLF content behaves the same, but compute
  // offsets from the raw lines so cuts stay byte-exact.
  const rawLines = content.split('\n');
  const lines = rawLines.map((line) =>
    line.endsWith('\r') ? line.slice(0, -1) : line,
  );
  const hasList = lines.some((line) => isListItemStart(line));

  const prefixLengths: number[] = [];
  let total = 0;
  for (const [i, line] of rawLines.entries()) {
    total += line.length + (i > 0 ? 1 : 0);
    prefixLengths.push(total);
  }

  const boundaries: number[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) {
      i++;
      continue;
    }
    if (isHeadingLine(line)) {
      // The heading block runs to the next blank line: a cut right after the
      // heading would leave it dangling without its body.
      i++;
      while (i < lines.length && !isBlankLine(lines[i])) {
        i++;
      }
      boundaries.push(prefixLengths[i - 1]);
      continue;
    }
    if (isListItemStart(line)) {
      const markerIndent = indentOf(line);
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (isBlankLine(next)) {
          const after = lines[i + 1];
          if (
            after === undefined ||
            isBlankLine(after) ||
            indentOf(after) <= markerIndent
          ) {
            break;
          }
          // Blank line inside the item, continued by a deeper-indented line.
          i += 2;
        } else if (indentOf(next) > markerIndent) {
          // Continuation line: wrapped text or a nested item.
          i++;
        } else {
          break;
        }
      }
      boundaries.push(prefixLengths[i - 1]);
      continue;
    }
    // Paragraph: ends at a blank line, a heading, or the start of a list.
    i++;
    while (
      i < lines.length &&
      !isBlankLine(lines[i]) &&
      !isHeadingLine(lines[i]) &&
      !isListItemStart(lines[i])
    ) {
      i++;
    }
    boundaries.push(prefixLengths[i - 1]);
  }

  return { boundaries, hasList };
}

/**
 * Truncate section content to fit within token budget
 *
 * Reserves the shortened marker's token cost before it selects a boundary,
 * and verifies the complete result (content plus marker) against the budget.
 *
 * When the content contains a list, the cut lands on a block boundary only:
 * the leading whole items (each with all continuation lines and nested
 * children) that fit the reserved target are kept, the rest is dropped, and
 * the sentence-level fallback never runs. Empty content plus the marker is
 * the last resort.
 *
 * When the content contains no list, a structural boundary above half the
 * reserved target wins; otherwise a sentence-level cut runs. Budgets too
 * small for even the marker return the marker alone.
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

  const markerOnly = SECTION_SHORTENED_MARKER.trim();
  const markerTokens = estimateTokens(SECTION_SHORTENED_MARKER);
  if (maxTokens < markerTokens) {
    // The budget cannot hold even the shortened marker.
    return markerOnly;
  }

  const targetChars = Math.floor((maxTokens / currentTokens) * content.length);
  // Reserve the marker's cost before selecting a boundary.
  const effectiveTargetChars = targetChars - markerTokens;
  if (effectiveTargetChars <= 0) {
    return markerOnly;
  }

  const { boundaries, hasList } = analyzeStructure(content);

  // Largest boundary that fits the reserved target.
  let end = -1;
  while (
    end + 1 < boundaries.length &&
    boundaries[end + 1] <= effectiveTargetChars
  ) {
    end++;
  }

  if (hasList) {
    // Never cut inside a list with the sentence heuristic: walk to the
    // nearest safe boundary, with no floor. Empty content plus the marker
    // is the last resort.
    while (
      end >= 0 &&
      estimateTokens(
        content.slice(0, boundaries[end]) + SECTION_SHORTENED_MARKER,
      ) > maxTokens
    ) {
      // The complete result is still over budget: one boundary back.
      end--;
    }
    if (end < 0) {
      return markerOnly;
    }
    return content.slice(0, boundaries[end]).trim() + SECTION_SHORTENED_MARKER;
  }

  // No list in the content: a structural boundary above half the reserved
  // target wins; otherwise the sentence-level fallback runs.
  if (end >= 0 && boundaries[end] >= effectiveTargetChars * 0.5) {
    let boundaryEnd = end;
    while (
      boundaryEnd >= 0 &&
      estimateTokens(
        content.slice(0, boundaries[boundaryEnd]) + SECTION_SHORTENED_MARKER,
      ) > maxTokens
    ) {
      boundaryEnd--;
    }
    if (boundaryEnd >= 0) {
      return (
        content.slice(0, boundaries[boundaryEnd]).trim() +
        SECTION_SHORTENED_MARKER
      );
    }
  }

  let truncated = content.slice(0, targetChars);
  const lastPeriod = truncated.lastIndexOf('. ');
  const lastNewline = truncated.lastIndexOf('\n');
  const breakPoint = Math.max(lastPeriod, lastNewline);

  if (breakPoint > targetChars * 0.7) {
    truncated = truncated.slice(0, breakPoint + 1);
  }

  // Verify the complete result, marker included, and shrink until it fits.
  while (
    truncated.length > 0 &&
    estimateTokens(truncated + SECTION_SHORTENED_MARKER) > maxTokens
  ) {
    const overflow =
      estimateTokens(truncated + SECTION_SHORTENED_MARKER) - maxTokens;
    truncated = content.slice(0, Math.max(0, truncated.length - overflow * 4));
  }
  if (truncated.trim().length === 0) {
    return markerOnly;
  }
  return truncated.trim() + SECTION_SHORTENED_MARKER;
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
  if (output.projectContext.length < 50) {
    issues.push('Project context is too brief');
  }

  if (output.frameworkGuidelines.length < 50) {
    issues.push('Framework guidelines are too brief');
  }

  if (output.codingStandards.length < 50) {
    issues.push('Coding standards are too brief');
  }
  if (
    output.qualityGuidance !== undefined &&
    output.qualityGuidance.trim().length > 0 &&
    output.qualityGuidance.trim().length < 30
  ) {
    issues.push('Quality guidance is too brief');
  }
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
    output.qualityGuidance || '',
  ]
    .join(' ')
    .toLowerCase();

  for (const phrase of genericPhrases) {
    if (allContent.includes(phrase)) {
      issues.push(`Contains generic phrase: "${phrase}"`);
    }
  }
  const tokenBudget = output.qualityGuidance
    ? VALIDATOR_TOTAL_TOKENS_WITH_QUALITY
    : 2000;
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
  if (output.qualityGuidance) {
    parts.push('## Quality Guidance');
    parts.push('');
    parts.push(output.qualityGuidance);
    parts.push('');
  }

  return parts.join('\n');
}
