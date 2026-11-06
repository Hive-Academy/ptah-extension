/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  PROVIDERS_POINTS,
  ProvidersSectionComponent,
  SETUP_HUB_STILL,
} from './providers-section.component';

function mount() {
  TestBed.configureTestingModule({
    imports: [ProvidersSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
  });
  const fixture = TestBed.createComponent(ProvidersSectionComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

describe('ProvidersSectionComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the copy, the setup-hub still and the cards on the server, settled', () => {
    const { root, fixture } = mount();

    expect(root.querySelector('section#providers')?.getAttribute('aria-labelledby')).toBe(
      'providers-title',
    );
    expect(root.querySelector('.section-eyebrow')?.textContent?.trim()).toBe('Your accounts');
    expect(root.querySelector('h2#providers-title')?.textContent?.trim()).toBe(
      'Bring the accounts you already have.',
    );
    expect(root.querySelector('.section-subline')?.textContent?.trim()).toBe(
      'A named Claude account is certified before launch, and the live subscription is checked.',
    );
    expect(
      Array.from(root.querySelectorAll('.pv-card .card-text')).map((el) => el.textContent?.trim()),
    ).toEqual([...PROVIDERS_POINTS]);

    const still = root.querySelector<HTMLImageElement>('img.still-image');
    expect(SETUP_HUB_STILL).toBe('/assets/images/showcase/setup-hub.png');
    expect(still?.getAttribute('src')).toBe(SETUP_HUB_STILL);
    expect(still?.getAttribute('loading')).toBe('lazy');
    expect(still?.getAttribute('alt')).toBeTruthy();
    expect(root.querySelector('video')).toBeNull();

    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('.pv-card.is-in')).toHaveLength(3);
    expect(root.querySelector('[data-seal]')?.classList.contains('is-in')).toBe(true);
    fixture.destroy();
  });

  it('lays out the account deck: header, cards, then the still, with no lightning', () => {
    const { root, fixture } = mount();
    const stage = root.querySelector('[data-stage]');
    expect(stage?.getAttribute('data-layout')).toBe('account-deck');
    expect(Array.from(stage?.children ?? []).map((el) => el.className.split(' ')[0])).toEqual([
      'pv-head',
      'pv-deck',
      'pv-still',
    ]);
    expect(root.querySelector('.section-header')?.getAttribute('data-align')).toBe('start');
    expect(root.querySelector('ptah-flank-bolt, ptah-seam-bolt, ptah-lightning, canvas')).toBeNull();
    expect(root.querySelector('[data-seal]')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelectorAll('.card-index[aria-hidden="true"]')).toHaveLength(3);
    fixture.destroy();
  });

  it('reveals the header, then deals the cards and stamps the seal with the second', () => {
    const { component, root, fixture } = mount();
    const shown = (selector: string) => root.querySelectorAll(selector + '.is-in').length;

    component.scroll.reveal.set(0.5);
    component.scroll.enter.set(0);
    component.scroll.steps.set(0);
    fixture.detectChanges();
    expect(shown('.section-title')).toBe(1);
    expect(shown('.section-subline')).toBe(0);
    expect(shown('.pv-card')).toBe(0);
    expect(shown('[data-seal]')).toBe(0);

    component.scroll.reveal.set(1);
    component.scroll.steps.set(0.2);
    fixture.detectChanges();
    expect(shown('.pv-card')).toBe(1);
    expect(shown('[data-seal]')).toBe(0);

    component.scroll.steps.set(0.45);
    fixture.detectChanges();
    expect(shown('.pv-card')).toBe(2);
    expect(shown('[data-seal]')).toBe(1);

    component.scroll.steps.set(1);
    fixture.detectChanges();
    expect(shown('.pv-card')).toBe(3);
    fixture.destroy();
  });
});
