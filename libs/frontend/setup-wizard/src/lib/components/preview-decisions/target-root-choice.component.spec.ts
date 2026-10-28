import { ComponentFixture, TestBed } from '@angular/core/testing';
import type {
  GenerationTargetChoice,
  GenerationTargetInfo,
} from '@ptah-extension/shared';
import { TargetRootChoiceComponent } from './target-root-choice.component';

const TARGET: GenerationTargetInfo = {
  harnessRoot: 'D:/work/acme',
  openedFolder: 'D:/work/acme/packages/api',
  chosen: 'harness-root',
  openedIsHarnessRoot: false,
};

describe('TargetRootChoiceComponent', () => {
  let fixture: ComponentFixture<TargetRootChoiceComponent>;
  let emitted: GenerationTargetChoice[];

  function create(
    inputs: Partial<{
      target: GenerationTargetInfo;
      selected: GenerationTargetChoice;
      isElectron: boolean;
      reloading: boolean;
    }> = {},
  ): void {
    fixture = TestBed.createComponent(TargetRootChoiceComponent);
    emitted = [];
    fixture.componentInstance.targetChange.subscribe((value) =>
      emitted.push(value),
    );
    fixture.componentRef.setInput('target', inputs.target ?? TARGET);
    for (const key of ['selected', 'isElectron', 'reloading'] as const) {
      if (inputs[key] !== undefined)
        fixture.componentRef.setInput(key, inputs[key]);
    }
    fixture.detectChanges();
  }

  const query = (testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const root = (): HTMLButtonElement =>
    query('target-root') as HTMLButtonElement;
  const opened = (): HTMLButtonElement =>
    query('target-opened') as HTMLButtonElement;

  it('defaults to the project root with the Electron helper and no warning', () => {
    create();
    const group = query('target-radiogroup') as HTMLElement;
    const heading = fixture.nativeElement.querySelector(
      `#${group.getAttribute('aria-labelledby')}`,
    ) as HTMLElement;
    expect(heading.textContent?.trim()).toBe(
      'Where should the agents be written?',
    );
    expect(root().getAttribute('aria-checked')).toBe('true');
    expect(root().tabIndex).toBe(0);
    expect(opened().tabIndex).toBe(-1);
    expect(root().textContent).toContain('Project root (recommended)');
    expect(root().textContent).toContain('Default');
    expect(root().textContent).toContain('D:/work/acme/.claude/agents');
    expect(root().textContent).toContain(
      'The Library, other CLIs and model settings read this folder.',
    );
    expect(opened().textContent).toContain('Opened folder only');
    expect(opened().textContent).toContain(
      'D:/work/acme/packages/api/.claude/agents',
    );
    expect(query('opened-folder-warning')).toBeNull();
    expect(query('writing-to')?.textContent).toContain(
      'D:/work/acme/.claude/agents',
    );
  });

  it('click and arrows emit the other target and move focus', () => {
    create();
    opened().click();
    expect(emitted).toEqual(['opened-folder']);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    root().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(emitted).toEqual(['opened-folder', 'opened-folder']);
    expect(document.activeElement).toBe(opened());
    root().click();
    expect(emitted).toHaveLength(2);
  });

  it('opened folder shows the solid warning per host', () => {
    create({ selected: 'opened-folder' });
    const warning = query('opened-folder-warning') as HTMLElement;
    expect(warning.getAttribute('role')).toBe('alert');
    expect(warning.className).toContain('bg-warning');
    expect(warning.textContent?.trim()).toBe(
      'Agents written to the opened folder will not reach other CLIs and will not appear in the Library.',
    );
    expect(query('writing-to')?.textContent).toContain(
      'D:/work/acme/packages/api/.claude/agents',
    );

    create({ selected: 'opened-folder', isElectron: false });
    expect(query('opened-folder-warning')?.textContent?.trim()).toBe(
      'Agents written to the opened folder will not reach other CLIs.',
    );
    expect(root().textContent).toContain(
      'Other CLIs and model settings read this folder.',
    );
  });

  it('no choice when the opened folder is the project root', () => {
    create({
      target: { ...TARGET, openedFolder: TARGET.harnessRoot, openedIsHarnessRoot: true },
    });
    expect(query('target-radiogroup')).toBeNull();
    expect(query('writing-to')?.textContent).toContain(
      'D:/work/acme/.claude/agents',
    );
  });

  it('reloading disables the cards and marks the group busy', () => {
    create({ reloading: true });
    expect(query('target-radiogroup')?.getAttribute('aria-busy')).toBe('true');
    expect(root().disabled).toBe(true);
    expect(opened().disabled).toBe(true);
  });
});
