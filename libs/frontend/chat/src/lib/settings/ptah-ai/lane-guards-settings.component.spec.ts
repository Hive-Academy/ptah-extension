import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import type { AgentOrchestrationConfig } from '@ptah-extension/shared';
import { LaneGuardsSettingsComponent } from './lane-guards-settings.component';

const CONFIG = {
  laneToolCallSteerAt: 40,
  laneToolCallStopAt: 60,
  laneRepeatCallStopAt: 20,
} as AgentOrchestrationConfig;

describe('LaneGuardsSettingsComponent', () => {
  let fixture: ComponentFixture<LaneGuardsSettingsComponent>;
  let call: jest.Mock;

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
      providers: [{ provide: ClaudeRpcService, useValue: { call } }],
    });
  });

  afterEach(() => fixture?.destroy());

  it('loads the three guard values from agent:getConfig', async () => {
    await create();
    expect(call).toHaveBeenCalledWith('agent:getConfig', undefined, {
      timeout: 5_000,
    });
    expect(input('lane-guards-steer').value).toBe('40');
    expect(input('lane-guards-stop').value).toBe('60');
    expect(input('lane-guards-repeat').value).toBe('20');
    expect(input('lane-guards-steer').className).toContain('input-sm');
    expect(input('lane-guards-steer').className).toContain('flex-1');
    expect(input('lane-guards-steer').className).toContain('join-item');
    expect(byTestId('lane-guards-intro')?.textContent).toContain(
      'cannot receive the mid-turn steer',
    );
    expect(host().textContent).toContain('Range: 1 or greater.');
    expect(host().textContent).toContain('Range: 2 or greater.');
  });

  it('shows Retry when the read fails, then loads again', async () => {
    call.mockImplementation(async () => rpcError('host offline'));
    await create();
    expect(byTestId('lane-guards-load-error')).not.toBeNull();
    expect(byTestId('lane-guards-steer')).toBeNull();

    call.mockImplementation(async (method: string) =>
      method === 'agent:getConfig'
        ? rpcSuccess(CONFIG)
        : rpcSuccess({ success: true }),
    );
    byTestId<HTMLButtonElement>('lane-guards-retry')?.click();
    await settle();
    expect(input('lane-guards-steer').value).toBe('40');
  });

  it('blocks a stop that is not greater than steer and does not call setConfig', async () => {
    await create();
    call.mockClear();
    await enter('lane-guards-stop', '40');
    expect(input('lane-guards-stop').getAttribute('aria-invalid')).toBe('true');
    expect(byTestId('lane-guards-stop-error')?.textContent).toContain(
      'Stop at must be greater than Steer at.',
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('saves a valid pair through agent:setConfig', async () => {
    await create();
    await enter('lane-guards-steer', '10');
    expect(call).toHaveBeenCalledWith(
      'agent:setConfig',
      { laneToolCallSteerAt: 10 },
      { timeout: 5_000 },
    );
    expect(byTestId('lane-guards-status')?.textContent).toContain('Saved');
  });

  it('shows the backend error when setConfig rejects the write', async () => {
    await create();
    call.mockImplementation(async (method: string) =>
      method === 'agent:setConfig'
        ? rpcSuccess({
            success: false,
            error: 'Unsupported laneToolCallStopAt value',
          })
        : rpcSuccess(CONFIG),
    );
    await enter('lane-guards-stop', '80');
    expect(byTestId('lane-guards-stop-error')?.textContent).toContain(
      'Unsupported laneToolCallStopAt value',
    );
    expect(input('lane-guards-stop').value).toBe('80');
  });
});
