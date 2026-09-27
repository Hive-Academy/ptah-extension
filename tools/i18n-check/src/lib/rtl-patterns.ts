/**
 * RTL pattern rule (4.1): physical-direction styling in `.ts`, `.html` and
 * `.css` sources. The committed pattern set is `RTL_UTILITY_PATTERNS`
 * (Tailwind utilities), `RTL_CSS_PROPERTIES` (raw CSS, inline style bindings
 * and style objects) and `CSS_DECLARATION`. This file holds the patterns,
 * the judgement of one group of class tokens and the CSS scan;
 * `rtl-sources.ts` finds the class tokens and styles in templates and
 * TypeScript.
 *
 * Where a match is looked for:
 * - templates: static `class` / `*Class` attributes, `[class.x]` bindings,
 *   string literals in bound attributes (`[ngClass]` map keys too), static
 *   `style` attributes, `[style.x]` bindings and `[style]` / `[ngStyle]` map
 *   keys;
 * - TypeScript: string literals (class lists, host `[class.x]` /
 *   `[style.x]` keys), inline `styles`, and object-literal positions such as
 *   `{ left: 50 }` (type members like `left: number` are not object literals);
 * - CSS: declarations, and `@apply` utility lists.
 *
 * A match passes when:
 * - it is half of a centring pair (`(left|right)-1/2` with
 *   `-?translate-x-1/2`) on the same element, `@apply` or TS line; in CSS,
 *   `left|right: 50%` in a block with `translate(X)(-50%)`;
 * - it is a `translate-x`, `bg-gradient-to-l/r` or `origin-left/right`
 *   utility and the same element (or TS line) carries an `rtl:` / `ltr:`
 *   variant of the same family (`translate-x-4 rtl:-translate-x-4`), or a
 *   `space-x` utility paired with `rtl:space-x-reverse` (plan:518). Every
 *   other family must become its logical utility: `ml-4 rtl:mr-8` still
 *   fails, since both margins apply under RTL;
 * - it sits inside an LTR island in a template: on or under an element with
 *   `dir="ltr"` or the class `ltr-island`, up to a nested `dir` of another
 *   value. Physical utilities there keep their physical meaning on purpose;
 * - an `rtl-exempt: <reason>` marker covers it (`main.ts` applies markers).
 *
 * Inside an island any `rtl:` / `ltr:` variant FAILS, and no marker exempts
 * it: Tailwind 3.4's `rtl:` is `:where([dir="rtl"], [dir="rtl"] *)`, so it
 * still fires inside a `dir="ltr"` island under an RTL `<html>` (plan:59).
 */
import { parseMarkerComment, type Marker } from './markers';
import type { SiteViolation } from './report';
import type { TemplateSource } from './template-keys';

/** A Tailwind length value: scale step, fraction, keyword or arbitrary `[…]`. */
const VALUE = String.raw`(?:\d+(?:\.\d+)?|\d+\/\d+|px|auto|full|\[[^\]\s]+\])`;

interface UtilityPattern {
  /** Utilities of one family pair with an `rtl:`/`ltr:` variant of the same family. */
  family: string;
  re: RegExp;
  fix: string;
}

/** The Tailwind utilities listed in requirement 4.1. */
export const RTL_UTILITY_PATTERNS: readonly UtilityPattern[] = [
  {
    family: 'margin-x',
    re: new RegExp(`^-?m[lr]-${VALUE}$`),
    fix: 'ms-* / me-*',
  },
  {
    family: 'padding-x',
    re: new RegExp(`^p[lr]-${VALUE}$`),
    fix: 'ps-* / pe-*',
  },
  {
    family: 'inset-x',
    re: new RegExp(`^-?(?:left|right)-${VALUE}$`),
    fix: 'start-* / end-*',
  },
  {
    family: 'text-align',
    re: /^text-(?:left|right)$/,
    fix: 'text-start / text-end',
  },
  {
    family: 'rounded',
    re: /^rounded-(?:l|r|tl|tr|bl|br)(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]\s]+\]))?$/,
    fix: 'rounded-s* / rounded-e* / rounded-ss* / rounded-se* / rounded-es* / rounded-ee*',
  },
  {
    family: 'border-x',
    re: /^border-[lr](?:-[^\s:]+)?$/,
    fix: 'border-s* / border-e*',
  },
  {
    family: 'space-x',
    re: new RegExp(`^-?space-x-(?:${VALUE}|reverse)$`),
    fix: 'a paired rtl:space-x-reverse, or gap-*',
  },
  {
    family: 'translate-x',
    re: new RegExp(`^-?translate-x-${VALUE}$`),
    fix: 'a paired rtl: variant',
  },
  {
    family: 'gradient',
    re: /^bg-gradient-to-[lr]$/,
    fix: 'a paired rtl: variant',
  },
  {
    family: 'origin',
    re: /^origin-(?:left|right)$/,
    fix: 'a paired rtl: variant',
  },
  {
    family: 'float',
    re: /^float-(?:left|right)$/,
    fix: 'float-start / float-end',
  },
];

