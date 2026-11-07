/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  CTA_REVEAL,
  FinalCtaSectionComponent,
  bindCtaScroll,
  headlineSentences,
} from './final-cta-section.component';

function mount() {
  TestBed.configureTestingModule({
    imports: [FinalCtaSectionComponent],
    providers: [provideRouter([]), { provide: PLATFORM_ID, useValue: 'server' }],
  });
  const fixture = TestBed.createComponent(FinalCtaSectionComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

function installMatchMedia(matches: (query: string) => boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

function fakeTrigger(kill: jest.Mock): ScrollTrigger {
  return Object.assign(Object.create(ScrollTrigger.prototype) as ScrollTrigger, { kill });
}

describe('FinalCtaSectionComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the headline, the line and both buttons on the server, settled', () => {
    const { root, fixture } = mount();

    const section = root.querySelector('section#cta');
    expect(section?.getAttribute('aria-labelledby')).toBe('cta-title');
    const title = root.querySelector('h2#cta-title');
    expect(title?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Free. No account. No license key.');
    expect(
      Array.from(root.querySelectorAll('.cta-sentence')).map((el) => el.textContent?.trim()),
    ).toEqual(['Free.', 'No account.', 'No license key.']);
    expect(root.querySelector('.cta-line')?.textContent?.trim()).toBe(
      'MIT license. No trial and no credit card.',
    );

    const download = root.querySelector<HTMLAnchorElement>('a.cta-download');
    expect(download?.textContent?.trim()).toContain('Download PtahCode');
    expect(download?.getAttribute('href')).toBe('/download');
    const docs = root.querySelector<HTMLAnchorElement>('a.cta-docs');
    expect(docs?.textContent?.trim()).toBe('Read the docs');
    expect(docs?.getAttribute('href')).toBe('https://docs.ptah.live');
    expect(docs?.getAttribute('rel')).toBe('noopener noreferrer');

    expect(root.querySelectorAll('.cta-sentence:not(.is-in)')).toHaveLength(0);
    expect(root.querySelector('.cta-line')?.classList.contains('is-in')).toBe(true);
    expect(root.querySelector('.cta-actions')?.classList.contains('is-in')).toBe(true);
    expect(root.querySelector('ptah-flank-bolt, ptah-seam-bolt, ptah-lightning, canvas')).toBeNull();
    expect(root.querySelector('video')).toBeNull();
    fixture.destroy();
  });

  it('reveals the sentences top-down, then the line, then the buttons', () => {
    const { component, root, fixture } = mount();
    const shown = (selector: string) => root.querySelectorAll(selector + '.is-in').length;

    component.progress.set(0);
    fixture.detectChanges();
    expect(shown('.cta-sentence')).toBe(0);

    component.progress.set(CTA_REVEAL.sentences[1]);
    fixture.detectChanges();
    expect(shown('.cta-sentence')).toBe(2);
    expect(shown('.cta-line')).toBe(0);

    component.progress.set(CTA_REVEAL.line);
    fixture.detectChanges();
    expect(shown('.cta-sentence')).toBe(3);
    expect(shown('.cta-line')).toBe(1);
    expect(shown('.cta-actions')).toBe(0);

    component.progress.set(1);
    fixture.detectChanges();
    expect(shown('.cta-actions')).toBe(1);
    fixture.destroy();
  });
});

describe('headlineSentences', () => {
  it('splits on sentence ends and keeps the full stops', () => {
    expect(headlineSentences('Free. No account. No license key.')).toEqual([
      'Free.',
      'No account.',
      'No license key.',
    ]);
    expect(headlineSentences('One line')).toEqual(['One line']);
  });
});

describe('bindCtaScroll', () => {
  afterEach(() => jest.restoreAllMocks());

  it('settles at 1 and creates no trigger under reduced motion', () => {
    installMatchMedia((query) => query.includes('prefers-reduced-motion: reduce'));
    const create = jest.spyOn(ScrollTrigger, 'create');
    const onProgress = jest.fn();

    bindCtaScroll(document.createElement('section'), window, onProgress);

    expect(onProgress).toHaveBeenCalledWith(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('scrubs without a pin, then kills the trigger and settles on release', () => {
    installMatchMedia((query) => query.includes('prefers-reduced-motion: no-preference'));
    const kill = jest.fn();
    const create = jest.spyOn(ScrollTrigger, 'create').mockReturnValue(fakeTrigger(kill));
    const onProgress = jest.fn();

    const release = bindCtaScroll(document.createElement('section'), window, onProgress);

    expect(onProgress).toHaveBeenLastCalledWith(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).not.toHaveProperty('pin');
    expect(create.mock.calls[0][0]).toMatchObject({ scrub: 0.4, start: 'top 85%' });

    release();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });
});
