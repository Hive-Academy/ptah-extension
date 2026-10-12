import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DashboardAction, DashboardComponent } from '@ptah-extension/shared';
import {
  SURFACE_ACTIONS,
  SURFACE_CATALOG_VERSION,
  SURFACE_CATALOG_VERSION_4,
  type SurfaceAction,
  type SurfaceComponent,
  type SurfaceDataModel,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { avatarInitials } from './components/dashboard-avatar.component';
import { SurfaceRendererComponent } from './components/surface-renderer.component';
import type { SurfaceActionUiState, SurfaceInteractionState } from './surface-interaction';
import type { SurfaceRenderable, SurfaceViewState } from './surface-view-state';

/**
 * Trust boundary (R8, plan:805-818): producer text is data. The TASK_2026_538
 * fixture (`dashboard-trust-boundary.spec.ts:605`) must render literally in
 * every text field, no element may come from it, neither lib may carry an
 * HTML sink, and no action other than submit and select becomes a control.
 */
const markup = '<img src=x onerror=alert(1)><script>alert(2)</script>';
const text = { text: markup };
const INERT_ACTIONS = SURFACE_ACTIONS.filter(action => action !== 'surface.submit' && action !== 'dashboard.select');
const series = [{ name: markup, points: [{ x: markup, y: 1 }, { x: 'b', y: 2 }] }];

function v2(components: readonly SurfaceComponent[], dataModel: SurfaceDataModel = {}): SurfaceRenderable {
  return { contract: 'dashboard-spec/2', dataModel, surface: { schemaVersion: 'dashboard-spec/2',
    catalogVersion: SURFACE_CATALOG_VERSION, surfaceId: 'surface', title: text, description: text, components } };
}
function v4(components: readonly SurfaceComponent[]): SurfaceRenderable {
  return { contract: 'dashboard-spec/2', dataModel: {}, surface: { schemaVersion: 'dashboard-spec/2',
    catalogVersion: SURFACE_CATALOG_VERSION_4, surfaceId: 'surface', title: text, description: text, components } };
}
function v1(components: readonly DashboardComponent[]): SurfaceRenderable {
  return { contract: 'dashboard-spec/1', spec: { schemaVersion: 'dashboard-spec/1', catalogVersion: 'dashboard-catalog/1',
    specId: 'spec', revision: 1, generatedAt: '2026-09-25T00:00:00Z', title: text, description: text, components } };
}
function interactionOf(patch: Partial<SurfaceInteractionState> = {}): SurfaceInteractionState {
  return { selection: null, selectionUnsynced: false, pendingValues: new Map(), issues: new Map(), actions: new Map(),
    submitDisabled: false, ...patch };
}

@Component({
  standalone: true,
  imports: [SurfaceRendererComponent],
  template: `<ptah-surface-renderer [renderable]="renderable()" [viewState]="viewState()" [interaction]="interaction()"
    (viewStateChange)="viewState.set($event)" (renderFailed)="failures = failures + 1" />`,
})
class TrustHostComponent {
  public readonly renderable = signal<SurfaceRenderable>(v2([]));
  public readonly viewState = signal<SurfaceViewState>({ components: {}, drafts: {} });
  public readonly interaction = signal<SurfaceInteractionState>(interactionOf());
  public failures = 0;
}

function render(renderable: SurfaceRenderable, interaction = interactionOf(), viewState?: SurfaceViewState) {
  const fixture = TestBed.createComponent(TrustHostComponent);
  fixture.componentInstance.renderable.set(renderable);
  fixture.componentInstance.interaction.set(interaction);
  if (viewState !== undefined) fixture.componentInstance.viewState.set(viewState);
  fixture.detectChanges();
  expect(fixture.componentInstance.failures).toBe(0);
  return fixture.nativeElement as HTMLElement;
}

/** The fixture made no element and no handler attribute anywhere in the rendered tree. */
function expectInert(element: HTMLElement): void {
  expect(element.querySelectorAll('img, script, iframe, object, embed, style, [style], a[href]')).toHaveLength(0);
  const handlers = Array.from(element.querySelectorAll('*'))
    .flatMap(node => Array.from(node.attributes).filter(attribute => /^on/i.test(attribute.name)));
  expect(handlers).toHaveLength(0);
}
/** Text of each match, whitespace-trimmed. */
function texts(element: HTMLElement, selector: string): string[] {
  return Array.from(element.querySelectorAll(selector)).map(node => node.textContent?.trim() ?? '');
}

describe('trust boundary: producer text renders literally', () => {
  it('v2: surface, section, card, inputs, options, placeholder, description, action label and bound data', () => {
    const submit: SurfaceAction = { id: 'send', action: 'surface.submit', label: text };
    const element = render(v2([
      { id: 'sec', kind: 'section', title: text, description: text, children: [
        { id: 'card', kind: 'card', title: text, description: text, actions: [submit], children: [
          { id: 'reason', kind: 'text', label: markup, path: 'form.reason', placeholder: markup, description: text },
          { id: 'empty', kind: 'text', label: markup, path: 'form.empty', placeholder: markup },
          { id: 'env', kind: 'select', label: markup, path: 'form.env', options: [{ value: 'a', label: markup }] },
          { id: 'mode', kind: 'radio-group', label: markup, path: 'form.mode', options: [{ value: 'a', label: markup }] },
          { id: 'notify', kind: 'checkbox', label: markup, path: 'form.notify' },
        ] },
      ] },
    ], { form: { reason: markup } }));
    expect(texts(element, 'header h2')).toEqual([markup]);
    expect(texts(element, 'header p')).toEqual([markup]);
    expect(texts(element, 'section > h3')).toEqual([markup]);
    expect(texts(element, 'section > p')).toEqual([markup]);
    expect(texts(element, '.card > h3')).toEqual([markup]);
    expect(texts(element, '.card > p')).toEqual([markup]);
    // Text and select labels, the radio legend and the checkbox label span.
    expect(texts(element, 'label[for^="ptah-surface-text"], label[for^="ptah-surface-choice"]:not([for*="option"])'))
      .toEqual([markup, markup, markup]);
    expect(texts(element, 'legend')).toEqual([markup]);
    expect(texts(element, 'ptah-surface-checkbox-input label > span')).toEqual([markup]);
    expect(texts(element, 'select option:not([value=""])')).toEqual([markup]);
    expect(texts(element, 'fieldset label')).toEqual([markup]);
    const inputs = Array.from(element.querySelectorAll<HTMLInputElement>('input[type=text]'));
    expect(inputs.map(input => input.getAttribute('placeholder'))).toEqual([markup, markup]);
    expect(inputs[0].value).toBe(markup);
    expect(texts(element, 'ptah-surface-text-input p.text-base-content-muted')).toEqual([markup]);
    expect(texts(element, 'button.btn-primary')).toEqual([markup]);
    expectInert(element);
  });

  it('v2: submit issue messages and detail notices', () => {
    const notices: [string, SurfaceActionUiState][] = [
      ['rejected', { status: 'rejected', reason: 'invalid-value', detail: markup }],
      ['not-found', { status: 'not-found', detail: markup }],
      ['unsupported', { status: 'unsupported', detail: markup }],
    ];
    for (const [, state] of notices) {
      const element = render(v2([{ id: 'form', kind: 'card', children: [
        { id: 'reason', kind: 'text', label: 'Reason', path: 'form.reason' },
        { id: 'env', kind: 'select', label: 'Env', path: 'form.env', options: [{ value: 'a', label: 'A' }] },
        { id: 'notify', kind: 'checkbox', label: 'Notify', path: 'form.notify' },
      ], actions: [{ id: 'send', action: 'surface.submit', label: { text: 'Send' } }] }]), interactionOf({
        issues: new Map([['reason', [markup]], ['env', [markup]], ['notify', [markup]]]),
        actions: new Map([['send', state]]),
      }));
      expect(texts(element, '[role="status"]')).toEqual([markup]);
      expect(texts(element, 'p[id*="-issue-"]')).toEqual([markup, markup, markup]);
      expectInert(element);
    }
  });

  it('v1: every display text field', () => {
    const columns = [{ key: 'a', label: text }];
    const element = render(v1([
      { id: 'stat', kind: 'stat', title: text, description: text, value: markup, unit: markup },
      { id: 'table', kind: 'table', title: text, description: text, columns, rows: [[markup]] },
      { id: 'list', kind: 'list', title: text, description: text, items: [{ text, detail: text }] },
      { id: 'line', kind: 'line-chart', title: text, description: text, xLabel: text, yLabel: text, series },
      { id: 'bar', kind: 'bar-chart', title: text, description: text, xLabel: text, yLabel: text, series },
    ]), interactionOf(), { components: { stat: { expanded: true } }, drafts: {} });
    expect(texts(element, 'header h2')).toEqual([markup]);
    expect(texts(element, 'header p')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-stat h3')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-stat [data-testid="stat-value"]')).toEqual([`${markup} ${markup}`]);
    expect(texts(element, 'ptah-dashboard-stat [id^="ptah-stat-details"] p')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-table h3')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-table section > p')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-table caption')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-table th button')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-table td')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-list h3')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-list section > p')).toEqual([markup]);
    expect(texts(element, 'ptah-dashboard-list li p')).toEqual([markup, markup]);
    expect(texts(element, 'ptah-dashboard-chart h3')).toEqual([markup, markup]);
    expect(texts(element, 'ptah-dashboard-chart section > p')).toEqual([markup, markup]);
    expect(texts(element, 'ptah-dashboard-chart ul li')).toEqual([markup, markup]);
    // Axis labels (x then y) and the first x value, as SVG text.
    for (const chart of Array.from(element.querySelectorAll('ptah-dashboard-chart'))) {
      expect(texts(chart as HTMLElement, 'svg text').filter(value => value === markup)).toHaveLength(3);
    }
    expectInert(element);
  });

  it('v1: a list item URL renders as literal text, never as a link', () => {
    const scriptUrl = 'javascript:alert(1)';
    const element = render(v1([{ id: 'list', kind: 'list', title: text, items: [
      { text: { text: 'markup' }, url: markup },
      { text: { text: 'script' }, url: scriptUrl },
    ] }]));
    expect(texts(element, 'ptah-dashboard-list li p.break-all')).toEqual([markup, scriptUrl]);
    expect(element.querySelectorAll('a')).toHaveLength(0);
    expect(Array.from(element.querySelectorAll('*')).flatMap(node => Array.from(node.attributes))
      .filter(attribute => attribute.value.includes(scriptUrl))).toHaveLength(0);
    expectInert(element);
  });

  it('v1: chart series names in the table view', () => {
    const element = render(v1([{ id: 'line', kind: 'line-chart', title: text, series }]), interactionOf(),
      { components: { line: { chartAsTable: true } }, drafts: {} });
    expect(texts(element, 'tbody th')).toEqual([markup, markup]);
    expect(texts(element, 'tbody td').filter(value => value === markup)).toHaveLength(1);
    expectInert(element);
  });
});