/** Physical CSS properties and their logical replacement. */
export const RTL_CSS_PROPERTIES: Readonly<Record<string, string>> = {
  left: 'inset-inline-start',
  right: 'inset-inline-end',
  'margin-left': 'margin-inline-start',
  'margin-right': 'margin-inline-end',
  'padding-left': 'padding-inline-start',
  'padding-right': 'padding-inline-end',
  'text-align': 'text-align: start / end',
};

/**
 * A physical declaration in comment-free CSS. The lookbehind keeps
 * `border-left:` and `scroll-margin-left:` out; the lookahead keeps selectors
 * such as `.left:hover {` out. `margin`, `padding` and `inset` count only in
 * their four-value form with different right (2nd) and left (4th) values.
 */
const CSS_DECLARATION =
  /(?<![\w-])(left|right|margin-left|margin-right|padding-left|padding-right|text-align|margin|padding|inset)\s*:([^;{}]*)(?=[;}]|$)/g;
const CSS_SHORTHANDS: Readonly<Record<string, string>> = {
  margin: 'margin-block plus margin-inline-start / margin-inline-end',
  padding: 'padding-block plus padding-inline-start / padding-inline-end',
  inset: 'inset-block plus inset-inline-start / inset-inline-end',
};
const CSS_APPLY = /@apply\s+([^;{}]+)/g;
const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;
const INSET_HALF = /^-?(?:left|right)-1\/2$/;
const TRANSLATE_HALF = /^-?translate-x-1\/2$/;

const EXEMPT_HINT = 'or add `rtl-exempt: <reason>`';
const ISLAND_DETAIL =
  'an rtl:/ltr: variant inside a dir="ltr" / ltr-island island still fires under an RTL page (Tailwind rtl: is :where([dir="rtl"], [dir="rtl"] *)); use the physical utility inside the island';

export interface RtlScan {
  violations: SiteViolation[];
  /** `rtl-exempt:` markers from CSS comments (inline `styles` and `.css` files). */
  markers: Marker[];
}

/** One class token with its file position. */
export interface ClassToken {
  token: string;
  offset: number;
  line: number;
}

/** Splits `md:rtl:!ml-4` into variants and utility, ignoring `:` inside `[…]`/`(…)`. */
export function parseClassToken(token: string): {
  variants: string[];
  utility: string;
} {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === '[' || c === '(') depth++;
    else if ((c === ']' || c === ')') && depth > 0) depth--;
    else if (c === ':' && depth === 0) {
      parts.push(token.slice(start, i));
      start = i + 1;
    }
  }
  const utility = token.slice(start).replace(/^!/, '').replace(/!$/, '');
  return { variants: parts, utility };
}

function patternOf(utility: string): UtilityPattern | null {
  return RTL_UTILITY_PATTERNS.find((p) => p.re.test(utility)) ?? null;
}

/**
 * Families whose physical utility passes when an `rtl:`/`ltr:` variant of the
 * same family sits beside it: Tailwind 3.4 has no logical form for them.
 */
const PAIRABLE_FAMILIES: ReadonlySet<string> = new Set([
  'translate-x',
  'gradient',
  'origin',
]);

const hasDirectionVariant = (variants: readonly string[]): boolean =>
  variants.some((v) => v === 'rtl' || v === 'ltr');

/**
 * Judges the class tokens of one element (or `@apply`, or TS line) together:
 * centring pairs and `rtl:`-paired families pass; inside an island physical
 * utilities pass and direction variants fail.
 */
export function evaluateClassTokens(
  tokens: readonly ClassToken[],
  island: boolean,
  file: string,
): SiteViolation[] {
  const parsed = tokens.map((t) => ({ ...t, ...parseClassToken(t.token) }));
  const centring =
    parsed.some((p) => INSET_HALF.test(p.utility)) &&
    parsed.some((p) => TRANSLATE_HALF.test(p.utility));
  const pairedFamilies = new Set<string>();
  for (const p of parsed) {
    if (!hasDirectionVariant(p.variants)) continue;
    const family = patternOf(p.utility)?.family;
    if (family !== undefined && PAIRABLE_FAMILIES.has(family)) {
      pairedFamilies.add(family);
    } else if (p.utility === 'space-x-reverse') {
      pairedFamilies.add('space-x');
    }
  }

  const violations: SiteViolation[] = [];
  for (const p of parsed) {
    if (hasDirectionVariant(p.variants)) {
      if (island) {
        violations.push({
          file,
          line: p.line,
          offset: p.offset,
          kind: 'rtl-variant-in-island',
          key: p.token,
          detail: ISLAND_DETAIL,
          exemptBy: null,
        });
      }
      continue;
    }
    const pattern = patternOf(p.utility);
    if (!pattern || island) continue;
    const isCentringHalf =
      INSET_HALF.test(p.utility) || TRANSLATE_HALF.test(p.utility);
    if (centring && isCentringHalf) continue;
    if (pairedFamilies.has(pattern.family)) continue;
    violations.push({
      file,
      line: p.line,
      offset: p.offset,
      kind: 'rtl-physical',
      key: p.token,
      detail: `physical-direction utility; use ${pattern.fix}, ${EXEMPT_HINT}`,
      exemptBy: 'rtl-exempt',
    });
  }
  return violations;
}

