import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CommandCaption } from '../model/command-center.store';
import {
  CAPTION_ANNOUNCE_DEBOUNCE_MS,
  CommandCaptionStripComponent,
  captionTail,
} from './command-caption-strip.component';

function caption(
  role: CommandCaption['role'],
  text: string,
  seq: number,
): CommandCaption {
  return { role, text, seq };
}

describe('CommandCaptionStripComponent', () => {
  let fixture: ComponentFixture<CommandCaptionStripComponent>;

  const strip = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('[data-testid="caption-strip"]');
  const announcer = (): HTMLElement =>
    fixture.nativeElement.querySelector('[data-testid="caption-announcer"]');
  const set = (value: CommandCaption | null): void => {
    fixture.componentRef.setInput('caption', value);
    fixture.detectChanges();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [CommandCaptionStripComponent],
    });
    fixture = TestBed.createComponent(CommandCaptionStripComponent);
    fixture.detectChanges();
  });

  afterEach(() => jest.useRealTimers());

  it('stays unmounted while there is nothing to say', () => {
    expect(strip()).toBeNull();
    expect(announcer().getAttribute('role')).toBe('status');
    expect(announcer().getAttribute('aria-live')).toBe('polite');
  });

  it('shows an aria-hidden plate with no focusable content', () => {
    set(caption('agent', 'Three agents are working.', 1));
    const plate = strip();
    expect(plate?.getAttribute('aria-hidden')).toBe('true');
    expect(plate?.getAttribute('data-glass-surface')).toBe('plate');
    expect(plate?.querySelector('button, a, [tabindex]')).toBeNull();
    expect(plate?.textContent).toContain('Three agents are working.');
    expect(plate?.classList).toContain('single');
  });

  it('announces a finished agent sentence once, after the debounce', () => {
    set(caption('agent', 'The build passed.', 1));
    expect(announcer().textContent?.trim()).toBe('');
    jest.advanceTimersByTime(CAPTION_ANNOUNCE_DEBOUNCE_MS);
    fixture.detectChanges();
    expect(announcer().textContent?.trim()).toBe('Ptah: The build passed.');
  });

  it('announces short consecutive sentences in order instead of dropping them', () => {
    set(caption('agent', 'First.', 1));
    jest.advanceTimersByTime(100);
    set(caption('agent', 'Second.', 2));
    jest.advanceTimersByTime(100);
    set(caption('agent', 'Third.', 3));
    const heard: string[] = [];
    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(CAPTION_ANNOUNCE_DEBOUNCE_MS);
      fixture.detectChanges();
      heard.push(announcer().textContent?.trim() ?? '');
    }
    expect(heard).toEqual(['Ptah: First.', 'Ptah: Second.', 'Ptah: Third.']);
  });

  it('re-announces a repeated identical sentence by changing the region text', () => {
    set(caption('agent', 'Done.', 1));
    jest.advanceTimersByTime(CAPTION_ANNOUNCE_DEBOUNCE_MS);
    fixture.detectChanges();
    const first = announcer().textContent ?? '';
    set(caption('agent', 'Done.', 2));
    jest.advanceTimersByTime(CAPTION_ANNOUNCE_DEBOUNCE_MS);
    fixture.detectChanges();
    const second = announcer().textContent ?? '';
    expect(second).not.toBe(first);
    expect(second.replace(/\u200B/g, '').trim()).toBe('Ptah: Done.');
    set(caption('agent', 'Done.', 3));
    jest.advanceTimersByTime(CAPTION_ANNOUNCE_DEBOUNCE_MS);
    fixture.detectChanges();
    expect(announcer().textContent ?? '').not.toBe(second);
  });

  it('announces the user transcript with a You said prefix', () => {
    set(caption('user', 'run the tests', 2));
    jest.advanceTimersByTime(CAPTION_ANNOUNCE_DEBOUNCE_MS);
    fixture.detectChanges();
    expect(announcer().textContent?.trim()).toBe('You said: run the tests');
  });

  it('never announces status hints', () => {
    set(caption('status', 'Selected: reviewer · running', 0));
    jest.advanceTimersByTime(CAPTION_ANNOUNCE_DEBOUNCE_MS * 2);
    fixture.detectChanges();
    expect(strip()?.textContent).toContain('Selected: reviewer · running');
    expect(announcer().textContent?.trim()).toBe('');
  });

  it('fades out over 400ms after a clear, and cuts in 120ms', () => {
    set(caption('agent', 'Done.', 1));
    set(null);
    expect(strip()?.classList).toContain('leaving');
    jest.advanceTimersByTime(399);
    fixture.detectChanges();
    expect(strip()).not.toBeNull();
    jest.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(strip()).toBeNull();

    set(caption('agent', 'Again.', 2));
    fixture.componentRef.setInput('exit', 'cut');
    set(null);
    jest.advanceTimersByTime(120);
    fixture.detectChanges();
    expect(strip()).toBeNull();
  });

  it('plays the exit before a selection hint replaces a spoken line', () => {
    set(caption('agent', 'Done.', 1));
    set(caption('status', 'Selected: reviewer · running', 0));
    expect(strip()?.classList).toContain('leaving');
    expect(strip()?.textContent).toContain('Done.');
    set(caption('status', 'Selected: writer · idle', 0));
    jest.advanceTimersByTime(399);
    fixture.detectChanges();
    expect(strip()?.textContent).toContain('Done.');
    jest.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(strip()?.classList).not.toContain('leaving');
    expect(strip()?.textContent).toContain('Selected: writer · idle');

    set(caption('user', 'stop', 2));
    fixture.componentRef.setInput('exit', 'cut');
    set(caption('status', 'Selected: writer · idle', 0));
    expect(strip()?.classList).toContain('cut');
    jest.advanceTimersByTime(120);
    fixture.detectChanges();
    expect(strip()?.textContent).toContain('Selected: writer · idle');
  });

  it('hides at once under reduced motion', () => {
    fixture.componentRef.setInput('reducedMotion', true);
    set(caption('agent', 'Done.', 1));
    set(null);
    expect(strip()).toBeNull();
  });

  it('drops the pill and adds a speaker eyebrow for a long sentence', () => {
    set(caption('agent', 'word '.repeat(30).trim(), 3));
    expect(strip()?.classList).not.toContain('single');
    expect(strip()?.textContent).toContain('Ptah');
  });
});

describe('captionTail', () => {
  it('keeps short text whole', () => {
    expect(captionTail('Short sentence.')).toBe('Short sentence.');
  });

  it('keeps the latest words of a long sentence behind an ellipsis', () => {
    const text = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    const tail = captionTail(text, 20);
    expect(tail.startsWith('…')).toBe(true);
    expect(tail.endsWith('w39')).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(21);
    expect(tail.slice(1).startsWith(' ')).toBe(false);
  });
});
