import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import {
  CorpusTsProgram,
  isCorpusFile,
  isTestFile,
  mulberry32,
  workspacePath,
} from './ts-program';

export const SYMBOL_SEED = 6190501;
const envelopeSchema = z.object({
  id: z.string(),
  version: z.literal('1'),
  method: z.literal('generated'),
  frozenAt: z.string().datetime(),
  corpusCommit: z.literal('7910f34cf'),
  generator: z.literal('symbol-questions.ts'),
  seed: z.number(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  questions: z.array(z.unknown()),
});
export type SymbolEnvelope = z.infer<typeof envelopeSchema>;
export interface SymbolQuestion {
  readonly id: string;
  readonly query: string;
  readonly truth: readonly string[];
  readonly abstain: boolean;
  readonly stratum: string;
  readonly truthCount: number;
}

export interface Declaration {
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly node: ts.Declaration;
  readonly source: ts.SourceFile;
  readonly symbol: ts.Symbol | undefined;
}

export function generateSymbolQuestions(
  corpus: CorpusTsProgram,
  frozenAt = new Date().toISOString(),
): { exact: SymbolEnvelope; concept: SymbolEnvelope } {
  const random = mulberry32(SYMBOL_SEED);
  const declarations = declarationsOf(corpus);
  const byName = new Map<string, Declaration[]>();
  for (const declaration of declarations)
    byName.set(declaration.name, [
      ...(byName.get(declaration.name) ?? []),
      declaration,
    ]);
  const candidates = [...byName.entries()].map(([name, values]) => ({
    name,
    values: collapseOverloads(values),
    source: values[0].source,
  }));
  const largestLib = largestLibrary(corpus);
  const exact: SymbolQuestion[] = [];
  addExact(
    exact,
    pick(
      candidates.filter(
        (candidate) =>
          candidate.source.getLineAndCharacterOfPosition(candidate.source.end)
            .line +
            1 <=
          1000,
      ),
      100,
      random,
    ),
    'small',
  );
  addExact(
    exact,
    pick(
      candidates.filter(
        (candidate) =>
          candidate.source.getLineAndCharacterOfPosition(candidate.source.end)
            .line +
            1 >
          1000,
      ),
      100,
      random,
    ),
    'large',
  );
  addExact(
    exact,
    pick(
      candidates.filter((candidate) =>
        workspacePath(corpus.root, candidate.source.fileName).startsWith(
          `${largestLib}/`,
        ),
      ),
      100,
      random,
    ),
    'largest-lib',
  );
  const corpusText = corpus.files
    .map((file) => corpus.program.getSourceFile(file)?.text ?? '')
    .join('\n');
  for (let index = 0; index < 50; index += 1) {
    let name = `ptahAbsentSymbol${index}_${Math.floor(random() * 1_000_000)}`;
    while (new RegExp(`\\b${name}\\b`).test(corpusText)) name = `${name}x`;
    exact.push({
      id: `symbol-negative-${index + 1}`,
      query: name,
      truth: [],
      abstain: true,
      truthCount: 0,
      stratum: 'negative',
    });
  }
  const conceptCandidates = declarations
    .filter(
      (declaration) =>
        isExported(declaration.node) &&
        firstSentence(declaration.node, declaration.source) !== null,
    )
    .map((declaration) => ({
      declaration,
      query: removeIdentifierTokens(
        firstSentence(declaration.node, declaration.source) ?? '',
        declaration.name,
      ),
    }))
    .filter((item) =>
      isUsefulConcept(item.query, declarationWordCount(item.declaration)),
    );
  const concepts: SymbolQuestion[] = pick(conceptCandidates, 200, random).map(
    (item, index) => ({
      id: `symbol-concept-${index + 1}`,
      query: item.query,
      truth: [location(item.declaration)],
      abstain: false,
      stratum: 'jsdoc',
      truthCount: 1,
    }),
  );
  const exactEnvelope: SymbolEnvelope = {
    id: 'symbols-exact',
    version: '1',
    method: 'generated',
    frozenAt,
    corpusCommit: '7910f34cf',
    generator: 'symbol-questions.ts',
    seed: SYMBOL_SEED,
    counts: count(exact),
    questions: exact,
  };
  const conceptEnvelope: SymbolEnvelope = {
    id: 'symbols-concept',
    version: '1',
    method: 'generated',
    frozenAt,
    corpusCommit: '7910f34cf',
    generator: 'symbol-questions.ts',
    seed: SYMBOL_SEED,
    counts: count(concepts),
    questions: concepts,
  };
  return {
    exact: envelopeSchema.parse(exactEnvelope),
    concept: envelopeSchema.parse(conceptEnvelope),
  };
}

export function writeSymbolQuestions(
  outputDirectory: string,
  generated: ReturnType<typeof generateSymbolQuestions>,
): void {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    join(outputDirectory, 'symbols-exact.json'),
    `${JSON.stringify(generated.exact, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDirectory, 'symbols-concept.json'),
    `${JSON.stringify(generated.concept, null, 2)}\n`,
  );
}
export function removeIdentifierTokens(
  text: string,
  identifier: string,
): string {
  const tokens = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 1);
  const withoutIdentifierCode = text.replace(
    /`([^`]*)`/g,
    (match, code: string) =>
      containsIdentifierToken(code, tokens) ? '' : match,
  );
  return withoutIdentifierCode
    .split(/\s+/)
    .filter(
      (word) =>
        !tokens.some(
          (token) =>
            word.replace(/[^A-Za-z0-9]/g, '').toLowerCase() ===
            token.toLowerCase(),
        ),
    )
    .join(' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}
export function declarationsOf(corpus: CorpusTsProgram): Declaration[] {
  const result: Declaration[] = [];
  for (const source of corpus.program.getSourceFiles()) {
    if (
      !isCorpusFile(corpus.root, source.fileName) ||
      isTestFile(source.fileName)
    )
      continue;
    const walk = (node: ts.Node): void => {
      const name = declarationName(node);
      if (name !== undefined) {
        const point = source.getLineAndCharacterOfPosition(
          name.getStart(source),
        );
        result.push({
          name: name.text,
          file: workspacePath(corpus.root, source.fileName),
          line: point.line + 1,
          node: node as ts.Declaration,
          source,
          symbol: corpus.program.getTypeChecker().getSymbolAtLocation(name),
        });
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  return result;
}
function addExact(
  target: SymbolQuestion[],
  choices: readonly { name: string; values: readonly Declaration[] }[],
  stratum: string,
): void {
  for (const choice of choices)
    target.push({
      id: `symbol-${stratum}-${target.length + 1}`,
      query: choice.name,
      truth: choice.values.map(location),
      abstain: false,
      stratum,
      truthCount: choice.values.length,
    });
}
function location(value: Declaration): string {
  return `${value.file}:${value.line}`;
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
function count(questions: readonly SymbolQuestion[]): Record<string, number> {
  return questions.reduce<Record<string, number>>(
    (counts, question) => ({
      ...counts,
      [question.stratum]: (counts[question.stratum] ?? 0) + 1,
    }),
    {},
  );
}
function largestLibrary(corpus: CorpusTsProgram): string {
  const totals = new Map<string, number>();
  for (const file of corpus.files) {
    const parts = workspacePath(corpus.root, file).split('/');
    if (parts[0] === 'libs' && parts.length > 2) {
      const library = parts.slice(0, 3).join('/');
      totals.set(library, (totals.get(library) ?? 0) + 1);
    }
  }
  return (
    [...totals.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    'libs'
  );
}
function isExported(node: ts.Node): boolean {
  if (ts.isVariableDeclaration(node)) {
    const statement = node.parent.parent;
    return ts.isVariableStatement(statement) && hasExportModifier(statement);
  }
  return hasExportModifier(node);
}
function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
      false)
  );
}
function declarationName(node: ts.Node): ts.Identifier | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
    return node.name !== undefined && ts.isIdentifier(node.name)
      ? node.name
      : undefined;
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name))
    return undefined;
  const statement = node.parent.parent;
  if (!ts.isVariableStatement(statement)) return undefined;
  const container = statement.parent;
  return ts.isSourceFile(container) || ts.isModuleBlock(container)
    ? node.name
    : undefined;
}
function collapseOverloads(values: readonly Declaration[]): Declaration[] {
  const selected = new Map<ts.Symbol | Declaration, Declaration>();
  for (const value of values) {
    const key = value.symbol ?? value;
    const previous = selected.get(key);
    if (previous === undefined || value.line < previous.line)
      selected.set(key, value);
  }
  return [...selected.values()].sort((left, right) => left.line - right.line);
}
function containsIdentifierToken(
  text: string,
  tokens: readonly string[],
): boolean {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return tokens.some((token) => words.includes(token.toLowerCase()));
}
function declarationWordCount(declaration: Declaration): number {
  return (firstSentence(declaration.node, declaration.source) ?? '')
    .split(/\s+/)
    .filter(Boolean).length;
}
export function isUsefulConcept(
  query: string,
  originalWordCount: number,
): boolean {
  const words = query.split(/\s+/).filter(Boolean);
  return (
    words.filter((word) => /[A-Za-z]{3,}/.test(word)).length >= 5 &&
    words.length >= Math.ceil(originalWordCount * 0.6)
  );
}
function firstSentence(node: ts.Node, _source: ts.SourceFile): string | null {
  const docs = ts.getJSDocCommentsAndTags(node);
  const comment = docs
    .map((doc) =>
      ts.isJSDoc(doc)
        ? typeof doc.comment === 'string'
          ? doc.comment
          : ts.getTextOfJSDocComment(doc.comment)
        : '',
    )
    .find(Boolean);
  if (comment === undefined || comment.length === 0) return null;
  return comment.split(/(?<=[.!?])\s/)[0]?.trim() ?? null;
}