/**
 * `dashboard-catalog/4` (R4.7, decision #49): accordion, avatar and the stat
 * trend and spark carry agent text as data only. Text fields render literally;
 * the closed numeric and enum fields reject anything else, so the surface fails
 * closed (nothing renders) instead of placing agent text in an attribute.
 */
describe('trust boundary: /4 accordion, avatar, trend and spark', () => {
  const scriptUrl = 'javascript:alert(1)';
  /** Fields the `/4` avatar does not have; a producer may still send them. */
  const avatarExtras = { url: scriptUrl, image: scriptUrl, src: scriptUrl, href: scriptUrl, html: markup,
    style: 'background:url(javascript:alert(3))', class: 'agent-injected' };

  /** No attribute anywhere names a URL or style, or holds the script URL or markup. */
  function expectNoAgentAttributes(element: HTMLElement): void {
    const attributes = Array.from(element.querySelectorAll('*')).flatMap(node => Array.from(node.attributes));
    expect(attributes.filter(attribute => /^(href|src|srcset|xlink:href|url|image|html|style)$/i.test(attribute.name)))
      .toEqual([]);
    // Accessible names (`aria-label`: the stat's expand button and sparkline) repeat the agent's title as a
    // literal attribute value, which is inert; the sparkline label is pinned literally below.
    expect(attributes.filter(attribute => attribute.name !== 'aria-label'
      && (attribute.value.includes(scriptUrl) || attribute.value.includes('<img')))).toEqual([]);
    expect(element.querySelectorAll('a, image, use, .agent-injected')).toHaveLength(0);
  }

  it('renders accordion title, avatar name and subtitle, and stat title with trend and spark literally', () => {
    const element = render(v4([
      { id: 'acc', kind: 'accordion', title: text, children: [
        { id: 'who', kind: 'avatar', name: markup, subtitle: markup },
      ] },
      { id: 'url', kind: 'avatar', name: scriptUrl, subtitle: scriptUrl, ...avatarExtras } as SurfaceComponent,
      { id: 'cost', kind: 'stat', title: text, value: 1, trend: { direction: 'up', amount: 4.2, percent: true, polarity: 'bad' },
        spark: [1, 2, 3] },
    ]), interactionOf(), { components: { acc: { expanded: true } }, drafts: {} });
    expect(texts(element, '[data-kind="accordion"] > h3 button span.font-semibold')).toEqual([markup]);
    expect(texts(element, '[data-testid="avatar-name"]')).toEqual([markup, scriptUrl]);
    expect(texts(element, '[data-testid="avatar-subtitle"]')).toEqual([markup, scriptUrl]);
    expect(texts(element, '[data-testid="avatar-initials"]')).toEqual([avatarInitials(markup), avatarInitials(scriptUrl)]);
    expect(element.querySelectorAll('[data-testid="avatar-initials"][aria-hidden="true"]')).toHaveLength(2);
    expect(texts(element, 'ptah-dashboard-stat h3')).toEqual([markup]);
    expect(texts(element, '[data-testid="stat-trend"]')).toEqual(['Trend up 4.2%, bad']);
    const spark = element.querySelector('[data-testid="stat-spark"]');
    expect(spark?.getAttribute('aria-label')).toBe(`${markup} trend, 3 points: 1, 2, 3; latest 3`);
    // Decision #51: polarity `bad` draws the latest bar in the error fill; every class is a literal from the atom.
    expect(Array.from(spark?.querySelectorAll('rect') ?? []).map(bar => bar.getAttribute('class')))
      .toEqual(['dp-spark-bar', 'dp-spark-bar', 'dp-spark-bar dp-spark-bar--failing']);
    expectNoAgentAttributes(element);
    expectInert(element);
  });

  it('keeps a closed accordion body inert, with its agent text still literal', () => {
    const element = render(v4([{ id: 'acc', kind: 'accordion', title: text, children: [
      { id: 'who', kind: 'avatar', name: markup },
    ] }]));
    expect(element.querySelector('[data-kind="accordion"] h3 button')?.getAttribute('aria-expanded')).toBe('false');
    expect(element.querySelector('[data-kind="accordion"] [inert]')).not.toBeNull();
    expect(texts(element, '[data-testid="avatar-name"]')).toEqual([markup]);
    expectNoAgentAttributes(element);
    expectInert(element);
  });

  const statWith = (extras: Record<string, unknown>) =>
    ({ id: 'cost', kind: 'stat', title: { text: 'Cost' }, value: 1, ...extras }) as SurfaceComponent;
  const trendOf = (patch: Record<string, unknown>) =>
    ({ trend: { direction: 'up', amount: 1, percent: false, ...patch } });

  it.each<[string, SurfaceComponent]>([
    ['trend direction', statWith(trendOf({ direction: markup }))],
    ['trend amount', statWith(trendOf({ amount: markup }))],
    ['trend percent', statWith(trendOf({ percent: markup }))],
    ['trend polarity', statWith(trendOf({ polarity: markup }))],
    ['trend direction as a prototype key', statWith(trendOf({ direction: '__proto__' }))],
    ['spark point', statWith({ spark: [1, markup] })],
    ['spark point as a URL', statWith({ spark: [1, scriptUrl] })],
    ['avatar name as rich text', { id: 'who', kind: 'avatar', name: { text: markup } } as unknown as SurfaceComponent],
    ['avatar subtitle as rich text', { id: 'who', kind: 'avatar', name: 'n', subtitle: { text: markup } } as unknown as SurfaceComponent],
  ])('fails closed when the %s carries agent text: nothing renders', (_name, component) => {
    const fixture = TestBed.createComponent(TrustHostComponent);
    fixture.componentInstance.renderable.set(v4([{ id: 'acc', kind: 'accordion', title: { text: 'A' }, children: [component] }]));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.failures).toBeGreaterThan(0);
    expect(element.querySelector('[data-testid="surface-root"]')).toBeNull();
    expect(element.textContent).not.toContain('<img');
    expect(element.textContent).not.toContain(scriptUrl);
    expectNoAgentAttributes(element);
    expectInert(element);
  });
});

