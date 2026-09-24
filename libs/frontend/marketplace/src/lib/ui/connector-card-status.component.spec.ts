/** ConnectorCardStatusComponent specs: the [card-status] content of a connector card. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PTAH_CONNECTORS, type PtahConnector } from '@ptah-extension/shared';

import {
  connectorCardState,
  type ConnectorCardInput,
  type ConnectorCardState,
} from './connector-card-state';
import { ConnectorCardStatusComponent } from './connector-card-status.component';

function connectorById(id: string): PtahConnector {
  const found = PTAH_CONNECTORS.find((c) => c.id === id);
  if (!found) throw new Error(`Catalog entry '${id}' is missing`);
  return found;
}

const SENTRY = connectorById('sentry'); // oauth-dcr, devops
const HUBSPOT_SMITHERY = connectorById('hubspot-smithery'); // smithery

const input = (
  overrides: Partial<ConnectorCardInput> = {},
): ConnectorCardInput => ({
  status: 'not-connected',
  busy: false,
  polling: false,
  ...overrides,
});

@Component({
  standalone: true,
  imports: [ConnectorCardStatusComponent],
  template: `
    <ptah-connector-card-status
      [card]="card()"
      [smitheryKeyLink]="keyLink()"
      (retry)="retries = retries + 1"
      (dismissError)="dismissals = dismissals + 1"
    />
  `,
})
class HostComponent {
  public readonly card = signal<ConnectorCardState>(
    connectorCardState(SENTRY, input()),
  );
  public readonly keyLink = signal<readonly string[] | null>(null);
  public retries = 0;
  public dismissals = 0;
}

describe('ConnectorCardStatusComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const q = (testId: string): HTMLElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="${testId}"]`,
    );
  const show = (
    connector: PtahConnector,
    overrides: Partial<ConnectorCardInput>,
  ): void => {
    host.card.set(connectorCardState(connector, input(overrides)));
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders the pill, "managed outside Ptah" and the reason', () => {
    show(HUBSPOT_SMITHERY, {
      status: 'error',
      detail: 'Smithery reported an error.',
      managedElsewhere: true,
    });
    expect(q('status-pill')?.getAttribute('data-status')).toBe('failed');
    expect(q('connector-card-managed')?.textContent).toContain(
      'Managed outside Ptah',
    );
    expect(q('connector-card-detail')?.textContent).toContain(
      'Smithery reported an error.',
    );
  });

  it('renders the in-flight line as a status', () => {
    show(SENTRY, { busy: true, polling: true });
    const activity = q('connector-card-activity');
    expect(activity?.getAttribute('role')).toBe('status');
    expect(activity?.getAttribute('data-activity')).toBe('polling');
  });

  it('renders a timed-out setup whose Retry emits', () => {
    show(HUBSPOT_SMITHERY, { status: 'needs-auth', timedOut: true });
    expect(q('connector-card-timeout')?.textContent).toContain(
      'not confirmed within 5 minutes',
    );
    q('connector-card-timeout-retry')?.click();
    expect(host.retries).toBe(1);
  });

  it('draws the Smithery key link only when the host passes one', () => {
    show(HUBSPOT_SMITHERY, { smitheryUnavailable: 'No key' });
    expect(q('connector-card-smithery-key')).toBeNull();
    host.keyLink.set(['/', 'marketplace', 'servers', 'smithery']);
    fixture.detectChanges();
    expect(q('connector-card-smithery-key')?.getAttribute('href')).toBe(
      '/marketplace/servers/smithery',
    );
  });

  it('renders the action error as an alert whose Dismiss emits', () => {
    show(SENTRY, { error: 'Consent was denied' });
    const alert = q('connector-card-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('Consent was denied');
    q('connector-card-error-dismiss')?.click();
    expect(host.dismissals).toBe(1);
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'connector-card-status.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
