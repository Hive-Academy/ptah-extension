import type { EnhancedPromptsSummary } from '@ptah-extension/shared';

export const GUIDANCE_SECTION_NAMES = [
  'Project Context',
  'Framework Guidelines',
  'Coding Standards',
  'Architecture Notes',
] as const;

export type GuidanceSectionCounts = Pick<EnhancedPromptsSummary, 'sections'>;

/** Count only the canonical sections emitted by buildCombinedPrompt. */
export function parseGuidanceSectionCounts(content: string | null): GuidanceSectionCounts | null {
  if (!content?.trim()) return null;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const marker = lines.findIndex((line) => line.trimEnd() === '## Project-Specific Guidance');
  if (marker < 0) return null;

  const found: Array<{ name: (typeof GUIDANCE_SECTION_NAMES)[number]; start: number }> = [];
  let cursor = marker + 1;
  for (const name of GUIDANCE_SECTION_NAMES) {
    const index = lines.findIndex((line, position) =>
      position >= cursor && line.trimEnd() === `### ${name}`,
    );
    if (index >= 0) {
      found.push({ name, start: index });
      cursor = index + 1;
    }
  }
  if (found.length === 0) return null;
  const sections = GUIDANCE_SECTION_NAMES.map((name) => {
    const position = found.findIndex((heading) => heading.name === name);
    if (position < 0) return { name, wordCount: 0, generated: false };
    const start = found[position].start + 1;
    const end = found[position + 1]?.start ?? lines.length;
    return { name, wordCount: lines.slice(start, end).join('\n').split(/\s+/).filter(Boolean).length, generated: true };
  });
  return { sections };
}
