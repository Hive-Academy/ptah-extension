import { TestBed } from '@angular/core/testing';
import { EnhancedPromptsSummaryCardComponent } from './enhanced-prompts-summary-card.component';

describe('EnhancedPromptsSummaryCardComponent', () => {
  it('shows canonical section counts without legacy badges or Quality Guidance', () => {
    TestBed.configureTestingModule({ imports: [EnhancedPromptsSummaryCardComponent] });
    const fixture = TestBed.createComponent(EnhancedPromptsSummaryCardComponent);
    fixture.componentRef.setInput('summary', { sections: [
      { name: 'Project Context', wordCount: 3, generated: true },
      { name: 'Framework Guidelines', wordCount: 0, generated: false },
      { name: 'Coding Standards', wordCount: 2, generated: true },
      { name: 'Architecture Notes', wordCount: 1, generated: true },
      { name: 'Quality Guidance', wordCount: 9, generated: true },
    ] });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('3 of 4 sections generated');
    expect(text).not.toContain('Quality Guidance');
    expect(text).not.toContain('tokens');
    expect(text).not.toContain('fallback');
  });
});
