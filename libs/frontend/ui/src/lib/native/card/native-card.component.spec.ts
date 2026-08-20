import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NativeCardComponent, NativeCardTone } from './native-card.component';

@Component({
  standalone: true,
  imports: [NativeCardComponent],
  template: `
    <ptah-native-card
      [tone]="tone()"
      [spine]="spine()"
      [clickable]="clickable()"
      [selectable]="selectable()"
      [selected]="selected()"
      [disabled]="disabled()"
      [density]="density()"
      [ariaLabel]="ariaLabel()"
      (activated)="onActivated()"
    >
      <div card-header data-testid="header">Header</div>
      <p data-testid="body">Body</p>
      <div card-footer>
        <button type="button" data-testid="inner-btn" (click)="onInner()">
          Act
        </button>
      </div>
    </ptah-native-card>
  `,
})
class HostComponent {
  tone = signal<NativeCardTone>('neutral');
  spine = signal(false);
  clickable = signal(false);
  selectable = signal(false);
  selected = signal(false);
  disabled = signal(false);
  density = signal<'compact' | 'comfortable'>('comfortable');
  ariaLabel = signal<string | null>(null);

  activatedCount = 0;
  innerCount = 0;

  onActivated(): void {
    this.activatedCount++;
  }
  onInner(): void {
    this.innerCount++;
  }
}

describe('NativeCardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const root = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector(
      'ptah-native-card > div',
    ) as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('projects header, body and footer content', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="header"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="body"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="inner-btn"]')).toBeTruthy();
  });

  it('renders no spine by default and a toned spine when enabled', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="native-card-spine"]')).toBeNull();

    host.spine.set(true);
    host.tone.set('warning');
    fixture.detectChanges();

    const spine = el.querySelector(
      '[data-testid="native-card-spine"]',
    ) as HTMLElement;
    expect(spine).toBeTruthy();
    expect(spine.className).toContain('bg-warning');
    expect(root().getAttribute('data-tone')).toBe('warning');
  });

  it('is non-interactive by default (no role, no tabindex, no activation)', () => {
    expect(root().getAttribute('role')).toBeNull();
    expect(root().getAttribute('tabindex')).toBeNull();
    root().click();
    expect(host.activatedCount).toBe(0);
  });

  it('exposes button semantics and emits activated when clickable', () => {
    host.clickable.set(true);
    host.ariaLabel.set('Open deep-research');
    fixture.detectChanges();

    expect(root().getAttribute('role')).toBe('button');
    expect(root().getAttribute('tabindex')).toBe('0');
    expect(root().getAttribute('aria-label')).toBe('Open deep-research');

    root().click();
    expect(host.activatedCount).toBe(1);
  });

  it('activates on Enter and Space when the card itself has focus', () => {
    host.clickable.set(true);
    fixture.detectChanges();

    root().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    root().dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
    );
    expect(host.activatedCount).toBe(2);
  });

  it('ignores keys other than Enter/Space', () => {
    host.clickable.set(true);
    fixture.detectChanges();
    root().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true }),
    );
    expect(host.activatedCount).toBe(0);
  });

  it('does NOT activate when a nested button is clicked', () => {
    host.clickable.set(true);
    fixture.detectChanges();

    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="inner-btn"]',
      ) as HTMLButtonElement
    ).click();

    expect(host.innerCount).toBe(1);
    expect(host.activatedCount).toBe(0);
  });

  it('does NOT activate for keyboard events raised inside nested controls', () => {
    host.clickable.set(true);
    fixture.detectChanges();

    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="inner-btn"]',
      ) as HTMLButtonElement
    ).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(host.activatedCount).toBe(0);
  });

  it('suppresses activation and marks aria-disabled when disabled', () => {
    host.clickable.set(true);
    host.disabled.set(true);
    fixture.detectChanges();

    expect(root().getAttribute('aria-disabled')).toBe('true');
    expect(root().getAttribute('tabindex')).toBeNull();
    root().click();
    root().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(host.activatedCount).toBe(0);
  });

  it('reflects selection through aria-pressed and a toned ring', () => {
    host.selectable.set(true);
    host.tone.set('info');
    fixture.detectChanges();
    expect(root().getAttribute('aria-pressed')).toBe('false');
    expect(root().className).not.toContain('ring-info');

    host.selected.set(true);
    fixture.detectChanges();
    expect(root().getAttribute('aria-pressed')).toBe('true');
    expect(root().className).toContain('ring-info');
  });

  it('omits aria-pressed when not selectable', () => {
    host.clickable.set(true);
    fixture.detectChanges();
    expect(root().getAttribute('aria-pressed')).toBeNull();
  });

  it('applies the density padding scale', () => {
    const inner = (): HTMLElement =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="native-card-inner"]',
      ) as HTMLElement;

    expect(inner().className).toContain('p-4');

    host.density.set('compact');
    fixture.detectChanges();
    expect(inner().className).toContain('p-3');
  });

  it('insets the inner content when a spine is shown', () => {
    host.spine.set(true);
    fixture.detectChanges();
    const inner = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="native-card-inner"]',
    ) as HTMLElement;
    expect(inner.className).toContain('pl-5');
  });
});
