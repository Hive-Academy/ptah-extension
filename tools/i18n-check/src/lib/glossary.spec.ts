import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkGlossaryAndArabic,
  containsTerm,
  isVerbatimValue,
  loadGlossary,
  type Glossary,
} from './glossary';
import { loadTranslationFile } from './translation-files';

describe('glossary', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: string): string => {
    const abs = path.join(dir, name);
    fs.writeFileSync(abs, content);
    return abs;
  };
  const glossaryOf = (terms: string[]): Glossary =>
    loadGlossary(
      write(
        'g.json',
        JSON.stringify(terms.map((term) => ({ term, reason: 'r' }))),
      ),
      'g.json',
    );

  it('loads entries longest first', () => {
    const glossary = glossaryOf(['Ptah', 'Ptah Builders', 'Nx']);
    expect(glossary.violations).toEqual([]);
    expect(glossary.entries.map((e) => e.term)).toEqual([
      'Ptah Builders',
      'Ptah',
      'Nx',
    ]);
  });

  it('reports a malformed glossary as a violation', () => {
    expect(
      loadGlossary(write('bad.json', '{'), 'bad.json').violations[0].kind,
    ).toBe('glossary-invalid');
    expect(
      loadGlossary(write('bad2.json', '[{"term":"X"}]'), 'bad2.json')
        .violations[0].kind,
    ).toBe('glossary-invalid');
    expect(
      loadGlossary(path.join(dir, 'none.json'), 'none.json').violations[0].kind,
    ).toBe('glossary-invalid');
  });

  it('matches whole tokens only, case-sensitively', () => {
    expect(containsTerm('Built with Nx.', 'Nx')).toBe(true);
    expect(containsTerm('مبني بـNx', 'Nx')).toBe(true);
    expect(containsTerm('Onyx', 'Nx')).toBe(false);
    expect(containsTerm('NxCloud', 'Nx')).toBe(false);
    expect(containsTerm('nx', 'Nx')).toBe(false);
  });

  it('treats values of only terms, placeholders, digits and punctuation as verbatim', () => {
    const glossary = glossaryOf(['Ptah', 'VS Code']);
    expect(isVerbatimValue('Ptah', glossary)).toBe(true);
    expect(isVerbatimValue('VS Code: {{ version }} (2026)', glossary)).toBe(
      true,
    );
    expect(isVerbatimValue('<code>Ptah</code>', glossary)).toBe(true);
    expect(isVerbatimValue('Ptah for VS Code', glossary)).toBe(false);
  });

  it('reports missing terms, English copies and verbatim mismatches', () => {
    const glossary = glossaryOf(['Ptah']);
    const en = loadTranslationFile(
      write(
        'en.json',
        '{ "a": "Try Ptah", "b": "Hello", "c": "Ptah", "d": "Hi {{ name }}", "e": "Use Ptah" }',
      ),
      'en.json',
      's',
    );
    const ar = loadTranslationFile(
      write(
        'ar.json',
        '{ "a": "جرّب بتاح", "b": "Hello", "c": "بتاح", "d": "مرحبا {{ name }}", "e": "استخدم Ptah" }',
      ),
      'ar.json',
      's',
    );
    expect(
      checkGlossaryAndArabic(en, ar, glossary).map((v) => `${v.kind}:${v.key}`),
    ).toEqual([
      'glossary-term-missing:s.a',
      'not-arabic:s.b',
      'glossary-term-missing:s.c',
      'verbatim-mismatch:s.c',
    ]);
  });
});
