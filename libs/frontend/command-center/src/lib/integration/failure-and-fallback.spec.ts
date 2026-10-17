import { TestBed } from '@angular/core/testing';
import { createHarness } from './integration-harness.testing';

type Rpc = ReturnType<typeof createHarness>['rpc'];

const clip = { audioBase64: 'AA==', mimeType: 'audio/wav' };

/** Lets queued synthesis rejections and playback callbacks settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Only transcription answers; every other voice RPC (synthesis) fails. */
function answerTranscription(
  rpc: Rpc,
  outcome: { transcript: string } | 'fail',
) {
  rpc.call.mockImplementation(async (method: string) => ({
    success: method === 'voice:transcribe' && outcome !== 'fail',
    data:
      method === 'voice:transcribe' && outcome !== 'fail'
        ? { ok: true, transcript: outcome.transcript }
        : null,
  }));
}

describe('Command Center failure and fallback integration', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a safe error for a failed transcription and sends the next voice turn without replaying the first', async () => {
    const { fixture, rpc, sender, pulses } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.voice['active'] = true;
    page.store.setVoiceState('thinking');
    answerTranscription(rpc, { transcript: 'First command' });
    await page.voice['onClip'](clip);
    expect(sender.send).toHaveBeenCalledTimes(1);
    pulses.set([
      {
        tabId: page.store.markedTabId() ?? '',
        seq: 1,
        classification: 'success',
        lastAssistantMessage: 'Done.',
      },
    ]);
    fixture.detectChanges();
    await flush();

    answerTranscription(rpc, 'fail');
    await page.voice['onClip'](clip);
    fixture.detectChanges();
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(page.store.toast()).toMatchObject({
      message: 'Transcription failed. Please try again or use text.',
      tone: 'error',
    });
    expect(fixture.nativeElement.textContent).toContain('Transcription failed');
    expect(page.store.voiceState()).toBe('listening');

    answerTranscription(rpc, { transcript: 'Second command' });
    await page.voice['onClip'](clip);
    expect(sender.send.mock.calls.map(([content]) => content)).toEqual([
      'First command',
      'Second command',
    ]);
    await page.exit();
    fixture.destroy();
  });

  it('hides a thrown transcription error, creates no turn and leaves text sending available', async () => {
    const { fixture, rpc, sender } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.voice['active'] = true;
    page.store.setVoiceState('thinking');
    rpc.call.mockRejectedValueOnce(new Error('sk-test-123 stt backend down'));
    await page.voice['onClip'](clip);
    fixture.detectChanges();
    expect(sender.send).not.toHaveBeenCalled();
    expect(page.store.toast()?.message).toBe(
      'Voice request failed. Please try again or use text.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('sk-test-123');
    expect(page.store.voiceState()).toBe('listening');
    expect(await page.sendCommand('Typed instead')).toBe(true);
    expect(sender.send.mock.calls.map(([content]) => content)).toEqual([
      'Typed instead',
    ]);
    await page.exit();
    fixture.destroy();
  });

  it('reports a synthesis failure safely, retries only the speech and keeps text turns available', async () => {
    const { fixture, rpc, sender, pulses } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.voice['active'] = true;
    answerTranscription(rpc, { transcript: 'Summarize the build' });
    await page.voice['onClip'](clip);
    expect(sender.send).toHaveBeenCalledTimes(1);
    const synthesisCalls = () =>
      rpc.call.mock.calls.filter(([method]) => method === 'voice:synthesize')
        .length;
    rpc.call.mockImplementation(async (method: string) => {
      if (method === 'voice:synthesize')
        throw new Error('sk-test-123 synthesis backend down');
      return { success: false, data: null };
    });
    pulses.set([
      {
        tabId: page.store.markedTabId() ?? '',
        seq: 1,
        classification: 'success',
        lastAssistantMessage: 'The build is green.',
      },
    ]);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(page.store.toast()).toMatchObject({
      tone: 'error',
      action: 'retry-speech',
    });
    expect(fixture.nativeElement.textContent).toContain(
      'Speech synthesis failed',
    );
    expect(fixture.nativeElement.textContent).not.toContain('sk-test-123');
    const attempts = synthesisCalls();
    expect(attempts).toBeGreaterThan(0);

    const retry = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Retry speech'));
    expect(retry).toBeDefined();
    retry?.click();
    await flush();
    expect(synthesisCalls()).toBeGreaterThan(attempts);
    expect(sender.send).toHaveBeenCalledTimes(1);

    expect(await page.sendCommand('Continue in text')).toBe(true);
    expect(sender.send).toHaveBeenCalledTimes(2);
    await page.exit();
    fixture.destroy();
  });

  it('shows a failed chat turn as a safe error and lets the same session continue', async () => {
    const { fixture, sender, pulses } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    await page.sendCommand('Run the build');
    expect(page.store.sessionStatus()).toBe('running');
    const sessionId = page.store.sessionId();
    pulses.set([
      {
        tabId: page.store.markedTabId() ?? '',
        seq: 1,
        classification: 'error',
      },
    ]);
    fixture.detectChanges();
    expect(page.shownSessionStatus()).toBe('error');
    expect(page.store.toast()).toMatchObject({
      message: 'The Command Center turn could not finish.',
      tone: 'error',
    });
    expect(fixture.nativeElement.textContent).toContain(
      'The Command Center turn could not finish.',
    );
    expect(await page.sendCommand('Try again')).toBe(true);
    fixture.detectChanges();
    expect(page.store.sessionStatus()).toBe('running');
    expect(page.shownSessionStatus()).not.toBe('error');
    expect(page.store.sessionId()).toBe(sessionId);
    expect(sender.send.mock.calls.map(([content]) => content)).toEqual([
      'Run the build',
      'Try again',
    ]);
    fixture.destroy();
  });

  it('shows a failed delegated lane in the list, speaks the failure once and keeps the root usable', async () => {
    const { fixture, projectionInput, rpc, pulses } = createHarness();
    const page = fixture.componentInstance.page;
    await page.open();
    page.voice['active'] = true;
    answerTranscription(rpc, { transcript: 'Status' });
    const rootSessionId = page.store.sessionId() ?? '';
    const advance = async (state: 'running' | 'failed', seq: number) => {
      projectionInput.update((input) => ({
        ...input,
        agents: [
          {
            agentId: 'lane-1',
            kind: 'cli',
            parentSessionId: rootSessionId,
            state,
          },
        ],
      }));
      fixture.detectChanges();
      await page.voice['onClip'](clip);
      pulses.set([
        {
          tabId: page.store.markedTabId() ?? '',
          seq,
          classification: 'success',
          lastAssistantMessage: 'Status.',
        },
      ]);
      fixture.detectChanges();
      await flush();
    };
    await advance('running', 1);
    await advance('failed', 2);
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector(
      'ptah-command-work-list ul button',
    );
    expect(row?.textContent).toContain('CLI agent');
    expect(row?.textContent).toContain('failed');
    const spoken = rpc.call.mock.calls
      .filter(([method]) => method === 'voice:synthesize')
      .map(([, request]) => JSON.stringify(request));
    expect(
      spoken.filter((text) => text.includes('CLI agent failed')),
    ).toHaveLength(1);
    expect(page.projection().nodes[0]?.state).not.toBe('failed');
    expect(await page.sendCommand('Retry the lane work')).toBe(true);
    await page.exit();
    fixture.destroy();
  });

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
      stt: null,
      tts: null,
    });
    await page.sendCommand('Continue in text');
    expect(sender.send).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('sk-test-123');
    fixture.destroy();
  });
});
