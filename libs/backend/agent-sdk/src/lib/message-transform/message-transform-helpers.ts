/**
 * SdkMessageTransformer helper functions — stateless predicates.
 *
 * Extracted from `sdk-message-transformer.ts` as part of TASK_2025_291 Wave C7a.
 *
 * These are pure functions with no instance state; the coordinator's per-context
 * Maps and Sets remain on `SdkMessageTransformer`. Library-internal module.
 */

import type { SDKUserMessage } from '../types/sdk-types/claude-sdk.types';

/**
 * Generate unique event ID
 * Format: evt_{timestamp}_{random}
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Detect SDK meta/skill content in a user message.
 *
 * The SDK wraps some internal messages (skill .md content, command metadata,
 * invoked-skills summaries, plan file references, skill frontmatter) that must
 * not reach the UI. This is a content-based last-resort filter — the primary
 * filter is the isSynthetic/isMeta flag on the SDK message itself.
 */
export function isSkillOrMetaContent(sdkMessage: SDKUserMessage): boolean {
  // Check sourceToolUseID — Skill tool injects messages with sourceToolUseID like "Skill_0"
  const sourceToolUseId = (sdkMessage as unknown as Record<string, unknown>)[
    'sourceToolUseID'
  ] as string | undefined;
  if (sourceToolUseId && typeof sourceToolUseId === 'string') {
    return true;
  }

  // Extract text content for pattern matching
  const content = sdkMessage.message?.content;
  if (!content) return false;

  let textContent = '';
  if (typeof content === 'string') {
    textContent = content;
  } else if (Array.isArray(content)) {
    textContent = content
      .filter(
        (block): block is { type: 'text'; text: string } =>
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          block.type === 'text' &&
          'text' in block,
      )
      .map((block) => block.text)
      .join('\n');
  }

  if (!textContent) return false;

  // Check for SDK meta content markers.
  if (textContent.includes('<skill-format>true</skill-format>')) return true;
  if (textContent.includes('<command-message>')) return true;
  if (textContent.includes('<command-name>')) return true;
  if (textContent.startsWith('Base directory for this skill:')) return true;

  if (
    textContent.startsWith('The following skills were invoked in this session')
  )
    return true;

  if (textContent.startsWith('A plan file exists from plan mode at:'))
    return true;

  if (
    textContent.startsWith('---\n') &&
    textContent.includes('\nname:') &&
    textContent.includes('\ndescription:')
  )
    return true;

  return false;
}

/**
 * Check if a user message contains tool_result content blocks.
 *
 * Tool results are legitimate responses to tool_use and should NOT be filtered,
 * even during active Skill execution.
 */
export function userMessageHasToolResult(sdkMessage: SDKUserMessage): boolean {
  const content = sdkMessage.message?.content;
  if (!Array.isArray(content)) return false;

  return content.some(
    (block) =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      block.type === 'tool_result',
  );
}
