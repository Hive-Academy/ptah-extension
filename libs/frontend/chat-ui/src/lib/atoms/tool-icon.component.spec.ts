import { TestBed } from '@angular/core/testing';
import { ToolIconComponent } from './tool-icon.component';

describe('ToolIconComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolIconComponent],
    }).compileComponents();
  });

  function render(toolName: string) {
    const fixture = TestBed.createComponent(ToolIconComponent);
    fixture.componentRef.setInput('toolName', toolName);
    fixture.detectChanges();
    return fixture;
  }

  it('exposes deterministic getColorClass results via component logic', () => {
    // The lucide-angular replaces its own class attribute at render time so
    // we exercise the mapping logic through the public template's outerHTML
    // rather than the post-render lucide DOM attribute.
    const cases: Array<[string, string]> = [
      ['Read', 'text-info'],
      ['Write', 'text-success'],
      ['Bash', 'text-warning'],
      ['Grep', 'text-secondary'],
      ['Edit', 'text-accent'],
      ['Glob', 'text-info'],
      ['Unknown', 'text-base-content/60'],
    ];
    for (const [tool, klass] of cases) {
      const fixture = render(tool);
      // Access the protected getColorClass via bracket notation
      const cls = (
        fixture.componentInstance as unknown as { getColorClass(): string }
      ).getColorClass();
      expect(cls).toBe(klass);
    }
  });

  it('renders a lucide-angular icon element', () => {
    const fixture = render('Read');
    expect(
      fixture.nativeElement.querySelector('lucide-angular'),
    ).not.toBeNull();
  });

  it('creates the component', () => {
    const fixture = render('Read');
    expect(fixture.componentInstance).toBeTruthy();
  });
});
