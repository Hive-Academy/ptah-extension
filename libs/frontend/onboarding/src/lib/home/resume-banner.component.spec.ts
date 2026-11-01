import { TestBed } from '@angular/core/testing';
import { ResumeBannerComponent } from './resume-banner.component';

describe('ResumeBannerComponent', () => {
  it('shows supplied run facts and emits Resume', () => {
    TestBed.configureTestingModule({ imports: [ResumeBannerComponent] });
    const fixture = TestBed.createComponent(ResumeBannerComponent);
    fixture.componentRef.setInput('title', 'Agent generation for project');
    fixture.componentRef.setInput('detail', '2 agents written');
    const resume = jest.fn();
    fixture.componentInstance.resumeRequested.subscribe(resume);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('2 agents written');
    expect(el.textContent).toContain('Interrupted');
    (el.querySelector('button') as HTMLButtonElement).click();
    expect(resume).toHaveBeenCalledTimes(1);
  });
});
