/**
 * Translation-file loading and the value-level rules that compare `en` with
 * `ar`: parity (7.1), placeholder and markup parity.
 *
 * Files are parsed twice on purpose: `JSON.parse` is the authority on
 * validity (the TypeScript JSON parser accepts comments and trailing commas),
 * and `ts.parseJsonText` supplies the key positions and duplicate detection
 * that `JSON.parse` discards.
 */
import * as fs from 'fs';
import * as ts from 'typescript';
import { compareText, type Violation } from './report';

export interface TranslationEntry {
  key: string;
  /** The string value, or null when the value is not a non-empty string. */
  value: string | null;
  line: number;
}

export interface TranslationFile {
  /** Workspace-relative path. */
  file: string;
  /** False when the file is missing or failed to parse; its keys are then unknown. */
  loaded: boolean;
  /** Flattened leaf keys, insertion-ordered as in the file. */
  entries: Map<string, TranslationEntry>;
  /** Every object prefix (e.g. `pricing.card`) with its count of leaf descendants. */
  namespaces: Map<string, number>;
  violations: Violation[];
}

/**
 * Reads one translation file. Keys are prefixed with `scope.`, because that is
 * how Transloco addresses a scope's keys once the file is merged.
 */
export function loadTranslationFile(
  absPath: string,
  relPath: string,
  scope: string,
): TranslationFile {
  const result: TranslationFile = {
    file: relPath,
    loaded: false,
    entries: new Map(),
    namespaces: new Map(),
    violations: [],
  };

  if (!fs.existsSync(absPath)) {
    result.violations.push({
      file: relPath,
      line: 0,
      kind: 'missing-file',
      key: '',
      detail: 'translation file not found',
    });
    return result;
  }

  const text = fs.readFileSync(absPath, 'utf8');
  try {
    JSON.parse(text);
  } catch (error: unknown) {
    // A parse failure is reported, never skipped (plan:357).
    result.violations.push({
      file: relPath,
      line: 0,
      kind: 'parse-error',
      key: '',
      detail: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  const source = ts.parseJsonText(relPath, text);
  const root = source.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) {
    result.violations.push({
      file: relPath,
      line: 1,
      kind: 'invalid-value',
      key: '',
      detail: 'the top level must be a JSON object',
    });
    return result;
  }

  // Batch 2 carry-over: `I18nService.unwrapJsonModule` cannot tell a file
  // whose only top-level key is `default` from a JSON module wrapper, so such
  // a file would silently lose its `default.` prefix at runtime.
  if (
    root.properties.length === 1 &&
    propertyName(root.properties[0]) === 'default'
  ) {
    result.violations.push({
      file: relPath,
      line: lineOf(source, root.properties[0]),
      kind: 'sole-default-key',
      key: `${scope}.default`,
      detail:
        'the only top-level key is "default", which the i18n runtime treats as a JSON module wrapper; add a sibling key or rename it',
    });
  }

  walkObject(source, root, scope, result);
  result.loaded = true;
  return result;
}

function walkObject(
  source: ts.JsonSourceFile,
  node: ts.ObjectLiteralExpression,
  prefix: string,
  result: TranslationFile,
): number {
  let leafCount = 0;
  const seen = new Set<string>();

  for (const property of node.properties) {
    const name = propertyName(property);
    const line = lineOf(source, property);
    if (name === null || !ts.isPropertyAssignment(property)) {
      result.violations.push({
        file: result.file,
        line,
        kind: 'invalid-value',
        key: prefix,
        detail: 'unsupported property form',
      });
      continue;
    }

    const key = `${prefix}.${name}`;
    if (name === '' || name.includes('.')) {
      result.violations.push({
        file: result.file,
        line,
        kind: 'dotted-key',
        key,
        detail: 'a key segment must be non-empty and contain no "."',
      });
      continue;
    }
    if (seen.has(name)) {
      result.violations.push({
        file: result.file,
        line,
        kind: 'duplicate-key',
        key,
        detail: 'the key is defined more than once in the same object',
      });
      continue;
    }
    seen.add(name);

    const value = property.initializer;
    if (ts.isObjectLiteralExpression(value)) {
      const count = walkObject(source, value, key, result);
      result.namespaces.set(key, count);
      leafCount += count;
      continue;
    }

    leafCount += 1;
    if (ts.isStringLiteral(value) && value.text.trim() !== '') {
      result.entries.set(key, { key, value: value.text, line });
      continue;
    }
    result.entries.set(key, { key, value: null, line });
    result.violations.push({
      file: result.file,
      line,
      kind: 'invalid-value',
      key,
      detail: ts.isStringLiteral(value)
        ? 'the value is an empty string'
        : 'the value must be a non-empty string',
    });
  }
  return leafCount;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  const name = property.name;
  if (name && (ts.isStringLiteral(name) || ts.isIdentifier(name))) {
    return name.text;
  }
  return null;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Parity (7.1): the flattened key sets of `en` and `ar` are equal. */
export function checkParity(
  en: TranslationFile,
  ar: TranslationFile,
): Violation[] {
  if (!en.loaded || !ar.loaded) return [];
  const violations: Violation[] = [];
  for (const entry of en.entries.values()) {
    if (!ar.entries.has(entry.key)) {
      violations.push({
        file: en.file,
        line: entry.line,
        kind: 'missing-in-ar',
        key: entry.key,
        detail: `present in en.json, missing from ${ar.file}`,
      });
    }
  }
  for (const entry of ar.entries.values()) {
    if (!en.entries.has(entry.key)) {
      violations.push({
        file: ar.file,
        line: entry.line,
        kind: 'missing-in-en',
        key: entry.key,
        detail: `present in ar.json, missing from ${en.file}`,
      });
    }
  }
  return violations;
}

const PLACEHOLDER_RE = /\{\{\s*([^{}\s]+)\s*\}\}/g;
const TAG_RE = /<\/?\s*([A-Za-z][A-Za-z0-9-]*)\b[^>]*>/g;
const ALLOWED_TAGS = new Set(['strong', 'em', 'code', 'a']);

/** Sorted, de-duplicated `{{ param }}` names in a value. */
export function placeholdersOf(value: string): string[] {
  const names = new Set<string>();
  for (const match of value.matchAll(PLACEHOLDER_RE)) names.add(match[1]);
  return [...names].sort(compareText);
}

/** Every tag occurrence (`a`, `/a`, …) in a value, sorted. */
export function tagsOf(value: string): string[] {
  const tags: string[] = [];
  for (const match of value.matchAll(TAG_RE)) {
    const closing = match[0].startsWith('</') ? '/' : '';
    tags.push(`${closing}${match[1].toLowerCase()}`);
  }
  return tags.sort(compareText);
}

/** Placeholder and markup parity for every key present in both files. */
export function checkPlaceholdersAndMarkup(
  en: TranslationFile,
  ar: TranslationFile,
): Violation[] {
  const violations: Violation[] = [];
  for (const file of [en, ar]) {
    for (const entry of file.entries.values()) {
      if (entry.value === null) continue;
      const disallowed = tagsOf(entry.value)
        .map((t) => t.replace(/^\//, ''))
        .filter((t) => !ALLOWED_TAGS.has(t));
      if (disallowed.length > 0) {
        violations.push({
          file: file.file,
          line: entry.line,
          kind: 'disallowed-tag',
          key: entry.key,
          detail: `only strong|em|code|a are allowed; found ${[...new Set(disallowed)].join(', ')}`,
        });
      }
    }
  }

  for (const enEntry of en.entries.values()) {
    const arEntry = ar.entries.get(enEntry.key);
    if (!arEntry || enEntry.value === null || arEntry.value === null) continue;
    const enParams = placeholdersOf(enEntry.value).join(',');
    const arParams = placeholdersOf(arEntry.value).join(',');
    if (enParams !== arParams) {
      violations.push({
        file: ar.file,
        line: arEntry.line,
        kind: 'placeholder-mismatch',
        key: enEntry.key,
        detail: `en {${enParams}} vs ar {${arParams}}`,
      });
    }
    const enTags = tagsOf(enEntry.value).join(',');
    const arTags = tagsOf(arEntry.value).join(',');
    if (enTags !== arTags) {
      violations.push({
        file: ar.file,
        line: arEntry.line,
        kind: 'markup-mismatch',
        key: enEntry.key,
        detail: `en [${enTags}] vs ar [${arTags}]`,
      });
    }
  }
  return violations;
}
