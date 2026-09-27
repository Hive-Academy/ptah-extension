/**
 * Where the RTL rule (`rtl-patterns.ts`) looks in templates and TypeScript.
 *
 * Templates: static `class` / `*Class` attributes, `[class.x]` bindings,
 * string literals in bound attributes (`[ngClass]` map keys too), static
 * `style` attributes, `[style.x]` bindings and `[style]` / `[ngStyle]` map
 * keys. The class tokens of one element are judged together, with the
 * element's LTR-island state: `dir="ltr"` or the class `ltr-island` on the
 * element or an ancestor, up to a nested `dir` of another value (a bound
 * `dir` is not known to be LTR).
 *
 * TypeScript: string literals (class lists, host `[class.x]` / `[style.x]`
 * keys), judged per line; inline `styles`, scanned as CSS at exact file
 * positions; object-literal positions such as `{ left: 50 }`. Inline
 * templates are left to the template scan.
 */
import {
  AST,
  BindingType,
  Interpolation,
  LiteralMap,
  LiteralPrimitive,
  TmplAstBoundAttribute,
  TmplAstComponent,
  TmplAstElement,
} from '@angular/compiler';
import * as ts from 'typescript';
import type { SiteViolation } from './report';
import {
  evaluateClassTokens,
  propertyViolation,
  rtlCssFindings,
  type ClassToken,
  type RtlScan,
} from './rtl-patterns';
import type { TemplateSource, TemplateTree } from './template-keys';
import { componentMetadataName, inlineSourceOf } from './ts-keys';

const CLASS_BINDING_KEY = /^\[class\.(.+)\]$/;
const STYLE_BINDING_KEY = /^\[style\.([\w-]+)(?:\.[\w%]+)?\]$/;

type ElementNode = TmplAstElement | TmplAstComponent;

export function rtlTemplateFindings(
  source: TemplateSource,
  tree: TemplateTree,
): SiteViolation[] {
  const violations: SiteViolation[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown, island: boolean): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    // Expressions hold no elements.
    if (value instanceof AST) return;
    if (value instanceof TmplAstElement || value instanceof TmplAstComponent) {
      const own = islandOf(value, island);
      violations.push(...elementFindings(value, own, source));
      visit(value.children, own);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (/span$/i.test(key) || key === 'i18n') continue;
      visit(child, island);
    }
  };
  visit(tree.nodes, false);
  return violations;
}

/** The nearest `dir` decides; `ltr-island` makes an island when no `dir` is set. */
function islandOf(element: ElementNode, inherited: boolean): boolean {
  const dir = element.attributes.find((a) => a.name === 'dir');
  if (dir) return dir.value.trim().toLowerCase() === 'ltr';
  if (element.inputs.some((i) => i.name === 'dir' || i.name === 'attr.dir')) {
    return false; // a bound direction is not known to be LTR
  }
  const classes = element.attributes.find((a) => a.name === 'class');
  if (classes && classes.value.split(/\s+/).includes('ltr-island')) return true;
  return inherited;
}

function elementFindings(
  element: ElementNode,
  island: boolean,
  source: TemplateSource,
): SiteViolation[] {
  const { file } = source;
  const at = (index: number) => {
    const offset = source.offsetAt(index);
    return { file, offset, line: source.lineAt(offset) };
  };
  const tokens: ClassToken[] = [];
  const addTokens = (text: string, index: number, exact: boolean): void => {
    for (const t of text.matchAll(/\S+/g)) {
      tokens.push({ token: t[0], ...at(exact ? index + t.index : index) });
    }
  };
  const violations: SiteViolation[] = [];
  const push = (v: SiteViolation | null): void => {
    if (v && !island) violations.push(v);
  };

  for (const attr of element.attributes) {
    const start = (attr.valueSpan ?? attr.sourceSpan).start.offset;
    if (attr.name === 'class' || /class$/i.test(attr.name)) {
      addTokens(attr.value, start, true);
    } else if (attr.name === 'style' && !island) {
      violations.push(
        ...rtlCssFindings(subSource(source, attr.value, start)).violations,
      );
    }
  }

  for (const input of element.inputs) {
    const keyStart = (input.keySpan ?? input.sourceSpan).start.offset;
    if (input.type === BindingType.Class) {
      tokens.push({ token: input.name, ...at(keyStart) });
      continue;
    }
    const { literals, maps } = expressionParts(input);
    if (input.type === BindingType.Style) {
      push(
        propertyViolation(
          input.name,
          literals.map((l) => l.text),
          at(keyStart),
          `style.${input.name}`,
        ),
      );
      continue;
    }
    for (const literal of literals) {
      addTokens(literal.text, literal.index, literal.exact);
    }
    for (const map of maps) {
      map.keys.forEach((key, i) => {
        if (key.kind !== 'property') return;
        if (STYLE_INPUTS.has(input.name)) {
          const value = map.values[i];
          const values =
            value instanceof LiteralPrimitive && typeof value.value === 'string'
              ? [value.value]
              : null;
          push(
            propertyViolation(
              key.key.replace(/\.[\w%]+$/, ''),
              values,
              at(key.sourceSpan.start),
              `style.${key.key}`,
            ),
          );
        } else if (CLASS_INPUTS.has(input.name)) {
          const quote = key.quoted ? 1 : 0;
          addTokens(key.key, key.sourceSpan.start + quote, true);
        }
      });
    }
  }

  violations.push(...evaluateClassTokens(tokens, island, file));
  return violations;
}

/** A slice of a template (an attribute value) seen as its own source. */
function subSource(
  source: TemplateSource,
  text: string,
  start: number,
): TemplateSource {
  return {
    text,
    file: source.file,
    offsetAt: (index) => source.offsetAt(start + index),
    lineAt: source.lineAt,
  };
}

