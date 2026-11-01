/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HeroComponent } from './hero.component';

class StubIntersectionObserver {
  public observe(): void {
    /* no viewport in jsdom */
  }
  public unobserve(): void {
    /* no viewport in jsdom */
  }
  public disconnect(): void {
    /* no viewport in jsdom */
  }
  public takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const stubMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;

describe('HeroComponent', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: StubIntersectionObserver,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: stubMatchMedia,
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const create = async (platform: 'browser' | 'server' = 'browser') => {
    TestBed.configureTestingModule({
      imports: [HeroComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    const fixture = TestBed.createComponent(HeroComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  it('hosts the live demo instead of the device mock and keeps the stat row', async () => {
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('ptah-live-demo-section')).toBeTruthy();
    expect(root.querySelector('ptah-hero-device-showcase')).toBeNull();
    expect(root.querySelector('ptah-council-demo')).toBeNull();
    expect(root.querySelector('ptah-device-frame')).toBeNull();
    expect(root.querySelector('h1')?.getAttribute('aria-label')).toBe(
      'It ships the SaaS.',
    );
    expect(root.textContent).toContain('concurrent agent tiles');
    expect(root.textContent).toContain('platforms: Windows, macOS, Linux');
    fixture.destroy();
  });

  it('centres a smaller headline in the first viewport, above the demo', async () => {
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    const headline = root.querySelector('[data-hero-headline]') as HTMLElement;
    expect(headline.className).toContain('min-h-[100svh]');
    expect(headline.className).toContain('items-center');
    expect(headline.className).toContain('justify-center');
    const h1 = root.querySelector('h1') as HTMLElement;
    expect(h1.className).toContain('lg:text-6xl');
    expect(h1.className).not.toContain('lg:text-7xl');
    const demo = root.querySelector('ptah-live-demo-section') as HTMLElement;
    expect(
      headline.compareDocumentPosition(demo) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(root.querySelector('[data-demo-variant]')).toBeNull();
    fixture.destroy();
  });

  it('drops the download CTAs and points "Watch it work" at the live demo', async () => {
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).not.toContain("Download Ptah — it's free");
    expect(root.textContent).not.toContain('Download PtahCode');
    expect(root.querySelector('a[href="/download"]')).toBeNull();
    const watch = Array.from(root.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Watch it work'),
    );
    expect(watch?.getAttribute('href')).toBe('#live-demo');
    expect(root.querySelector('#live-demo')).toBeTruthy();
    expect(root.textContent).toContain('Open source. No credit card, ever.');
    fixture.destroy();
  });

  it('renders on the server', async () => {
    const fixture = await create('server');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')).toBeTruthy();
    expect(root.querySelector('ptah-live-demo-section')).toBeTruthy();
    fixture.destroy();
  });
});
