/**
 * Do-not-translate glossary (6.2) and the real-Arabic rule (8.1).
 *
 * A glossary term matches only as a whole token: it may not be preceded or
 * followed by a Latin letter or digit, so `Nx` never matches inside a longer
 * Latin word. Matching is case-sensitive and verbatim.
 */
import * as fs from 'fs';
import type { Violation } from './report';
import type { TranslationFile } from './translation-files';

export interface GlossaryEntry {
  term: string;
  reason: string;
}

export interface Glossary {
  /** Terms sorted longest first, so `Ptah Builders` is removed before `Ptah`. */
  entries: GlossaryEntry[];
  violations: Violation[];
}

export function loadGlossary(absPath: string, relPath: string): Glossary {
  const glossary: Glossary = { entries: [], violations: [] };
  const fail = (detail: string): Glossary => {
    glossary.violations.push({
      file: relPath,
      line: 0,
      kind: 'glossary-invalid',
      key: '',
      detail,
    });
    return glossary;
  };

  if (!fs.existsSync(absPath)) return fail('glossary file not found');
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error: unknown) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (!Array.isArray(data)) return fail('the glossary must be a JSON array');

  const seen = new Set<string>();
  data.forEach((item: unknown, index: number) => {
    const record = item as Partial<Record<string, unknown>> | null;
    const term = record?.['term'];
    const reason = record?.['reason'];
    if (
      typeof term !== 'string' ||
      term.trim() !== term ||
      term === '' ||
      typeof reason !== 'string' ||
      reason.trim() === ''
    ) {
      fail(
        `entry ${index} must be { "term": <trimmed non-empty string>, "reason": <non-empty string> }`,
      );
      return;
    }
    if (seen.has(term)) {
      fail(`entry ${index} repeats the term "${term}"`);
      return;
    }
    seen.add(term);
    glossary.entries.push({ term, reason });
  });

  glossary.entries.sort(
    (a, b) => b.term.length - a.term.length || (a.term < b.term ? -1 : 1),
  );
  return glossary;
}

function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g');
}

export function containsTerm(value: string, term: string): boolean {
  return termPattern(term).test(value);
}

const ARABIC_RE = /[؀-ۿ]/;
const PLACEHOLDER_RE = /\{\{[^{}]*\}\}/g;
const TAG_RE = /<\/?\s*[A-Za-z][^>]*>/g;
const NEUTRAL_RE = /^[\s\d\p{P}\p{S}]*$/u;

/**
 * True when the `en` value is made up solely of glossary terms, placeholders,
 * digits, punctuation and symbols (markup tags are ignored). Such a value is
 * copied verbatim into `ar` instead of translated (8.1 exception).
 */
export function isVerbatimValue(value: string, glossary: Glossary): boolean {
  let rest = value.replace(PLACEHOLDER_RE, ' ').replace(TAG_RE, ' ');
  for (const { term } of glossary.entries) {
    rest = rest.replace(termPattern(term), ' ');
  }
  return NEUTRAL_RE.test(rest);
}

/** Glossary (6.2) and real-Arabic (8.1) rules over the keys present in both files. */
export function checkGlossaryAndArabic(
  en: TranslationFile,
  ar: TranslationFile,
  glossary: Glossary,
): Violation[] {
  const violations: Violation[] = [];
  for (const enEntry of en.entries.values()) {
    const arEntry = ar.entries.get(enEntry.key);
    if (!arEntry || enEntry.value === null || arEntry.value === null) continue;
    const enValue = enEntry.value;
    const arValue = arEntry.value;

    const missing = glossary.entries
      .filter(({ term }) => containsTerm(enValue, term))
      .filter(({ term }) => !containsTerm(arValue, term))
      .map(({ term }) => term);
    if (missing.length > 0) {
      violations.push({
        file: ar.file,
        line: arEntry.line,
        kind: 'glossary-term-missing',
        key: enEntry.key,
        detail: `ar must contain verbatim: ${missing.join(', ')}`,
      });
    }

    if (isVerbatimValue(enValue, glossary)) {
      if (arValue !== enValue) {
        violations.push({
          file: ar.file,
          line: arEntry.line,
          kind: 'verbatim-mismatch',
          key: enEntry.key,
          detail:
            'en holds only glossary terms, placeholders, digits and punctuation, so ar must equal en',
        });
      }
    } else if (!ARABIC_RE.test(arValue.replace(PLACEHOLDER_RE, ''))) {
      violations.push({
        file: ar.file,
        line: arEntry.line,
        kind: 'not-arabic',
        key: enEntry.key,
        detail: 'the ar value contains no Arabic-script character',
      });
    }
  }
  return violations;
}