const STYLE_INPUTS = new Set(['style', 'ngStyle']);
const CLASS_INPUTS = new Set(['class', 'ngClass', 'className', 'attr.class']);

/**
 * String literals and object literals of a binding; interpolation text sits
 * at the value start.
 */
function expressionParts(input: TmplAstBoundAttribute): {
  literals: { text: string; index: number; exact: boolean }[];
  maps: LiteralMap[];
} {
  const found: { text: string; index: number; exact: boolean }[] = [];
  const maps: LiteralMap[] = [];
  const valueStart = (input.valueSpan ?? input.sourceSpan).start.offset;
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof LiteralPrimitive && typeof value.value === 'string') {
      // `+ 1` skips the opening quote.
      found.push({
        text: value.value,
        index: value.sourceSpan.start + 1,
        exact: true,
      });
    } else if (value instanceof Interpolation) {
      for (const text of value.strings) {
        found.push({ text, index: valueStart, exact: false });
      }
    } else if (value instanceof LiteralMap) {
      maps.push(value);
    }
    for (const [key, child] of Object.entries(value)) {
      if (/span$/i.test(key)) continue;
      visit(child);
    }
  };
  visit(input.value);
  return { literals: found, maps };
}

/**
 * TypeScript sources. Inline templates are left to the template scan (the
 * caller hands them to `rtlTemplateFindings`); inline `styles` are scanned as
 * CSS at their exact file positions.
 */
export function rtlTsFindings(source: ts.SourceFile, file: string): RtlScan {
  const scan: RtlScan = { violations: [], markers: [] };
  const lineOf = (offset: number): number =>
    source.getLineAndCharacterOfPosition(offset).line + 1;
  /** Class tokens grouped by line: pairs are judged per line. */
  const byLine = new Map<number, ClassToken[]>();

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const metadata = componentMetadataName(node);
      if (metadata === 'template') return;
      if (metadata === 'styles') {
        scanInlineStyles(node.initializer, source, file, scan);
        return;
      }
      const position = objectPositionViolation(node, source, file);
      if (position) scan.violations.push(position);
    }

    if (isTextLiteral(node) && !isNonClassLiteral(node)) {
      const start = node.getStart(source);
      // `+ 1` skips the opening quote or backtick (`}` for a template middle).
      const contentStart = start + 1;
      for (const t of node.text.matchAll(/\S+/g)) {
        const offset = contentStart + t.index;
        const line = lineOf(offset);
        const token = t[0];
        const style = STYLE_BINDING_KEY.exec(token);
        if (style) {
          const v = propertyViolation(
            style[1],
            null,
            { file, line, offset },
            `style.${style[1]}`,
          );
          if (v) scan.violations.push(v);
          continue;
        }
        const classKey = CLASS_BINDING_KEY.exec(token);
        const group = byLine.get(line) ?? [];
        group.push({ token: classKey ? classKey[1] : token, offset, line });
        byLine.set(line, group);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const group of byLine.values()) {
    scan.violations.push(...evaluateClassTokens(group, false, file));
  }
  return scan;
}

type TextLiteral =
  | ts.StringLiteral
  | ts.NoSubstitutionTemplateLiteral
  | ts.TemplateHead
  | ts.TemplateMiddle
  | ts.TemplateTail;

function isTextLiteral(node: ts.Node): node is TextLiteral {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

/** Module specifiers and literal types are never class lists. */
function isNonClassLiteral(node: TextLiteral): boolean {
  const parent = node.parent;
  return (
    ts.isLiteralTypeNode(parent) ||
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent)
  );
}

function scanInlineStyles(
  init: ts.Expression,
  source: ts.SourceFile,
  file: string,
  scan: RtlScan,
): void {
  const entries = ts.isArrayLiteralExpression(init) ? init.elements : [init];
  for (const entry of entries) {
    if (
      !ts.isStringLiteral(entry) &&
      !ts.isNoSubstitutionTemplateLiteral(entry)
    ) {
      continue;
    }
    const inline = inlineSourceOf(entry, source);
    const offset = entry.getStart(source);
    if (typeof inline === 'string') {
      scan.violations.push({
        file,
        line: source.getLineAndCharacterOfPosition(offset).line + 1,
        offset,
        kind: 'parse-error',
        key: '',
        detail: `the escape sequences of this inline style could not be mapped to source positions (${inline}); move the CSS to a .css file`,
        exemptBy: null,
      });
      continue;
    }
    const css = rtlCssFindings({ ...inline, file });
    scan.violations.push(...css.violations);
    scan.markers.push(...css.markers);
  }
}

/** `{ left: 50 }`, `{ marginLeft: '4px' }`, `{ textAlign: 'right' }`. */
function objectPositionViolation(
  node: ts.PropertyAssignment,
  source: ts.SourceFile,
  file: string,
): SiteViolation | null {
  if (!ts.isObjectLiteralExpression(node.parent)) return null;
  const name =
    ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
      ? node.name.text
      : null;
  if (name === null) return null;
  let value: ts.Expression = node.initializer;
  while (ts.isParenthesizedExpression(value)) value = value.expression;
  const isNumber =
    ts.isNumericLiteral(value) ||
    (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand));
  const isText =
    ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value);
  if (!isNumber && !isText && !ts.isTemplateExpression(value)) return null;
  const offset = node.getStart(source);
  return propertyViolation(
    name,
    isText ? [(value as ts.StringLiteral).text] : null,
    {
      file,
      offset,
      line: source.getLineAndCharacterOfPosition(offset).line + 1,
    },
    name,
  );
}
