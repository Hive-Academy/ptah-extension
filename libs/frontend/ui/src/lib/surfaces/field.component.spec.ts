import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PtahFieldComponent } from './field.component';
import { PtahFieldControlDirective } from './field-control.directive';
@Component({
  standalone: true,
  imports: [PtahFieldComponent, PtahFieldControlDirective],
  template: `<ptah-field label="Name" [hint]="hint()" [error]="error()"
    ><input id="existing-control-id" ptahFieldControl aria-describedby="external"
  /></ptah-field>`,
})
class Host {
  hint = signal<string | null>('Helpful text');
  error = signal<string | null>(null);
}
describe('PtahFieldComponent', () => {
  it('connects its marked projected control to label and help text', async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();
    const f = TestBed.createComponent(Host);
    f.detectChanges();
    const input = f.nativeElement.querySelector('input') as HTMLInputElement;
    const label = f.nativeElement.querySelector('label') as HTMLLabelElement;
    const help = f.nativeElement.querySelector('p') as HTMLParagraphElement;
    expect(label.htmlFor).toBe(input.id);
    expect(input.classList).toContain('input-sm');
    expect(input.getAttribute('aria-describedby')).toContain('external');
    expect(input.getAttribute('aria-describedby')).toContain(help.id);
    expect(help.textContent).toContain('Helpful text');
    f.componentInstance.error.set('Required');
    f.detectChanges();
    expect(help.textContent).toContain('Required');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
