import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FileDecision } from '@ptah-extension/shared';
import { KeepReplaceControlComponent } from './keep-replace-control.component';

describe('KeepReplaceControlComponent', () => {
  let fixture: ComponentFixture<KeepReplaceControlComponent>;
  let emitted: FileDecision[];

  function create(
    inputs: Partial<{
      decision: FileDecision;
      forcedKeep: boolean;
      disabled: boolean;
      kind: 'wizard' | 'pack';
      describedBy: string | null;
    }> = {},
  ): void {
    fixture = TestBed.createComponent(KeepReplaceControlComponent);
    emitted = [];
    fixture.componentInstance.decisionChange.subscribe((value) =>
      emitted.push(value),
    );
    fixture.componentRef.setInput('path', '.claude/agents/backend.md');
    fixture.componentRef.setInput('kind', inputs.kind ?? 'wizard');
    for (const key of [
      'decision',
      'forcedKeep',
      'disabled',
      'describedBy',
    ] as const) {
      if (inputs[key] !== undefined)
        fixture.componentRef.setInput(key, inputs[key]);
    }
    fixture.detectChanges();
  }

  const group = (): HTMLElement =>
    fixture.nativeElement.querySelector('[role="radiogroup"]');
  const keep = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('[data-testid="keep-segment"]');
  const replace = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('[data-testid="replace-segment"]');
  const key = (target: HTMLElement, name: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', {
      key: name,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };

  it('defaults to Keep with the accessible names and roving tabindex', () => {
    create();
    expect(group().getAttribute('aria-label')).toBe(
      'Keep or replace .claude/agents/backend.md',
    );
    expect(keep().getAttribute('role')).toBe('radio');
    expect(keep().getAttribute('aria-checked')).toBe('true');
    expect(keep().tabIndex).toBe(0);
    expect(keep().getAttribute('aria-label')).toBe(
      'Keep my file .claude/agents/backend.md',
    );
    expect(keep().textContent).toContain('Keep my file');
    expect(replace().getAttribute('aria-checked')).toBe('false');
    expect(replace().tabIndex).toBe(-1);
    expect(replace().getAttribute('aria-label')).toBe(
      'Replace .claude/agents/backend.md with generated version',
    );
    expect(replace().textContent).toContain('Replace with generated');
    expect(keep().className).toContain('bg-base-content');
    expect(keep().className).toContain('focus-visible:outline-offset-2');
  });

  it('uses the pack wording for pack rows', () => {
    create({ kind: 'pack' });
    expect(replace().textContent).toContain('Replace with pack version');
    expect(replace().getAttribute('aria-label')).toBe(
      'Replace .claude/agents/backend.md with pack version',
    );
  });

  it('click and arrows select; Space/Enter select the focused radio', () => {
    create();
    replace().click();
    expect(emitted).toEqual(['replace']);

    const arrow = key(keep(), 'ArrowRight');
    expect(arrow.defaultPrevented).toBe(true);
    expect(emitted).toEqual(['replace', 'replace']);
    expect(document.activeElement).toBe(replace());

    fixture.componentRef.setInput('decision', 'replace');
    fixture.detectChanges();
    expect(replace().tabIndex).toBe(0);
    expect(keep().tabIndex).toBe(-1);
    expect(replace().className).toContain('bg-warning');

    key(replace(), 'ArrowLeft');
    expect(emitted).toEqual(['replace', 'replace', 'keep']);
    expect(document.activeElement).toBe(keep());

    // The surface has not applied the Keep yet, so Replace is still checked.
    const space = key(keep(), ' ');
    expect(space.defaultPrevented).toBe(true);
    expect(emitted).toEqual(['replace', 'replace', 'keep', 'keep']);
    key(keep(), 'Enter');
    expect(emitted).toHaveLength(5);
    // Selecting the radio that is already checked emits nothing.
    key(replace(), 'Enter');
    expect(emitted).toHaveLength(5);
  });

  it('forced keep: Replace is aria-disabled, skipped by arrows, ignored by click and keys', () => {
    create({ forcedKeep: true, describedBy: 'note-1' });
    expect(replace().getAttribute('aria-disabled')).toBe('true');
    expect(replace().tabIndex).toBe(-1);
    expect(replace().disabled).toBe(false);
    expect(replace().getAttribute('aria-label')).toBe(
      'Replace .claude/agents/backend.md with generated version (not available: file could not be read)',
    );
    expect(group().getAttribute('aria-describedby')).toBe('note-1');
    replace().click();
    key(keep(), 'ArrowRight');
    key(replace(), 'Enter');
    expect(emitted).toEqual([]);
    expect(keep().tabIndex).toBe(0);
  });

  it('disabled while loading: no selection', () => {
    create({ disabled: true });
    expect(keep().disabled).toBe(true);
    expect(replace().disabled).toBe(true);
    key(keep(), 'ArrowRight');
    expect(emitted).toEqual([]);
  });
});
