import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { compareCodeUnits } from '../utils/compare-code-units';
import {
  CorpusTsProgram,
  isCorpusFile,
  isTestFile,
  mulberry32,
  workspacePath,
} from './ts-program';
import { declarationsOf, type Declaration } from './symbol-questions';

export const GRAPH_SEED = 6190502;
const envelopeSchema = z.object({
  id: z.string(),
  version: z.literal('1'),
  method: z.literal('generated'),
  frozenAt: z.string().datetime(),
  corpusCommit: z.literal('7910f34cf'),
  generator: z.literal('graph-questions.ts'),
  seed: z.number(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  questions: z.array(z.unknown()),
});
export type GraphEnvelope = z.infer<typeof envelopeSchema>;
interface ReferenceQuestion {
  readonly id: string;
  readonly query: string;
  readonly file: string;
  readonly line: number;
  readonly truth: readonly string[];
  readonly declarationIncluded: boolean;
  readonly stratum: string;
  readonly sameName: boolean;
}
interface DefinitionQuestion {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly query: string;
  readonly truth: string;
}
interface DependencyQuestion {
  readonly id: string;
  readonly file: string;
  readonly pathForms: readonly ['relative', 'absolute'];
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
  readonly imports: readonly string[];
}

export function generateGraphQuestions(
  corpus: CorpusTsProgram,
  frozenAt = new Date().toISOString(),
): {
  references: GraphEnvelope;
  definitions: GraphEnvelope;
  dependents: GraphEnvelope;
} {
  const random = mulberry32(GRAPH_SEED);
  const references = referenceQuestions(corpus, random);
  const definitions = definitionQuestions(corpus, random);
  const dependents = dependencyQuestions(corpus, random);
  return {
    references: envelopeSchema.parse(
      envelope('references', frozenAt, referenceCounts(references), references),
    ),
    definitions: envelopeSchema.parse(
      envelope(
        'definitions',
        frozenAt,
        { callSites: definitions.length },
        definitions,
      ),
    ),
    dependents: envelopeSchema.parse(
      envelope('dependents', frozenAt, dependentCounts(dependents), dependents),
    ),
  };
}

export function writeGraphQuestions(
  outputDirectory: string,
  generated: ReturnType<typeof generateGraphQuestions>,
): void {
  mkdirSync(outputDirectory, { recursive: true });
  for (const [name, value] of Object.entries(generated))
    writeFileSync(
      join(outputDirectory, `${name}.json`),
      `${JSON.stringify(value, null, 2)}\n`,
    );
}

function envelope(
  id: string,
  frozenAt: string,
  countsValue: Record<string, number>,
  questions: readonly unknown[],
): GraphEnvelope {
  return {
    id,
    version: '1',
    method: 'generated',
    frozenAt,
    corpusCommit: '7910f34cf',
    generator: 'graph-questions.ts',
    seed: GRAPH_SEED,
    counts: countsValue,
    questions: [...questions],
  };
}
function referenceQuestions(
  corpus: CorpusTsProgram,
  random: () => number,
): ReferenceQuestion[] {
  const candidates: ReferenceQuestion[] = [];
  const declarations = declarationsOf(corpus);
  const byFile = new Map<string, Declaration[]>();
  const nameSymbols = new Map<string, Set<ts.Symbol | Declaration>>();
  for (const declaration of declarations) {
    byFile.set(declaration.source.fileName, [
      ...(byFile.get(declaration.source.fileName) ?? []),
      declaration,
    ]);
    nameSymbols.set(
      declaration.name,
      new Set([
        ...(nameSymbols.get(declaration.name) ?? []),
        declaration.symbol ?? declaration,
      ]),
    );
  }
  const wanted = new Map([
    ['under-5', 50],
    ['5-50', 50],
    ['over-50-same-name', 25],
    ['over-50-other', 25],
  ]);
  for (const source of shuffled(workspaceSources(corpus), random)) {
    if (fulfilled(candidates, wanted)) break;
    for (const declaration of pick(
      byFile.get(source.fileName) ?? [],
      3,
      random,
    )) {
      const identifier = (declaration.node as ts.NamedDeclaration).name;
      if (identifier === undefined || !ts.isIdentifier(identifier)) continue;
      const refs = corpus.languageService.findReferences(
        source.fileName,
        identifier.getStart(source),
      );
      if (refs === undefined) continue;
      const locations = refs
        .flatMap((entry) => entry.references)
        .filter((entry) => isCorpusFile(corpus.root, entry.fileName))
        .map((entry) =>
          locationFor(corpus, entry.fileName, entry.textSpan.start),
        );
      const unique = [...new Set(locations)];
      if (unique.length === 0) continue;
      const point = source.getLineAndCharacterOfPosition(
        identifier.getStart(source),
      );
      candidates.push({
        id: '',
        query: identifier.text,
        file: workspacePath(corpus.root, source.fileName),
        line: point.line + 1,
        truth: unique,
        declarationIncluded: refs.some(
          (entry) =>
            entry.definition !== undefined &&
            entry.references.some((reference) => reference.isDefinition),
        ),
        stratum:
          unique.length < 5
            ? 'under-5'
            : unique.length <= 50
              ? '5-50'
              : 'over-50',
        sameName: (nameSymbols.get(identifier.text)?.size ?? 0) > 1,
      });
    }
  }
  const deduped = uniqueBy(
    candidates,
    (question) => `${question.file}:${question.line}`,
  );
  const under = pick(
    deduped.filter((question) => question.stratum === 'under-5'),
    50,
    random,
  );
  const middle = pick(
    deduped.filter((question) => question.stratum === '5-50'),
    50,
    random,
  );
  const highSameName = pick(
    deduped.filter(
      (question) => question.stratum === 'over-50' && question.sameName,
    ),
    25,
    random,
  );
  const highOther = pick(
    deduped.filter(
      (question) => question.stratum === 'over-50' && !question.sameName,
    ),
    25,
    random,
  );
  return [...under, ...middle, ...highSameName, ...highOther].map(
    (question, index) => ({ ...question, id: `reference-${index + 1}` }),
  );
}
function definitionQuestions(
  corpus: CorpusTsProgram,
  random: () => number,
): DefinitionQuestion[] {
  const candidates: DefinitionQuestion[] = [];
  for (const source of shuffled(workspaceSources(corpus), random)) {
    const sourceCandidates: DefinitionQuestion[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const target = ts.isIdentifier(node.expression)
          ? node.expression
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name
            : undefined;
        if (target !== undefined) {
          const defs = corpus.languageService.getDefinitionAtPosition(
            source.fileName,
            target.getStart(source),
          );
          // An `alias` definition is the import binding of a module the
          // corpus cannot resolve (external package): no real declaration.
          const definition = defs?.find(
            (entry) =>
              entry.kind !== ts.ScriptElementKind.alias &&
              isCorpusFile(corpus.root, entry.fileName),
          );
          if (definition !== undefined) {
            const point = source.getLineAndCharacterOfPosition(
              target.getStart(source),
            );
            sourceCandidates.push({
              id: '',
              file: workspacePath(corpus.root, source.fileName),
              line: point.line + 1,
              column: point.character + 1,
              query: target.text,
              truth: locationFor(
                corpus,
                definition.fileName,
                definition.textSpan.start,
              ),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    candidates.push(...pick(sourceCandidates, 3, random));
  }
  return pick(
    uniqueBy(
      candidates,
      (question) => `${question.file}:${question.line}:${question.column}`,
    ),
    150,
    random,
  ).map((question, index) => ({ ...question, id: `definition-${index + 1}` }));
}
function dependencyQuestions(
  corpus: CorpusTsProgram,
  random: () => number,
): DependencyQuestion[] {
  const options = corpus.program.getCompilerOptions();
  const edges = new Map<string, Set<string>>();
  const imports = new Map<string, Set<string>>();
  for (const source of workspaceSources(corpus)) {
    const from = workspacePath(corpus.root, source.fileName);
    const visit = (node: ts.Node): void => {
      const specifier =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) &&
              node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : undefined;
      if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
        const resolved = ts.resolveModuleName(
          specifier.text,
          source.fileName,
          options,
          ts.sys,
        ).resolvedModule?.resolvedFileName;
        if (resolved !== undefined && isCorpusFile(corpus.root, resolved)) {
          const to = workspacePath(corpus.root, resolved);
          if (!edges.has(from)) edges.set(from, new Set());
          edges.get(from)?.add(to);
          if (!imports.has(to)) imports.set(to, new Set());
          imports.get(to)?.add(from);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const files = workspaceSources(corpus).map((source) =>
    workspacePath(corpus.root, source.fileName),
  );
  const strata = [
    [
      'zero-dependents',
      files.filter((file) => (imports.get(file)?.size ?? 0) === 0),
      34,
    ],
    [
      '1-10-dependents',
      files.filter((file) => {
        const size = imports.get(file)?.size ?? 0;
        return size >= 1 && size <= 10;
      }),
      33,
    ],
    [
      'over-10-dependents',
      files.filter((file) => (imports.get(file)?.size ?? 0) > 10),
      33,
    ],
  ] as const;
  const selected: string[] = [];
  for (const [, choices, target] of strata)
    selected.push(
      ...pick(
        choices.filter((file) => !selected.includes(file)),
        target,
        random,
      ),
    );
  for (const [, choices, target] of strata)
    if (selected.length < 100)
      selected.push(
        ...pick(
          choices.filter((file) => !selected.includes(file)),
          target,
          random,
        ),
      );
  return selected.slice(0, 100).map((file, index) => ({
    id: `dependency-${index + 1}`,
    file,
    pathForms: ['relative', 'absolute'],
    dependencies: [...(edges.get(file) ?? [])].sort(compareCodeUnits),
    dependents: [...(imports.get(file) ?? [])].sort(compareCodeUnits),
    imports: [...(edges.get(file) ?? [])].sort(compareCodeUnits),
  }));
}
function shuffled<T>(items: readonly T[], random: () => number): T[] {
  return pick(items, items.length, random);
}
function fulfilled(
  items: readonly ReferenceQuestion[],
  wanted: ReadonlyMap<string, number>,
): boolean {
  const current = new Map<string, number>();
  for (const item of items) {
    const key =
      item.stratum === 'over-50'
        ? item.sameName
          ? 'over-50-same-name'
          : 'over-50-other'
        : item.stratum;
    current.set(key, (current.get(key) ?? 0) + 1);
  }
  return [...wanted].every(([key, count]) => (current.get(key) ?? 0) >= count);
}
function workspaceSources(corpus: CorpusTsProgram): ts.SourceFile[] {
  return corpus.files
    .filter((file) => !isTestFile(file))
    .map((file) => corpus.program.getSourceFile(file))
    .filter((source): source is ts.SourceFile => source !== undefined);
}
function locationFor(
  corpus: CorpusTsProgram,
  fileName: string,
  position: number,
): string {
  const source = corpus.program.getSourceFile(fileName);
  if (source === undefined) return workspacePath(corpus.root, fileName);
  return `${workspacePath(corpus.root, fileName)}:${source.getLineAndCharacterOfPosition(position).line + 1}`;
}
function pick<T>(
  items: readonly T[],
  count: number,
  random: () => number,
): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}
function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
function referenceCounts(
  items: readonly ReferenceQuestion[],
): Record<string, number> {
  return items.reduce<Record<string, number>>(
    (result, item) => ({
      ...result,
      [item.stratum === 'over-50'
        ? item.sameName
          ? 'over-50-same-name'
          : 'over-50-other'
        : item.stratum]:
        (result[
          item.stratum === 'over-50'
            ? item.sameName
              ? 'over-50-same-name'
              : 'over-50-other'
            : item.stratum
        ] ?? 0) + 1,
    }),
    {},
  );
}
function dependentCounts(
  items: readonly DependencyQuestion[],
): Record<string, number> {
  return items.reduce<Record<string, number>>((result, item) => {
    const count = item.dependents.length;
    const stratum =
      count === 0
        ? 'zero-dependents'
        : count <= 10
          ? '1-10-dependents'
          : 'over-10-dependents';
    return { ...result, [stratum]: (result[stratum] ?? 0) + 1 };
  }, {});
}
