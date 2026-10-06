import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateGraphQuestions } from './graph-questions';
import {
  generateSymbolQuestions,
  isUsefulConcept,
  removeIdentifierTokens,
} from './symbol-questions';
import { loadCorpusTsProgram, mulberry32 } from './ts-program';

describe('compiler ground truth generators', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mcp-bench-ground-truth-'));
    mkdirSync(join(root, 'libs', 'fixture', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'tsconfig.base.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          baseUrl: '.',
          paths: { '@fixture/*': ['libs/fixture/src/*'] },
        },
      }),
    );
    writeFileSync(
      join(root, 'libs', 'fixture', 'src', 'index.ts'),
      `/** Keeps IndexName available. */\nexport const IndexName = 1;\nexport { exported } from './source';\n`,
    );
    writeFileSync(
      join(root, 'libs', 'fixture', 'src', 'fixture.module.ts'),
      `export const moduleValue = 1;\n`,
    );
    writeFileSync(
      join(root, 'libs', 'fixture', 'src', 'ignored.spec.ts'),
      `export const ShouldNotAppear = 1;\n`,
    );
    writeFileSync(
      join(root, 'libs', 'fixture', 'src', 'source.ts'),
      `import { other as ImportedName } from './other';\n/** Returns the useful exported value. */\nexport function exported(parameterValue: number): number { const localValue = parameterValue; return helper(localValue); }\nexport function helper(value: number): number { return value + IndexName; }\nexport class KeptClass { keptProperty = 1; get keptAccessor(): number { return this.keptProperty; } keptMethod(): number { return this.keptProperty; } }\nexport interface KeptInterface { value: number; }\nexport type KeptType = number; export enum KeptEnum { member }\nexport const keptVariable = ImportedName; const ignoredObject = { propertyAssignment: 1 };\nexport async function dynamic(): Promise<number> { return (await import('./other')).other; }\n`,
    );
    writeFileSync(
      join(root, 'libs', 'fixture', 'src', 'other.ts'),
      `export const other = 2;\n`,
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('is deterministic and retains index/module files while excluding tests', () => {
    expect([mulberry32(7)(), mulberry32(7)()]).toEqual([
      mulberry32(7)(),
      mulberry32(7)(),
    ]);
    const program = loadCorpusTsProgram(root);
    const generated = generateSymbolQuestions(
      program,
      '2026-10-07T00:00:00.000Z',
    );
    expect(JSON.stringify(generated)).not.toContain('ShouldNotAppear');
    expect(JSON.stringify(generated)).toContain('IndexName');
    expect(JSON.stringify(generated)).toContain('moduleValue');
    expect(generated.exact.questions.length).toBeGreaterThanOrEqual(50);
  });

  it('removes identifier tokens from JSDoc concepts', () => {
    expect(
      removeIdentifierTokens(
        'Returns the useful exported value.',
        'exportedValue',
      ),
    ).toBe('Returns the useful');
  });

  it('keeps only indexable declaration kinds', () => {
    const generated = generateSymbolQuestions(
      loadCorpusTsProgram(root),
      '2026-10-07T00:00:00.000Z',
    );
    const text = JSON.stringify(generated.exact.questions);
    for (const name of [
      'KeptClass',
      'keptProperty',
      'keptAccessor',
      'keptMethod',
      'KeptInterface',
      'KeptType',
      'KeptEnum',
      'keptVariable',
    ])
      expect(text).toContain(name);
    for (const name of [
      'ImportedName',
      'parameterValue',
      'localValue',
      'propertyAssignment',
    ])
      expect(text).not.toContain(name);
  });

  it('rejects thin and identifier-dominated concepts including identifier markdown', () => {
    expect(
      removeIdentifierTokens(
        'Builds `exportedValue` from useful reliable source data.',
        'exportedValue',
      ),
    ).toBe('Builds from useful reliable source data.');
    expect(isUsefulConcept('required to build the', 5)).toBe(false);
    expect(
      isUsefulConcept(
        'Useful stable words remain after removing the identifier',
        20,
      ),
    ).toBe(false);
  });

  it('skips call sites whose only definition is an unresolved external import', () => {
    writeFileSync(
      join(root, 'libs', 'fixture', 'src', 'external.ts'),
      `import { externalCall } from 'absent-external-package';\nimport { helper } from './source';\nexport function caller(): number { externalCall(); return helper(1); }\n`,
    );
    const generated = generateGraphQuestions(
      loadCorpusTsProgram(root),
      '2026-10-07T00:00:00.000Z',
    );
    const queries = JSON.stringify(generated.definitions.questions);
    expect(queries).toContain('"query":"helper"');
    expect(queries).not.toContain('"query":"externalCall"');
  });

  it('produces definition and dependency truth for static, export-from, and dynamic imports', () => {
    const generated = generateGraphQuestions(
      loadCorpusTsProgram(root),
      '2026-10-07T00:00:00.000Z',
    );
    expect(generated.definitions.questions).toEqual(expect.any(Array));
    expect(JSON.stringify(generated.dependents.questions)).toContain(
      'libs/fixture/src/source.ts',
    );
    expect(JSON.stringify(generated.dependents.questions)).toContain(
      'libs/fixture/src/other.ts',
    );
    expect(JSON.stringify(generated.references.questions)).not.toContain(
      'ignored.spec.ts',
    );
  });
});
