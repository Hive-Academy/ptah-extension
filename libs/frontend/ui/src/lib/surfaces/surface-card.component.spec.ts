import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SurfaceCardComponent } from './surface-card.component';
@Component({
  standalone: true,
  imports: [SurfaceCardComponent],
  template: `<ptah-surface-card [elevation]="elevation()"
    >Content</ptah-surface-card
  >`,
})
class Host {
  elevation = signal<1 | 2>(1);
}
describe('SurfaceCardComponent', () => {
  it('uses the card spacing and changes elevation', async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const card = () => f.nativeElement.querySelector('article') as HTMLElement;
    expect(card().className).toContain('p-4');
    expect(card().className).toContain('elev-1');
    f.componentInstance.elevation.set(2);
    f.detectChanges();
    expect(card().className).toContain('elev-3');
  });
});
