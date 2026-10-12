import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SURFACE_CATALOG_VERSION_4, type SurfaceComponent } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceRenderable } from '../surface-view-state';
import { SURFACE_CONTAINER_GRID_STYLES, type SurfaceLayoutWidth } from './surface-layout.component';
import { SurfaceRendererComponent } from './surface-renderer.component';

/**
 * R3.5 (plan component 3, verification seam): the same surface in a 300 px and
 * a 960 px host, in one viewport, lays out with different column counts.
 *
 * jsdom has no layout engine and the Jest transform strips component styles,
 * so the cascade is applied here: the real `SURFACE_CONTAINER_GRID_STYLES`
 * text is parsed, its `@container dp (min-width)` conditions are evaluated
 * against the host width, and each rendered grid's classes pick the matching
 * rules by specificity and source order. The winning `grid-template-columns`
 * (with `--dp-cols` and `--dp-gap` resolved and `calc`/`min`/`max` evaluated)
 * gives the column count. The visual review (V1) stays the authoritative check.
 */
const ROOT_FONT_PX = 16;

interface ContainerRule {
  /** `null`: unconditional; otherwise the `@container dp (min-width)` threshold in px. */
  readonly minWidth: number | null;
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
  readonly order: number;
}

function parseDeclarations(body: string): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).replace(/\s+/g, ' ').trim());
  }
  return declarations;
}

function parseRules(css: string): readonly ContainerRule[] {
  const rules: ContainerRule[] = [];
  const add = (minWidth: number | null, selectorText: string, body: string) => rules.push({
    minWidth,
    selectors: selectorText.split(',').map(selector => selector.trim()),
    declarations: parseDeclarations(body),
    order: rules.length,
  });
  const blocks = /@container dp \(min-width: (\d+)px\) \{((?:[^{}]+\{[^{}]*\})*)\s*\}|([^{}@]+)\{([^{}]*)\}/g;
  for (const block of css.matchAll(blocks)) {
    if (block[1] !== undefined) {
      for (const inner of (block[2] ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) add(Number(block[1]), inner[1], inner[2]);
    } else {
      add(null, block[3], block[4]);
    }
  }
  return rules;
}

const RULES = parseRules(SURFACE_CONTAINER_GRID_STYLES);

/** Class-only selectors (asserted below), so specificity is the class count. */
function specificity(selector: string): number {
  return selector.split('.').length - 1;
}

/** Declarations that apply to `element` inside a `dp` container of `containerWidth` px (`null`: no container). */
function cascade(element: Element, containerWidth: number | null): ReadonlyMap<string, string> {
  const applied = RULES
    .filter(rule => rule.minWidth === null || (containerWidth !== null && containerWidth >= rule.minWidth))
    .map(rule => ({ rule, weight: Math.max(-1, ...rule.selectors.filter(s => element.matches(s)).map(specificity)) }))
    .filter(({ weight }) => weight >= 0)
    .sort((a, b) => a.weight - b.weight || a.rule.order - b.rule.order);
  const values = new Map<string, string>();
  for (const { rule } of applied) for (const [name, value] of rule.declarations) values.set(name, value);
  return values;
}

type Token = { readonly kind: 'number'; readonly value: number } | { readonly kind: 'function'; readonly name: string }
  | { readonly kind: 'punct'; readonly value: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?)(px|rem)?|([a-z]+)\(|([-+*/(),]))/y;
  while (pattern.lastIndex < expression.trimEnd().length) {
    const match = pattern.exec(expression);
    if (match === null) throw new Error(`Unmodelled CSS length: ${expression}`);
    if (match[1] !== undefined) tokens.push({ kind: 'number', value: Number(match[1]) * (match[2] === 'rem' ? ROOT_FONT_PX : 1) });
    else if (match[3] !== undefined) tokens.push({ kind: 'function', name: match[3] });
    else tokens.push({ kind: 'punct', value: match[4] });
  }
  return tokens;
}

