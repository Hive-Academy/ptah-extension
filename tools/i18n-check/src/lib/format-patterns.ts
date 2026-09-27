/**
 * Locale formatting rule (5.1), on syntax trees rather than a regex over
 * source text, so a TypeScript union such as `number | Date` never reads as
 * a pipe (rev-0 review N3).
 *
 * Fails:
 * - templates: a `BindingPipe` named `date`, `number`, `currency`, `percent`
 *   or `decimal`, and a `toLocale*String()` call in an expression;
 * - TypeScript: a call to a property named `toLocaleString`,
 *   `toLocaleDateString` or `toLocaleTimeString`, and `new Intl.X(…)` /
 *   `Intl.X(…)` (X a constructor, capitalised) whose first argument is not
 *   an `intlLocale()` call.
 *
 * An `i18n-format-exempt: <reason>` marker covering the site passes it
 * (`main.ts` applies markers).
 */
import {
  BindingPipe,
  Call,
  PropertyRead,
  SafeCall,
  SafePropertyRead,
} from '@angular/compiler';
import * as ts from 'typescript';
import type { SiteViolation } from './report';
import type { TemplateSource, TemplateTree } from './template-keys';

export const LOCALE_PIPES: ReadonlySet<string> = new Set([
  'date',
  'number',
  'currency',
  'percent',
  'decimal',
]);

export const TO_LOCALE_METHODS: ReadonlySet<string> = new Set([
  'toLocaleString',
  'toLocaleDateString',
  'toLocaleTimeString',
]);

const EXEMPT_HINT = 'or add `i18n-format-exempt: <reason>`';
const PIPE_DETAIL = `formats with the render locale, not the active language; use the i18nDate / i18nNumber pipes from @ptah-extension/i18n, ${EXEMPT_HINT}`;
const CALL_DETAIL = `formats with the browser locale, not the active language; use the i18nDate / i18nNumber pipes or an Intl formatter built with intlLocale(), ${EXEMPT_HINT}`;
const INTL_DETAIL = `an Intl formatter must take intlLocale() as its first argument, ${EXEMPT_HINT}`;

export function formatTemplateFindings(
  source: TemplateSource,
  tree: TemplateTree,
): SiteViolation[] {
  const violations: SiteViolation[] = [];
  const add = (index: number, key: string, detail: string): void => {
    const offset = source.offsetAt(index);
    violations.push({
      file: source.file,
      line: source.lineAt(offset),
      offset,
      kind: key.startsWith('toLocale')
        ? 'locale-format-call'
        : 'locale-format-pipe',
      key,
      detail,
      exemptBy: 'format-exempt',
    });
  };

  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof BindingPipe && LOCALE_PIPES.has(value.name)) {
      add(value.nameSpan.start, value.name, PIPE_DETAIL);
    } else if (value instanceof Call || value instanceof SafeCall) {
      const callee = value.receiver;
      if (
        (callee instanceof PropertyRead ||
          callee instanceof SafePropertyRead) &&
        TO_LOCALE_METHODS.has(callee.name)
      ) {
        add(callee.nameSpan.start, callee.name, CALL_DETAIL);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      // Spans carry the whole source file; i18n metadata duplicates nodes.
      if (/span$/i.test(key) || key === 'i18n') continue;
      visit(child);
    }
  };
  visit(tree.nodes);
  return violations;
}

export function formatTsFindings(
  source: ts.SourceFile,
  file: string,
): SiteViolation[] {
  const violations: SiteViolation[] = [];
  const add = (
    node: ts.Node,
    kind: 'locale-format-call' | 'intl-without-locale',
    key: string,
    detail: string,
  ): void => {
    const offset = node.getStart(source);
    violations.push({
      file,
      line: source.getLineAndCharacterOfPosition(offset).line + 1,
      offset,
      kind,
      key,
      detail,
      exemptBy: 'format-exempt',
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method = memberName(node.expression);
      if (method && TO_LOCALE_METHODS.has(method.name)) {
        add(method.node, 'locale-format-call', method.name, CALL_DETAIL);
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const intl = intlConstructor(node.expression);
      if (intl && !isIntlLocaleCall(node.arguments?.[0])) {
        add(node, 'intl-without-locale', `Intl.${intl}`, INTL_DETAIL);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** `x.name` / `x?.name` / `x['name']` → the member name and its node. */
function memberName(
  callee: ts.Expression,
): { name: string; node: ts.Node } | null {
  const expr = unwrap(callee);
  if (ts.isPropertyAccessExpression(expr)) {
    return { name: expr.name.text, node: expr.name };
  }
  if (
    ts.isElementAccessExpression(expr) &&
    ts.isStringLiteralLike(expr.argumentExpression)
  ) {
    return {
      name: expr.argumentExpression.text,
      node: expr.argumentExpression,
    };
  }
  return null;
}

/** `Intl.DateTimeFormat` → `DateTimeFormat`; static functions are not formatters. */
function intlConstructor(callee: ts.Expression): string | null {
  const expr = unwrap(callee);
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'Intl' &&
    /^[A-Z]/.test(expr.name.text)
  ) {
    return expr.name.text;
  }
  return null;
}

/** `intlLocale()`, `this.i18n.intlLocale()`, `i18n?.intlLocale()`. */
function isIntlLocaleCall(arg: ts.Expression | undefined): boolean {
  if (!arg) return false;
  const expr = unwrap(arg);
  if (!ts.isCallExpression(expr)) return false;
  const callee = unwrap(expr.expression);
  if (ts.isIdentifier(callee)) return callee.text === 'intlLocale';
  return memberName(callee)?.name === 'intlLocale';
}
