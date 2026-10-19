import { TestBed } from '@angular/core/testing';
import { AgentSteerInputComponent } from './agent-steer-input.component';

describe('AgentSteerInputComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  function render(clearOnSubmit: boolean) {
    const fixture = TestBed.createComponent(AgentSteerInputComponent);
    fixture.componentRef.setInput('steerable', true);
    fixture.componentRef.setInput('clearOnSubmit', clearOnSubmit);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const field = host.querySelector('input') as HTMLInputElement;
    return { fixture, field };
  }

  it('emits the trimmed text and clears the field by default', () => {
    const { fixture, field } = render(true);
    const sent: string[] = [];
    fixture.componentInstance.steer.subscribe((text) => sent.push(text));
    field.value = '  hello  ';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(sent).toEqual(['hello']);
    expect(field.value).toBe('');
  });

  it('keeps the draft without clearOnSubmit until the parent clears it', () => {
    const { fixture, field } = render(false);
    field.value = 'keep me';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(field.value).toBe('keep me');
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();
    expect(field.value).toBe('');
  });
});