/** `calc`/`min`/`max` arithmetic over px, rem and plain numbers; `100%` is `width`. */
function evaluateLength(expression: string, width: number, vars: ReadonlyMap<string, string>): number {
  const substituted = expression
    .replace(/var\((--[\w-]+)\)/g, (_match, name: string) => {
      const value = vars.get(name);
      if (value === undefined) throw new Error(`Unresolved ${name}`);
      return `(${value})`;
    })
    .replace(/100%/g, `${width}px`);
  const tokens = tokenize(substituted);
  let position = 0;
  const peek = (): Token | undefined => tokens[position];
  const isPunct = (value: string) => { const token = peek(); return token?.kind === 'punct' && token.value === value; };
  const expect = (value: string) => {
    if (!isPunct(value)) throw new Error(`Expected "${value}" in ${substituted}`);
    position++;
  };
  const sum = (): number => {
    let value = product();
    while (isPunct('+') || isPunct('-')) value = (tokens[position++] as { value: string }).value === '+' ? value + product() : value - product();
    return value;
  };
  const product = (): number => {
    let value = factor();
    while (isPunct('*') || isPunct('/')) value = (tokens[position++] as { value: string }).value === '*' ? value * factor() : value / factor();
    return value;
  };
  const factor = (): number => {
    const token = tokens[position++];
    if (token?.kind === 'number') return token.value;
    if (token?.kind === 'punct' && token.value === '(') { const value = sum(); expect(')'); return value; }
    if (token?.kind === 'function' && ['calc', 'min', 'max'].includes(token.name)) {
      const args = [sum()];
      while (isPunct(',')) { position++; args.push(sum()); }
      expect(')');
      return token.name === 'min' ? Math.min(...args) : token.name === 'max' ? Math.max(...args) : (args[0] ?? NaN);
    }
    throw new Error(`Unmodelled CSS token in ${substituted}`);
  };
  const result = sum();
  if (position !== tokens.length) throw new Error(`Trailing tokens in ${substituted}`);
  return result;
}

/** Column count for a grid `width` px wide, from its winning `grid-template-columns`. */
function columnCount(declarations: ReadonlyMap<string, string>, width: number): number {
  const template = declarations.get('grid-template-columns');
  if (template === 'minmax(0, 1fr)') return 1;
  const fixed = /^repeat\((\d+), minmax\(0, 1fr\)\)$/.exec(template ?? '');
  if (fixed) return Number(fixed[1]);
  const autoFit = /^repeat\(auto-fit, minmax\((.+), 1fr\)\)$/.exec(template ?? '');
  if (autoFit) {
    const gap = evaluateLength('var(--dp-gap)', width, declarations);
    const track = evaluateLength(autoFit[1], width, declarations);
    // auto-fit repetitions: the most tracks n with n * track + (n - 1) * gap <= width, at least one.
    return Math.max(1, Math.floor((width + gap) / (track + gap)));
  }
  throw new Error(`Unmodelled grid-template-columns: ${template ?? '(none)'}`);
}

/** The renderer host is the `dp` container only in container mode; its width is its wrapper's. */
function containerWidthOf(element: Element): number | null {
  const renderer = element.closest('ptah-surface-renderer');
  if (renderer === null || !renderer.classList.contains('dp-root')) return null;
  return Number.parseFloat((renderer.parentElement as HTMLElement).style.width);
}

/** Every grid in the fixture spans its container's full row, so its width is the container width. */
function columnsOf(grid: Element, width = containerWidthOf(grid)): number {
  if (width === null) throw new Error('Not inside a dp container');
  return columnCount(cascade(grid, width), width);
}

const avatars = (count: number): SurfaceComponent[] =>
  Array.from({ length: count }, (_, index) => ({ id: `agent-${index}`, kind: 'avatar', name: `agent ${index}` }));
const stats = (count: number): SurfaceComponent[] =>
  Array.from({ length: count }, (_, index) => ({ id: `stat-${index}`, kind: 'stat', title: { text: `S${index}` }, value: index }));

const SURFACE: SurfaceRenderable = {
  contract: 'dashboard-spec/2', dataModel: {}, surface: {
    schemaVersion: 'dashboard-spec/2', catalogVersion: SURFACE_CATALOG_VERSION_4, surfaceId: 'widths',
    title: { text: 'Fleet' }, components: [
      { id: 'agents', kind: 'grid', columns: 4, children: avatars(4) },
      { id: 'stats', kind: 'grid', columns: 4, children: stats(4) },
    ],
  },
};

@Component({
  standalone: true,
  imports: [SurfaceRendererComponent],
  template: `
    <div data-testid="narrow" style="width: 300px">
      <ptah-surface-renderer [renderable]="renderable" [layoutWidth]="mode" (renderFailed)="failures = failures + 1" />
    </div>
    <div data-testid="wide" style="width: 960px">
      <ptah-surface-renderer [renderable]="renderable" [layoutWidth]="mode" (renderFailed)="failures = failures + 1" />
    </div>
  `,
})
class TwoWidthsHostComponent {
  public readonly renderable = SURFACE;
  public mode: SurfaceLayoutWidth = 'container';
  public failures = 0;
}

