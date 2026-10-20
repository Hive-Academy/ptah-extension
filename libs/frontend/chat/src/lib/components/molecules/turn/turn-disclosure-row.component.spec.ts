import { TestBed } from '@angular/core/testing';
import { TurnDisclosureRowComponent } from './turn-disclosure-row.component';

describe('TurnDisclosureRowComponent', () => {
  it('keeps the main-chat defaults unchanged', () => {
    TestBed.configureTestingModule({ imports: [TurnDisclosureRowComponent] });
    const fixture = TestBed.createComponent(TurnDisclosureRowComponent);
    fixture.componentRef.setInput('label', 'Worked for 4s');
    fixture.componentRef.setInput('toolCount', 2);
    fixture.componentRef.setInput('filesChanged', 1);
    fixture.componentRef.setInput('controlsId', 'work-log');
    fixture.detectChanges();
    const row: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(row.getAttribute('aria-label')).toBe('Worked for 4s, 2 tools, 1 file');
    expect(row.getAttribute('aria-controls')).toBe('work-log');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('[data-test="turn-disclosure-meta"]').textContent).toBe('2 tools · 1 file');
    expect(fixture.componentInstance.extraMeta()).toEqual([]);
    expect(fixture.componentInstance.metaTone()).toBe('muted');
  });
});
