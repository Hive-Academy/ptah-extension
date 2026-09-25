import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  CatalogCardBadge,
  CatalogCardComponent,
  CatalogHeadingLevel,
} from './catalog-card.component';

@Component({
  standalone: true,
  imports: [CatalogCardComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <ptah-catalog-card
      [heading]="heading()"
      [description]="description()"
      [meta]="meta()"
      [badge]="badge()"
      [headingLevel]="headingLevel()"
      [interactive]="interactive()"
      (activated)="onActivated()"
    >
      @if (withSlots()) {
        <span card-mark data-testid="mark">S</span>
      }
      @if (withSlots()) {
        <span card-status data-testid="status">Polling…</span>
      }
      @if (withSlots()) {
        <div card-actions>
          <button type="button" data-testid="action" (click)="onAction()">
            Install
          </button>
        </div>
      }
      @if (withSlots()) {
        <form card-expansion data-testid="expansion">
          <input aria-label="API key" data-testid="expansion-input" />
        </form>
      }
    </ptah-catalog-card>
  `,
})
class HostComponent {
  heading = signal('Sentry');
  description = signal<string | null>(
    'Errors and performance issues from your projects.',
  );
  meta = signal<readonly string[]>(['Monitoring', 'v2.1.0']);
  badge = signal<CatalogCardBadge | null>(null);
  headingLevel = signal<CatalogHeadingLevel>(3);
  interactive = signal(false);
  withSlots = signal(true);

  activatedCount = 0;
  actionCount = 0;

  onActivated(): void {
    this.activatedCount++;
  }
  onAction(): void {
    this.actionCount++;
  }
}

@Component({
  standalone: true,
  imports: [CatalogCardComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<ptah-catalog-card heading="Static name" />`,
})
class StaticHeadingHostComponent {}

describe('CatalogCardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends Element = HTMLElement>(testId: string): T | null =>
    el().querySelector<T>(`[data-testid="${testId}"]`);
  const article = (): HTMLElement => q('catalog-card') as HTMLElement;
  const heading = (): HTMLElement =>
    article().querySelector('h2, h3, h4') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, StaticHeadingHostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('structure', () => {
    it('renders an <article> labelled by its heading (h3 by default)', () => {
      expect(article().tagName).toBe('ARTICLE');
      expect(heading().tagName).toBe('H3');
      expect(heading().id).toBeTruthy();
      expect(article().getAttribute('aria-labelledby')).toBe(heading().id);
      expect(heading().textContent?.trim()).toBe('Sentry');
    });

    it.each<[CatalogHeadingLevel, string]>([
      [2, 'H2'],
      [3, 'H3'],
      [4, 'H4'],
    ])('renders headingLevel %s as <%s>', (level, tag) => {
      host.headingLevel.set(level);
      fixture.detectChanges();
      expect(heading().tagName).toBe(tag);
      expect(article().getAttribute('aria-labelledby')).toBe(heading().id);
    });

    it('accepts a static heading without leaving a native title tooltip', () => {
      const staticFixture = TestBed.createComponent(StaticHeadingHostComponent);
      staticFixture.detectChanges();
      const root = staticFixture.nativeElement as HTMLElement;
      const card = root.querySelector('ptah-catalog-card') as HTMLElement;

      expect(root.querySelector('h3')?.textContent?.trim()).toBe('Static name');
      expect(card.hasAttribute('title')).toBe(false);
      expect(root.querySelector('[title]')).toBeNull();
    });

    it('gives each instance a distinct heading id', () => {
      const second = TestBed.createComponent(HostComponent);
      second.detectChanges();
      const otherId = (second.nativeElement as HTMLElement)
        .querySelector('h3')
        ?.getAttribute('id');
      expect(otherId).toBeTruthy();
      expect(otherId).not.toBe(heading().id);
    });

    it('uses theme tokens for the surface, border and radius', () => {
      const cls = article().className;
      expect(cls).toContain('bg-base-200');
      expect(cls).toContain('border-base-300');
      expect(cls).toContain('rounded-xl');
      expect(cls).toContain('focus-within:ring-2');
    });

    it('lifts on hover only when motion is allowed', () => {
      const cls = article().className;
      expect(cls).toContain('hover:-translate-y-px');
      expect(cls).toContain('duration-150');
      expect(cls).toContain('motion-reduce:transition-none');
      expect(cls).toContain('motion-reduce:hover:translate-y-0');
    });
  });

  describe('slots', () => {
    it('projects mark, status, actions and expansion into their regions', () => {
      expect(q('catalog-card-mark')?.contains(q('mark'))).toBe(true);
      expect(q('catalog-card-status')?.contains(q('status'))).toBe(true);
      expect(q('catalog-card-actions')?.contains(q('action'))).toBe(true);
      expect(q('catalog-card-expansion')?.contains(q('expansion'))).toBe(true);
    });

    it('leaves unused slot wrappers empty so they collapse (empty:hidden)', () => {
      host.withSlots.set(false);
      fixture.detectChanges();

      for (const id of [
        'catalog-card-mark',
        'catalog-card-status',
        'catalog-card-actions',
        'catalog-card-expansion',
      ]) {
        const wrapper = q(id) as HTMLElement;
        expect(wrapper.className).toContain('empty:hidden');
        expect(wrapper.children.length).toBe(0);
        expect(wrapper.textContent?.trim()).toBe('');
      }
    });
  });

  describe('meta', () => {
    it('joins meta items with a middle dot', () => {
      expect(q('catalog-card-meta')?.textContent?.trim()).toBe(
        'Monitoring · v2.1.0',
      );
    });

    it('renders at most 3 non-blank items', () => {
      host.meta.set(['Monitoring', ' ', 'getsentry', 'v2.1.0', '12k installs']);
      fixture.detectChanges();
      expect(q('catalog-card-meta')?.textContent?.trim()).toBe(
        'Monitoring · getsentry · v2.1.0',
      );
    });

    it('renders no meta line when there are no items', () => {
      host.meta.set([]);
      fixture.detectChanges();
      expect(q('catalog-card-meta')).toBeNull();
    });
  });

  describe('description clamp', () => {
    it('renders the description with the clamp class', () => {
      const p = q('catalog-card-description') as HTMLElement;
      expect(p.textContent?.trim()).toBe(
        'Errors and performance issues from your projects.',
      );
      expect(p.classList).toContain('ptah-catalog-card__description');
    });

    it('clamps to 2 lines, and to 1 line in a compact ptah-catalog container', () => {
      // jest-preset-angular strips inline `styles` at compile time, so the
      // clamp rules are asserted on the authored component source.
      const styles = readFileSync(
        join(__dirname, 'catalog-card.component.ts'),
        'utf8',
      ).replace(/\s+/g, ' ');

      expect(styles).toMatch(
        /\.ptah-catalog-card__description[^{]*\{[^}]*-webkit-line-clamp: 2/,
      );
      expect(styles).toMatch(
        /@container ptah-catalog \(width < 480px\) \{.*\.ptah-catalog-card__description[^{]*\{[^}]*-webkit-line-clamp: 1/,
      );
    });

    it('renders no description element for null or blank text', () => {
      host.description.set(null);
      fixture.detectChanges();
      expect(q('catalog-card-description')).toBeNull();

      host.description.set('   ');
      fixture.detectChanges();
      expect(q('catalog-card-description')).toBeNull();
    });
  });

  describe('badge', () => {
    it('renders the label as text with its tone class', () => {
      host.badge.set({ label: 'Installed', tone: 'success' });
      fixture.detectChanges();
      const badge = q('catalog-card-badge') as HTMLElement;
      expect(badge.textContent?.trim()).toBe('Installed');
      expect(badge.className).toContain('badge-success');
      expect(badge.getAttribute('data-tone')).toBe('success');
    });

    it.each([
      ['neutral', 'badge-ghost'],
      ['info', 'badge-info'],
      ['warning', 'badge-warning'],
      ['error', 'badge-error'],
    ] as const)('maps tone %s to %s', (tone, cls) => {
      host.badge.set({ label: 'Status', tone });
      fixture.detectChanges();
      expect(q('catalog-card-badge')?.className).toContain(cls);
    });

    it('never renders a colour-only badge (blank label renders nothing)', () => {
      host.badge.set({ label: '  ', tone: 'success' });
      fixture.detectChanges();
      expect(q('catalog-card-badge')).toBeNull();
    });
  });

  describe('activation', () => {
    it('renders plain heading text and no button when not interactive', () => {
      expect(q('catalog-card-activator')).toBeNull();
      expect(heading().querySelector('button')).toBeNull();
      article().click();
      heading().click();
      expect(host.activatedCount).toBe(0);
      expect(article().getAttribute('data-interactive')).toBeNull();
    });

    it('renders the heading as a stretched button and emits activated when interactive', () => {
      host.interactive.set(true);
      fixture.detectChanges();

      const button = q<HTMLButtonElement>('catalog-card-activator');
      expect(button).not.toBeNull();
      expect(button?.type).toBe('button');
      expect(button?.parentElement).toBe(heading());
      expect(button?.textContent?.trim()).toBe('Sentry');
      expect(button?.className).toContain('after:absolute');
      expect(button?.className).toContain('after:inset-0');
      expect(button?.getAttribute('aria-describedby')).toBe(
        q('catalog-card-description')?.id,
      );

      button?.click();
      expect(host.activatedCount).toBe(1);
    });

    it('does not activate when a projected action is clicked', () => {
      host.interactive.set(true);
      fixture.detectChanges();

      (q('action') as HTMLButtonElement).click();
      expect(host.actionCount).toBe(1);
      expect(host.activatedCount).toBe(0);
    });

    it('keeps every slot wrapper and the badge above the stretched activator', () => {
      host.interactive.set(true);
      host.badge.set({ label: 'Verified', tone: 'info' });
      fixture.detectChanges();

      for (const id of [
        'catalog-card-mark',
        'catalog-card-badge',
        'catalog-card-status',
        'catalog-card-actions',
        'catalog-card-expansion',
      ]) {
        const cls = (q(id) as HTMLElement).className;
        expect(cls).toContain('relative');
        expect(cls).toContain('z-10');
      }
    });

    it('never nests one interactive element inside another', () => {
      host.interactive.set(true);
      fixture.detectChanges();

      const interactive =
        'a[href], button, input, select, textarea, [tabindex]';
      for (const node of Array.from(
        article().querySelectorAll<HTMLElement>(interactive),
      )) {
        const ancestor = node.parentElement?.closest(interactive);
        expect(ancestor && article().contains(ancestor)).toBeFalsy();
      }
      expect(article().getAttribute('role')).toBeNull();
      expect(article().getAttribute('tabindex')).toBeNull();
    });
  });

  describe('safe rendering', () => {
    it('renders markup in text inputs as text, never as HTML', () => {
      host.heading.set('<img src=x onerror="alert(1)">');
      host.description.set('<b>bold</b>');
      host.meta.set(['<i>meta</i>']);
      host.badge.set({ label: '<em>x</em>', tone: 'info' });
      fixture.detectChanges();

      expect(article().querySelector('img, b, i, em')).toBeNull();
      expect(heading().textContent).toContain('<img src=x');
    });

    it('does not use innerHTML in the component source', () => {
      const source = readFileSync(
        join(__dirname, 'catalog-card.component.ts'),
        'utf8',
      );
      expect(source).not.toMatch(/innerHTML/i);
    });
  });
});
