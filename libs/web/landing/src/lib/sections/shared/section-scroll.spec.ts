/** @jest-environment jsdom */
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { REVEAL, bindSectionScroll, revealedLines } from './section-scroll';

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

describe('bindSectionScroll', () => {
  afterEach(() => jest.restoreAllMocks());

  it('settles at 1 and creates no trigger under reduced motion', () => {
    installMatchMedia((query) => query.includes('prefers-reduced-motion: reduce'));
    const create = jest.spyOn(ScrollTrigger, 'create');
    const onProgress = jest.fn();

    bindSectionScroll(document.createElement('section'), window, onProgress);

    expect(onProgress).toHaveBeenCalledWith(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('pins and scrubs on desktop, then kills both and settles on release', () => {
    installMatchMedia((query) => query.includes('min-width: 1024px'));
    const kill = jest.fn();
    const create = jest
      .spyOn(ScrollTrigger, 'create')
      .mockReturnValue({ kill, end: 2000 } as unknown as ScrollTrigger);
    const onProgress = jest.fn();

    const release = bindSectionScroll(document.createElement('section'), window, onProgress);

    expect(onProgress).toHaveBeenLastCalledWith(0);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toMatchObject({ pin: true, start: 'center center' });
    expect(create.mock.calls[1][0]).toMatchObject({ scrub: 0.4, start: 'top 70%' });

    release();
    expect(kill).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it('scrubs without a pin on compact screens', () => {
    installMatchMedia((query) => query.includes('max-width: 1023px'));
    const create = jest
      .spyOn(ScrollTrigger, 'create')
      .mockReturnValue({ kill: jest.fn() } as unknown as ScrollTrigger);

    bindSectionScroll(document.createElement('section'), window, jest.fn());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).not.toHaveProperty('pin');
  });
});

describe('revealedLines', () => {
  it('counts the header lines the progress has reached', () => {
    expect(revealedLines(0)).toBe(0);
    expect(revealedLines(REVEAL.headline)).toBe(2);
    expect(revealedLines(1)).toBe(3);
  });
});
