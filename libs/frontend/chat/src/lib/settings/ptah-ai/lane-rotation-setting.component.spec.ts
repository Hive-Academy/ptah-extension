import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ClaudeRpcService,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';
import { rpcError, rpcSuccess } from '@ptah-extension/core/testing';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { LaneRotationSettingComponent } from './lane-rotation-setting.component';

const KEY = 'agentOrchestration.laneRotation';
const TIMEOUT = { timeout: 5_000 };

class Host {
  stored: unknown = undefined;
  readFails = false;
  readonly call = jest.fn(async (method: string, params?: unknown) => {
    if (method === 'agent:getCapabilityMatrix') {
      return rpcSuccess({ profiles: [], lastPicks: [{ key: 'implement|implement', candidateId: 'codex' }] });
    }
    if (method === 'settings:get') {
      return this.readFails
        ? rpcError('host offline')
        : rpcSuccess({ success: true, value: this.stored });
    }
    if (method === 'settings:set') {
      this.stored = (params as { value: unknown }).value;
      return rpcSuccess({ success: true });
    }
    throw new Error(`unexpected ${method}`);
  });
}

describe('LaneRotationSettingComponent', () => {
  let fixture: ComponentFixture<LaneRotationSettingComponent>;
  let host: Host;

  const toggle = (): HTMLInputElement | null =>
    (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="lane-rotation-toggle"]',
    );

  async function settle(): Promise<void> {
    for (let i = 0; i < 2; i += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  beforeEach(() => {
    host = new Host();
    TestBed.configureTestingModule({
      imports: [LaneRotationSettingComponent],
      providers: [
        { provide: ClaudeRpcService, useValue: { call: host.call } },
        {
          provide: ProvidersSettingsStateService,
          useValue: { commit: signal({ status: 'idle' }) },
        },
        SettingsSaveFeedbackService,
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(LaneRotationSettingComponent);
    fixture.detectChanges();
    await settle();
  }

  it('reads a missing value as on', async () => {
    await create();
    expect(host.call).toHaveBeenCalledWith('settings:get', { key: KEY }, TIMEOUT);
    expect(toggle()?.checked).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Last pick (implement|implement): codex');
  });

  it('writes the opposite value through settings:set', async () => {
    host.stored = true;
    await create();
    toggle()?.dispatchEvent(new Event('change'));
    await settle();
    expect(host.call).toHaveBeenCalledWith(
      'settings:set',
      { key: KEY, value: false },
      TIMEOUT,
    );
    expect(toggle()?.checked).toBe(false);
  });

  it('shows retry when the read fails and takes no write', async () => {
    host.readFails = true;
    await create();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="lane-rotation-load-error"]',
      ),
    ).not.toBeNull();
    expect(toggle()).toBeNull();
    expect(host.call).not.toHaveBeenCalledWith(
      'settings:set',
      expect.anything(),
      TIMEOUT,
    );
  });
});
