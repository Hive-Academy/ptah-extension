/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ALWAYS_ON_POINTS, AlwaysOnSectionComponent } from './always-on-section.component';

function mount() {
  TestBed.configureTestingModule({
    imports: [AlwaysOnSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
  });
  const fixture = TestBed.createComponent(AlwaysOnSectionComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

describe('AlwaysOnSectionComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the copy and the points on the server, settled', () => {
    const { root, fixture } = mount();

    expect(root.querySelector('section#always-on')?.getAttribute('aria-labelledby')).toBe(
      'always-on-title',
    );
    expect(root.querySelector('.section-eyebrow')?.textContent?.trim()).toBe('Off the desk');
    expect(root.querySelector('h2#always-on-title')?.textContent?.trim()).toBe(
      'Hand the live chat to your phone.',
    );
    expect(root.querySelector('.section-subline')?.textContent?.trim()).toBe(
      'Pair Telegram, Discord, or Slack. The desktop composer locks until you take it back.',
    );
    expect(
      Array.from(root.querySelectorAll('.ao-point')).map((el) => el.textContent?.trim()),
    ).toEqual([...ALWAYS_ON_POINTS]);

    // A diagram section: no clip, nothing to download.
    expect(root.querySelector('video')).toBeNull();
    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('.ao-point.is-in')).toHaveLength(3);
    expect(root.querySelector('[data-desk]')?.classList.contains('is-locked')).toBe(true);
    expect(root.querySelector('[data-phone]')?.classList.contains('is-live')).toBe(true);
    fixture.destroy();
  });

  it('lays out the hand-off: header, desk, one bolt, then the phone', () => {
    const { root, fixture } = mount();
    const stage = root.querySelector('[data-stage]');
    expect(stage?.getAttribute('data-layout')).toBe('hand-off');
    expect(Array.from(stage?.children ?? []).map((el) => el.className.split(' ')[0])).toEqual([
      'ao-head',
      'ao-desk',
      'ao-bolt',
      'ao-phone',
    ]);
    expect(root.querySelector('.section-header')?.getAttribute('data-align')).toBe('start');
    expect(root.querySelector('[data-desk]')?.getAttribute('aria-hidden')).toBe('true');
    const bolts = root.querySelectorAll('ptah-flank-bolt[aria-hidden="true"]');
    expect(bolts).toHaveLength(1);
    expect(bolts[0].getAttribute('data-axis')).toBe('horizontal');
    // The points are real list items inside the phone, not decoration.
    expect(root.querySelector('[data-phone] ul.ao-points')).not.toBeNull();
    expect(root.querySelector('ptah-seam-bolt')).toBeNull();
    fixture.destroy();
  });

  it('reveals the header, then hands off, locks the desk and delivers the messages', () => {
    const { component, root, fixture } = mount();
    const shown = (selector: string) => root.querySelectorAll(selector + '.is-in').length;
    const desk = root.querySelector('[data-desk]');

    component.scroll.reveal.set(0.5);
    component.scroll.enter.set(0);
    component.scroll.steps.set(0);
    fixture.detectChanges();
    expect(shown('.section-title')).toBe(1);
    expect(shown('.section-subline')).toBe(0);
    expect(shown('.ao-point')).toBe(0);
    expect(desk?.classList.contains('is-locked')).toBe(false);

    component.scroll.reveal.set(1);
    component.scroll.steps.set(0.2);
    fixture.detectChanges();
    expect(shown('.ao-point')).toBe(1);
    expect(desk?.classList.contains('is-locked')).toBe(true);

    component.scroll.steps.set(1);
    fixture.detectChanges();
    expect(shown('.ao-point')).toBe(3);
    fixture.destroy();
  });

  it('strikes the bolt once per header line and once per message', () => {
    const { component, fixture } = mount();
    expect(component.strike()).toBe(6);
    component.scroll.reveal.set(0);
    component.scroll.steps.set(0);
    expect(component.strike()).toBe(0);
    fixture.destroy();
  });
});