describe('surface container width (R3.5)', () => {
  function setup(mode: SurfaceLayoutWidth) {
    const fixture = TestBed.createComponent(TwoWidthsHostComponent);
    fixture.componentInstance.mode = mode;
    fixture.detectChanges();
    expect(fixture.componentInstance.failures).toBe(0);
    const element: HTMLElement = fixture.nativeElement;
    const host = (testId: string) => element.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
    return { narrow: host('narrow'), wide: host('wide') };
  }
  /** The root grid, the avatar grid and the stat grid of one host. */
  function grids(host: HTMLElement) {
    const gridAround = (selector: string) => host.querySelector(selector)?.closest('.dp-grid, .grid') ?? null;
    return {
      root: host.querySelector('[data-testid="surface-root"]'),
      agents: gridAround('ptah-dashboard-avatar'),
      stats: gridAround('ptah-surface-layout ptah-dashboard-stat'),
    };
  }

  it('models only class selectors and dp container conditions, so the cascade above is exact', () => {
    expect(RULES.length).toBeGreaterThan(0);
    for (const rule of RULES) for (const selector of rule.selectors) expect(selector).toMatch(/^(\.[\w-]+)+$/);
    expect(RULES.map(rule => rule.minWidth).filter(width => width !== null)).toEqual([360, 700, 700]);
  });

  it('gives one column at 300 px and the column ceiling at 960 px for the same surface in one viewport', () => {
    const { narrow, wide } = setup('container');
    for (const host of [narrow, wide]) {
      expect(host.querySelector('ptah-surface-renderer')?.classList.contains('dp-root')).toBe(true);
      // Nested grids take a full row of the root grid, so their width is the container's.
      for (const node of Array.from(host.querySelectorAll('[data-testid="surface-root"] > ptah-surface-node'))) {
        expect(node.classList.contains('col-span-full')).toBe(true);
      }
    }
    const small = grids(narrow);
    const large = grids(wide);
    expect(small.agents?.className).toBe(large.agents?.className);
    expect(small.agents?.classList.contains('dp-cols-4')).toBe(true);
    expect(large.stats?.classList.contains('dp-grid--stats')).toBe(true);

    expect([small.root, small.agents, small.stats].map(grid => columnsOf(grid as Element))).toEqual([1, 1, 1]);
    // 960 px: the plain grid reaches its `columns` ceiling (4); stat grids and the root cap at 3 (D9).
    expect(columnsOf(large.agents as Element)).toBe(4);
    expect(columnsOf(large.stats as Element)).toBe(3);
    expect(columnsOf(large.root as Element)).toBe(3);
  });

  it('never exceeds the ceiling and never drops columns as the container widens', () => {
    const { wide } = setup('container');
    const agents = grids(wide).agents as Element;
    let previous = 0;
    for (let width = 200; width <= 2000; width += 10) {
      const columns = columnsOf(agents, width);
      expect(columns).toBeGreaterThanOrEqual(previous);
      expect(columns).toBeLessThanOrEqual(4);
      if (width < 360) expect(columns).toBe(1);
      previous = columns;
    }
    // The 128 px floor: a 500 px container fits 3 of the 4 columns, not 4 squeezed ones.
    expect(columnsOf(agents, 500)).toBe(3);
  });

  it("keeps 'viewport' mode unchanged: the Apps page classes, no dp container, the same markup at every width", () => {
    const { narrow, wide } = setup('viewport');
    for (const host of [narrow, wide]) {
      expect(host.querySelector('ptah-surface-renderer')?.classList.contains('dp-root')).toBe(false);
      expect(host.querySelectorAll('.dp-grid')).toHaveLength(0);
      const { root, agents, stats: statGrid } = grids(host);
      // `[class]` bindings do not keep token order, so compare the class sets.
      const classSet = (grid: Element | null) => Array.from(grid?.classList ?? []).sort();
      const expected = (classes: string) => classes.split(' ').sort();
      expect(classSet(root)).toEqual(expected('grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-2 gap-y-4 text-base-content'));
      expect(classSet(agents)).toEqual(expected('grid grid-cols-1 sm:grid-cols-4 gap-4'));
      expect(classSet(statGrid)).toEqual(expected('grid grid-cols-1 sm:grid-cols-4 gap-4'));
      expect(containerWidthOf(agents as Element)).toBeNull();
    }
    const classSequence = (host: HTMLElement) =>
      Array.from(host.querySelectorAll('[class]')).map(node => Array.from(node.classList).sort().join(' '));
    expect(classSequence(narrow)).toEqual(classSequence(wide));
  });
});
