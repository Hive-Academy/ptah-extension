import { TestBed } from '@angular/core/testing';
import { createHarness } from './integration-harness.testing';

describe('Command Center failure and fallback integration', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('hides secret-bearing send errors while leaving text interaction available', async () => {
    const { fixture, sender } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    sender.send.mockRejectedValueOnce(
      new Error('sk-test-123 raw host failure'),
    );
    expect(await page.sendCommand('Try this')).toBe(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Could not send');
    expect(fixture.nativeElement.textContent).not.toContain('sk-test-123');
    expect(page.store.toast()?.message).not.toContain('sk-test-123');
    expect(
      fixture.nativeElement.querySelector('textarea, input'),
    ).not.toBeNull();
    fixture.destroy();
  });

  it('keeps the text controls and list when canvas is unavailable', async () => {
    const { fixture } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.canvasUnavailable.set(true);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('ptah-command-work-list'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-command-session-controls'),
    ).not.toBeNull();
    fixture.destroy();
  });

  it('keeps text interaction available when provider configuration fails', async () => {
    const { fixture, rpc, sender } = createHarness();
    rpc.call.mockRejectedValueOnce(new Error('sk-test-123 invalid provider'));
    const page = fixture.componentInstance.page;
    await page.open();
    expect(page.store.provider()).toEqual({
      transcription: false,
      synthesis: false,
    });
    await page.sendCommand('Continue in text');
    expect(sender.send).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('sk-test-123');
    fixture.destroy();
  });
});