describe('trust boundary: no action other than submit and select is a control', () => {
  /** Every enabled control, by focus key or tag, in document order. */
  function enabledControls(element: HTMLElement): string[] {
    return Array.from(element.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
      .filter(control => !(control as HTMLButtonElement).disabled)
      .map(control => control.getAttribute('data-apps-focus-key') ?? control.tagName);
  }
  const labelOf = (action: string) => `Inert ${action}`;
  const v2Actions: readonly SurfaceAction[] = INERT_ACTIONS.map((action, index) => ({ id: `inert-${index}`, action,
    label: { text: labelOf(action) }, ...(action === 'dashboard.open-url' ? { url: 'https://example.test' } : {}) }));
  // INERT_ACTIONS already excludes surface.submit, the one catalog action a v1 spec cannot carry.
  const v1Actions: readonly DashboardAction[] = INERT_ACTIONS.map(action => ({
    action, label: { text: labelOf(action) }, ...(action === 'dashboard.open-url' ? { url: 'https://example.test' } : {}),
  }));

  function v2Surface(actions: readonly SurfaceAction[] | undefined): SurfaceRenderable {
    const withActions = actions === undefined ? {} : { actions };
    return v2([{ id: 'card', kind: 'card', ...withActions, children: [
      { id: 'grid', kind: 'grid', columns: 2, ...withActions, children: [] },
      { id: 'stat', kind: 'stat', value: 1, ...withActions },
      { id: 'table', kind: 'table', columns: [{ key: 'a', label: { text: 'A' } }], rows: [['x']], ...withActions },
      { id: 'list', kind: 'list', items: [{ text: { text: 'x' } }], ...withActions },
      { id: 'chart', kind: 'bar-chart', series: [{ name: 's', points: [{ x: 1, y: 1 }] }], ...withActions },
    ] }]);
  }
  function v1Spec(actions: readonly DashboardAction[] | undefined): SurfaceRenderable {
    const withActions = actions === undefined ? {} : { actions };
    return v1([
      { id: 'stat', kind: 'stat', value: 1, ...withActions },
      { id: 'table', kind: 'table', columns: [{ key: 'a', label: { text: 'A' } }], rows: [['x']], ...withActions },
      { id: 'list', kind: 'list', items: [{ text: { text: 'x' } }], ...withActions },
      { id: 'chart', kind: 'line-chart', series: [{ name: 's', points: [{ x: 1, y: 1 }] }], ...withActions },
    ]);
  }

  it('covers every catalog action id except surface.submit and dashboard.select', () => {
    expect(INERT_ACTIONS).toEqual(['dashboard.refresh', 'dashboard.pin', 'dashboard.export', 'dashboard.copy',
      'dashboard.open-url', 'dashboard.drill-down']);
  });

  it('v2: layouts and display kinds carrying every other action render the same controls as none', () => {
    const plain = enabledControls(render(v2Surface(undefined)));
    const withInert = render(v2Surface(v2Actions));
    expect(enabledControls(withInert)).toEqual(plain);
    expect(withInert.textContent).not.toContain('Inert');
    expect(plain.some(control => /:(select|row-|item-|point-|action-)/.test(control))).toBe(false);
  });

  it('v1: display kinds carrying every other action render the same controls as none', () => {
    const plain = enabledControls(render(v1Spec(undefined)));
    const withInert = render(v1Spec(v1Actions));
    expect(enabledControls(withInert)).toEqual(plain);
    expect(withInert.textContent).not.toContain('Inert');
  });
});

/** Source files of a lib, excluding specs (they name the tokens on purpose). */
function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|html)$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

