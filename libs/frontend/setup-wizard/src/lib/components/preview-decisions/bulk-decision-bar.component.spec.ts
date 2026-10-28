import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FileDecision } from '@ptah-extension/shared';
import { BulkDecisionBarComponent } from './bulk-decision-bar.component';
import {
  nextSnapshot,
  setAllDecisions,
  type DecisionRow,
} from './preview-decisions.state';

function row(
  id: string,
  state: DecisionRow['state'],
  kind: DecisionRow['kind'] = 'wizard',
): DecisionRow {
  return {
    id,
    path: id,
    kind,
    state,
    revision: `rev-${id}`,
    decision: 'keep',
    forcedKeep: state === 'unreadable',
    unchangedSinceWizardWrite: false,
    libraryCopyEdited: false,
  };
}

describe('BulkDecisionBarComponent', () => {
  let fixture: ComponentFixture<BulkDecisionBarComponent>;
  let emitted: FileDecision[];

  function create(rows: DecisionRow[], kind: 'wizard' | 'pack'): void {
    fixture = TestBed.createComponent(BulkDecisionBarComponent);
    emitted = [];
    fixture.componentInstance.applyAll.subscribe((value) =>
      emitted.push(value),
    );
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('kind', kind);
    fixture.detectChanges();
  }

  const bar = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('[data-testid="bulk-decision-bar"]');

  it('is hidden when no row can be replaced', () => {
    create([row('a', 'new'), row('b', 'unreadable')], 'wizard');
    expect(bar()).toBeNull();
  });

  it('counts only controllable rows and labels the group', () => {
    create(
      [
        row('a', 'exists'),
        row('b', 'exists'),
        row('c', 'unreadable'),
        row('d', 'new'),
      ],
      'wizard',
    );
    expect(bar()?.getAttribute('role')).toBe('group');
    expect(bar()?.getAttribute('aria-label')).toBe(
      'Apply to all differing files',
    );
    expect(bar()?.textContent).toContain('2 existing files');
  });

  it('pack label and emits Keep all / Replace all', () => {
    create([row('a', 'differs', 'pack'), row('b', 'identical', 'pack')], 'pack');
    expect(bar()?.textContent).toContain('1 file can be replaced');
    (
      fixture.nativeElement.querySelector(
        '[data-testid="bulk-replace"]',
      ) as HTMLButtonElement
    ).click();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="bulk-keep"]',
      ) as HTMLButtonElement
    ).click();
    expect(emitted).toEqual(['replace', 'keep']);
  });

  it('applied through the state helper, Replace all skips forced-keep rows', () => {
    const rows = [row('a', 'exists'), row('c', 'unreadable')];
    create(rows, 'wizard');
    (
      fixture.nativeElement.querySelector(
        '[data-testid="bulk-replace"]',
      ) as HTMLButtonElement
    ).click();
    const applied = setAllDecisions(
      nextSnapshot(null, rows, 'harness-root'),
      emitted[0],
    );
    expect(applied.rows.map((value) => value.decision)).toEqual([
      'replace',
      'keep',
    ]);
  });

  it('disables both buttons while reloading', () => {
    create([row('a', 'exists')], 'wizard');
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const buttons = Array.from(
      fixture.nativeElement.querySelectorAll('button'),
    ) as HTMLButtonElement[];
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });
});
