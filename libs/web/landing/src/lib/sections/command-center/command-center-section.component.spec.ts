/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  COMMAND_CENTER_POINTS,
  CommandCenterSectionComponent,
} from './command-center-section.component';

function mount() {
  TestBed.configureTestingModule({
    imports: [CommandCenterSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
  });
  const fixture = TestBed.createComponent(CommandCenterSectionComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

describe('CommandCenterSectionComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the copy, the multi-agent clip and the points on the server', () => {
    const { root, fixture } = mount();

    expect(root.querySelector('section#command-center')?.getAttribute('aria-labelledby')).toBe(
      'command-center-title',
    );
    expect(root.querySelector('.section-eyebrow')?.textContent?.trim()).toBe('On your desktop');
    expect(root.querySelector('h2#command-center-title')?.textContent?.trim()).toBe(
      'One rail. Nine running. One bell.',
    );
    expect(root.querySelector('.section-subline')?.textContent?.trim()).toBe(
      'Twenty session tiles per workspace. Answer a permission or a question from the bell without leaving the thread.',
    );
    expect(
      Array.from(root.querySelectorAll('.rail-tile span:last-child')).map((el) => el.textContent?.trim()),
    ).toEqual([...COMMAND_CENTER_POINTS]);

    const video = root.querySelector('video');
    expect(video?.querySelector('source')?.getAttribute('src')).toBe(
      '/assets/live-demo/multi-agent.mp4',
    );
    expect(video?.getAttribute('poster')).toBe('/assets/live-demo/multi-agent.jpg');
    expect(root.querySelector('[data-stage]')?.getAttribute('data-layout')).toBe('rail-bleed');

    // Settled: every line and tile shown, nine of twenty ticks running, two flank bolts.
    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('.rail-tile.is-in')).toHaveLength(3);
    expect(root.querySelectorAll('.rail-tick')).toHaveLength(20);
    expect(root.querySelectorAll('.rail-tick.is-running')).toHaveLength(9);
    expect(root.querySelectorAll('ptah-flank-bolt[aria-hidden="true"]')).toHaveLength(2);
    expect(root.querySelector('ptah-seam-bolt')).toBeNull();
    fixture.destroy();
  });

  it('puts the rail inside the clip block so it overlaps the clip edge', () => {
    const { root, fixture } = mount();
    const clip = root.querySelector('.cc-clip');
    expect(clip?.querySelector('ptah-console-clip')).not.toBeNull();
    expect(clip?.querySelector('[data-rail]')).not.toBeNull();
    expect(root.querySelector('.section-header')?.getAttribute('data-align')).toBe('start');
    fixture.destroy();
  });

  it('strikes the flank bolts once per header line and once per tile, lighting ticks with the steps', () => {
    const { component, root, fixture } = mount();

    component.scroll.reveal.set(0.5);
    component.scroll.steps.set(0);
    fixture.detectChanges();
    expect(component.strike()).toBe(2);
    expect(root.querySelectorAll('.rail-tick.is-running')).toHaveLength(0);

    component.scroll.reveal.set(1);
    component.scroll.steps.set(0.45);
    fixture.detectChanges();
    expect(component.strike()).toBe(5);
    expect(root.querySelectorAll('.rail-tile.is-in')).toHaveLength(2);
    expect(root.querySelectorAll('.rail-tick.is-running')).toHaveLength(6);
    fixture.destroy();
  });
});
