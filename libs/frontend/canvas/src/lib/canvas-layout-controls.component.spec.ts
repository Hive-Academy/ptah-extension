import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CanvasLayoutControlsComponent } from './canvas-layout-controls.component';

describe('CanvasLayoutControlsComponent', () => {
  const setup = (tileCount = 3, locked = false) => {
    TestBed.configureTestingModule({ imports: [CanvasLayoutControlsComponent] });
    const fixture = TestBed.createComponent(CanvasLayoutControlsComponent);
    fixture.componentRef.setInput('tileCount', tileCount);
    fixture.componentRef.setInput('locked', locked);
    fixture.detectChanges();
    return fixture;
  };

  it('offers three named presets and no numeric column actions', () => {
    const fixture = setup();
    fixture.debugElement.query(By.css('button[trigger]')).nativeElement.click();
    fixture.detectChanges();
    const buttons = fixture.debugElement.queryAll(By.css('button[data-preset]'));
    expect(buttons.map((button) => button.nativeElement.dataset.preset)).toEqual([
      'even-grid', 'one-plus-two', 'focus-plus-stack',
    ]);
    expect(buttons.map((button) => button.nativeElement.getAttribute('aria-label'))).toEqual([
      'Even grid preset: changes all tile widths to equal rows of three',
      'One plus two preset: changes all tile widths to one full-width tile, then pairs',
      'Focus plus stack preset: changes all tile widths to the active tile at full width, then pairs',
    ]);
  });

  it.each(['even-grid', 'one-plus-two', 'focus-plus-stack'] as const)(
    'emits %s once and closes',
    (preset) => {
      const fixture = setup();
      const emitted = jest.fn();
      fixture.componentInstance.presetRequested.subscribe(emitted);
      fixture.componentInstance.open();
      fixture.detectChanges();
      fixture.debugElement.query(By.css(`button[data-preset="${preset}"]`)).nativeElement.click();
      expect(emitted).toHaveBeenCalledWith(preset);
      expect(fixture.componentInstance.isOpen()).toBe(false);
    },
  );

  it('disables preset mutation while locked but keeps unlock operable', () => {
    const fixture = setup(3, true);
    fixture.componentInstance.open();
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('button[data-preset]')).every((button) => button.nativeElement.disabled)).toBe(true);
    const lock = fixture.debugElement.query(By.css('button[aria-label="Unlock tiles"]'));
    expect(lock.nativeElement.disabled).toBe(false);
    const emitted = jest.fn();
    fixture.componentInstance.lockToggled.subscribe(emitted);
    lock.nativeElement.click();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('disables and closes all controls for a singleton', () => {
    const fixture = setup(1);
    expect(fixture.debugElement.query(By.css('button[trigger]')).nativeElement.disabled).toBe(true);
    expect(fixture.componentInstance.isOpen()).toBe(false);
  });
});
