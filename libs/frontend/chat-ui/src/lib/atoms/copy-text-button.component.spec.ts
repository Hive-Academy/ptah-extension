import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';
import { VSCodeService } from '@ptah-extension/core';
import { CopyTextButtonComponent } from './copy-text-button.component';

/**
 * The atom must behave the same in both webviews (decision #8), so every case
 * runs with the host flag true (Electron) and false (VS Code).
 */
describe.each([true, false])(
  'CopyTextButtonComponent (isElectron=%s)',
  (isElectron) => {
    let fixture: ComponentFixture<CopyTextButtonComponent>;
    let copyMock: jest.Mock<boolean, [string]>;

    beforeEach(async () => {
      jest.useFakeTimers();
      copyMock = jest.fn().mockReturnValue(true);
      await TestBed.configureTestingModule({
        imports: [CopyTextButtonComponent],
        providers: [
          { provide: Clipboard, useValue: { copy: copyMock } },
          { provide: VSCodeService, useValue: { isElectron } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(CopyTextButtonComponent);
      fixture.componentRef.setInput('text', 'npm test -- --watch');
      fixture.componentRef.setInput('label', 'Copy command');
      fixture.detectChanges();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const button = (): HTMLButtonElement =>
      (fixture.nativeElement as HTMLElement).querySelector(
        'button',
      ) as HTMLButtonElement;
    const liveRegion = (): HTMLElement =>
      (fixture.nativeElement as HTMLElement).querySelector(
        '[aria-live]',
      ) as HTMLElement;

    function click(): void {
      button().click();
      fixture.detectChanges();
    }

    it('names the button with the label and has a polite live region', () => {
      expect(button().getAttribute('aria-label')).toBe('Copy command');
      expect(button().getAttribute('type')).toBe('button');
      expect(button().title).toBe('Copy command');
      expect(liveRegion().getAttribute('aria-live')).toBe('polite');
      expect(liveRegion().textContent?.trim()).toBe('');
    });

    it('copies the exact text and announces "Copied"', () => {
      click();
      expect(copyMock).toHaveBeenCalledWith('npm test -- --watch');
      expect(liveRegion().textContent?.trim()).toBe('Copied');
      expect(button().title).toBe('Copied');
    });

    it('announces "Copy failed" when the clipboard returns false', () => {
      copyMock.mockReturnValue(false);
      click();
      expect(liveRegion().textContent?.trim()).toBe('Copy failed');
      expect(button().classList).toContain('text-error');
    });

    it('announces "Copy failed" and does not throw when the clipboard throws', () => {
      copyMock.mockImplementation(() => {
        throw new Error('NotAllowedError');
      });
      expect(() => click()).not.toThrow();
      expect(liveRegion().textContent?.trim()).toBe('Copy failed');
    });

    it('resets the feedback after two seconds', () => {
      click();
      jest.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(liveRegion().textContent?.trim()).toBe('');
      expect(button().getAttribute('aria-label')).toBe('Copy command');
    });

    it('clears a pending reset when destroyed', () => {
      const setSpy = jest.spyOn(globalThis, 'setTimeout');
      click();
      const resetCall = setSpy.mock.calls.findIndex(
        ([, delay]) => delay === 2000,
      );
      expect(resetCall).toBeGreaterThanOrEqual(0);
      const resetTimer = setSpy.mock.results[resetCall].value;

      const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
      fixture.destroy();
      expect(clearSpy).toHaveBeenCalledWith(resetTimer);
      setSpy.mockRestore();
      clearSpy.mockRestore();
    });

    it('is disabled when there is no text to copy', () => {
      fixture.componentRef.setInput('text', '');
      fixture.detectChanges();
      expect(button().disabled).toBe(true);
    });
  },
);
