import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StatusCardComponent } from './status-card.component';

@Component({
  standalone: true,
  imports: [StatusCardComponent],
  template: `<ptah-status-card tone="run" label="Session status" [busy]="true">
    <span statusIcon aria-hidden="true">●</span>
    <span statusTitle>Working</span>
    <span statusSub>Reading your brief.</span>
    <span statusMeta>Turn 2</span>
    <button statusActions type="button">Review</button>
  </ptah-status-card>`,
})
class HostComponent {}

describe('StatusCardComponent', () => {
  it('marks the idle tone on the card', () => {
    TestBed.configureTestingModule({ imports: [StatusCardComponent] });
    const fixture = TestBed.createComponent(StatusCardComponent);
    fixture.componentRef.setInput('tone', 'idle');
    fixture.componentRef.setInput('label', 'Idle session');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('section')?.getAttribute('data-tone')).toBe('idle');
  });

  it('renders the tone, projected content, and one polite status without meta', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const card = el.querySelector('section') as HTMLElement;
    const status = card.querySelector('[role="status"]') as HTMLElement;
    expect(card.getAttribute('data-tone')).toBe('run');
    expect(card.getAttribute('aria-label')).toBe('Session status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent).toContain('Working');
    expect(status.textContent).toContain('Reading your brief.');
    expect(status.textContent).not.toContain('Turn 2');
    expect(card.querySelector('button')?.textContent).toBe('Review');
    expect(card.querySelector('.motion-reduce\\:animate-none')).not.toBeNull();
  });
});