/**
 * Drops the real TypeScript comments only, using the TypeScript parser and
 * printer, so the regex-versus-division and string-boundary decisions are the
 * compiler's, not a heuristic's. Strings, template literals (with any HTML
 * comment inside an Angular template) and regex literals stay and are
 * scanned. `<!--` in TypeScript code is not a comment in an ES module, so it
 * is kept too. An `.html` file is scanned whole: nothing is stripped.
 */
function stripComments(source: string, fileName = 'source.ts'): string {
  if (fileName.endsWith('.html')) return source;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return ts.createPrinter({ removeComments: true }).printFile(file);
}

/**
 * The same code with string and template boundaries, interpolations,
 * concatenation and whitespace removed, so `'inner' + 'HTML'`,
 * `el['outer' +\n 'HTML']` and `` `inner${''}HTML` `` read as the token.
 */
function joined(code: string): string {
  return code.replace(/\$\{[^}]*\}/g, '').replace(/[\s'"`+]/g, '');
}

const FORBIDDEN = [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /bypassSecurityTrust/, /DomSanitizer/, /<iframe/i];

/** Every forbidden token in the comment-stripped code, direct or split across literals. */
function sinkFindings(source: string, fileName?: string): string[] {
  const code = stripComments(source, fileName);
  const flat = joined(code);
  return FORBIDDEN.filter(pattern => pattern.test(code) || pattern.test(flat)).map(pattern => String(pattern));
}

/**
 * Limit (documented, R8): this is a token scan, a regression gate against an
 * HTML sink written in source, not a proof that none exists. A name computed
 * at run time (`el[key]` with `key` assembled from variables, `atob`,
 * `String.fromCharCode`, `Reflect.set`) is not a source token and passes it.
 * The defence that does not depend on the scan is the runtime DOM assertion
 * above: every pinned field is rendered with the 538 fixture and must come out
 * as literal text with zero `img`/`script` (or any other active) element.
 */
describe('trust boundary: no HTML sink in either lib (comment-stripped source scan)', () => {
  const renderer = join(__dirname, '..');
  const apps = join(__dirname, '..', '..', '..', 'mcp-apps-page', 'src');

  it('strips comments but keeps strings, templates and regex literals', () => {
    const sample = [
      "// innerHTML in a line comment",
      "/* DomSanitizer in a block */ const a = 'kept // not a comment';",
      "const t = `<iframe></iframe>`; const r = /['\"]/g; <!-- bypassSecurityTrust -->",
    ].join('\n');
    const stripped = stripComments(sample);
    expect(stripped).not.toMatch(/innerHTML|DomSanitizer/);
    // `<!--` in TypeScript code is not a comment (ES module); keeping it closes the hiding place.
    expect(stripped).toMatch(/bypassSecurityTrust/);
    expect(stripped).toContain("'kept // not a comment'");
    expect(stripped).toContain('`<iframe></iframe>`');
    expect(stripped).toContain(`/['"]/g`);
  });

  it.each<[string, string, string]>([
    ['an HTML comment spanning string markers', "const start = '<!--'; element.innerHTML = agentText; const end = '-->';", '/innerHTML/'],
    ['a regex literal that looks like a block comment', 'if (ok) /[/*]/.test(s); el.innerHTML = v; // */', '/innerHTML/'],
    ['bracket access', "el['innerHTML'] = v;", '/innerHTML/'],
    ['a split string', "el['inner' + 'HTML'] = v;", '/innerHTML/'],
    ['a split string across lines', 'el["outer" +\n  "HTML"] = v;', '/outerHTML/'],
    ['template concatenation', "el[`insertAdjacent${''}HTML`]('beforeend', v);", '/insertAdjacentHTML/'],
    ['a split method name', "sanitizer['bypassSecurity' + 'TrustHtml'](v);", '/bypassSecurityTrust/'],
    ['an HTML comment inside a template string', 'const t = `<!-- <iframe src="x"> -->`;', '/<iframe/i'],
    ['a split tag in a template', 'const t = `<ifr${""}ame>`;', '/<iframe/i'],
  ])('finds a sink hidden by %s', (_name, source, pattern) => {
    expect(sinkFindings(source)).toContain(pattern);
  });

  it('does not flag a token that only a real comment mentions', () => {
    expect(sinkFindings('// innerHTML\n/* DomSanitizer */\n/** bypassSecurityTrust */\nconst ok = 1;')).toEqual([]);
  });

  it.each([['declarative-dashboard', renderer], ['mcp-apps-page', apps]])('%s has no HTML sink', (_name, root) => {
    const files = sourceFiles(root);
    expect(files.length).toBeGreaterThan(0);
    const findings = files.flatMap(file => sinkFindings(readFileSync(file, 'utf8'), file).map(pattern => `${file}: ${pattern}`));
    expect(findings).toEqual([]);
  });

  it('the /4 atoms bind no style, URL or HTML property in their templates', () => {
    const atoms = ['dashboard-avatar', 'dashboard-sparkline', 'dashboard-stat', 'surface-layout', 'surface-node']
      .map(name => join(renderer, 'lib', 'components', `${name}.component.ts`));
    const binding = /\[(?:attr\.)?style(?:\.[\w-]+)*\]|\[ngStyle\]|\[(?:attr\.)?(?:href|src|srcset|xlink:href|innerHTML)\]/;
    const findings = atoms.filter(file => binding.test(stripComments(readFileSync(file, 'utf8'), file)));
    expect(findings).toEqual([]);
  });

  it('the renderer lib does not import the markdown lib', () => {
    const findings = sourceFiles(renderer).filter(file =>
      /@ptah-extension\/markdown/.test(stripComments(readFileSync(file, 'utf8'), file)));
    expect(findings).toEqual([]);
  });
});
