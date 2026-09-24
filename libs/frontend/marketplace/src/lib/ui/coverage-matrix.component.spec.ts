/**
 * CoverageMatrixComponent specs (plan C8 `CoverageMatrix`, Task 10.3).
 *
 * A `<table>` with a `<caption>`, column and row headers, icon + sr-only text
 * per cell, one merged "Ptah sessions" cell for session-override rows, and
 * loading / empty / error states. Built from the real `buildCoverageMatrix()`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  PTAH_SESSIONS_LABEL,
  buildCoverageMatrix,
  type CoverageMatrix,
} from '../data/coverage';
import type { ProviderRow } from '../data/provider-row';
import {
  CoverageMatrixComponent,
  coverageCellPresentation,
} from './coverage-matrix.component';

function row(overrides: Partial<ProviderRow> & { ref: string }): ProviderRow {
  const key = overrides.ref.split(':')[1] ?? overrides.ref;
  return {
    serverKey: key,
    kind: 'config',
    title: key,
    brand: null,
    origin: 'harness-config',
    originLabel: 'Config file',
    targets: [],
    status: 'configured',
    statusSource: 'config',
    connection: null,
    removal: { kind: 'uninstall' },
    configSummary: {
      transport: 'stdio',
      command: 'npx',
      args: [],
      envKeys: [],
    },
    configPaths: [],
    ...overrides,
  };
}

const GITHUB = row({
  ref: 'harness-config:github',
  targets: [
    { target: 'vscode', label: 'VS Code', via: 'configured' },
    { target: 'claude', label: 'Claude Code', via: 'configured' },
  ],
});
const LOCAL = row({
  ref: 'claude-user:local-db',
  origin: 'claude-user',
  originLabel: 'Claude CLI',
  targets: [{ target: 'claude', label: 'Claude Code', via: 'declared-by-cli' }],
});
const LINEAR = row({
  ref: 'oauth:linear',
  kind: 'connection',
  origin: 'oauth',
  originLabel: 'OAuth',
});

const MATRIX = buildCoverageMatrix([GITHUB, LOCAL, LINEAR], []);

describe('CoverageMatrixComponent', () => {
  let fixture: ComponentFixture<CoverageMatrixComponent>;
  let component: CoverageMatrixComponent;
  let element: HTMLElement;

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(CoverageMatrixComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('matrix', MATRIX);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const rowOf = (ref: string): HTMLElement =>
    element.querySelector(
      `[data-testid="coverage-row"][data-ref="${ref}"]`,
    ) as HTMLElement;
  const srTexts = (tr: HTMLElement): string[] =>
    Array.from(
      tr.querySelectorAll('[data-testid="coverage-cell"] .sr-only'),
    ).map((span) => span.textContent?.trim() ?? '');

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CoverageMatrixComponent] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is a table with a caption and scoped headers', () => {
    render();
    const table = element.querySelector('table');
    expect(table?.querySelector('caption')?.textContent?.trim()).toBe(
      'Coverage: which CLI receives which MCP server',
    );
    const columns = Array.from(table?.querySelectorAll('thead th') ?? []);
    expect(columns.every((th) => th.getAttribute('scope') === 'col')).toBe(
      true,
    );
    expect(
      Array.from(
        element.querySelectorAll('[data-testid="coverage-column"]'),
      ).map((th) => th.getAttribute('data-target')),
    ).toEqual(['vscode', 'claude']);
    const rowHeaders = Array.from(table?.querySelectorAll('tbody th') ?? []);
    expect(rowHeaders).toHaveLength(3);
    expect(rowHeaders.every((th) => th.getAttribute('scope') === 'row')).toBe(
      true,
    );
    expect(rowHeaders[0].textContent).toContain('github');
    expect(rowHeaders[0].textContent).toContain('Config file');
  });

  it('names each column once for readers: the CLI marks are hidden', () => {
    render();
    const header = element.querySelector(
      '[data-testid="coverage-column"]',
    ) as HTMLElement;
    expect(
      header
        .querySelector('ptah-target-marks')
        ?.parentElement?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(header.textContent).toContain('VS Code');
  });

  it('draws an icon with hidden text in every per-target cell', () => {
    render();
    expect(srTexts(rowOf(GITHUB.ref))).toEqual(['Configured', 'Configured']);
    expect(srTexts(rowOf(LOCAL.ref))).toEqual([
      'Not configured',
      "Declared in the CLI's own config",
    ]);
    const cells = Array.from(
      rowOf(LOCAL.ref).querySelectorAll('[data-testid="coverage-cell"]'),
    );
    for (const cell of cells) {
      expect(
        cell.querySelector('[aria-hidden="true"] lucide-angular'),
      ).not.toBeNull();
    }
    expect(cells[0].querySelector('[aria-hidden="true"]')?.classList).toContain(
      coverageCellPresentation('none').toneClass,
    );
  });

  it('renders one merged "Ptah sessions" cell spanning every target column', () => {
    render();
    const tr = rowOf(LINEAR.ref);
    expect(tr.querySelectorAll('[data-testid="coverage-cell"]')).toHaveLength(
      0,
    );
    const merged = tr.querySelectorAll('[data-testid="coverage-merged-cell"]');
    expect(merged).toHaveLength(1);
    expect(merged[0].getAttribute('colspan')).toBe('2');
    expect(merged[0].textContent).toContain(PTAH_SESSIONS_LABEL);
    expect(merged[0].querySelector('.sr-only')?.textContent).toContain(
      'Injected into Ptah sessions only',
    );
  });

  it('keeps a valid table when no target column exists', () => {
    const matrix: CoverageMatrix = buildCoverageMatrix(
      [row({ ref: 'harness-config:bare' }), LINEAR],
      [],
    );
    render({ matrix });
    expect(matrix.columns).toHaveLength(0);
    expect(element.querySelectorAll('thead th')).toHaveLength(2);
    expect(srTexts(rowOf('harness-config:bare'))).toEqual(['Not configured']);
    expect(
      rowOf(LINEAR.ref)
        .querySelector('[data-testid="coverage-merged-cell"]')
        ?.getAttribute('colspan'),
    ).toBe('1');
  });

  it('lists a legend with every cell state', () => {
    render();
    const legend = element.querySelector('[data-testid="coverage-legend"]');
    expect(legend?.getAttribute('aria-label')).toBe('Legend');
    expect(legend?.querySelectorAll('li')).toHaveLength(4);
  });

  it('shows the empty state when there are no servers', () => {
    render({ matrix: { columns: [], rows: [] } });
    expect(element.querySelector('table')).toBeNull();
    expect(
      element.querySelector('[data-testid="coverage-matrix-empty"]'),
    ).not.toBeNull();
  });

  it('shows loading and error with a Retry output', () => {
    render({ state: 'loading' });
    expect(
      element.querySelector('[data-testid="coverage-matrix-loading"]'),
    ).not.toBeNull();
    expect(element.querySelector('table')).toBeNull();

    fixture.componentRef.setInput('state', 'error');
    fixture.detectChanges();
    const retries: void[] = [];
    component.retryRequested.subscribe(() => retries.push(undefined));
    expect(
      element
        .querySelector('[data-testid="coverage-matrix-error"]')
        ?.getAttribute('role'),
    ).toBe('alert');
    (
      element.querySelector(
        '[data-testid="coverage-matrix-retry"]',
      ) as HTMLButtonElement
    ).click();
    expect(retries).toHaveLength(1);
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'coverage-matrix.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
