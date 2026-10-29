import { TestBed } from '@angular/core/testing';
import { CAPTION_ANNOUNCE_DEBOUNCE_MS } from '../components/command-caption-strip.component';
import { createHarness } from './integration-harness.testing';

describe('Command Center voice loop integration', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('uses the page voice controls and retains the chat session on mute', async () => {
    const { fixture } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    const start = jest.spyOn(page.voice, 'start').mockResolvedValue(true);
    const mute = jest.spyOn(page.voice, 'mute').mockResolvedValue(undefined);
    await page.startVoice();
    await page.muteVoice();
    expect(start).toHaveBeenCalledTimes(1);
    expect(mute).toHaveBeenCalledTimes(1);
    expect(page.store.sessionId()).toBe('11111111-1111-4111-8111-111111111111');
    fixture.destroy();
  });

  it('routes explicit Stop response through chat abort', async () => {
    const { fixture, rpc } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    await page.coordinator.stop();
    expect(rpc.call).toHaveBeenCalledWith(
      'chat:abort',
      expect.objectContaining({
        sessionId: page.store.sessionId(),
      }),
    );
    fixture.destroy();
  });

  it('ignores empty utterances and sends one non-empty transcript through the page', async () => {
    const { fixture, rpc, sender } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    page.voice['active'] = true;
    page.store.setVoiceState('thinking');
    rpc.call.mockImplementation(async (method: string) => ({
      success: true,
      data:
        method === 'voice:transcribe'
          ? { ok: true, transcript: '  \n ' }
          : null,
    }));
    const clip = { audioBase64: 'AA==', mimeType: 'audio/wav' };
    await page.voice['onClip'](clip);
    expect(sender.send).not.toHaveBeenCalled();
    expect(page.store.voiceState()).toBe('listening');
    rpc.call.mockImplementation(async (method: string) => ({
      success: true,
      data:
        method === 'voice:transcribe'
          ? { ok: true, transcript: '  Check the build.  ' }
          : null,
    }));
    await page.voice['onClip'](clip);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0]?.[0]).toBe('Check the build.');
    await page.exit();
    fixture.destroy();
  });

  it('speaks bounded prose at a turn boundary while keeping the full reply visible', async () => {
    const { fixture, rpc, pulses } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.coordinator.chooseCurrentTab();
    // Binding flushes before the turn can end, as it does in the app.
    fixture.detectChanges();
    page.voice['active'] = true;
    rpc.call.mockImplementation(async (method: string) => ({
      success: method === 'voice:transcribe',
      data:
        method === 'voice:transcribe'
          ? { ok: true, transcript: 'Summarize the result.' }
          : null,
    }));
    await page.voice['onClip']({ audioBase64: 'AA==', mimeType: 'audio/wav' });
    const reply = [
      'The change is ready. Review the summary below.',
      '```ts',
      'const secretCode = 42;',
      '```',
      'diff --git a/file b/file',
      '--- a/file',
      '+++ b/file',
      '@@ -1 +1 @@',
      '-removedDiff',
      '+addedDiff',
      '',
      'The remaining documentation is intentionally long. '.repeat(30),
    ].join('\n');
    pulses.set([
      {
        tabId: page.store.markedTabId() ?? '',
        seq: 1,
        classification: 'success',
        lastAssistantMessage: reply,
      },
    ]);
    fixture.detectChanges();
    await Promise.resolve();
    const spoken = rpc.call.mock.calls
      .filter(([method]) => method === 'voice:synthesize')
      .map(([, request]) => JSON.stringify(request))
      .join(' ');
    expect(spoken).toContain('The change is ready');
    expect(spoken).not.toMatch(/secretCode|removedDiff|addedDiff|diff --git/);
    expect(spoken.length).toBeLessThan(700);
    // Synthesis is unavailable here, so the reply's first sentence reaches the
    // caption strip; the full reply stays in the rail's Live transcript.
    fixture.detectChanges();
    const strip = fixture.nativeElement.querySelector(
      '[data-testid="caption-strip"]',
    ) as HTMLElement | null;
    expect(strip?.textContent).toContain('The change is ready.');
    expect(strip?.textContent).not.toMatch(/secretCode|addedDiff/);
    expect(
      fixture.nativeElement.querySelector('[data-testid="live-target"]')
        ?.textContent,
    ).toContain(page.store.markedTabId() ?? '');
    await page.exit();
    fixture.destroy();
  });

  it('shows and announces a reply as a caption when voice is off', async () => {
    jest.useFakeTimers();
    try {
      const { fixture, pulses } = createHarness();
      const page = fixture.componentInstance.page;
      await page.open();
      page.coordinator.chooseCurrentTab();
      fixture.detectChanges();
      pulses.set([
        {
          tabId: page.store.markedTabId() ?? '',
          seq: 1,
          classification: 'success',
          lastAssistantMessage:
            'All three tests pass now. The flaky one waited on a timer.',
        },
      ]);
      fixture.detectChanges();
      const strip = fixture.nativeElement.querySelector(
        '[data-testid="caption-strip"]',
      ) as HTMLElement | null;
      expect(strip?.textContent).toContain('All three tests pass now.');
      expect(strip?.textContent).not.toContain('flaky');
      jest.advanceTimersByTime(CAPTION_ANNOUNCE_DEBOUNCE_MS);
      fixture.detectChanges();
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="caption-announcer"]')
          ?.textContent?.trim(),
      ).toBe('Ptah: All three tests pass now.');
      fixture.destroy();
    } finally {
      jest.useRealTimers();
    }
  });
});
