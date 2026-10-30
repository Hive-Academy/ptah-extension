import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import type { AgentOrchestrationConfig } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { LaneGuardsSettingsComponent } from './lane-guards-settings.component';

const CONFIG = {
  laneRepeatCallStopAt: 20,
} as AgentOrchestrationConfig;

describe('LaneGuardsSettingsComponent', () => {
  let fixture: ComponentFixture<LaneGuardsSettingsComponent>;
  let call: jest.Mock;
  let feedback: SettingsSaveFeedbackService;

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => host().querySelector<T>(`[data-testid="${id}"]`);
  const input = (id: string): HTMLInputElement =>
    byTestId<HTMLInputElement>(id) as HTMLInputElement;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(LaneGuardsSettingsComponent);
    fixture.detectChanges();
    await settle();
  }

  async function enter(id: string, text: string): Promise<void> {
    const field = input(id);
    field.value = text;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    field.dispatchEvent(new Event('change'));
    await settle();
  }

  beforeEach(() => {
    call = jest.fn(async (method: string) => {
      if (method === 'agent:getConfig') return rpcSuccess(CONFIG);
      return rpcSuccess({ success: true });
    });
    TestBed.configureTestingModule({
      imports: [LaneGuardsSettingsComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
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
  });

  it('loads only the repeat-call field from agent:getConfig', async () => {
    await create();
    expect(call).toHaveBeenCalledWith('agent:getConfig', undefined, {
      timeout: 5_000,
    });
    expect(input('lane-guards-repeat').value).toBe('20');
    expect(byTestId('lane-guards-steer')).toBeNull();
    expect(byTestId('lane-guards-stop')).toBeNull();
    expect(host().querySelectorAll('input')).toHaveLength(1);
    expect(input('lane-guards-repeat').className).toContain('input-sm');
    expect(input('lane-guards-repeat').className).toContain('flex-1');
    expect(input('lane-guards-repeat').className).toContain('join-item');
    const intro = byTestId('lane-guards-intro')?.textContent ?? '';
    expect(intro).toContain('Lanes have no tool-call limit.');
    expect(intro).not.toContain('Steer at');
    expect(host().textContent).toContain('Range: 2 or greater.');
  });

  it('shows Retry when the read fails, then loads again', async () => {
    call.mockImplementation(async () => rpcError('host offline'));
    await create();
    expect(byTestId('lane-guards-load-error')).not.toBeNull();
    expect(byTestId('lane-guards-repeat')).toBeNull();

    call.mockImplementation(async (method: string) =>
      method === 'agent:getConfig'
        ? rpcSuccess(CONFIG)
        : rpcSuccess({ success: true }),
    );
    byTestId<HTMLButtonElement>('lane-guards-retry')?.click();
    await settle();
    expect(input('lane-guards-repeat').value).toBe('20');
  });

  it('blocks a value below the minimum and does not call setConfig', async () => {
    await create();
    call.mockClear();
    await enter('lane-guards-repeat', '1');
    expect(input('lane-guards-repeat').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(byTestId('lane-guards-repeat-error')?.textContent).toContain(
      'Enter a whole number from 2.',
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('saves a valid value through agent:setConfig, reports it in the toast, and Undo writes the previous value', async () => {
    await create();
    await enter('lane-guards-repeat', '10');
    expect(call).toHaveBeenCalledWith(
      'agent:setConfig',
      { laneRepeatCallStopAt: 10 },
      { timeout: 5_000 },
    );
    expect(byTestId('lane-guards-status')).toBeNull();
    expect(feedback.toast()).toEqual({
      tone: 'status',
      message: 'Saved Repeat-call stop at.',
      canUndo: true,
    });
    await feedback.undo();
    await settle();
    expect(call).toHaveBeenLastCalledWith(
      'agent:setConfig',
      { laneRepeatCallStopAt: 20 },
      { timeout: 5_000 },
    );
    expect(input('lane-guards-repeat').value).toBe('20');
  });

  it('shows the backend error when setConfig rejects the write', async () => {
    await create();
    call.mockImplementation(async (method: string) =>
      method === 'agent:setConfig'
        ? rpcSuccess({
            success: false,
            error: 'Unsupported laneRepeatCallStopAt value',
          })
        : rpcSuccess(CONFIG),
    );
    await enter('lane-guards-repeat', '80');
    expect(byTestId('lane-guards-repeat-error')?.textContent).toContain(
      'Unsupported laneRepeatCallStopAt value',
    );
    expect(input('lane-guards-repeat').value).toBe('80');
    expect(feedback.toast()).toEqual({
      tone: 'alert',
      message: 'Unsupported laneRepeatCallStopAt value',
      canUndo: false,
    });
  });
});
