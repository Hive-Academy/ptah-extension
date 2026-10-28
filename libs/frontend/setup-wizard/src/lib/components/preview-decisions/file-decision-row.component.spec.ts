import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeService } from '@ptah-extension/core';
import type { FileDecision } from '@ptah-extension/shared';
import { FileDecisionRowComponent } from './file-decision-row.component';
import type { DecisionRow } from './preview-decisions.state';

function row(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: 'backend',
    path: '.claude/agents/backend.md',
    kind: 'wizard',
    state: 'exists',
    revision: 'r1',
    decision: 'keep',
    forcedKeep: false,
    unchangedSinceWizardWrite: false,
    libraryCopyEdited: false,
    ...overrides,
  };
}

describe('FileDecisionRowComponent', () => {
  let fixture: ComponentFixture<FileDecisionRowComponent>;
  let emitted: FileDecision[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FileDecisionRowComponent],
      providers: [
        { provide: ThemeService, useValue: { isDarkMode: signal(true) } },
      ],
    });
  });

  function create(value: DecisionRow, isElectron = true): void {
    fixture = TestBed.createComponent(FileDecisionRowComponent);
    emitted = [];
    fixture.componentInstance.decisionChange.subscribe((decision) =>
      emitted.push(decision),
    );
    fixture.componentRef.setInput('row', value);
    fixture.componentRef.setInput('isElectron', isElectron);
    fixture.detectChanges();
  }

  const query = (selector: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(selector);
  const text = (): string =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('existing wizard file: badge, Keep control and "What changes"', () => {
    create(row());
    expect(query('[data-testid="file-state-badge"]')?.textContent).toBe(
      'Exists — may be replaced',
    );
    expect(query('ptah-keep-replace-control')).not.toBeNull();
    expect(
      query('[data-testid="keep-segment"]')?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(query('[data-testid="diff-toggle"]')?.textContent?.trim()).toBe(
      'What changes',
    );
  });

  it('forwards the decision from the control', () => {
    create(row());
    (query('[data-testid="replace-segment"]') as HTMLButtonElement).click();
    expect(emitted).toEqual(['replace']);
  });

  it('new and already-current files get no control', () => {
    create(row({ state: 'new' }));
    expect(query('ptah-keep-replace-control')).toBeNull();
    expect(text()).toContain('New');
    create(row({ kind: 'pack', state: 'identical' }));
    expect(query('ptah-keep-replace-control')).toBeNull();
    expect(text()).toContain('Already current');
  });

  it('unreadable: forced Keep explained and referenced, no diff', () => {
    create(row({ state: 'unreadable', forcedKeep: true }));
    const note = query('[data-testid="unreadable-note"]') as HTMLElement;
    expect(note.textContent?.trim()).toBe(
      'Ptah could not compare this file, so it is treated as different and will be kept. Replace is not available for it.',
    );
    expect(
      query('[role="radiogroup"]')?.getAttribute('aria-describedby'),
    ).toBe(note.id);
    expect(
      query('[data-testid="replace-segment"]')?.getAttribute('aria-disabled'),
    ).toBe('true');
    expect(query('ptah-diff-disclosure')).toBeNull();
    expect(text()).toContain('Could not read file');
  });

  it('shows the D10 note for a file unchanged since the wizard wrote it', () => {
    create(row({ unchangedSinceWizardWrite: true }));
    expect(
      query('[data-testid="unchanged-note"]')?.textContent?.trim(),
    ).toBe('Unchanged since the setup wizard wrote it');
  });

  it('Library-copy note only on Electron', () => {
    create(row({ libraryCopyEdited: true }), true);
    expect(query('[data-testid="library-note"]')?.textContent?.trim()).toBe(
      'Library copy has edits. If you replace, you will need to choose rebase or keep for it in the Library.',
    );
    create(row({ libraryCopyEdited: true }), false);
    expect(query('[data-testid="library-note"]')).toBeNull();
  });

  it('pack differs row uses the pack wording', () => {
    create(
      row({
        id: 'perf-tuner.md',
        path: 'perf-tuner.md',
        kind: 'pack',
        state: 'differs',
      }),
    );
    expect(text()).toContain('Differs from local file');
    expect(text()).toContain('Replace with pack version');
  });
});
