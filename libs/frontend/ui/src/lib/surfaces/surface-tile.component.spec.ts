import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SurfaceTileComponent } from './surface-tile.component';
@Component({
  standalone: true,
  imports: [SurfaceTileComponent],
  template: `<ptah-surface-tile [selected]="selected()" density="compact"
    >Tile</ptah-surface-tile
  >`,
})
class Host {
  selected = signal(false);
}
describe('SurfaceTileComponent', () => {
  it('uses compact tile density and reflects selection', async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const tile = () =>
      f.nativeElement.querySelector('ptah-surface-tile > div') as HTMLElement;
    expect(tile().className).toContain('rounded-lg');
    expect(tile().className).toContain('p-2');
    f.componentInstance.selected.set(true);
    f.detectChanges();
    expect(tile().dataset.selected).toBe('true');
    expect(tile().className).toContain('elev-1');
  });
});
