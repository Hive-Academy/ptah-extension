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
  const originalUrl = window.location.href;

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
    window.history.replaceState({}, '', originalUrl);
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

  it('defaults to the stage variation', async () => {
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.variant()).toBe('stage');
    expect(
      root.querySelector('[data-demo-variant]')?.getAttribute('data-demo-variant'),
    ).toBe('stage');
    expect(root.querySelector('h1')?.className).toContain('lg:text-7xl');
    fixture.destroy();
  });

  it.each([
    ['?demo=b', 'split'],
    ['?demo=c', 'theater'],
    ['?demo=a', 'stage'],
    ['?demo=unknown', 'stage'],
  ])('reads %s in the browser as the %s variation', async (search, variant) => {
    window.history.replaceState({}, '', `/${search}`);
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.variant()).toBe(variant);
    expect(
      root.querySelector('[data-demo-variant]')?.getAttribute('data-demo-variant'),
    ).toBe(variant);
    expect(root.querySelectorAll('ptah-live-demo-section')).toHaveLength(1);
    fixture.destroy();
  });

  it('left-aligns the headline beside the window in the split variation', async () => {
    window.history.replaceState({}, '', '/?demo=b');
    const fixture = await create();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.className).toContain('lg:text-6xl');
    expect(root.querySelector('[data-demo-variant]')?.className).toContain(
      'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
    );
    fixture.destroy();
  });

  it('ignores the query on the server and renders the stage variation', async () => {
    window.history.replaceState({}, '', '/?demo=c');
    const fixture = await create('server');
    expect(fixture.componentInstance.variant()).toBe('stage');
    fixture.destroy();
  });
});
