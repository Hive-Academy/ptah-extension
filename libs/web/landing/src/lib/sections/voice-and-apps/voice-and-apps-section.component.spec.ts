/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  VOICE_AND_APPS_POINTS,
  VoiceAndAppsSectionComponent,
} from './voice-and-apps-section.component';

function mount() {
  TestBed.configureTestingModule({
    imports: [VoiceAndAppsSectionComponent],
    providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
  });
  const fixture = TestBed.createComponent(VoiceAndAppsSectionComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

describe('VoiceAndAppsSectionComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the copy, the command-center clip and the points on the server', () => {
    const { root, fixture } = mount();

    expect(root.querySelector('section#voice-and-apps')?.getAttribute('aria-labelledby')).toBe(
      'voice-and-apps-title',
    );
    expect(root.querySelector('.section-eyebrow')?.textContent?.trim()).toBe('Title bar');
    expect(root.querySelector('h2#voice-and-apps-title')?.textContent?.trim()).toBe(
      'Talk to the work. Use the app.',
    );
    expect(root.querySelector('.section-subline')?.textContent?.trim()).toBe(
      'Voice is a spoken stage of the work on the desktop. Apps builds a form, chart, or table in its own chat.',
    );
    expect(
      Array.from(root.querySelectorAll('.va-point')).map((el) => el.textContent?.trim()),
    ).toEqual([...VOICE_AND_APPS_POINTS]);

    const video = root.querySelector('video');
    expect(video?.getAttribute('preload')).toBe('none');
    expect(video?.querySelector('source')?.getAttribute('src')).toBe(
      '/assets/live-demo/command-center.mp4',
    );
    // Settled: every line, bar and point in, the hand-off line drawn.
    expect(root.querySelectorAll('.rise:not(.is-in)')).toHaveLength(0);
    expect(root.querySelectorAll('.va-point.is-in')).toHaveLength(3);
    expect(root.querySelectorAll('.voice-bar:not(.is-in)')).toHaveLength(0);
    expect(root.querySelector('.voice-handoff')?.classList.contains('is-in')).toBe(true);
    fixture.destroy();
  });

  it('lays out text-led: clip, then the copy column, with no lightning', () => {
    const { root, fixture } = mount();
    const stage = root.querySelector('[data-stage]');
    expect(stage?.getAttribute('data-layout')).toBe('text-led');
    expect(Array.from(stage?.children ?? []).map((el) => el.className.split(' ')[0])).toEqual([
      'va-clip',
      'va-text',
    ]);
    expect(root.querySelector('.section-header')?.getAttribute('data-align')).toBe('start');
    expect(root.querySelector('[data-voice-strip]')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('ptah-flank-bolt, ptah-seam-bolt, ptah-lightning, canvas')).toBeNull();
    fixture.destroy();
  });

  it('reveals the header, then speaks the bars, hands off and brings the points in', () => {
    const { component, root, fixture } = mount();
    const shown = (selector: string) => root.querySelectorAll(selector + '.is-in').length;
    const bars = root.querySelectorAll('.voice-bar').length;

    component.scroll.reveal.set(0.5);
    component.scroll.enter.set(0);
    component.scroll.steps.set(0);
    fixture.detectChanges();
    expect(shown('.section-title')).toBe(1);
    expect(shown('.section-subline')).toBe(0);
    expect(shown('.voice-bar')).toBe(0);
    expect(shown('.va-point')).toBe(0);

    component.scroll.reveal.set(1);
    component.scroll.steps.set(0.06);
    fixture.detectChanges();
    expect(shown('.voice-bar')).toBe(bars / 2);
    expect(shown('.voice-handoff')).toBe(0);

    component.scroll.steps.set(0.45);
    fixture.detectChanges();
    expect(shown('.voice-bar')).toBe(bars);
    expect(shown('.voice-handoff')).toBe(1);
    expect(shown('.va-point')).toBe(2);

    component.scroll.steps.set(1);
    fixture.detectChanges();
    expect(shown('.va-point')).toBe(3);
    fixture.destroy();
  });
});
