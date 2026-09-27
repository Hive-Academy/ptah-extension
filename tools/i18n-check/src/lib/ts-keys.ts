/**
 * TypeScript key extraction (7.2) with the `typescript` compiler API.
 *
 * Collects, per file:
 * - the first argument of `translate(`, `translateSignal(`,
 *   `translateObjectSignal(` and of the same names called as methods
 *   (`.translate(`);
 * - every string literal, for the own-scope literal scan;
 * - inline `@Component({ template })` sources, handed to the template scan;
 * - `*I18N_KEYS` / `*I18nKeys` key constants and aliases of them;
 * - `i18n-keys:` / `i18n-ignore:` markers in comments (see `markers.ts`).
 */
import * as ts from 'typescript';
import { tsMarkers, type Marker } from './markers';
import type { Violation } from './report';
import { decodeLiteral } from './literal-offsets';
import type { KeyUse, ScannedString, TemplateSource } from './template-keys';

const TRANSLATE_CALLS = new Set([
  'translate',
  'translateSignal',
  'translateObjectSignal',
]);
const KEY_CONST_NAME = /(I18N_KEYS|I18nKeys)$/;

export interface KeyConst {
  name: string;
  file: string;
  line: number;
  keys: ScannedString[];
  /** Why the constant is not a valid key map, or null when it is. */
  problem: string | null;
}

/** `readonly statusI18nKeys = STATUS_I18N_KEYS;` */
export interface KeyAlias {
  name: string;
  target: string;
}

/**
 * An inline `template:` with exact positions: every decoded character maps to
 * the file offset of the source character or escape sequence it came from.
 */
export type InlineTemplate = Omit<TemplateSource, 'file'>;

export interface TsScan {
  uses: KeyUse[];
  strings: ScannedString[];
  templates: InlineTemplate[];
  keyConsts: KeyConst[];
  aliases: KeyAlias[];
  markers: Marker[];
  violations: Violation[];
}

export interface ParsedTsFile {
  source: ts.SourceFile;
  /** Syntactic diagnostics; a non-empty list is a parse failure. */
  diagnostics: readonly ts.Diagnostic[];
}

/**
 * Parses every file in one program with resolution and the default library
 * switched off: only syntax is needed, and `getSyntacticDiagnostics` is the
 * public way to learn whether a file parsed.
 */
export function parseTypeScriptFiles(
  absPaths: readonly string[],
): Map<string, ParsedTsFile> {
  const options: ts.CompilerOptions = {
    noResolve: true,
    noLib: true,
    types: [],
    target: ts.ScriptTarget.ESNext,
    experimentalDecorators: true,
  };
  const program = ts.createProgram({
    rootNames: [...absPaths],
    options,
    // Parent pointers are needed to recognise `@Component({ template })`.
    host: ts.createCompilerHost(options, true),
  });
  const parsed = new Map<string, ParsedTsFile>();
  for (const absPath of absPaths) {
    const source = program.getSourceFile(absPath);
    if (!source) continue;
    parsed.set(absPath, {
      source,
      diagnostics: program.getSyntacticDiagnostics(source),
    });
  }
  return parsed;
}

export function extractTsKeys(source: ts.SourceFile, file: string): TsScan {
  const scan: TsScan = {
    uses: [],
    strings: [],
    templates: [],
    keyConsts: [],
    aliases: [],
    markers: tsMarkers(source, file),
    violations: [],
  };
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      scan.strings.push({
        file,
        line: lineOf(node),
        offset: node.getStart(source),
        value: node.text,
      });
    }

    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (
        name !== null &&
        TRANSLATE_CALLS.has(name) &&
        node.arguments.length > 0
      ) {
        scan.uses.push(
          useOf(
            node.arguments[0],
            source,
            file,
            lineOf,
            name === 'translateObjectSignal',
          ),
        );
      }
    }

    if (ts.isPropertyAssignment(node) && isComponentTemplate(node)) {
      const init = node.initializer;
      if (
        ts.isStringLiteral(init) ||
        ts.isNoSubstitutionTemplateLiteral(init)
      ) {
        const template = inlineTemplateOf(init, source);
        if (typeof template === 'string') {
          scan.violations.push({
            file,
            line: lineOf(init),
            kind: 'parse-error',
            key: '',
            detail: `the escape sequences of this inline template could not be mapped to source positions (${template}); move the markup to an .html file`,
          });
        } else {
          scan.templates.push(template);
        }
      } else {
        scan.violations.push({
          file,
          line: lineOf(init),
          kind: 'parse-error',
          key: '',
          detail:
            'an inline template must be a plain string or a template literal without substitutions',
        });
      }
    }

    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      ts.isIdentifier(node.name) &&
      KEY_CONST_NAME.test(node.name.text) &&
      node.initializer
    ) {
      collectKeyConst(node.name.text, node.initializer, source, file, scan);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return scan;
}

