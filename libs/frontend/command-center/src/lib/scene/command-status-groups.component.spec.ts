import { TestBed } from '@angular/core/testing';
import { CommandStatusGroupsComponent } from './command-status-groups.component';

describe('CommandStatusGroupsComponent', () => {
  it('renders all four count categories in order without focus stops', () => {
    TestBed.configureTestingModule({ imports: [CommandStatusGroupsComponent] });
    const fixture = TestBed.createComponent(CommandStatusGroupsComponent);
    fixture.componentRef.setInput('counts', { inProgress: 2, waiting: 3, finished: 5, other: 7 });
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('[data-status-card]') as NodeListOf<HTMLElement>;
    expect(Array.from(cards, (card) => card.dataset['statusCard'])).toEqual([
      'inProgress', 'waiting', 'finished', 'other',
    ]);
    expect(Array.from(cards, (card) => card.querySelector('.metric')?.textContent?.trim())).toEqual([
      '2 active', '3 input', '5 done', '7 other',
    ]);
    expect(cards[3].textContent).toContain('failed or cancelled');
    expect(fixture.nativeElement.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
  });

  it('defaults to zero counts', () => {
    TestBed.configureTestingModule({ imports: [CommandStatusGroupsComponent] });
    const fixture = TestBed.createComponent(CommandStatusGroupsComponent);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('[data-status-card]') as NodeListOf<HTMLElement>;
    expect(Array.from(cards, (card) => card.querySelector('.metric')?.textContent?.trim())).toEqual([
      '0 active', '0 input', '0 done', '0 other',
    ]);
  });
});
