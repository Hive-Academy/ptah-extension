/**
 * ProviderCardListComponent specs (plan C8 `ProviderCardList`, Task 10.1).
 *
 * The compact equivalent of the table: a `<ul role="list">` of cards with the
 * same checkbox, lock and output rules, and no sort control.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { ProviderRow } from '../data/provider-row';
import { ProviderCardListComponent } from './provider-card-list.component';

jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

function row(overrides: Partial<ProviderRow> & { ref: string }): ProviderRow {
  const key = overrides.ref.split(':')[1] ?? overrides.ref;
  return {
    serverKey: key,
    kind: 'config',
    title: key,
    brand: null,
    origin: 'harness-config',
    originLabel: 'Config file',
    targets: [
      { target: 'vscode', label: 'VS Code', via: 'configured' },
      { target: 'claude', label: 'Claude Code', via: 'configured' },
      { target: 'cursor', label: 'Cursor', via: 'configured' },
      { target: 'codex', label: 'Codex CLI', via: 'configured' },
    ],
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

const GITHUB = row({ ref: 'harness-config:github' });
const SMITHERY = row({
  ref: 'smithery:exa',
  kind: 'connection',
  origin: 'smithery',
  originLabel: 'Smithery',
  targets: [],
  status: 'needs-input',
  statusSource: 'smithery',
  removal: { kind: 'disconnect' },
});
const BLOCKED = row({
  ref: 'claude-user:sentry',
  origin: 'claude-user',
  originLabel: 'Claude CLI',
  removal: { kind: 'blocked', reason: 'Owned by the Claude CLI.' },
});
const CONNECTOR = row({
  ref: 'claude-connector:gmail',
  kind: 'account-connector',
  origin: 'claude-connector',
  originLabel: 'Claude account',
  targets: [],
  removal: { kind: 'manage-link', reason: 'Managed in claude.ai.' },
});

describe('ProviderCardListComponent', () => {
  let fixture: ComponentFixture<ProviderCardListComponent>;
  let component: ProviderCardListComponent;
  let element: HTMLElement;

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(ProviderCardListComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('rows', [
      GITHUB,
      SMITHERY,
      BLOCKED,
      CONNECTOR,
    ]);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const cardOf = (ref: string): HTMLElement =>
    element.querySelector(
      `[data-testid="provider-card"][data-ref="${ref}"]`,
    ) as HTMLElement;
  const checkboxOf = (ref: string): HTMLInputElement =>
    cardOf(ref).querySelector(
      '[data-testid="provider-card-checkbox"]',
    ) as HTMLInputElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProviderCardListComponent] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is a <ul role="list"> of cards with an accessible name', () => {
    render({ label: 'Installed servers' });
    const list = element.querySelector('ul');
    expect(list?.getAttribute('role')).toBe('list');
    expect(list?.getAttribute('aria-label')).toBe('Installed servers');
    expect(list?.querySelectorAll(':scope > li')).toHaveLength(4);
    expect(element.querySelector('table')).toBeNull();
  });

  it('has no sort control and no "Last used" text', () => {
    render();
    expect(element.querySelector('[aria-sort]')).toBeNull();
    expect(element.textContent).not.toMatch(/last used/i);
  });

  it('names checkboxes "Select <name>" and disables locked rows with a reason', () => {
    render();
    expect(checkboxOf(GITHUB.ref).getAttribute('aria-label')).toBe(
      'Select github',
    );
    expect(checkboxOf(BLOCKED.ref).disabled).toBe(true);
    expect(checkboxOf(BLOCKED.ref).getAttribute('aria-label')).toContain(
      "can't be selected",
    );
    expect(checkboxOf(CONNECTOR.ref).disabled).toBe(true);
    expect(checkboxOf(CONNECTOR.ref).getAttribute('aria-label')).toContain(
      'claude.ai account',
    );
  });

  it('emits the selection on a checkbox change', () => {
    render();
    const emitted: string[][] = [];
    component.selectionChange.subscribe((set) => emitted.push([...set]));
    const box = checkboxOf(SMITHERY.ref);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([[SMITHERY.ref]]);
  });

  it('emits open and remove, and shows the lock badge for locked rows', () => {
    render();
    const opened: string[] = [];
    const removed: string[] = [];
    component.openRequested.subscribe((r) => opened.push(r.ref));
    component.removeRequested.subscribe((r) => removed.push(r.ref));
    (
      cardOf(GITHUB.ref).querySelector(
        '[data-testid="provider-card-open"]',
      ) as HTMLButtonElement
    ).click();
    (
      cardOf(SMITHERY.ref).querySelector(
        '[data-testid="provider-card-remove"]',
      ) as HTMLButtonElement
    ).click();
    expect(opened).toEqual([GITHUB.ref]);
    expect(removed).toEqual([SMITHERY.ref]);
    for (const locked of [BLOCKED, CONNECTOR]) {
      expect(
        cardOf(locked.ref).querySelector('ptah-removal-lock-badge'),
      ).not.toBeNull();
      expect(
        cardOf(locked.ref).querySelector(
          '[data-testid="provider-card-remove"]',
        ),
      ).toBeNull();
    }
  });

  it('collapses targets past three into "+N" and shows Ptah sessions for connections', () => {
    render();
    expect(
      cardOf(GITHUB.ref)
        .querySelector('[data-testid="target-marks-overflow"]')
        ?.textContent?.trim(),
    ).toBe('+1');
    expect(
      cardOf(SMITHERY.ref)
        .querySelector('[data-testid="provider-card-session-targets"]')
        ?.textContent?.trim(),
    ).toBe('Ptah sessions');
  });

  it('marks the active card', () => {
    render({ activeRef: SMITHERY.ref });
    expect(cardOf(SMITHERY.ref).getAttribute('aria-current')).toBe('true');
    expect(cardOf(SMITHERY.ref).className).toContain('border-primary/60');
    expect(cardOf(GITHUB.ref).getAttribute('aria-current')).toBeNull();
  });

  it('renders loading, error with Retry, and empty with its action', () => {
    render({ state: 'loading' });
    expect(
      element
        .querySelector('[data-testid="provider-cards-loading"]')
        ?.getAttribute('aria-busy'),
    ).toBe('true');

    fixture.componentRef.setInput('state', 'error');
    fixture.detectChanges();
    const retries: void[] = [];
    component.retryRequested.subscribe(() => retries.push(undefined));
    (
      element.querySelector(
        '[data-testid="provider-cards-retry"]',
      ) as HTMLButtonElement
    ).click();
    expect(retries).toHaveLength(1);

    fixture.componentRef.setInput('state', 'ready');
    fixture.componentRef.setInput('rows', []);
    fixture.componentRef.setInput('emptyActionLabel', 'Browse sources');
    fixture.detectChanges();
    const actions: void[] = [];
    component.emptyActionRequested.subscribe(() => actions.push(undefined));
    (
      element.querySelector(
        '[data-testid="provider-cards-empty-action"]',
      ) as HTMLButtonElement
    ).click();
    expect(actions).toHaveLength(1);
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'provider-card-list.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
