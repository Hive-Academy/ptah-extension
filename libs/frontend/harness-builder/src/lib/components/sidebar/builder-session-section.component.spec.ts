import { TestBed } from '@angular/core/testing';
import { BuilderSessionSectionComponent } from './builder-session-section.component';

describe('BuilderSessionSectionComponent', () => {
  it('shows the missing context placeholder without a percent sign', () => {
    TestBed.configureTestingModule({
      imports: [BuilderSessionSectionComponent],
    });
    const fixture = TestBed.createComponent(BuilderSessionSectionComponent);
    fixture.componentRef.setInput('initialized', true);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Context — · Cost unavailable',
    );
  });
});
