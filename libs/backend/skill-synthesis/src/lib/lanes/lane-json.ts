/**
 * The manual JSON extractor — the ONLY path a `structuredOutput: 'parse'` lane
 * has, and the fallback every `'sdk'` lane needs when its endpoint ignores
 * `outputFormat`.
 *
 * ## This is load-bearing, not belt-and-braces
 *
 * It is tempting to read this as dead code once JSON-Schema constrained output
 * exists. It is the opposite. `outputFormat` is honoured by the Anthropic
 * endpoint; a self-hosted or proxied endpoint typically ignores the field
 * entirely and answers in prose with a fenced JSON block, and there is no error
 * to detect — the call succeeds and `structured_output` is simply absent. Delete
 * this and every lane pointed at such an endpoint silently produces nothing.
 *
 * ## Why it is a scanner rather than a regex
 *
 * Two extractors exist in this library today and this file is their union:
 * `SkillSynthesizerService.extractJsonObject` (brace-balanced from the first
 * `{`) and `SkillJudgeService`'s `/\{[^{}]*\}/` (first FLAT object anywhere in
 * the text). Neither alone is sufficient — the first fails when a model opens
 * with prose containing a stray brace, the second fails on any nested object.
 * This scans every `{` in order and returns the first balanced slice that
 * actually parses, which is a superset of both.
 *
 * Quote-awareness matters for the same reason: a body field routinely contains
 * `}` inside a string, and a naive depth counter closes the object early and
 * yields a slice that does not parse.
 *
 * NOTE ON THE TWO PRIVATE COPIES. `SkillJudgeService` and
 * `SkillSynthesizerService` still carry their own extractors. They fold into
 * this one in B1.6, when those services start routing through `LaneRunner`.
 * Deleting them now would break the callers that do not go through the runner
 * yet — which is precisely the failure this file exists to prevent.
 */

/**
 * The first balanced `{...}` slice in `text` that parses as JSON, or `null`.
 *
 * Returns `unknown` deliberately: this function knows nothing about the shape
 * a caller wants. Validation belongs at the caller's Zod schema, not here.
 */
export function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  for (
    let start = text.indexOf('{');
    start >= 0;
    start = text.indexOf('{', start + 1)
  ) {
    const slice = balancedSlice(text, start);
    if (slice === null) continue;
    try {
      return JSON.parse(slice) as unknown;
    } catch {
      // Not JSON after all — keep looking from the next `{`.
    }
  }
  return null;
}

/**
 * The substring from `start` to its matching `}`, or `null` when the braces
 * never balance. String literals are skipped so a `}` inside a value does not
 * close the object.
 */
function balancedSlice(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
