import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_MOTION_STYLE, MOTION_STYLES, ThemeService, type MotionStyleName } from '@ptah-extension/core';
import { MotionStylePickerComponent } from './motion-style-picker.component';

describe('MotionStylePickerComponent', () => {
  let motionStyle: ReturnType<typeof signal<MotionStyleName>>;
  let setMotionStyle: jest.Mock;
  let media: MediaQueryList;
  let removeListener: jest.SpyInstance;
  const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

  beforeEach(async () => {
    motionStyle = signal<MotionStyleName>(DEFAULT_MOTION_STYLE);
    setMotionStyle = jest.fn();
    media = Object.assign(new EventTarget(), {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    });
    removeListener = jest.spyOn(media, 'removeEventListener');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockReturnValue(media),
    });

    await TestBed.configureTestingModule({
      imports: [MotionStylePickerComponent],
      providers: [{ provide: ThemeService, useValue: { motionStyle: motionStyle.asReadonly(), setMotionStyle } }],
    }).compileComponents();
  });

  afterEach(() => {
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    else Reflect.deleteProperty(window, 'matchMedia');
    jest.restoreAllMocks();
  });

  it('shows the six named presets, with Rise checked and no None option', () => {
    const fixture = TestBed.createComponent(MotionStylePickerComponent);
    fixture.detectChanges();
    const radios = [...fixture.nativeElement.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];

    expect(radios.map((radio) => radio.value)).toEqual(MOTION_STYLES);
    expect(radios.map((radio) => radio.closest('label')?.textContent?.trim())).toEqual([
      'Fade', 'Rise', 'Slide left', 'Slide right', 'Scale', 'Direction-aware',
    ]);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['rise']);
    expect(fixture.nativeElement.querySelector('legend')?.textContent).toBe('Animation style');
    expect(fixture.nativeElement.textContent).not.toContain('None');
  });

  it('selects through ThemeService and follows later signal changes', () => {
    const fixture = TestBed.createComponent(MotionStylePickerComponent);
    fixture.detectChanges();
    const radios = [...fixture.nativeElement.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];

    radios[2].dispatchEvent(new Event('change'));
    expect(setMotionStyle).toHaveBeenCalledWith('slide-left');
    motionStyle.set('slide-left');
    fixture.detectChanges();
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['slide-left']);

    const chip = fixture.nativeElement.querySelector('[data-motion-style="slide-left"] .motion-preview-chip') as HTMLElement;
    expect(chip.classList.contains('previewing')).toBe(true);
    chip.dispatchEvent(new Event('animationend'));
    fixture.detectChanges();
    expect(chip.classList.contains('previewing')).toBe(false);
  });

  it('replays a preview after hover and clears it after animation ends or is cancelled', () => {
    const fixture = TestBed.createComponent(MotionStylePickerComponent);
    fixture.detectChanges();
    const frame = fixture.nativeElement.querySelector('[data-motion-style="rise"]') as HTMLElement;
    const chip = frame.querySelector('.motion-preview-chip') as HTMLElement;
    const radio = fixture.nativeElement.querySelector('input[value="rise"]') as HTMLInputElement;
    const reflow = jest.spyOn(chip, 'offsetWidth', 'get').mockReturnValue(20);

    frame.dispatchEvent(new Event('mouseenter'));
    chip.dispatchEvent(new Event('animationend'));
    radio.dispatchEvent(new Event('change'));
    expect(reflow).toHaveBeenCalledTimes(1);
    expect(chip.classList.contains('previewing')).toBe(true);
    expect(chip.style.animation).toBe('');
    chip.dispatchEvent(new Event('animationend'));
    expect(chip.classList.contains('previewing')).toBe(false);

    radio.dispatchEvent(new Event('change'));
    expect(reflow).toHaveBeenCalledTimes(2);
    expect(chip.classList.contains('previewing')).toBe(true);
    chip.dispatchEvent(new Event('animationcancel'));
    expect(chip.classList.contains('previewing')).toBe(false);
  });

  it('alternates the directional preview between forward and back', () => {
    const fixture = TestBed.createComponent(MotionStylePickerComponent);
    fixture.detectChanges();
    const frame = fixture.nativeElement.querySelector('[data-motion-style="directional"]') as HTMLElement;
    expect(frame.dataset['motionDir']).toBe('forward');
    frame.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(frame.dataset['motionDir']).toBe('back');
    frame.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    expect(frame.dataset['motionDir']).toBe('forward');
  });

  it('supports native arrow-key selection with labelled radios', () => {
    const fixture = TestBed.createComponent(MotionStylePickerComponent);
    fixture.detectChanges();
    const radios = [...fixture.nativeElement.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(radios.every((radio) => radio.closest('label')?.textContent?.trim() && !radio.hasAttribute('aria-label'))).toBe(true);
    radios[1].focus();
    radios[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    // jsdom does not run the browser's native radio arrow-key default action.
    radios[2].checked = true;
    radios[2].dispatchEvent(new Event('change', { bubbles: true }));
    expect(setMotionStyle).toHaveBeenCalledWith('slide-left');
  });

  it('uses a different radio group name for each picker instance', () => {
    const first = TestBed.createComponent(MotionStylePickerComponent);
    const second = TestBed.createComponent(MotionStylePickerComponent);
    first.detectChanges();
    second.detectChanges();
    const firstNames = [...first.nativeElement.querySelectorAll('input[type="radio"]')].map((radio: HTMLInputElement) => radio.name);
    const secondNames = [...second.nativeElement.querySelectorAll('input[type="radio"]')].map((radio: HTMLInputElement) => radio.name);
    expect(new Set(firstNames).size).toBe(1);
    expect(new Set(secondNames).size).toBe(1);
    expect(firstNames[0]).not.toBe(secondNames[0]);
  });

  it('shows the reduced-motion note on media changes and removes its listener', () => {
    const fixture = TestBed.createComponent(MotionStylePickerComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Reduced motion is on');

    Object.assign(media, { matches: true });
    media.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Reduced motion is on. Animation styles do not play. Use Motion above to change this setting.');

    fixture.destroy();
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