/** `marginLeft` / `margin-left` → `margin-left`. */
const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * A physical property set from a binding or style object. `text-align`
 * counts only when a `left`/`right` value is visible (`values`).
 */
export function propertyViolation(
  name: string,
  values: readonly string[] | null,
  at: { file: string; line: number; offset: number },
  label: string,
): SiteViolation | null {
  const property = kebab(name);
  const logical = RTL_CSS_PROPERTIES[property];
  if (logical === undefined) return null;
  if (
    property === 'text-align' &&
    !(values ?? []).some((v) => /^(left|right)$/i.test(v.trim()))
  ) {
    return null;
  }
  return {
    ...at,
    kind: 'rtl-physical',
    key: label,
    detail: `physical CSS property; use ${logical}, ${EXEMPT_HINT}`,
    exemptBy: 'rtl-exempt',
  };
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

/**
 * Raw CSS: a `.css` file, an inline `styles` entry or a `style="…"`
 * attribute. `rtl-exempt:` comments cover the next declaration or rule.
 */
export function rtlCssFindings(source: TemplateSource): RtlScan {
  const { text, file, offsetAt } = source;
  const at = (index: number) => {
    const offset = offsetAt(index);
    return { file, offset, line: source.lineAt(offset) };
  };
  const scan: RtlScan = { violations: [], markers: [] };

  // Comments become spaces (newlines kept), so offsets stay put.
  const comments: { index: number; text: string }[] = [];
  const code = text.replace(CSS_COMMENT, (comment: string, index: number) => {
    comments.push({ index, text: comment });
    return comment.replace(/[^\n]/g, ' ');
  });
  for (const comment of comments) {
    const body = parseMarkerComment(comment.text);
    if (!body || body.kind !== 'rtl-exempt') continue;
    const next = statementAfter(code, comment.index + comment.text.length);
    scan.markers.push({
      ...body,
      file,
      line: at(comment.index).line,
      covers: next
        ? { start: offsetAt(next.start), end: offsetAt(next.end) }
        : null,
    });
  }

  for (const match of code.matchAll(CSS_DECLARATION)) {
    const property = match[1];
    const value = match[2].replace(/!important/i, '').trim();
    if (property === 'text-align' && !/^(left|right)$/i.test(value)) continue;
    if (property in CSS_SHORTHANDS) {
      const values = shorthandValues(value);
      if (values.length !== 4 || values[1] === values[3]) continue;
      scan.violations.push({
        ...at(match.index),
        kind: 'rtl-physical',
        key: property,
        detail: `four-value \`${property}: ${value}\` with different right and left values; use ${CSS_SHORTHANDS[property]}, ${EXEMPT_HINT}`,
        exemptBy: 'rtl-exempt',
      });
      continue;
    }
    if (
      (property === 'left' || property === 'right') &&
      value === '50%' &&
      /translate(?:X)?\(\s*-50%/i.test(enclosingBlock(code, match.index))
    ) {
      continue; // CSS centring pair
    }
    scan.violations.push({
      ...at(match.index),
      kind: 'rtl-physical',
      key: property,
      detail: `physical CSS property \`${property}: ${value}\`; use ${RTL_CSS_PROPERTIES[property]}, ${EXEMPT_HINT}`,
      exemptBy: 'rtl-exempt',
    });
  }

  for (const match of code.matchAll(CSS_APPLY)) {
    const listStart = match.index + match[0].indexOf(match[1]);
    const tokens = [...match[1].matchAll(/\S+/g)].map((t) => ({
      token: t[0],
      ...at(listStart + t.index),
    }));
    scan.violations.push(...evaluateClassTokens(tokens, false, file));
  }
  return scan;
}

/** A shorthand value split on top-level whitespace (`calc(1px + 2px)` stays whole). */
function shorthandValues(value: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let current = '';
  for (const c of value) {
    if (c === '(') depth++;
    else if (c === ')' && depth > 0) depth--;
    if (/\s/.test(c) && depth === 0) {
      if (current !== '') values.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current !== '') values.push(current);
  return values;
}

/** The declaration or rule that starts after `from`, or null at a block end. */
function statementAfter(
  code: string,
  from: number,
): { start: number; end: number } | null {
  let start = from;
  while (start < code.length && /\s/.test(code[start])) start++;
  if (start >= code.length || code[start] === '}') return null;
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}') {
      if (depth === 0) return { start, end: i };
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    } else if (c === ';' && depth === 0) {
      return { start, end: i + 1 };
    }
  }
  return { start, end: code.length };
}

/** The text of the innermost `{…}` block holding `index` (the whole text if none). */
function enclosingBlock(code: string, index: number): string {
  let start = 0;
  for (let i = index - 1, depth = 0; i >= 0; i--) {
    if (code[i] === '}') depth++;
    else if (code[i] === '{') {
      if (depth === 0) {
        start = i + 1;
        break;
      }
      depth--;
    }
  }
  let end = code.length;
  for (let i = index, depth = 0; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    }
  }
  return code.slice(start, end);
}
