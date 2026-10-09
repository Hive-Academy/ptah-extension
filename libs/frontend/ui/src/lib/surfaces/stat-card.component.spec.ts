import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PtahStatCardComponent } from './stat-card.component';
@Component({
  standalone: true,
  imports: [PtahStatCardComponent],
  template: `<ptah-stat-card label="Sessions" [value]="42" trend="Up 10%"
    ><button actions>Open</button></ptah-stat-card
  >`,
})
class Host {}
describe('PtahStatCardComponent', () => {
  it('renders required metrics and projected actions', async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const card = f.nativeElement.querySelector('article') as HTMLElement;
    expect(card.textContent).toContain('Sessions');
    expect(card.textContent).toContain('42');
    expect(card.textContent).toContain('Up 10%');
    expect(card.querySelector('button')?.textContent).toContain('Open');
    expect(card.className).toContain('surface-2');
  });
});
