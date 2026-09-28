/** ConnectorCardActionsComponent specs: the [card-actions] content of a connector card. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PTAH_CONNECTORS, type PtahConnector } from '@ptah-extension/shared';

import {
  connectorCardState,
  type ConnectorCardAction,
  type ConnectorCardInput,
  type ConnectorCardState,
} from './connector-card-state';
import { ConnectorCardActionsComponent } from './connector-card-actions.component';

function connectorById(id: string): PtahConnector {
  const found = PTAH_CONNECTORS.find((c) => c.id === id);
  if (!found) throw new Error(`Catalog entry '${id}' is missing`);
  return found;
}

const SENTRY = connectorById('sentry'); // oauth-dcr, devops
const GITHUB = connectorById('github'); // oauth-app

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
  imports: [ConnectorCardActionsComponent],
  template: `
    <ptah-connector-card-actions
      [card]="card()"
      [size]="size()"
      (action)="actions.push($event)"
    />
  `,
})
class HostComponent {
  public readonly card = signal<ConnectorCardState>(
    connectorCardState(SENTRY, input()),
  );
  public readonly size = signal<'xs' | 'sm'>('xs');
  public readonly actions: ConnectorCardAction[] = [];
}

describe('ConnectorCardActionsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const button = (action: string): HTMLButtonElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector(
      `[data-action="${action}"]`,
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

  it('labels Connect "Set up" for an oauth-app connector', () => {
    show(SENTRY, {});
    expect(button('connect')?.getAttribute('aria-label')).toBe(
      'Connect Sentry',
    );
    show(GITHUB, {});
    expect(button('connect')?.textContent?.trim()).toBe('Set up');
  });

  it('emits the pressed action, and nothing while locked', () => {
    show(SENTRY, { status: 'needs-auth' });
    button('authorize')?.click();
    button('disconnect')?.click();
    expect(host.actions).toEqual(['authorize', 'disconnect']);

    show(SENTRY, { status: 'needs-auth', busy: true });
    expect(button('authorize')?.disabled).toBe(true);
    button('authorize')?.dispatchEvent(new MouseEvent('click'));
    expect(host.actions).toHaveLength(2);
  });

  it('uses small buttons in the detail size', () => {
    host.size.set('sm');
    fixture.detectChanges();
    expect(button('connect')?.className).toContain('btn-sm');
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'connector-card-actions.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
