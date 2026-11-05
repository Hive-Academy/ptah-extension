/** @jest-environment jsdom */
import { signal } from '@angular/core';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { StageProgress, bindStageScroll } from './stage-scroll';

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

function progress(): StageProgress {
  return { reveal: signal(1), enter: signal(1), steps: signal(1) };
}

describe('bindStageScroll', () => {
  afterEach(() => jest.restoreAllMocks());

  it('settles every phase and creates nothing under reduced motion', () => {
    installMatchMedia((query) => query.includes('prefers-reduced-motion: reduce'));
    const create = jest.spyOn(ScrollTrigger, 'create');
    const state = progress();

    bindStageScroll(document.createElement('section'), document.createElement('div'), window, state);

    expect(create).not.toHaveBeenCalled();
    expect([state.reveal(), state.enter(), state.steps()]).toEqual([1, 1, 1]);
  });

  it('pins only the stage on desktop and settles again on release', () => {
    installMatchMedia((query) => query.includes('min-width: 1024px'));
    const kill = jest.fn();
    const create = jest
      .spyOn(ScrollTrigger, 'create')
      .mockReturnValue({ kill } as unknown as ScrollTrigger);
    const stage = document.createElement('div');
    const state = progress();

    const release = bindStageScroll(document.createElement('section'), stage, window, state);

    expect(state.steps()).toBe(0);
    expect(create).toHaveBeenCalledTimes(3);
    const pinned = create.mock.calls.map((call) => call[0]).filter((vars) => vars.pin === true);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatchObject({ trigger: stage, start: 'center center' });

    release();
    expect(kill).toHaveBeenCalledTimes(3);
    expect(state.steps()).toBe(1);
  });

  it('does not pin on compact screens', () => {
    installMatchMedia((query) => query.includes('max-width: 1023px'));
    const create = jest
      .spyOn(ScrollTrigger, 'create')
      .mockReturnValue({ kill: jest.fn() } as unknown as ScrollTrigger);

    bindStageScroll(document.createElement('section'), document.createElement('div'), window, progress());

    expect(create.mock.calls.every((call) => call[0].pin !== true)).toBe(true);
  });
});
