import { TestBed } from '@angular/core/testing';
import type { AgentModelPreview } from '@ptah-extension/shared';
import { ModelOriginNoteComponent } from './model-origin-note.component';

function render(model: AgentModelPreview, isElectron = true): HTMLElement {
  const fixture = TestBed.createComponent(ModelOriginNoteComponent);
  fixture.componentRef.setInput('model', model);
  fixture.componentRef.setInput('isElectron', isElectron);
  fixture.detectChanges();
  return fixture.nativeElement.querySelector(
    '[data-testid="model-origin-note"]',
  ) as HTMLElement;
}

const textOf = (element: HTMLElement): string =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ModelOriginNoteComponent', () => {
  it('applied setting, Electron and VS Code', () => {
    const electron = render({ value: 'opus', origin: 'workspace' });
    expect(textOf(electron)).toBe(
      'Agent model: opus - from your Library setting (workspace).',
    );
    expect(electron.querySelector('strong')?.textContent).toBe('opus');
    expect(textOf(render({ value: 'opus', origin: 'machine' }, false))).toBe(
      'Agent model: opus - from your saved agent-model setting (machine).',
    );
  });

  it('ignored override, Electron and VS Code', () => {
    const model: AgentModelPreview = {
      value: 'sonnet',
      origin: 'template',
      ignoredOverride: 'gpt-5',
    };
    const electron = render(model);
    expect(textOf(electron)).toBe(
      'Agent model: sonnet - the Library setting gpt-5 is not a Claude model and will be ignored. Using the template model.',
    );
    expect(electron.querySelector('code')?.textContent).toBe('gpt-5');
    expect(textOf(render(model, false))).toBe(
      'Agent model: sonnet - the saved agent-model setting gpt-5 is not a Claude model and will be ignored. Using the template model.',
    );
  });

  it('template model and no model line', () => {
    expect(textOf(render({ value: 'sonnet', origin: 'template' }))).toBe(
      'Agent model: sonnet (template).',
    );
    expect(textOf(render({ value: null, origin: 'none' }))).toBe(
      'Agent model: no model line (the template declares none).',
    );
  });
});
