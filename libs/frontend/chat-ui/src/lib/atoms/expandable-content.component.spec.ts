import { TestBed } from '@angular/core/testing';
import { ExpandableContentComponent } from './expandable-content.component';

describe('ExpandableContentComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExpandableContentComponent],
    }).compileComponents();
  });

  it('shows "Show content" with size when collapsed', () => {
    const fixture = TestBed.createComponent(ExpandableContentComponent);
    fixture.componentRef.setInput('content', 'line1\nline2\nline3');
    fixture.componentRef.setInput('isExpanded', false);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent.trim();
    expect(text).toContain('Show');
    expect(text).toContain('3 lines');
    expect(text).toContain('17 chars');
  });

  it('shows "Hide content" when expanded', () => {
    const fixture = TestBed.createComponent(ExpandableContentComponent);
    fixture.componentRef.setInput('content', 'abc');
    fixture.componentRef.setInput('isExpanded', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toContain('Hide');
    const icon = fixture.nativeElement.querySelector('lucide-angular');
    expect(icon.className).toContain('rotate-90');
  });

  it('emits toggleClicked when the button is clicked', () => {
    const fixture = TestBed.createComponent(ExpandableContentComponent);
    fixture.componentRef.setInput('content', 'abc');
    fixture.componentRef.setInput('isExpanded', false);
    fixture.detectChanges();

    let received: Event | null = null;
    fixture.componentInstance.toggleClicked.subscribe((e) => (received = e));

    fixture.nativeElement.querySelector('button').click();
    expect(received).not.toBeNull();
  });
});
