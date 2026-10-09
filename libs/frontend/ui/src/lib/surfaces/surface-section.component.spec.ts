import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SurfaceSectionComponent } from './surface-section.component';
@Component({
  standalone: true,
  imports: [SurfaceSectionComponent],
  template: `<ptah-surface-section tone="subtle" padding="md"
    ><div section-header>Heading</div>
    <p>Body</p></ptah-surface-section
  >`,
})
class Host {}
describe('SurfaceSectionComponent', () => {
  it('projects its header/body and applies the compact section contract', async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const section = f.nativeElement.querySelector('section') as HTMLElement;
    expect(section.textContent).toContain('Heading');
    expect(section.className).toContain('surface-1');
    expect(section.className).toContain('p-4');
    expect(section.className).toContain('rounded-xl');
  });
});
