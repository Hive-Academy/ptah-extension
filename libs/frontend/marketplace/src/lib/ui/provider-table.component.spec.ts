/**
 * ProviderTableComponent specs (plan C8 `ProviderTable`, Task 10.1).
 *
 * `<th scope="col">` headers with `aria-sort`; "Select <name>" checkboxes,
 * disabled with a reason on blocked and `manage-link` rows; the lock badge,
 * never a paragraph, in the action column; no "Last used" column; the
 * selection, sort, open and remove outputs; loading, empty and error states.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { ProviderSort } from '../data/provider-filtering';
import type { ProviderRow } from '../data/provider-row';
import {
  ProviderTableComponent,
  isProviderRowSelectable,
  nextProviderSort,
  providerRemovalAction,
  providerRowCheckboxLabel,
  withRefSelected,
} from './provider-table.component';

// The lock badge's popover positions itself with Floating UI, which needs
// layout that jsdom does not have. Same stand-in as the Batch 9 badge spec.
jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

function row(overrides: Partial<ProviderRow> & { ref: string }): ProviderRow {
  return {
    serverKey: overrides.ref.split(':')[1] ?? overrides.ref,
    kind: 'config',
    title: overrides.ref.split(':')[1] ?? overrides.ref,
    brand: null,
    origin: 'harness-config',
    originLabel: 'Config file',
    targets: [{ target: 'claude', label: 'Claude Code', via: 'configured' }],
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
    configPaths: ['/w/.mcp.json'],
    ...overrides,
  };
}

const GITHUB = row({ ref: 'harness-config:github', title: 'github' });
const LOCAL = row({
  ref: 'claude-user:local-db',
  title: 'local-db',
  origin: 'claude-user',
  originLabel: 'Claude CLI',
  removal: { kind: 'confirm-direct', configPaths: ['~/.claude.json'] },
});
const LINEAR = row({
  ref: 'oauth:linear',
  title: 'linear',
  kind: 'connection',
  origin: 'oauth',
  originLabel: 'OAuth',
  targets: [],
  status: 'expired',
  statusSource: 'oauth',
  removal: { kind: 'disconnect' },
});
const SENTRY = row({
  ref: 'claude-user:sentry',
  title: 'sentry',
  origin: 'claude-user',
  originLabel: 'Claude CLI',
  status: 'unknown',
  statusText: 'weird-state',
  removal: {
    kind: 'blocked',
    reason: 'Owned by the Claude CLI.',
    fixCommand: 'claude mcp remove sentry',
  },
});
const GMAIL = row({
  ref: 'claude-connector:gmail',
  title: 'Gmail',
  kind: 'account-connector',
  origin: 'claude-connector',
  originLabel: 'Claude account',
  targets: [],
  status: 'failed',
  statusSource: 'session',
  removal: {
    kind: 'manage-link',
    reason: 'Manage this connector in your claude.ai account.',
  },
});

const ALL = [GITHUB, LOCAL, LINEAR, SENTRY, GMAIL];

describe('provider-table helpers', () => {
  it('only rows with a removal Ptah can run are selectable', () => {
    expect(ALL.filter(isProviderRowSelectable).map((r) => r.ref)).toEqual([
      GITHUB.ref,
      LOCAL.ref,
      LINEAR.ref,
    ]);
  });

  it.each([
    [GITHUB, 'Select github'],
    [SENTRY, "sentry can't be selected: Ptah can't remove it"],
    [GMAIL, "Gmail can't be selected: it is managed in your claude.ai account"],
  ])('names the checkbox of %s', (input, label) => {
    expect(providerRowCheckboxLabel(input)).toBe(label);
  });

  it('gives each removable kind its own button and none to locked rows', () => {
    expect(providerRemovalAction(GITHUB)?.ariaLabel).toBe('Remove github');
    expect(providerRemovalAction(LOCAL)?.label).toBe('Remove…');
    expect(providerRemovalAction(LINEAR)?.ariaLabel).toBe('Disconnect linear');
    expect(providerRemovalAction(SENTRY)).toBeNull();
    expect(providerRemovalAction(GMAIL)).toBeNull();
  });

  it('flips the direction on the same key and starts a new key ascending', () => {
    const asc: ProviderSort = { key: 'name', direction: 'asc' };
    expect(nextProviderSort(asc, 'name')).toEqual({
      key: 'name',
      direction: 'desc',
    });
    expect(
      nextProviderSort({ key: 'name', direction: 'desc' }, 'status'),
    ).toEqual({ key: 'status', direction: 'asc' });
  });

  it('returns a new set and never mutates the input', () => {
    const before = new Set(['a']);
    const after = withRefSelected(before, 'b', true);
    expect([...after]).toEqual(['a', 'b']);
    expect([...before]).toEqual(['a']);
    expect([...withRefSelected(after, 'a', false)]).toEqual(['b']);
  });
});

describe('ProviderTableComponent', () => {
  let fixture: ComponentFixture<ProviderTableComponent>;
  let component: ProviderTableComponent;
  let element: HTMLElement;

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(ProviderTableComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('rows', ALL);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const rowOf = (ref: string): HTMLElement =>
    element.querySelector(
      `[data-testid="provider-row"][data-ref="${ref}"]`,
    ) as HTMLElement;
  const checkboxOf = (ref: string): HTMLInputElement =>
    rowOf(ref).querySelector(
      '[data-testid="provider-row-checkbox"]',
    ) as HTMLInputElement;
  const selectAll = (): HTMLInputElement =>
    element.querySelector(
      '[data-testid="provider-select-all"]',
    ) as HTMLInputElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProviderTableComponent] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders a table with a caption and column headers scoped to columns', () => {
    render();
    const table = element.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.querySelector('caption')?.textContent?.trim()).toBe(
      'installed servers',
    );
    const headers = Array.from(element.querySelectorAll('thead th'));
    expect(headers).toHaveLength(6);
    for (const header of headers) {
      expect(header.getAttribute('scope')).toBe('col');
    }
    expect(headers.map((h) => h.textContent?.trim())).toEqual([
      '',
      'Server',
      'Origin',
      'Targets',
      'Status',
      'Actions',
    ]);
  });

  it('has no "Last used" column', () => {
    render();
    expect(element.textContent).not.toMatch(/last used/i);
  });

  it('marks the sorted column with aria-sort and the others "none"', () => {
    render({ sort: { key: 'origin', direction: 'desc' } });
    const sortOf = (key: string): string | null =>
      element
        .querySelector(`[data-testid="provider-sort-${key}"]`)
        ?.getAttribute('aria-sort') ?? null;
    expect(sortOf('origin')).toBe('descending');
    expect(sortOf('name')).toBe('none');
    expect(sortOf('status')).toBe('none');

    fixture.componentRef.setInput('sort', { key: 'name', direction: 'asc' });
    fixture.detectChanges();
    expect(sortOf('name')).toBe('ascending');
    expect(sortOf('origin')).toBe('none');
  });

  it('emits the next sort when a header button is pressed', () => {
    render({ sort: { key: 'name', direction: 'asc' } });
    const sorts: ProviderSort[] = [];
    component.sortChange.subscribe((sort) => sorts.push(sort));
    (
      element.querySelector(
        '[data-testid="provider-sort-name"] button',
      ) as HTMLButtonElement
    ).click();
    (
      element.querySelector(
        '[data-testid="provider-sort-status"] button',
      ) as HTMLButtonElement
    ).click();
    expect(sorts).toEqual([
      { key: 'name', direction: 'desc' },
      { key: 'status', direction: 'asc' },
    ]);
  });

  it('names each row checkbox "Select <name>"', () => {
    render();
    expect(checkboxOf(GITHUB.ref).getAttribute('aria-label')).toBe(
      'Select github',
    );
    expect(checkboxOf(GITHUB.ref).disabled).toBe(false);
  });

  it('disables the checkbox of blocked and manage-link rows and says why', () => {
    render({ selected: new Set([SENTRY.ref, GMAIL.ref]) });
    for (const locked of [SENTRY, GMAIL]) {
      const box = checkboxOf(locked.ref);
      expect(box.disabled).toBe(true);
      expect(box.checked).toBe(false);
      expect(box.getAttribute('aria-label')).toBe(
        providerRowCheckboxLabel(locked),
      );
      expect(box.getAttribute('title')).toBe(providerRowCheckboxLabel(locked));
    }
  });

  it('emits the selection with the row added or removed', () => {
    render({ selected: new Set([LOCAL.ref]) });
    const emitted: string[][] = [];
    component.selectionChange.subscribe((set) => emitted.push([...set]));

    const box = checkboxOf(GITHUB.ref);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    const local = checkboxOf(LOCAL.ref);
    local.checked = false;
    local.dispatchEvent(new Event('change'));

    expect(emitted).toEqual([[LOCAL.ref, GITHUB.ref], []]);
  });

  it('selects every selectable visible row from the header, keeping hidden ones', () => {
    render({ selected: new Set(['hidden:ref']) });
    const emitted: string[][] = [];
    component.selectionChange.subscribe((set) => emitted.push([...set]));
    expect(selectAll().getAttribute('aria-label')).toBe(
      'Select all selectable servers',
    );
    selectAll().checked = true;
    selectAll().dispatchEvent(new Event('change'));
    expect(emitted[0]).toEqual([
      'hidden:ref',
      GITHUB.ref,
      LOCAL.ref,
      LINEAR.ref,
    ]);
  });

  it('shows the header checkbox checked, mixed or clear from the selection', () => {
    render({ selected: new Set([GITHUB.ref]) });
    expect(selectAll().indeterminate).toBe(true);
    expect(selectAll().checked).toBe(false);

    fixture.componentRef.setInput(
      'selected',
      new Set([GITHUB.ref, LOCAL.ref, LINEAR.ref]),
    );
    fixture.detectChanges();
    expect(selectAll().checked).toBe(true);
    expect(selectAll().indeterminate).toBe(false);

    selectAll().checked = false;
    const emitted: string[][] = [];
    component.selectionChange.subscribe((set) => emitted.push([...set]));
    selectAll().dispatchEvent(new Event('change'));
    expect(emitted).toEqual([[]]);
  });

  it('disables the header checkbox when no visible row can be selected', () => {
    render({ rows: [SENTRY, GMAIL] });
    expect(selectAll().disabled).toBe(true);
  });

  it('styles the active row and marks it aria-current', () => {
    render({ activeRef: LINEAR.ref });
    expect(rowOf(LINEAR.ref).getAttribute('aria-current')).toBe('true');
    expect(rowOf(LINEAR.ref).className).toContain('bg-primary/10');
    expect(rowOf(GITHUB.ref).getAttribute('aria-current')).toBeNull();
    expect(rowOf(GITHUB.ref).className).not.toContain('bg-primary/10');
  });

  it('emits the row when its name is pressed', () => {
    render();
    const opened: ProviderRow[] = [];
    component.openRequested.subscribe((r) => opened.push(r));
    (
      rowOf(LINEAR.ref).querySelector(
        '[data-testid="provider-row-open"]',
      ) as HTMLButtonElement
    ).click();
    expect(opened).toEqual([LINEAR]);
  });

  it('emits remove for removable rows and disables a busy one', () => {
    render({ busyRefs: new Set([LOCAL.ref]) });
    const removed: ProviderRow[] = [];
    component.removeRequested.subscribe((r) => removed.push(r));
    const button = (ref: string): HTMLButtonElement =>
      rowOf(ref).querySelector(
        '[data-testid="provider-row-remove"]',
      ) as HTMLButtonElement;

    expect(button(LINEAR.ref).getAttribute('aria-label')).toBe(
      'Disconnect linear',
    );
    button(GITHUB.ref).click();
    button(LINEAR.ref).click();
    expect(button(LOCAL.ref).disabled).toBe(true);
    expect(button(LOCAL.ref).getAttribute('aria-busy')).toBe('true');
    expect(removed).toEqual([GITHUB, LINEAR]);
  });

  it('renders the lock badge, not a paragraph, for blocked and manage-link rows', () => {
    render();
    for (const locked of [SENTRY, GMAIL]) {
      const actions = rowOf(locked.ref).lastElementChild as HTMLElement;
      expect(
        actions.querySelector('[data-testid="provider-row-remove"]'),
      ).toBeNull();
      expect(actions.querySelector('ptah-removal-lock-badge')).not.toBeNull();
      expect(actions.querySelector('p')).toBeNull();
      expect(actions.textContent).not.toContain(
        locked.removal.kind === 'blocked' ||
          locked.removal.kind === 'manage-link'
          ? locked.removal.reason
          : '',
      );
    }
  });

  it('shows the status through ptah-status-pill, raw text for unknown', () => {
    render();
    const pill = rowOf(SENTRY.ref).querySelector(
      '[data-testid="status-pill-label"]',
    );
    expect(pill?.textContent?.trim()).toBe('weird-state');
    expect(
      rowOf(GMAIL.ref)
        .querySelector('[data-testid="status-pill-label"]')
        ?.textContent?.trim(),
    ).toBe('Failed');
  });

  it('draws CLI marks for config rows and "Ptah sessions" for the rest', () => {
    render();
    expect(rowOf(GITHUB.ref).querySelector('ptah-target-marks')).not.toBeNull();
    for (const sessionRow of [LINEAR, GMAIL]) {
      expect(
        rowOf(sessionRow.ref).querySelector('ptah-target-marks'),
      ).toBeNull();
      expect(
        rowOf(sessionRow.ref)
          .querySelector('[data-testid="provider-row-session-targets"]')
          ?.textContent?.trim(),
      ).toBe('Ptah sessions');
    }
  });

  it('shows a loading state with no table', () => {
    render({ state: 'loading' });
    const loading = element.querySelector(
      '[data-testid="provider-table-loading"]',
    );
    expect(loading?.getAttribute('aria-busy')).toBe('true');
    expect(element.querySelector('table')).toBeNull();
  });

  it('shows the error with a Retry output', () => {
    render({ state: 'error', errorMessage: 'The list could not be read.' });
    const retries: void[] = [];
    component.retryRequested.subscribe(() => retries.push(undefined));
    const error = element.querySelector('[data-testid="provider-table-error"]');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('The list could not be read.');
    (
      element.querySelector(
        '[data-testid="provider-table-retry"]',
      ) as HTMLButtonElement
    ).click();
    expect(retries).toHaveLength(1);
  });

  it('shows the empty state with its call to action', () => {
    render({
      rows: [],
      emptyTitle: 'No servers match these filters',
      emptyActionLabel: 'Clear filters',
    });
    const actions: void[] = [];
    component.emptyActionRequested.subscribe(() => actions.push(undefined));
    expect(
      element.querySelector('[data-testid="provider-table-empty"]')
        ?.textContent,
    ).toContain('No servers match these filters');
    (
      element.querySelector(
        '[data-testid="provider-table-empty-action"]',
      ) as HTMLButtonElement
    ).click();
    expect(actions).toHaveLength(1);
  });

  it('omits the empty-state button without a label', () => {
    render({ rows: [] });
    expect(
      element.querySelector('[data-testid="provider-table-empty-action"]'),
    ).toBeNull();
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'provider-table.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
