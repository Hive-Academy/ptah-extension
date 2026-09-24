/**
 * BulkActionBarComponent specs (plan C8, Task 9.3).
 *
 * A "Bulk actions" region with a polite live count, the action and clear
 * buttons, and the outcome of the last run (N removed, M failed with reasons)
 * rendered from the `result` input.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  BulkActionBarComponent,
  bulkResultSummary,
  bulkSelectionLabel,
  type BulkActionResult,
} from './bulk-action-bar.component';

const PARTIAL: BulkActionResult = {
  removed: 2,
  failed: [
    { name: 'sentry', reason: 'Owned by the Claude CLI' },
    { name: 'linear', reason: 'Config file is read-only' },
  ],
};

describe('BulkActionBarComponent', () => {
  let fixture: ComponentFixture<BulkActionBarComponent>;
  let element: HTMLElement;

  function render(inputs: {
    selectedCount: number;
    busy?: boolean;
    result?: BulkActionResult | null;
  }): void {
    fixture = TestBed.createComponent(BulkActionBarComponent);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  function set(name: string, value: unknown): void {
    fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => element.querySelector<T>(`[data-testid="${id}"]`);

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BulkActionBarComponent] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is a region named "Bulk actions"', () => {
    render({ selectedCount: 3 });
    const region = byTestId('bulk-action-bar');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-label')).toBe('Bulk actions');
  });

  it('announces the count in a polite live region', () => {
    render({ selectedCount: 3 });
    const count = byTestId('bulk-count');
    expect(count?.getAttribute('aria-live')).toBe('polite');
    expect(count?.textContent?.trim()).toBe('3 selected');
    set('selectedCount', 5);
    expect(count?.textContent?.trim()).toBe('5 selected');
    expect(byTestId('bulk-count')).toBe(count);
  });

  it('keeps the live count in the DOM, visually hidden, while idle', () => {
    render({ selectedCount: 0 });
    const count = byTestId('bulk-count');
    expect(count).not.toBeNull();
    expect(count?.classList).toContain('sr-only');
    expect(count?.textContent?.trim()).toBe('No items selected');
    expect(byTestId('bulk-action')).toBeNull();
    expect(byTestId('bulk-action-bar')?.getAttribute('data-idle')).toBe('true');

    set('selectedCount', 1);
    expect(byTestId('bulk-count')).toBe(count);
    expect(count?.classList).not.toContain('sr-only');
  });

  it('emits the action and clear requests', () => {
    render({ selectedCount: 2 });
    const action = jest.fn();
    const clear = jest.fn();
    fixture.componentInstance.actionRequested.subscribe(action);
    fixture.componentInstance.clearRequested.subscribe(clear);
    byTestId<HTMLButtonElement>('bulk-action')?.click();
    byTestId<HTMLButtonElement>('bulk-clear')?.click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(byTestId('bulk-action')?.textContent?.trim()).toBe(
      'Remove selected',
    );
  });

  it('disables both buttons and shows the busy label while running', () => {
    render({ selectedCount: 2, busy: true });
    const action = byTestId<HTMLButtonElement>('bulk-action');
    expect(action?.disabled).toBe(true);
    expect(action?.getAttribute('aria-busy')).toBe('true');
    expect(action?.textContent?.trim()).toBe('Removing…');
    expect(byTestId<HTMLButtonElement>('bulk-clear')?.disabled).toBe(true);
  });

  it('renders a partial failure: N removed, M failed with reasons', () => {
    render({ selectedCount: 0, result: PARTIAL });
    expect(byTestId('bulk-result-summary')?.textContent?.trim()).toBe(
      '2 removed, 2 failed',
    );
    const failures = Array.from(
      element.querySelectorAll('[data-testid="bulk-failures"] li'),
    ).map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(failures).toEqual([
      'sentry — Owned by the Claude CLI',
      'linear — Config file is read-only',
    ]);
    expect(byTestId('bulk-action-bar')?.getAttribute('data-idle')).toBe(
      'false',
    );
  });

  it('renders a full success without a failure list', () => {
    render({ selectedCount: 0, result: { removed: 4, failed: [] } });
    expect(byTestId('bulk-result-summary')?.textContent?.trim()).toBe(
      '4 removed',
    );
    expect(byTestId('bulk-failures')).toBeNull();
  });

  it('puts the outcome inside a live region that exists before it', () => {
    render({ selectedCount: 2 });
    const region = byTestId('bulk-result-region');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(byTestId('bulk-result')).toBeNull();
    set('result', PARTIAL);
    expect(byTestId('bulk-result-region')).toBe(region);
    expect(region?.querySelector('[data-testid="bulk-result"]')).not.toBeNull();
  });

  it('emits resultDismissed from Dismiss', () => {
    render({ selectedCount: 0, result: PARTIAL });
    const dismissed = jest.fn();
    fixture.componentInstance.resultDismissed.subscribe(dismissed);
    byTestId<HTMLButtonElement>('bulk-result-dismiss')?.click();
    expect(dismissed).toHaveBeenCalledTimes(1);
  });

  describe('labels', () => {
    it.each<[number, string]>([
      [0, 'No items selected'],
      [1, '1 selected'],
      [12, '12 selected'],
    ])('bulkSelectionLabel(%i) is "%s"', (count, label) => {
      expect(bulkSelectionLabel(count)).toBe(label);
    });

    it.each<[BulkActionResult, string]>([
      [{ removed: 3, failed: [] }, '3 removed'],
      [{ removed: 0, failed: [{ name: 'a', reason: 'b' }] }, '1 failed'],
      [PARTIAL, '2 removed, 2 failed'],
      [{ removed: 0, failed: [] }, 'Nothing removed'],
    ])('bulkResultSummary → "%s"', (result, summary) => {
      expect(bulkResultSummary(result)).toBe(summary);
    });
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'bulk-action-bar.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
