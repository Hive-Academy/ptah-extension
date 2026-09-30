import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkParity,
  checkPlaceholdersAndMarkup,
  loadTranslationFile,
  placeholdersOf,
  tagsOf,
} from './translation-files';

describe('translation-files', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const load = (name: string, content: string | null, scope = 'pricing') => {
    const abs = path.join(dir, name);
    if (content !== null) fs.writeFileSync(abs, content);
    return loadTranslationFile(abs, name, scope);
  };

  it('flattens nested keys under the scope with their lines and namespace sizes', () => {
    const file = load(
      'en.json',
      '{\n  "page": {\n    "title": "Pricing",\n    "sub": { "a": "A" }\n  }\n}',
    );
    expect(file.loaded).toBe(true);
    expect([...file.entries.values()]).toEqual([
      { key: 'pricing.page.title', value: 'Pricing', line: 3 },
      { key: 'pricing.page.sub.a', value: 'A', line: 4 },
    ]);
    expect(file.namespaces.get('pricing.page')).toBe(2);
    expect(file.namespaces.get('pricing.page.sub')).toBe(1);
    expect(file.violations).toEqual([]);
  });

  it('reports a sole top-level "default" key (JSON module wrapper ambiguity)', () => {
    const file = load('en.json', '{\n  "default": { "title": "Terms" }\n}');
    expect(file.violations).toEqual([
      expect.objectContaining({
        kind: 'sole-default-key',
        file: 'en.json',
        line: 2,
        key: 'pricing.default',
      }),
    ]);
  });

  it('accepts "default" next to sibling namespaces', () => {
    const file = load(
      'en.json',
      '{ "default": { "a": "A" }, "theme": { "a": "B" } }',
    );
    expect(file.violations).toEqual([]);
    expect(file.entries.has('pricing.default.a')).toBe(true);
  });

  it('reports a parse failure instead of skipping the file', () => {
    const file = load('en.json', '{ "a": "x", }');
    expect(file.loaded).toBe(false);
    expect(file.violations).toEqual([
      expect.objectContaining({ kind: 'parse-error', file: 'en.json' }),
    ]);
  });

  it('reports a missing file', () => {
    const file = load('ar.json', null);
    expect(file.loaded).toBe(false);
    expect(file.violations).toEqual([
      expect.objectContaining({ kind: 'missing-file' }),
    ]);
  });

  it('reports empty, non-string, duplicate and dotted entries', () => {
    const file = load(
      'en.json',
      '{ "a": "", "b": 3, "c": "x", "c": "y", "d.e": "z", "f": [] }',
    );
    expect(file.violations.map((v) => `${v.kind}:${v.key}`)).toEqual([
      'invalid-value:pricing.a',
      'invalid-value:pricing.b',
      'duplicate-key:pricing.c',
      'dotted-key:pricing.d.e',
      'invalid-value:pricing.f',
    ]);
  });

  it('rejects a top level that is not an object', () => {
    expect(load('en.json', '[]').violations).toEqual([
      expect.objectContaining({ kind: 'invalid-value', line: 1 }),
    ]);
  });

  it('reports keys missing on either side', () => {
    const en = load('en.json', '{ "a": "A", "b": "B" }');
    const ar = load('ar.json', '{ "a": "أ", "c": "ج" }');
    expect(
      checkParity(en, ar).map((v) => `${v.file}:${v.kind}:${v.key}`),
    ).toEqual([
      'en.json:missing-in-ar:pricing.b',
      'ar.json:missing-in-en:pricing.c',
    ]);
  });

  it('extracts placeholders and tags', () => {
    expect(placeholdersOf('{{ b }} and {{a}} and {{ b }}')).toEqual(['a', 'b']);
    expect(tagsOf('<a href="x">x</a> <strong>y</strong>')).toEqual([
      '/a',
      '/strong',
      'a',
      'strong',
    ]);
  });

  it('reports placeholder, markup and disallowed-tag differences', () => {
    const en = load(
      'en.json',
      '{ "p": "Hi {{ name }}", "m": "<strong>x</strong>", "t": "<div>x</div>" }',
    );
    const ar = load(
      'ar.json',
      '{ "p": "مرحبا {{ nom }}", "m": "<em>س</em>", "t": "<div>س</div>" }',
    );
    expect(
      checkPlaceholdersAndMarkup(en, ar).map(
        (v) => `${v.file}:${v.kind}:${v.key}`,
      ),
    ).toEqual([
      'en.json:disallowed-tag:pricing.t',
      'ar.json:disallowed-tag:pricing.t',
      'ar.json:placeholder-mismatch:pricing.p',
      'ar.json:markup-mismatch:pricing.m',
    ]);
  });
});
