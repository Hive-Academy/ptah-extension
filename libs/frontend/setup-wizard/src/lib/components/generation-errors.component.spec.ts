import { TestBed } from '@angular/core/testing';
import { GenerationErrorsComponent } from './generation-errors.component';

describe('GenerationErrorsComponent', () => {
  it('shows three errors before the disclosure', () => {
    TestBed.configureTestingModule({ imports: [GenerationErrorsComponent] });
    const fixture = TestBed.createComponent(GenerationErrorsComponent);
    fixture.componentRef.setInput('errors', ['a', 'b', 'c', 'd']);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('details').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('li').length).toBe(4);
    expect(
      fixture.nativeElement.querySelector('summary').textContent,
    ).toContain('1 more');
    expect(fixture.nativeElement.querySelectorAll('details li')).toHaveLength(
      1,
    );
  });
});
