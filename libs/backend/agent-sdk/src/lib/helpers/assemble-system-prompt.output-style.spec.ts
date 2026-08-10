/**
 * `assembleSystemPrompt` — output-style INJECT path (TASK_2026_197 §3.4).
 *
 * The one thing these specs exist to prove is Req 5.3: a style body reaches
 * the assembled prompt **exactly once**. "Exactly once" is asserted with a
 * unique sentinel and an occurrence COUNT, not with `toContain` — a duplicate
 * append would still satisfy `toContain`, which is precisely the regression
 * that would ship a silently doubled instruction to the model.
 *
 * `assembleSystemPrompt` is a pure exported function, so no DI container and
 * no builder instance are involved.
 */

import 'reflect-metadata';

import { assembleSystemPrompt } from './sdk-query-options-builder';
import { PTAH_CORE_SYSTEM_PROMPT } from '../prompt-harness';
import type { AuthEnv } from '@ptah-extension/shared';

/** Unique enough that it cannot collide with the core prompt or the preset. */
const SENTINEL = '<<STYLE_SENTINEL>>';
const STYLE_BODY = `Answer tersely. ${SENTINEL} No preamble.`;
const USER_PROMPT = 'Always reply in British English.';

/**
 * No provider id → `buildModelIdentityPrompt` returns undefined, so the
 * baseline prompt is exactly `PTAH_CORE_SYSTEM_PROMPT` and any change to the
 * assembled content is attributable to the field under test.
 */
const BASE_INPUT = {
  providerId: null,
  authEnv: {} as AuthEnv,
  mcpServerRunning: false,
} as const;

/** Occurrences of `needle` in `haystack`. */
function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('assembleSystemPrompt — output style body', () => {
  it('baseline: with no style and no user prompt the content is the core prompt alone', () => {
    const result = assembleSystemPrompt({ ...BASE_INPUT });

    expect(result.mode).toBe('preset-append');
    expect(result.content).toBe(PTAH_CORE_SYSTEM_PROMPT);
  });

  it('appends the style body EXACTLY ONCE', () => {
    const result = assembleSystemPrompt({
      ...BASE_INPUT,
      outputStyleBody: STYLE_BODY,
    });

    const content = result.content ?? '';
    expect(countOf(content, SENTINEL)).toBe(1);
    expect(countOf(content, PTAH_CORE_SYSTEM_PROMPT)).toBe(1);
  });

  it('appends the style body exactly once alongside a user system prompt', () => {
    const result = assembleSystemPrompt({
      ...BASE_INPUT,
      userSystemPrompt: USER_PROMPT,
      outputStyleBody: STYLE_BODY,
    });

    const content = result.content ?? '';
    // Both are present…
    expect(content).toContain(USER_PROMPT);
    expect(content).toContain(SENTINEL);
    // …and neither the style nor the core prompt was duplicated by adding the
    // second append slot.
    expect(countOf(content, SENTINEL)).toBe(1);
    expect(countOf(content, USER_PROMPT)).toBe(1);
    expect(countOf(content, PTAH_CORE_SYSTEM_PROMPT)).toBe(1);
  });

  it('changes nothing when outputStyleBody is undefined', () => {
    const baseline = assembleSystemPrompt({ ...BASE_INPUT });
    const result = assembleSystemPrompt({
      ...BASE_INPUT,
      outputStyleBody: undefined,
    });

    expect(result.content).toBe(baseline.content);
    expect(result.content ?? '').not.toContain(SENTINEL);
  });

  it('does not append an all-whitespace body (trim guard)', () => {
    const baseline = assembleSystemPrompt({ ...BASE_INPUT });
    const result = assembleSystemPrompt({
      ...BASE_INPUT,
      outputStyleBody: '   ',
    });

    // Byte-identical to the baseline: no stray blank section, no trailing
    // separator from an empty append part.
    expect(result.content).toBe(baseline.content);
  });

  it('keeps the style body downstream of the core prompt', () => {
    const result = assembleSystemPrompt({
      ...BASE_INPUT,
      outputStyleBody: STYLE_BODY,
    });

    const content = result.content ?? '';
    // PTAH_CORE_SYSTEM_PROMPT is the stronger voice and must not be displaced
    // by a style (R1) — the style influences, it does not govern.
    expect(content.indexOf(PTAH_CORE_SYSTEM_PROMPT)).toBeLessThan(
      content.indexOf(SENTINEL),
    );
  });

  it('keeps an enhanced-prompts section intact when a style is also appended', () => {
    const enhanced = 'PROJECT GUIDANCE: prefer nx generators.';
    const result = assembleSystemPrompt({
      ...BASE_INPUT,
      outputStyleBody: STYLE_BODY,
      enhancedPromptsContent: enhanced,
    });

    const content = result.content ?? '';
    expect(countOf(content, enhanced)).toBe(1);
    expect(countOf(content, SENTINEL)).toBe(1);
  });
});