/**
 * Maps the literal's decoded text to file positions. Returns why it cannot
 * when the decoding fails or does not reproduce the scanner's text, since
 * positions would then be wrong.
 */
function inlineTemplateOf(
  init: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
  source: ts.SourceFile,
): InlineTemplate | string {
  const rawStart = init.getStart(source) + 1;
  let decoded: ReturnType<typeof decodeLiteral>;
  try {
    decoded = decodeLiteral(
      source.text.slice(rawStart, init.getEnd() - 1),
      rawStart,
    );
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  if (decoded.text !== init.text) {
    return "the decoded text differs from the compiler's";
  }
  const { offsets } = decoded;
  return {
    text: init.text,
    offsetAt: (index: number): number => {
      const offset = offsets[index];
      if (offset === undefined) {
        throw new Error(`template index ${index} is outside the template`);
      }
      return offset;
    },
    lineAt: (offset: number): number =>
      source.getLineAndCharacterOfPosition(offset).line + 1,
  };
}

function collectKeyConst(
  name: string,
  initializer: ts.Expression,
  source: ts.SourceFile,
  file: string,
  scan: TsScan,
): void {
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  let expr = initializer;
  while (ts.isParenthesizedExpression(expr) || ts.isSatisfiesExpression(expr)) {
    expr = expr.expression;
  }
  if (ts.isIdentifier(expr)) {
    scan.aliases.push({ name, target: expr.text });
    return;
  }

  const keyConst: KeyConst = {
    name,
    file,
    line: lineOf(initializer),
    keys: [],
    problem: null,
  };
  scan.keyConsts.push(keyConst);
  const isAsConst =
    ts.isAsExpression(expr) &&
    ts.isTypeReferenceNode(expr.type) &&
    ts.isIdentifier(expr.type.typeName) &&
    expr.type.typeName.text === 'const';
  if (!isAsConst) {
    keyConst.problem =
      'a key constant must be an object or array literal declared `as const`';
    return;
  }
  const body = (expr as ts.AsExpression).expression;
  if (
    !ts.isObjectLiteralExpression(body) &&
    !ts.isArrayLiteralExpression(body)
  ) {
    keyConst.problem =
      'a key constant must be an object or array literal declared `as const`';
    return;
  }

  const collect = (node: ts.Expression): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      keyConst.keys.push({
        file,
        line: lineOf(node),
        offset: node.getStart(source),
        value: node.text,
      });
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          collect(property.initializer);
        } else {
          keyConst.problem ??= `every value must be a string-literal key (line ${lineOf(property)})`;
        }
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      node.elements.forEach(collect);
    } else {
      keyConst.problem ??= `every value must be a string-literal key (line ${lineOf(node)})`;
    }
  };
  collect(body);
}

function useOf(
  arg: ts.Expression,
  source: ts.SourceFile,
  file: string,
  lineOf: (node: ts.Node) => number,
  objectTarget: boolean,
): KeyUse {
  const target = objectTarget ? 'object' : 'leaf';
  const inner = unwrap(arg);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
    return {
      file,
      line: lineOf(arg),
      offset: arg.getStart(source),
      form: 'literal',
      key: inner.text,
      receiver: null,
      target,
    };
  }
  return {
    file,
    line: lineOf(arg),
    offset: arg.getStart(source),
    form: 'computed',
    key: arg.getText(source),
    receiver: receiverName(inner),
    target,
  };
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** `X[k]`, `X.k`, `this.X[k]`, `X()[k]` → `X`. */
function receiverName(expr: ts.Expression): string | null {
  if (
    ts.isElementAccessExpression(expr) ||
    ts.isPropertyAccessExpression(expr)
  ) {
    return nameOf(unwrap(expr.expression));
  }
  return null;
}

function nameOf(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isCallExpression(expr)) return nameOf(unwrap(expr.expression));
  return null;
}

function calleeName(callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** `template:` inside the object passed to `@Component(...)`. */
function isComponentTemplate(node: ts.PropertyAssignment): boolean {
  if (!ts.isIdentifier(node.name) && !ts.isStringLiteral(node.name))
    return false;
  if (node.name.text !== 'template') return false;
  const objectLiteral = node.parent;
  const call = objectLiteral.parent;
  return (
    ts.isCallExpression(call) &&
    calleeName(call.expression) === 'Component' &&
    ts.isDecorator(call.parent)
  );
}
