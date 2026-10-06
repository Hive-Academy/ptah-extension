export interface FactMatchDefinition {
  readonly keyTokens: readonly (readonly string[])[];
  readonly forbiddenTokens: readonly string[];
}

export interface MatchableMemoryRow {
  readonly subject?: string | null;
  readonly content?: string | null;
  readonly chunk?: string | null;
}

/** Normalises source text exactly as required by the frozen fact labels. */
export function normalizeFactText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Matches every required token alternative against subject, content, and chunk.
 * Forbidden tokens always take precedence over otherwise complete matches.
 */
export function matchesFact(
  fact: FactMatchDefinition,
  row: MatchableMemoryRow,
): boolean {
  const haystack = normalizeFactText(
    [row.subject, row.content, row.chunk]
      .filter((part): part is string => part != null)
      .join(' '),
  );
  if (fact.forbiddenTokens.some((token) => containsToken(haystack, token)))
    return false;
  return fact.keyTokens.every((alternates) =>
    alternates.some((token) => containsToken(haystack, token)),
  );
}

function containsToken(haystack: string, token: string): boolean {
  const normalized = normalizeFactText(token);
  return normalized.length > 0 && haystack.includes(normalized);
}
