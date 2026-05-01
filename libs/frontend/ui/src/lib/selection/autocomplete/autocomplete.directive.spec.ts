import { Component, ElementRef, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AutocompleteDirective } from './autocomplete.directive';

@Component({
  standalone: true,
  imports: [AutocompleteDirective],
  template: `
    <input type="text" autocompleteInput placeholder="Type to search..." />
  `,
})
class HostComponent {
  @ViewChild(AutocompleteDirective, { static: true })
  directive!: AutocompleteDirective;
}

describe('AutocompleteDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the directive instance', () => {
    expect(host.directive).toBeTruthy();
  });

  it('should attach to input element and expose ElementRef', () => {
    expect(host.directive.elementRef).toBeInstanceOf(ElementRef);
    expect(host.directive.elementRef.nativeElement).toBeInstanceOf(
      HTMLInputElement,
    );
  });

  it('should reference the host input element', () => {
    const inputEl = (fixture.nativeElement as HTMLElement).querySelector(
      'input',
    );
    expect(host.directive.elementRef.nativeElement).toBe(inputEl);
  });

  it('should preserve input attributes on the host element', () => {
    const inputEl = host.directive.elementRef.nativeElement;
    expect(inputEl.getAttribute('placeholder')).toBe('Type to search...');
    expect(inputEl.type).toBe('text');
  });
});
