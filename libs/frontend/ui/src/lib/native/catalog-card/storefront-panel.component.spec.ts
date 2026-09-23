import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { CatalogHeadingLevel } from './catalog-card.component';
import { StorefrontPanelComponent } from './storefront-panel.component';

@Component({
  standalone: true,
  imports: [StorefrontPanelComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-storefront-panel
      [heading]="heading()"
      [subtitle]="subtitle()"
      [headingLevel]="headingLevel()"
    >
      @if (withSlots()) {
        <span panel-mark data-testid="mark">S</span>
      }
      @if (withSlots()) {
        <form data-testid="body">
          <input aria-label="API key" />
        </form>
      }
      @if (withSlots()) {
        <div panel-footer>
          <button type="button" data-testid="save" (click)="onSave()">
            Save
          </button>
        </div>
      }
    </ptah-storefront-panel>
  `,
})
class HostComponent {
  heading = signal('Smithery API key');
  subtitle = signal<string | null>('Needed to browse and install servers.');
  headingLevel = signal<CatalogHeadingLevel>(3);
  withSlots = signal(true);

  saveCount = 0;

  onSave(): void {
    this.saveCount++;
  }
}

describe('StorefrontPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (testId: string): HTMLElement | null =>
    el().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  const section = (): HTMLElement => q('storefront-panel') as HTMLElement;
  const heading = (): HTMLElement =>
    section().querySelector('h2, h3, h4') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders a <section> labelled by its heading (h3 by default)', () => {
    expect(section().tagName).toBe('SECTION');
    expect(heading().tagName).toBe('H3');
    expect(heading().textContent?.trim()).toBe('Smithery API key');
    expect(section().getAttribute('aria-labelledby')).toBe(heading().id);
  });

  it.each<[CatalogHeadingLevel, string]>([
    [2, 'H2'],
    [4, 'H4'],
  ])('renders headingLevel %s as <%s>', (level, tag) => {
    host.headingLevel.set(level);
    fixture.detectChanges();
    expect(heading().tagName).toBe(tag);
    expect(section().getAttribute('aria-labelledby')).toBe(heading().id);
  });

  it('renders the subtitle, and none when null or blank', () => {
    expect(q('storefront-panel-subtitle')?.textContent?.trim()).toBe(
      'Needed to browse and install servers.',
    );

    host.subtitle.set(null);
    fixture.detectChanges();
    expect(q('storefront-panel-subtitle')).toBeNull();

    host.subtitle.set('  ');
    fixture.detectChanges();
    expect(q('storefront-panel-subtitle')).toBeNull();
  });

  it('projects mark, body and footer into their regions', () => {
    expect(q('storefront-panel-mark')?.contains(q('mark'))).toBe(true);
    expect(q('storefront-panel-body')?.contains(q('body'))).toBe(true);
    expect(q('storefront-panel-footer')?.contains(q('save'))).toBe(true);

    (q('save') as HTMLButtonElement).click();
    expect(host.saveCount).toBe(1);
  });

  it('leaves unused slot wrappers empty so they collapse (empty:hidden)', () => {
    host.withSlots.set(false);
    fixture.detectChanges();

    for (const id of [
      'storefront-panel-mark',
      'storefront-panel-body',
      'storefront-panel-footer',
    ]) {
      const wrapper = q(id) as HTMLElement;
      expect(wrapper.className).toContain('empty:hidden');
      expect(wrapper.children.length).toBe(0);
      expect(wrapper.textContent?.trim()).toBe('');
    }
  });

  it('uses theme tokens for the surface, border and radius', () => {
    const cls = section().className;
    expect(cls).toContain('bg-base-200');
    expect(cls).toContain('border-base-300');
    expect(cls).toContain('rounded-xl');
  });

  it('renders markup in text inputs as text, never as HTML', () => {
    host.heading.set('<img src=x>');
    host.subtitle.set('<b>bold</b>');
    fixture.detectChanges();
    expect(section().querySelector('img, b')).toBeNull();
    expect(heading().textContent).toContain('<img src=x>');
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'storefront-panel.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
