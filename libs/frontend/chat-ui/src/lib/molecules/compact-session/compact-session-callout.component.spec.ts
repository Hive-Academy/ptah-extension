import { TestBed } from '@angular/core/testing';
import { CompactSessionCalloutComponent } from './compact-session-callout.component';

describe(CompactSessionCalloutComponent.name, () => {
  it('keeps a fixed height and emits Answer for a question', () => {
    TestBed.configureTestingModule({
      imports: [CompactSessionCalloutComponent],
    });
    const fixture = TestBed.createComponent(CompactSessionCalloutComponent);
    const answer = jest.fn();
    fixture.componentInstance.answer.subscribe(answer);
    fixture.componentRef.setInput('callout', {
      kind: 'question',
      text: 'Which target?',
      moreCount: 1,
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="cs-callout-question"]')?.className,
    ).toContain('h-20');
    expect(root.textContent).toContain('+1 more');
    (root.querySelector('button') as HTMLButtonElement).click();
    expect(answer).toHaveBeenCalledTimes(1);
  });
});
