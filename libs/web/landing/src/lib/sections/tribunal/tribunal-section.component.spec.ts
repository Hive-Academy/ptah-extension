/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TRIBUNAL_POINTS, TribunalSectionComponent } from './tribunal-section.component';

function mount() {
  TestBed.configureTestingModule({
    imports: [TribunalSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
  });
  const fixture = TestBed.createComponent(TribunalSectionComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

describe('TribunalSectionComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the copy, the council clip and the points on the server', () => {
    const { root, fixture } = mount();

    expect(root.querySelector('section#tribunal')?.getAttribute('aria-labelledby')).toBe(
      'tribunal-title',
    );
    expect(root.querySelector('.section-eyebrow')?.textContent?.trim()).toBe('In the chat');
    expect(root.querySelector('h2#tribunal-title')?.textContent?.trim()).toBe(
      'Several vendors debate one call.',
    );
    expect(root.querySelector('.section-subline')?.textContent?.trim()).toBe(
      'Ask in the chat you already have. It is not a separate screen.',
    );
    expect(
      Array.from(root.querySelectorAll('.tb-point')).map((el) => el.textContent?.trim()),
    ).toEqual([...TRIBUNAL_POINTS]);

    const video = root.querySelector('video');
    expect(video?.getAttribute('poster')).toBe('/assets/live-demo/tribunal-council.jpg');
    expect(video?.getAttribute('aria-label')).toContain('council');
    // Settled: every line, seat and point in; the verdict is the last point.
    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('.tb-point.is-in')).toHaveLength(3);
    expect(root.querySelectorAll('.tb-seat.is-in')).toHaveLength(5);
    expect(root.querySelector('.tb-point.is-verdict')?.textContent?.trim()).toBe(TRIBUNAL_POINTS[2]);
    fixture.destroy();
  });

  it('lays out the bench: copy over the clip edge, with no lightning', () => {
    const { root, fixture } = mount();
    const stage = root.querySelector('[data-stage]');
    expect(stage?.getAttribute('data-layout')).toBe('bench');
    // The copy is inside the pinned stage, so it stays on screen.
    expect(Array.from(stage?.children ?? []).map((el) => el.className.split(' ')[0])).toEqual([
      'tb-text',
      'tb-clip',
    ]);
    expect(root.querySelector('.section-header')?.getAttribute('data-align')).toBe('start');
    expect(root.querySelector('ptah-flank-bolt, ptah-seam-bolt, ptah-lightning, canvas')).toBeNull();
    // Seats sit behind the clip, not over the picture.
    expect(root.querySelector('.tb-bench')?.getAttribute('aria-hidden')).toBe('true');
    fixture.destroy();
  });

  it('reveals the header, then seats the panel, then the points with the verdict last', () => {
    const { component, root, fixture } = mount();
    const shown = (selector: string) => root.querySelectorAll(selector + '.is-in').length;

    component.scroll.reveal.set(0.5);
    component.scroll.enter.set(0);
    component.scroll.steps.set(0);
    fixture.detectChanges();
    expect(shown('.section-title')).toBe(1);
    expect(shown('.section-subline')).toBe(0);
    expect(shown('.tb-seat')).toBe(0);
    expect(shown('.tb-point')).toBe(0);

    component.scroll.reveal.set(1);
    component.scroll.steps.set(0.45);
    fixture.detectChanges();
    expect(shown('.tb-seat')).toBe(5);
    expect(shown('.tb-point')).toBe(2);
    expect(root.querySelector('.tb-point.is-verdict')?.classList.contains('is-in')).toBe(false);

    component.scroll.steps.set(1);
    fixture.detectChanges();
    expect(root.querySelector('.tb-point.is-verdict')?.classList.contains('is-in')).toBe(true);
    fixture.destroy();
  });
});
