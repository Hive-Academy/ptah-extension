import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { isDisabledControl } from '../feedback/busy-disabled.testing';
import { HostRoutingSettingComponent } from './host-routing-setting.component';

const KEY = 'agentOrchestration.hostRouting';
const TIMEOUT = { timeout: 5_000 };
const MODEL_SET = {
  selection: { kind: 'ollama', model: 'qwen3:4b' },
  locality: 'local',
  reportsConfidence: true,
  state: 'ready',
  detail: null,
};
const MODEL_UNSET = {
  selection: { kind: 'unset' },
  locality: null,
  reportsConfidence: false,
  state: 'unset',
  detail: null,
};

/** A fake host: `settings:get` returns `stored`; `settings:set` writes it unless told to fail. */
class Host {
  stored: unknown = undefined;
  decisionModel: unknown = MODEL_SET;
  readFails = false;
  writeFails = false;
  readonly call = jest.fn(async (method: string, params?: unknown) => {
    if (method === 'agent:getConfig') {
      return this.readFails
        ? rpcError('host offline')
        : rpcSuccess({ decisionModel: this.decisionModel });
    }
    if (method === 'settings:get') {
      return this.readFails
        ? rpcError('host offline')
        : rpcSuccess({ success: true, value: this.stored });
    }
    if (method === 'settings:set') {
      if (this.writeFails)
        return rpcSuccess({ success: false, error: 'disk full' });
      this.stored = (params as { value: unknown }).value;
      return rpcSuccess({ success: true });
    }
    throw new Error(`unexpected ${method}`);
  });
  writes(): unknown[] {
    return this.call.mock.calls
      .filter(([method]) => method === 'settings:set')
      .map(([, params]) => params);
  }
}

