/**
 * StatCardComponent specs (plan C8 `StatCard`, Task 10.2).
 *
 * `tabular-nums` value, a skeleton while loading, an error with a Retry
 * output, and no sparkline.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Server } from 'lucide-angular';

import { StatCardComponent } from './stat-card.component';

describe('StatCardComponent', () => {
  let fixture: ComponentFixture<StatCardComponent>;
  let component: StatCardComponent;
  let element: HTMLElement;

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(StatCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Apps & MCP servers');
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const byTestId = (id: string): HTMLElement | null =>
    element.querySelector(`[data-testid="${id}"]`);

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StatCardComponent] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is a group named by its label, with the value in tabular-nums', () => {
    render({ value: 12, unit: 'servers', subLine: '2 blocked removals' });
    const card = byTestId('stat-card');
    expect(card?.getAttribute('role')).toBe('group');
    const labelId = card?.getAttribute('aria-labelledby');
    expect(element.querySelector(`#${labelId}`)?.textContent?.trim()).toBe(
      'Apps & MCP servers',
    );
    const value = byTestId('stat-card-value');
    expect(value?.textContent?.trim()).toBe('12');
    expect(value?.classList).toContain('tabular-nums');
    expect(byTestId('stat-card-unit')?.textContent?.trim()).toBe('servers');
    expect(byTestId('stat-card-sub')?.textContent?.trim()).toBe(
      '2 blocked removals',
    );
  });

  it('shows a string figure as given', () => {
    render({ value: '3/12' });
    expect(byTestId('stat-card-value')?.textContent?.trim()).toBe('3/12');
  });

  it.each([null, '', '  ', Number.NaN])(
    'shows a dash and no unit for a missing value (%p)',
    (value) => {
      render({ value, unit: 'servers' });
      expect(byTestId('stat-card-value')?.textContent?.trim()).toBe('—');
      expect(byTestId('stat-card-unit')).toBeNull();
    },
  );

  it('draws a decorative icon in the chosen tone', () => {
    render({ icon: Server, tone: 'warning' });
    const icon = byTestId('stat-card-icon');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.classList).toContain('text-warning');
    expect(icon?.querySelector('lucide-angular')).not.toBeNull();
  });

  it('shows a skeleton and no value while loading', () => {
    render({ value: 5, state: 'loading' });
    expect(byTestId('stat-card')?.getAttribute('aria-busy')).toBe('true');
    expect(byTestId('stat-card-skeleton')).not.toBeNull();
    expect(byTestId('stat-card-value')).toBeNull();
  });

  it('shows the error and emits Retry', () => {
    render({ state: 'error', errorMessage: 'The server list is unavailable.' });
    const retries: void[] = [];
    component.retryRequested.subscribe(() => retries.push(undefined));
    expect(byTestId('stat-card-error')?.getAttribute('role')).toBe('alert');
    expect(byTestId('stat-card-error')?.textContent).toContain(
      'The server list is unavailable.',
    );
    const retry = byTestId('stat-card-retry') as HTMLButtonElement;
    expect(retry.getAttribute('aria-label')).toBe('Retry Apps & MCP servers');
    retry.click();
    expect(retries).toHaveLength(1);
    expect(byTestId('stat-card-value')).toBeNull();
  });

  it('falls back to a generic error line', () => {
    render({ state: 'error' });
    expect(byTestId('stat-card-error')?.textContent).toContain(
      'Could not load.',
    );
  });

  it('projects extra detail only in the ready state', () => {
    @Component({
      standalone: true,
      imports: [StatCardComponent],
      template: `
        <ptah-stat-card
          label="Harness health"
          [value]="'4/5'"
          [state]="state()"
        >
          <span data-testid="chips">chips</span>
        </ptah-stat-card>
      `,
    })
    class HostComponent {
      public readonly state = signal<'ready' | 'loading'>('ready');
    }
    const host = TestBed.createComponent(HostComponent);
    host.detectChanges();
    const root = host.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="chips"]')).not.toBeNull();
    host.componentInstance.state.set('loading');
    host.detectChanges();
    expect(root.querySelector('[data-testid="chips"]')).toBeNull();
  });

  it('has no sparkline', () => {
    render({ value: 3 });
    expect(
      element.querySelector('svg polyline, svg path[d*="L"], canvas'),
    ).toBeNull();
    const source = readFileSync(
      join(__dirname, 'stat-card.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/sparkline\s*=|polyline|<canvas/i);
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'stat-card.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
