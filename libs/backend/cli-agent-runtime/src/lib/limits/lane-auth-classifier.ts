/** Conservative vendor-independent authentication failure wording. */
const AUTH_PATTERNS: readonly RegExp[] = [
  /\b401\b/i,
  /\bunauthori[sz]ed\b/i,
  /\bnot logged in\b/i,
  /\binvalid api key\b/i,
  /\bauthentication (?:failed|required)\b/i,
  /\bplease (?:run|use)\b[^\n]*\blogin\b/i,
];

export function matchesAuthFailure(texts: readonly string[]): boolean {
  return texts.some((value) =>
    AUTH_PATTERNS.some((pattern) => pattern.test(value)),
  );
}