describe('HostRoutingSettingComponent', () => {
  let fixture: ComponentFixture<HostRoutingSettingComponent>;
  let host: Host;
  let feedback: SettingsSaveFeedbackService;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => el().querySelector<T>(`[data-testid="${id}"]`);
  const toggle = () => byTestId<HTMLInputElement>('host-routing-toggle');
  async function settle(): Promise<void> {
    // A macrotask drains the whole RPC promise chain (write, re-read, toast).
    for (let i = 0; i < 2; i += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }
  async function create(): Promise<void> {
    fixture = TestBed.createComponent(HostRoutingSettingComponent);
    fixture.detectChanges();
    await settle();
  }

  beforeEach(() => {
    host = new Host();
    TestBed.configureTestingModule({
      imports: [HostRoutingSettingComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call: host.call } },
        {
          provide: ProvidersSettingsStateService,
          useValue: { commit: signal({ status: 'idle' }) },
        },
        SettingsSaveFeedbackService,
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
  });
  afterEach(() => {
    feedback.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('reads the default (no stored value) as on when a decision model is configured', async () => {
    await create();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('section')?.getAttribute('data-glass-surface'),
    ).toBe('content');
    expect(host.call).toHaveBeenCalledWith(
      'settings:get',
      { key: KEY },
      TIMEOUT,
    );
    expect(host.call).toHaveBeenCalledWith(
      'agent:getConfig',
      undefined,
      TIMEOUT,
    );
    expect(toggle()?.checked).toBe(true);
    expect(toggle()?.disabled).toBe(false);
    for (const name of ['toggle', 'toggle-xs', 'toggle-success'])
      expect(toggle()?.classList.contains(name)).toBe(true);
    expect(toggle()?.getAttribute('aria-label')).toBe('Routing suggestions');
    expect(el().textContent).toContain('Routing suggestions');
    expect(toggle()?.getAttribute('aria-describedby')).toBe(
      'host-routing-help',
    );
    expect(byTestId('host-routing-needs-model')).toBeNull();
    expect(host.writes()).toEqual([]);
  });

  it('shows a stored false as off', async () => {
    host.stored = false;
    await create();
    expect(toggle()?.checked).toBe(false);
    expect(toggle()?.disabled).toBe(false);
  });

  it('turns routing off and on again, persisting each change and showing the read-back value', async () => {
    await create();
    toggle()?.click();
    await settle();
    expect(host.writes()).toEqual([{ key: KEY, value: false }]);
    expect(host.stored).toBe(false);
    expect(toggle()?.checked).toBe(false);
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved routing suggestions.',
      canUndo: true,
    });

    toggle()?.click();
    await settle();
    expect(host.writes()).toEqual([
      { key: KEY, value: false },
      { key: KEY, value: true },
    ]);
    expect(host.stored).toBe(true);
    expect(toggle()?.checked).toBe(true);
    // Each write is followed by a re-read of the stored value.
    const reads = host.call.mock.calls.filter(([m]) => m === 'settings:get');
    expect(reads).toHaveLength(3);
  });

  it('shows routing as inactive without a decision model, and writes nothing on click', async () => {
    host.decisionModel = MODEL_UNSET;
    host.stored = true;
    await create();
    expect(toggle()?.checked).toBe(false);
    expect(toggle()?.disabled).toBe(true);
    expect(byTestId('host-routing-needs-model')?.textContent?.trim()).toBe(
      'Off: set a decision model in Providers to use this.',
    );
    expect(toggle()?.getAttribute('aria-describedby')).toBe(
      'host-routing-help host-routing-needs-model',
    );
    await fixture.componentInstance.toggle({
      target: toggle(),
    } as unknown as Event);
    await settle();
    expect(host.writes()).toEqual([]);
    expect(host.stored).toBe(true);
    expect(toggle()?.checked).toBe(false);
  });

  it('keeps the previous value after a failed save, then a later save can be undone', async () => {
    host.writeFails = true;
    await create();
    toggle()?.click();
    await settle();
    expect(host.writes()).toEqual([{ key: KEY, value: false }]);
    expect(toggle()?.checked).toBe(true);
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message:
        'Could not save routing suggestions. The saved setting is unchanged.',
      canUndo: false,
    });

    host.writeFails = false;
    toggle()?.click();
    await settle();
    expect(toggle()?.checked).toBe(false);
    expect(feedback.toast()?.canUndo).toBe(true);
    await feedback.undo();
    await settle();
    expect(host.writes()).toEqual([
      { key: KEY, value: false },
      { key: KEY, value: false },
      { key: KEY, value: true },
    ]);
    expect(host.stored).toBe(true);
    expect(toggle()?.checked).toBe(true);
  });

  it('treats an acknowledged write whose re-read failed as unconfirmed and offers Retry', async () => {
    await create();
    host.call.mockImplementation(async (method: string) => {
      if (method === 'settings:set') return rpcSuccess({ success: true });
      return rpcError('host offline');
    });
    toggle()?.click();
    await settle();
    expect(toggle()).toBeNull();
    expect(byTestId('host-routing-retry')).not.toBeNull();
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not confirm whether routing suggestions was saved.',
      canUndo: false,
    });
  });

  it('treats a refused write whose re-read failed as unconfirmed, never as unchanged', async () => {
    await create();
    host.call.mockImplementation(async (method: string) => {
      if (method === 'settings:set')
        return rpcSuccess({ success: false, error: 'disk full' });
      return rpcError('host offline');
    });
    toggle()?.click();
    await settle();
    expect(toggle()).toBeNull();
    expect(byTestId('host-routing-retry')).not.toBeNull();
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Could not confirm whether routing suggestions was saved.',
      canUndo: false,
    });
    expect(feedback.toast()?.message).not.toContain('unchanged');
  });

  it('never reports a refused write as saved, even when the read-back matches', async () => {
    await create();
    // The host refuses the write, but the read-back already holds the requested value.
    host.call.mockImplementation(async (method: string) => {
      if (method === 'settings:set')
        return rpcSuccess({ success: false, error: 'locked' });
      if (method === 'settings:get')
        return rpcSuccess({ success: true, value: false });
      return rpcSuccess({ decisionModel: MODEL_SET });
    });
    toggle()?.click();
    await settle();
    expect(toggle()?.checked).toBe(false);
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message:
        'Could not save routing suggestions. The switch shows the saved value.',
      canUndo: false,
    });
  });

  it('reports an acknowledged write whose read-back differs as not saved, without Undo', async () => {
    await create();
    // The host acknowledges the write but the read-back still holds the old value.
    host.call.mockImplementation(async (method: string) => {
      if (method === 'settings:set') return rpcSuccess({ success: true });
      if (method === 'settings:get')
        return rpcSuccess({ success: true, value: true });
      return rpcSuccess({ decisionModel: MODEL_SET });
    });
    toggle()?.click();
    await settle();
    expect(toggle()?.checked).toBe(true);
    expect(byTestId('host-routing-retry')).toBeNull();
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message:
        'Could not save routing suggestions. The switch shows the saved value.',
      canUndo: false,
    });
  });

  it('applies the read-back rule to Undo: a mismatched read-back fails without Undo', async () => {
    await create();
    toggle()?.click();
    await settle();
    expect(host.stored).toBe(false);
    expect(feedback.toast()?.canUndo).toBe(true);
    // The Undo write is acknowledged but the stored value stays off.
    const original = host.call.getMockImplementation();
    host.call.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'settings:set') return rpcSuccess({ success: true });
      return original?.(method, params);
    });
    await feedback.undo();
    await settle();
    expect(host.writes()).toEqual([
      { key: KEY, value: false },
      { key: KEY, value: true },
    ]);
    expect(host.stored).toBe(false);
    expect(toggle()?.checked).toBe(false);
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message:
        'Could not save routing suggestions. The switch shows the saved value.',
      canUndo: false,
    });
  });

  it('shows Retry and no value when the read fails, and Retry reads again', async () => {
    host.readFails = true;
    await create();
    expect(toggle()).toBeNull();
    expect(byTestId('host-routing-load-error')?.textContent?.trim()).toBe(
      'The setting could not be read.',
    );
    host.readFails = false;
    byTestId<HTMLButtonElement>('host-routing-retry')?.click();
    await settle();
    expect(byTestId('host-routing-retry')).toBeNull();
    expect(toggle()?.checked).toBe(true);
    expect(host.writes()).toEqual([]);
  });

  it('is busy-disabled while its write runs', async () => {
    await create();
    let release: () => void = () => undefined;
    const original = host.call.getMockImplementation();
    host.call.mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'settings:set') {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return original?.(method, params);
    });
    toggle()?.click();
    fixture.detectChanges();
    expect(isDisabledControl(toggle())).toBe(true);
    expect(toggle()?.checked).toBe(true);
    release();
    await settle();
    expect(isDisabledControl(toggle())).toBe(false);
  });
});
